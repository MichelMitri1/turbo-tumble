import { HEARTS, card, rankOf, suitOf, trickWinner, type Suit } from './cards';
import { FourHundredEngine, minTotal, type Player } from './engine';

export type BotLevel = 'easy' | 'normal' | 'hard';

/** How many tricks this hand should take on its own (hearts are trump). */
export function estimateTricks(hand: number[]): number {
  const bySuit: number[][] = [[], [], [], []];
  for (const c of hand) bySuit[suitOf(c)]!.push(rankOf(c));
  for (const s of bySuit) s.sort((a, b) => b - a);
  const hearts = bySuit[HEARTS]!;
  const h = hearts.length;
  let est = 0;
  // Trumps: honours count by length; long trumps win late.
  const has = (r: number) => hearts.includes(r);
  if (has(12)) est += 1;
  if (has(11)) est += h >= 2 ? 0.95 : 0.4;
  if (has(10)) est += h >= 3 ? 0.8 : 0.3;
  if (has(9)) est += h >= 4 ? 0.55 : 0.15;
  est += Math.max(0, h - 4) * 0.85;
  // Side suits: aces and protected kings; shortness lets spare trumps ruff.
  let spare = Math.max(0, h - 2);
  for (const s of [0, 2, 3] as Suit[]) {
    const r = bySuit[s]!;
    const n = r.length;
    if (r.includes(12)) est += n <= 6 ? 0.95 : 0.7;
    if (r.includes(11)) est += n >= 2 ? (r.includes(12) ? 0.85 : 0.6) : 0.2;
    if (r.includes(10) && n >= 3 && (r.includes(12) || r.includes(11))) est += 0.35;
    if (spare > 0 && n <= 2) {
      const ruffs = Math.min(spare, n === 0 ? 2 : n === 1 ? 1 : 0.5);
      est += ruffs * 0.75;
      spare -= Math.ceil(ruffs);
    }
  }
  return est;
}

/** Plays for every bot seat (and anyone who disconnected), with small human-like delays. */
export class BotDriver {
  private delay = 0.9;

  constructor(
    private readonly g: FourHundredEngine,
    private readonly level: BotLevel = 'normal',
  ) {}

  update(dt: number): void {
    const g = this.g;
    if (g.phase !== 'bidding' && g.phase !== 'playing') return;
    if (g.wait > 0) return;
    const p = g.current;
    if (!p.bot) return;
    this.delay -= dt;
    if (this.delay > 0) return;
    this.delay = g.phase === 'bidding' ? 0.8 + Math.random() * 0.7 : 0.55 + Math.random() * 0.5;
    if (g.phase === 'bidding') g.act(p.id, { t: 'bid', n: this.bid(p) });
    else g.act(p.id, { t: 'play', card: this.play(p) });
  }

  bid(p: Player): number {
    const g = this.g;
    const [lo, hi] = g.bidRange(p.seat);
    let est = estimateTricks(p.hand);
    if (this.level === 'easy') est += (Math.random() - 0.4) * 2;
    if (this.level === 'hard') est += 0.15;
    let n = Math.max(lo, Math.min(hi, Math.floor(est + 0.2)));
    // Big bids are expensive to miss: shave them unless the hand is solid.
    if (n >= 7 && est < n + 0.4) n--;
    // Keep the table from being thrown in: the third bidder leans up when the total is short,
    // the last one makes it legal if the hand can stretch that far.
    const others = g.players.filter((x) => x !== p);
    const bidSoFar = others.reduce((s, x) => s + (x.bid ?? 0), 0);
    const left = others.filter((x) => x.bid === null).length;
    const need = minTotal(g.players.map((x) => x.score)) - bidSoFar;
    if (left === 0 && n < need && need <= est + 2.2 && need <= hi) n = need;
    if (left === 1 && n + 3 < need && est - n > 0.45) n++;
    return n;
  }

