/** Regression checks for drafting rules and airborne state replication. */
import assert from 'node:assert/strict';
import { initPhysics, PhysicsWorld } from '../shared/src/physics/PhysicsWorld';
import { TrackPath } from '../shared/src/track/TrackPath';
import { getTrack } from '../shared/src/tracks/registry';
import { RaceSimulation } from '../shared/src/race/RaceSimulation';
import { cpuField } from '../shared/src/roster/Roster';
import { stepSlipstream } from '../shared/src/race/Slipstream';
import { FIXED_DT } from '../shared/src/constants/simulation';
import { createKartState } from '../shared/src/vehicles/KartState';
import { KART_FULL, KART_REMOTE, readFields, writeFields } from '../shared/src/net/StateCodec';
import { ByteReader, ByteWriter } from '../shared/src/net/ByteBuffer';
import { TerrainField } from '../shared/src/track/TerrainField';
import { buildTrackColliders } from '../shared/src/track/TrackColliders';
import { createEmptyInput } from '../shared/src/types/input';
import { AIDriver, personalityFor } from '../shared/src/ai/AIDriver';
import { DIFFICULTY } from '../shared/src/ai/AIDifficulty';
import { SeededRandom } from '../shared/src/math/random';

await initPhysics();
const physics = new PhysicsWorld();
const track = new TrackPath(getTrack('sunny-circuit'));
const race = new RaceSimulation({ laps: 1, checkpoints: 16, itemsEnabled: false, difficulty: 'normal', catchUp: false, seed: 1, countdown: 0, racers: cpuField(2) }, physics, track);
const [me, lead] = race.racers;
assert(me && lead);
function reset(): void {
  for (const [i, racer] of race.racers.entries()) {
    Object.assign(racer.state, createKartState());
    const f = track.frameAtSplineDistance(track.startDistance + 30 + i * 12);
    racer.state.position.copy(f.position);
    racer.state.forward.copy(f.tangent);
    racer.state.trackIndex = f.sample.index;
    racer.state.forwardSpeed = 25;
    racer.state.grounded = true;
  }
}
const tick = (n: number): number => {
  let boosts = 0;
  for (let i = 0; i < n; i++) if (stepSlipstream(me!, race.racers, track, FIXED_DT)) boosts++;
  return boosts;
};
reset();
assert.equal(tick(60), 0, 'drafting must charge first');
assert(me.state.slipstreamCharge > 0.9);
assert.equal(tick(15), 1, 'a sustained draft grants one boost');
assert(me.state.boostTimer > 1.9 && me.state.slipstreamTimer > 1.9);
assert.equal(tick(120), 0, 'cooldown prevents continual boosts');
for (const [name, change] of [
  ['side by side', () => lead.state.position.copy(me.state.position).addScaledVector(track.anchorToWorld({ distance: 30 }).right, 8)],
  ['too far', () => lead.state.position.addScaledVector(lead.state.forward, 45)],
  ['opposite direction', () => lead.state.forward.negate()],
  ['different elevation', () => { lead.state.position.y += 8; }],
  ['airborne', () => { me.state.grounded = false; }],
  ['stunned', () => { me.state.spinTimer = 1; }],
  ['respawning', () => { me.state.respawnTimer = 1; }],
  ['parallel section', () => { lead.state.trackIndex = track.wrapIndex(me.state.trackIndex + 100); }],
] as const) {
  reset(); change();
  assert.equal(tick(100), 0, name);
  assert.equal(me.state.slipstreamCharge, 0, name);
}
reset(); tick(45); lead.state.position.y += 8; tick(30);
assert.equal(me.state.slipstreamCharge, 0, 'leaving the wake drains charge');

// Non-zero airborne/drafting fields must survive snapshots, not just defaults.
me.state.jumpFlight = me.state.jumpTrick = true;
me.state.jumpCooldown = 1.1;
me.state.slipstreamCharge = 0.75;
me.state.slipstreamTimer = 1.5;
me.state.slipstreamCooldown = 2.2;
for (const layout of [KART_FULL, KART_REMOTE]) {
  const writer = new ByteWriter();
  writeFields(writer, me.state, layout);
  const copy = readFields(new ByteReader(writer.toBytes()), createKartState(), layout);
  assert(copy.jumpFlight && copy.jumpTrick);
  assert(Math.abs(copy.slipstreamCharge - 0.75) < 0.001);
  assert(Math.abs(copy.slipstreamTimer - 1.5) < 0.001);
}
buildTrackColliders(physics, track, new TerrainField(track, track.def.terrain).buildMesh());
const jump = track.def.jumps[0]!;
const approach = track.anchorToWorld({ distance: jump.distance - 35 });
me.sim.placeAt(approach.position, approach.tangent);
me.state.velocity.copy(approach.tangent).multiplyScalar(32);
me.state.forwardSpeed = 32;
const driver = new AIDriver(1, personalityFor(DIFFICULTY.hard, new SeededRandom(1)));
const input = createEmptyInput();
let launched = false;
let landed = false;
let trickBoost = false;
let airTime = 0;
for (let i = 0; i < 360 && !landed; i++) {
  driver.drive(race, me, input, FIXED_DT);
  me.sim.step(input, FIXED_DT);
  if (me.state.grounded && race.pickups.onPad(me.state.position)) me.sim.giveBoost(1, 9);
  launched ||= me.sim.events.jumped;
  if (me.state.jumpFlight) airTime = Math.max(airTime, me.state.airTime);
  if (launched && me.sim.events.landed > 0) {
    landed = true;
    trickBoost = me.sim.events.miniTurbo === 1 && me.state.boostTimer > 1;
  }
}
assert(launched && landed && airTime > 0.65, 'boost approach must produce a real flight and landing');
assert(trickBoost, 'airborne trick awards a landing turbo');
// A kart above the lip must not be launched again merely for flying over it.
const above = track.anchorToWorld({ distance: jump.distance + jump.length - 1, height: 18 });
me.sim.placeAt(above.position, above.tangent);
me.state.position.copy(above.position);
me.state.grounded = false;
me.state.airTime = 0.8;
me.state.velocity.copy(above.tangent).multiplyScalar(30);
me.state.forwardSpeed = 30;
me.sim.step(createEmptyInput(), FIXED_DT);
assert.equal(me.sim.events.jumped, false, 'flying over a ramp is not a lip crossing');
race.dispose(); physics.dispose();
console.log('✓ Slipstream charging, cooldown, exclusions, charge loss, snapshots, ramp flight, trick landing and flyover exclusion');
