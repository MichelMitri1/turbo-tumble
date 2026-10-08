import type { Box, Material } from './level';
import { PROP_BOUNDS } from './propBounds';

/**
 * Map-building kit: everything solid is a box (see level.ts); props are models
 * whose collision is a box too; `decor` boxes are drawn but never collide.
 */
export interface PropPlacement {
  model: string;
  x: number;
  y: number;
  z: number;
  /** Quarter turns about y. */
  rot: number;
  sx: number;
  sy: number;
  sz: number;
  collide: boolean;
  /** Tint multiplier (for team colours / grittier look). */
  tint?: string;
  /** Explosive (barrels). */
  explosive?: boolean;
  /** Boundary dressing: drawn instanced, no shadows. */
  edge?: boolean;
}

export interface SpawnPoint {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface MapTheme {
  sky: 'day' | 'dusk' | 'overcast' | 'night';
  ground: Material;
  /** Ground decals: [x0, z0, x1, z1, material] (flat, visual only). */
  patches: Array<[number, number, number, number, Material]>;
  /** Sun direction (towards the sun). */
  sun: [number, number, number];
  fog: [string, number, number];
}

/** What surrounds the playable area (render only). */
export type Backdrop = 'suburb' | 'industrial' | 'desert' | 'city' | 'estate';

export interface MapDef {
  id: string;
  name: string;
  desc: string;
  half: [number, number];
  boxes: Box[];
  /** Drawn, never collides (floors, roofs, trim, wheels…). */
  decor: Box[];
  props: PropPlacement[];
  spawns: [SpawnPoint[], SpawnPoint[]];
  ffa: SpawnPoint[];
  flags: Array<{ x: number; z: number; y: number }>;
  theme: MapTheme;
  backdrop: Backdrop;
  size: 'small' | 'medium' | 'large';
}

/** Opening in a wall: [from, to, bottom, top] (along the wall, heights from the wall's base). */
export type Op = [number, number, number, number];
/** A door centred at `c`. */
export const D = (c: number, w = 1.4, h = 2.3): Op => [c - w / 2, c + w / 2, 0, h];
/** A window centred at `c`. */
export const W = (c: number, w = 1.6, sill = 1, top = 2.2): Op => [c - w / 2, c + w / 2, sill, top];

// Map yaws are written as "facing +x = π/2" (facing −z = 0, +z = π); the sim looks down −z at yaw 0 and turns left with +yaw.
export const sp = (x: number, z: number, yaw: number, y = 0): SpawnPoint => ({ x, y, z, yaw: -yaw });
export const FACE = { px: Math.PI / 2, nx: -Math.PI / 2, pz: Math.PI, nz: 0 };
/** Spawns within 6 m of the boundary look at the middle of the map (never at the edge); the rest keep their written yaw. */
export const faceCentre = (pts: SpawnPoint[], hx: number, hz: number): SpawnPoint[] =>
  pts.map((p) => (Math.min(hx - Math.abs(p.x), hz - Math.abs(p.z)) > 6 || Math.hypot(p.x, p.z) < 8 ? p : { ...p, yaw: Math.atan2(p.x, p.z) }));

export const CONTAINER_L: [number, number, number] = [2.8, 1.22, 1.15];
export const CONTAINER_S: [number, number, number] = [2.7, 1.22, 1.15];
export const CONTAINER_H = 2.64;
export const CONTAINER_COLORS = ['#8a2a22', '#2a4f7a', '#3d6b35', '#a8742a', '#5c5f63', '#6b3a72'];

type Style = { tint?: string; roof?: boolean; thin?: boolean };
type Side = 'n' | 's' | 'w' | 'e';

export class Builder {
  boxes: Box[] = [];
  decor: Box[] = [];
  props: PropPlacement[] = [];
  private style: Style = {};

  /** Boxes made inside `fn` get this tint / flags. */
  with(style: Style, fn: () => void): this {
    const prev = this.style;
    this.style = { ...prev, ...style };
    fn();
    this.style = prev;
    return this;
  }

  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: Material, thin = false, hidden = false): this {
    this.boxes.push({ x0: Math.min(x0, x1), y0: Math.min(y0, y1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), y1: Math.max(y0, y1), z1: Math.max(z0, z1), mat, thin: thin || this.style.thin, hidden, tint: this.style.tint, roof: this.style.roof });
    return this;
  }

