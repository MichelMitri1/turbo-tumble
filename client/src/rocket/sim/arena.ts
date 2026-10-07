import { Vector3 } from 'three';

/**
 * The standard soccar arena as an exact signed-distance field, in Unreal units
 * (1 uu = 1 cm). World axes: x = side (±4096), y = length (blue goal at −y),
 * z = up. Floor at z = 0, ceiling at 2044, 45° corners where |x|+|y| = 8064,
 * every floor/ceiling/wall seam rounded with a 256 uu fillet, and a goal
 * cavity (1786 wide × 642.775 tall, ~880 deep) carved into each back wall,
 * with curved inside edges and a leaning, drivable back.
 *
 * `distance(p)` is positive inside the playable volume and is the exact distance
 * to the nearest surface; `normal(p)` points into the arena.
 */

export const ARENA = {
  halfX: 4096,
  halfY: 5120,
  height: 2044,
  corner: 8064,
  fillet: 256,
  goalHalfX: 892.755,
  goalHeight: 642.775,
  goalDepth: 880,
  /** Ball fully past this |y| = goal. */
  goalLineY: 5124.25,
} as const;

// Inset octagon (the shape the fillet radius sweeps around).
const R = ARENA.fillet;
const IX = ARENA.halfX - R;
const IY = ARENA.halfY - R;
const IC = ARENA.corner - R * Math.SQRT2;
const OCT: Array<[number, number]> = [
  [IX, IC - IX],
  [IC - IY, IY],
  [-(IC - IY), IY],
  [-IX, IC - IX],
  [-IX, -(IC - IX)],
  [-(IC - IY), -IY],
  [IC - IY, -IY],
  [IX, -(IC - IX)],
];

/** A convex polygon prepared for fast distance queries: per edge [ax, ay, ex, ey, 1/|e|²]. */
type Poly = Float64Array;
function makePoly(pts: ReadonlyArray<readonly [number, number]>): Poly {
  const out = new Float64Array(pts.length * 5);
  pts.forEach(([ax, ay], i) => {
    const [bx, by] = pts[(i + 1) % pts.length]!;
    const ex = bx - ax;
    const ey = by - ay;
    out.set([ax, ay, ex, ey, 1 / (ex * ex + ey * ey)], i * 5);
  });
  return out;
}

/** Signed distance to a convex, counter-clockwise polygon (negative inside). Exact. */
function polySdf(px: number, py: number, P: Poly): number {
  let d = Infinity;
  let inside = true;
  for (let o = 0; o < P.length; o += 5) {
    const wx = px - P[o]!;
    const wy = py - P[o + 1]!;
    const ex = P[o + 2]!;
    const ey = P[o + 3]!;
    let t = (wx * ex + wy * ey) * P[o + 4]!;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = wx - ex * t;
    const dy = wy - ey * t;
    const dd = dx * dx + dy * dy;
    if (dd < d) d = dd;
    // Inside if left of every edge.
    if (ex * wy - ey * wx < 0) inside = false;
  }
  d = Math.sqrt(d);
  return inside ? -d : d;
}

/** Signed distance to a prism (polygon × [z0, z1]). */
function prismSdf(px: number, py: number, pz: number, poly: Poly, z0: number, z1: number): number {
  const d2 = polySdf(px, py, poly);
  const dz = Math.max(z0 - pz, pz - z1);
  if (d2 > 0 || dz > 0) return Math.hypot(Math.max(d2, 0), Math.max(dz, 0));
  return Math.max(d2, dz);
}

// ---------------------------------------------------------------- goals
//
// Each goal is a cavity behind the back wall. Its (y, z) cross-section is a
// quad (floor, leaning back wall, roof) rounded by GOAL_R, so the floor curves
// up into the back and over into the roof — drivable, like the real game —
// and its side edges are rounded by GOAL_RS. The mouth stays a rectangle
// (corners rounded by GOAL_RS) in the back wall.

