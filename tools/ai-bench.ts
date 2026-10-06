/**
 * CPU driving benchmark: one CPU, no items, 2 laps on every track (or the ones
 * named). Reports lap time, offroad / slow time, wall hits and respawns, plus a
 * total — the number to beat when tuning AIDifficulty.
 *
 *   npx tsx tools/ai-bench.ts [easy|normal|hard] [trackId…]
 *   P='{"cornerPace":1.5}' npx tsx tools/ai-bench.ts hard     (try profile overrides)
 */
import { initPhysics, PhysicsWorld } from '../shared/src/physics/PhysicsWorld';
import { getTrack, TRACKS } from '../shared/src/tracks/registry';
import { TrackPath } from '../shared/src/track/TrackPath';
import { TerrainField } from '../shared/src/track/TerrainField';
import { buildTrackColliders } from '../shared/src/track/TrackColliders';
import { RaceSimulation } from '../shared/src/race/RaceSimulation';
import { BASE_KART_STATS } from '../shared/src/vehicles/KartStats';
import { FIXED_DT, TICK_RATE } from '../shared/src/constants/simulation';
import { DIFFICULTY, type Difficulty } from '../shared/src/ai/AIDifficulty';
await initPhysics();
const args = process.argv.slice(2);
const diff = (args[0] ?? 'hard') as Difficulty;
if (process.env.P) Object.assign(DIFFICULTY[diff], JSON.parse(process.env.P));
const ids = args.slice(1).length ? args.slice(1) : TRACKS.map((t) => t.id);
const verbose = ids.length === 1;
let sum = 0, W = 0, R = 0, O = 0, M = 0;
for (const id of ids) {
  const def = getTrack(id);
  const track = new TrackPath(def);
  const terrain = new TerrainField(track, def.terrain);
  const physics = new PhysicsWorld();
  buildTrackColliders(physics, track, terrain.buildMesh(), terrain);
  const race = new RaceSimulation({ laps: 2, checkpoints: def.checkpointCount, itemsEnabled: false, difficulty: diff, catchUp: false, seed: 3, countdown: 4,
    racers: [{ id: 'c', name: 'c', characterId: 'bix', kartId: 'comet', isAI: true, stats: { ...BASE_KART_STATS } }] }, physics, track);
  const r = race.racers[0]!;
  const off = new Map<number, number>(); const slow = new Map<number, number>();
  let offT = 0, slowT = 0, walls = 0, resp = 0;
  for (let t = 0; t < TICK_RATE * 400 && !r.progress.finished; t++) {
    race.step([null], FIXED_DT);
    if (race.time < 3) continue;
    const b = Math.floor(track.locate(r.state.position, r.state.trackIndex, 8).splineDistance / 25) * 25;
    if (r.state.surface === 2 && r.state.grounded) { offT += FIXED_DT; off.set(b, (off.get(b) ?? 0) + FIXED_DT); }
    if (r.state.forwardSpeed < 18) { slowT += FIXED_DT; slow.set(b, (slow.get(b) ?? 0) + FIXED_DT); }
    if (r.sim.events.wallHit > 2) walls++;
    if (r.sim.events.respawned) resp++;
    if (r.sim.events.miniTurbo) M++;
  }
  const lap = r.progress.finished ? r.progress.finishTime / 2 : NaN;
  sum += lap; W += walls; R += resp; O += offT;
  console.log(`${id.padEnd(22)} lap ${lap.toFixed(1)}s  best ${r.progress.bestLap.toFixed(1)}  offroad ${offT.toFixed(1)}s slow ${slowT.toFixed(1)}s walls ${walls} respawns ${resp}`);
  if (verbose) {
    console.log(' offroad @', [...off].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}m:${v.toFixed(1)}`).join(' '));
    console.log(' slow @', [...slow].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}m:${v.toFixed(1)}`).join(' '));
  }
}
console.log('sum of laps', sum.toFixed(1), 'walls', W, 'respawns', R, 'offroad', O.toFixed(0), 'miniTurbos', M);
