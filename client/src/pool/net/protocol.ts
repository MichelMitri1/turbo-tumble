import type { BotLevel } from '../bots';
import type { Action, GameEvent } from '../engine';
import type { View } from '../view';
import type { Aim } from '../link';

/** Corner Pocket online protocol (shared by browser and server). */
export const PL_ROOM = 'pool';
export const PL_VERSION = 1;

export const PlMsg = {
  Act: 'pl:act', // client → server: Action
  Aim: 'pl:aim', // client → server → others: Aim (live cue position)
  Config: 'pl:config', // host → server: Partial<PlConfig>
  Start: 'pl:start', // host → server
  Lobby: 'pl:lobby', // server → client: PlLobby
  State: 'pl:state', // server → client: PlState
  Error: 'pl:err',
} as const;

export interface PlConfig {
  /** Fill the empty seat with a bot. */
  bot: boolean;
  botLevel: BotLevel;
  shotTime: number;
}

export interface PlLobby {
  code: string;
  phase: 'lobby' | 'playing' | 'over';
  hostId: string;
  config: PlConfig;
  players: Array<{ id: string; name: string; avatar: number; bot: boolean; connected: boolean }>;
  lan: boolean;
}

export interface PlState {
  view: View;
  events: GameEvent[];
}

export interface PlJoin {
  version: number;
  name: string;
  avatar: number;
  visibility?: 'private' | 'public';
}

export type { Action, Aim };
