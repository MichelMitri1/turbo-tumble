import { DIFFICULTIES, type Difficulty } from '../ai/AIDifficulty';
import { MAX_RACERS } from '../constants/simulation';
import { isTrackId } from '../tracks/registry';
import type { RaceEvent } from '../race/RaceTypes';
import type { RacerSetup } from '../race/RaceSimulation';

/** Bumped whenever the wire format changes; mismatched clients are refused. */
export const PROTOCOL_VERSION = 1;
export const DEFAULT_SERVER_PORT = 2567;
export const ROOM_NAME = 'race';

/** Snapshots go out every N simulation ticks (60 Hz / 2 = 30 Hz). */
export const SNAPSHOT_EVERY_TICKS = 2;
export const MAX_ROOM_CLIENTS = 8;
/** Humans per room across all clients (each client may bring split-screen seats). */
export const MAX_ONLINE_HUMANS = 8;
export const MAX_SEATS_PER_CLIENT = 4;
/** Online races get an extra second of countdown so every client has loaded. */
export const ONLINE_COUNTDOWN = 5;
/** After the first human finishes, everyone else has this long before DNF. */
export const FINISH_GRACE_SECONDS = 30;
/** Results stay up this long before the room returns to the lobby. */
export const RESULTS_SECONDS = 12;
/** Seconds a dropped client may take to reconnect. */
export const RECONNECT_SECONDS = 20;

export const ROOM_CODE_LENGTH = 4;
/** No 0/O, 1/I — codes are read aloud. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function normalizeRoomCode(code: string): string {
  return code
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, ROOM_CODE_LENGTH);
}

export type RoomPhase = 'lobby' | 'racing' | 'results';

export interface SeatChoice {
  character: string;
  kart: string;
}

export interface RoomSettings {
  trackId: string;
  laps: number;
  items: boolean;
  difficulty: Difficulty;
  /** Grid size: CPUs fill the slots humans don't take (0 = humans only). */
  racerCount: number;
}

export const DEFAULT_ROOM_SETTINGS: RoomSettings = { trackId: 'sunny-circuit', laps: 3, items: true, difficulty: 'normal', racerCount: 8 };

export function sanitizeSettings(input: Partial<RoomSettings> | undefined, base: RoomSettings = DEFAULT_ROOM_SETTINGS): RoomSettings {
  const s = { ...base, ...(input ?? {}) };
  return {
    trackId: typeof s.trackId === 'string' && isTrackId(s.trackId) ? s.trackId : base.trackId,
    laps: Math.min(5, Math.max(1, Math.round(Number(s.laps) || base.laps))),
    items: Boolean(s.items),
    difficulty: DIFFICULTIES.includes(s.difficulty) ? s.difficulty : base.difficulty,
    racerCount: Math.min(MAX_RACERS, Math.max(0, Math.round(Number(s.racerCount) || 0))),
  };
}

export interface JoinOptions {
  version: number;
  name: string;
  seats: SeatChoice[];
}

export interface CreateOptions extends JoinOptions {
  /** Private rooms are joinable by code only; public ones also take quick-match players. */
  visibility: 'private' | 'public';
  settings?: Partial<RoomSettings>;
}

// ------------------------------------------------------------------ lobby state (plain view)

export interface LobbySeatView {
  name: string;
  character: string;
  kart: string;
}

export interface LobbyMemberView {
  sessionId: string;
  name: string;
  ready: boolean;
  connected: boolean;
  /** Round-trip time reported by the client (ms). */
  ping: number;
  /** Points across this room's races (GP scoring). */
  points: number;
  seats: LobbySeatView[];
}

/** `room.state.toJSON()` of the server's LobbyState. */
export interface LobbyStateView {
  code: string;
  phase: RoomPhase;
  hostId: string;
  trackId: string;
  laps: number;
  items: boolean;
  difficulty: Difficulty;
  racerCount: number;
  raceCount: number;
  members: Record<string, LobbyMemberView>;
}

// ------------------------------------------------------------------ messages

export const Msg = {
  /** client → server: InputMessage, every tick while racing. */
  Input: 'i',
  /** server → client: binary snapshot (see Snapshot.ts). */
  Snapshot: 's',
  /** server → all: EventsMessage. */
  Events: 'e',
  /** server → all: RaceStartMessage. */
  RaceStart: 'race',
  /** server → all: RaceEndMessage. */
  RaceEnd: 'end',
  /** client → server: { ready: boolean }. */
  Ready: 'ready',
  /** client (host) → server: Partial<RoomSettings>. */
  Settings: 'settings',
  /** client (host) → server: start the race. */
  StartRace: 'start',
  /** client → server: { rtt } latest measured round trip. */
  Ping: 'ping',
  /** server → client: human-readable notice (e.g. "Host left — Bix is now host"). */
  Notice: 'notice',
} as const;

/** [seq, packedSeat0, packedSeat1, …] — see InputCodec. */
export type InputMessage = number[];

export interface EventsMessage {
  /** Server tick the events happened on (last tick of the batch). */
  t: number;
  e: RaceEvent[];
}

export interface RaceStartMessage {
  raceId: number;
  seed: number;
  settings: RoomSettings;
  checkpoints: number;
  countdown: number;
  catchUp: boolean;
  racers: RacerSetup[];
  /** Owning session id per racer ('' for CPUs). */
  owners: string[];
}

export interface RaceResultRow {
  id: string;
  name: string;
  sessionId: string;
  characterId: string;
  position: number;
  finished: boolean;
  time: number;
  points: number;
}

export interface RaceEndMessage {
  raceId: number;
  rows: RaceResultRow[];
}
