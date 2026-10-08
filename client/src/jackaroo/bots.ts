import type { Card } from './cards';
import {
  applyMove,
  cardMoves,
  cloneBoard,
  controlledOwner,
  gateOf,
  HOME,
  isProtected,
  owner,
  SAFE0,
  startOf,
  teamOf,
  TRACK,
  type Action,
  type Board,
  type JackarooEngine,
  type Move,
} from './engine';

export type BotLevel = 'easy' | 'normal' | 'hard';

/** Evaluation weights per level. */
export interface Weights {
  riskW: number;
  oppW: number;
  prot: number;
  mob1: number;
  mob2: number;
  safeBonus: number;
  /** Per free safe hole deeper than one of my safe marbles (it blocks the ones still coming). */
  gap: number;
  keepA: number;
  keep: number;
  potential: number;
  look: number;
  burnPen: number;
  holds: boolean;
  topK: number;
}
const NORMAL: Weights = { riskW: 0.85, oppW: 1, prot: 2, mob1: 10, mob2: 14, safeBonus: 4, gap: 4, keepA: 0.6, keep: 0.5, potential: 0, look: 0, burnPen: 12, holds: false, topK: 1 };
/** Hard's weights (exported so tools/jackaroo-sim.ts and benches can tune them). */
export const TUNE: Weights = { ...NORMAL, safeBonus: 12, gap: 25, mob1: 5, mob2: 7, potential: 0.5, look: 0.5, holds: true, topK: 6 };

const PACE: Record<BotLevel, [number, number]> = {
  easy: [0.9, 1.6],
  normal: [0.8, 1.4],
  hard: [0.7, 1.2],
};

/** Share of a 52-card deck that moves a marble exactly d squares forward (index d = 1…13; 7 splits count for d ≤ 7). */
const F_FWD = [0, 8, 8, 8, 4, 8, 8, 4, 4, 4, 4, 4, 4, 4].map((x) => x / 52);
/** Ranks that can move exactly d forward (for card counting). */
const RANKS_FOR: number[][] = [[], [1, 7], [2, 7], [3, 7], [7], [5, 7], [6, 7], [7], [8], [9], [10], [1], [12], [13]];

/** Everything the evaluation knows beyond the board: hand sizes and (hard) which ranks are still unseen. */
interface Ctx {
  n: number;
  /** Hand size per player (after the move being evaluated). */
  hands: number[];
  /** P(player q holds at least one card of rank r) — null = use the plain deck odds. */
  holds: ((q: number, r: number) => number) | null;
  complex: boolean;
}

/** How far marble m has come: home 0, track 14 + squares travelled, safe zone ~96–102. */
function progress(b: Board, m: number, safeBonus = 0): number {
  const pos = b.marbles[m]!;
  if (pos < 0) return 0;
  if (pos >= SAFE0) return 96 + safeBonus + (pos - SAFE0) * 2;
  const gate = gateOf(b.n, owner(m));
  const toGate = (gate - pos + TRACK) % TRACK;
  return 14 + (75 - toGate);
}

/** Probability that player q can make a move covering distance d (1–13) on their next turn. */
function pDist(ctx: Ctx, q: number, d: number, back = false): number {
  const h = ctx.hands[q] ?? 0;
  if (!h) return 0;
  if (back) return ctx.holds ? ctx.holds(q, 4) : 1 - (1 - 4 / 52) ** h;
  if (ctx.holds) {
    let miss = 1;
    for (const r of RANKS_FOR[d]!) miss *= 1 - ctx.holds(q, r);
    return 1 - miss;
  }
  return 1 - (1 - F_FWD[d]!) ** h;
}

/**
 * Chance each marble gets sent home before its owner's team moves again: opponents
 * behind it within 13 (forward hits, King sweeps in Complex), 4 ahead of it
 * (backward hits), or it sits on an opponent's start square while they have
 * marbles at home (bring-out captures).
 */
