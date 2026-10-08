import type { GameEvent, Mode } from '../sim/game';
import type { BotSkill } from '../sim/bots';
import type { Loadout } from '../sim/weapons';
import type { Input } from '../sim/player';

/** Zero Hour online protocol. */
export const FP_ROOM = 'zerohour';
export const FP_VERSION = 2;
export const FP_MAX = 12;

export const FpMsg = {
  Input: 'fp:in', // client → server: FpInput[]
  Fire: 'fp:fire', // client → server: FpFire
  Class: 'fp:cls', // client → server: Loadout (next spawn)
  Config: 'fp:cfg', // host → server
  Team: 'fp:team',
  Start: 'fp:start',
  Ping: 'fp:ping',
  Lobby: 'fp:lobby', // server → client
  Begin: 'fp:begin', // server → client: FpBegin
  Snap: 'fp:snap', // server → client: FpSnap
  Events: 'fp:ev', // server → client: GameEvent[]
  Error: 'fp:err',
} as const;

export interface FpConfig {
  mode: Mode;
  map: string;
  /** Fill each team up to this many with bots. */
  bots: number;
  skill: BotSkill;
}

export interface FpLobby {
  code: string;
  phase: 'lobby' | 'playing' | 'over';
  hostId: string;
  config: FpConfig;
  players: Array<{ id: string; name: string; team: 0 | 1; connected: boolean }>;
  lan: boolean;
}

export interface FpBegin {
  map: string;
  mode: Mode;
  seed: number;
  lan: boolean;
  /** Everyone in the match (bots included). */
  roster: Array<{ id: string; name: string; team: 0 | 1; bot: boolean; loadout: Loadout; camos: Record<string, string> }>;
  time: number;
}

/** Compact per-tick input: [seq, mx, mz, yaw, pitch, bits, slot]. */
export type FpInput = [number, number, number, number, number, number, number];
export const INPUT_BITS = { jump: 1, sprint: 2, crouch: 4, ads: 8, fire: 16, reload: 32, grenade: 64, melee: 128, streak: 256 } as const;

export interface FpFire {
  /** Pellet directions. */
  d: number[][];
  /** Eye position at the shot. */
  o: [number, number, number];
  /** Server time the shooter was looking at (lag compensation). */
  at: number;
}

/**
 * Snapshot: soldiers as arrays
 * [idx, x, y, z, yaw, pitch, vx, vy, vz, bits, cur, hp, respawnIn, adsT]
 * bits: alive 1, crouch 2, sprint 4, slide 8, ground 16, reloading 32
 */
export interface FpSnap {
  t: number;
  tick: number;
  s: number[][];
  /** For the receiving player: [ack seq, ammo0, reserve0, ammo1, reserve1, reloadT, swapT, grenades, streak, kills, deaths, score, assists, slide] */
  me: number[];
  streaks: string[];
  score: [number, number];
  timeLeft: number;
  phase: 'warmup' | 'play' | 'over';
  warmup: number;
  flags: Array<[number, number, number]>;
  tags: Array<[number, number, number, number, number]>;
  helis: Array<[number, number, number, number, number, number]>;
  nades: Array<[number, number, number, number]>;
  uav: Array<[string, number]>;
  barrels: number[];
  /** Scoreboard (sent every second): [idx, kills, deaths, assists, score, ping ms]. */
  board?: number[][];
}

export interface FpJoin {
  version: number;
  name: string;
  loadout: Loadout;
  camos: Record<string, string>;
  visibility?: 'private' | 'public';
}

export type { GameEvent };

export function packInput(i: Input): FpInput {
  const b = INPUT_BITS;
  const bits = (i.jump ? b.jump : 0) | (i.sprint ? b.sprint : 0) | (i.crouch ? b.crouch : 0) | (i.ads ? b.ads : 0) | (i.fire ? b.fire : 0) | (i.reload ? b.reload : 0) | (i.grenade ? b.grenade : 0) | (i.melee ? b.melee : 0) | (i.streak ? b.streak : 0);
  return [i.seq, +i.mx.toFixed(3), +i.mz.toFixed(3), +i.yaw.toFixed(4), +i.pitch.toFixed(4), bits, i.slot];
}
export function unpackInput(a: FpInput): Input {
  const b = INPUT_BITS;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const bits = n(a[5]);
  return {
    seq: n(a[0]),
    mx: Math.max(-1, Math.min(1, n(a[1]))),
    mz: Math.max(-1, Math.min(1, n(a[2]))),
    yaw: n(a[3]),
    pitch: Math.max(-1.5, Math.min(1.5, n(a[4]))),
    jump: !!(bits & b.jump),
    sprint: !!(bits & b.sprint),
    crouch: !!(bits & b.crouch),
    ads: !!(bits & b.ads),
    fire: !!(bits & b.fire),
    reload: !!(bits & b.reload),
    grenade: !!(bits & b.grenade),
    melee: !!(bits & b.melee),
    streak: !!(bits & b.streak),
    slot: n(a[6]) === 0 || n(a[6]) === 1 ? n(a[6]) : -1,
  };
}

