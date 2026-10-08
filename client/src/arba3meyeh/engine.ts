import { HEARTS, rankOf, shuffled, sortHand, suitOf, trickWinner } from './cards';

/**
 * 400 (أربعمية, "Arba3meyeh") — the Levantine partnership trick-taking game.
 *
 * Four players, partners sit opposite (seats 0 & 2 vs 1 & 3). Everything goes
 * counter-clockwise: seat + 1 is the player on your right. Hearts are always trump,
 * aces high. Each hand: 13 cards each; starting right of the dealer every player bids
 * once how many tricks they alone will take (minimum 2, more once their score is high);
 * the four bids must add up to at least 11 (12 / 13 / 14 once anyone reaches 30 / 40 / 50)
 * or the cards are thrown in. The player right of the dealer leads; follow suit if you
 * can, otherwise trump or discard. Make your bid → score its value (5+ are worth more),
 * miss → lose it. A team wins when one partner reaches 41 while the other is above zero.
 */

export interface Rules {
  target: number;
  /** 'lebanese': 5 = 10, 6 = 12 … always. 'jawaker': at 30+ points, bids up to 6 score face value. */
  scoring: 'lebanese' | 'jawaker';
  /** Seconds per decision before the table plays for you (0 = no limit). */
  turnTime: number;
}
export const DEFAULT_RULES: Rules = { target: 41, scoring: 'lebanese', turnTime: 0 };

export interface PlayerSetup {
  id: string;
  name: string;
  bot: boolean;
  avatar: number;
}

export interface Player extends PlayerSetup {
  seat: number;
  score: number;
  hand: number[];
  bid: number | null;
  tricks: number;
  connected: boolean;
}

export type Phase = 'bidding' | 'playing' | 'handover' | 'over';

export type Action = { t: 'bid'; n: number } | { t: 'play'; card: number };

export interface HandResult {
  seat: number;
  bid: number;
  tricks: number;
  delta: number;
  score: number;
}

export type GameEvent =
  | { k: 'deal'; hand: number; dealer: number; cards: number[][] }
  | { k: 'bid'; seat: number; n: number }
  | { k: 'redeal'; total: number; need: number }
  | { k: 'play'; seat: number; card: number }
  | { k: 'trick'; winner: number; cards: number[]; leader: number }
  | { k: 'collect'; winner: number }
  | { k: 'hand'; results: HandResult[] }
  | { k: 'over'; team: 0 | 1; reason: 'target' | 'thirteen' };

/** Points for a bid (made: +, missed: −). `score` = the bidder's score before the hand. */
export function bidValue(bid: number, score: number, rules: Pick<Rules, 'scoring'>): number {
  if (bid >= 13) return 40;
  if (rules.scoring === 'jawaker' && score >= 30 && bid <= 6) return bid;
  return [0, 1, 2, 3, 4, 10, 12, 14, 16, 27, 30, 33, 36][bid]!;
}

/** The smallest bid a player may make at a given score. */
export function minBid(score: number): number {
  return score >= 50 ? 5 : score >= 40 ? 4 : score >= 30 ? 3 : 2;
}

/** The smallest acceptable total of the four bids, from the highest score at the table. */
export function minTotal(scores: number[]): number {
  const top = Math.max(...scores);
  return top >= 50 ? 14 : top >= 40 ? 13 : top >= 30 ? 12 : 11;
}

/** Seconds the table pauses so everyone sees what happened. */
const PAUSE = { trick: 1.15, handover: 5.5, redeal: 2.2, deal: 1.4 };

export class FourHundredEngine {
  readonly players: Player[];
  readonly rules: Rules;
  phase: Phase = 'bidding';
  handNo = 0;
  dealer: number;
  /** Whose decision it is (bid or card). */
  turn = 0;
  /** Cards on the table this trick, in play order, and who led. */
  trick: Array<{ seat: number; card: number }> = [];
  leader = 0;
  /** Every card played this hand (for bots that count cards). */
  played: number[] = [];
  lastTrick: { winner: number; cards: Array<{ seat: number; card: number }> } | null = null;
  /** Score sheet: one row per finished hand. */
  history: HandResult[][] = [];
  winner: 0 | 1 | null = null;
  events: GameEvent[] = [];
  /** Seconds before the table accepts the next decision (animations). */
  wait = 0;
  /** Seconds left on the current decision (when `rules.turnTime` > 0). */
  clock = 0;
  private rand: () => number;

