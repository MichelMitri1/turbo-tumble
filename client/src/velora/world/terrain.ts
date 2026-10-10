import { HALF, RIVER, RIVER_W, SIZE, coastZ } from './layout';

/**
 * The land: a heightfield (4 m cells) with the Vista Hills to the north, the river channel,
 * the beach sloping into the sea, and flat ground wherever a road runs.
 */

export const CELL = 4;
export const GRID = SIZE / CELL; // cells per side
export const VERTS = GRID + 1;

/** Distance to the river centre line (and which side: + east/south, − west/north). */
export function riverDist(x: number, z: number): { d: number; side: number } {
  let best = Infinity;
  let side = 1;
  for (let i = 0; i < RIVER.length - 1; i++) {
    const [ax, az] = RIVER[i]!;
    const [bx, bz] = RIVER[i + 1]!;
    const dx = bx - ax;
    const dz = bz - az;
    const l2 = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    const px = ax + dx * t;
    const pz = az + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best) {
      best = d;
      // Side: cross product of the river direction and the point (positive = east of the river).
      side = dx * (z - az) - dz * (x - ax) < 0 ? 1 : -1;
    }
  }
  return { d: best, side };
}

const ss = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Land height before roads are cut in (hills + coast, no river). */
export function baseHeight(x: number, z: number): number {
  let h = 0;
  // Vista Hills.
  const hill = ss(-600, -960, z) * ss(560, 380, x) * ss(-760, -560, x) * 0;
  const ridge = ss(-600, -900, z) * (1 - ss(380, 560, x));
  h += ridge * (34 + 14 * Math.sin(x * 0.012) * Math.cos(z * 0.017) + 8 * Math.sin(x * 0.031 + z * 0.02));
  void hill;
  // Rolling ground in the west.
  if (x < -560) h += 2.5 * Math.sin(x * 0.02) * Math.sin(z * 0.017) + 2.5;
  // Coast: the beach drops into the sea.
  const c = coastZ(x);
  if (z > c - 60) h = Math.min(h, -(z - (c - 60)) * 0.09);
  return h;
}

export class Terrain {
  readonly h = new Float32Array(VERTS * VERTS);

  constructor() {
    for (let j = 0; j < VERTS; j++)
      for (let i = 0; i < VERTS; i++) {
        const x = i * CELL - HALF;
        const z = j * CELL - HALF;
        let h = baseHeight(x, z);
        // River channel.
        const { d } = riverDist(x, z);
        const bank = RIVER_W / 2;
        if (d < bank + 14) {
          const t = ss(bank + 14, bank - 6, d);
          h = h * (1 - t) + -7 * t;
        }
        this.h[j * VERTS + i] = Math.max(-9, h);
      }
  }

  /** Height at a world point (bilinear). */
  height(x: number, z: number): number {
    const fx = (x + HALF) / CELL;
    const fz = (z + HALF) / CELL;
    const i = Math.max(0, Math.min(GRID - 1, Math.floor(fx)));
    const j = Math.max(0, Math.min(GRID - 1, Math.floor(fz)));
    const u = Math.max(0, Math.min(1, fx - i));
    const v = Math.max(0, Math.min(1, fz - j));
    const a = this.h[j * VERTS + i]!;
    const b = this.h[j * VERTS + i + 1]!;
    const c = this.h[(j + 1) * VERTS + i]!;
    const d = this.h[(j + 1) * VERTS + i + 1]!;
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
  }

  /**
   * Flatten the land to the roads: inside `inner` metres it's the road height exactly,
   * fading back to the natural ground by `outer`.
   */
  flatten(samples: Array<{ x: number; z: number; y: number; inner: number; outer: number }>): void {
    const best = new Float32Array(VERTS * VERTS).fill(Infinity);
    const target = new Float32Array(VERTS * VERTS);
    const weight = new Float32Array(VERTS * VERTS);
    for (const s of samples) {
      const r = Math.ceil(s.outer / CELL);
      const ci = Math.round((s.x + HALF) / CELL);
      const cj = Math.round((s.z + HALF) / CELL);
      for (let j = cj - r; j <= cj + r; j++)
        for (let i = ci - r; i <= ci + r; i++) {
          if (i < 0 || j < 0 || i >= VERTS || j >= VERTS) continue;
          const d = Math.hypot(i * CELL - HALF - s.x, j * CELL - HALF - s.z);
          if (d > s.outer) continue;
          const k = j * VERTS + i;
          if (d < best[k]!) {
            best[k] = d;
            target[k] = s.y;
            weight[k] = d <= s.inner ? 1 : 1 - ss(s.inner, s.outer, d);
          }
        }
    }
    for (let k = 0; k < this.h.length; k++) if (weight[k]! > 0) this.h[k] = this.h[k]! * (1 - weight[k]!) + target[k]! * weight[k]!;
  }
}
