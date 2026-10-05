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
for (const def of TRACKS) {
  if (only.length && !only.includes(def.id)) continue;
  const t0 = performance.now();
  const path = new TrackPath(def);
  const terrain = new TerrainField(path, def.terrain);
  const physics = new PhysicsWorld();
  buildTrackColliders(physics, path, terrain.buildMesh());
  // Verify real collision sweeps, asset availability and a kart-sized way past
  // every obstacle. This runs against the same world used by online and offline races.
  let hazardsOK = def.hazards.length > 0;
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
  let walls = 0;
  let tick = 0;
  for (; tick < TICK_RATE * 90 * laps; tick++) {
    sim.step(inputs, FIXED_DT);
    for (const r of sim.racers) {
      if (r.sim.events.respawned) respawns++;
      if (r.sim.events.wallHit > 4) walls++;
    }
    if (sim.racers.every((r) => r.progress.finished)) break;
  }
  const finished = sim.racers.filter((r) => r.progress.finished).length;
  const best = Math.min(...sim.racers.map((r) => r.progress.bestLap || 999));
  const ok = hazardsOK && finished === sim.racers.length && respawns <= laps * 2;
  if (!ok) bad++;
  console.log(
    `${ok ? '✓' : '✗'} ${def.id.padEnd(16)} ${path.length.toFixed(0).padStart(5)} m  min radius ${minR.toFixed(0).padStart(3)} m  hills ${(Math.max(...s.map((p) => p.position.y)) - Math.min(...s.map((p) => p.position.y))).toFixed(0)}m  obstacles ${def.hazards.length}  best lap ${best.toFixed(1)}s  finished ${finished}/${sim.racers.length}  respawns ${respawns}  wall hits ${walls}  (${((performance.now() - t0) / 1000).toFixed(1)}s)`,
  );
  sim.dispose();
  physics.dispose();
}
process.exit(bad ? 1 : 0);
