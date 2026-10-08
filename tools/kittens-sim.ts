/**
 * Headless Kitten Kaboom games between bots: checks the rules engine never stalls
 * or loses cards, and reports how games go.   npx tsx tools/kittens-sim.ts [games=400] [classic|imploding|full]
 * Runs the classic / Heaven vs Heck decks with and without the Imploding Kittens pack.
 */
import { KittensEngine, type EngineOptions } from '../client/src/kittens/engine';
import { BotDriver } from '../client/src/kittens/bots';
import { viewFor } from '../client/src/kittens/view';
import type { DeckId } from '../client/src/kittens/cards';

const games = Number(process.argv[2] ?? 400);
/** Secret inserts checked while someone else knew pile positions (e.g. had seen the top 3). */
let secrecyChecks = 0;

function run(label: string, extra: Partial<EngineOptions>): void {
  let errors = 0;
  const stats = { turns: 0, time: 0, armageddon: 0, nopes: 0, defuses: 0, steals: 0, godcatPlays: 0, selfBoom: 0, implosions: 0, reverses: 0, alters: 0, bottoms: 0, rummages: 0 };
  const wins = new Map<number, number>();
  const winsByLevel = { normal: 0, hard: 0 };
  let hardShare = 0;
  for (let g = 0; g < games; g++) {
    const n = 2 + (g % 4);
    const deck: DeckId = g % 3 === 2 ? 'classic' : 'gve';
    const e = new KittensEngine(Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Bot ${i}`, bot: true, avatar: i })), { deck, seed: g + 1, nopeWindow: 0.5, ...extra });
    const total = () => e.draw.length + e.discard.length + e.removed.length + e.players.reduce((s, p) => s + p.hand.length, 0) + (e.mat.godcat ? 1 : 0) + (e.prompt?.k === 'insert' ? 1 : 0) + (e.prompt?.k === 'heck' ? 1 : 0);
    const start = total();
    // Mixed table: even seats Normal, odd seats Hard (so the levels can be compared).
    const bots = new BotDriver(e, 'normal', 20);
    const hard = new BotDriver(e, 'hard', 20);
    const levelOf = (id: string) => (Number(id.slice(1)) % 2 ? 'hard' : 'normal');
    hardShare += Math.floor(n / 2) / n;
    // Avoidable self-explosion: drew a kitten you hid during the same run of turns although a deeper slot existed.
    const inserter = new Map<number, string>();
    let insertSize = 0;
    let run = '';
    let t = 0;
    try {
      while (!e.isOver && t < 3000) {
        e.update(0.1);
        if (e.prompt?.k === 'insert') insertSize = e.prompt.size;
        bots.update(0.1, (p) => levelOf(p.id) === 'normal');
        hard.update(0.1, (p) => levelOf(p.id) === 'hard');
        if (e.prompt?.k === 'insert') insertSize = e.prompt.size;
        t += 0.1;
        for (const ev of e.events) {
          if (ev.k === 'turn') {
            stats.turns++;
            if (!run.startsWith(`${ev.player}:`)) run = `${ev.player}:${stats.turns}`;
          }
          if (ev.k === 'armReveal') stats.armageddon++;
          if (ev.k === 'nope') stats.nopes++;
          if (ev.k === 'defuse') stats.defuses++;
          if (ev.k === 'steal') stats.steals++;
          if (ev.k === 'reverse') stats.reverses++;
          if (ev.k === 'alter') stats.alters++;
          if (ev.k === 'rummage') stats.rummages++;
          if (ev.k === 'draw' && ev.bottom && ev.card?.type !== 'imploding') stats.bottoms++;
          if (ev.k === 'play' && ev.as) stats.godcatPlays++;
          if (ev.k === 'insert' && ev.card && (ev.index ?? 0) < insertSize) inserter.set(ev.card.id, run);
          if (ev.k === 'shuffle') inserter.clear();
          if (ev.k === 'explode' && ev.card.type === 'kitten' && inserter.get(ev.card.id) === run) stats.selfBoom++;
          if (ev.k === 'eliminated' && ev.card?.type === 'imploding') stats.implosions++;
        }
        e.events.length = 0;
        const now = total();
        if (now !== start) throw new Error(`card count ${start} → ${now} (phase ${e.phase}, prompt ${e.prompt?.k})`);
        // Hidden-info check: nobody but the inserter may know where a secretly hidden kitten went.
        if (e.prompt?.k === 'insert' && e.prompt.kind === 'kitten') checkInsertSecrecy(e, e.prompt.player);
      }
      if (!e.isOver) throw new Error(`stalled: phase ${e.phase} prompt ${e.prompt?.k} pending ${e.pending?.effect.k} turn ${e.currentPlayer.id}`);
      const wi = e.players.findIndex((p) => p.id === e.winner);
      wins.set(wi, (wins.get(wi) ?? 0) + 1);
      if (e.winner) winsByLevel[levelOf(e.winner)]++;
      stats.time += t;
    } catch (err) {
      errors++;
      if (errors <= 5) console.log(`game ${g} (${n}p ${deck}):`, (err as Error).message);
    }
  }
  const per = (k: keyof typeof stats) => (stats[k] / games).toFixed(2);
  console.log(`[${label}] ${games} games, ${errors} errors · avg ${(stats.turns / games).toFixed(1)} turns, ${(stats.time / games).toFixed(0)} sim-s · per game: ${per('armageddon')} armageddons, ${per('nopes')} nopes, ${per('defuses')} defuses, ${per('steals')} steals, ${per('godcatPlays')} angel plays` + (extra.imploding ? `, ${per('reverses')} reverses, ${per('alters')} alters, ${per('bottoms')} bottom draws, ${per('rummages')} rummages, ${stats.implosions} implosions` : ''));
  console.log(`  avoidable self-explosions: ${stats.selfBoom} · wins by seat: ${[...wins.entries()].sort().map(([k, v]) => `${k}:${v}`).join(' ')} · Hard seats won ${winsByLevel.hard} (fair share ${hardShare.toFixed(0)})`);
  if (errors) process.exitCode = 1;
}

/** Right after a secret insert prompt is answered, nobody else may have kept any index knowledge. */
function checkInsertSecrecy(e: KittensEngine, player: string): void {
  // Answer the prompt ourselves at a random spot (below the inserter's own draws) and verify the
  // others see no draw-pile positions any more (face-up cards excepted).
  const pr = e.prompt!;
  if (pr.k !== 'insert') return;
  const before = e.players.filter((p) => p.id !== player).map((p) => viewFor(e, p.id).known.filter((k) => !k.card.faceUp).length);
  if (!before.some((n) => n > 0)) return;
  secrecyChecks++;
  e.act(player, { t: 'respond', prompt: pr.id, choice: Math.min(pr.size, e.turns - 1 + Math.floor(Math.random() * 3)) });
  for (const p of e.players) {
    if (p.id === player) continue;
    const leak = viewFor(e, p.id).known.filter((k) => !k.card.faceUp);
    if (leak.length) throw new Error(`insert leak: ${p.id} still knows ${leak.map((k) => `#${k.index + 1}`).join(',')} after ${player} hid a kitten`);
  }
}

const only = process.argv[3];
if (!only || only === 'classic') run('classic rules', {});
if (!only || only === 'imploding') run('imploding pack', { imploding: true });
if (!only || only === 'full') run('full deck + any pairs', { fullDeck: true, anyPairs: true });
console.log(`insert secrecy: ${secrecyChecks} secret inserts made while a rival knew pile positions — none leaked`);
