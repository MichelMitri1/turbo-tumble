import type { BotLevel } from '../bots';
import type { Action, GameEvent, Rules } from '../engine';
import type { View } from '../view';

/** Last Card online protocol (shared by browser and server). */
export const LC_ROOM = 'lastcard';
export const LC_VERSION = 1;
export const LC_MAX_PLAYERS = 8;

export const LcMsg = {
  Act: 'lc:act', // client → server: Action
  Config: 'lc:config', // host → server: Partial<LcConfig>
  Start: 'lc:start', // host → server
  Lobby: 'lc:lobby', // server → client: LcLobby
  State: 'lc:state', // server → client: LcState
  Error: 'lc:err', // server → client: { msg }
} as const;

export interface LcConfig {
  bots: number;
  botLevel: BotLevel;
  stacking: boolean;
  drawToMatch: boolean;
  target: number;
}

export interface LcLobby {
  code: string;
  phase: 'lobby' | 'playing' | 'over';
  hostId: string;
  config: LcConfig;
  players: Array<{ id: string; name: string; avatar: number; bot: boolean; connected: boolean }>;
  lan: boolean;
}

export interface LcState {
  view: View;
  events: GameEvent[];
}

export interface LcJoin {
  version: number;
  name: string;
  avatar: number;
  visibility?: 'private' | 'public';
}

export type { Action, Rules };
