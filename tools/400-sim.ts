/**
 * Headless 400 games, bots in every seat: games finish, bids get made at a sane rate,
 * throw-ins are rare, every play is legal.
 *   npx tsx tools/400-sim.ts [games=300] [easy|normal|hard]
 */
import { FourHundredEngine, type GameEvent } from '../client/src/arba3meyeh/engine';
import { BotDriver, type BotLevel } from '../client/src/arba3meyeh/bots';
const games = Number(process.argv[2] ?? 300);
const level = (process.argv[3] ?? 'normal') as BotLevel;
let hands = 0, redeals = 0, made = 0, bids = 0, thirteen = 0, errors = 0, stalls = 0;
const bidHist = new Map<number, number>();
const wins = [0, 0];
let minutes = 0;
for (let gi = 0; gi < games; gi++) {
  const seats = [0, 1, 2, 3].map((i) => ({ id: `p${i}`, name: `P${i}`, bot: true, avatar: i }));
  const g = new FourHundredEngine(seats, {}, undefined, 1000 + gi);
  const bot = new BotDriver(g, level);
  const orig = g.act.bind(g);
  g.act = (id, a) => {
    const e = orig(id, a);
    if (e) errors++;
    return e;
  };
  let t = 0;
  while (!g.isOver && t < 60 * 60) {
    g.update(0.1);
    bot.update(0.1);
    t += 0.1;
    for (const e of g.events.splice(0) as GameEvent[]) {
      if (e.k === 'redeal') redeals++;
      if (e.k === 'hand') {
        hands++;
        for (const r of e.results) {
          bids++;
          if (r.tricks >= r.bid) made++;
          bidHist.set(r.bid, (bidHist.get(r.bid) ?? 0) + 1);
        }
      }
      if (e.k === 'over') {
        wins[e.team]++;
        if (e.reason === 'thirteen') thirteen++;
      }
    }
  }
  if (!g.isOver) stalls++;
  minutes += t / 60;
}
console.log(`${games} games (${level}): ${hands} hands (${(hands / games).toFixed(1)}/game), ${redeals} throw-ins (${((redeals / (hands + redeals)) * 100).toFixed(1)}%), bids made ${((made / bids) * 100).toFixed(1)}%, wins ${wins.join('-')}, 13-wins ${thirteen}, illegal ${errors}, stalls ${stalls}, ~${(minutes / games).toFixed(1)} min/game at bot speed`);
console.log('bids', [...bidHist.entries()].sort((a, b) => a[0] - b[0]).map(([b, n]) => `${b}:${n}`).join(' '));
