import { DISTRICT_NAMES, PARK_W, RIVER_W, WATER_Y, coastZ, districtAt, type District } from './layout';
import { RoadNet, type REdge } from './net';
import { Terrain, riverDist } from './terrain';

/**
 * Velora City: the land, the road network, and everything placed along the roads —
 * downtown towers, Midtown shops, port warehouses, houses in the hills and suburbs, trees,
 * street lamps, traffic lights, shops you can walk into, and cars parked at the curb.
 *
 * x → east, z → south, metres. Pure data (no rendering).
 */

export type Kit = 'downtown' | 'suburb' | 'street' | 'fps';
export type Bounds = Record<string, { min: number[]; max: number[] }>;

export interface Placement {
  kit: Kit;
  model: string;
  x: number;
  y: number;
  z: number;
  /** Rotation about y (model front +z turned to face (sin yaw, cos yaw)). */
  yaw: number;
  scale: number;
  /** Extra vertical stretch (skyscrapers). */
  sy?: number;
  /** Footprint (half extents along the model's own x / z) + height; null = no collider. */
  box: { hx: number; hz: number; h: number } | null;
}

export type ShopKind = 'guns' | 'clothes' | 'food' | 'respray' | 'hospital' | 'police' | 'cars';
export interface Shop {
  kind: ShopKind;
  name: string;
  x: number;
  y: number;
  z: number;
  /** Direction the door faces (unit). */
  fx: number;
  fz: number;
}

export interface City {
  terrain: Terrain;
  net: RoadNet;
  placements: Placement[];
  shops: Shop[];
  /** Parking spots: position + heading. */
  parking: Array<{ x: number; y: number; z: number; h: number }>;
  /** Street lamps and traffic-light poles. */
  lamps: Array<{ x: number; y: number; z: number; yaw: number }>;
  lights: Array<{ x: number; y: number; z: number; yaw: number; node: number; edge: number }>;
  spawn: { x: number; z: number; h: number };
}

export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

const TOWERS = ['building-skyscraper-a', 'building-skyscraper-b', 'building-skyscraper-c', 'building-skyscraper-d', 'building-skyscraper-e'];
const COMMERCIAL = ['building-a', 'building-b', 'building-c', 'building-d', 'building-e', 'building-f', 'building-g', 'building-h', 'building-i', 'building-j', 'building-k', 'building-l', 'building-m'];
const HOUSES = Array.from({ length: 21 }, (_, k) => `building-type-${String.fromCharCode(97 + k)}`);

const SHOP_ANCHORS: Array<{ kind: ShopKind; name: string; x: number; z: number }> = [
  { kind: 'guns', name: 'Lock & Load', x: -160, z: -20 },
  { kind: 'guns', name: 'Lock & Load', x: 650, z: -260 },
  { kind: 'guns', name: 'Lock & Load', x: -620, z: 600 },
  { kind: 'clothes', name: 'Threadz', x: 120, z: -300 },
  { kind: 'clothes', name: 'Threadz', x: 700, z: 160 },
  { kind: 'clothes', name: 'Threadz', x: 200, z: 620 },
  { kind: 'food', name: 'Quik-Stop', x: -220, z: 120 },
  { kind: 'food', name: 'Quik-Stop', x: 560, z: -60 },
  { kind: 'food', name: 'Quik-Stop', x: 700, z: -850 },
  { kind: 'food', name: 'Quik-Stop', x: 320, z: 640 },
  { kind: 'food', name: 'Quik-Stop', x: 600, z: -700 },
  { kind: 'respray', name: 'Spray Away', x: 460, z: 220 },
  { kind: 'respray', name: 'Spray Away', x: 840, z: 300 },
  { kind: 'hospital', name: 'Velora General', x: 260, z: 140 },
  { kind: 'hospital', name: 'Del Mar Medical', x: 560, z: 640 },
  { kind: 'police', name: 'VCPD Mission Row', x: -40, z: -380 },
  { kind: 'police', name: 'VCPD Del Mar', x: -300, z: 620 },
  { kind: 'cars', name: 'Velora Motors', x: 820, z: -100 },
];

