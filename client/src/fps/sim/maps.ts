import type { Box, Material } from './level';
import { PROP_BOUNDS } from './propBounds';

/**
 * Multiplayer maps, laid out like classic CoD 3-lane maps. Everything solid is a
 * box (see level.ts); props are decorative models whose collision is a box too.
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

export interface MapDef {
  id: string;
  name: string;
  desc: string;
  half: [number, number];
  boxes: Box[];
  props: PropPlacement[];
  spawns: [SpawnPoint[], SpawnPoint[]];
  ffa: SpawnPoint[];
  flags: Array<{ x: number; z: number; y: number }>;
  theme: MapTheme;
  /** Max bots that feel right on this map (per team). */
  size: 'small' | 'medium' | 'large';
}

class Builder {
  boxes: Box[] = [];
  props: PropPlacement[] = [];

  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: Material, thin = false, hidden = false): this {
    this.boxes.push({ x0: Math.min(x0, x1), y0: Math.min(y0, y1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), y1: Math.max(y0, y1), z1: Math.max(z0, z1), mat, thin, hidden });
    return this;
  }

  /** Wall along x (from x0 to x1) centred on z, with openings [a0, a1, y0, y1] in x. */
  wallX(x0: number, x1: number, z: number, h: number, t: number, mat: Material, openings: Array<[number, number, number, number]> = [], y = 0): this {
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
  wallZ(z0: number, z1: number, x: number, h: number, t: number, mat: Material, openings: Array<[number, number, number, number]> = [], y = 0): this {
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
        this.box(x + cx - hx, p.y + Math.max(0, ay0), z + cz - hz, x + cx + hx, p.y + ay1, z + cz + hz, /container|tank|barrier|gastank|trash/.test(model) ? 'metal' : /crate|pallet|wood/.test(model) ? 'wood' : 'concrete', /crate|pallet|wood|fence/.test(model), true);
      }
    }
    return this;
  }

  /** Map boundary: an invisible wall, with a low visible kerb along it so the edge reads. */
  bounds(hx: number, hz: number, h = 12, kerb: Material = 'concrete'): this {
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
}

// Map yaws are written as "facing +x = π/2"; the sim looks down −z at yaw 0 and turns left with +yaw.
const sp = (x: number, z: number, yaw: number, y = 0): SpawnPoint => ({ x, y, z, yaw: -yaw });
/** Spawns look at the middle of the map (never at the boundary); ones near the middle keep their written yaw. */
const faceCentre = (pts: SpawnPoint[]): SpawnPoint[] => pts.map((p) => (Math.hypot(p.x, p.z) < 8 ? p : { ...p, yaw: Math.atan2(p.x, p.z) }));
const CONTAINER_L: [number, number, number] = [2.8, 1.22, 1.15];
const CONTAINER_S: [number, number, number] = [2.7, 1.22, 1.15];
const CONTAINER_COLORS = ['#8a2a22', '#2a4f7a', '#3d6b35', '#a8742a', '#5c5f63', '#6b3a72'];

// ============================================================================ FREIGHT (small, chaos)