  /** Visual-only block. */
  deco(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: Material, tint?: string): this {
    this.decor.push({ x0: Math.min(x0, x1), y0: Math.min(y0, y1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), y1: Math.max(y0, y1), z1: Math.max(z0, z1), mat, tint: tint ?? this.style.tint });
    return this;
  }

  /** Wall along x (from x0 to x1) centred on z, with openings [a0, a1, y0, y1] in x. */
  wallX(x0: number, x1: number, z: number, h: number, t: number, mat: Material, openings: Op[] = [], y = 0): this {
    const ops = [...openings].sort((a, b) => a[0] - b[0]);
    let cur = x0;
    for (const [a0, a1, oy0, oy1] of ops) {
      if (a0 > cur) this.box(cur, y, z - t / 2, a0, y + h, z + t / 2, mat);
      if (oy0 > 0) this.box(a0, y, z - t / 2, a1, y + oy0, z + t / 2, mat);
      if (oy1 < h) this.box(a0, y + oy1, z - t / 2, a1, y + h, z + t / 2, mat);
      cur = a1;
    }
    if (cur < x1) this.box(cur, y, z - t / 2, x1, y + h, z + t / 2, mat);
    return this;
  }

  /** Wall along z (from z0 to z1) centred on x, with openings in z. */
  wallZ(z0: number, z1: number, x: number, h: number, t: number, mat: Material, openings: Op[] = [], y = 0): this {
    const ops = [...openings].sort((a, b) => a[0] - b[0]);
    let cur = z0;
    for (const [a0, a1, oy0, oy1] of ops) {
      if (a0 > cur) this.box(x - t / 2, y, cur, x + t / 2, y + h, a0, mat);
      if (oy0 > 0) this.box(x - t / 2, y, a0, x + t / 2, y + oy0, a1, mat);
      if (oy1 < h) this.box(x - t / 2, y + oy1, a0, x + t / 2, y + h, a1, mat);
      cur = a1;
    }
    if (cur < z1) this.box(x - t / 2, y, cur, x + t / 2, y + h, z1, mat);
    return this;
  }

  /** Four walls: n = the wall at z0, s = at z1, w = at x0, e = at x1. */
  room(x0: number, z0: number, x1: number, z1: number, h: number, mat: Material, t: number, o: Partial<Record<Side, Op[]>> = {}, y = 0): this {
    this.wallX(x0, x1, z0, h, t, mat, o.n, y);
    this.wallX(x0, x1, z1, h, t, mat, o.s, y);
    this.wallZ(z0, z1, x0, h, t, mat, o.w, y);
    this.wallZ(z0, z1, x1, h, t, mat, o.e, y);
    return this;
  }

  /** A floor slab (top at y + th) with rectangular holes [x0, z0, x1, z1]. */
  slab(x0: number, z0: number, x1: number, z1: number, y: number, th: number, mat: Material, holes: Array<[number, number, number, number]> = []): this {
    const xs = [...new Set([x0, x1, ...holes.flatMap((h) => [h[0], h[2]])])].filter((v) => v >= x0 && v <= x1).sort((a, b) => a - b);
    const zs = [...new Set([z0, z1, ...holes.flatMap((h) => [h[1], h[3]])])].filter((v) => v >= z0 && v <= z1).sort((a, b) => a - b);
    const inHole = (x: number, z: number) => holes.some((h) => x > h[0] && x < h[2] && z > h[1] && z < h[3]);
    for (let j = 0; j + 1 < zs.length; j++) {
      const za = zs[j]!;
      const zb = zs[j + 1]!;
      let start: number | null = null;
      for (let i = 0; i + 1 < xs.length; i++) {
        const xa = xs[i]!;
        const xb = xs[i + 1]!;
        const solid = !inHole((xa + xb) / 2, (za + zb) / 2);
        if (solid && start === null) start = xa;
        if (!solid && start !== null) {
          this.box(start, y, za, xa, y + th, zb, mat);
          start = null;
        }
      }
      if (start !== null) this.box(start, y, za, xs[xs.length - 1]!, y + th, zb, mat);
    }
    return this;
  }

