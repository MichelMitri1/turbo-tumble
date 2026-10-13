import assert from 'node:assert/strict';
import { MatchSim, NO_INPUT, type Pl } from '../client/src/football/sim/match';
import { readFrame, writeFrame } from '../client/src/football/sim/snapshot';

function foul(card: boolean) {
  const m = new MatchSim({ home: 'nbu', away: 'val', halfSeconds: 180, difficulty: 'amateur', seed: 12 });
  m.addHuman('me', 0);
  m.phase = 'play'; m.restart = null; m.events.length = 0;
  const on = m.players.find((p) => p.team === 0 && p.role === 'ST')!;
  const by = m.players.find((p) => p.team === 1 && p.role === 'CB')!;
  Object.assign(on, { x: 24, z: 2, state: 'run' });
  Object.assign(by, { x: 23, z: 2, state: 'run' });
  m.ball.owner = on.i; m.rand = () => 0;
  (m as unknown as { foul(by: Pl, on: Pl, reckless: boolean): void }).foul(by, on, card);
  assert.equal(m.phase, 'stop');
  assert.equal(m.restart, null, 'The referee sequence happens before player placement');
  assert.equal(on.state, 'down');
  assert(m.events.some((e) => e.k === 'foul' && e.card === (card ? 'yellow' : null)));
  const clock = m.clock;
  const inputs = new Map([['me', { ...NO_INPUT, shoot: true }]]);
  for (let i = 0; i < 60 * 2.5; i++) m.step(inputs);
  assert.equal(m.restart, null, 'No early kick during the referee warning');
  assert.equal(m.clock, clock, 'Match clock pauses while the referee speaks');
  for (let i = 0; i < 180 && !m.restart; i++) m.step(inputs);
  assert.equal(m.restart?.kind, 'free');
  const taker = m.players[m.restart!.taker]!;
  assert.equal(taker.state, 'place');
  assert.equal(readFrame(writeFrame(m)).players[taker.i]!.state, 'place');
  const t = m.time;
  for (let i = 0; i < 40; i++) m.step(inputs);
  assert.equal(m.phase, 'stop', 'Holding shoot cannot interrupt ball placement');
  assert(m.ball.y > 0.1 && m.ball.y < 0.8);
  for (let i = 0; i < 180 && m.phase === 'stop'; i++) m.step(new Map());
  assert(m.time > t + 1.4);
  assert.notEqual(taker.state, 'place');
}
foul(false); foul(true);

const review = new MatchSim({ home: 'nbu', away: 'val', halfSeconds: 180, difficulty: 'amateur' });
review.phase = 'play'; review.restart = null; review.rand = () => 0;
const on = review.players[9]!, by = review.players[13]!;
Object.assign(on, { x: 36.2, z: 0, state: 'run' });
Object.assign(by, { x: 35.5, z: 0, state: 'run' });
(review as unknown as { foul(by: Pl, on: Pl, reckless: boolean): void }).foul(by, on, false);
assert.equal(review.phase, 'stop', 'A borderline penalty also shows the warning before VAR');
for (let i = 0; i < 190; i++) review.step(new Map());
assert.equal(review.phase, 'var');
for (let i = 0; i < 600 && review.phase === 'var'; i++) review.step(new Map());
assert.equal(review.restart?.kind, 'penalty');

const training = new MatchSim({ home: 'nbu', away: 'val', halfSeconds: 30, difficulty: 'amateur', training: true });
training.addHuman('me', 0);
training.practiceRestart('penalty', 41.5, 0);
for (let i = 0; i < 60 * 12; i++) training.step(new Map());
assert.equal(training.restart?.kind, 'penalty', 'Training never makes the CPU take your kick after eight seconds');
assert.equal(training.clock, 0);
console.log('Restart checks passed: referee warning and booking pauses, ball placement snapshots, kick lock, untimed training set pieces.');