function freight(): MapDef {
  const b = new Builder();
  const H = 22;
  b.bounds(H, H, 12, 'metal');
  // Perimeter: stacked containers (visual) + the boundary.
  let ci = 0;
  for (const side of [-1, 1]) {
    for (let k = -1.5; k <= 1.5; k++) {
      for (const lvl of [0, 2.6]) {
        b.prop('prop-container-long', k * 11, side * (H + 1.3), 0, CONTAINER_L, { collide: false, y: lvl, tint: CONTAINER_COLORS[ci++ % 6] });
        b.prop('prop-container-long', side * (H + 1.3), k * 11, 1, CONTAINER_L, { collide: false, y: lvl, tint: CONTAINER_COLORS[ci++ % 6] });
      }
    }
  }
  // Interior 3×3 grid of cover.
  b.prop('prop-container-long', -11, -11, 0, CONTAINER_L, { tint: '#8a2a22' });
  b.prop('prop-container-small', 11, -11, 1, CONTAINER_S, { tint: '#2a4f7a' });
  b.prop('prop-container-small', -11, 0.5, 1, CONTAINER_S, { tint: '#a8742a' });
  b.prop('prop-container-long', 0, 0, 1, CONTAINER_L, { tint: '#3d6b35' });
  b.prop('prop-container-small', 11, -0.5, 1, CONTAINER_S, { tint: '#5c5f63' });
  b.prop('prop-container-small', -11, 11, 0, CONTAINER_S, { tint: '#6b3a72' });
  b.prop('prop-container-long', 11, 11, 0, CONTAINER_L, { tint: '#2a4f7a' });
  // Crate stacks.
  for (const [x, z] of [
    [0, -11],
    [0, 11],
  ] as Array<[number, number]>) {
    b.prop('prop-crate', x - 0.6, z, 0, 1.4);
    b.prop('prop-crate', x + 0.6, z, 1, 1.4);
    b.prop('prop-crate', x, z, 0, 1.4, { y: 1.1 });
  }
  for (const [x, z, r] of [
    [-5.5, -16, 0],
    [5.5, 16, 0],
    [-16, -5.5, 1],
    [16, 5.5, 1],
  ] as Array<[number, number, number]>)
    b.prop('prop-sacktrench', x, z, r, 0.85);
  b.prop('prop-explodingbarrel', -6, 6, 0, 1.2, { explosive: true, shrink: 0.8 });
  b.prop('prop-explodingbarrel', 6, -6, 0, 1.2, { explosive: true, shrink: 0.8 });
  b.prop('prop-pallet', -17, 16, 0, 1.3, { collide: false });
  b.prop('prop-pallet', 17, -16, 1, 1.3, { collide: false });
  b.prop('prop-crate', -17, 18, 0, 1.4);
  b.prop('prop-crate', 17, -18, 0, 1.4);
  b.prop('prop-streetlight', -20.5, 0, 1, 1.4, { collide: false });
  b.prop('prop-streetlight', 20.5, 0, 3, 1.4, { collide: false });
  // Container corners close the stacked walls off.
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as Array<[number, number]>) b.prop('prop-container-small', x * (H + 1.3), z * (H + 1.3), 0, CONTAINER_S, { collide: false, tint: '#5c5f63' });
  return {
    id: 'freight',
    name: 'Freight',
    desc: 'A tiny container yard. Non-stop close-quarters chaos.',
    half: [H, H],
    boxes: b.boxes,
    props: b.props,
    spawns: [
      faceCentre([sp(-19, -14, Math.PI / 2), sp(-19, -6, Math.PI / 2), sp(-19, 6, Math.PI / 2), sp(-19, 14, Math.PI / 2), sp(-15, -19, Math.PI / 2), sp(-15, 19, Math.PI / 2)]),
      faceCentre([sp(19, -14, -Math.PI / 2), sp(19, -6, -Math.PI / 2), sp(19, 6, -Math.PI / 2), sp(19, 14, -Math.PI / 2), sp(15, -19, -Math.PI / 2), sp(15, 19, -Math.PI / 2)]),
    ],
    ffa: faceCentre([sp(-19, -19, 0.8), sp(19, 19, -2.4), sp(-19, 19, 2.4), sp(19, -19, -0.8), sp(0, -19, 0), sp(0, 19, Math.PI), sp(-19, 0, Math.PI / 2), sp(19, 0, -Math.PI / 2), sp(-6, -6, 0), sp(6, 6, Math.PI)]),
    flags: [
      { x: -17, z: 0, y: 0 },
      { x: 4.5, z: 0, y: 0 },
      { x: 17, z: 0, y: 0 },
    ],
    theme: { sky: 'overcast', ground: 'concrete', patches: [[-22, -22, 22, 22, 'asphalt']], sun: [0.4, 0.8, 0.3], fog: ['#9aa3ad', 30, 110] },
    size: 'small',
  };
}

// ============================================================================ CUL-DE-SAC (medium, Nuketown-like)

