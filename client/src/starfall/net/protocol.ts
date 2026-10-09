import type { Config, Event } from '../sim/game';
import type { SfView } from '../sim/view';

/** Starfall online protocol (shared by browser and server). */
export const SF_ROOM = 'starfall';
export const SF_VERSION = 2;
export const SF_MAX = 15;

export const SfMsg = {
  Config: 'sf:config', // host → server: Partial<SfConfig>
  Look: 'sf:look', // client → server: { name, color }
  Start: 'sf:start', // host → server
  Move: 'sf:move', // client → server: SfMove (its own position, checked by the server)
  Act: 'sf:act', // client → server: Action
  Lobby: 'sf:lobby', // server → client: SfLobby
  Begin: 'sf:begin', // server → client: SfBegin
  Snap: 'sf:snap', // server → client: SfSnap
  Error: 'sf:err', // server → client: { msg }
} as const;

export interface SfConfig extends Config {
  /** Seats filled with bots. */
  bots: number;
}

export interface SfLobby {
  code: string;
  phase: 'lobby' | 'playing';
  hostId: string;
  config: SfConfig;
  players: Array<{ id: string; name: string; color: number; connected: boolean }>;
  lan: boolean;
}

export interface SfJoin {
  version: number;
  name: string;
  color: number;
  visibility?: 'public' | 'private';
}

export interface SfBegin {
  me: number;
  map: string;
}

export interface SfSnap {
  v: SfView;
  e: Event[];
}

export interface SfMove {
  x: number;
  y: number;
  left: boolean;
  moving: boolean;
}