  /** Solid stairs rising along +x/−x/+z/−z over the given footprint. */
  stairs(x0: number, z0: number, x1: number, z1: number, dir: 'x+' | 'x-' | 'z+' | 'z-', height: number, mat: Material, y = 0): this {
    const n = Math.ceil(height / 0.3);
    for (let i = 0; i < n; i++) {
      const top = y + ((i + 1) * height) / n;
      const f = i / n;
      if (dir === 'x+') this.box(x0 + (x1 - x0) * f, y, z0, x1, top, z1, mat);
      if (dir === 'x-') this.box(x0, y, z0, x1 - (x1 - x0) * f, top, z1, mat);
      if (dir === 'z+') this.box(x0, y, z0 + (z1 - z0) * f, x1, top, z1, mat);
      if (dir === 'z-') this.box(x0, y, z0, x1, top, z1 - (z1 - z0) * f, mat);
    }
    return this;
  }

  /** Place a model; its collision box comes from the model bounds. */
  prop(model: string, x: number, z: number, rot = 0, s: number | [number, number, number] = 1, opts: { collide?: boolean; y?: number; tint?: string; explosive?: boolean; shrink?: number; trunk?: [number, number]; edge?: boolean } = {}): this {
    const [sx, sy, sz] = typeof s === 'number' ? [s, s, s] : s;
    const p: PropPlacement = { model, x, y: opts.y ?? 0, z, rot: ((rot % 4) + 4) % 4, sx, sy, sz, collide: opts.collide ?? true, tint: opts.tint, explosive: opts.explosive, edge: opts.edge };
    this.props.push(p);
    // Trees / towers: only the trunk or legs block.
    const trunk = opts.trunk ?? (/tree/.test(model) ? [0.5, 4] : /watertank-platform/.test(model) ? [1.6, 6] : null);
    if (trunk && p.collide) {
      const [w, h] = trunk;
      this.box(x - w / 2, p.y, z - w / 2, x + w / 2, p.y + h, z + w / 2, 'wood', false, true);
      return this;
    }
    if (p.collide) {
      const b = PROP_BOUNDS[model];
      if (b) {
        let [ax0, ay0, az0, ax1, ay1, az1] = [b[0] * sx, b[1] * sy, b[2] * sz, b[3] * sx, b[4] * sy, b[5] * sz];
        // Quarter-turn rotation about y.
        for (let r = 0; r < p.rot; r++) [ax0, az0, ax1, az1] = [az0, -ax1, az1, -ax0];
        const k = opts.shrink ?? 0.92;
        const cx = (ax0 + ax1) / 2;
        const cz = (az0 + az1) / 2;
        const hx = ((ax1 - ax0) / 2) * k;
        const hz = ((az1 - az0) / 2) * k;
        const prev = this.style;
        this.style = {};
        this.box(x + cx - hx, p.y + Math.max(0, ay0), z + cz - hz, x + cx + hx, p.y + ay1, z + cz + hz, /container|tank|barrier|gastank|trash/.test(model) ? 'metal' : /crate|pallet|wood/.test(model) ? 'wood' : 'concrete', /crate|pallet|wood|fence/.test(model), true);
        this.style = prev;
      }
    }
    return this;
  }

  /** Map boundary: an invisible wall, with a low visible kerb along it so the edge reads. */
  bounds(hx: number, hz: number, h = 14, kerb: Material = 'concrete'): this {
    const t = 1;
    this.box(-hx - t, 0, -hz - t, hx + t, h, -hz, 'invisible', false, true);
    this.box(-hx - t, 0, hz, hx + t, h, hz + t, 'invisible', false, true);
    this.box(-hx - t, 0, -hz, -hx, h, hz, 'invisible', false, true);
    this.box(hx, 0, -hz, hx + t, h, hz, 'invisible', false, true);
    const k = 0.45;
    const y = 0.7;
    this.box(-hx - k, 0, -hz - k, hx + k, y, -hz, kerb);
    this.box(-hx - k, 0, hz, hx + k, y, hz + k, kerb);
    this.box(-hx - k, 0, -hz, -hx, y, hz, kerb);
    this.box(hx, 0, -hz, hx + k, y, hz, kerb);
    return this;
  }

  /** Decorative barrier props (no collision) just outside the boundary, every `step` metres along all four sides. */
  edge(hx: number, hz: number, model: string, step: number, s: number | [number, number, number], opts: { out?: number; tint?: string; skip?: (x: number, z: number) => boolean } = {}): this {
    const o = opts.out ?? 1.2;
    for (let x = -hx + step / 2; x < hx; x += step)
      for (const side of [-1, 1]) if (!opts.skip?.(x, side * (hz + o))) this.prop(model, x, side * (hz + o), 0, s, { collide: false, tint: opts.tint, edge: true });
    for (let z = -hz + step / 2; z < hz; z += step)
      for (const side of [-1, 1]) if (!opts.skip?.(side * (hx + o), z)) this.prop(model, side * (hx + o), z, 1, s, { collide: false, tint: opts.tint, edge: true });
    return this;
  }

