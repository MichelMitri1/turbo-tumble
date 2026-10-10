import { HALF, LANE_W, RIVER_W, SPECS, WATER_Y, roads, type RoadDef, type RoadSpec, type RoadType } from './layout';
import { Terrain, baseHeight, riverDist } from './terrain';

/**
 * The road network built from the layout's curves: roads are sampled every 2 m, cut where
 * they cross (only at the same level — the freeway flies over the streets), joined where
 * they end on another road, and split into edges between intersections. Ground roads follow
 * the land (and the land is flattened under them); over the river they become bridges.
 * Lanes, turn curves, traffic-light phases and routes for the AI live here too.
 */

export const STEP = 2;

export interface RNode {
  id: number;
  x: number;
  y: number;
  z: number;
  edges: number[];
  /** Traffic lights here. */
  light: boolean;
  /** Clear radius (stop lines, junction patch). */
  r: number;
}

export interface REdge {
  id: number;
  a: number;
  b: number;
  type: RoadType;
  spec: RoadSpec;
  name: string;
  /** Samples a → b: x, y, z every ~STEP metres. */
  px: Float32Array;
  py: Float32Array;
  pz: Float32Array;
  /** Arc length at each sample. */
  cum: Float32Array;
  len: number;
  /** Any part off the ground (bridge / elevated), and which samples. */
  raised: boolean;
  up: Uint8Array;
}

interface Road {
  def: RoadDef;
  x: number[];
  y: number[];
  z: number[];
  /** Split points (sample index + fraction) where intersections / joins are. */
  cuts: number[];
}

/** Catmull-Rom sampling every STEP metres. */
function sampleCurve(pts: Array<[number, number]>, sharp: boolean): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const P = (i: number) => pts[Math.max(0, Math.min(pts.length - 1, i))]!;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = P(i - 1);
    const p1 = P(i);
    const p2 = P(i + 1);
    const p3 = P(i + 2);
    const segLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.max(1, Math.ceil(segLen / STEP));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      if (sharp) {
        out.push([p1[0] + (p2[0] - p1[0]) * t, p1[1] + (p2[1] - p1[1]) * t]);
        continue;
      }
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]!);
  return out;
}

export class RoadNet {
  nodes: RNode[] = [];
  edges: REdge[] = [];
  /** Spatial hash of edge samples (cell 32 m) for nearest-road queries. */
  private hash = new Map<number, Array<[number, number]>>();

