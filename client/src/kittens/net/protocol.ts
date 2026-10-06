import type { DeckId } from '../cards';
import type { BotLevel } from '../bots';
import type { Action, GameEvent } from '../engine';
import type { View } from '../view';

/** Kitten Kaboom online protocol (shared by browser and server). */
export const KK_ROOM = 'kittens';
export const KK_VERSION = 1;
export const KK_MAX_PLAYERS = 5;

export const KkMsg = {
  Act: 'kk:act', // client → server: Action
  Config: 'kk:config', // host → server: Partial<KkConfig>
  Start: 'kk:start', // host → server
  Lobby: 'kk:lobby', // server → client: KkLobby
  State: 'kk:state', // server → client: KkState
  Error: 'kk:err', // server → client: { msg }
} as const;

export interface KkConfig {
  deck: DeckId;
  bots: number;
  botLevel: BotLevel;
}

export interface KkLobby {
  code: string;
  phase: 'lobby' | 'playing' | 'over';
  hostId: string;
  config: KkConfig;
  players: Array<{ id: string; name: string; avatar: number; bot: boolean; connected: boolean }>;
}

export interface KkState {
  view: View;
  events: GameEvent[];
}

export interface KkJoin {
  version: number;
  name: string;
  avatar: number;
  visibility?: 'private' | 'public';
}

export type { Action };
