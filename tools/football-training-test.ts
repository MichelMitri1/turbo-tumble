import assert from 'node:assert/strict';
import { MatchSim, NO_INPUT } from '../client/src/football/sim/match';
import { SKILL_SETS, SKILLS } from '../client/src/football/sim/skills';
import { TrainingSession } from '../client/src/football/training';
import { MatchRecording, replayFrame } from '../client/src/football/replay';
import { kitsFor } from '../client/src/football/sim/data';
import { readFrame, writeFrame } from '../client/src/football/sim/snapshot';

function session(options: ConstructorParameters<typeof TrainingSession>[1]) {
  const m = new MatchSim({ home: 'nbu', away: 'val', halfSeconds: 30, difficulty: 'amateur', seed: 42, training: true });
  m.addHuman('me', 0);
  const tr = new TrainingSession(m, options);
  return { m, tr };
}
assert.equal(SKILL_SETS.length, 5);
assert(SKILL_SETS.every((s) => s.moves.length === 20));
assert.equal(new Set(SKILLS.map((s) => s.id)).size, 100);
assert.equal(new Set(SKILLS.map((s) => s.name)).size, 100);
for (const move of SKILLS) {
  const { m, tr } = session({ mode: 'skill', skillId: move.id });
  m.step(new Map([['me', { ...NO_INPUT, trick: move.id }]]));
  if (move.id !== 1) assert.equal(readFrame(writeFrame(m)).players[tr.hero.i]!.trick, move.id, `${move.name} must survive a snapshot`);
  let sawSkill = false;
  for (let tick = 0; tick < 150; tick++) {
    m.step(new Map([['me', { ...NO_INPUT }]]));
    const ev = m.events.splice(0);
    if (ev.some((e) => e.k === 'trick' && e.trick === move.id)) sawSkill = true;
    tr.update(ev);
    assert(m.players.every((p) => Number.isFinite(p.x) && Number.isFinite(p.z)), move.name);
    assert(Number.isFinite(m.ball.y), move.name);
  }
  assert(sawSkill, `${move.name} must execute, not just appear in a menu`);
  const restored = readFrame(writeFrame(m));
  assert.equal(restored.players.length, 22);
  tr.dispose();
}

// Practice runs indefinitely and resets without leaving skills / keeper plans behind.
const free = session({ mode: 'free' });
for (let tick = 0; tick < 60 * 65; tick++) { free.tr.beforeStep(); free.m.step(new Map()); free.tr.update(free.m.events.splice(0)); }
assert.equal(free.m.clock, 0);
assert.notEqual(free.m.phase, 'halftime');
free.tr.reset();
assert.equal(free.m.ball.owner, free.tr.hero.i);
assert.equal(free.m.humans[0]!.p, free.tr.hero.i);
free.tr.dispose();

// Ground-pass objective is awarded on an actual receiver touch.
const passing = session({ mode: 'pack', pack: 'passing' });
const receiver = passing.m.teamPlayers(0).find((p) => p !== passing.tr.hero)!;
passing.m.startKick(passing.tr.hero, 'pass', 0.3, receiver.x - passing.tr.hero.x, receiver.z - passing.tr.hero.z);
for (let tick = 0; tick < 300 && !passing.tr.score; tick++) { passing.tr.beforeStep(); passing.m.step(new Map()); passing.tr.update(passing.m.events.splice(0)); }
assert(passing.tr.score > 0, 'A completed ground pass must score');
passing.tr.dispose();

const dribbling = session({ mode: 'pack', pack: 'dribbling' });
const points = dribbling.tr.markers.children.filter((_, i) => i % 3 === 0).map((o) => ({ x: o.position.x, z: o.position.z }));
for (const p of points) { Object.assign(dribbling.tr.hero, p); dribbling.tr.update([]); }
assert(dribbling.tr.score > 0, 'All ordered dribbling gates must score');
dribbling.tr.dispose();
for (const setup of ['free', 'penalty'] as const) {
  const { m, tr } = session({ mode: 'free', setup });
  assert.equal(m.restart?.kind, setup);
  assert.equal(m.players[m.restart!.taker]!.human, 0);
  tr.dispose();
}

// Archive a whole match, seek back beyond the old 34-second goal buffer, and
// check endpoint clamping and interpolation.
const m = new MatchSim({ home: 'nbu', away: 'val', halfSeconds: 30, difficulty: 'pro', seed: 413 });
const recording = new MatchRecording('nbu', 'val', kitsFor(...m.clubs), m.players.map((p) => p.def));
recording.record(writeFrame(m));
for (let tick = 0; tick < 60 * 180 && m.phase !== 'fulltime'; tick++) { m.step(new Map()); recording.record(writeFrame(m)); recording.events(m.events.splice(0), m.time); }
recording.record(writeFrame(m), true);
assert.equal(m.phase, 'fulltime');
assert(recording.data.complete);
assert(recording.data.frames.at(-1)![0]! > 34);
assert.equal(replayFrame(recording.data, -100)!.time, 0);
assert.equal(replayFrame(recording.data, 0)!.score[0], 0);
assert.equal(replayFrame(recording.data, 1e9)!.phase, 'fulltime');
assert(Math.abs(replayFrame(recording.data, 3.125)!.time - 3.125) < 0.001);
assert(recording.data.events.some((e) => e.label === 'Full time'));
console.log('Training/replay checks passed: 100 executable skills, free practice, passing, cone course, set pieces, full-match recording and seeking.');
