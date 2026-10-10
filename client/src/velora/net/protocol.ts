/**
 * Velora Online: a shared free-roam session (up to 16 players). Each client simulates its own
 * character and car and reports them ~20 times a second; the server relays everyone's state,
 * forwards hits / explosions / car claims, keeps the kill feed and the shared clock.
 * NPC traffic, pedestrians and the police are local to each player.
 */
export const VL_ROOM = 'velora';
export const VL_VERSION = 1;
export const VL_MAX = 16;

export const VlMsg = {
  State: 'vl:state', // client → server: PlayerState
  Snap: 'vl:snap', // server → clients: { t, players: RemoteState[] }
  Welcome: 'vl:welcome', // server → client: Welcome
  Hit: 'vl:hit', // client → server: Hit · server → target: Hit & { from }
  CarHit: 'vl:carhit', // client → server: { owner, dmg } · server → owner
  Shot: 'vl:shot', // client → server: Shot · server → others: Shot & { from }
  Boom: 'vl:boom', // client → server: { x, y, z } · server → others
  Died: 'vl:died', // client → server: { by } · server → all: Feed
  Feed: 'vl:feed', // server → all: { text, kind }
  Claim: 'vl:claim', // client → server: { owner } (take a parked player car)
  Granted: 'vl:granted', // server → claimer: { car: CarState }
  Release: 'vl:release', // server → owner: {} (your parked car was taken)
  Chat: 'vl:chat', // client → server: { text } · server → all: { from, name, text }
  Error: 'vl:err',
} as const;

export interface CarState {
  model: string;
  paint: number;
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  /** Forward speed (m/s) — wheels spin, engine sound. */
  v: number;
  siren: boolean;
  hp: number;
}

export interface PlayerState {
  x: number;
  y: number;
  z: number;
  h: number;
  pose: string;
  gun: string;
  alive: boolean;
  wanted: number;
  /** Driving. */
  car: CarState | null;
  /** The car you got out of (stays in the world for others to see / steal). */
  parked: CarState | null;
  model: string;
}

export interface RemoteState extends PlayerState {
  id: string;
  name: string;
  kills: number;
  deaths: number;
}

export interface Welcome {
  code: string;
  me: string;
  /** Server epoch ms when the session's clock read `hour`. */
  t0: number;
  hour: number;
  lan: boolean;
}

export interface Hit {
  target: string;
  dmg: number;
  /** Weapon / cause for the kill feed. */
  what: string;
}

export interface Shot {
  fx: number;
  fy: number;
  fz: number;
  tx: number;
  ty: number;
  tz: number;
  sfx: string;
  rate: number;
}

export interface VlJoin {
  version: number;
  name: string;
  model: string;
  visibility?: 'public' | 'private';
}
