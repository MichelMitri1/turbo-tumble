/**
 * Jackaroo: scripted rule probes + headless bot games with invariant checks after
 * every action (marble count, one marble per track square, protected start squares,
 * safe-zone rules re-verified from the event stream, 52-card conservation,
 * termination). Reports turns / captures / burns per game and team win rates by level.
 *   npx tsx tools/jackaroo-sim.ts [games=2000] [--quick]
 */
import { cardOf, type Card } from '../client/src/jackaroo/cards';
import {
  JackarooEngine,
  cardMoves,
  gateOf,
  isProtected,
  owner,
  SAFE0,
  startOf,
  TRACK,
  HOME,
  type Board,
  type GameEvent,
  type Mode,
  type Move,
} from '../client/src/jackaroo/engine';
import { BotDriver, chooseAction, type BotLevel } from '../client/src/jackaroo/bots';

const args = process.argv.slice(2);
const games = Number(args.find((a) => !a.startsWith('--')) ?? 2000);

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${detail}`}`);
}

// ============================================================================ probes

const C = (label: string): Card => {
  const m = /^(10|[A2-9JQK])([SHDC])$/.exec(label)!;
  const r = { A: 1, J: 11, Q: 12, K: 13 }[m[1] as 'A'] ?? Number(m[1]);
  return cardOf('SHDC'.indexOf(m[2]!) * 13 + r - 1);
};

/** A 4-player (or 2-player) table with a hand-made position: everyone home unless set. */
function table(mode: Mode, set: Record<number, number>, hands: Record<number, string[]>, n: 2 | 4 = 4): JackarooEngine {
  const seats = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, bot: true, avatar: i }));
  const e = new JackarooEngine(seats, { mode }, undefined, { noDeal: true });
  e.board.marbles.fill(HOME);
  for (const [m, pos] of Object.entries(set)) e.board.marbles[Number(m)] = pos;
  const used = new Set<number>();
  for (let p = 0; p < n; p++) {
    e.players[p]!.hand = (hands[p] ?? ['2C', '3C', '6C', '8C'].map((x) => x.replace('C', 'SHDC'[p]!))).map(C);
    for (const c of e.players[p]!.hand) used.add(c.id);
  }
  e.deck = e.deck.filter((c) => !used.has(c.id));
  e.cur = 0;
  e.events.length = 0;
  return e;
}
const same = (a: Move, b: Move) => JSON.stringify(a) === JSON.stringify(b);
const has = (moves: Move[], mv: Move) => moves.some((x) => same(x, mv));