function risks(b: Board, ctx: Ctx, team: number): Float32Array {
  const risk = new Float32Array(b.marbles.length);
  const n = b.n;
  for (let m = 0; m < b.marbles.length; m++) {
    const pos = b.marbles[m]!;
    if (pos < 0 || pos >= SAFE0 || teamOf(n, owner(m)) !== team || isProtected(b, m)) continue;
    let safe = 1;
    for (let q = 0; q < n; q++) {
      if (teamOf(n, q) === team) continue;
      const c = controlledOwner(b, q);
      let missQ = 1;
      let homeCount = 0;
      for (let k = 0; k < 4; k++) {
        const a = c * 4 + k;
        const pa = b.marbles[a]!;
        if (pa === HOME) {
          homeCount++;
          continue;
        }
        if (pa >= SAFE0) continue;
        const d = (pos - pa + TRACK) % TRACK;
        if (d >= 1 && d <= 13) {
          // Its own gate comes first: it turns into its safe zone instead.
          const toGate = (gateOf(n, c) - pa + TRACK) % TRACK;
          if (toGate >= d && !blocked(b, pa, d)) {
            let p = pDist(ctx, q, d);
            if (ctx.complex && d < 13) p = 1 - (1 - p) * (1 - pDist(ctx, q, 13));
            missQ *= 1 - p;
          }
        }
        const ahead = (pa - pos + TRACK) % TRACK;
        if (ahead === 4 && !blocked(b, pos, 4)) missQ *= 1 - pDist(ctx, q, 4, true);
      }
      if (homeCount && pos === startOf(n, c)) missQ *= 1 - pDist(ctx, q, 1) * 0.9 - 0.05;
      safe *= Math.max(0, missQ);
    }
    risk[m] = 1 - safe;
  }
  return risk;
}

/** Is there a protected marble strictly between from and from + d? */
function blocked(b: Board, from: number, d: number): boolean {
  for (let i = 1; i < d; i++) {
    const sq = (from + i) % TRACK;
    for (let m = 0; m < b.marbles.length; m++) if (b.marbles[m] === sq && isProtected(b, m)) return true;
  }
  return false;
}

/** Board value for a team: its progress minus what is at risk, minus the opponents' progress. */
export function evaluate(b: Board, ctx: Ctx, team: number, w: Weights, riskW = w.riskW): number {
  const n = b.n;
  const risk = risks(b, ctx, team);
  let s = 0;
  const onTrack = new Array(n).fill(0);
  for (let m = 0; m < b.marbles.length; m++) {
    const o = owner(m);
    const pos = b.marbles[m]!;
    const v = progress(b, m, w.safeBonus);
    if (teamOf(n, o) === team) {
      s += v - risk[m]! * v * riskW;
      if (pos >= 0 && pos < SAFE0) onTrack[o]++;
      // Sitting on my own start blocks everyone coming round behind me.
      if (isProtected(b, m)) s += w.prot;
    } else s -= v * w.oppW;
  }
  // Mobility: a player with no marble out can only use an Ace or a King.
  for (let q = 0; q < n; q++) {
    if (teamOf(n, q) !== team) continue;
    const c = controlledOwner(b, q);
    let out = 0;
    for (let k = 0; k < 4; k++) {
      const pos = b.marbles[c * 4 + k]!;
      if (pos >= 0 && pos < SAFE0) out++;
    }
    s += out >= 2 ? w.mob2 : out === 1 ? w.mob1 : 0;
  }
  if (w.gap) {
    for (let q = 0; q < n; q++) {
      if (teamOf(n, q) !== team) continue;
      let filled = 0;
      for (let k = 0; k < 4; k++) {
        const pos = b.marbles[q * 4 + k]!;
        if (pos >= SAFE0) filled |= 1 << (pos - SAFE0);
      }
      for (let slot = 0; slot < 4; slot++) if (filled & (1 << slot)) for (let j = slot + 1; j < 4; j++) if (!(filled & (1 << j))) s -= w.gap;
    }
  }
  return s;
}

/** How much a card is worth keeping for later (spent first when it's worth little). */
function keepValue(b: Board, p: number, c: Card): number {
  const ctl = controlledOwner(b, p);
  let home = 0;
  for (let k = 0; k < 4; k++) if (b.marbles[ctl * 4 + k] === HOME) home++;
  switch (c.r) {
    case 1:
    case 13:
      return home ? 8 + home * 2.5 : 2.5;
    case 4:
      return 3;
    case 7:
      return 3.5;
    case 11:
      return 2.5;
    case 5:
      return b.mode === 'complex' ? 2 : 0.5;
    case 10:
      return b.mode === 'complex' ? 1.5 : 0.6;
    default:
      return c.r / 26;
  }
}

