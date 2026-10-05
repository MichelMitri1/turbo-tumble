/**
 * Headless handling test: runs the shared kart simulation against the real track
 * colliders in Node (no browser) with a simple line-following autopilot.
 * Verifies a lap completes and reports handling metrics.
 *
 *   npx tsx tools/sim-lap.ts [trackId] [laps]
 */
import { Vector3 } from 'three';
import { initPhysics, PhysicsWorld } from '../shared/src/physics/PhysicsWorld';
import { getTrack } from '../shared/src/tracks/registry';
import { TrackPath } from '../shared/src/track/TrackPath';
import { TerrainField } from '../shared/src/track/TerrainField';
import { buildTrackColliders } from '../shared/src/track/TrackColliders';
import { spawnSlot } from '../shared/src/track/spawnGrid';
import { createKartState } from '../shared/src/vehicles/KartState';
import { KartSimulation } from '../shared/src/vehicles/KartSimulation';
import { BASE_KART_STATS } from '../shared/src/vehicles/KartStats';
import { createEmptyInput } from '../shared/src/types/input';
import { FIXED_DT, TICK_RATE } from '../shared/src/constants/simulation';
import { SurfaceType } from '../shared/src/types/surface';

await initPhysics();
const def = getTrack(process.argv[2] ?? 'sunny-circuit');
const laps = Number(process.argv[3] ?? 2);
const path = new TrackPath(def);
const terrain = new TerrainField(path, def.terrain);
const physics = new PhysicsWorld();
const t0 = performance.now();
buildTrackColliders(physics, path, terrain.buildMesh());
console.log(`track "${def.name}" length ${path.length.toFixed(0)} m, colliders built in ${(performance.now() - t0).toFixed(0)} ms`);

const state = createKartState();
const sim = new KartSimulation(state, { ...BASE_KART_STATS }, physics, path);
const spawn = spawnSlot(path, 0);
sim.placeAt(spawn.position, spawn.forward);
const input = createEmptyInput();

// --- Straight-line metrics on the start straight.
const tmp = new Vector3();
let t90 = -1;
for (let tick = 0; tick < TICK_RATE * 6; tick++) {
  input.throttle = 1;
  sim.step(input, FIXED_DT);
  if (t90 < 0 && state.forwardSpeed >= BASE_KART_STATS.maxSpeed * 0.9) t90 = tick / TICK_RATE;
  if (tick === 60) console.log(`speed after 1.0s: ${(state.forwardSpeed * 3.6).toFixed(0)} km/h`);
}
console.log(`0 → 90% top speed: ${t90.toFixed(2)} s   (top ${(BASE_KART_STATS.maxSpeed * 3.6).toFixed(0)} km/h)`);

// --- Autopilot laps.
sim.placeAt(spawn.position, spawn.forward);
const lapTimes: number[] = [];
let lastLap = path.lapDistance(path.locate(state.position).splineDistance);
let lapStart = 0;
let wallHits = 0;
let offroadTicks = 0;
let airTicks = 0;
let respawns = 0;
let maxSpeed = 0;
let maxAir = 0;
let air = 0;
const right = new Vector3();
const maxTicks = TICK_RATE * 60 * laps;
let tick = 0;
for (; tick < maxTicks && lapTimes.length < laps; tick++) {
  const loc = path.locate(state.position, state.trackIndex, 30);
  const look = 9 + Math.abs(state.forwardSpeed) * 0.55;
  const target = path.frameAtSplineDistance(loc.splineDistance + look).position;
  const to = tmp.copy(target).sub(state.position).setY(0).normalize();
  right.crossVectors(state.forward, state.up).normalize();
  const angle = Math.atan2(to.dot(right), to.dot(state.forward));
  input.steer = Math.max(-1, Math.min(1, angle * 2.4));
  input.throttle = Math.abs(angle) > 0.5 && state.forwardSpeed > 18 ? 0 : 1;
  input.brake = 0;
  sim.step(input, FIXED_DT);

  const ev = sim.events;
  if (ev.wallHit > 2) wallHits++;
  if (ev.respawned) respawns++;
  if (state.grounded && state.surface === SurfaceType.Offroad) offroadTicks++;
  if (!state.grounded) {
    airTicks++;
    air++;
    maxAir = Math.max(maxAir, air);
  } else air = 0;
  maxSpeed = Math.max(maxSpeed, state.forwardSpeed);

  const lap = path.lapDistance(path.locate(state.position, state.trackIndex, 30).splineDistance);
  if (lastLap > path.length - 60 && lap < 60) {
    lapTimes.push((tick - lapStart) / TICK_RATE);
    lapStart = tick;
  }
  lastLap = lap;
}

const ok = lapTimes.length >= laps;
console.log(
  [
    `laps completed: ${lapTimes.length}/${laps}  ${lapTimes.map((t) => t.toFixed(2) + 's').join('  ')}`,
    `max speed ${(maxSpeed * 3.6).toFixed(0)} km/h, wall hits ${wallHits}, respawns ${respawns}`,
    `offroad ${(offroadTicks / TICK_RATE).toFixed(1)} s, airborne ${(airTicks / TICK_RATE).toFixed(1)} s (longest ${(maxAir / TICK_RATE).toFixed(2)} s)`,
    `sim cost: ${((performance.now() - t0) / tick).toFixed(3)} ms/tick incl. setup`,
  ].join('\n'),
);
process.exit(ok ? 0 : 1);