const HY = ARENA.halfY;
const GH = ARENA.goalHeight;
const GX = ARENA.goalHalfX;
/** Floor ↔ back ↔ roof curve radius. */
export const GOAL_R = 240;
/** Side edge radius. */
export const GOAL_RS = 70;
/** The back wall leans back: its depth behind the goal line at the floor and at the roof. */
export const GOAL_BACK_BOTTOM = HY + 760;
export const GOAL_BACK_TOP = HY + 960;
const BACK_RUN = GOAL_BACK_TOP - GOAL_BACK_BOTTOM;
const BACK_LEN = Math.hypot(BACK_RUN, GH);
/** Back wall normal pointing out of the goal (+y, slightly down), in (y, z). */
export const GOAL_BACK_OUT: readonly [number, number] = [GH / BACK_LEN, -BACK_RUN / BACK_LEN];
/** y of the inner (radius-shrunk) back line at height z. */
const innerBackY = (z: number) => GOAL_BACK_BOTTOM - GOAL_BACK_OUT[0] * GOAL_R + (z + GOAL_BACK_OUT[1] * GOAL_R) * (BACK_RUN / GH);
/** Inner polygon (y, z), counter-clockwise; its GOAL_R offset is the goal's cross-section. */
export const GOAL_INNER: ReadonlyArray<readonly [number, number]> = [
  [HY - 600, GOAL_R],
  [innerBackY(GOAL_R), GOAL_R],
  [innerBackY(GH - GOAL_R), GH - GOAL_R],
  [HY - 600, GH - GOAL_R],
];
const GOAL_POLY = makePoly(GOAL_INNER);
const OCT_POLY = makePoly(OCT);

/** Signed distance to the goal cavity (negative inside), for |y| (mirrored per goal). */
function goalSdf(x: number, ay: number, z: number): number {
  const d2 = polySdf(ay, z, GOAL_POLY) - GOAL_R;
  const dx = Math.abs(x) - GX;
  // Rounded intersection of the (y, z) profile and the side walls (orthogonal → exact).
  const a = d2 + GOAL_RS;
  const b = dx + GOAL_RS;
  return Math.hypot(Math.max(a, 0), Math.max(b, 0)) + Math.min(Math.max(a, b), 0) - GOAL_RS;
}

/** The main arena alone (without the goals): positive inside. */
export function arenaMainDistance(x: number, y: number, z: number): number {
  return R - prismSdf(x, y, z, OCT_POLY, R, ARENA.height - R);
}

/** Distance from p to the arena surface (positive = inside the playable space). */
export function arenaDistance(x: number, y: number, z: number): number {
  const main = arenaMainDistance(x, y, z);
  // Goals: only matter near the back walls.
  if (Math.abs(y) > HY - 700 && Math.abs(x) < GX + 300 && z < GH + 300) return Math.max(main, -goalSdf(x, Math.abs(y), z));
  return main;
}

const EPS = 1;
/** Surface normal (unit, pointing into the arena) at p. */
export function arenaNormal(x: number, y: number, z: number, out = new Vector3()): Vector3 {
  out.set(
    arenaDistance(x + EPS, y, z) - arenaDistance(x - EPS, y, z),
    arenaDistance(x, y + EPS, z) - arenaDistance(x, y - EPS, z),
    arenaDistance(x, y, z + EPS) - arenaDistance(x, y, z - EPS),
  );
  const l = out.length();
  return l > 1e-9 ? out.multiplyScalar(1 / l) : out.set(0, 0, 1);
}

/** March along `dir` from `from`; returns hit distance (≤ maxDist) or -1. */
export function arenaRaycast(from: Vector3, dir: Vector3, maxDist: number): number {
  let t = 0;
  for (let i = 0; i < 24; i++) {
    const d = arenaDistance(from.x + dir.x * t, from.y + dir.y * t, from.z + dir.z * t);
    if (d < 0.5) return t;
    t += d;
    if (t > maxDist) return -1;
  }
  return -1;
}

export const OCTAGON_INSET = OCT;
