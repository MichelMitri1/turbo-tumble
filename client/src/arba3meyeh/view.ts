import { FourHundredEngine, minTotal, type GameEvent, type HandResult, type Phase, type Rules } from './engine';

/** What one player may see of the table. */
export interface SeatView {
  seat: number;
  id: string;
  name: string;
  avatar: number;
  bot: boolean;
  connected: boolean;
  score: number;
  bid: number | null;
  tricks: number;
  cards: number;
}

export interface View {
  /** My seat (−1 when watching). */
  me: number;
  seats: SeatView[];
  hand: number[];
  /** Cards I may play right now (empty when it isn't my turn to play). */
  legal: number[];
  phase: Phase;
  turn: number;
  dealer: number;
  handNo: number;
  trick: Array<{ seat: number; card: number }>;
  lastTrick: { winner: number; cards: Array<{ seat: number; card: number }> } | null;
  /** My legal bids when it's my turn to bid. */
  bidRange: [number, number] | null;
  needTotal: number;
  history: HandResult[][];
  winner: 0 | 1 | null;
  rules: Rules;
  /** Seconds left on the current decision (0 = untimed). */
  clock: number;
  waiting: boolean;
}

export function viewFor(g: FourHundredEngine, id: string): View {
  const me = g.player(id)?.seat ?? -1;
  const myTurn = me === g.turn && g.wait <= 0;
  return {
    me,
    seats: g.players.map((p) => ({ seat: p.seat, id: p.id, name: p.name, avatar: p.avatar, bot: p.bot, connected: p.connected, score: p.score, bid: p.bid, tricks: p.tricks, cards: p.hand.length })),
    hand: me >= 0 ? [...g.players[me]!.hand] : [],
    legal: myTurn && g.phase === 'playing' ? g.legal(me) : [],
    phase: g.phase,
    turn: g.turn,
    dealer: g.dealer,
    handNo: g.handNo,
    trick: g.trick.map((t) => ({ ...t })),
    lastTrick: g.lastTrick,
    bidRange: myTurn && g.phase === 'bidding' ? g.bidRange(me) : null,
    needTotal: minTotal(g.players.map((p) => p.score)),
    history: g.history,
    winner: g.winner,
    rules: g.rules,
    clock: Math.max(0, g.clock),
    waiting: g.wait > 0,
  };
}

/** Hide other players' cards in a deal event. */
export function redact(e: GameEvent, id: string, g?: FourHundredEngine): GameEvent {
  if (e.k !== 'deal') return e;
  const me = g?.player(id)?.seat ?? -1;
  return { ...e, cards: e.cards.map((h, seat) => (seat === me ? h : h.map(() => -1))) };
}
