/**
 * Collision world: every solid thing on a map is an axis-aligned box (walls,
 * floors, crates, containers…). Fast enough for 12 players + bullets at 60 Hz on
 * the server: boxes live in a 2D spatial hash over the ground plane.
 *
 * Coordinates: metres, y up (same as three.js).
 */
export type Material = 'concrete' | 'brick' | 'metal' | 'wood' | 'dirt' | 'sand' | 'asphalt' | 'grass' | 'glass' | 'plaster' | 'tile' | 'invisible';

export interface Box {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
  mat: Material;
  /** Bullets go through with reduced damage (wood, plaster, sheet metal). */
  thin?: boolean;
  /** Rendered by a prop model rather than as a textured block. */
  hidden?: boolean;
}

export interface RayHit {
  t: number;
  box: Box | null;
  nx: number;
  ny: number;
  nz: number;
}

const CELL = 4;

export class Level {
  readonly boxes: Box[] = [];
  private grid = new Map<number, Box[]>();
  minX = -50;
  maxX = 50;
  minZ = -50;
  maxZ = 50;
  private stamp = 0;
  private marks = new WeakMap<Box, number>();

  constructor(boxes: Box[]) {
    for (const b of boxes) this.add(b);
  }

  private key(cx: number, cz: number): number {
    return (cx + 512) * 1024 + (cz + 512);
  }

  add(b: Box): void {
    this.boxes.push(b);
    for (let cx = Math.floor(b.x0 / CELL); cx <= Math.floor(b.x1 / CELL); cx++)
      for (let cz = Math.floor(b.z0 / CELL); cz <= Math.floor(b.z1 / CELL); cz++) {
        const k = this.key(cx, cz);
        let l = this.grid.get(k);
        if (!l) this.grid.set(k, (l = []));
        l.push(b);
      }
  }

  /** Boxes overlapping an xz rectangle. */
  query(x0: number, z0: number, x1: number, z1: number, out: Box[] = []): Box[] {
    out.length = 0;
    const s = ++this.stamp;
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++)
      for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
        const l = this.grid.get(this.key(cx, cz));
        if (!l) continue;
        for (const b of l) {
          if (this.marks.get(b) === s) continue;
          this.marks.set(b, s);
          out.push(b);
        }
      }
    return out;
  }

  /**
   * Ray vs boxes (slab test), walking the grid along the ray.
   * Returns the nearest hit within maxT (or t = maxT, box null).
   */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, skipThin = false): RayHit {
    let best: RayHit = { t: maxT, box: null, nx: 0, ny: 0, nz: 0 };
    // Grid traversal (2D DDA over xz).
    let cx = Math.floor(ox / CELL);
    let cz = Math.floor(oz / CELL);
    const stepX = dx > 0 ? 1 : -1;
    const stepZ = dz > 0 ? 1 : -1;
    const tdx = dx !== 0 ? Math.abs(CELL / dx) : Infinity;
    const tdz = dz !== 0 ? Math.abs(CELL / dz) : Infinity;
    let tmx = dx !== 0 ? ((dx > 0 ? (cx + 1) * CELL : cx * CELL) - ox) / dx : Infinity;
    let tmz = dz !== 0 ? ((dz > 0 ? (cz + 1) * CELL : cz * CELL) - oz) / dz : Infinity;
    const s = ++this.stamp;
    let tCell = 0;
    for (let guard = 0; guard < 200 && tCell <= best.t; guard++) {
      const l = this.grid.get(this.key(cx, cz));
      if (l) {
        for (const b of l) {
          if (this.marks.get(b) === s) continue;
          this.marks.set(b, s);
          if (skipThin && b.thin) continue;
          const h = rayBox(ox, oy, oz, dx, dy, dz, b, best.t);
          if (h) best = h;
        }
      }
      if (tmx < tmz) {
        tCell = tmx;
        tmx += tdx;
        cx += stepX;
      } else {
        tCell = tmz;
        tmz += tdz;
        cz += stepZ;
      }
      if (cx < this.minX / CELL - 2 || cx > this.maxX / CELL + 2 || cz < this.minZ / CELL - 2 || cz > this.maxZ / CELL + 2) break;
    }
    // Ground plane (y = 0) and the map's floor.
    if (dy < 0) {
      const t = -oy / dy;
      if (t > 0 && t < best.t) best = { t, box: null, nx: 0, ny: 1, nz: 0 };
    }
    return best;
  }

  /** Is there a clear line between two points? */
  visible(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 1e-4) return true;
    return this.raycast(ax, ay, az, dx / d, dy / d, dz / d, d).box === null;
  }

  /** Highest surface under (x, z) at or below y (0 = ground). */
  floorAt(x: number, z: number, y: number, r = 0): number {
    let best = 0;
    for (const b of this.query(x - r, z - r, x + r, z + r, tmpList)) {
      if (x + r <= b.x0 || x - r >= b.x1 || z + r <= b.z0 || z - r >= b.z1) continue;
      if (b.y1 <= y + 1e-3 && b.y1 > best) best = b.y1;
    }
    return best;
  }

  /** Does an AABB overlap any box? */
  blocked(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean {
    for (const b of this.query(x0, z0, x1, z1, tmpList)) {
      if (x1 > b.x0 && x0 < b.x1 && y1 > b.y0 && y0 < b.y1 && z1 > b.z0 && z0 < b.z1) return true;
    }
    return false;
  }
}

const tmpList: Box[] = [];

function rayBox(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, b: Box, maxT: number): RayHit | null {
  let tmin = 0;
  let tmax = maxT;
  let axis = -1;
  let sign = 0;
  const o = [ox, oy, oz];
  const d = [dx, dy, dz];
  const lo = [b.x0, b.y0, b.z0];
  const hi = [b.x1, b.y1, b.z1];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]!) < 1e-12) {
      if (o[i]! < lo[i]! || o[i]! > hi[i]!) return null;
      continue;
    }
    let t1 = (lo[i]! - o[i]!) / d[i]!;
    let t2 = (hi[i]! - o[i]!) / d[i]!;
    let s = -1;
    if (t1 > t2) {
      [t1, t2] = [t2, t1];
      s = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      axis = i;
      sign = s;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (axis < 0) return null; // started inside
  return { t: tmin, box: b, nx: axis === 0 ? sign : 0, ny: axis === 1 ? sign : 0, nz: axis === 2 ? sign : 0 };
}

/** Ray vs sphere: distance or -1. */
export function raySphere(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, cx: number, cy: number, cz: number, r: number): number {
  const lx = ox - cx;
  const ly = oy - cy;
  const lz = oz - cz;
  const b = lx * dx + ly * dy + lz * dz;
  const c = lx * lx + ly * ly + lz * lz - r * r;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : -1;
}

/** Ray vs AABB given by centre/half extents: distance or -1. */
export function rayAabb(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number {
  const h = rayBox(ox, oy, oz, dx, dy, dz, { x0, y0, z0, x1, y1, z1, mat: 'invisible' }, 1e9);
  return h ? h.t : -1;
}