  // ---------------------------------------------------------------- furniture & dressing

  /** Flat decor floor (rug, marble, parquet). */
  floor(x0: number, z0: number, x1: number, z1: number, mat: Material, tint?: string, y = 0): this {
    return this.deco(x0, y, z0, x1, y + 0.03, z1, mat, tint);
  }

  table(x: number, z: number, w: number, d: number, h = 0.76, mat: Material = 'darkwood', tint?: string): this {
    this.with({ tint }, () => {
      this.box(x - w / 2, h - 0.06, z - d / 2, x + w / 2, h, z + d / 2, mat, true);
      for (const [lx, lz] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ])
        this.box(x + lx * (w / 2 - 0.08) - 0.04, 0, z + lz * (d / 2 - 0.08) - 0.04, x + lx * (w / 2 - 0.08) + 0.04, h - 0.06, z + lz * (d / 2 - 0.08) + 0.04, mat, true);
    });
    return this;
  }

  /** Sofa / armchair: `back` is the side the backrest is on. */
  sofa(x: number, z: number, w: number, d: number, back: Side, tint = '#6a4a3a'): this {
    return this.with({ tint, thin: true }, () => {
      this.box(x - w / 2, 0, z - d / 2, x + w / 2, 0.45, z + d / 2, 'fabric');
      const t = 0.25;
      if (back === 'n') this.box(x - w / 2, 0.45, z - d / 2, x + w / 2, 0.95, z - d / 2 + t, 'fabric');
      if (back === 's') this.box(x - w / 2, 0.45, z + d / 2 - t, x + w / 2, 0.95, z + d / 2, 'fabric');
      if (back === 'w') this.box(x - w / 2, 0.45, z - d / 2, x - w / 2 + t, 0.95, z + d / 2, 'fabric');
      if (back === 'e') this.box(x + w / 2 - t, 0.45, z - d / 2, x + w / 2, 0.95, z + d / 2, 'fabric');
    });
  }

  shelf(x0: number, z0: number, x1: number, z1: number, h = 2.3, mat: Material = 'darkwood', tint?: string): this {
    return this.with({ tint }, () => this.box(x0, 0, z0, x1, h, z1, mat));
  }

  /** Bed with the headboard on side `head`. */
  bed(x: number, z: number, w: number, l: number, head: Side, tint = '#8a9ab0', y = 0): this {
    const alongZ = head === 'n' || head === 's';
    const hx = alongZ ? w / 2 : l / 2;
    const hz = alongZ ? l / 2 : w / 2;
    this.with({ tint }, () => this.box(x - hx, y, z - hz, x + hx, y + 0.6, z + hz, 'fabric', true));
    if (head === 'n') this.box(x - hx, y, z - hz - 0.12, x + hx, y + 1.2, z - hz, 'darkwood');
    if (head === 's') this.box(x - hx, y, z + hz, x + hx, y + 1.2, z + hz + 0.12, 'darkwood');
    if (head === 'w') this.box(x - hx - 0.12, y, z - hz, x - hx, y + 1.2, z + hz, 'darkwood');
    if (head === 'e') this.box(x + hx, y, z - hz, x + hx + 0.12, y + 1.2, z + hz, 'darkwood');
    return this;
  }

  /** Counter / desk / bar: a body with a top. */
  counter(x0: number, z0: number, x1: number, z1: number, h = 0.95, body: Material = 'darkwood', top: Material = 'marble', y = 0): this {
    this.box(x0, y, z0, x1, y + h - 0.05, z1, body);
    return this.box(x0 - 0.03, y + h - 0.05, z0 - 0.03, x1 + 0.03, y + h, z1 + 0.03, top);
  }

  pillar(x: number, z: number, r: number, h: number, mat: Material = 'marble', y = 0): this {
    return this.box(x - r, y, z - r, x + r, y + h, z + r, mat);
  }

  /** Railing (blocks movement, bullets pass through). */
  rail(x0: number, z0: number, x1: number, z1: number, y: number, h = 1, mat: Material = 'darkwood'): this {
    return this.box(x0, y, z0, x1, y + h, z1, mat, true);
  }

  /** Privacy fence / hedge / low wall along a line. */
  fence(x0: number, z0: number, x1: number, z1: number, h = 1.9, mat: Material = 'wood', tint?: string, t = 0.12): this {
    return this.with({ tint }, () => {
      if (Math.abs(x1 - x0) > Math.abs(z1 - z0)) this.box(x0, 0, z0 - t / 2, x1, h, z0 + t / 2, mat, mat === 'wood' || mat === 'hedge');
      else this.box(x0 - t / 2, 0, z0, x0 + t / 2, h, z1, mat, mat === 'wood' || mat === 'hedge');
    });
  }

  /** A stepped (low-poly) pitched roof, ridge along x or z. Decor. */
  roofTop(x0: number, z0: number, x1: number, z1: number, y: number, ridgeX: boolean, tint = '#5a4038', layers = 5, rise = 0.42): this {
    for (let i = 0; i < layers; i++) {
      const f = i / layers;
      if (ridgeX) {
        const inset = ((z1 - z0) / 2) * f;
        this.deco(x0, y + i * rise, z0 + inset, x1, y + (i + 1) * rise, z1 - inset, 'shingle', tint);
      } else {
        const inset = ((x1 - x0) / 2) * f;
        this.deco(x0 + inset, y + i * rise, z0, x1 - inset, y + (i + 1) * rise, z1, 'shingle', tint);
      }
    }
    return this;
  }

  /** A (wrecked) car model. */
  car(x: number, z: number, rot: number, tint: string): this {
    return this.prop('prop-debris-brokencar', x, z, rot, 1, { tint });
  }

  container(x: number, z: number, rot: number, long: boolean, tint: string, y = 0): this {
    return this.prop(long ? 'prop-container-long' : 'prop-container-small', x, z, rot, long ? CONTAINER_L : CONTAINER_S, { tint, y });
  }

  crates(x: number, z: number, n = 3, s = 1.4): this {
    this.prop('prop-crate', x - 0.6, z, 0, s);
    if (n > 1) this.prop('prop-crate', x + 0.6, z, 1, s);
    if (n > 2) this.prop('prop-crate', x, z, 0, s, { y: 1.1 });
    return this;
  }

  /** Map local (a = along, c = across) coordinates to world for vehicles. */
  private vbox(x: number, z: number, alongZ: boolean, dir: 1 | -1, a0: number, y0: number, c0: number, a1: number, y1: number, c1: number, mat: Material, decor = false, tint?: string): void {
    const [p0, p1] = [a0 * dir, a1 * dir];
    const b = alongZ ? [x + c0, y0, z + p0, x + c1, y1, z + p1] : [x + p0, y0, z + c0, x + p1, y1, z + c1];
    if (decor) this.deco(b[0]!, b[1]!, b[2]!, b[3]!, b[4]!, b[5]!, mat, tint);
    else this.with({ tint }, () => this.box(b[0]!, b[1]!, b[2]!, b[3]!, b[4]!, b[5]!, mat, mat === 'metal' || mat === 'paint'));
  }

  /** A school / city bus you can climb into through the back door. `dir` = which way the front points. */
  bus(x: number, z: number, alongZ: boolean, dir: 1 | -1 = 1, tint = '#e8b020'): this {
    const v = (a0: number, y0: number, c0: number, a1: number, y1: number, c1: number, mat: Material, decor = false, t = tint) => this.vbox(x, z, alongZ, dir, a0, y0, c0, a1, y1, c1, mat, decor, t);
    const dark = '#2a2a2e';
    v(-5, 0.3, -1.25, 5, 0.6, 1.25, 'metal', false, dark); // floor
    for (const s of [-1, 1]) {
      const c0 = s < 0 ? -1.25 : 1.15;
      const c1 = s < 0 ? -1.15 : 1.25;
      v(-5, 0.6, c0, 5, 1.5, c1, 'paint'); // below the windows
      v(-5, 2.4, c0, 5, 3.0, c1, 'paint'); // above
      for (let a = -4.9; a <= 4.9; a += 1.95) v(a, 1.5, c0, a + 0.12, 2.4, c1, 'paint');
      v(-3.5 - 0.5, 0, s * 1.05 - 0.15, -3.5 + 0.5, 0.65, s * 1.05 + 0.15, 'metal', true, '#151515');
      v(3.5 - 0.5, 0, s * 1.05 - 0.15, 3.5 + 0.5, 0.65, s * 1.05 + 0.15, 'metal', true, '#151515');
    }
    v(4.9, 0.6, -1.25, 5, 1.5, 1.25, 'paint'); // front
    v(4.9, 2.4, -1.25, 5, 3.0, 1.25, 'paint');
    v(-5, 0.6, -1.25, -4.9, 3.0, -0.55, 'paint'); // back, around the door
    v(-5, 0.6, 0.55, -4.9, 3.0, 1.25, 'paint');
    v(-5, 2.4, -0.55, -4.9, 3.0, 0.55, 'paint');
    this.with({ roof: true }, () => v(-5.05, 3.0, -1.3, 5.05, 3.15, 1.3, 'paint'));
    v(5, 0.3, -1.25, 6.3, 1.6, 1.25, 'paint'); // hood
    v(-5.6, 0, -0.6, -5, 0.3, 0.6, 'metal', false, dark); // back step
    // Seats (an aisle down the middle).
    for (const a of [-3.2, -1.2, 0.8, 2.8]) {
      v(a, 0.6, -1.15, a + 0.7, 1.1, -0.48, 'fabric', false, '#4a5a7a');
      v(a, 0.6, 0.48, a + 0.7, 1.1, 1.15, 'fabric', false, '#4a5a7a');
    }
    return this;
  }

  /** Box truck. */
  truck(x: number, z: number, alongZ: boolean, dir: 1 | -1 = 1, tint = '#e6e2da', cab = '#2a5a9a'): this {
    const v = (a0: number, y0: number, c0: number, a1: number, y1: number, c1: number, mat: Material, decor = false, t = tint) => this.vbox(x, z, alongZ, dir, a0, y0, c0, a1, y1, c1, mat, decor, t);
    v(-3.2, 0.5, -1.2, 1.6, 3.2, 1.2, 'paint');
    v(1.7, 0.5, -1.15, 3.6, 2.4, 1.15, 'paint', false, cab);
    v(2.3, 1.5, -1.17, 3.62, 2.2, 1.17, 'glass', true, '#2a3a48');
    for (const a of [-2.2, 2.6])
      for (const s of [-1, 1]) v(a - 0.45, 0, s * 1.0 - 0.15, a + 0.45, 0.9, s * 1.0 + 0.15, 'metal', true, '#151515');
    return this;
  }
}

