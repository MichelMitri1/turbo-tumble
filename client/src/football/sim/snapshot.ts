import { CHARGE_TIME, type KickType, type MatchSim, type Phase, type PState, type RestartKind } from './match';

/**
 * A rendered moment of a match, packed in a Float32Array. The renderer only ever draws
 * frames, so the same code shows a local match, an online match (frames from the
 * server, interpolated) and goal replays (frames from a ring buffer).
 */

export const PHASES: Phase[] = ['kickoff', 'play', 'stop', 'goal', 'halftime', 'fulltime'];
export const STATES: PState[] = ['run', 'kick', 'tackle', 'slide', 'down', 'dive', 'hold', 'celebrate', 'off', 'rise'];
export const KICKS: KickType[] = ['pass', 'through', 'lob', 'lobThrough', 'cross', 'shot', 'finesse', 'chip', 'clear', 'throw', 'gkThrow', 'header', 'penalty'];
export const RESTARTS: Array<RestartKind | null> = [null, 'kickoff', 'throw', 'corner', 'goalkick', 'free', 'penalty'];
const BTNS = ['pass', 'shoot', 'through', 'lob'] as const;

export const HEAD = 16;
export const PER = 10;
export const PER_H = 6;
export const MAX_HUMANS = 8;

export interface FramePlayer {
  x: number;
  z: number;
  face: number;
  speed: number;
  state: PState;
  /** Seconds left in the state. */
  t: number;
  leftFoot: boolean;
  human: number;
  kick: KickType | null;
  diveZ: number;
  diveY: number;
  sprint: boolean;
  yellow: number;
}

export interface FrameHuman {
  p: number;
  team: 0 | 1;
  /** Charging power 0…1 (−1 = not charging) and which button. */
  power: number;
  btn: (typeof BTNS)[number] | null;
  /** Set-piece target marker (null when not aiming one). */
  aim: { x: number; z: number } | null;
}

export interface Frame {
  time: number;
  phase: Phase;
  clock: number;
  half: 1 | 2;
  score: [number, number];
  restart: RestartKind | null;
  restartTeam: 0 | 1;
  /** Team 0 attacks +x (1) or −x (−1). */
  dir0: 1 | -1;
  ball: { x: number; y: number; z: number; owner: number; vx: number; vy: number; vz: number };
  players: FramePlayer[];
  humans: FrameHuman[];
}

export function writeFrame(m: MatchSim, out?: Float32Array): Float32Array {
  const n = HEAD + m.players.length * PER + 1 + MAX_HUMANS * PER_H;
  const f = out && out.length === n ? out : new Float32Array(n);
  const b = m.ball;
  f[0] = m.time;
  f[1] = PHASES.indexOf(m.phase);
  f[2] = m.clock;
  f[3] = m.half;
  f[4] = m.score[0];
  f[5] = m.score[1];
  f[6] = RESTARTS.indexOf(m.restart?.kind ?? null);
  f[7] = m.restart?.team ?? 0;
  f[8] = m.dir[0];
  f[9] = b.x;
  f[10] = b.y;
  f[11] = b.z;
  f[12] = b.owner;
  f[13] = b.vx;
  f[14] = b.vy;
  f[15] = b.vz;
  let o = HEAD;
  for (const p of m.players) {
    f[o] = p.x;
    f[o + 1] = p.z;
    f[o + 2] = p.face;
    f[o + 3] = Math.hypot(p.vx, p.vz);
    f[o + 4] = STATES.indexOf(p.state);
    f[o + 5] = p.t;
    f[o + 6] = (p.leftFoot ? 1 : 0) | (p.sprint ? 2 : 0) | (Math.min(3, p.yellow) << 2);
    f[o + 7] = p.human;
    f[o + 8] = p.kick ? KICKS.indexOf(p.kick.type) : -1;
    f[o + 9] = p.dive ? p.dive.dz * 10 + Math.round(p.dive.dy * 4) : 0;
    o += PER;
  }
  f[o++] = m.humans.length;
  for (let i = 0; i < MAX_HUMANS; i++) {
    const h = m.humans[i];
    f[o] = h?.p ?? -1;
    f[o + 1] = h?.team ?? 0;
    f[o + 2] = h?.charge ? Math.min(1, h.charge.t / CHARGE_TIME) : -1;
    f[o + 3] = h?.charge ? BTNS.indexOf(h.charge.btn) : -1;
    f[o + 4] = h?.aim ? h.aim.x : NaN;
    f[o + 5] = h?.aim ? h.aim.z : NaN;
    o += PER_H;
  }
  return f;
}

export function readFrame(f: Float32Array, count = 22): Frame {
  const players: FramePlayer[] = [];
  let o = HEAD;
  for (let i = 0; i < count; i++) {
    const flags = f[o + 6]!;
    const dv = f[o + 9]!;
    const dz = Math.round(dv / 10);
    players.push({
      x: f[o]!,
      z: f[o + 1]!,
      face: f[o + 2]!,
      speed: f[o + 3]!,
      state: STATES[f[o + 4]!] ?? 'run',
      t: f[o + 5]!,
      leftFoot: (flags & 1) !== 0,
      sprint: (flags & 2) !== 0,
      yellow: (flags >> 2) & 3,
      human: f[o + 7]!,
      kick: f[o + 8]! >= 0 ? KICKS[f[o + 8]!]! : null,
      diveZ: dz,
      diveY: (dv - dz * 10) / 4,
    });
    o += PER;
  }
  const nh = f[o++]!;
  const humans: FrameHuman[] = [];
  for (let i = 0; i < nh; i++) {
    humans.push({ p: f[o]!, team: f[o + 1]! as 0 | 1, power: f[o + 2]!, btn: f[o + 3]! >= 0 ? BTNS[f[o + 3]!]! : null, aim: Number.isNaN(f[o + 4]!) ? null : { x: f[o + 4]!, z: f[o + 5]! } });
    o += PER_H;
  }
  return {
    time: f[0]!,
    phase: PHASES[f[1]!]!,
    clock: f[2]!,
    half: f[3]! as 1 | 2,
    score: [f[4]!, f[5]!],
    restart: RESTARTS[f[6]!] ?? null,
    restartTeam: f[7]! as 0 | 1,
    dir0: f[8]! as 1 | -1,
    ball: { x: f[9]!, y: f[10]!, z: f[11]!, owner: f[12]!, vx: f[13]!, vy: f[14]!, vz: f[15]! },
    players,
    humans,
  };
}

/** Blend two frames (positions, facing, ball) for smooth online play. */
export function lerpFrame(a: Frame, b: Frame, k: number): Frame {
  if (k <= 0) return a;
  if (k >= 1) return b;
  const L = (x: number, y: number) => x + (y - x) * k;
  // Teleports (restarts) snap instead of sliding.
  const jump = (x0: number, z0: number, x1: number, z1: number) => Math.hypot(x1 - x0, z1 - z0) > 4;
  return {
    ...b,
    time: L(a.time, b.time),
    clock: L(a.clock, b.clock),
    ball: jump(a.ball.x, a.ball.z, b.ball.x, b.ball.z) ? b.ball : { ...b.ball, x: L(a.ball.x, b.ball.x), y: L(a.ball.y, b.ball.y), z: L(a.ball.z, b.ball.z) },
    players: b.players.map((p, i) => {
      const q = a.players[i]!;
      if (jump(q.x, q.z, p.x, p.z)) return p;
      let d = p.face - q.face;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      return { ...p, x: L(q.x, p.x), z: L(q.z, p.z), face: q.face + d * k, speed: L(q.speed, p.speed) };
    }),
  };
}