  play(p: Player): number {
    const g = this.g;
    const legal = g.legal(p.seat);
    if (legal.length === 1) return legal[0]!;
    if (this.level === 'easy' && Math.random() < 0.25) return legal[Math.floor(Math.random() * legal.length)]!;
    const partner = g.players[(p.seat + 2) % 4]!;
    const myNeed = p.bid! - p.tricks;
    const partnerNeed = partner.bid! - partner.tricks;
    const seen = new Set([...g.played, ...p.hand]);
    /** Is `c` the highest card of its suit still out (counting what I hold)? */
    const master = (c: number) => {
      for (let r = rankOf(c) + 1; r <= 12; r++) if (!seen.has(card(suitOf(c), r))) return false;
      return true;
    };
    const heartsOut = 13 - [...seen].filter((c) => suitOf(c) === HEARTS).length;
    const value = (c: number) => rankOf(c) + (suitOf(c) === HEARTS ? 13 : 0);
    const lowest = (cs: number[]) => cs.reduce((a, c) => (value(c) < value(a) ? c : a));
    const highest = (cs: number[]) => cs.reduce((a, c) => (value(c) > value(a) ? c : a));
    // Cheapest discard: a low card from a side suit (keep trumps and winners).
    const discard = (cs: number[]) => {
      const side = cs.filter((c) => suitOf(c) !== HEARTS && !master(c));
      return lowest(side.length ? side : cs);
    };

    // ---------------- leading
    if (!g.trick.length) {
      const sideMasters = legal.filter((c) => suitOf(c) !== HEARTS && master(c));
      const myHearts = legal.filter((c) => suitOf(c) === HEARTS);
      if (myNeed > 0 || partnerNeed <= 0) {
        // Cash a winner while the opponents can't ruff it yet.
        if (sideMasters.length) return highest(sideMasters);
        // Draw trumps when I hold most of the hearts left.
        const topHeart = myHearts.length ? highest(myHearts) : -1;
        if (topHeart >= 0 && master(topHeart) && myHearts.length >= heartsOut - myHearts.length) return topHeart;
        // Otherwise lead from a short side suit to make a void for ruffing.
        if (myHearts.length >= 2) {
          const counts = [0, 2, 3].map((s) => legal.filter((c) => suitOf(c) === s));
          const short = counts.filter((cs) => cs.length > 0 && cs.length <= 2).sort((a, b) => a.length - b.length)[0];
          if (short) return lowest(short);
        }
      }
      // Partner needs tricks: lead low into them.
      const side = legal.filter((c) => suitOf(c) !== HEARTS);
      return lowest(side.length ? side : legal);
    }

    // ---------------- following
    const cards = g.trick.map((t) => t.card);
    const winIdx = trickWinner(cards);
    const winning = g.trick[winIdx]!;
    const partnerWinning = winning.seat === partner.seat;
    const last = g.trick.length === 3;
    const beats = legal.filter((c) => trickWinner([...cards, c]) === cards.length);
    // Partner already has it: don't waste a winner (unless partner is done and I still need tricks).
    if (partnerWinning) {
      const safe = last || master(winning.card) || (suitOf(winning.card) === HEARTS && suitOf(cards[0]!) !== HEARTS);
      if (safe || partnerNeed > 0 || myNeed <= 0) return discard(legal);
      if (beats.length && myNeed > 0) return lowest(beats);
      return discard(legal);
    }
    if (beats.length) {
      // Last to play: win as cheaply as possible.
      if (last) return lowest(beats);
      // Earlier: play a sure winner if I have one, else the lowest that beats (if it's not wasted).
      const sure = beats.filter((c) => master(c) && (suitOf(c) === HEARTS || suitOf(c) === suitOf(cards[0]!)));
      if (sure.length) return lowest(sure);
      const cheap = lowest(beats);
      if (suitOf(cheap) === HEARTS && suitOf(cards[0]!) !== HEARTS) return cheap; // ruff
      if (rankOf(cheap) >= 9 || myNeed > 0) return cheap;
    }
    return discard(legal);
  }
}
