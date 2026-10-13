import type { MatchEvent } from '../sim/match';
import type { CpuLevel } from '../sim/difficulty';

/** Matchday online protocol (browser ↔ server). */
export const FB_ROOM = 'football';
export const FB_VERSION = 4;
/** Humans per side online (the rest of each XI is AI). */
export const FB_MAX_PER_TEAM = 4;

export const FbMsg = {
  Config: 'fb:cfg', // host → server: Partial<FbConfig>
  Team: 'fb:team', // client → server: { team: 0 | 1 }
  Start: 'fb:start', // host → server
  Input: 'fb:in', // client → server: FbInput
  Hello: 'fb:hello', // client → server once its handlers are ready: answered with the lobby (+ Begin if playing)
  Ping: 'fb:ping', // both ways: { t }
  Lobby: 'fb:lobby', // server → client: FbLobby
  Begin: 'fb:begin', // server → client: FbBegin
  Snap: 'fb:snap', // server → client: bytes (Float32 frame)
  Events: 'fb:ev', // server → client: MatchEvent[]
  Stats: 'fb:stats', // server → client: FbStats
  Error: 'fb:err',
} as const;

export interface FbConfig {
  home: string;
  away: string;
  /** Real seconds per half. */
  half: number;
  difficulty: CpuLevel;
}

export interface FbLobbyPlayer {
  id: string;
  name: string;
  team: 0 | 1;
  connected: boolean;
}

export interface FbLobby {
  code: string;
  phase: 'lobby' | 'playing' | 'over';
  hostId: string;
  config: FbConfig;
  players: FbLobbyPlayer[];
  lan: boolean;
}

export interface FbBegin {
  config: FbConfig;
  seed: number;
  /** Humans in sim order (index = Human index in MatchSim). */
  humans: Array<{ id: string; name: string; team: 0 | 1 }>;
  lan: boolean;
}

/** Stick in pitch space + button bits (see INPUT_BITS). */
export interface FbInput {
  x: number;
  z: number;
  b: number;
}
export const INPUT_BITS = { sprint: 1, pass: 2, shoot: 4, through: 8, lob: 16, finesse: 32, chip: 64, switch: 128, skill: 256, l2: 512, tkNext: 1024, tkPrev: 2048, diveL: 4096, diveR: 8192 } as const;
/** Skill move (1–100, seven bits) packed above the button bits. */
export const TRICK_SHIFT = 14;

export interface FbStats {
  stats: [unknown, unknown];
  goals: Array<{ team: 0 | 1; p: number; minute: number; own: boolean }>;
}

export interface FbJoin {
  version: number;
  name: string;
  visibility?: 'private' | 'public';
}

export type { MatchEvent };