function probes(): void {
  console.log('Rule probes');
  // Player 0: start 1, gate 0. Player 1: start 20. Player 2: start 39. Player 3: start 58.
  {
    const e = table('complex', { 0: 30, 4: 33, 8: 36, 12: 43 }, { 0: ['KH'] });
    const err = e.act('p0', { t: 'play', card: C('KH').id, move: { k: 'fwd', m: 0, n: 13 } });
    const b = e.board.marbles;
    check('Complex K sweep kills every marble passed + the one landed on', !err && b[0] === 43 && b[4] === HOME && b[8] === HOME && b[12] === HOME, `${err} ${b.slice(0, 16)}`);
    const mv = e.events.find((x) => x.k === 'move') as Extract<GameEvent, { k: 'move' }>;
    check('  sweep event lists the victims in passing order', !!mv?.kills && mv.kills.map((k) => k.m).join() === '4,8', JSON.stringify(mv));
  }
  {
    const e = table('complex', { 0: 15, 4: 20, 5: 17 }, { 0: ['KH'] });
    check('Complex K cannot pass a marble protected on its own start', !has(e.movesFor(0, C('KH')), { k: 'fwd', m: 0, n: 13 }));
    const e2 = table('classic', { 0: 15, 4: 20 }, { 0: ['KH'] });
    check('Classic K cannot pass a protected start either', !has(e2.movesFor(0, C('KH')), { k: 'fwd', m: 0, n: 13 }));
    const e3 = table('classic', { 0: 15, 5: 22 }, { 0: ['KH'] });
    check('Classic K passes ordinary marbles without killing them', !e3.act('p0', { t: 'play', card: C('KH').id, move: { k: 'fwd', m: 0, n: 13 } }) && e3.board.marbles[5] === 22);
  }
  {
    const e = table('classic', { 0: 1 }, { 0: ['4H', '5H'], 1: ['2S', '3S', '6S', '8S'] });
    const err1 = e.act('p0', { t: 'play', card: C('4H').id, move: { k: 'back', m: 0 } });
    const at = e.board.marbles[0];
    e.cur = 0;
    const err2 = e.act('p0', { t: 'play', card: C('5H').id, move: { k: 'fwd', m: 0, n: 5 } });
    check('4 backward from the start, then a 5 forward, lands in the safe zone', !err1 && at === 73 && !err2 && e.board.marbles[0] === SAFE0 + 1, `${err1} ${at} ${err2} ${e.board.marbles[0]}`);
  }
  {
    const e = table('classic', { 0: 75 }, { 0: ['6H', '5H'] });
    check("Can't overshoot the safe zone (75 + 6)", !has(e.movesFor(0, C('6H')), { k: 'fwd', m: 0, n: 6 }));
    check('Exact count to the last safe hole is fine (75 + 5)', has(e.movesFor(0, C('5H')), { k: 'fwd', m: 0, n: 5 }));
    const e2 = table('classic', { 0: 75, 1: SAFE0 + 2 }, { 0: ['5H', '3H'] });
    check("Can't jump over my own marble inside the safe zone", !has(e2.movesFor(0, C('5H')), { k: 'fwd', m: 0, n: 5 }) && has(e2.movesFor(0, C('3H')), { k: 'fwd', m: 0, n: 3 }));
    const e3 = table('classic', { 0: SAFE0, 1: SAFE0 + 3 }, { 0: ['2H', '3H'] });
    check('Safe-zone marbles move on with an exact count', has(e3.movesFor(0, C('2H')), { k: 'fwd', m: 0, n: 2 }) && !has(e3.movesFor(0, C('3H')), { k: 'fwd', m: 0, n: 3 }));
    const e4 = table('classic', { 0: 0 }, { 0: ['10H'] });
    check('A marble on its gate must go in (no second lap)', !e4.movesFor(0, C('10H')).length);
  }
  {
    const e = table('classic', { 0: 10, 1: 1, 4: 20, 8: SAFE0, 12: 50 }, { 0: ['JH'] });
    const moves = e.movesFor(0, C('JH'));
    check('J swaps only unprotected track marbles (not home / safe / own start)', moves.length === 1 && same(moves[0]!, { k: 'swap', m: 0, t: 12 }), JSON.stringify(moves));
    e.act('p0', { t: 'play', card: C('JH').id, move: { k: 'swap', m: 0, t: 12 } });
    check('  the swap trades places', e.board.marbles[0] === 50 && e.board.marbles[12] === 10);
  }
  {
    const e = table('classic', { 0: 10, 1: 30, 4: 13, 12: 34 }, { 0: ['7H'] });
    const err = e.act('p0', { t: 'play', card: C('7H').id, move: { k: 'split', parts: [{ m: 0, n: 3 }, { m: 1, n: 4 }] } });
    const caps = e.events.filter((x) => x.k === 'capture').map((x) => (x as { m: number }).m);
    check('7 split: both parts capture', !err && caps.join() === '4,12' && e.board.marbles[4] === HOME && e.board.marbles[12] === HOME, `${err} ${caps}`);
    const e2 = table('classic', { 0: 10, 1: 12 }, { 0: ['7H'] });
    check("7 split can't land on my own marble", !has(e2.movesFor(0, C('7H')), { k: 'split', parts: [{ m: 0, n: 2 }, { m: 1, n: 5 }] }) && has(e2.movesFor(0, C('7H')), { k: 'split', parts: [{ m: 0, n: 3 }, { m: 1, n: 4 }] }));
    const e3 = table('classic', { 0: 70, 1: 30 }, { 0: ['7H'] });
    check('7 split part can enter the safe zone', has(e3.movesFor(0, C('7H')), { k: 'split', parts: [{ m: 0, n: 7 }] }) && has(e3.movesFor(0, C('7H')), { k: 'split', parts: [{ m: 0, n: 6 }, { m: 1, n: 1 }] }));
  }
  {
    const e = table('classic', {}, { 0: ['2H', '3S', '9D', 'QH'] });
    check('No legal move → canMove is false', !e.canMove(0));
    const errPlay = e.act('p0', { t: 'play', card: C('2H').id, move: { k: 'fwd', m: 0, n: 2 } });
    const errBurn = e.act('p0', { t: 'burn', card: C('9D').id });
    check('  playing is refused, burning works (card → fire pile)', !!errPlay && !errBurn && e.fire.some((c) => c.id === C('9D').id) && e.players[0]!.hand.length === 3);
    const e2 = table('classic', { 0: 10 }, { 0: ['2H', '3S'] });
    check("Can't burn while holding a legal move", !!e2.act('p0', { t: 'burn', card: C('2H').id }));
  }
  {
    const e = table('classic', { 0: SAFE0, 1: SAFE0 + 1, 2: SAFE0 + 2, 3: SAFE0 + 3, 8: 40 }, { 0: ['5H', 'AH'] });
    const five = e.movesFor(0, C('5H'));
    const ace = e.movesFor(0, C('AH'));
    check('Finished player moves the partner’s marbles', has(five, { k: 'fwd', m: 8, n: 5 }) && has(ace, { k: 'out', m: 9 }));
    e.act('p0', { t: 'play', card: C('AH').id, move: { k: 'out', m: 9 } });
    check('  bringing out goes to the partner’s start square', e.board.marbles[9] === startOf(4, 2));
  }
  {
    const e = table('complex', {}, { 0: ['10H', 'QS', 'QH', '10C'], 1: ['2S', '3S', '6S', '8S'] });
    check('Complex 10 / black Q can make the next player discard; red Q cannot', has(e.movesFor(0, C('10H')), { k: 'attack' }) && has(e.movesFor(0, C('QS')), { k: 'attack' }) && !has(e.movesFor(0, C('QH')), { k: 'attack' }));
    const err = e.act('p0', { t: 'play', card: C('QS').id, move: { k: 'attack' } });
    const burn = e.events.find((x) => x.k === 'burn') as Extract<GameEvent, { k: 'burn' }>;
    check('  next player loses a random card to the fire', !err && e.players[1]!.hand.length === 3 && e.fire.length === 1 && burn?.why === 'attack' && burn.p === 1);
    const c = table('classic', {}, { 0: ['10H', 'QS'] });
    check('  Classic has no discard option', !has(c.movesFor(0, C('10H')), { k: 'attack' }) && !has(c.movesFor(0, C('QS')), { k: 'attack' }));
  }
  {
    const e = table('classic', { 4: 1 }, { 0: ['KH'] });
    e.act('p0', { t: 'play', card: C('KH').id, move: { k: 'out', m: 0 } });
    check('Bringing out onto an opponent on my start captures it', e.board.marbles[0] === 1 && e.board.marbles[4] === HOME);
    const e2 = table('classic', { 0: 1 }, { 0: ['KH'] });
    check("Can't bring out onto my own marble", !has(e2.movesFor(0, C('KH')), { k: 'out', m: 1 }));
    const e3 = table('classic', { 0: 10, 1: 12 }, { 0: ['2H'] });
    check("Can't land on my own marble", !has(e3.movesFor(0, C('2H')), { k: 'fwd', m: 0, n: 2 }));
    const e4 = table('classic', { 0: 1, 1: 3 }, { 0: ['4H'] });
    check('My own protected marble blocks my backward move', !has(e4.movesFor(0, C('4H')), { k: 'back', m: 1 }));
  }
  {
    const e = table('complex', { 4: 15, 5: 20, 0: 30 }, { 0: ['5H'] });
    const moves = e.movesFor(0, C('5H'));
    check('Complex 5 moves any track marble, but not a protected one', has(moves, { k: 'fwd', m: 4, n: 5 }) && has(moves, { k: 'fwd', m: 0, n: 5 }) && !has(moves, { k: 'fwd', m: 5, n: 5 }));
    const e2 = table('complex', { 4: 17 }, { 0: ['5H'] });
    e2.act('p0', { t: 'play', card: C('5H').id, move: { k: 'fwd', m: 4, n: 5 } });
    check('  an opponent pushed past its gate goes into its own safe zone', e2.board.marbles[4] === SAFE0 + 2, String(e2.board.marbles[4]));
    const c = table('classic', { 4: 15 }, { 0: ['5H'] });
    check('  Classic 5 only moves my own marbles', !has(c.movesFor(0, C('5H')), { k: 'fwd', m: 4, n: 5 }));
  }
  {
    const e = table('classic', {}, {}, 2);
    check('1v1 seats players on opposite quadrants', startOf(2, 0) === 1 && startOf(2, 1) === 39 && gateOf(2, 1) === 38);
    e.board.marbles.splice(0, 8, SAFE0 + 1, SAFE0 + 2, SAFE0 + 3, 75, HOME, HOME, HOME, HOME);
    e.players[0]!.hand = [C('2H')];
    e.act('p0', { t: 'play', card: C('2H').id, move: { k: 'fwd', m: 3, n: 2 } });
    check('1v1: first to bring all four home wins', e.isOver && e.winner === 0);
  }
  {
    // Dealing: 5 + 4 + 4 per deck with four players, deck reshuffled after 3 hands.
    const seats = Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, bot: true, avatar: i }));
    const e = new JackarooEngine(seats, { mode: 'classic' });
    const sizes: number[] = [];
    let shuffles = 0;
    const drv = new BotDriver(e, 'normal');
    for (let i = 0; i < 400 && !e.isOver; i++) {
      for (const ev of e.events.splice(0)) {
        if (ev.k === 'hand') sizes.push(ev.size);
        if (ev.k === 'shuffle') shuffles++;
      }
      drv.step();
    }
    check('Deal sizes cycle 5,4,4 and a new deck follows', sizes.slice(0, 6).join() === '5,4,4,5,4,4' && shuffles >= 1, sizes.join());
  }
}