/** What making the next player throw away a random card is worth (Complex 10 / black Queen). */
function attackValue(e: JackarooEngine, p: number): number {
  const b = e.board;
  const q = (p + 1) % e.n;
  const h = e.players[q]!.hand.length;
  if (!h) return -99;
  // Hurts most when their team is close to finishing or they hold few cards.
  const team = teamOf(b.n, q);
  let safe = 0;
  for (let m = 0; m < b.marbles.length; m++) if (teamOf(b.n, owner(m)) === team && b.marbles[m]! >= SAFE0) safe++;
  const total = b.n === 4 ? 8 : 4;
  return 5 + 14 * (safe / total) + (h <= 2 ? 6 : 0);
}

function handsAfter(e: JackarooEngine, p: number, mv: Move | null): number[] {
  const hands = e.players.map((pl) => pl.hand.length);
  hands[p] = Math.max(0, hands[p]! - 1);
  if (mv?.k === 'attack') hands[(p + 1) % e.n] = Math.max(0, hands[(p + 1) % e.n]! - 1);
  // Between deals everybody gets fresh cards: assume a full hand for the empty ones.
  return hands.map((h) => (h === 0 ? 4 : h));
}

/** Card counting: P(player q holds at least one card of rank r), from the cards nobody has seen yet. */
function holdsFn(e: JackarooEngine, p: number): (q: number, r: number) => number {
  const unseen = new Array(14).fill(4);
  unseen[0] = 0;
  for (const c of [...e.players[p]!.hand, ...e.discard, ...e.fire]) unseen[c.r]--;
  const U = unseen.reduce((a, b) => a + b, 0);
  const cache = new Map<number, number>();
  return (q, r) => {
    const h = Math.min(U, e.players[q]!.hand.length || 4);
    const key = r * 64 + h;
    let v = cache.get(key);
    if (v === undefined) {
      // 1 − C(U − u, h) / C(U, h)
      let miss = 1;
      for (let i = 0; i < h; i++) miss *= Math.max(0, U - unseen[r]! - i) / Math.max(1, U - i);
      v = 1 - miss;
      cache.set(key, v);
    }
    return v;
  };
}

interface Option {
  card: Card;
  move: Move;
  score: number;
}

/** Score every legal (card, move) for player p. */
function scoreAll(e: JackarooEngine, p: number, level: BotLevel): Option[] {
  const b = e.board;
  const team = teamOf(b.n, p);
  const hand = e.players[p]!.hand;
  const w = level === 'hard' ? TUNE : NORMAL;
  const holds = w.holds ? holdsFn(e, p) : null;
  const opts: Option[] = [];
  for (const card of hand) {
    const moves = e.movesFor(p, card);
    for (const mv of moves) {
      const ctx: Ctx = { n: b.n, hands: handsAfter(e, p, mv), holds, complex: b.mode === 'complex' };
      let score: number;
      const t = cloneBoard(b);
      if (mv.k === 'attack') score = evaluate(b, ctx, team, w) + attackValue(e, p);
      else {
        applyMove(t, p, card, mv);
        score = evaluate(t, ctx, team, w);
        // An Ace / King spent on a move while marbles wait at home.
        if ((card.r === 1 || card.r === 13) && mv.k !== 'out') score -= keepValue(b, p, card) * w.keepA;
      }
      score -= keepValue(b, p, card) * w.keep;
      if (w.potential) score += w.potential * handPotential(t, p, hand, card, ctx, team, w);
      opts.push({ card, move: mv, score });
    }
  }
  return opts;
}

/** Hard: what my remaining cards can still do from here next turn (planning with the hand I hold). */
function handPotential(t: Board, p: number, hand: Card[], played: Card, ctx: Ctx, team: number, w: Weights): number {
  const base = evaluate(t, ctx, team, w);
  let best = -Infinity;
  for (const c of hand) {
    if (c === played) continue;
    for (const mv of cardMoves(t, p, c, true)) {
      if (mv.k === 'attack') {
        best = Math.max(best, 4);
        continue;
      }
      const u = cloneBoard(t);
      applyMove(u, p, c, mv);
      best = Math.max(best, evaluate(u, ctx, team, w) - base);
    }
  }
  if (best === -Infinity) return hand.length > 1 ? -w.burnPen : 0;
  return best;
}

