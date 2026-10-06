import { Vector3 } from 'three';

/**
 * The standard soccar arena as an exact signed-distance field, in Unreal units
 * (1 uu = 1 cm). World axes: x = side (±4096), y = length (blue goal at −y),
 * z = up. Floor at z = 0, ceiling at 2044, 45° corners where |x|+|y| = 8064,
 * every floor/ceiling/wall seam rounded with a 256 uu fillet, and a goal
 * cavity (1786 × 880 × 642.775) carved into each back wall.
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
  goalFillet: 40,
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

/** Signed distance to a convex polygon (negative inside). Exact. */
function polySdf(px: number, py: number, poly: Array<[number, number]>): number {
  let d = Infinity;
  let inside = true;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i]!;
    const [bx, by] = poly[(i + 1) % poly.length]!;
    const ex = bx - ax;
    const ey = by - ay;
    const wx = px - ax;
    const wy = py - ay;
    const t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey)));
    const dx = wx - ex * t;
    const dy = wy - ey * t;
    d = Math.min(d, dx * dx + dy * dy);
    // Counter-clockwise polygon: inside if left of every edge.
    if (ex * wy - ey * wx < 0) inside = false;
  }
  d = Math.sqrt(d);
  return inside ? -d : d;
}

/** Signed distance to a prism (polygon × [z0, z1]). */
function prismSdf(px: number, py: number, pz: number, poly: Array<[number, number]>, z0: number, z1: number): number {
  const d2 = polySdf(px, py, poly);
  const dz = Math.max(z0 - pz, pz - z1);
  if (d2 > 0 || dz > 0) return Math.hypot(Math.max(d2, 0), Math.max(dz, 0));
  return Math.max(d2, dz);
}

/** Signed distance to an axis-aligned box. */
function boxSdf(px: number, py: number, pz: number, cx: number, cy: number, cz: number, hx: number, hy: number, hz: number): number {
  const qx = Math.abs(px - cx) - hx;
  const qy = Math.abs(py - cy) - hy;
  const qz = Math.abs(pz - cz) - hz;
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  const oz = Math.max(qz, 0);
  return Math.hypot(ox, oy, oz) + Math.min(Math.max(qx, qy, qz), 0);
}

const G = ARENA.goalFillet;
const GHX = ARENA.goalHalfX - G;
const GHZ = (ARENA.goalHeight - 2 * G) / 2;
const GCZ = ARENA.goalHeight / 2;
// Goal box from inside the field to the back of the net (rounded by G).
const GY0 = ARENA.halfY - 600;
const GY1 = ARENA.halfY + ARENA.goalDepth - G;
const GCY = (GY0 + GY1) / 2;
const GHY = (GY1 - GY0) / 2;

/** Distance from p to the arena surface (positive = inside the playable space). */
export function arenaDistance(x: number, y: number, z: number): number {
  const main = R - prismSdf(x, y, z, OCT, R, ARENA.height - R);
  // Goals: only matter near the back walls.
  if (Math.abs(y) > ARENA.halfY - 700 && Math.abs(x) < ARENA.goalHalfX + 300 && z < ARENA.goalHeight + 300) {
    const goal = G - boxSdf(x, Math.abs(y), z, 0, GCY, GCZ, GHX, GHY, GHZ);
    return Math.max(main, goal);
  }
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
