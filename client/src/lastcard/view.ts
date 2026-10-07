import type { Card, Color } from './cards';
import type { GameEvent, LastCardEngine, Phase, Rules } from './engine';

/** Everything one player is allowed to see. */
export interface View {
  you: string;
  players: Array<{ id: string; name: string; bot: boolean; avatar: number; count: number; score: number; connected: boolean; called: boolean }>;
  hand: Card[];
  /** Ids of my cards that can be played right now. */
  playable: number[];
  top: Card;
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
    playable: myTurn && me ? me.hand.filter((c) => e.canPlay(c)).map((c) => c.id) : [],
    top: e.top,
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

/** Hide other players' drawn cards. */
export function redact(ev: GameEvent, you: string): GameEvent {
  if (ev.k === 'draw' && ev.by !== you) return { ...ev, cards: undefined };
  return ev;
}
