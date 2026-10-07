import type { BallRest } from './physics';
import type { Group, PoolEngine, Rules } from './engine';

/** The table as one player sees it (8-ball has no hidden information). */
export interface View {
  you: string;
  players: Array<{ id: string; name: string; bot: boolean; avatar: number; group: Group | null; connected: boolean }>;
  balls: BallRest[];
  current: string;
  phase: 'aim' | 'rolling' | 'over';
  isBreak: boolean;
  ballInHand: boolean;
  kitchen: boolean;
  /** Ball ids the current player must hit first. */
  targets: number[];
  onEight: boolean;
  shotLeft: number;
  rules: Rules;
  seq: number;
  winner: string | null;
  reason: string;
  lastFoul: string | null;
}

export function viewFor(e: PoolEngine, you: string): View {
  return {
    you,
    players: e.players.map((p) => ({ id: p.id, name: p.name, bot: p.bot, avatar: p.avatar, group: p.group, connected: p.connected })),
    balls: e.balls.map((b) => ({ ...b })),
    current: e.current.id,
    phase: e.phase,
    isBreak: e.isBreak,
    ballInHand: e.ballInHand,
    kitchen: e.kitchen,
    targets: e.phase === 'over' ? [] : e.targets(),
    onEight: e.phase !== 'over' && e.onEight(),
    shotLeft: e.shotLeft,
    rules: e.rules,
    seq: e.seq,
    winner: e.winner,
    reason: e.reason,
    lastFoul: e.lastFoul,
  };
}
