import type { MatchSim, Phase, SwingKind } from './match';
import { cleanArm, packArm, type LiveArm } from './arm';

/**
 * What the renderer needs from a match, packed into a Float32Array: the same frame drives the local
 * game (written from the sim every render) and online play (sent by the server ~40 times a second).
 */
const PHASES: Phase[] = ['serve', 'toss', 'rally', 'dead', 'over'];
const SWINGS: Array<SwingKind | null> = [null, 'fh', 'bh', 'oh', 'serve'];
const HEAD = 30;
/** Per player: 10 numbers of body state + 18 of live arm (all zeros when there's none). */
const PER = 28;

export interface FramePlayer {
  x: number;
  z: number;
  y: number;
  facing: number;
  vx: number;
  vz: number;
  swing: SwingKind | null;
  swingT: number;
  hit: boolean;
  /** Camera motion play: the live racket arm. */
  arm: LiveArm | null;
}

export interface Frame {
  time: number;
  phase: Phase;
  phaseT: number;
  server: number;
  serveRight: boolean;
  secondServe: boolean;
  ball: [number, number, number];
  ballVel: [number, number, number];
  ballOut: boolean;
  points: [number, number];
  games: [number, number];
  sets: [number, number];
  tiebreak: boolean;
  winner: number;
  /** Finished sets' games (up to 3). */
  history: Array<[number, number]>;
  players: FramePlayer[];
}

export function writeFrame(m: MatchSim, out?: Float32Array): Float32Array {
  const n = m.players.length;
  const a = out && out.length === HEAD + n * PER ? out : new Float32Array(HEAD + n * PER);
  const sc = m.score;
  let o = 0;
  a[o++] = m.time;
  a[o++] = PHASES.indexOf(m.phase);
  a[o++] = m.phaseT;
  a[o++] = m.server;
  a[o++] = (m.serveRight ? 1 : 0) | (m.secondServe ? 2 : 0) | (sc.tiebreak ? 4 : 0) | (m.ball.out ? 8 : 0);
  for (const v of m.ball.pos) a[o++] = v;
  for (const v of m.ball.vel) a[o++] = v;
  a[o++] = sc.points[0];
  a[o++] = sc.points[1];
  a[o++] = sc.games[0];
  a[o++] = sc.games[1];
  a[o++] = sc.sets[0];
  a[o++] = sc.sets[1];
  a[o++] = m.winner;
  a[o++] = n;
  for (let s = 0; s < 3; s++) {
    const h = sc.history[s];
    a[o++] = h ? h[0] : -1;
    a[o++] = h ? h[1] : -1;
  }
  o = HEAD;
  for (const p of m.players) {
    a[o++] = p.pos[0];
    a[o++] = p.pos[1];
    a[o++] = p.y;
    a[o++] = p.facing;
    a[o++] = p.vel[0];
    a[o++] = p.vel[1];
    a[o++] = SWINGS.indexOf(p.swing?.kind ?? null);
    a[o++] = p.swing?.t ?? 0;
    a[o++] = p.swing?.hit ? 1 : 0;
    a[o++] = 0;
    const arm = p.arm ? packArm(p.arm) : null;
    for (let k = 0; k < 18; k++) a[o++] = arm ? arm[k]! : 0;
  }
  return a;
}

export function readFrame(a: Float32Array): Frame {
  let o = 0;
  const time = a[o++]!;
  const phase = PHASES[a[o++]!] ?? 'rally';
  const phaseT = a[o++]!;
  const server = a[o++]!;
  const bits = a[o++]!;
  const ball: [number, number, number] = [a[o++]!, a[o++]!, a[o++]!];
  const ballVel: [number, number, number] = [a[o++]!, a[o++]!, a[o++]!];
  const points: [number, number] = [a[o++]!, a[o++]!];
  const games: [number, number] = [a[o++]!, a[o++]!];
  const sets: [number, number] = [a[o++]!, a[o++]!];
  const winner = a[o++]!;
  const n = a[o++]!;
  const history: Array<[number, number]> = [];
  for (let s = 0; s < 3; s++) {
    const g0 = a[o++]!;
    const g1 = a[o++]!;
    if (g0 >= 0) history.push([g0, g1]);
  }
  const players: FramePlayer[] = [];
  o = HEAD;
  for (let i = 0; i < n; i++) {
    players.push({ x: a[o]!, z: a[o + 1]!, y: a[o + 2]!, facing: a[o + 3]!, vx: a[o + 4]!, vz: a[o + 5]!, swing: SWINGS[a[o + 6]!] ?? null, swingT: a[o + 7]!, hit: a[o + 8]! > 0, arm: a[o + 10]! ? cleanArm(Array.from(a.subarray(o + 10, o + 28))) : null });
    o += PER;
  }
  return {
    time,
    phase,
    phaseT,
    server,
    serveRight: (bits & 1) > 0,
    secondServe: (bits & 2) > 0,
    tiebreak: (bits & 4) > 0,
    ballOut: (bits & 8) > 0,
    ball,
    ballVel,
    points,
    games,
    sets,
    winner,
    history,
    players,
  };
}

/** Blend two frames (online smoothing): positions eased, discrete state from the newer one. */
export function lerpFrame(a: Frame, b: Frame, t: number): Frame {
  if (a.players.length !== b.players.length) return b;
  const L = (x: number, y: number) => x + (y - x) * t;
  const ang = (x: number, y: number) => {
    let d = y - x;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return x + d * t;
  };
  // A big jump in the ball (a hit, a serve reset) isn't smoothed.
  const jump = Math.hypot(b.ball[0] - a.ball[0], b.ball[1] - a.ball[1], b.ball[2] - a.ball[2]) > 2.5;
  return {
    ...b,
    ball: jump ? b.ball : [L(a.ball[0], b.ball[0]), L(a.ball[1], b.ball[1]), L(a.ball[2], b.ball[2])],
    players: b.players.map((p, i) => {
      const q = a.players[i]!;
      return { ...p, x: L(q.x, p.x), z: L(q.z, p.z), y: L(q.y, p.y), facing: ang(q.facing, p.facing) };
    }),
  };
}