/** Hard: how much the next opponent can hurt us after this move (expected best reply, by card counting). */
function replyThreat(e: JackarooEngine, p: number, card: Card, mv: Move): number {
  const b = e.board;
  const t = cloneBoard(b);
  if (mv.k !== 'attack') applyMove(t, p, card, mv);
  const q = (p + 1) % e.n;
  const qTeam = teamOf(b.n, q);
  const holds = holdsFn(e, p);
  const hands = handsAfter(e, p, mv);
  const ctx: Ctx = { n: b.n, hands, holds, complex: b.mode === 'complex' };
  const before = evaluate(t, ctx, qTeam, NORMAL, 0);
  const gains: Array<{ g: number; p: number }> = [];
  for (let r = 1; r <= 13; r++) {
    const ph = holds(q, r);
    if (ph <= 0.001) continue;
    const suits: Card['s'][] = r === 12 && b.mode === 'complex' ? ['S', 'H'] : ['H'];
    let best = 0;
    for (const s of suits) {
      const c: Card = { id: -1, r, s };
      for (const m2 of cardMoves(t, q, c, true)) {
        if (m2.k === 'attack') continue;
        const u = cloneBoard(t);
        applyMove(u, q, c, m2);
        best = Math.max(best, evaluate(u, ctx, qTeam, NORMAL, 0) - before);
      }
    }
    if (best > 0) gains.push({ g: best, p: ph });
  }
  gains.sort((a, b2) => b2.g - a.g);
  let left = 1;
  let exp = 0;
  for (const x of gains) {
    exp += x.g * x.p * left;
    left *= 1 - x.p;
  }
  return exp;
}

/** The bots' choice for player p (also used for idle / disconnected humans). */
export function chooseAction(e: JackarooEngine, p: number, level: BotLevel): Action {
  const hand = e.players[p]!.hand;
  const opts = scoreAll(e, p, level);
  if (!opts.length) {
    // Nothing playable: burn the card worth least.
    let worst = hand[0]!;
    for (const c of hand) if (keepValue(e.board, p, c) < keepValue(e.board, p, worst)) worst = c;
    if (level === 'easy' && Math.random() < 0.5) worst = hand[Math.floor(Math.random() * hand.length)]!;
    return { t: 'burn', card: worst.id };
  }
  if (level === 'easy') {
    for (const o of opts) o.score += Math.random() * 28;
    if (Math.random() < 0.25) {
      const o = opts[Math.floor(Math.random() * opts.length)]!;
      return { t: 'play', card: o.card.id, move: o.move };
    }
  }
  opts.sort((a, b) => b.score - a.score);
  if (level === 'hard' && opts.length > 1) {
    // Look one turn ahead on the best few: subtract the next opponent's expected best reply.
    const top = opts.slice(0, TUNE.topK);
    if (TUNE.look) for (const o of top) o.score -= replyThreat(e, p, o.card, o.move) * TUNE.look;
    top.sort((a, b) => b.score - a.score);
    return { t: 'play', card: top[0]!.card.id, move: top[0]!.move };
  }
  return { t: 'play', card: opts[0]!.card.id, move: opts[0]!.move };
}

/**
 * Drives every bot seat with human-ish pacing. Online the server's bots also wait
 * for the previous move's animations (animHint) so clients keep up.
 */
export class BotDriver {
  private wait = 0;
  private key = '';

  constructor(
    private readonly e: JackarooEngine,
    readonly level: BotLevel = 'normal',
    /** Which seats this driver controls (default: every bot). */
    private readonly drives: (id: string) => boolean = () => true,
    private readonly waitForAnims = false,
  ) {}

  update(dt: number): void {
    const e = this.e;
    if (e.phase !== 'play') return;
    const p = e.current;
    if (!p.bot || !this.drives(p.id)) return;
    const key = `${e.turns}:${e.cur}`;
    if (key !== this.key) {
      this.key = key;
      const [a, b] = PACE[this.level];
      this.wait = a + Math.random() * (b - a) + (this.waitForAnims ? e.animHint : 0);
    }
    this.wait -= dt;
    if (this.wait > 0) return;
    this.key = '';
    const err = e.act(p.id, chooseAction(e, e.cur, this.level));
    if (err) e.autoAct(p.id);
  }

  /** Act right away (the sim). */
  step(): void {
    const e = this.e;
    if (e.phase !== 'play') return;
    const p = e.current;
    if (!p.bot || !this.drives(p.id)) return;
    const err = e.act(p.id, chooseAction(e, e.cur, this.level));
    if (err) e.autoAct(p.id);
  }
}
