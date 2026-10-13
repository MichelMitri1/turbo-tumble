/** Defensive positioning checks: node --import tsx tools/football-defence-test.ts */
import assert from 'node:assert/strict';
import { FORMATIONS, type FormationId } from '../client/src/football/sim/data';
import { CPU_LEVELS, type CpuLevel } from '../client/src/football/sim/difficulty';
import { BALL_R, MatchSim, NO_INPUT, PITCH, type Pl } from '../client/src/football/sim/match';

function setup(formation: FormationId, team: 0 | 1, direction: 1 | -1, ballDepth: number, difficulty: CpuLevel = 'pro', seed = 31) {
  const lineup = { formation, xi: Array.from({ length: 11 }, (_, i) => i), mentality: 0 };
  const m = new MatchSim({ home: 'nbu', away: 'val', halfSeconds: 900, difficulty, seed, lineups: [lineup, lineup] });
  m.dir = team === 0 ? [direction, -direction] : [-direction, direction];
  m.phase = 'play'; m.restart = null; m.time = 2;
  const attacker = (1 - team) as 0 | 1;
  const h = m.addHuman('me', attacker);
  const carrier = m.players.find((p) => p.team === attacker && p.role === 'ST')!;
  for (const p of m.players) Object.assign(p, { human: -1, state: p.team === team ? 'run' : 'off', vx: 0, vz: 0 });
  Object.assign(carrier, { state: 'run', x: ballDepth * direction, z: 0, face: direction === 1 ? Math.PI : 0, human: 0 });
  h.p = carrier.i;
  Object.assign(m.ball, { x: carrier.x - direction * 0.6, y: BALL_R, z: 0, owner: carrier.i, vx: 0, vy: 0, vz: 0 });
  m.gained(carrier);
  for (const p of m.teamPlayers(team)) {
    const [x, z] = m.formationSpot(p, m.ball.x, 0, false);
    Object.assign(p, { x, z, tx: x, tz: z, face: direction === 1 ? 0 : Math.PI });
  }
  return { m, carrier, direction, team, backs: m.teamPlayers(team).filter((p) => ['CB', 'LB', 'RB'].includes(p.role)) };
}

// Every formation and end holds its shape outside the box during midfield play.
for (const formation of Object.keys(FORMATIONS) as FormationId[]) for (const team of [0, 1] as const)
  for (const direction of [-1, 1] as const) for (const level of CPU_LEVELS) for (const depth of [0, -15, -28]) {
    const { m, backs } = setup(formation, team, direction, depth, level);
    m.ai[team].update(1 / 60);
    for (const p of backs) {
      assert(p.tx * direction > -PITCH.HL + PITCH.BOX_D + 1, `${formation}/${level}/${depth}: defence must not park in the box`);
      assert(Number.isFinite(p.tx) && Number.isFinite(p.tz));
    }
  }

// A stationary attacker beyond the line cannot pull a marker back into the box;
// a runner advancing towards goal still gets tracked and recovered against.
function runner(moving: boolean) {
  const { m, carrier, backs } = setup('4-3-3', 1, -1, 0);
  const q = m.players.find((p) => p.team === carrier.team && p.role === 'LW')!;
  Object.assign(q, { state: 'run', x: 32, z: backs.find((p) => p.role === 'CB')!.z, vx: moving ? 7 : 0, vz: 0 });
  m.ai[1].update(1 / 60);
  return backs.filter((p) => p.role === 'CB').map((p) => p.tx);
}
const stationary = runner(false), running = runner(true);
assert(Math.max(...stationary) < 22, 'A poacher does not drag the defensive line backwards');
assert(Math.max(...running) > Math.max(...stationary) + 5, 'The defence still follows a dangerous run in behind');

// A forward dribble should not send the jockey target metres backwards. Lateral
// anticipation and each difficulty's own reaction/space still apply.
function jockey(level: CpuLevel, seed: number, speed: number) {
  const { m, carrier, backs } = setup('4-3-3', 1, -1, 0, level, seed);
  const defender = backs.find((p) => p.role === 'CB')!;
  Object.assign(defender, { x: 4, z: 0 });
  carrier.vx = speed;
  m.ai[1].update(1 / 60);
  return defender.tx;
}
for (const level of CPU_LEVELS) for (let seed = 1; seed <= 20; seed++) {
  assert(jockey(level, seed, 8) - jockey(level, seed, 0) < 0.3, 'The engaging defender meets the dribbler instead of endlessly backpedalling');
}

// Beaten defenders recover to intercept just ahead of the carrier, not nine
// metres further back into the penalty area. Inside-box attacks remain covered.
for (const direction of [-1, 1] as const) for (const depth of [-28, -42]) {
  const { m, carrier, backs } = setup('4-3-3', 1, direction, depth);
  const defender = backs.find((p) => p.role === 'CB')!;
  for (const p of m.teamPlayers(1)) if (p !== defender && p.role !== 'GK') p.state = 'off';
  Object.assign(defender, { x: (depth + 4) * direction, z: 0 }); carrier.vx = -direction * 8;
  m.ai[1].update(1 / 60);
  assert(defender.tSprint, 'A beaten defender sprints to recover');
  if (depth === -28) assert(defender.tx * direction > -PITCH.HL + PITCH.BOX_D, 'An outside-box recovery meets the attack outside the box');
  else assert(defender.tx * direction < -PITCH.HL + PITCH.BOX_D, 'A real penalty-area threat is still defended goal-side');
}

// Live movement: an old deep back line should step up when play is at halfway.
const advance = setup('4-4-2', 1, -1, 0);
for (const p of advance.backs) p.x = 43;
for (let tick = 0; tick < 120; tick++) advance.m.step(new Map([['me', { ...NO_INPUT }]]));
assert(advance.backs.every((p: Pl) => p.x < PITCH.HL - PITCH.BOX_D), 'Defenders physically leave the box and push up to the new line');

console.log('Defence checks passed: all formations, difficulties and ends hold a higher line, meet dribblers, step up, track runners and recover against real box threats.');
