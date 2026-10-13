/** Behaviour regression checks: node --import tsx tools/football-ai-test.ts */
import assert from 'node:assert/strict';
import { CPU_LEVELS, type CpuLevel } from '../client/src/football/sim/difficulty';
import { MatchSim, NO_INPUT, type Pl } from '../client/src/football/sim/match';

const TRIALS = 120;

function duel(level: CpuLevel, seed: number) {
  const m = new MatchSim({ home: 'nbu', away: 'val', halfSeconds: 900, difficulty: level, seed });
  const h = m.addHuman('me', 0);
  const carrier = m.players.find((p) => p.team === 0 && p.role === 'ST')!;
  const defender = m.players.find((p) => p.team === 1 && p.role === 'CB')!;
  for (const p of m.players) Object.assign(p, { human: -1, state: 'run', vx: 0, vz: 0 });
  h.p = carrier.i;
  Object.assign(carrier, { human: 0, x: 0, z: 0, face: 0 });
  Object.assign(defender, { x: 3.2, z: ((seed % 5) - 2) * 0.2, face: Math.PI });
  m.phase = 'play';
  m.restart = null;
  m.time = 2;
  m.ball.owner = carrier.i;
  m.gained(carrier);
  return { m, carrier, defender };
}

/** A sprinter approaches, cuts to either side, then straightens up. */
function dribble(level: CpuLevel, seed: number): 'beaten' | 'lost' | 'foul' | 'held' {
  const { m, carrier, defender } = duel(level, seed);
  for (let tick = 0; tick < 150; tick++) {
    // Keep the rest of the XI out of the duel, but available if a foul causes a restart.
    for (const p of m.players) if (p !== carrier && p !== defender) Object.assign(p, { x: -40, z: 30, vx: 0, vz: 0 });
    const mz = tick < 20 ? 0 : tick < 65 ? (seed % 2 ? 1 : -1) * 0.75 : 0;
    m.step(new Map([['me', { ...NO_INPUT, mx: 1, mz, sprint: true }]]));
    if (m.phase !== 'play') return 'foul';
    if (m.ball.owner !== carrier.i) return 'lost';
    if (carrier.x > defender.x + 2) return 'beaten';
  }
  return 'held';
}

const beaten = new Map<CpuLevel, number>();
for (const level of CPU_LEVELS) {
  const results = { beaten: 0, lost: 0, foul: 0, held: 0 };
  for (let seed = 1; seed <= TRIALS; seed++) results[dribble(level, seed)]++;
  beaten.set(level, results.beaten);
  console.log(`${level}: ${results.beaten}/${TRIALS} dribbles past defender, ${results.lost} lost, ${results.foul} fouls, ${results.held} held up`);
}
assert(beaten.get('beginner')! > TRIALS * 0.65, 'Beginner must give new players space to get past');
assert(beaten.get('amateur')! > TRIALS * 0.25, 'Amateur must be beatable with a change of direction');
assert(beaten.get('beginner')! > beaten.get('amateur')! + TRIALS * 0.2, 'Beginner must feel easier than Amateur');
assert(beaten.get('amateur')! > beaten.get('legendary')! + TRIALS * 0.15, 'Higher levels must defend more effectively');
assert(beaten.get('legendary')! < TRIALS * 0.25, 'Legendary must remain a challenge');

// Change direction after the defender has committed to a read. Easy defenders
// hold that commitment; an elite defender has time to react.
for (const level of ['amateur', 'legendary'] as const) {
  const { m, defender } = duel(level, 31);
  m.ai[1].update(1 / 60);
  const before = [defender.tx, defender.tz];
  m.ball.z += 8;
  m.time += 0.2;
  m.ai[1].update(1 / 60);
  if (level === 'amateur') assert.deepEqual([defender.tx, defender.tz], before, 'Amateur must commit briefly rather than read the stick every frame');
  else assert.notDeepEqual([defender.tx, defender.tz], before, 'Legendary must respond sooner');
}

/** Isolate kick execution: same player, same pass, no team decisions. */
function passError(level: CpuLevel, seed: number, humanTeam = false): number {
  const m = new MatchSim({ home: 'nbu', away: 'val', halfSeconds: 900, difficulty: level, seed });
  const kicker = m.players.find((p) => p.team === 0 && p.role === 'CM') ?? m.players[5]!;
  const receiver = m.players.find((p) => p.team === 0 && p.role === 'ST')!;
  for (const p of m.players) p.state = 'off';
  for (const p of [kicker, receiver]) Object.assign(p, { state: 'run', x: p === kicker ? 0 : 18, z: 0, tx: p === kicker ? 0 : 18, tz: 0, vx: 0, vz: 0 });
  if (humanTeam) {
    const h = m.addHuman('mate', 0);
    for (const p of m.players) p.human = -1;
    h.p = receiver.i;
    receiver.human = 0;
  }
  m.phase = 'play';
  m.restart = null;
  m.ball.owner = kicker.i;
  m.gained(kicker);
  m.ai[0].update = m.ai[1].update = () => {};
  m.startKick(kicker, 'pass', 0.4, 1, 0);
  for (let tick = 0; tick < 60; tick++) {
    m.step(new Map());
    if (m.events.some((e) => e.k === 'kick')) return Math.abs(Math.atan2(m.ball.vz, m.ball.vx));
  }
  throw new Error('Pass was never struck');
}
const errors = new Map<CpuLevel, number>();
for (const level of CPU_LEVELS) {
  let error = 0;
  for (let seed = 1; seed <= TRIALS; seed++) error += passError(level, seed);
  errors.set(level, error / TRIALS);
}
assert(errors.get('beginner')! > errors.get('legendary')! * 2, 'CPU pass accuracy must change with the level');
assert.equal(passError('beginner', 31, true), passError('legendary', 31, true), 'An easier opponent must not weaken human teammates');

// Difficulty must not give opponents extra physical speed.
function sprint(level: CpuLevel) {
  const { m, defender } = duel(level, 1);
  const speeds: number[] = [];
  for (let tick = 0; tick < 60; tick++) {
    m.movePlayer(defender, 1 / 60, 1, 0, true);
    speeds.push(defender.vx);
  }
  return speeds;
}
assert.deepEqual(sprint('beginner'), sprint('legendary'), 'Difficulty must change decisions, not player pace');

// Every level can complete a whole match without freezing; preserve seeded results.
function match(level: CpuLevel, seed: number) {
  const m = new MatchSim({ home: 'nbu', away: 'val', halfSeconds: 30, difficulty: level, seed });
  const decisions: string[] = [];
  for (let tick = 0; tick < 60 * 300 && m.phase !== 'fulltime'; tick++) {
    m.step(new Map());
    for (const e of m.events.splice(0)) if (e.k === 'kick') decisions.push(`${e.p}:${e.type}`);
    assert(m.players.every((p: Pl) => Number.isFinite(p.x) && Number.isFinite(p.z)), 'Players must stay finite');
    assert(Number.isFinite(m.ball.x) && Number.isFinite(m.ball.z), 'Ball must stay finite');
  }
  assert.equal(m.phase, 'fulltime', `${level} match must finish`);
  assert(decisions.length > 8, `${level} teams must play rather than stand still`);
  return { decisions, score: m.score, stats: m.stats };
}
for (const level of CPU_LEVELS) match(level, 401);
assert.deepEqual(match('world', 402), match('world', 402), 'The same seed must reproduce the same match');
assert.notDeepEqual(match('world', 402).decisions, match('world', 403).decisions, 'Different matches must produce different attacking decisions');
console.log('Football AI checks passed: difficulty, dribbling, reaction, accuracy, teammate support, pace and complete matches.');
