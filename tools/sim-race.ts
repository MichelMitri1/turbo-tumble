/**
 * Headless full race: N CPU racers with items on the real track colliders.
 * Reports finishing order, item usage, hits and anomalies.
 *
 *   npx tsx tools/sim-race.ts [racers=8] [laps=3] [--cycle-items] [--seed=N] [--cpu=easy|normal|hard] [--no-items]
 */
import { initPhysics, PhysicsWorld } from '../shared/src/physics/PhysicsWorld';
import { getTrack } from '../shared/src/tracks/registry';
import { TrackPath } from '../shared/src/track/TrackPath';
import { TerrainField } from '../shared/src/track/TerrainField';
import { buildTrackColliders } from '../shared/src/track/TrackColliders';
import { RaceSimulation } from '../shared/src/race/RaceSimulation';
import { BASE_KART_STATS } from '../shared/src/vehicles/KartStats';
import { ALL_ITEMS, type ItemId } from '../shared/src/items/ItemTypes';
import { FIXED_DT, TICK_RATE } from '../shared/src/constants/simulation';
import type { Difficulty } from '../shared/src/ai/AIDifficulty';

const args = process.argv.slice(2);
const nums = args.filter((a) => !a.startsWith('--')).map(Number);
const count = nums[0] ?? 8;
const laps = nums[1] ?? 3;
const cycle = args.includes('--cycle-items');
const seed = Number(args.find((a) => a.startsWith('--seed='))?.split('=')[1] ?? 7);
const difficulty = (args.find((a) => a.startsWith('--cpu='))?.split('=')[1] ?? 'normal') as Difficulty;
const noItems = args.includes('--no-items');

await initPhysics();
const def = getTrack('sunny-circuit');
const track = new TrackPath(def);
const terrain = new TerrainField(track, def.terrain);
const physics = new PhysicsWorld();
buildTrackColliders(physics, track, terrain.buildMesh(), terrain);

const race = new RaceSimulation(
  {
    laps,
    checkpoints: def.checkpointCount,
    itemsEnabled: !noItems,
    difficulty,
    catchUp: false,
    seed,
    countdown: 4,
    racers: Array.from({ length: count }, (_, i) => ({ id: `cpu${i}`, name: `CPU ${i + 1}`, characterId: 'bix', kartId: 'comet', isAI: true, stats: { ...BASE_KART_STATS } })),
  },
  physics,
  track,
);

// Force every item into rotation so each one is exercised.
let cycleIndex = 0;
if (cycle) {
  const grant = race.items.grantRoll.bind(race.items);
  race.items.grantRoll = (r) => {
    const ok = grant(r);
    if (ok) r.slot.pending = ALL_ITEMS[cycleIndex++ % ALL_ITEMS.length] as ItemId;
    return ok;
  };
}

const used = new Map<string, number>();
const hits = new Map<string, number>();
const rolled = new Map<string, number>();
const tally = (m: Map<string, number>, k: string): void => void m.set(k, (m.get(k) ?? 0) + 1);
let boxes = 0;
let coins = 0;
let pads = 0;
let bumps = 0;
let blocked = 0;
let explosions = 0;
let respawns = 0;
let miniTurbos = 0;
let nan = 0;
const per = race.racers.map(() => ({ wall: 0, offroad: 0, drift: 0, slow: 0 }));
const inputs = race.racers.map(() => null);
const t0 = performance.now();
const maxTicks = TICK_RATE * (60 * laps + 120);
let tick = 0;
for (; tick < maxTicks; tick++) {
  race.step(inputs, FIXED_DT);
  for (const e of race.events) {
    if (e.type === 'itemUse') tally(used, e.item);
    if (e.type === 'itemReady') tally(rolled, e.item);
    if (e.type === 'hit') tally(hits, `${e.source}:${e.kind}`);
    if (e.type === 'itemBox') boxes++;
    if (e.type === 'coin') coins++;
    if (e.type === 'boostPad') pads++;
    if (e.type === 'bump') bumps++;
    if (e.type === 'blocked') blocked++;
    if (e.type === 'explosion') explosions++;
  }
  for (const r of race.racers) {
    const d = per[r.index]!;
    if (r.sim.events.wallHit > 2) d.wall++;
    if (r.state.surface === 2 && r.state.grounded) d.offroad += FIXED_DT;
    if (r.state.drifting) d.drift += FIXED_DT;
    if (r.state.forwardSpeed < 15 && race.time > 3) d.slow += FIXED_DT;
    if (r.sim.events.respawned) respawns++;
    if (r.sim.events.miniTurbo) miniTurbos++;
    if (!Number.isFinite(r.state.position.x + r.state.position.y + r.state.position.z)) nan++;
  }
  if (race.racers.every((r) => r.progress.finished)) break;
}
const ms = performance.now() - t0;
console.log(`race (${difficulty} CPUs${noItems ? ', no items' : ''}): ${count} racers, ${laps} laps, ${(tick / TICK_RATE).toFixed(1)} s simulated in ${(ms / 1000).toFixed(2)} s (${(ms / tick).toFixed(3)} ms/tick)`);
for (const r of race.standings()) {
  const p = r.progress;
  const d = per[r.index]!;
  console.log(`  ${String(p.position).padStart(2)}. ${r.name.padEnd(7)} ${p.finished ? p.finishTime.toFixed(2) + 's' : `lap ${p.lap} (${p.lapDistance.toFixed(0)} m)`}  best ${p.bestLap.toFixed(2)}  coins ${r.state.coins}  walls ${d.wall} offroad ${d.offroad.toFixed(1)}s drift ${d.drift.toFixed(1)}s slow ${d.slow.toFixed(1)}s`);
}
console.log(`item boxes ${boxes}, coins ${coins}, pads ${pads}, bumps ${bumps}, blocks ${blocked}, explosions ${explosions}, mini-turbos ${miniTurbos}, respawns ${respawns}, NaN ${nan}`);
console.log('items used:', [...used.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join(' '));
console.log('items rolled:', [...rolled.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join(' '));
console.log('hits:', [...hits.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join(' '));
const missing = ALL_ITEMS.filter((i) => !used.has(i) && !['puck3', 'seeker3', 'goo3'].includes(i));
if (cycle) console.log('items never used:', missing.length ? missing.join(', ') : 'none');
process.exit(nan || !race.racers.every((r) => r.progress.finished) ? 1 : 0);
