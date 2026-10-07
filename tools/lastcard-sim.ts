/**
 * Headless Last Card games with bots: card conservation (always 108), no stalls,
 * rule stats.   npx tsx tools/lastcard-sim.ts [games=300] [--stacking] [--match] [--target=500]
 */
import { LastCardEngine, type GameEvent } from '../client/src/lastcard/engine';
import { BotDriver, type BotLevel } from '../client/src/lastcard/bots';
const args = process.argv.slice(2);
const games = Number(args.find((a) => !a.startsWith('--')) ?? 300);
const stacking = args.includes('--stacking');
const drawToMatch = args.includes('--match');
const target = Number(args.find((a) => a.startsWith('--target='))?.split('=')[1] ?? 0);
const levels: BotLevel[] = ['easy', 'normal', 'hard'];
const stats: Record<string, number> = {};
const wins: Record<string, number> = { easy: 0, normal: 0, hard: 0 };
let bad = 0, stalls = 0, totalTurns = 0;
for (let g = 0; g < games; g++) {
  const n = 2 + (g % 5);
  const seats = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, bot: true, avatar: i }));
  const e = new LastCardEngine(seats, { stacking, drawToMatch, target });
  const driver = new Map<string, BotDriver>();
  // Each bot gets its own level (by seat) — one shared driver per level, filtered by id.
  const lvl = (id: string) => levels[Number(id.slice(1)) % 3]!;
  const drivers = levels.map((l) => new BotDriver(e, l));
  void driver;
  let t = 0;
  while (!e.isOver && t < 60 * 60 * 3) {
    // Only the driver for the current seat's level acts on turns; catches from all.
    const cur = e.current.id;
    drivers[levels.indexOf(lvl(cur))]!.update(0.1);
    e.update(0.1);
    t += 0.1;
    for (const ev of e.events.splice(0) as GameEvent[]) {
      stats[ev.k] = (stats[ev.k] ?? 0) + 1;
      if (ev.k === 'draw' && ev.why !== 'deal') stats[`draw:${ev.why}`] = (stats[`draw:${ev.why}`] ?? 0) + 1;
      if (ev.k === 'challenge') stats[ev.guilty === ev.yes && ev.yes ? 'challenge:won' : 'challenge:other'] = (stats[ev.guilty && ev.yes ? 'challenge:won' : 'challenge:other'] ?? 0) + 1;
      if (ev.k === 'turn') totalTurns++;
    }
    const total = e.draw.length + e.discard.length + e.players.reduce((s, p) => s + p.hand.length, 0);
    const ids = new Set([...e.draw, ...e.discard, ...e.players.flatMap((p) => p.hand)].map((c) => c.id));
    if (total !== 108 || ids.size !== 108) { bad++; console.log('conservation broken', g, total, ids.size); break; }
  }
  if (!e.isOver) stalls++;
  else wins[lvl(e.winner!)]!++;
}
console.log(`${games} games (stacking ${stacking}, drawToMatch ${drawToMatch}, target ${target || 'single round'}) · broken ${bad} · stalls ${stalls} · avg turns ${(totalTurns / games).toFixed(0)}`);
console.log('wins by level', wins);
console.log(Object.entries(stats).sort().map(([k, v]) => `${k}:${v}`).join('  '));
