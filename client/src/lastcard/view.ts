import type { Card, Color } from './cards';
import type { GameEvent, LastCardEngine, Phase, Rules } from './engine';

/** Everything one player is allowed to see. */
export interface View {
  you: string;
  players: Array<{ id: string; name: string; bot: boolean; avatar: number; count: number; score: number; connected: boolean; called: boolean }>;
  hand: Card[];
  /** Ids of my cards that can be played right now (on my turn, or jump-in cards off turn). */
  playable: number[];
  /** My turn and I have to play (force play / draw-to-match): Keep and Draw are off. */
  mustPlay: boolean;
  /** null while a new round is being dealt. */
  top: Card | null;
  color: Color | null;
  dir: 1 | -1;
  current: string;
  phase: Phase;
  drawCount: number;
  pendingDraw: number;
  drawnId: number;
  vulnerable: string | null;
  /** Wild Draw Four waiting for my decision (who played it). */
  challengeFrom: string | null;
  turnLeft: number;
  pauseLeft: number;
  round: number;
  rules: Rules;
  winner: string | null;
  roundWinner: string | null;
  lastPoints: number;
}

export function viewFor(e: LastCardEngine, you: string): View {
  const me = e.player(you);
  const myTurn = e.current.id === you && (e.phase === 'play' || e.phase === 'drawn');
  return {
    you,
    players: e.players.map((p) => ({ id: p.id, name: p.name, bot: p.bot, avatar: p.avatar, count: p.hand.length, score: p.score, connected: p.connected, called: p.called })),
    hand: me ? me.hand.slice() : [],
    playable: me ? me.hand.filter((c) => (myTurn ? e.canPlay(c) : e.canJump(c))).map((c) => c.id) : [],
    mustPlay: myTurn && e.mustPlay(),
    top: e.discard.length ? e.top : null,
    color: e.color,
    dir: e.dir,
    current: e.current.id,
    phase: e.phase,
    drawCount: e.draw.length,
    pendingDraw: e.pendingDraw,
    drawnId: e.current.id === you ? e.drawnId : -1,
    vulnerable: e.vulnerable,
    challengeFrom: e.phase === 'challenge' && e.current.id === you ? (e.wild4?.by ?? null) : null,
    turnLeft: e.turnLeft,
    pauseLeft: e.pauseLeft,
    round: e.round,
    rules: e.rules,
    winner: e.winner,
    roundWinner: e.roundWinner,
    lastPoints: e.lastPoints,
  };
}

/** Hide other players' drawn cards and whether their Wild Draw Four was a bluff. */
export function redact(ev: GameEvent, you: string): GameEvent {
  if (ev.k === 'draw' && ev.by !== you) return { ...ev, cards: undefined };
  if (ev.k === 'play' && ev.by !== you && ev.bluff !== undefined) return { ...ev, bluff: undefined };
  return ev;
}
