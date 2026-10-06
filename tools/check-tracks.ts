/**
 * Validates every track headlessly: layout (length, tightest corner, start straight),
 * an autopilot lap on the real colliders, and a short CPU race (all must finish).
 *
 *   npx tsx tools/check-tracks.ts [trackId…] [--race]
 */
import { initPhysics, PhysicsWorld } from '../shared/src/physics/PhysicsWorld';
import { TRACKS } from '../shared/src/tracks/registry';
import { TrackPath } from '../shared/src/track/TrackPath';
import { TerrainField } from '../shared/src/track/TerrainField';
import { buildTrackColliders } from '../shared/src/track/TrackColliders';
import { RaceSimulation } from '../shared/src/race/RaceSimulation';
import { cpuField } from '../shared/src/roster/Roster';
import { FIXED_DT, TICK_RATE } from '../shared/src/constants/simulation';
import { Vector3 } from 'three';
import { existsSync } from 'node:fs';
import { MODELS, isModelId } from '../client/src/assets/AssetManifest';

const args = process.argv.slice(2);
const only = args.filter((a) => !a.startsWith('--'));
const race = args.includes('--race');
await initPhysics();
let bad = 0;
const totals = { cuts: 0, walls: 0, hits: 0, falls: 0, tracks: 0, best: 0, raceTime: 0, finishers: 0 };
for (const def of TRACKS) {
  if (only.length && !only.includes(def.id)) continue;
  const t0 = performance.now();
  const path = new TrackPath(def);
  const terrain = new TerrainField(path, def.terrain);
  const physics = new PhysicsWorld();
  buildTrackColliders(physics, path, terrain.buildMesh(), terrain);
  // Verify real collision sweeps, asset availability and a kart-sized way past
  // every obstacle. This runs against the same world used by online and offline races.
  let hazardsOK = true;
  const probe = physics.createProbeCollider(0.8);
  for (const hazard of def.hazards) {
    const frame = path.anchorToWorld(hazard);
    const direction = frame.tangent.clone().setY(0).normalize();
    const origin = frame.position.clone().addScaledVector(direction, -8);
    origin.y += hazard.obstacleHeight / 2;
    const hit = physics.moveAgainstWalls(probe, origin, direction.clone().multiplyScalar(16), { movement: new Vector3(), contacts: [] });
    const gap = frame.halfWidth + Math.abs(hazard.lateral ?? 0) - hazard.radius;
    const validModel = isModelId(hazard.model) && existsSync(new URL(`../client/public/${MODELS[hazard.model].url}`, import.meta.url));
    if (!validModel || gap < 3.2 || hit.contacts.length === 0 || hit.movement.length() > 15) {
      hazardsOK = false;
      console.error(`  Invalid obstacle on ${def.id}: ${hazard.model} at ${hazard.distance}m`);
    }
  }
  physics.removeCollider(probe);
  for (const row of def.itemBoxes) {
    const halfWidth = path.anchorToWorld(row).halfWidth;
    if (Math.abs(row.lateral ?? 0) + (row.count - 1) * row.spacing / 2 + 1 > halfWidth + 0.01) {
      hazardsOK = false;
      console.error(`  Item row outside the road on ${def.id} at ${row.distance}m`);
    }
  }
  // Layout sanity: no part of the road may overlap another (crossings need ≥ 8 m height).
  const smp = path.samples;
  const skip = Math.ceil(60 / path.spacing);
  let overlaps = 0;
  let crossings = 0;
  for (let i = 0; i < smp.length; i += 2) {
    for (let j = i + skip; j < smp.length; j += 2) {
      if (smp.length - (j - i) < skip) continue;
      const a = smp[i]!;
      const c = smp[j]!;
      const d = Math.hypot(a.position.x - c.position.x, a.position.z - c.position.z);
      if (d > a.wallOffset + c.wallOffset + 1.5) continue;
      if (Math.abs(a.position.y - c.position.y) >= 8) {
        crossings++;
        continue;
      }
      overlaps++;
      if (overlaps <= 3) console.error(`  Overlap on ${def.id}: ${path.lapDistance(a.distance).toFixed(0)} m vs ${path.lapDistance(c.distance).toFixed(0)} m (${d.toFixed(1)} m apart)`);
    }
  }
  if (overlaps) hazardsOK = false;
  // Tightest corner from sample headings.
  const s = path.samples;
  let minR = Infinity;
  for (let i = 0; i < s.length; i++) {
    const a = s[i]!.tangent;
    const b = s[(i + 3) % s.length]!.tangent;
    const ang = Math.acos(Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z));
    if (ang > 1e-4) minR = Math.min(minR, (path.spacing * 3) / ang);
  }
  // Race: CPUs on hard with no items (pure driving) — every kart must finish.
  const laps = race ? 2 : 1;
  const sim = new RaceSimulation({ laps, checkpoints: def.checkpointCount, itemsEnabled: false, difficulty: 'hard', catchUp: false, seed: 3, countdown: 0.1, racers: cpuField(race ? 6 : 2) }, physics, path);
  const inputs = sim.racers.map(() => null);
  let respawns = 0;
  let jumps = 0;
  let flight = 0;
  let drafts = 0;
  let walls = 0;
  let tick = 0;
  const lastD = sim.racers.map(() => 0);
  const falls = new Map<number, number>();
  const hits = new Map<string, number>();
  for (; tick < TICK_RATE * 130 * laps; tick++) {
    sim.racers.forEach((r, i) => (lastD[i] = r.progress.lapDistance));
    sim.step(inputs, FIXED_DT);
    sim.racers.forEach((r, i) => {
      if (r.sim.events.respawned) {
        const bucket = Math.round(lastD[i]! / 20) * 20;
        falls.set(bucket, (falls.get(bucket) ?? 0) + 1);
      }
    });
    drafts += sim.events.filter((e) => e.type === 'slipstream').length;
    for (const e of sim.events) if (e.type === 'hit') hits.set(e.source, (hits.get(e.source) ?? 0) + 1);
    for (const r of sim.racers) {
      if (r.sim.events.jumped) jumps++;
      if (r.state.jumpFlight) flight = Math.max(flight, r.state.airTime);
      if (r.sim.events.respawned) respawns++;
      if (r.sim.events.wallHit > 4) walls++;
    }
    if (sim.racers.every((r) => r.progress.finished)) break;
  }
  const finished = sim.racers.filter((r) => r.progress.finished).length;
  const best = Math.min(...sim.racers.map((r) => r.progress.bestLap || 999));
  const voids = smp.filter((x) => x.open).length * path.spacing;
  // Hard courses over the void may claim the odd CPU; easy ones must be clean.
  const allowedFalls = laps * sim.racers.length * (def.difficulty === 'hard' ? 0.6 : def.difficulty === 'medium' ? 0.35 : 0.15) + laps;
  const ok = hazardsOK && jumps >= def.jumps.length * laps && (def.jumps.length === 0 || flight > 0.65) && finished === sim.racers.length && respawns <= allowedFalls;
  if (!ok) bad++;
  console.log(
    `${ok ? '✓' : '✗'} ${def.id.padEnd(16)} ${path.length.toFixed(0).padStart(5)} m  min radius ${minR.toFixed(0).padStart(3)} m  hills ${(Math.max(...s.map((p) => p.position.y)) - Math.min(...s.map((p) => p.position.y))).toFixed(0)}m  obstacles ${def.hazards.length}+${def.movers?.length ?? 0}  best lap ${best.toFixed(1)}s  finished ${finished}/${sim.racers.length}  respawns ${respawns}  wall hits ${walls}  (${((performance.now() - t0) / 1000).toFixed(1)}s)`,
  );
  console.log(`  ${def.difficulty ?? '-'} · void ${voids.toFixed(0)} m · gaps ${def.gaps?.length ?? 0} · streams ${def.streams?.length ?? 0} · shortcuts ${def.shortcuts.length} · crossings ${crossings ? 'yes' : 'no'} · jumps ${def.jumps.length} (launches ${jumps}, longest flight ${flight.toFixed(2)}s) · slipstreams ${drafts}`);
  const cuts = (sim as unknown as { ai: Array<{ shortcutsTaken: number }> }).ai.reduce((a, d) => a + d.shortcutsTaken, 0);
  totals.cuts += cuts;
  if (def.shortcuts.length) console.log(`  shortcuts taken: ${cuts}`);
  if (hits.size) console.log(`  obstacle hits: ${[...hits.entries()].map(([k, n]) => `${k}×${n}`).join(' ')}`);
  if (falls.size) console.log(`  falls at: ${[...falls.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([d, n]) => `${d}m×${n} (${path.frameAtSplineDistance(path.startDistance + d).sample.kind}${path.frameAtSplineDistance(path.startDistance + d).sample.gap ? ' gap' : ''})`).join(', ')}`);
  totals.walls += walls;
  totals.hits += [...hits.values()].reduce((a, b) => a + b, 0);
  totals.falls += respawns;
  totals.tracks++;
  totals.best += best;
  for (const r of sim.racers) if (r.progress.finished) {
    totals.raceTime += r.progress.finishTime;
    totals.finishers++;
  }
  sim.dispose();
  physics.dispose();
}
if (race) console.log(`TOTALS wall hits ${totals.walls} · obstacle hits ${totals.hits} · falls ${totals.falls} · shortcuts taken ${totals.cuts} · mean race ${(totals.raceTime / Math.max(1, totals.finishers)).toFixed(1)}s · mean best lap ${(totals.best / Math.max(1, totals.tracks)).toFixed(1)}s`);
process.exit(bad ? 1 : 0);