// ============================================================================ games

interface Tally {
  games: number;
  turns: number;
  captures: number;
  burns: number;
  attacks: number;
  sweepKills: number;
  outs: number;
}

/** Re-verify one event against a shadow copy of the board (independent of the engine's own checks). */
function verify(shadow: Board, ev: GameEvent, fail: (msg: string) => void): void {
  const at = (sq: number) => shadow.marbles.findIndex((p) => p === sq);
  const prot = (m: number) => m >= 0 && shadow.marbles[m] === startOf(shadow.n, owner(m));
  switch (ev.k) {
    case 'out': {
      if (shadow.marbles[ev.m] !== HOME) fail(`out: marble ${ev.m} was not home`);
      const s = startOf(shadow.n, owner(ev.m));
      const o = at(s);
      if (o >= 0 && owner(o) === owner(ev.m)) fail('out onto own marble');
      shadow.marbles[ev.m] = s;
      break;
    }
    case 'move': {
      let p = shadow.marbles[ev.m]!;
      if (p < 0) fail(`move from home ${ev.m}`);
      const me = owner(ev.m);
      const gate = gateOf(shadow.n, me);
      const killed = new Set((ev.kills ?? []).map((k) => k.m));
      ev.path.forEach((q, i) => {
        const expect = ev.back ? (p >= SAFE0 ? -99 : (p + TRACK - 1) % TRACK) : p >= SAFE0 ? p + 1 : p === gate ? SAFE0 : (p + 1) % TRACK;
        if (q !== expect) fail(`bad step ${p}→${q} (marble ${ev.m}, expected ${expect})`);
        if (q > SAFE0 + 3) fail('overshot the safe zone');
        const o = q < SAFE0 ? at(q) : shadow.marbles.findIndex((x, j) => x === q && owner(j) === me && j !== ev.m);
        if (o >= 0 && o !== ev.m) {
          if (q >= SAFE0) fail('jumped / landed on own marble in the safe zone');
          else if (prot(o)) fail(`passed / landed on protected marble ${o} at ${q}`);
          else if (i < ev.path.length - 1 && ev.kills && !killed.has(o)) fail('sweep missed a victim');
          else if (i === ev.path.length - 1 && owner(o) === me) fail('landed on own marble');
        }
        p = q;
      });
      for (const k of killed) shadow.marbles[k] = HOME;
      shadow.marbles[ev.m] = p;
      break;
    }
    case 'capture': {
      if (prot(ev.m)) fail('captured a protected marble');
      if (shadow.marbles[ev.m] !== shadow.marbles[ev.by]) fail('capture: victim not on the capturer’s square');
      shadow.marbles[ev.m] = HOME;
      break;
    }
    case 'swap': {
      for (const x of [ev.a, ev.b]) {
        const p = shadow.marbles[x]!;
        if (p < 0 || p >= SAFE0) fail('swapped a home / safe marble');
        if (prot(x)) fail('swapped a protected marble');
      }
      const t = shadow.marbles[ev.a]!;
      shadow.marbles[ev.a] = shadow.marbles[ev.b]!;
      shadow.marbles[ev.b] = t;
      break;
    }
  }
}

