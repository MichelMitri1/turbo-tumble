import type { BotLevel } from '../bots';
import type { Action, GameEvent, Mode } from '../engine';
import type { View } from '../view';

/** Jackaroo online protocol (shared by browser and server). */
export const JK_ROOM = 'jackaroo';
export const JK_VERSION = 1;
export const JK_SEATS = 4;
export const JK_TURN_TIME = 40;

export const JkMsg = {
  Act: 'jk:act', // client → server: Action
  Seat: 'jk:seat', // client → server: { seat } — sit in a free seat (picks the team)
  Config: 'jk:config', // host → server: Partial<JkConfig>
  Start: 'jk:start', // host → server
  Rematch: 'jk:rematch', // client → server: vote to play again
  Lobby: 'jk:lobby', // server → client: JkLobby
  State: 'jk:state', // server → client: JkState
  Error: 'jk:err', // server → client: { msg }
} as const;

export interface JkConfig {
  mode: Mode;
  /** 4 = 2v2 (partners opposite), 2 = 1v1. */
  players: 2 | 4;
  /** Empty seats are filled with bots of this level when the game starts. */
  botLevel: BotLevel;
}

export interface JkLobby {
  code: string;
  phase: 'lobby' | 'playing' | 'over';
  hostId: string;
  config: JkConfig;
  /** One entry per seat (turn order); team = seat % 2 in 2v2. */
  seats: Array<{ id: string; name: string; avatar: number; connected: boolean } | null>;
  /** Series: games won per team at this table. */
  teamWins: [number, number];
  rematch: string[];
  lan: boolean;
}

export interface JkState {
  view: View;
  events: GameEvent[];
  views?: View[];
}

export interface JkJoin {
  version: number;
  name: string;
  avatar: number;
  visibility?: 'private' | 'public';
}

export type { Action };
