/** Crownfall online protocol (shared by the browser and the game server). */
export const CF_ROOM = 'crownfall';
/** Bumped whenever the wire format changes; mismatched clients are refused. */
export const CF_VERSION = 2;
export const CF_RECONNECT_SECONDS = 20;

export const CfMsg = {
  /** client → server: { cardId, x, y } in server coordinates. */
  Play: 'cf:play',
  /** client → server: { deck? } — ready for another battle. */
  Rematch: 'cf:rematch',
  /** server → client: lobby view. */
  Lobby: 'cf:lobby',
  /** server → client: a battle begins. */
  Start: 'cf:start',
  /** server → client: battle snapshot (see codec.ts). */
  Snap: 'cf:snap',
  /** server → client: a card play was refused. */
  Nope: 'cf:nope',
  /** client → server: { emote: 0..3 } — a taunt, echoed to both players as an 'emote' event. */
  Emote: 'cf:emote',
} as const;

export interface CfJoinOptions {
  version: number;
  name: string;
  deck: string[];
}

export interface CfCreateOptions extends CfJoinOptions {
  visibility: 'private' | 'public';
}

export interface CfLobbyView {
  code: string;
  phase: 'lobby' | 'battle' | 'ended';
  players: Array<{ sessionId: string; name: string; seat: 'blue' | 'red'; connected: boolean; rematch: boolean }>;
}

export interface CfStart {
  battleId: number;
  /** Which side this client controls (the red client mirrors the board). */
  seat: 'blue' | 'red';
  names: { blue: string; red: string };
  decks: { blue: string[]; red: string[] };
}