function house(b: Builder, side: -1 | 1, mat: Material): void {
  // Footprint: x from 18 to 30 (mirrored), z from −8 to 6. Front faces the street (towards x = 0).
  const xf = side * 18; // front wall
  const xb = side * 30; // back wall
  const z0 = -8;
  const z1 = 6;
  const t = 0.3;
  const fh = 3; // floor height
  const lo = Math.min(xf, xb);
  const hi = Math.max(xf, xb);
  // Ground floor walls: front door + two windows; back door; side windows.
  b.wallZ(z0, z1, xf, fh, t, mat, [
    [-2.6, -1.2, 0, 2.2],
    [1.2, 3.2, 1, 2.2],
    [-6.5, -4.5, 1, 2.2],
  ]);
  b.wallZ(z0, z1, xb, fh, t, mat, [[2, 3.4, 0, 2.2]]);
  b.wallX(lo, hi, z0, fh, t, mat, [[side > 0 ? 22 : -26, side > 0 ? 26 : -22, 1, 2.2]]);
  b.wallX(lo, hi, z1, fh, t, mat, [[side > 0 ? 21 : -24, side > 0 ? 24 : -21, 1, 2.2]]);
  // Interior divider with a doorway.
  b.wallZ(z0, z1, side * 24, fh, 0.2, 'plaster', [[-1.5, 0, 0, 2.2]]);
  // Second floor slab (with a stairwell hole along the north wall).
  const sx0 = side > 0 ? 25.5 : -29.7;
  const sx1 = side > 0 ? 29.7 : -25.5;
  b.box(lo, fh, z0, hi, fh + 0.25, 3.6, 'wood');
  b.box(lo, fh, 3.6, Math.min(sx0, sx1), fh + 0.25, z1, 'wood');
  b.box(Math.max(sx0, sx1), fh, 3.6, hi, fh + 0.25, z1, 'wood');
  // Stairs up along the north wall, rising towards the back; you step off sideways onto the landing.
  b.stairs(Math.min(sx0, sx1), 3.7, Math.max(sx0, sx1), 5.8, side > 0 ? 'x+' : 'x-', fh + 0.25, 'wood');
  // Upstairs walls: the famous front window looking over the street.
  const y = fh + 0.25;
  b.wallZ(z0, z1, xf, 2.8, t, mat, [[-4, -0.5, 0.9, 2.2]], y);
  b.wallZ(z0, z1, xb, 2.8, t, mat, [[-2, 0, 0.9, 2.1]], y);
  b.wallX(lo, hi, z0, 2.8, t, mat, [[side > 0 ? 23 : -27, side > 0 ? 27 : -23, 0.9, 2.1]], y);
  b.wallX(lo, hi, z1, 2.8, t, mat, [], y);
  // Roof.
  b.box(lo - 0.4, y + 2.8, z0 - 0.4, hi + 0.4, y + 3.0, z1 + 0.4, 'tile');
  // Front porch step.
  b.box(side > 0 ? 17 : -18, 0, -3, side > 0 ? 18 : -17, 0.25, 0.4, 'concrete');
}