function runGames(): void {
  const levels: BotLevel[] = ['easy', 'normal', 'hard'];
  const matchups: Array<[BotLevel, BotLevel]> = [
    ['hard', 'normal'],
    ['normal', 'easy'],
    ['hard', 'easy'],
  ];
  const wins = new Map<string, [number, number]>();
  const tally: Record<string, Tally> = {};
  let errors = 0;
  let stalls = 0;
  const t0 = performance.now();
  for (let g = 0; g < games; g++) {
    const mode: Mode = g % 2 ? 'complex' : 'classic';
    const n: 2 | 4 = g % 4 < 2 ? 4 : 2;
    // Every 4th game is fully mixed (random level per seat), the rest are team matchups with sides alternating.
    const mixed = g % 7 === 6;
    const [la, lb] = matchups[Math.floor(g / 4) % matchups.length]!;
    const flip = Math.floor(g / 12) % 2 === 1;
    const lvl: BotLevel[] = Array.from({ length: n }, (_, p) => (mixed ? levels[Math.floor(Math.random() * 3)]! : (p % 2 === 0) !== flip ? la : lb));
    const seats = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, bot: true, avatar: i }));
    const key = `${mode} ${n === 4 ? '2v2' : '1v1'}`;
    const T = (tally[key] ??= { games: 0, turns: 0, captures: 0, burns: 0, attacks: 0, sweepKills: 0, outs: 0 });
    let e: JackarooEngine;
    try {
      e = new JackarooEngine(seats, { mode });
    } catch (err) {
      errors++;
      console.log('engine error at start', err);
      continue;
    }
    const shadow: Board = { n, mode, marbles: e.board.marbles.slice() };
    const fail = (msg: string) => {
      errors++;
      if (errors < 15) console.log(`  invariant: ${msg} (game ${g}, ${key})`);
    };
    let actions = 0;
    let safeBefore = e.board.marbles.slice();
    while (!e.isOver && actions < 3000) {
      try {
        const a = chooseAction(e, e.cur, lvl[e.cur]!);
        const err = e.act(e.current.id, a);
        if (err) fail(`bot action refused: ${err} ${JSON.stringify(a)}`);
      } catch (err) {
        fail(`engine threw: ${(err as Error).stack}`);
        break;
      }
      actions++;
      for (const ev of e.events.splice(0)) {
        verify(shadow, ev, fail);
        if (ev.k === 'capture') T.captures++;
        if (ev.k === 'burn') ev.why === 'attack' ? T.attacks++ : T.burns++;
        if (ev.k === 'move' && ev.kills) T.sweepKills += ev.kills.length;
        if (ev.k === 'out') T.outs++;
        if (ev.k === 'turn') T.turns++;
      }
      const b = e.board.marbles;
      if (b.length !== n * 4) fail('marble count changed');
      if (b.some((p, i) => p !== shadow.marbles[i])) {
        fail(`shadow board diverged ${b} vs ${shadow.marbles}`);
        shadow.marbles = b.slice();
      }
      const seen = new Set<number>();
      for (let m = 0; m < b.length; m++) {
        const p = b[m]!;
        if (p < HOME || p > SAFE0 + 3) fail(`bad position ${p}`);
        const k = p >= SAFE0 ? 1000 + owner(m) * 10 + p : p;
        if (p !== HOME) {
          if (seen.has(k)) fail(`two marbles share square ${p}`);
          seen.add(k);
        }
        if (safeBefore[m]! >= SAFE0 && p < safeBefore[m]!) fail('a safe-zone marble went backwards / left');
      }
      safeBefore = b.slice();
      const ids = [...e.deck, ...e.discard, ...e.fire, ...e.players.flatMap((p) => p.hand)].map((c) => c.id);
      if (ids.length !== 52 || new Set(ids).size !== 52) fail(`card conservation: ${ids.length} / ${new Set(ids).size}`);
      void isProtected;
    }
    T.games++;
    if (!e.isOver) {
      stalls++;
      continue;
    }
    if (!mixed && la !== lb) {
      const winLevel = lvl[e.winner]!;
      const k2 = `${la} vs ${lb}`;
      const w = wins.get(k2) ?? [0, 0];
      w[winLevel === la ? 0 : 1]++;
      wins.set(k2, w);
    }
  }
  const secs = (performance.now() - t0) / 1000;
  console.log(`\n${games} bot games in ${secs.toFixed(1)} s · engine/invariant errors ${errors} · unfinished ${stalls}`);
  for (const [k, T] of Object.entries(tally)) {
    const f = (x: number) => (x / Math.max(1, T.games)).toFixed(1);
    console.log(`  ${k.padEnd(16)} ${String(T.games).padStart(5)} games · turns ${f(T.turns)} · captures ${f(T.captures)} · burns ${f(T.burns)} · attack-discards ${f(T.attacks)} · K-sweep kills ${f(T.sweepKills)} · bring-outs ${f(T.outs)}`);
  }
  for (const [k, [a, b]] of wins) console.log(`  ${k.padEnd(18)} ${a}–${b}  → ${k.split(' ')[0]} wins ${((100 * a) / Math.max(1, a + b)).toFixed(1)}%`);
  if (errors || stalls) failures++;
}

probes();
if (!args.includes('--probes')) runGames();
console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll good.');
process.exit(failures ? 1 : 0);
