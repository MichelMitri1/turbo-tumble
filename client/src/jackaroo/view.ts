import type { Card } from './cards';
import { cardMoves, type Board, type GameEvent, type JackarooEngine, type Mode, type Move, type Phase } from './engine';

/** Everything one player is allowed to see. */
export interface View {
  you: string;
  /** My player index (-1 = watching). */
  me: number;
  n: 2 | 4;
  mode: Mode;
  marbles: number[];
  players: Array<{ id: string; name: string; bot: boolean; avatar: number; count: number; connected: boolean }>;
  hand: Card[];
  current: number;
  phase: Phase;
  dealer: number;
  handNo: number;
  inDeck: number;
  perDeck: number;
  deckNo: number;
  deckCount: number;
  /** Top of the discard pile (last few, top last) and its size. */
  discard: Card[];
  discardCount: number;
  fire: Card[];
  fireCount: number;
  turnLeft: number;
  turnTime: number;
  /** Winning team (-1 while playing). */
  winner: number;
}

export function viewFor(e: JackarooEngine, you: string): View {
  const me = e.idx(you);
  return {
    you,
    me,
    n: e.board.n,
    mode: e.rules.mode,
    marbles: e.board.marbles.slice(),
    players: e.players.map((p) => ({ id: p.id, name: p.name, bot: p.bot, avatar: p.avatar, count: p.hand.length, connected: p.connected })),
    hand: me >= 0 ? e.players[me]!.hand.slice() : [],
    current: e.cur,
    phase: e.phase,
    dealer: e.dealer,
    handNo: e.handNo,
    inDeck: e.inDeck,
    perDeck: e.perDeck,
    deckNo: e.deckNo,
    deckCount: e.deck.length,
    discard: e.discard.slice(-6),
    discardCount: e.discard.length,
    fire: e.fire.slice(-4),
    fireCount: e.fire.length,
    turnLeft: e.turnLeft,
    turnTime: e.rules.turnTime,
    winner: e.winner,
  };
}

export const boardOf = (v: View): Board => ({ n: v.n, mode: v.mode, marbles: v.marbles.slice() });

/** Legal moves for my card in this view (the same rules the engine validates with). */
export function movesIn(v: View, card: Card): Move[] {
  if (v.me < 0) return [];
  return cardMoves(boardOf(v), v.me, card, (v.players[(v.me + 1) % v.n]?.count ?? 0) > 0);
}

/** Other players' dealt cards stay hidden. */
export function redact(ev: GameEvent, me: number): GameEvent {
  if (ev.k === 'deal' && ev.p !== me) return { ...ev, cards: undefined };
  return ev;
}