// ---------------------------------------------------------------- shared buildings

/**
 * Two-storey family house (12 deep × 14 wide). `xf` = front wall x, `dir` = which way the house
 * extends from the front (+1 / −1), `zc` = centre-ish z (the house spans zc−8 … zc+6).
 */
export function house(b: Builder, xf: number, dir: 1 | -1, zc: number, mat: Material, tint?: string, roofTint = '#5a3a30'): void {
  const u = (k: number) => xf + dir * k;
  const span = (a: number, c: number): [number, number] => [Math.min(u(a), u(c)), Math.max(u(a), u(c))];
  const [lo, hi] = span(0, 12);
  const z0 = zc - 8;
  const z1 = zc + 6;
  const t = 0.3;
  const fh = 3;
  const y = fh + 0.25;
  b.with({ tint }, () => {
    // Ground floor: front door + two windows; back door; side windows.
    b.wallZ(z0, z1, u(0), fh, t, mat, [
      [zc - 2.6, zc - 1.2, 0, 2.2],
      [zc + 1.2, zc + 3.2, 1, 2.2],
      [zc - 6.5, zc - 4.5, 1, 2.2],
    ]);
    b.wallZ(z0, z1, u(12), fh, t, mat, [[zc + 2, zc + 3.4, 0, 2.2]]);
    b.wallX(lo, hi, z0, fh, t, mat, [[...span(4, 8), 1, 2.2]]);
    b.wallX(lo, hi, z1, fh, t, mat, [[...span(3, 6), 1, 2.2]]);
    // Upstairs: the big front window over the street.
    b.wallZ(z0, z1, u(0), 2.8, t, mat, [[zc - 4, zc - 0.5, 0.9, 2.2]], y);
    b.wallZ(z0, z1, u(12), 2.8, t, mat, [[zc - 2, zc, 0.9, 2.1]], y);
    b.wallX(lo, hi, z0, 2.8, t, mat, [[...span(5, 9), 0.9, 2.1]], y);
    b.wallX(lo, hi, z1, 2.8, t, mat, [], y);
  });
  // Interior divider with a doorway (thin: wallbangs).
  b.with({ thin: true, tint: '#d8ccb4' }, () => b.wallZ(z0, z1, u(6), fh, 0.2, 'wallpaper', [[zc - 1.5, zc, 0, 2.2]]));
  // Upstairs slab with the stairwell along the side wall, stairs rising towards the back.
  const [sx0, sx1] = span(7.5, 11.7);
  b.slab(lo, z0, hi, z1, fh, 0.25, 'wood', [[sx0, zc + 3.6, sx1, z1]]);
  b.stairs(sx0, zc + 3.7, sx1, zc + 5.8, dir > 0 ? 'x+' : 'x-', y, 'wood');
  b.rail(sx0, zc + 3.45, sx1, zc + 3.6, y);
  // Roof + porch.
  b.with({ roof: true, tint: roofTint }, () => b.box(lo - 0.4, y + 2.8, z0 - 0.4, hi + 0.4, y + 3.0, z1 + 0.4, 'shingle'));
  b.roofTop(lo - 0.5, z0 - 0.5, hi + 0.5, z1 + 0.5, y + 3.0, false, roofTint, 5, 0.5);
  const [p0, p1] = span(-1.2, 0);
  b.box(p0, 0, zc - 3, p1, 0.25, zc + 0.4, 'concrete');
  // Dressing: floors, living room, kitchen, bedroom.
  b.floor(lo + 0.15, z0 + 0.15, hi - 0.15, z1 - 0.15, 'darkwood', '#c8a888');
  b.floor(lo + 0.15, z0 + 0.15, hi - 0.15, z1 - 0.15, 'carpet', '#8aa0b8', y);
  const mid = (a: number, c: number) => (u(a) + u(c)) / 2;
  b.sofa(mid(1.5, 2.5), zc - 4.5, 1, 2.4, dir > 0 ? 'w' : 'e', '#7a5a4a');
  b.table(mid(3.5, 4.5), zc - 4.5, 0.8, 1.2, 0.45);
  const [k0, k1] = span(10.8, 11.6);
  b.counter(k0, z0 + 0.3, k1, z0 + 4.2);
  b.table(mid(8, 9.5), zc - 1.5, 1.6, 1.0);
  b.bed(mid(9, 11), zc - 5, 1.6, 2.1, dir > 0 ? 'e' : 'w', '#9a7aa8', y);
  const [s0, s1] = span(1, 2.6);
  b.shelf(s0, z1 - 0.75, s1, z1 - 0.2, 1.9);
}

