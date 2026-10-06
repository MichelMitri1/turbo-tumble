/**
 * Headless Kitten Kaboom games between bots: checks the rules engine never stalls
 * or loses cards, and reports how games go.   npx tsx tools/kittens-sim.ts [games=400]
 */
import { KittensEngine } from '../client/src/kittens/engine';
import { BotDriver } from '../client/src/kittens/bots';
import type { DeckId } from '../client/src/kittens/cards';

const games = Number(process.argv[2] ?? 400);
let errors = 0;
const stats = { turns: 0, time: 0, armageddon: 0, nopes: 0, defuses: 0, steals: 0, godcatPlays: 0 };
const wins = new Map<number, number>();
for (let g = 0; g < games; g++) {
  const n = 2 + (g % 4);
  const deck: DeckId = g % 3 === 2 ? 'classic' : 'gve';
  const e = new KittensEngine(Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Bot ${i}`, bot: true, avatar: i })), { deck, seed: g + 1, nopeWindow: 0.5 });
  const total = () => e.draw.length + e.discard.length + e.players.reduce((s, p) => s + p.hand.length, 0) + (e.mat.godcat ? 1 : 0) + (e.prompt?.k === 'insert' ? 1 : 0) + (e.prompt?.k === 'heck' ? 1 : 0);
  const start = total();
  const bots = new BotDriver(e, g % 2 ? 'hard' : 'normal', 20);
  let t = 0;
  try {
    while (!e.isOver && t < 3000) {
      e.update(0.1);
      bots.update(0.1);
      t += 0.1;
      for (const ev of e.events) {
        if (ev.k === 'turn') stats.turns++;
        if (ev.k === 'armReveal') stats.armageddon++;
        if (ev.k === 'nope') stats.nopes++;
        if (ev.k === 'defuse') stats.defuses++;
        if (ev.k === 'steal') stats.steals++;
        if (ev.k === 'play' && ev.as) stats.godcatPlays++;
      }
      e.events.length = 0;
      const now = total();
      if (now !== start) throw new Error(`card count ${start} → ${now} (phase ${e.phase}, prompt ${e.prompt?.k})`);
    }
    if (!e.isOver) throw new Error(`stalled: phase ${e.phase} prompt ${e.prompt?.k} pending ${e.pending?.effect.k} turn ${e.currentPlayer.id}`);
    const wi = e.players.findIndex((p) => p.id === e.winner);
    wins.set(wi, (wins.get(wi) ?? 0) + 1);
    stats.time += t;
  } catch (err) {
    errors++;
    if (errors <= 5) console.log(`game ${g} (${n}p ${deck}):`, (err as Error).message);
  }
}
console.log(`${games} games, ${errors} errors · avg ${(stats.turns / games).toFixed(1)} turns, ${(stats.time / games).toFixed(0)} sim-s · per game: ${(stats.armageddon / games).toFixed(2)} armageddons, ${(stats.nopes / games).toFixed(2)} nopes, ${(stats.defuses / games).toFixed(2)} defuses, ${(stats.steals / games).toFixed(2)} steals, ${(stats.godcatPlays / games).toFixed(2)} angel plays`);
console.log('wins by seat:', [...wins.entries()].sort().map(([k, v]) => `${k}:${v}`).join(' '));
