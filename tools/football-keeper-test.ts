/** Physical save / dive snapshot checks: node --import tsx tools/football-keeper-test.ts */
import assert from 'node:assert/strict';
import { BALL_R, MatchSim, PITCH } from '../client/src/football/sim/match';
import { KEEPER_DIVE_TIME, keeperContact, keeperDivePose, keeperGeometry, keeperGrip, keeperHeight, type KeeperShape } from '../client/src/football/sim/keeper';
import { HEAD, PER, lerpFrame, readFrame, writeFrame } from '../client/src/football/sim/snapshot';
import { CPU_LEVELS } from '../client/src/football/sim/difficulty';

// A swept fast shot must hit at the arm's real reach, in either direction and
// at each save height. A ball beyond that reach cannot trigger a phantom save.
for (const end of [-1, 1]) for (const dz of [-1, 1]) for (const dy of [0.04, 0.4, 0.8]) {
  const k: KeeperShape = { x: 0, z: 0, face: end === 1 ? Math.PI : 0, state: 'dive', t: KEEPER_DIVE_TIME - 0.22, dive: { dz, dy } };
  const height = keeperHeight(84), geo = keeperGeometry(k, height), shoulder = geo.shoulders[0];
  const from = { x: shoulder.x - end * 2, y: shoulder.y, z: shoulder.z + dz * 0.25 };
  const to = { ...from, x: shoulder.x + end * 2 };
  const contact = keeperContact(k, height, from, to, BALL_R);
  assert(contact?.hands, 'A fast shot cannot tunnel through the hand reach');
  assert(Math.hypot(contact.point.x - shoulder.x, contact.point.y - shoulder.y, contact.point.z - shoulder.z) <= geo.reach + BALL_R + 1e-8);
  assert.equal(keeperContact(k, height, { ...from, z: 5 }, { ...to, z: 5 }, BALL_R), null, 'Out-of-reach shots stay out of reach');
  const grip = keeperGrip(k, height);
  assert(grip.y >= 0.15 && grip.y < 2.5, 'Caught ball is cradled in front of the diving chest');
  assert.deepEqual(keeperDivePose(k.t, dz, dy, k.face, height), keeperDivePose(k.t, dz, dy, k.face, height), 'Dive pose is sampled from snapshot time');
}

function shot(end: -1 | 1, z: number, y: number, seed: number, difficulty: typeof CPU_LEVELS[number] = 'amateur', speed = 24) {
  const m = new MatchSim({ home: 'nbu', away: 'val', halfSeconds: 900, difficulty, seed });
  m.dir = [end, -end] as [1 | -1, 1 | -1]; m.phase = 'play'; m.restart = null;
  for (const p of m.players) p.state = 'off';
  const gk = m.gkOf(1);
  Object.assign(gk, { state: 'run', x: end * (PITCH.HL - 1.5), z: 0, face: end === 1 ? Math.PI : 0 });
  Object.assign(m.ball, { x: end * (PITCH.HL - 6), y, z, vx: end * speed, vy: y === BALL_R ? 0 : 1.5, vz: 0,
    wx: 0, wy: 0, wz: 0, owner: -1, lastTeam: 0, lastPlayer: 9, kickType: 'shot', kickId: 2 });
  let result = '';
  for (let i = 0; i < 120; i++) {
    m.step(new Map());
    const event = m.events.find(e => e.k === 'save' || e.k === 'goal');
    m.events.length = 0;
    assert([m.ball.x, m.ball.y, m.ball.z, gk.x, gk.z].every(Number.isFinite));
    if (event) { result = event.k; break; }
  }
  return { m, gk, result };
}

// The old random miss decision must never veto a shot reaching the keeper.
let saves = 0, goals = 0, catches = 0;
for (const end of [-1, 1] as const) for (const difficulty of CPU_LEVELS) for (let seed = 1; seed <= 12; seed++) {
  for (const y of [BALL_R, 1.1, 2.2]) {
    const { result } = shot(end, 0, y, seed, difficulty);
    assert.equal(result, 'save', `${difficulty}/${end}/${y}: direct reachable shots must save`); saves++;
  }
  const far = shot(end, 4, 1.1, seed, difficulty);
  assert.equal(far.result, 'goal', 'A close shot in the far corner can beat a keeper who cannot reach it'); goals++;
}
for (const end of [-1, 1] as const) for (let seed = 1; seed <= 20; seed++) {
  const { m, gk, result } = shot(end, 1.1, 1.1, seed, 'pro', 16);
  assert.equal(result, 'save');
  if (m.ball.owner !== gk.i || gk.state !== 'dive') continue;
  catches++;
  const remaining = gk.t;
  assert(remaining < KEEPER_DIVE_TIME && remaining > 0, 'A catch preserves the ongoing dive phase');
  for (let tick = 0; tick < Math.ceil(remaining * 60) + 2; tick++) {
    m.step(new Map());
    if (gk.state === 'dive') {
      const grip = keeperGrip(gk, keeperHeight(gk.def.stats.phy));
      assert(Math.hypot(m.ball.x - grip.x, m.ball.y - grip.y, m.ball.z - grip.z) < 1e-8, 'The held ball stays in the gloves throughout landing');
    }
  }
  assert.equal(gk.state, 'hold', 'The keeper gathers the ball after landing');
}
assert(catches > 0, 'Exercise a caught dive, not just parries');

// Compact live/online/replay frames preserve fractional dive direction and
// height, keep skill flags intact, and still decode saved legacy replays.
const m = new MatchSim({ home: 'nbu', away: 'val', halfSeconds: 900, difficulty: 'amateur' });
const k = m.gkOf(1); k.state = 'dive'; k.t = 0.73;
for (const dz of [-1, -.55, 0, .42, 1]) for (const dy of [0, .2, .6, 1]) {
  k.dive = { dz, dy };
  const f = readFrame(writeFrame(m)).players[k.i]!;
  assert(Math.abs(f.diveZ - dz) < .017 && Math.abs(f.diveY - dy) < .017);
  assert(Math.abs(f.t - k.t) < 1e-6);
  assert.equal(f.trick, 0);
}
const old = writeFrame(m), offset = HEAD + k.i * PER;
const before = readFrame(old); k.t -= 1 / 30;
const after = readFrame(writeFrame(m)), between = lerpFrame(before, after, .5);
assert(Math.abs(between.players[k.i]!.t - (before.players[k.i]!.t + after.players[k.i]!.t) / 2) < 1e-8, 'Slow-motion dives interpolate their physical pose smoothly');
old[offset + 6] = 0; old[offset + 9] = -10 + .5 * 4;
const legacy = readFrame(old).players[k.i]!;
assert.equal(legacy.diveZ, -1);
assert(Math.abs(legacy.diveY - (1.25 + .5 * 1.3) / 2.8) < 1e-6);
console.log(`Keeper checks passed: ${saves} reachable saves, ${goals} out-of-reach goals, ${catches} caught dives; fast swept contact, held ball and old/new replay frames.`);
