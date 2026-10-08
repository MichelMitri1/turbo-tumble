/**
 * Headless Rocket League bot matches: checks physics stability (no NaN / tunnelling
 * out of the arena), that goals happen, and measures sim cost.
 *   npx tsx tools/rocket-sim.ts [matches=4] [--size=2] [--level=pro] [--length=120] [--idle] [--rules=ballSize:2,gravity:0.5]
 * `--idle`: orange sends no inputs (how fast do the bots score on a passive team?).
 * `--rules`: mutators (Rules fields; numbers, booleans or strings).
 */
import { World, type PlayerInfo } from '../client/src/rocket/sim/world';
import { Bots, type BotLevel } from '../client/src/rocket/sim/bot';
import { arenaDistance } from '../client/src/rocket/sim/arena';
import type { Controls } from '../client/src/rocket/sim/car';
import { CAR_IDS } from '../client/src/rocket/sim/constants';
import { sanitizeRules, type Rules } from '../client/src/rocket/sim/rules';
const args = process.argv.slice(2);
const flag = (k: string, d: string) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const matches = Number(args.find((a) => !a.startsWith('--')) ?? 4);
const size = Number(flag('size', '2'));
const level = flag('level', 'pro') as BotLevel;
const length = Number(flag('length', '120'));
const idle = args.includes('--idle');
const rules = sanitizeRules(Object.fromEntries(flag('rules', '').split(',').filter(Boolean).map((kv) => {
  const [k, v] = kv.split(':') as [string, string];
  return [k, v === 'true' ? true : v === 'false' ? false : Number.isFinite(Number(v)) ? Number(v) : v];
})) as Partial<Rules>);
let totalGoals = 0, escapes = 0, nans = 0, touches = 0, demos = 0, flips = 0, ticks = 0, shots = 0, saves = 0, epic = 0;
const firstGoal: number[] = [];
const t0 = performance.now();
for (let m = 0; m < matches; m++) {
  const players: PlayerInfo[] = [];
  for (let i = 0; i < size * 2; i++) {
    const team = (i % 2) as 0 | 1;
    players.push({ id: i + 1, name: `Bot${i}`, team, bot: !(idle && team === 1), body: CAR_IDS[(m * 4 + i) % CAR_IDS.length]! });
  }
  const w = new World(players, length, 100 + m, false, rules);
  const bots = new Bots(w, level);
  const inputs = new Map<number, Controls>();
  const start = ticks;
  let first = -1;
  while (w.phase !== "over" && ticks - start < 120 * 60 * 6) {
    bots.update(1 / 120, inputs);
    w.step(inputs);
    ticks++;
    for (const e of w.events) {
      if (e.k === 'goal') { totalGoals++; if (first < 0) first = (ticks - start) / 120; }
      if (e.k === 'touch') touches++; if (e.k === 'demo') demos++; if (e.k === 'dodge') flips++;
    }
    w.events.length = 0;
    for (const c of w.cars) {
      if (!Number.isFinite(c.pos.x + c.pos.y + c.pos.z)) nans++;
      if (!c.demolished && arenaDistance(c.pos.x, c.pos.y, c.pos.z) < -60) { escapes++; c.place(0, 0, 0); }
    }
    if (!Number.isFinite(w.ball.pos.x) || arenaDistance(w.ball.pos.x, w.ball.pos.y, w.ball.pos.z) < -10) { escapes++; w.ball.reset(); }
  }
  for (const s of w.stats.values()) { shots += s.shots; saves += s.saves; epic += s.epicSaves; }
  if (first >= 0) firstGoal.push(first);
  console.log(`match ${m}: ${w.score[0]}-${w.score[1]}${w.overtime ? ' (OT)' : ''}${first >= 0 ? ` · first goal at ${first.toFixed(0)} s` : ' · no goal'}`);
}
const ms = performance.now() - t0;
console.log(`${matches} ${size}v${size} matches (${level}${idle ? ', orange idle' : ''}), ${totalGoals} goals, ${touches} touches, ${flips} dodges, ${demos} demos, ${shots} shots, ${saves} saves (${epic} epic) · escapes ${escapes}, NaN ${nans} · ${(ms / ticks * 1000).toFixed(1)} µs/tick`);
console.log(`goals/match ${(totalGoals / matches).toFixed(2)} · touches/match ${(touches / matches).toFixed(0)} · matches with a goal in the first minute: ${firstGoal.filter((t) => t <= 60).length}/${matches}`);
