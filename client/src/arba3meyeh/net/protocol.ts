import type { BotLevel } from '../bots';
import type { Action, GameEvent, Rules } from '../engine';
import type { View } from '../view';

/** 400 online protocol (shared by browser and server). */
export const FH_ROOM = 'fourhundred';
export const FH_VERSION = 1;

export const FhMsg = {
  Act: 'fh:act', // client → server: Action
  Config: 'fh:config', // host → server: Partial<FhConfig>
  Seat: 'fh:seat', // client → server: { seat } (pick a chair before the game)
  Start: 'fh:start', // host → server
  Rematch: 'fh:rematch', // client → server
  Lobby: 'fh:lobby', // server → client
  State: 'fh:state', // server → client
  Error: 'fh:err',
} as const;

export interface FhConfig {
  target: number;
  scoring: Rules['scoring'];
  botLevel: BotLevel;
}

export interface FhLobby {
  code: string;
  phase: 'lobby' | 'playing' | 'over';
  hostId: string;
  config: FhConfig;
  /** Four chairs: seat 0 & 2 are partners, 1 & 3 are partners. Empty chairs are filled by bots. */
  chairs: Array<{ id: string; name: string; avatar: number; bot: boolean; connected: boolean } | null>;
  /** Team series score at this table. */
  wins: [number, number];
  rematch: string[];
  lan: boolean;
}

export interface FhState {
  view: View;
  events: GameEvent[];
  views?: View[];
}

export interface FhJoin {
  version: number;
  name: string;
  avatar: number;
  visibility?: 'private' | 'public';
}

export type { Action };
