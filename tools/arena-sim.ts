/**
 * Headless Crownfall tournament: AI vs AI with random decks (every card gets
 * played), reporting crashes, stalls, NaNs, game lengths and per-card win rates.
 *
 *   npx tsx tools/arena-sim.ts [games=40] [--level=normal] [--blue=hard --red=easy]
 */
import { CARDS } from '../client/src/arena/cards';
import { BattleEngine } from '../client/src/arena/engine';
import { ArenaAI, type AIDifficulty } from '../client/src/arena/ai';

const args = process.argv.slice(2);
const games = Number(args.find((a) => !a.startsWith('--')) ?? 40);
const flag = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
const level = (flag('level') ?? 'normal') as AIDifficulty;
const blueLevel = (flag('blue') ?? level) as AIDifficulty;
const redLevel = (flag('red') ?? level) as AIDifficulty;
let blueWins = 0;
(globalThis as unknown as { localStorage: unknown }).localStorage = { getItem: () => null, setItem: () => undefined };

const ids = CARDS.map((c) => c.id);
const played = new Map<string, number>();
const wins = new Map<string, { w: number; n: number }>();
const errors: string[] = [];
let crowns = 0;
let totalTime = 0;
let draws = 0;
let rng = 12345;
const rand = () => ((rng = (rng * 16807) % 2147483647) / 2147483647);
let lastBlue: string[] = [];
let lastRed: string[] = [];
const deckFrom = (offset: number) => Array.from({ length: 8 }, (_, i) => ids[(offset * 8 + i) % ids.length]!);

for (let g = 0; g < games; g++) {
  // Rotate through the roster so every card appears; shuffle a bit.
  // Odd games replay the previous matchup with decks swapped, so deck strength cancels out.
  if (g % 2 === 0) {
    lastBlue = Math.floor(g / 2) < Math.ceil(ids.length / 8) ? deckFrom(Math.floor(g / 2)) : [...ids].sort(() => rand() - 0.5).slice(0, 8);
    lastRed = [...ids].sort(() => rand() - 0.5).slice(0, 8);
  }
  const blue = g % 2 === 0 ? lastBlue : lastRed;
  const red = g % 2 === 0 ? lastRed : lastBlue;
  const e = new BattleEngine(blue, red, 1000 + g);
  const ais = [new ArenaAI(e, 'blue', blueLevel), new ArenaAI(e, 'red', redLevel)];
  let steps = 0;
  try {
    while (e.phase !== 'ended' && steps < 30 * 400) {
      e.step();
      for (const ai of ais) ai.update(1 / 30);
      for (const ev of e.events) if (ev.type === 'play') played.set(ev.card, (played.get(ev.card) ?? 0) + 1);
      e.events.length = 0;
      for (const u of e.units) if (!Number.isFinite(u.x + u.y + u.hp)) throw new Error(`NaN on ${u.card.id}`);
      if (e.units.length > 400) throw new Error(`unit explosion (${e.units.length})`);
      steps++;
    }
  } catch (err) {
    errors.push(`game ${g}: ${(err as Error).stack?.split('\n').slice(0, 3).join(' | ')}`);
    continue;
  }
  if (e.phase !== 'ended') errors.push(`game ${g}: never ended`);
  totalTime += e.time;
  crowns += e.blue.crowns + e.red.crowns;
  if (e.winner === 'draw') draws++;
  if (e.winner === 'blue') blueWins++;
  for (const [team, deck] of [['blue', blue], ['red', red]] as const) {
    for (const id of deck) {
      const s = wins.get(id) ?? { w: 0, n: 0 };
      s.n++;
      if (e.winner === team) s.w++;
      wins.set(id, s);
    }
  }
}
const never = ids.filter((id) => !played.has(id));
console.log(`${games} games (blue ${blueLevel} vs red ${redLevel}, blue won ${blueWins}): avg ${(totalTime / games).toFixed(0)} s, ${(crowns / games).toFixed(2)} crowns/game, ${draws} draws, ${errors.length} errors`);
if (errors.length) console.log(errors.slice(0, 8).join('\n'));
console.log(`never played (${never.length}): ${never.join(', ')}`);
const rates = [...wins.entries()].filter(([, s]) => s.n >= 4).map(([id, s]) => [id, s.w / s.n] as const).sort((a, b) => b[1] - a[1]);
console.log('best:', rates.slice(0, 8).map(([id, r]) => `${id} ${(r * 100).toFixed(0)}%`).join(', '));
console.log('worst:', rates.slice(-8).map(([id, r]) => `${id} ${(r * 100).toFixed(0)}%`).join(', '));