/** Single-storey garage with a big door at `xd` (opening the other way from `dir`), z0..z1. */
export function garage(b: Builder, xd: number, dir: 1 | -1, z0: number, z1: number, tint: string, car?: string): void {
  const x2 = xd + dir * 7;
  const lo = Math.min(xd, x2);
  const hi = Math.max(xd, x2);
  b.with({ tint }, () => {
    b.wallZ(z0, z1, xd, 3, 0.25, 'paint', [[z0 + 0.6, z1 - 0.6, 0, 2.5]]);
    b.wallZ(z0, z1, x2, 3, 0.25, 'paint', [D((z0 + z1) / 2 + 1)]);
    b.wallX(lo, hi, z0, 3, 0.25, 'paint', [W((lo + hi) / 2, 1.4, 1.2, 2.1)]);
    b.wallX(lo, hi, z1, 3, 0.25, 'paint');
  });
  b.with({ roof: true }, () => b.box(lo - 0.3, 3, z0 - 0.3, hi + 0.3, 3.2, z1 + 0.3, 'paint'));
  b.roofTop(lo - 0.3, z0 - 0.3, hi + 0.3, z1 + 0.3, 3.2, true, '#7a6e6a', 3, 0.4);
  b.floor(lo, z0, hi, z1, 'concrete');
  if (car) b.car((lo + hi) / 2 - dir * 0.6, (z0 + z1) / 2, 1, car);
  b.shelf(dir > 0 ? hi - 0.8 : lo + 0.2, z0 + 0.4, dir > 0 ? hi - 0.2 : lo + 0.8, z0 + 2.4, 1.8, 'metal', '#5a6a7a');
}