  constructor(
    setups: PlayerSetup[],
    rules: Partial<Rules> = {},
    private readonly onEvent?: (e: GameEvent) => void,
    seed = Date.now(),
  ) {
    if (setups.length !== 4) throw new Error('400 needs exactly four players');
    this.rules = { ...DEFAULT_RULES, ...rules };
    let s = seed >>> 0 || 1;
    this.rand = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    this.players = setups.map((p, seat) => ({ ...p, seat, score: 0, hand: [], bid: null, tricks: 0, connected: true }));
    this.dealer = Math.floor(this.rand() * 4);
    this.deal();
  }

  player(id: string): Player | undefined {
    return this.players.find((p) => p.id === id);
  }
  get current(): Player {
    return this.players[this.turn]!;
  }
  get isOver(): boolean {
    return this.phase === 'over';
  }
  static teamOf(seat: number): 0 | 1 {
    return (seat % 2) as 0 | 1;
  }
  static right(seat: number): number {
    return (seat + 1) % 4;
  }

  private emit(e: GameEvent): void {
    this.events.push(e);
    this.onEvent?.(e);
  }

  // ---------------------------------------------------------------- dealing & bidding

  private deal(): void {
    this.handNo++;
    const deck = shuffled(this.rand);
    for (const p of this.players) {
      p.hand = [];
      p.bid = null;
      p.tricks = 0;
    }
    // Dealt from the dealer's right, counter-clockwise (in batches, like the table does it).
    let seat = FourHundredEngine.right(this.dealer);
    for (const batch of [1, 2, 2, 2, 2, 2, 2]) {
      for (let k = 0; k < 4; k++) {
        this.players[seat]!.hand.push(...deck.splice(0, batch));
        seat = FourHundredEngine.right(seat);
      }
    }
    for (const p of this.players) p.hand = sortHand(p.hand);
    this.trick = [];
    this.played = [];
    this.lastTrick = null;
    this.phase = 'bidding';
    this.turn = FourHundredEngine.right(this.dealer);
    this.wait = PAUSE.deal;
    this.clock = this.rules.turnTime;
    this.emit({ k: 'deal', hand: this.handNo, dealer: this.dealer, cards: this.players.map((p) => [...p.hand]) });
  }

  /** Legal bids for a seat right now. */
  bidRange(seat: number): [number, number] {
    return [minBid(this.players[seat]!.score), 13];
  }

  /** Legal cards for a seat (follow suit if you can). */
  legal(seat: number): number[] {
    const hand = this.players[seat]!.hand;
    if (!this.trick.length) return [...hand];
    const led = suitOf(this.trick[0]!.card);
    const follow = hand.filter((c) => suitOf(c) === led);
    return follow.length ? follow : [...hand];
  }

  /** Apply a decision; returns an error message, or '' when accepted. */
  act(id: string, a: Action): string {
    const p = this.player(id);
    if (!p) return 'Not at this table.';
    if (this.phase === 'over') return 'The game is over.';
    if (p.seat !== this.turn) return 'Not your turn.';
    if (this.wait > 0) return 'Wait a moment.';
    if (a.t === 'bid') {
      if (this.phase !== 'bidding') return 'Bidding is over.';
      const [lo, hi] = this.bidRange(p.seat);
      if (!Number.isInteger(a.n) || a.n < lo || a.n > hi) return `Bid between ${lo} and ${hi}.`;
      p.bid = a.n;
      this.emit({ k: 'bid', seat: p.seat, n: a.n });
      this.turn = FourHundredEngine.right(this.turn);
      this.clock = this.rules.turnTime;
      if (this.players.every((x) => x.bid !== null)) this.bidsDone();
      return '';
    }
    if (this.phase !== 'playing') return 'Not playing yet.';
    if (!p.hand.includes(a.card)) return 'You don’t have that card.';
    if (!this.legal(p.seat).includes(a.card)) return 'You must follow suit.';
    p.hand.splice(p.hand.indexOf(a.card), 1);
    this.trick.push({ seat: p.seat, card: a.card });
    this.played.push(a.card);
    this.emit({ k: 'play', seat: p.seat, card: a.card });
    this.clock = this.rules.turnTime;
    if (this.trick.length < 4) {
      this.turn = FourHundredEngine.right(this.turn);
      return '';
    }
    // Trick complete.
    const w = this.trick[trickWinner(this.trick.map((t) => t.card))]!.seat;
    this.players[w]!.tricks++;
    this.emit({ k: 'trick', winner: w, cards: this.trick.map((t) => t.card), leader: this.leader });
    this.wait = PAUSE.trick;
    this.turn = w;
    return '';
  }

