import type { BotLevel } from '../sim/bot';
import type { ArenaId } from '../arenas';
import type { CarId } from '../sim/constants';
import type { PlayerInfo, Stats, WorldEvent } from '../sim/world';

/** Boostball online protocol (browser ↔ server). */
export const RB_ROOM = 'boostball';
export const RB_VERSION = 3;
export const RB_MAX_PER_TEAM = 3;

export const RbMsg = {
  Input: 'rb:in', // client → server: RbInput
  Config: 'rb:cfg', // host → server: Partial<RbConfig>
  Team: 'rb:team', // client → server: { team }
  Body: 'rb:body', // client → server: { body }
  Start: 'rb:start', // host → server
  Chat: 'rb:chat', // client → server: { g, i }   server → client: RbChat
  Ping: 'rb:ping', // both ways: { t }
  Lobby: 'rb:lobby', // server → client: RbLobby
  Begin: 'rb:begin', // server → client: RbBegin
  Snap: 'rb:snap', // server → client: bytes (Float32: [lead, ...snapshot])
  Events: 'rb:ev', // server → client: WorldEvent[]
  Stats: 'rb:stats', // server → client: Array<[id, Stats]>
  Error: 'rb:err',
} as const;

export interface RbConfig {
  /** Players per team. */
  size: 1 | 2 | 3;
  botLevel: BotLevel;
  /** Match length in seconds. */
  length: number;
  /** Fill empty seats with bots. */
  bots: boolean;
  /** Arena look ('random' is resolved when the match starts). */
  arena: ArenaId | 'random';
}

export interface RbLobbyPlayer {
  id: string;
  name: string;
  team: 0 | 1;
  body: CarId;
  bot: boolean;
  connected: boolean;
}

export interface RbLobby {
  code: string;
  phase: 'lobby' | 'playing' | 'over';
  hostId: string;
  config: RbConfig;
  players: RbLobbyPlayer[];
  lan: boolean;
}

export interface RbBegin {
  players: PlayerInfo[];
  /** Numeric car id per session id. */
  ids: Record<string, number>;
  seed: number;
  length: number;
  lan: boolean;
  arena: ArenaId;
}

/** Inputs for consecutive ticks starting at `t` (6 numbers per tick, see packControls). */
export interface RbInput {
  t: number;
  c: number[];
}

export interface RbChat {
  id: number;
  g: number;
  i: number;
}

export interface RbJoin {
  version: number;
  name: string;
  body: CarId;
  visibility?: 'private' | 'public';
}

export type { Stats, WorldEvent };