  constructor(readonly terrain: Terrain) {
    const defs = roads();
    const R: Road[] = [];
    for (const def of defs) {
      const pts = sampleCurve(def.pts, !!def.sharp);
      // Drop stretches that run along the river or into the sea / off the map.
      const keep = pts.map(([x, z]) => Math.abs(x) < HALF - 4 && Math.abs(z) < HALF - 4 && baseHeight(x, z) > -1.2);
      const along = pts.map(([x, z]) => riverDist(x, z).d < RIVER_W / 2 + 4);
      // Runs inside the river longer than a crossing: drop.
      let i = 0;
      while (i < pts.length) {
        if (!along[i]) {
          i++;
          continue;
        }
        let j = i;
        while (j < pts.length && along[j]) j++;
        if (!def.height && (j - i) * STEP > RIVER_W * 2.4) for (let k = i; k < j; k++) keep[k] = false;
        i = j;
      }
      // Split into kept runs.
      let run: Array<[number, number]> = [];
      const runs: Array<Array<[number, number]>> = [];
      pts.forEach((p, k) => {
        if (keep[k]) run.push(p);
        else if (run.length) {
          runs.push(run);
          run = [];
        }
      });
      if (run.length) runs.push(run);
      for (const r of runs) {
        if (r.length < 4) continue;
        const total = r.length - 1;
        const y = r.map(([x, z], k) => (def.height ? def.height(k / total, x, z) : 0));
        R.push({ def, x: r.map((p) => p[0]), y, z: r.map((p) => p[1]), cuts: [0, r.length - 1] });
      }
    }
    // Ground roads follow the land (smoothed), and lift over the river as bridges.
    for (const r of R) {
      if (r.def.height) continue;
      const raw = r.x.map((x, k) => Math.max(0, baseHeight(x, r.z[k]!)));
      const n = raw.length;
      const win = 12;
      for (let k = 0; k < n; k++) {
        let s = 0;
        let c = 0;
        for (let q = Math.max(0, k - win); q <= Math.min(n - 1, k + win); q++) {
          s += raw[q]!;
          c++;
        }
        const d = riverDist(r.x[k]!, r.z[k]!).d;
        const arch = d < RIVER_W / 2 + 24 ? 1.6 * Math.cos(Math.min(1, d / (RIVER_W / 2 + 24)) * (Math.PI / 2)) : 0;
        r.y[k] = s / c + arch;
      }
    }
    this.intersect(R);
    this.join(R);
    this.build(R);
    // The land under ground roads is flattened to the road.
    const flat: Array<{ x: number; z: number; y: number; inner: number; outer: number }> = [];
    for (const e of this.edges) {
      const half = e.spec.width / 2 + (e.spec.sidewalk ? 4.5 : 1.5);
      for (let k = 0; k < e.px.length; k += 2) {
        const x = e.px[k]!;
        const z = e.pz[k]!;
        const y = e.py[k]!;
        if (riverDist(x, z).d < RIVER_W / 2 + 6) continue; // the bridge span
        if (this.isElevated(e, y)) continue;
        flat.push({ x, z, y: y - 0.05, inner: half, outer: half + 10 });
      }
    }
    terrain.flatten(flat);
    for (const e of this.edges) {
      for (let k = 0; k < e.px.length; k++) e.up[k] = e.py[k]! > terrain.height(e.px[k]!, e.pz[k]!) + 0.6 ? 1 : 0;
      e.raised = e.up.some((v) => v === 1);
    }
    this.index();
  }

  /** Same-level crossings become intersections. */
  private intersect(R: Road[]): void {
    const cell = 24;
    const grid = new Map<number, Array<[number, number]>>();
    const key = (i: number, j: number) => i * 100003 + j;
    R.forEach((r, ri) => {
      for (let k = 0; k < r.x.length - 1; k++) {
        const i0 = Math.floor(Math.min(r.x[k]!, r.x[k + 1]!) / cell);
        const i1 = Math.floor(Math.max(r.x[k]!, r.x[k + 1]!) / cell);
        const j0 = Math.floor(Math.min(r.z[k]!, r.z[k + 1]!) / cell);
        const j1 = Math.floor(Math.max(r.z[k]!, r.z[k + 1]!) / cell);
        for (let i = i0; i <= i1; i++)
          for (let j = j0; j <= j1; j++) {
            const kk = key(i, j);
            if (!grid.has(kk)) grid.set(kk, []);
            grid.get(kk)!.push([ri, k]);
          }
      }
    });
    const seen = new Set<string>();
    for (const list of grid.values())
      for (let a = 0; a < list.length; a++)
        for (let b = a + 1; b < list.length; b++) {
          const [ra, ka] = list[a]!;
          const [rb, kb] = list[b]!;
          if (ra === rb && Math.abs(ka - kb) < 3) continue;
          const id = ra < rb || (ra === rb && ka < kb) ? `${ra},${ka},${rb},${kb}` : `${rb},${kb},${ra},${ka}`;
          if (seen.has(id)) continue;
          seen.add(id);
          const A = R[ra]!;
          const B = R[rb]!;
          const hit = segX(A.x[ka]!, A.z[ka]!, A.x[ka + 1]!, A.z[ka + 1]!, B.x[kb]!, B.z[kb]!, B.x[kb + 1]!, B.z[kb + 1]!);
          if (!hit) continue;
          const ya = A.y[ka]! + (A.y[ka + 1]! - A.y[ka]!) * hit[0];
          const yb = B.y[kb]! + (B.y[kb + 1]! - B.y[kb]!) * hit[1];
          if (Math.abs(ya - yb) > 1.2) continue; // one passes over the other
          A.cuts.push(ka + hit[0]);
          B.cuts.push(kb + hit[1]);
        }
  }