  private bidsDone(): void {
    const total = this.players.reduce((s, p) => s + p.bid!, 0);
    const need = minTotal(this.players.map((p) => p.score));
    if (total < need) {
      // Thrown in: the deal passes to the right.
      this.emit({ k: 'redeal', total, need });
      this.dealer = FourHundredEngine.right(this.dealer);
      this.phase = 'handover';
      this.wait = PAUSE.redeal;
      this.pendingDeal = true;
      return;
    }
    this.phase = 'playing';
    this.leader = this.turn = FourHundredEngine.right(this.dealer);
    this.trick = [];
  }
  private pendingDeal = false;

  // ---------------------------------------------------------------- the clock

  update(dt: number): void {
    if (this.phase === 'over') return;
    if (this.wait > 0) {
      this.wait -= dt;
      if (this.wait > 0) return;
      this.wait = 0;
      // A finished trick leaves the table.
      if (this.trick.length === 4) {
        this.lastTrick = { winner: this.turn, cards: this.trick };
        this.trick = [];
        this.leader = this.turn;
        this.emit({ k: 'collect', winner: this.turn });
        if (this.players.every((p) => p.hand.length === 0)) this.endHand();
      } else if (this.pendingDeal) {
        this.pendingDeal = false;
        this.deal();
      }
      this.clock = this.rules.turnTime;
      return;
    }
    if (this.rules.turnTime > 0 && (this.phase === 'bidding' || this.phase === 'playing')) {
      this.clock -= dt;
      if (this.clock <= 0) this.autoAct(this.current.id);
    }
  }

  /** Decide for a player who ran out of time (or left): the minimum bid / the lowest legal card. */
  autoAct(id: string): void {
    const p = this.player(id);
    if (!p || p.seat !== this.turn || this.wait > 0) return;
    if (this.phase === 'bidding') {
      // The last bidder makes the total legal when it can.
      const [lo] = this.bidRange(p.seat);
      const others = this.players.reduce((s, x) => s + (x.bid ?? 0), 0);
      const last = this.players.filter((x) => x.bid === null).length === 1;
      const need = minTotal(this.players.map((x) => x.score));
      this.act(id, { t: 'bid', n: last ? Math.min(13, Math.max(lo, need - others)) : lo });
    } else if (this.phase === 'playing') {
      const legal = this.legal(p.seat);
      const low = legal.reduce((a, c) => (rankOf(c) + (suitOf(c) === HEARTS ? 13 : 0) < rankOf(a) + (suitOf(a) === HEARTS ? 13 : 0) ? c : a));
      this.act(id, { t: 'play', card: low });
    }
  }

  // ---------------------------------------------------------------- scoring

  private endHand(): void {
    const results: HandResult[] = this.players.map((p) => {
      const v = bidValue(p.bid!, p.score, this.rules);
      const delta = p.tricks >= p.bid! ? v : -v;
      return { seat: p.seat, bid: p.bid!, tricks: p.tricks, delta, score: p.score + delta };
    });
    for (const r of results) this.players[r.seat]!.score = r.score;
    this.history.push(results);
    this.emit({ k: 'hand', results });
    // A bid of 13 made wins the game on the spot.
    const thirteen = results.find((r) => r.bid >= 13 && r.tricks >= 13);
    if (thirteen) return this.finish(FourHundredEngine.teamOf(thirteen.seat), 'thirteen');
    const qualifies = (t: 0 | 1) => {
      const [a, b] = [this.players[t]!, this.players[t + 2]!];
      return (a.score >= this.rules.target && b.score > 0) || (b.score >= this.rules.target && a.score > 0);
    };
    const q0 = qualifies(0);
    const q1 = qualifies(1);
    if (q0 || q1) {
      let team: 0 | 1 = q0 ? 0 : 1;
      if (q0 && q1) {
        // Both made it this hand: the higher top score wins (then the higher team total).
        const top = (t: number) => Math.max(this.players[t]!.score, this.players[t + 2]!.score);
        const sum = (t: number) => this.players[t]!.score + this.players[t + 2]!.score;
        team = top(0) !== top(1) ? (top(0) > top(1) ? 0 : 1) : sum(0) >= sum(1) ? 0 : 1;
      }
      return this.finish(team, 'target');
    }
    this.dealer = FourHundredEngine.right(this.dealer);
    this.phase = 'handover';
    this.wait = PAUSE.handover;
    this.pendingDeal = true;
  }

  private finish(team: 0 | 1, reason: 'target' | 'thirteen'): void {
    this.winner = team;
    this.phase = 'over';
    this.emit({ k: 'over', team, reason });
  }

  /** A player left mid-game: a bot takes the seat. */
  leave(id: string): void {
    const p = this.player(id);
    if (!p) return;
    p.bot = true;
    p.connected = false;
    p.name = `${p.name} (bot)`;
  }
}
