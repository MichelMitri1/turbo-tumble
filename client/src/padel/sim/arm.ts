/**
 * The live racket arm (camera "motion" play — 1:1, like MotionPlus): your real arm's pose, as
 * directions in your body frame, drives the player's arm and racket every frame. The same numbers
 * place the racket head in the sim, so the racket you see is the racket that hits the ball.
 *
 * Body frame: r = the player's right, u = up, f = forward (towards the net / your screen).
 * The player's shoulder and arm lengths are the character model's (measured from its bones).
 */
export type V3 = [number, number, number];

export interface LiveArm {
  /** Which arm holds the racket: 1 = right, 2 = left. */
  side: 1 | 2;
  /** Shoulder turn (radians, seen from above; + = the right shoulder going back, as in a forehand backswing). */
  yaw: number;
  /** Unit directions: shoulder → elbow, elbow → wrist, the racket shaft (grip → tip), the face normal. */
  upper: V3;
  fore: V3;
  dir: V3;
  normal: V3;
  /** Racket head velocity, body frame (m/s). */
  vel: V3;
  /** Hit assist: the hit radius multiplier (1 = real racket size … 1.6 = easy). */
  reach?: number;
}

export const ARM = {
  /** Shoulder joint relative to the feet (racket side positive r). */
  shoulder: { r: 0.15, u: 1.35, f: 0.06 },
  upper: 0.18,
  fore: 0.23,
  /** Wrist → centre of the racket face along the shaft. */
  head: 0.29,
  /** How close (m) the ball must pass the face centre to be struck. */
  hitRadius: 0.36,
} as const;

/** Rotate a body-frame (r, f) pair by the shoulder turn. */
export function turn(r: number, f: number, yaw: number): [number, number] {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [r * c + f * s, -r * s + f * c];
}

/** Shoulder, elbow, wrist and face centre in the body frame (relative to the feet). */
export function armJoints(a: LiveArm): { shoulder: V3; elbow: V3; wrist: V3; head: V3 } {
  const side = a.side === 2 ? -1 : 1;
  const [sr, sf] = turn(ARM.shoulder.r * side, ARM.shoulder.f, a.yaw);
  const shoulder: V3 = [sr, ARM.shoulder.u, sf];
  const elbow: V3 = [shoulder[0] + a.upper[0] * ARM.upper, shoulder[1] + a.upper[1] * ARM.upper, shoulder[2] + a.upper[2] * ARM.upper];
  const wrist: V3 = [elbow[0] + a.fore[0] * ARM.fore, elbow[1] + a.fore[1] * ARM.fore, elbow[2] + a.fore[2] * ARM.fore];
  const head: V3 = [wrist[0] + a.dir[0] * ARM.head, wrist[1] + a.dir[1] * ARM.head, wrist[2] + a.dir[2] * ARM.head];
  return { shoulder, elbow, wrist, head };
}

/** Body frame → world, for a player standing at (x, y, z) facing `facing` (0 = +z). */
export function bodyToWorld(facing: number, v: V3, origin: V3 = [0, 0, 0]): V3 {
  const fx = Math.sin(facing);
  const fz = Math.cos(facing);
  // The player's right is (−cos f, 0, sin f): for facing 0 (+z) that's −x.
  const rx = -fz;
  const rz = fx;
  return [origin[0] + v[0] * rx + v[2] * fx, origin[1] + v[1], origin[2] + v[0] * rz + v[2] * fz];
}

const n3 = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** Sanitize an arm from the network (unit vectors, sane numbers). */
export function cleanArm(raw: unknown): LiveArm | null {
  if (!Array.isArray(raw) || raw.length < 17) return null;
  const v = raw.map(Number);
  if (!v.every(Number.isFinite)) return null;
  const vec = (i: number): V3 => n3([v[i]!, v[i + 1]!, v[i + 2]!]);
  const cl = (x: number) => Math.max(-40, Math.min(40, x));
  const reach = v.length > 17 ? Math.max(0.8, Math.min(1.6, v[17]!)) : 1;
  return { side: v[0] === 2 ? 2 : 1, yaw: Math.max(-1.3, Math.min(1.3, v[1]!)), upper: vec(2), fore: vec(5), dir: vec(8), normal: vec(11), vel: [cl(v[14]!), cl(v[15]!), cl(v[16]!)], reach };
}

/** Pack an arm for the network / snapshot (18 numbers). */
export function packArm(a: LiveArm): number[] {
  return [a.side, a.yaw, ...a.upper, ...a.fore, ...a.dir, ...a.normal, ...a.vel, a.reach ?? 1];
}
