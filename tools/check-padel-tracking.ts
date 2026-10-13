import assert from 'node:assert/strict';
import { ArmTracker, type PoseIn, type HandIn } from '../client/src/padel/camera/armtrack';

// A visible player with a raised right arm and a known palm frame.
const pose: PoseIn = { image: new Float32Array(33 * 4), world: new Float32Array(33 * 4) };
for (const [i, x, y] of [[11, .6, .3], [12, .4, .3], [14, .35, .4], [16, .3, .5], [23, .58, .7], [24, .42, .7]]) {
  pose.image.set([x!, y!, 0, 1], i! * 4);
  pose.world.set([x!, y!, 0, 1], i! * 4);
}
function hand(flipped = false): HandIn {
  const h = { image: new Float32Array(63), world: new Float32Array(63) };
  h.world.set([0, -.06, 0], 9 * 3);
  h.world.set([flipped ? .03 : -.03, -.05, 0], 5 * 3);
  h.world.set([flipped ? -.03 : .03, -.05, 0], 17 * 3);
  return h;
}
const tracker = new ArmTracker();
tracker.cal = { dir: [0, 1, 0], normal: [0, 0, 1] };
let t = 1;
let arrival = performance.now();
const feed = (h: HandIn | null) => { t += 1 / 30; arrival += 1000 / 30; tracker.feed(t, arrival, 1, pose, h); };
const arm = () => tracker.predict(arrival)!;
feed(hand());
const initial = arm();
assert(initial);
assert(tracker.handSeen);
feed(hand(true));
assert.deepEqual(arm().normal, initial.normal, 'One isolated 180-degree palm flip must be rejected');
feed(hand());
for (let i = 0; i < 5; i++) feed(null);
assert.deepEqual(arm().dir, initial.dir, 'Occlusion must retain the calibrated shaft');
assert.deepEqual(arm().normal, initial.normal, 'Occlusion must retain the calibrated face');
assert.equal(tracker.handSeen, false);
feed({ image: new Float32Array(63), world: new Float32Array(63) });
assert.equal(tracker.handSeen, false, 'Collapsed palm axes must not count as a visible hand');
assert.deepEqual(arm().normal, initial.normal);
feed(hand(true)); feed(hand(true));
const rotated = arm();
for (const v of [rotated.dir, rotated.normal]) assert(Math.abs(Math.hypot(...v) - 1) < 1e-6);
assert(Math.abs(rotated.dir.reduce((sum, v, i) => sum + v * rotated.normal[i]!, 0)) < 1e-6);
const predicted = tracker.predict(arrival + 80)!;
assert.deepEqual(predicted.normal, rotated.normal, 'Display prediction must not extrapolate noisy wrist angles');
const saved = arm();
tracker.feed(t, arrival + 10, 1, pose, hand());
assert.deepEqual(arm(), saved, 'Duplicate camera timestamps must not create velocities');
tracker.reset();
feed(hand());
assert.deepEqual(arm().vel, [0, 0, 0], 'Reacquiring after reset must not inherit old swing velocity');
const broken = { image: pose.image.slice(), world: pose.world.slice() };
broken.world[16 * 4] = NaN;
tracker.feed(t + 1 / 30, arrival + 1000 / 30, 1, broken, hand());
assert.equal(tracker.handSeen, false, 'Invalid pose data must invalidate current hand status');
assert.deepEqual(tracker.predict(arrival + 40)!.vel, [0, 0, 0]);

// Advance the sample clock while preserving actual timer behavior, so calibration tests stay fast.
const originalNow = performance.now.bind(performance);
let clock = 10000;
Object.defineProperty(performance, 'now', { configurable: true, value: () => clock });
async function calibration(moving: boolean): Promise<boolean> {
  const tr = new ArmTracker();
  const result = new Promise<boolean>(resolve => tr.calibrate(resolve));
  for (let i = 0; i < 50; i++) {
    clock += 33;
    tr.feed(i / 30 + 1, clock, 1, pose, hand(moving && i % 2 === 0));
  }
  const success = await result;
  if (success) assert(tr.cal);
  return success;
}
assert.equal(await calibration(false), true, 'A steady visible hand should calibrate');
assert.equal(await calibration(true), false, 'Unstable palm orientation must not calibrate');
const cancelled = new ArmTracker();
const cancelResult = new Promise<boolean>(resolve => cancelled.calibrate(resolve));
cancelled.reset();
assert.equal(await cancelResult, false, 'Stopping tracking must finish calibration as a failure');
Object.defineProperty(performance, 'now', { configurable: true, value: originalNow });
console.log('Padel tracking checks passed: flips, occlusion, rigid rotation, timestamps, reacquisition, invalid data, and calibration.');
