/**
 * Headless Last Card games with bots: card conservation (always 108), no stalls,
 * rule stats and per-seat win rates by bot level.
 *   npx tsx tools/lastcard-sim.ts [games=300] [--stacking] [--stack24] [--match] [--target=500]
 *     [--seven-zero] [--jump-in] [--force] [--no-challenge] [--uno4] [--timer=15] [--seats=N]
 */
import { LastCardEngine, type GameEvent, type Rules } from '../client/src/lastcard/engine';
import { BotDriver, type BotLevel } from '../client/src/lastcard/bots';
const args = process.argv.slice(2);
const flag = (f: string) => args.includes(`--${f}`);
const num = (f: string, d: number) => Number(args.find((a) => a.startsWith(`--${f}=`))?.split('=')[1] ?? d);
const games = Number(args.find((a) => !a.startsWith('--')) ?? 300);
const rules: Partial<Rules> = {
  stacking: flag('stacking') || flag('stack24'),
  stackTwoOnFour: flag('stack24'),
  drawToMatch: flag('match'),
  target: num('target', 0),
  sevenZero: flag('seven-zero'),
  jumpIn: flag('jump-in'),
  forcePlay: flag('force'),
  challenge: !flag('no-challenge'),
  unoPenalty: flag('uno4') ? 4 : 2,
  turnTime: num('timer', 0),
};
const fixedSeats = num('seats', 0);
const levels: BotLevel[] = ['easy', 'normal', 'hard'];
const stats: Record<string, number> = {};
const wins: Record<BotLevel, number> = { easy: 0, normal: 0, hard: 0 };
const seatsBy: Record<BotLevel, number> = { easy: 0, normal: 0, hard: 0 };
const catches: Record<BotLevel, number> = { easy: 0, normal: 0, hard: 0 };
const bluffs: Record<BotLevel, number> = { easy: 0, normal: 0, hard: 0 };
const wild4s: Record<BotLevel, number> = { easy: 0, normal: 0, hard: 0 };
const challengeWon: Record<BotLevel, number> = { easy: 0, normal: 0, hard: 0 };
const challengeLost: Record<BotLevel, number> = { easy: 0, normal: 0, hard: 0 };
let bad = 0, stalls = 0, totalTurns = 0;
for (let g = 0; g < games; g++) {
  const n = fixedSeats || 2 + (g % 5);
  // Levels rotate with the game so every level sits in every seat equally often.
  const lvl = (id: string) => levels[(Number(id.slice(1)) + g) % 3]!;
  const seats = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, bot: true, avatar: i }));
  for (const s of seats) seatsBy[lvl(s.id)]++;
  const e = new LastCardEngine(seats, rules);
  // One driver per level; each only drives the seats of its level, every one ticks every step.
  const drivers = levels.map((l) => new BotDriver(e, l, (id) => lvl(id) === l));
  let t = 0;
  while (!e.isOver && t < 60 * 60 * 3) {
    for (const d of drivers) d.update(0.1);
    e.update(0.1);
    t += 0.1;
    for (const ev of e.events.splice(0) as GameEvent[]) {
      stats[ev.k] = (stats[ev.k] ?? 0) + 1;
      if (ev.k === 'draw' && ev.why !== 'deal') stats[`draw:${ev.why}`] = (stats[`draw:${ev.why}`] ?? 0) + 1;
      if (ev.k === 'challenge') {
        if (ev.yes) (ev.guilty ? challengeWon : challengeLost)[lvl(ev.by)]++;
        stats[ev.yes && ev.guilty ? 'challenge:won' : 'challenge:other'] = (stats[ev.yes && ev.guilty ? 'challenge:won' : 'challenge:other'] ?? 0) + 1;
      }
      if (ev.k === 'caught') catches[lvl(ev.by)]++;
      if (ev.k === 'play' && ev.card.kind === 'wild4') {
        wild4s[lvl(ev.by)]++;
        if (ev.bluff) bluffs[lvl(ev.by)]++;
      }
      if (ev.k === 'turn') totalTurns++;
    }
    const total = e.draw.length + e.discard.length + e.players.reduce((s, p) => s + p.hand.length, 0);
    const ids = new Set([...e.draw, ...e.discard, ...e.players.flatMap((p) => p.hand)].map((c) => c.id));
    if (total !== 108 || ids.size !== 108) { bad++; console.log('conservation broken', g, total, ids.size); break; }
  }
  if (!e.isOver) stalls++;
  else wins[lvl(e.winner!)]++;
}
const on = Object.entries(rules).filter(([, v]) => v && v !== 2).map(([k, v]) => (v === true ? k : `${k}=${v}`)).join(' ') || 'official';
console.log(`${games} games (${on}) · broken ${bad} · stalls ${stalls} · avg turns ${(totalTurns / games).toFixed(0)}`);
for (const l of levels) {
  const r = (wins[l] / Math.max(1, seatsBy[l])).toFixed(3);
  console.log(`  ${l.padEnd(6)} wins ${String(wins[l]).padStart(4)} / ${seatsBy[l]} seats = ${r} per seat · catches ${catches[l]} · +4 played ${wild4s[l]} (bluffs ${bluffs[l]}) · challenges won ${challengeWon[l]} lost ${challengeLost[l]}`);
}
console.log(Object.entries(stats).sort().map(([k, v]) => `${k}:${v}`).join('  '));