export function buildCity(kits: Record<string, Bounds>, seed = 11): City {
  const r = rng(seed);
  const pick = <T>(a: T[]) => a[Math.floor(r() * a.length)]!;
  const terrain = new Terrain();
  const net = new RoadNet(terrain);
  const placements: Placement[] = [];
  const parking: City['parking'] = [];
  const lamps: City['lamps'] = [];
  const lights: City['lights'] = [];
  // Building footprints for overlap tests (hash of oriented boxes).
  const occ = new Map<number, Array<{ x: number; z: number; c: number; s: number; hx: number; hz: number }>>();
  const hk = (x: number, z: number) => Math.floor(x / 40) * 100003 + Math.floor(z / 40);
  const overlaps = (x: number, z: number, yaw: number, hx: number, hz: number) => {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++) {
        const list = occ.get(hk(x + i * 40, z + j * 40));
        if (!list) continue;
        for (const o of list) if (Math.hypot(o.x - x, o.z - z) < Math.hypot(o.hx, o.hz) + Math.hypot(hx, hz) && obbOverlap(x, z, c, s, hx, hz, o.x, o.z, o.c, o.s, o.hx, o.hz)) return true;
      }
    return false;
  };
  const occupy = (x: number, z: number, yaw: number, hx: number, hz: number) => {
    const o = { x, z, c: Math.cos(yaw), s: Math.sin(yaw), hx, hz };
    const k = hk(x, z);
    if (!occ.has(k)) occ.set(k, []);
    occ.get(k)!.push(o);
  };
  const size = (kit: string, model: string) => {
    const b = kits[kit]?.[model];
    return b ? { w: b.max[0]! - b.min[0]!, d: b.max[2]! - b.min[2]!, h: b.max[1]! - b.min[1]!, minY: b.min[1]! } : { w: 1, d: 1, h: 1, minY: 0 };
  };
  /** Clear of roads (with sidewalks), water and steep ground? Returns the ground height. */
  const ground = (x: number, z: number, yaw: number, hx: number, hz: number, margin: number): number | null => {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    let lo = Infinity;
    let hi = -Infinity;
    for (const [u, v] of [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1], [0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
      const px = x + (u * hx * c + v * hz * s);
      const pz = z + (-u * hx * s + v * hz * c);
      const n = net.nearest(px, pz, 50);
      if (n && n.d < n.e.spec.width / 2 + margin) return null;
      const h = terrain.height(px, pz);
      if (h < WATER_Y + 1.2) return null;
      if (riverDist(px, pz).d < RIVER_W / 2 + 10) return null;
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    if (hi - lo > 3.5) return null;
    return lo;
  };
  const place = (kit: Kit, model: string, x: number, y: number, z: number, yaw: number, scale: number, collide = true, sy = 1) => {
    const sz = size(kit, model);
    const box = collide ? { hx: (sz.w * scale) / 2, hz: (sz.d * scale) / 2, h: sz.h * scale * sy } : null;
    const p: Placement = { kit, model, x, y: y - sz.minY * scale, z, yaw, scale, sy, box };
    placements.push(p);
    return p;
  };
  const districtOf = (x: number, z: number): District => districtAt(x, z, riverDist(x, z).side);

  // ---- Buildings along every city street, facing the road.
  const fronts: Array<{ p: Placement; fx: number; fz: number; d: District }> = [];
  for (const e of net.edges) {
    if (!e.spec.sidewalk) continue;
    for (const side of [1, -1] as const) {
      let s = 14;
      while (s < e.len - 14) {
        const mid = { x: 0, y: 0, z: 0 };
        net.point(e, s, mid);
        const d = districtOf(mid.x, mid.z);
        if (d === 'park') {
          s += 20;
          continue;
        }
        let kit: Kit = 'downtown';
        let model: string;
        let scale: number;
        let sy = 1;
        let setback = 1.5;
        let gap = 2 + r() * 4;
        const centre = Math.hypot(mid.x - 40, mid.z + 100);
        if (d === 'downtown' && centre < 300) {
          model = pick(TOWERS);
          const sz = size('downtown', model);
          scale = 24 / Math.max(sz.w, sz.d);
          sy = 1.3 + r() * 1.3 + Math.max(0, (300 - centre) / 300) * 1.4;
        } else if (d === 'downtown' || d === 'midtown') {
          model = pick(COMMERCIAL);
          scale = 17 / size('downtown', model).w;
          sy = 1 + r() * 0.4;
        } else if (d === 'port') {
          model = r() < 0.6 ? 'building-n' : pick(COMMERCIAL);
          scale = (model === 'building-n' ? 34 : 18) / size('downtown', model).w;
          sy = 0.7;
          gap = 10;
        } else if (d === 'beach' && r() < 0.4) {
          model = pick(COMMERCIAL);
          scale = 15 / size('downtown', model).w;
          sy = 0.7;
        } else {
          kit = 'suburb';
          model = pick(HOUSES);
          scale = 10;
          setback = 7;
          gap = d === 'hills' ? 26 : 9;
        }
        const sz = size(kit, model);
        const w = sz.w * scale;
        const dep = sz.d * scale;
        const at = s + w / 2;
        if (at > e.len - 10) break;
        if (net.raisedAt(e, at)) {
          s += 12;
          continue;
        }
        const c = { x: 0, y: 0, z: 0 };
        net.point(e, at, c);
        const [tx, tz] = net.tangent(e, at);
        // Normal pointing to this side (right of a→b for side +1).
        const nx = -tz * side;
        const nz = tx * side;
        const off = e.spec.width / 2 + 4 + setback + dep / 2;
        const x = c.x + nx * off;
        const z = c.z + nz * off;
        const yaw = Math.atan2(-nx, -nz); // front faces the road
        const gy = ground(x, z, yaw, w / 2, dep / 2, 4);
        if (gy !== null && !overlaps(x, z, yaw, w / 2 + 0.5, dep / 2 + 0.5)) {
          const p = place(kit, model, x, gy, z, yaw, scale, true, sy);
          occupy(x, z, yaw, w / 2, dep / 2);
          fronts.push({ p, fx: -nx, fz: -nz, d });
          if (kit === 'suburb') {
            const tx2 = x + tx * (w / 2 + 3);
            const tz2 = z + tz * (w / 2 + 3);
            place('suburb', r() < 0.5 ? 'tree-large' : 'tree-small', tx2, terrain.height(tx2, tz2), tz2, r() * 6, 9, false);
            // A car on the driveway.
            if (r() < 0.45) {
              const px = c.x + nx * (e.spec.width / 2 + 4 + 3.2) - tx * (w / 2 + 2);
              const pz = c.z + nz * (e.spec.width / 2 + 4 + 3.2) - tz * (w / 2 + 2);
              if (!overlaps(px, pz, yaw, 1.2, 2.6)) parking.push({ x: px, y: terrain.height(px, pz), z: pz, h: Math.atan2(-nx, -nz) });
            }
          }
        }
        s += w + gap;
      }
    }
  }

  // ---- Shops: the nearest suitable building to each anchor.
  const shops: Shop[] = [];
  const used = new Set<Placement>();
  for (const a of SHOP_ANCHORS) {
    let best: (typeof fronts)[number] | null = null;
    let bd = Infinity;
    for (const f of fronts) {
      if (used.has(f.p) || f.p.kit !== 'downtown' || TOWERS.includes(f.p.model)) continue;
      if (shops.some((s) => Math.hypot(s.x - f.p.x, s.z - f.p.z) < 60)) continue;
      const d = Math.hypot(f.p.x - a.x, f.p.z - a.z);
      if (d < bd) {
        bd = d;
        best = f;
      }
    }
    if (!best) continue;
    used.add(best.p);
    if (a.kind === 'hospital') best.p.model = 'building-k';
    if (a.kind === 'police') best.p.model = 'building-j';
    const depth = best.p.box!.hz;
    shops.push({ kind: a.kind, name: a.name, x: best.p.x + best.fx * (depth + 1.8), y: terrain.height(best.p.x + best.fx * (depth + 1.8), best.p.z + best.fz * (depth + 1.8)), z: best.p.z + best.fz * (depth + 1.8), fx: best.fx, fz: best.fz });
  }

  // ---- Street lamps, traffic lights, curb parking.
  for (const e of net.edges) {
    const half = e.spec.width / 2;
    if (e.spec.sidewalk || e.type === 'rural') {
      for (let s = 10; s < e.len - 10; s += e.type === 'rural' ? 44 : 32) {
        const c = { x: 0, y: 0, z: 0 };
        net.point(e, s, c);
        const [tx, tz] = net.tangent(e, s);
        for (const side of [1, -1]) {
          if (e.type === 'rural' && side < 0) continue;
          const nx = -tz * side;
          const nz = tx * side;
          const x = c.x + nx * (half + 0.8);
          const z = c.z + nz * (half + 0.8);
          if (riverDist(x, z).d < RIVER_W / 2 + 4 || net.raisedAt(e, s)) continue;
          lamps.push({ x, y: terrain.height(x, z), z, yaw: Math.atan2(-nx, -nz) });
        }
      }
    }
    // Parked cars in the parking lanes of side streets.
    if (e.spec.parking)
      for (let s = 16; s < e.len - 16; s += 7) {
        if (r() < 0.55 || net.raisedAt(e, s)) continue;
        const c = { x: 0, y: 0, z: 0 };
        net.point(e, s, c);
        const [tx, tz] = net.tangent(e, s);
        const side = r() < 0.5 ? 1 : -1;
        const off = e.spec.median / 2 + e.spec.lanes * 3.5 + PARK_W / 2 + 0.1;
        const x = c.x - tz * side * off;
        const z = c.z + tx * side * off;
        parking.push({ x, y: c.y, z, h: Math.atan2(tx * side, tz * side) });
      }
  }
  for (const n of net.nodes) {
    if (!n.light) continue;
    for (const id of n.edges) {
      const e = net.edges[id]!;
      // Traffic arriving at n along e, and the pole on its near-right corner.
      const atA = e.a === n.id;
      const s = atA ? Math.min(e.len, n.r + 2) : Math.max(0, e.len - n.r - 2);
      const c = { x: 0, y: 0, z: 0 };
      net.point(e, s, c);
      let [tx, tz] = net.tangent(e, s);
      if (atA) {
        tx = -tx;
        tz = -tz;
      }
      const half = e.spec.width / 2;
      const x = c.x - tz * (half + 1);
      const z = c.z + tx * (half + 1);
      lights.push({ x, y: terrain.height(x, z), z, yaw: Math.atan2(-tx, -tz), node: n.id, edge: id });
    }
  }

  // ---- Trees: parks, hills, suburbs, the beach.
  for (let x = -980; x < 980; x += 22)
    for (let z = -980; z < 980; z += 22) {
      const px = x + (r() - 0.5) * 16;
      const pz = z + (r() - 0.5) * 16;
      const d = districtOf(px, pz);
      const dense = d === 'park' ? 0.9 : d === 'hills' ? 0.8 : d === 'west' ? 0.3 : d === 'beach' ? 0.18 : 0.05;
      if (r() > dense) continue;
      const h = terrain.height(px, pz);
      if (h < WATER_Y + 1.5 || pz > coastZ(px) - 70) continue;
      if (net.onRoad(px, pz, 6)) continue;
      if (riverDist(px, pz).d < RIVER_W / 2 + 8) continue;
      if (overlaps(px, pz, 0, 2, 2)) continue;
      place('suburb', r() < 0.6 ? 'tree-large' : 'tree-small', px, h, pz, r() * 6, 8 + r() * 6, false);
    }

  // ---- Where you start: a downtown sidewalk.
  const sn = net.nearest(40, -60, 200)!;
  const sp = { x: 0, y: 0, z: 0 };
  net.point(sn.e, sn.s, sp);
  const [tx, tz] = net.tangent(sn.e, sn.s);
  const off = sn.e.spec.width / 2 + 2;
  const spawn = { x: sp.x - tz * off, z: sp.z + tx * off, h: Math.atan2(tx, tz) };
  return { terrain, net, placements, shops, parking, lamps, lights, spawn };
}

export function districtName(x: number, z: number): string {
  return DISTRICT_NAMES[districtAt(x, z, riverDist(x, z).side)];
}
export function districtKind(x: number, z: number): District {
  return districtAt(x, z, riverDist(x, z).side);
}

/** 2D oriented-box overlap (separating axes). */
function obbOverlap(ax: number, az: number, ac: number, as: number, ahx: number, ahz: number, bx: number, bz: number, bc: number, bs: number, bhx: number, bhz: number): boolean {
  const axes: Array<[number, number]> = [
    [ac, -as],
    [as, ac],
    [bc, -bs],
    [bs, bc],
  ];
  const dx = bx - ax;
  const dz = bz - az;
  for (const [ux, uz] of axes) {
    const ra = ahx * Math.abs(ac * ux - as * uz) + ahz * Math.abs(as * ux + ac * uz);
    const rb = bhx * Math.abs(bc * ux - bs * uz) + bhz * Math.abs(bs * ux + bc * uz);
    if (Math.abs(dx * ux + dz * uz) > ra + rb) return false;
  }
  return true;
}

export type { REdge };