  /** Road ends that stop on another road get joined to it. */
  private join(R: Road[]): void {
    for (const r of R)
      for (const end of [0, r.x.length - 1]) {
        const x = r.x[end]!;
        const z = r.z[end]!;
        const y = r.y[end]!;
        let best: { road: Road; f: number; d: number } | null = null;
        for (const o of R) {
          if (o === r) continue;
          for (let k = 0; k < o.x.length - 1; k++) {
            const ax = o.x[k]!;
            const az = o.z[k]!;
            if (Math.abs(ax - x) > 30 || Math.abs(az - z) > 30) continue;
            const dx = o.x[k + 1]! - ax;
            const dz = o.z[k + 1]! - az;
            const l2 = dx * dx + dz * dz || 1;
            const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
            const d = Math.hypot(ax + dx * t - x, az + dz * t - z);
            const oy = o.y[k]! + (o.y[k + 1]! - o.y[k]!) * t;
            if (Math.abs(oy - y) > 1.5) continue;
            if (d < 16 && (!best || d < best.d)) best = { road: o, f: k + t, d };
          }
        }
        if (!best || best.d < 0.01) continue;
        // Snap the end onto the other road and cut it there.
        const k = Math.floor(best.f);
        const t = best.f - k;
        const o = best.road;
        r.x[end] = o.x[k]! + (o.x[Math.min(k + 1, o.x.length - 1)]! - o.x[k]!) * t;
        r.z[end] = o.z[k]! + (o.z[Math.min(k + 1, o.z.length - 1)]! - o.z[k]!) * t;
        r.y[end] = o.y[k]! + (o.y[Math.min(k + 1, o.y.length - 1)]! - o.y[k]!) * t;
        o.cuts.push(best.f);
      }
  }

  private build(R: Road[]): void {
    const nodeAt = (x: number, y: number, z: number): number => {
      for (const n of this.nodes) if (Math.abs(n.x - x) < 5 && Math.abs(n.z - z) < 5 && Math.abs(n.y - y) < 2) return n.id;
      const n: RNode = { id: this.nodes.length, x, y, z, edges: [], light: false, r: 0 };
      this.nodes.push(n);
      return n.id;
    };
    const at = (r: Road, f: number): [number, number, number] => {
      const k = Math.min(r.x.length - 2, Math.floor(f));
      const t = f - k;
      return [r.x[k]! + (r.x[k + 1]! - r.x[k]!) * t, r.y[k]! + (r.y[k + 1]! - r.y[k]!) * t, r.z[k]! + (r.z[k + 1]! - r.z[k]!) * t];
    };
    for (const r of R) {
      const cuts = [...new Set(r.cuts.map((c) => Math.round(c * 1000) / 1000))].sort((a, b) => a - b);
      // Merge cuts closer than 6 m.
      const merged: number[] = [];
      for (const c of cuts) if (!merged.length || (c - merged[merged.length - 1]!) * STEP > 6) merged.push(c);
      if (merged[merged.length - 1]! < r.x.length - 1 - 0.01) merged.push(r.x.length - 1);
      for (let q = 0; q < merged.length - 1; q++) {
        const f0 = merged[q]!;
        const f1 = merged[q + 1]!;
        if ((f1 - f0) * STEP < 4) continue;
        const pa = at(r, f0);
        const pb = at(r, f1);
        const a = nodeAt(...pa);
        const b = nodeAt(...pb);
        if (a === b) continue;
        const xs = [this.nodes[a]!.x];
        const ys = [this.nodes[a]!.y];
        const zs = [this.nodes[a]!.z];
        for (let k = Math.ceil(f0 + 1e-6); k < f1; k++) {
          xs.push(r.x[k]!);
          ys.push(r.y[k]!);
          zs.push(r.z[k]!);
        }
        xs.push(this.nodes[b]!.x);
        ys.push(this.nodes[b]!.y);
        zs.push(this.nodes[b]!.z);
        const cum = new Float32Array(xs.length);
        for (let k = 1; k < xs.length; k++) cum[k] = cum[k - 1]! + Math.hypot(xs[k]! - xs[k - 1]!, zs[k]! - zs[k - 1]!, ys[k]! - ys[k - 1]!);
        const e: REdge = { id: this.edges.length, a, b, type: r.def.type, spec: SPECS[r.def.type], name: r.def.name, px: Float32Array.from(xs), py: Float32Array.from(ys), pz: Float32Array.from(zs), cum, len: cum[cum.length - 1]!, raised: false, up: new Uint8Array(xs.length) };
        this.elevated.set(e.id, !!r.def.height);
        this.edges.push(e);
        this.nodes[a]!.edges.push(e.id);
        this.nodes[b]!.edges.push(e.id);
      }
    }
    for (const n of this.nodes) {
      const es = n.edges.map((id) => this.edges[id]!);
      n.r = es.length > 2 ? Math.max(...es.map((e) => e.spec.width / 2)) + 1.5 : 0;
      // Lights where at least three city streets meet (not on the freeway / ramps / country roads).
      n.light = es.length >= 3 && es.every((e) => e.type === 'street' || e.type === 'avenue' || (e.type === 'highway' && !e.raised));
    }
  }

