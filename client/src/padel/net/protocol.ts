import type { Level } from '../sim/ai';
import type { MatchEvent, PlayerDef } from '../sim/match';

/** Padel online protocol (browser ↔ server). */
export const PD_ROOM = 'padel';
export const PD_VERSION = 1;
/** Humans per side (doubles). */
export const PD_MAX_PER_TEAM = 2;

export const PdMsg = {
  Config: 'pd:cfg', // host → server: Partial<PdConfig>
  Team: 'pd:team', // client → server: { team }
  Start: 'pd:start', // host → server
  Move: 'pd:mv', // client → server (fast lane): { r: [seq, mx, mz, auto][] }
  Stroke: 'pd:st', // client → server (reliable): Stroke
  Hello: 'pd:hello', // client → server: answered with the lobby (+ Begin if playing)
  Ping: 'pd:ping',
  Lobby: 'pd:lobby',
  Begin: 'pd:begin',
  Snap: 'pd:snap', // server → client: bytes (Float32 frame)
  Events: 'pd:ev', // server → client: MatchEvent[]
  Error: 'pd:err',
} as const;

export interface PdConfig {
  mode: 1 | 2;
  level: Level;
  games: 4 | 6;
  sets: 1 | 3;
  golden: boolean;
  court: string;
}

export interface PdLobbyPlayer {
  id: string;
  name: string;
  team: 0 | 1;
  racket: string;
  connected: boolean;
}

export interface PdLobby {
  code: string;
  phase: 'lobby' | 'playing' | 'over';
  hostId: string;
  config: PdConfig;
  players: PdLobbyPlayer[];
  lan: boolean;
}

export interface PdBegin {
  config: PdConfig;
  seed: number;
  /** Everyone on court, in sim order. */
  defs: PlayerDef[];
  lan: boolean;
}

export interface PdJoin {
  version: number;
  name: string;
  racket: string;
  visibility?: 'private' | 'public';
}

export type { MatchEvent };
