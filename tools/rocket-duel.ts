/**
 * Headless Boostball bot duels: blue bots at one level against orange bots at another.
 *   npx tsx tools/rocket-duel.ts [matches=6] [--blue=ssl] [--orange=allstar] [--size=2] [--length=180]
 * Reports the series, goals, shots, saves and how each side touches the ball (air touches above 500 uu).
 */
import { World, type PlayerInfo } from '../client/src/rocket/sim/world';
import { Bots, type BotLevel } from '../client/src/rocket/sim/bot';
import type { Controls } from '../client/src/rocket/sim/car';
import { CAR_IDS } from '../client/src/rocket/sim/constants';

const args = process.argv.slice(2);
const flag = (k: string, d: string) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const matches = Number(args.find((a) => !a.startsWith('--')) ?? 6);
const size = Number(flag('size', '2'));
const length = Number(flag('length', '180'));
const levels = [flag('blue', 'ssl'), flag('orange', 'allstar')] as [BotLevel, BotLevel];

const wins = [0, 0];
const goals = [0, 0];
const shots = [0, 0];
const saves = [0, 0];
const touches = [0, 0];
const air = [0, 0];
const dodges = [0, 0];
const moves: Array<Record<string, number>> = [{}, {}];
const boostSum = [0, 0];
const empty = [0, 0];
const samples = [0, 0];
const airGoals = [0, 0];
const lastTouchZ = new Map<number, number>();
let kickoffs = 0;
const kickWins = [0, 0];
const t0 = performance.now();
let ticks = 0;
for (let m = 0; m < matches; m++) {
  const players: PlayerInfo[] = [];
  for (let i = 0; i < size * 2; i++) players.push({ id: i + 1, name: `Bot${i}`, team: (i % 2) as 0 | 1, bot: true, body: CAR_IDS[(m + i) % 3]! });
  const w = new World(players, length, 500 + m, false);
  const bots = levels.map((l) => new Bots(w, l));
  bots.forEach((b, i) => (b.stats = moves[i]!));
  const outs = [new Map<number, Controls>(), new Map<number, Controls>()];
  const inputs = new Map<number, Controls>();
  const team = new Map(players.map((p) => [p.id, p.team]));
  const hist: string[] = [];
  while (w.phase !== 'over' && ticks < 1e9) {
    if (args.includes('--goals') && ticks % 30 === 0) {
      const b = w.ball;
      hist.push(`  t${(w.tickCount / 120).toFixed(1)} ball ${b.pos.toArray().map((v) => v.toFixed(0)).join(',')} v ${b.vel.toArray().map((v) => v.toFixed(0)).join(',')} | ` + w.cars.map((c) => `${c.team ? 'O' : 'B'}${c.id} ${c.pos.x.toFixed(0)},${c.pos.y.toFixed(0)},${c.pos.z.toFixed(0)} b${c.boost.toFixed(0)} ${bots[c.team]!.planOf(c.id)}`).join(' | '));
      if (hist.length > 10) hist.shift();
    }
    bots[0]!.update(1 / 120, outs[0]!);
    bots[1]!.update(1 / 120, outs[1]!);
    for (const p of players) inputs.set(p.id, outs[p.team]!.get(p.id)!);
    w.step(inputs);
    ticks++;
    if (ticks % 12 === 0) for (const c of w.cars) { boostSum[c.team]! += c.boost; samples[c.team]!++; if (c.boost < 1) empty[c.team]!++; }
    for (const e of w.events) {
      if (e.k === 'touch') lastTouchZ.set(team.get(e.car)!, e.z);
      if (e.k === 'goal' && (lastTouchZ.get((e as unknown as { team: number }).team) ?? 0) > 300) airGoals[(e as unknown as { team: 0 | 1 }).team]!++;
      if (e.k === 'touch') {
        const t = team.get(e.car)!;
        if (w.ball.lastTouch < 0 || (Math.abs(e.x) < 10 && Math.abs(e.y) < 10 && e.z < 120)) {
          kickoffs++;
          kickWins[t]!++;
        }
        touches[t]!++;
        if (e.z > 500) air[t]!++;
      }
      if (e.k === 'goal' && args.includes('--goals')) {
        console.log(`GOAL for ${levels[(e as unknown as { team: 0 | 1 }).team]}:`);
        for (const h of hist) console.log(h);
      }
      if (e.k === 'dodge') dodges[team.get((e as { car: number }).car) ?? 0]!++;
    }
    w.events.length = 0;
  }
  for (const [id, s] of w.stats) {
    const t = team.get(id)!;
    shots[t]! += s.shots;
    saves[t]! += s.saves;
  }
  goals[0]! += w.score[0];
  goals[1]! += w.score[1];
  if (w.score[0] !== w.score[1]) wins[w.score[0] > w.score[1] ? 0 : 1]!++;
  console.log(`match ${m}: ${levels[0]} ${w.score[0]} – ${w.score[1]} ${levels[1]}${w.overtime ? ' (OT)' : ''}`);
}
const row = (i: 0 | 1) => `${levels[i].padEnd(8)} wins ${wins[i]} · goals ${goals[i]} · shots ${shots[i]} · saves ${saves[i]} · touches ${touches[i]} (air ${air[i]}) · dodges ${dodges[i]}`;
console.log(`\n${matches} × ${size}v${size}, ${length} s`);
console.log(row(0));
console.log(row(1));
console.log(`avg boost ${levels[0]} ${(boostSum[0]! / samples[0]!).toFixed(0)} (empty ${((100 * empty[0]!) / samples[0]!).toFixed(0)}%) / ${levels[1]} ${(boostSum[1]! / samples[1]!).toFixed(0)} (empty ${((100 * empty[1]!) / samples[1]!).toFixed(0)}%) · goals off a touch above 300: ${airGoals[0]} / ${airGoals[1]}`);
console.log(`moves ${levels[0]}:`, JSON.stringify(moves[0]));
console.log(`moves ${levels[1]}:`, JSON.stringify(moves[1]));
console.log(`kickoff first touches: ${levels[0]} ${kickWins[0]} / ${levels[1]} ${kickWins[1]}`);
console.log(`${((performance.now() - t0) / ticks * 1000).toFixed(1)} µs/tick`);