function culdesac(): MapDef {
  const b = new Builder();
  const HX = 36;
  const HZ = 26;
  b.bounds(HX, HZ);
  house(b, -1, 'plaster');
  house(b, 1, 'brick');
  // Street furniture in the middle.
  b.prop('prop-debris-brokencar', -4, -8, 0, 1, { tint: '#7a8aa0' });
  b.prop('prop-debris-brokencar', 5, 8, 2, 1, { tint: '#a05a3a' });
  b.prop('prop-container-small', 0, -18, 0, [1.9, 1.15, 1.05], { tint: '#d9d2c0' }); // box truck
  b.prop('prop-trashcontainer', 2, 15, 0, 1.15, { tint: '#3d6b35' });
  b.prop('prop-barrier-single', -9, 3, 1, 1.2);
  b.prop('prop-barrier-single', 9, -3, 1, 1.2);
  b.prop('prop-explodingbarrel', -2, 0, 0, 1.2, { explosive: true, shrink: 0.8 });
  // Backyards: fences, trees, sheds.
  for (const side of [-1, 1]) {
    for (let z = -20; z <= 20; z += 4.2) if (Math.abs(z) > 9) b.prop('prop-fence', side * 35, z, 1, [1, 1, 1], { tint: '#c9b28a' });
    b.prop('prop-fence', side * 25, -14, 0, 1, { tint: '#c9b28a' });
    b.prop('prop-fence', side * 25, 14, 0, 1, { tint: '#c9b28a' });
    b.prop('prop-tree-1', side * 31, -17, 0, 2.2);
    b.prop('prop-tree-3', side * 29, 18, 1, 2.2);
    b.prop('prop-tree-2', side * 12, -21, 0, 2);
    b.prop('prop-tree-1', side * 12, 21, 1, 2);
    b.prop('prop-crate', side * 32, 10, 0, 1.4);
    b.prop('prop-crate', side * 32, 11.2, 0, 1.4);
    b.prop('prop-gastank', side * 31.5, -10.5, 0, 1);
    b.prop('prop-sacktrench-small', side * 14, 13, 0, 0.9);
    b.prop('prop-sacktrench-small', side * 14, -13, 0, 0.9);
    // Garden walls.
    b.box(side * 16 - 0.25, 0, -22, side * 16 + 0.25, 1.1, -16, 'brick');
    b.box(side * 16 - 0.25, 0, 16, side * 16 + 0.25, 1.1, 22, 'brick');
  }
  b.prop('prop-streetlight', -12, 9, 0, 1.4, { collide: false });
  b.prop('prop-streetlight', 12, -9, 2, 1.4, { collide: false });
  b.prop('prop-trafficcone', -1, -12, 0, 1.2, { collide: false });
  b.prop('prop-trafficcone', 1.5, -12.5, 0, 1.2, { collide: false });
  // Chain-link fence round the neighbourhood; road barriers where the street leaves the map.
  b.edge(HX, HZ, 'prop-metalfence', 3.5, 1, { out: 0.9, skip: (x, z) => Math.abs(x) < 7 && Math.abs(z) > HZ });
  for (const side of [-1, 1]) for (const x of [-4.5, -1.5, 1.5, 4.5]) b.prop('prop-barrier-single', x, side * (HZ + 0.9), 0, [1.6, 1.2, 1.2], { collide: false, tint: '#c8b24a' });
  return {
    id: 'culdesac',
    name: 'Cul-de-Sac',
    desc: 'Two houses face off across a suburban street. Fast and frantic.',
    half: [HX, HZ],
    boxes: b.boxes,
    props: b.props,
    spawns: [
      faceCentre([sp(-33, -12, Math.PI / 2), sp(-33, 12, Math.PI / 2), sp(-28, -20, Math.PI / 2), sp(-28, 20, Math.PI / 2), sp(-33, 0, Math.PI / 2), sp(-22, -22, 1.2)]),
      faceCentre([sp(33, -12, -Math.PI / 2), sp(33, 12, -Math.PI / 2), sp(28, -20, -Math.PI / 2), sp(28, 20, -Math.PI / 2), sp(33, 0, -Math.PI / 2), sp(22, 22, -1.9)]),
    ],
    ffa: faceCentre([sp(-33, -20, 0.8), sp(33, 20, -2.4), sp(-33, 20, 2.4), sp(33, -20, -0.8), sp(0, -23, 0), sp(0, 23, Math.PI), sp(-24, 0, Math.PI / 2), sp(24, 0, -Math.PI / 2), sp(-12, 18, 2), sp(12, -18, -1)]),
    flags: [
      { x: -13, z: 0, y: 0 },
      { x: 0, z: 2, y: 0 },
      { x: 13, z: 0, y: 0 },
    ],
    theme: {
      sky: 'day',
      ground: 'grass',
      patches: [
        [-16, -6, 16, 6, 'asphalt'],
        [-6, -24, 6, 24, 'asphalt'],
        [-18, -3.5, -16, 0.5, 'concrete'],
        [16, -0.5, 18, 3.5, 'concrete'],
      ],
      sun: [-0.5, 0.75, 0.35],
      fog: ['#bcd3e6', 50, 160],
    },
    size: 'medium',
  };
}

// ============================================================================ OUTPOST (large, desert)

