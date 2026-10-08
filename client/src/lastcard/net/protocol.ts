import type { BotLevel } from '../bots';
import type { Action, GameEvent, Rules } from '../engine';
import type { View } from '../view';

/** Last Card online protocol (shared by browser and server). */
export const LC_ROOM = 'lastcard';
export const LC_VERSION = 2;
export const LC_MAX_PLAYERS = 8;

export const LcMsg = {
  Act: 'lc:act', // client → server: Action
  Config: 'lc:config', // host → server: Partial<LcConfig>
  Start: 'lc:start', // host → server
  Rematch: 'lc:rematch', // client → server: vote to play again after a game
  Lobby: 'lc:lobby', // server → client: LcLobby
  State: 'lc:state', // server → client: LcState
  Error: 'lc:err', // server → client: { msg }
} as const;

/** Lobby settings: bots + every house rule (the server fills in the timer). */
export interface LcConfig extends Omit<Rules, 'turnTime'> {
  bots: number;
  botLevel: BotLevel;
}

export interface LcLobby {
  code: string;
  phase: 'lobby' | 'playing' | 'over';
  hostId: string;
  config: LcConfig;
  players: Array<{ id: string; name: string; avatar: number; bot: boolean; connected: boolean; wins: number }>;
  /** Ids that voted for a rematch (after a game). */
  rematch: string[];
  lan: boolean;
}

export interface LcState {
  view: View;
  events: GameEvent[];
  /** My view right after each event (same length as events), so animations show matching state. */
  views?: View[];
}

export interface LcJoin {
  version: number;
  name: string;
  avatar: number;
  visibility?: 'private' | 'public';
}

export type { Action, Rules };
