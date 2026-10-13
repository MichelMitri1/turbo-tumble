import assert from 'node:assert/strict';
import { deformNet, type NetImpact } from '../client/src/football/render/net';
import { BALL_R, GOAL_NET, MatchSim, PITCH } from '../client/src/football/sim/match';
import { cushionNet, netPockets } from '../client/src/football/sim/net';
import { MatchRecording, replayFrame } from '../client/src/football/replay';
import { CLUB, kitsFor } from '../client/src/football/sim/data';
import { writeFrame } from '../client/src/football/sim/snapshot';

// A fixed edge, impact point and more distant free cord on the rear panel.
const base = new Float32Array([2.6, 2.44, 4.4, 2.6, 1.2, 0, 2.6, 1.2, 2]);
const out = new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0]);
const pin = new Float32Array([0, 1, 0.8]);
const atRest = new Float32Array(9), hit = new Float32Array(9), later = new Float32Array(9);
const impacts: NetImpact[] = [{ time: 2, x: 2.6, y: 1.2, z: 0, strength: 1 }];
deformNet(base, out, pin, atRest, [], 2);
deformNet(base, out, pin, hit, impacts, 2.16);
assert.deepEqual([...hit.slice(0, 3)], [...base.slice(0, 3)], 'Frame attachments stay fixed');
assert(hit[3]! - atRest[3]! > 0.5, 'The ball pushes a visible soft pocket into the net');
assert(hit[3]! - atRest[3]! > hit[6]! - atRest[6]!, 'Impact is localized');
deformNet(base, out, pin, later, impacts, 2.8);
assert.notDeepEqual(hit, later, 'Cloth moves and ripples after impact');
assert([...later].every(Number.isFinite));
const reverse = new Float32Array(9);
deformNet(base, out, pin, reverse, impacts, 2.16);
assert.deepEqual(hit, reverse, 'Reverse seeking recreates the identical net shape');
deformNet(base, out, pin, later, impacts, 8);
assert.deepEqual(atRest, later, 'The net settles back to its resting shape');

assert.equal(PITCH.GOAL_HW * 2, 8.8);
for (const z of [4, 4.8]) {
  const m = new MatchSim({ home: 'nbu', away: 'val', halfSeconds: 180, difficulty: 'amateur' });
  m.phase = 'play'; m.restart = null; m.players.forEach((p) => p.state = 'off');
  Object.assign(m.ball, { x: PITCH.HL - 0.5, y: 0.7, z, vx: 18, vy: 0, vz: 0, owner: -1, lastTeam: 0, lastPlayer: 9 });
  for (let i = 0; i < 8; i++) m.step(new Map());
  assert.equal(m.score[0], z === 4 ? 1 : 0, 'Scoring uses the wider opening and rejects shots outside it');
}

// Low, middle and high shots at both ends must stretch the rear cloth and settle
// inside the goal. A goal-line crossing must not start a premature net ripple.
for (const end of [-1, 1]) for (const y of [BALL_R, 1.2, 2.15]) for (const speed of [18, 30, 42]) {
  const m = new MatchSim({ home: 'nbu', away: 'val', halfSeconds: 180, difficulty: 'amateur' });
  m.phase = 'play'; m.restart = null; m.players.forEach((p) => p.state = 'off');
  Object.assign(m.ball, { x: end * (PITCH.HL - 0.5), y, z: 0, vx: end * speed, vy: 0, vz: 0,
    wx: 0, wy: 0, wz: 0, owner: -1, lastTeam: end === 1 ? 0 : 1, lastPlayer: end === 1 ? 9 : 20 });
  const recording = new MatchRecording('nbu', 'val', kitsFor(CLUB.nbu!, CLUB.val!), m.players.map((p) => p.def));
  let maxStretch = 0, goalTime = -1, netTime = -1;
  for (let i = 0; i < 240; i++) {
    m.step(new Map());
    const events = m.events.splice(0);
    recording.record(writeFrame(m)); recording.events(events, m.time);
    if (events.some((e) => e.k === 'goal')) goalTime = m.time;
    const impact = events.find((e) => e.k === 'net');
    if (impact?.k === 'net' && netTime < 0) {
      netTime = impact.time;
      assert(end * m.ball.vx >= 0, 'The first cloth contact cushions the ball instead of instantly reversing it');
    }
    maxStretch = Math.max(maxStretch, end * m.ball.x - PITCH.HL + BALL_R - PITCH.GOAL_D);
    assert([m.ball.x, m.ball.y, m.ball.z, m.ball.vx, m.ball.vy, m.ball.vz].every(Number.isFinite));
  }
  assert(maxStretch > 0.15 && maxStretch <= 0.91, `Shot ${end}/${y}/${speed} must form a bounded cloth pocket`);
  assert(netTime > goalTime, 'The rear net reacts at contact, after the ball crosses the goal line');
  assert(end * m.ball.x > PITCH.HL + PITCH.GOAL_D - 0.5, 'The caught ball settles in the back of the goal');
  assert(Math.hypot(m.ball.vx, m.ball.vy, m.ball.vz) < 0.1, 'Net damping absorbs shot energy');
  assert.equal(m.ball.y, BALL_R, 'The ball drops naturally to the grass');
  const marker = recording.data.events.find((e) => e.net)!;
  assert.equal(marker.time, netTime);
  assert(!recording.data.events.find((e) => e.label === 'Goal')!.net, 'Replay net effects are actual contacts');
  assert(replayFrame(recording.data, netTime + 0.1)!.ball.x * end > PITCH.HL + PITCH.GOAL_D - BALL_R);
}

// Angled shots cannot escape the side or roof net while it gives under impact.
for (const b of [
  { x: 1.4, y: 1.1, z: PITCH.GOAL_HW - 0.06, vx: 12, vy: 0, vz: 20 },
  { x: 1.4, y: 1.1, z: -PITCH.GOAL_HW + 0.06, vx: 12, vy: 0, vz: -20 },
  { x: 1.4, y: PITCH.GOAL_H - 0.06, z: 0, vx: 12, vy: 14, vz: 0 },
]) {
  const start = { ...b };
  const contacts = cushionNet(b, GOAL_NET, 1 / 60);
  assert.equal(contacts.length, 1);
  assert(Math.hypot(b.vx, b.vy, b.vz) < Math.hypot(start.vx, start.vy, start.vz), 'Angled cloth contacts absorb energy');
  assert(contacts[0]!.depth > 0);
}

// The rear cords continue to cradle a caught ball even after the impact ripple
// has expired, and seeking the same frame reproduces the same supported pocket.
const supportedBall = { x: PITCH.GOAL_D + 0.45, y: PITCH.GOAL_H / 2, z: 0 };
const support = netPockets(supportedBall, GOAL_NET);
const rear = new Float32Array([PITCH.GOAL_D, supportedBall.y, 0]);
const supported = new Float32Array(3), again = new Float32Array(3);
deformNet(rear, new Float32Array([1, 0, 0]), new Float32Array([1]), supported, [], 12, support);
assert(supported[0]! > supportedBall.x + BALL_R, 'The woven rear panel wraps beyond the ball surface');
deformNet(rear, new Float32Array([1, 0, 0]), new Float32Array([1]), again, [], 12, support);
assert.deepEqual(supported, again);
console.log('Goal/net checks passed: both ends, 18 shot trajectories, cushioned back/side/roof contacts, ball settling, supported cords and deterministic replay impacts.');