function outpost(): MapDef {
  const b = new Builder();
  const H = 46;
  b.bounds(H, H);
  // Central two-storey compound with a rooftop.
  const t = 0.4;
  const wall: Material = 'concrete';
  b.wallX(-7, 7, -5, 3.2, t, wall, [
    [-1, 1, 0, 2.3],
    [-5, -3, 1.1, 2.3],
    [3, 5, 1.1, 2.3],
  ]);
  b.wallX(-7, 7, 5, 3.2, t, wall, [
    [-1, 1, 0, 2.3],
    [-5, -3, 1.1, 2.3],
    [3, 5, 1.1, 2.3],
  ]);
  b.wallZ(-5, 5, -7, 3.2, t, wall, [[-1, 1, 0, 2.3]]);
  b.wallZ(-5, 5, 7, 3.2, t, wall, [[-1, 1, 0, 2.3]]);
  b.box(-7, 3.2, -5, 7, 3.5, 5, 'concrete'); // first floor slab
  // Upstairs: open room with windows on all sides.
  b.wallX(-7, 7, -5, 2.8, t, wall, [
    [-5, -2.5, 1, 2.2],
    [-1.2, 1.2, 0, 2.3],
    [2.5, 5, 1, 2.2],
  ], 3.5);
  b.wallX(-7, 7, 5, 2.8, t, wall, [
    [-5, -1, 1, 2.2],
    [1, 5, 1, 2.2],
  ], 3.5);
  b.wallZ(-5, 5, -7, 2.8, t, wall, [[-3, 3, 1, 2.2]], 3.5);
  b.wallZ(-5, 5, 7, 2.8, t, wall, [[-3, 3, 1, 2.2]], 3.5);
  b.box(-7.3, 6.3, -5.3, 7.3, 6.6, 5.3, 'concrete'); // roof
  // Outside stairs up the south face to the first floor door.
  b.stairs(-6.8, -8.2, -2.2, -5.4, 'x+', 3.5, 'concrete');
  b.box(-2.2, 3.2, -8.2, 1, 3.5, -5.2, 'concrete'); // landing
  // Sandbag trenches and T-walls along the lanes.
  for (const [x, z, r] of [
    [-20, -8, 1],
    [20, 8, 1],
    [-12, 14, 0],
    [12, -14, 0],
    [-30, 20, 0],
    [30, -20, 0],
    [-24, -28, 0],
    [24, 28, 0],
  ] as Array<[number, number, number]>)
    b.prop('prop-sacktrench', x, z, r, 0.9);
  for (const [x, z, r] of [
    [-16, 24, 0],
    [-12, 24, 0],
    [16, -24, 0],
    [12, -24, 0],
    [-34, -8, 1],
    [34, 8, 1],
  ] as Array<[number, number, number]>)
    b.prop('prop-barrier-large', x, z, r, 1, { tint: '#b8ad96' });
  // Wrecks and containers.
  b.prop('prop-tank', -21, 17, 1, [2.6, 1.4, 2.6], { tint: '#6b6a4a' });
  b.prop('prop-debris-brokencar', 18, -6, 1, 1, { tint: '#8a7a60' });
  b.prop('prop-debris-brokencar', -26, -16, 0, 1, { tint: '#6a5a4a' });
  b.prop('prop-container-long', 24, -30, 0, CONTAINER_L, { tint: '#8a5a2a' });
  b.prop('prop-container-small', 30, -24, 1, CONTAINER_S, { tint: '#4a5a3a' });
  b.prop('prop-container-long', -24, 30, 0, CONTAINER_L, { tint: '#5a4a3a' });
  b.prop('prop-container-small', 0, 28, 1, CONTAINER_S, { tint: '#7a2a22' });
  b.prop('prop-container-small', 0, -28, 1, CONTAINER_S, { tint: '#2a4a6a' });
  // Huts in the corners.
  for (const [cx, cz] of [
    [-34, -32],
    [34, 32],
  ] as Array<[number, number]>) {
    b.wallX(cx - 4, cx + 4, cz - 3, 3, 0.3, 'brick', [[cx - 1, cx + 1, 0, 2.2]]);
    b.wallX(cx - 4, cx + 4, cz + 3, 3, 0.3, 'brick', [[cx - 2.5, cx - 1, 1, 2]]);
    b.wallZ(cz - 3, cz + 3, cx - 4, 3, 0.3, 'brick', [[cz - 1, cz + 1, 0, 2.2]]);
    b.wallZ(cz - 3, cz + 3, cx + 4, 3, 0.3, 'brick', [[cz - 0.5, cz + 1, 1, 2]]);
    b.box(cx - 4.3, 3, cz - 3.3, cx + 4.3, 3.25, cz + 3.3, 'metal');
  }
  // Water towers and scatter.
  b.prop('prop-watertank-platform', 36, -36, 0, 1.8);
  b.prop('prop-watertank-platform', -36, 36, 2, 1.8);
  for (const [x, z] of [
    [8, 18],
    [-8, -18],
    [38, -4],
    [-38, 4],
    [-14, -36],
    [14, 36],
  ] as Array<[number, number]>) {
    b.prop('prop-crate', x, z, 0, 1.4);
    b.prop('prop-crate', x + 1.1, z + 0.2, 1, 1.4);
  }
  b.prop('prop-explodingbarrel', 9, 7, 0, 1.2, { explosive: true, shrink: 0.8 });
  b.prop('prop-explodingbarrel', -9, -7, 0, 1.2, { explosive: true, shrink: 0.8 });
  b.prop('prop-explodingbarrel', 27, 0, 0, 1.2, { explosive: true, shrink: 0.8 });
  b.prop('prop-debris-tires', -5, 12, 0, 1.2);
  b.prop('prop-debris-tires', 5, -12, 0, 1.2);
  b.prop('prop-pipes', -28, -2, 0, 1.3);
  b.prop('prop-pipes', 28, 2, 0, 1.3);
  b.prop('prop-tree-2', -40, -40, 0, 2.4, { tint: '#b8a060' });
  b.prop('prop-tree-2', 40, 40, 0, 2.4, { tint: '#b8a060' });
  // Concrete T-walls ring the outpost.
  b.edge(H, H, 'prop-barrier-large', 4, 1, { out: 0.8, tint: '#b8ad96' });
  return {
    id: 'outpost',
    name: 'Outpost',
    desc: 'A desert compound with long sightlines. Snipers own the rooftop.',
    half: [H, H],
    boxes: b.boxes,
    props: b.props,
    spawns: [
      faceCentre([sp(-42, -10, Math.PI / 2), sp(-42, 0, Math.PI / 2), sp(-42, 10, Math.PI / 2), sp(-38, -20, Math.PI / 2), sp(-38, 20, Math.PI / 2), sp(-42, -26, Math.PI / 2)]),
      faceCentre([sp(42, -10, -Math.PI / 2), sp(42, 0, -Math.PI / 2), sp(42, 10, -Math.PI / 2), sp(38, -20, -Math.PI / 2), sp(38, 20, -Math.PI / 2), sp(42, 26, -Math.PI / 2)]),
    ],
    ffa: faceCentre([sp(-42, -42, 0.8), sp(42, 42, -2.4), sp(-42, 42, 2.4), sp(42, -42, -0.8), sp(0, -42, 0), sp(0, 42, Math.PI), sp(-42, 0, Math.PI / 2), sp(42, 0, -Math.PI / 2), sp(-20, 35, 2), sp(20, -35, -1), sp(-30, -20, 1), sp(30, 20, -2)]),
    flags: [
      { x: -28, z: 8, y: 0 },
      { x: 0, z: 10, y: 0 },
      { x: 28, z: -8, y: 0 },
    ],
    theme: { sky: 'dusk', ground: 'sand', patches: [[-46, -3, 46, 3, 'dirt'], [-3, -46, 3, 46, 'dirt'], [-9, -7, 9, 7, 'concrete']], sun: [0.6, 0.45, -0.4], fog: ['#d6b48a', 60, 220] },
    size: 'large',
  };
}

export const MAPS: MapDef[] = [freight(), culdesac(), outpost()];
export const MAP = Object.fromEntries(MAPS.map((m) => [m.id, m])) as Record<string, MapDef>;