  private elevated = new Map<number, boolean>();
  /** A freeway / ramp sample above the ground (its own height, not the land's). */
  private isElevated(e: REdge, y: number): boolean {
    return !!this.elevated.get(e.id) && y > 0.4;
  }
  /** Is sample k of an edge raised (bridge / freeway)? */
  raisedAt(e: REdge, s: number): boolean {
    let k = 0;
    while (k < e.cum.length - 1 && e.cum[k]! < s) k++;
    return e.up[k] === 1;
  }

  private index(): void {
    for (const e of this.edges)
      for (let k = 0; k < e.px.length; k += 2) {
        const kk = Math.floor(e.px[k]! / 32) * 100003 + Math.floor(e.pz[k]! / 32);
        if (!this.hash.has(kk)) this.hash.set(kk, []);
        this.hash.get(kk)!.push([e.id, k]);
      }
  }

  // ---------------------------------------------------------------- queries

  /** Point at arc length s along an edge (from a). */
  point(e: REdge, s: number, out: { x: number; y: number; z: number }): void {
    const c = e.cum;
    s = Math.max(0, Math.min(e.len, s));
    let lo = 0;
    let hi = c.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (c[m]! <= s) lo = m;
      else hi = m;
    }
    const seg = c[hi]! - c[lo]! || 1;
    const t = (s - c[lo]!) / seg;
    out.x = e.px[lo]! + (e.px[hi]! - e.px[lo]!) * t;
    out.y = e.py[lo]! + (e.py[hi]! - e.py[lo]!) * t;
    out.z = e.pz[lo]! + (e.pz[hi]! - e.pz[lo]!) * t;
  }
  /** Unit direction (x, z) at s (from a towards b). */
  tangent(e: REdge, s: number): [number, number] {
    const p = { x: 0, y: 0, z: 0 };
    const q = { x: 0, y: 0, z: 0 };
    this.point(e, Math.max(0, s - 1.5), p);
    this.point(e, Math.min(e.len, s + 1.5), q);
    const l = Math.hypot(q.x - p.x, q.z - p.z) || 1;
    return [(q.x - p.x) / l, (q.z - p.z) / l];
  }
  /** Lane offset from the centre line (right-hand traffic). */
  laneOffset(e: REdge, lane: number): number {
    return e.spec.median / 2 + (lane + 0.5) * LANE_W;
  }
  /**
   * A point in a lane: `dir` +1 travels a→b, −1 travels b→a; `s` is the distance travelled
   * along that direction.
   */
  lane(e: REdge, dir: 1 | -1, lane: number, s: number, out: { x: number; y: number; z: number }): [number, number] {
    const at = dir > 0 ? s : e.len - s;
    this.point(e, at, out);
    let [tx, tz] = this.tangent(e, at);
    if (dir < 0) {
      tx = -tx;
      tz = -tz;
    }
    const off = this.laneOffset(e, lane);
    // Right of travel (x east, z south): (−tz, tx).
    out.x += -tz * off;
    out.z += tx * off;
    return [tx, tz];
  }
  /** Nearest road to a point: edge, arc length, distance, and which side. */
  nearest(x: number, z: number, maxD = 64): { e: REdge; s: number; d: number; side: number } | null {
    let best: { e: REdge; s: number; d: number; side: number } | null = null;
    const ci = Math.floor(x / 32);
    const cj = Math.floor(z / 32);
    const r = Math.ceil(maxD / 32);
    for (let i = ci - r; i <= ci + r; i++)
      for (let j = cj - r; j <= cj + r; j++) {
        const list = this.hash.get(i * 100003 + j);
        if (!list) continue;
        for (const [id, k] of list) {
          const e = this.edges[id]!;
          const k1 = Math.min(e.px.length - 1, k + 2);
          const ax = e.px[k]!;
          const az = e.pz[k]!;
          const dx = e.px[k1]! - ax;
          const dz = e.pz[k1]! - az;
          const l2 = dx * dx + dz * dz || 1;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
          const d = Math.hypot(ax + dx * t - x, az + dz * t - z);
          if (d < maxD && (!best || d < best.d)) best = { e, s: e.cum[k]! + (e.cum[k1]! - e.cum[k]!) * t, d, side: dx * (z - az) - dz * (x - ax) > 0 ? 1 : -1 };
        }
      }
    return best;
  }
  /** Is (x, z) on a road surface (at ground level)? */
  onRoad(x: number, z: number, pad = 0): boolean {
    const n = this.nearest(x, z, 40);
    return !!n && n.d < n.e.spec.width / 2 + pad;
  }

  /** Shortest route between nodes (Dijkstra). */
  route(from: number, to: number): number[] {
    const dist = new Float64Array(this.nodes.length).fill(Infinity);
    const prev = new Int32Array(this.nodes.length).fill(-1);
    dist[from] = 0;
    const open = new Set<number>([from]);
    while (open.size) {
      let u = -1;
      let ud = Infinity;
      for (const n of open)
        if (dist[n]! < ud) {
          ud = dist[n]!;
          u = n;
        }
      open.delete(u);
      if (u === to) break;
      for (const id of this.nodes[u]!.edges) {
        const e = this.edges[id]!;
        const v = e.a === u ? e.b : e.a;
        const nd = ud + e.len / e.spec.speed;
        if (nd < dist[v]!) {
          dist[v] = nd;
          prev[v] = u;
          open.add(v);
        }
      }
    }
    const path: number[] = [];
    for (let n = to; n >= 0; n = prev[n]!) path.unshift(n);
    return path[0] === from ? path : [from, to];
  }

  /** Nearest node to a point. */
  nearestNode(x: number, z: number): RNode {
    const n = this.nearest(x, z, 400);
    if (n) {
      const a = this.nodes[n.e.a]!;
      const b = this.nodes[n.e.b]!;
      return Math.hypot(a.x - x, a.z - z) < Math.hypot(b.x - x, b.z - z) ? a : b;
    }
    let best = this.nodes[0]!;
    for (const m of this.nodes) if (Math.hypot(m.x - x, m.z - z) < Math.hypot(best.x - x, best.z - z)) best = m;
    return best;
  }

  /** The edge between two nodes. */
  between(a: number, b: number): REdge | null {
    for (const id of this.nodes[a]!.edges) {
      const e = this.edges[id]!;
      if ((e.a === a && e.b === b) || (e.a === b && e.b === a)) return e;
    }
    return null;
  }
}

export const WATER = WATER_Y;

/** Segment intersection: params on both segments, or null. */
function segX(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): [number, number] | null {
  const rx = bx - ax;
  const rz = bz - az;
  const sx = dx - cx;
  const sz = dz - cz;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((cx - ax) * sz - (cz - az) * sx) / den;
  const u = ((cx - ax) * rz - (cz - az) * rx) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [t, u];
}
