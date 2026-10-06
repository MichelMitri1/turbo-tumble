import { Vector3 } from 'three';
import { TrackPath } from '../track/TrackPath';
import type { MoverDefinition, MoverKind, SegmentKind, StreamDefinition, TrackControlPoint, TrackDefinition } from '../types/track';

/**
 * Course language: a lap written as a sequence of straights and turns, like
 * driving instructions. The compiler closes the loop exactly (two `flex`
 * straights absorb the error) and spreads any height mismatch over the lap.
 *
 *   { s: 140 }                     straight, 140 m
 *   { R: 180, r: 16 }              right hairpin, 16 m radius   ({ L: … } = left)
 *   { s: 90, up: 8 }               climbing 8 m along it (negative = descend)
 *   { s: 60, kind: 'void', w: 7 }  open-edged road over the void, half-width 7
 *   { s: 130, jump: { gap: 18 } }  ramp, then an 18 m hole you must clear
 *   { s: 120, stream: { lateral: -3, width: 6, strength: 7, style: 'water' } }
 *   { s: 80, boost: true, hazards: 3, mark: 'cutIn' }
 *   { s: 120, movers: 'stomper' }  moving obstacles ({ kind, n, period } for control)
 */
export interface SegFeatures {
  /** Climb over the segment (m). */
  up?: number;
  kind?: SegmentKind;
  /** Road half-width from here on. */
  w?: number;
  stream?: Omit<StreamDefinition, 'distance' | 'length'> & { length?: number };
  boost?: boolean;
  /** Obstacles spread along the segment (alternating sides). */
  hazards?: number;
  /** Named point at the segment start (shortcut ends refer to it). */
  mark?: string;
  /** Moving obstacles spread along the segment. */
  movers?: MoverKind | { kind: MoverKind; n?: number; period?: number };
  /** A lake centred on this segment (radius m; offset = sideways, + right). */
  lake?: { r: number; offset?: number };
}

export type Seg =
  | (SegFeatures & { s: number; flex?: boolean; jump?: { gap?: number; at?: number } })
  | (SegFeatures & { L: number; r: number })
  | (SegFeatures & { R: number; r: number });

export interface CompiledCourse {
  points: TrackControlPoint[];
  startDistance: number;
  length: number;
  /** World positions of features, resolved to lap distances once the path exists. */
  resolve(def: TrackDefinition): void;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number; maxY: number; minY: number };
  /** Lakes asked for by segments, and hills over every tunnel (world coordinates). */
  lakes: Array<{ x: number; z: number; r: number }>;
  hills: Array<{ x: number; z: number; radius: number; height: number }>;
}

const STEP = 1;
const START_IN = 75;

interface Walk {
  xs: number[];
  ys: number[];
  zs: number[];
  /** Dense index where each segment starts. */
  segStart: number[];
  /** Heading (rad) at the start of each segment. */
  segHeading: number[];
}

function walk(segs: Seg[], lengths: number[], startY: number): Walk {
  const xs = [0];
  const ys = [startY];
  const zs = [0];
  const segStart: number[] = [];
  const segHeading: number[] = [];
  let h = 0;
  let y = startY;
  segs.forEach((seg, i) => {
    segStart.push(xs.length - 1);
    segHeading.push(h);
    const isTurn = !('s' in seg);
    const len = lengths[i]!;
    const steps = Math.max(1, Math.round(len / STEP));
    const turnSign = 'R' in seg ? 1 : -1; // + heading = right turn (towards +Z)
    const dTheta = isTurn ? (turnSign * (((('R' in seg ? seg.R : (seg as { L: number }).L) * Math.PI) / 180))) / steps : 0;
    const climb = seg.up ?? 0;
    const y0 = y;
    for (let k = 1; k <= steps; k++) {
      const step = len / steps;
      h += dTheta;
      const t = k / steps;
      xs.push(xs[xs.length - 1]! + Math.cos(h) * step);
      zs.push(zs[zs.length - 1]! + Math.sin(h) * step);
      y = y0 + climb * (t * t * (3 - 2 * t));
      ys.push(y);
    }
  });
  segStart.push(xs.length - 1);
  return { xs, ys, zs, segStart, segHeading };
}

function segLength(seg: Seg): number {
  if ('s' in seg) return seg.s;
  const deg = 'R' in seg ? seg.R : seg.L;
  return (Math.abs(deg) * Math.PI * seg.r) / 180;
}

export function compileCourse(segs: Seg[], startY = 2, name = 'course'): CompiledCourse {
  const first = segs[0];
  if (!first || !('s' in first) || first.s < 120) throw new Error(`${name}: a course must start with a straight of at least 120 m (the grid).`);
  const turn = segs.reduce((a, s) => a + ('R' in s ? s.R : 'L' in s ? -s.L : 0), 0);
  // A closed lap turns a whole number of times: 0 (figure-8 with an overpass), ±360, or ±720 (spiral).
  if (Math.abs(turn - Math.round(turn / 360) * 360) > 0.5 || Math.abs(turn) > 720.5) throw new Error(`${name}: turns must add up to 0, ±360 or ±720° (got ${turn.toFixed(1)}°).`);

  // Close the loop: two straights absorb the position error. Prefer the ones marked
  // `flex`; otherwise pick the non-parallel pair needing the smallest stretch.
  const lengths = segs.map(segLength);
  const pass = walk(segs, lengths, startY);
  const ex = pass.xs[pass.xs.length - 1]!;
  const ez = pass.zs[pass.zs.length - 1]!;
  const straights = segs.map((s, i) => ('s' in s ? i : -1)).filter((i) => i >= 0);
  const marked = straights.filter((i) => 'flex' in segs[i]! && (segs[i] as { flex?: boolean }).flex);
  const solve = (pool: number[]): { f1: number; f2: number; a: number; b: number } | null => {
    let best: { f1: number; f2: number; a: number; b: number } | null = null;
    for (let x = 0; x < pool.length; x++) {
      for (let y = x + 1; y < pool.length; y++) {
        const f1 = pool[x]!;
        const f2 = pool[y]!;
        const u1 = [Math.cos(pass.segHeading[f1]!), Math.sin(pass.segHeading[f1]!)];
        const u2 = [Math.cos(pass.segHeading[f2]!), Math.sin(pass.segHeading[f2]!)];
        const det = u1[0]! * u2[1]! - u1[1]! * u2[0]!;
        if (Math.abs(det) < 0.3) continue;
        const a = (-ex * u2[1]! + ez * u2[0]!) / det;
        const b = (-u1[0]! * ez + u1[1]! * ex) / det;
        const min = (i: number): number => (i === 0 ? 120 : 15);
        if (lengths[f1]! + a < min(f1) || lengths[f2]! + b < min(f2)) continue;
        if (!best || Math.abs(a) + Math.abs(b) < Math.abs(best.a) + Math.abs(best.b)) best = { f1, f2, a, b };
      }
    }
    return best;
  };
  const fix = solve(marked) ?? solve(straights);
  if (!fix) throw new Error(`${name}: the loop can't close — no pair of straights can absorb a ${Math.hypot(ex, ez).toFixed(0)} m error.`);
  lengths[fix.f1]! += fix.a;
  lengths[fix.f2]! += fix.b;

  const w = walk(segs, lengths, startY);
  const n = w.xs.length - 1; // last point == first point
  // Spread the height mismatch over the lap.
  const dy = w.ys[n]! - w.ys[0]!;
  for (let i = 0; i <= n; i++) w.ys[i]! -= (dy * i) / n;

  // Control points: dense on turns, sparse on straights.
  const points: TrackControlPoint[] = [];
  let segIndex = 0;
  const segAt = (i: number): number => {
    while (segIndex + 1 < segs.length && i >= w.segStart[segIndex + 1]!) segIndex++;
    return segIndex;
  };
  let last = -Infinity;
  for (let i = 0; i < n; i++) {
    const si = segAt(i);
    const seg = segs[si]!;
    const spacing = 's' in seg ? 18 : Math.max(5, Math.min(14, seg.r * 0.33));
    const isSegStart = i === w.segStart[si];
    if (i - last < spacing && !isSegStart) continue;
    if (isSegStart && i - last < 4 && points.length) points.pop();
    last = i;
    const cp: TrackControlPoint = { pos: [round(w.xs[i]!), round(w.ys[i]!), round(w.zs[i]!)] };
    // Kind / width apply from the segment's start; carry the latest width forward.
    for (let k = si; k >= 0; k--) {
      if (segs[k]!.w !== undefined) {
        cp.halfWidth = segs[k]!.w;
        break;
      }
    }
    if (seg.kind && seg.kind !== 'ground') cp.kind = seg.kind;
    points.push(cp);
  }

  const at = (i: number): Vector3 => new Vector3(w.xs[Math.min(n, i)]!, w.ys[Math.min(n, i)]!, w.zs[Math.min(n, i)]!);
  let total = 0;
  for (let i = 1; i <= n; i++) total += Math.hypot(w.xs[i]! - w.xs[i - 1]!, w.zs[i]! - w.zs[i - 1]!);

  const lakes: CompiledCourse['lakes'] = [];
  const hills: CompiledCourse['hills'] = [];
  segs.forEach((seg, si) => {
    const s0 = w.segStart[si]!;
    const s1 = w.segStart[si + 1]!;
    const mid = Math.round((s0 + s1) / 2);
    const nx = w.xs[Math.min(n, mid + 1)]! - w.xs[mid]!;
    const nz = w.zs[Math.min(n, mid + 1)]! - w.zs[mid]!;
    const len = Math.hypot(nx, nz) || 1;
    // Right of travel = (−dz, dx).
    const rx = -nz / len;
    const rz = nx / len;
    if (seg.lake) {
      const o = seg.lake.offset ?? 0;
      lakes.push({ x: w.xs[mid]! + rx * o, z: w.zs[mid]! + rz * o, r: seg.lake.r });
    }
    if (seg.kind === 'tunnel') {
      const span = (s1 - s0) * STEP;
      hills.push({ x: w.xs[mid]! + rx * 30, z: w.zs[mid]! + rz * 30, radius: Math.max(70, span * 0.8), height: 26 + w.ys[mid]! });
    }
  });

  return {
    lakes,
    hills,
    points,
    startDistance: START_IN,
    length: total,
    bounds: {
      minX: Math.min(...w.xs),
      maxX: Math.max(...w.xs),
      minZ: Math.min(...w.zs),
      maxZ: Math.max(...w.zs),
      minY: Math.min(...w.ys),
      maxY: Math.max(...w.ys),
    },
    resolve(def: TrackDefinition) {
      const path = new TrackPath(def);
      const lap = (p: Vector3): number => path.lapDistance(path.locate(p, -1, 0).splineDistance);
      const marks = new Map<string, number>();
      const widthAt = (si: number): number => {
        for (let k = si; k >= 0; k--) if (segs[k]!.w !== undefined) return segs[k]!.w!;
        return def.path.defaultHalfWidth;
      };
      segs.forEach((seg, si) => {
        const s0 = w.segStart[si]!;
        const s1 = w.segStart[si + 1]!;
        const d0 = lap(at(s0));
        const len = (s1 - s0) * STEP;
        if (seg.mark) marks.set(seg.mark, d0);
        if (seg.boost) def.boostPads.push({ distance: d0 + len * 0.5, lateral: 0, length: 7, width: 5 });
        if (seg.stream) {
          const { length, ...rest } = seg.stream;
          def.streams!.push({ ...rest, distance: d0 + 4, length: Math.min(length ?? len - 8, len - 8) });
        }
        if (seg.hazards) {
          for (let k = 0; k < seg.hazards; k++) {
            const d = d0 + ((k + 1) * len) / (seg.hazards + 1);
            const half = (seg.w ?? def.path.defaultHalfWidth) - 2.4;
            def.hazards.push({ type: 'obstacle', model: 'pylon', distance: d, lateral: (k % 2 ? 1 : -1) * half * 0.55, radius: 1.6, obstacleHeight: 2.5 });
          }
        }
        if (seg.movers) placeMovers(def, seg.movers, d0, len, seg.w ?? widthAt(si), si);
        if ('jump' in seg && seg.jump) {
          const ramp = d0 + (seg.jump.at ?? 45);
          // Full road width: a kart anywhere on the road takes the ramp.
          def.jumps.push({ distance: ramp, length: 20, width: (seg.w ?? def.path.defaultHalfWidth) * 2 - 0.4, rise: 3.4, launchSpeed: 16 });
          def.boostPads.push({ distance: ramp - 14, lateral: 0, length: 9, width: Math.min(9, (seg.w ?? def.path.defaultHalfWidth) * 2 - 3) });
          if (seg.jump.gap) def.gaps!.push({ distance: ramp + 22, length: seg.jump.gap });
        }
      });
      for (const sc of def.shortcuts as Array<TrackDefinition['shortcuts'][number] & { fromMark?: string; toMark?: string }>) {
        if (sc.fromMark) sc.from = marks.get(sc.fromMark) ?? sc.from;
        if (sc.toMark) sc.to = marks.get(sc.toMark) ?? sc.to;
        delete sc.fromMark;
        delete sc.toMark;
      }
    },
  };
}

/** Lay out moving obstacles along a segment (patterns per kind). */
function placeMovers(def: TrackDefinition, spec: NonNullable<SegFeatures['movers']>, d0: number, len: number, hw: number, salt: number): void {
  const { kind, n, period } = typeof spec === 'string' ? { kind: spec, n: undefined, period: undefined } : spec;
  const out = (def.movers ??= []);
  const along = (k: number, count: number): number => d0 + ((k + 1) * len) / (count + 1);
  const jitter = (k: number): number => ((salt * 7 + k * 13) % 10) / 10;
  const push = (m: MoverDefinition): void => void out.push(m);
  switch (kind) {
    case 'stomper': {
      const rows = n ?? Math.max(1, Math.round(len / 50));
      const per = hw > 8.5 ? 3 : 2;
      for (let r = 0; r < rows; r++) {
        for (let j = 0; j < per; j++) {
          const lateral = per === 3 ? (j - 1) * hw * 0.62 : (j ? 1 : -1) * hw * 0.45;
          push({ kind, distance: along(r, rows), lateral, period: period ?? 3.1, phase: j / per + r * 0.17, size: 2.3 });
        }
      }
      break;
    }
    case 'roller': {
      const count = n ?? Math.max(1, Math.round(len / 50));
      for (let k = 0; k < count; k++) push({ kind, distance: along(k, count), lateral: 0, period: (period ?? 4.4) + jitter(k) * 0.8, phase: k * 0.37, size: 2, span: hw - 2.6 });
      break;
    }
    case 'sweeper': {
      const count = n ?? Math.max(1, Math.round(len / 55));
      for (let k = 0; k < count; k++) push({ kind, distance: along(k, count), lateral: (k % 2 ? 1 : -1) * hw * 0.42, period: period ?? 3.6, phase: jitter(k), size: hw * 0.58, speed: k % 2 ? 1 : -1 });
      break;
    }
    case 'pendulum': {
      const count = n ?? Math.max(1, Math.round(len / 40));
      for (let k = 0; k < count; k++) push({ kind, distance: along(k, count), lateral: 0, period: period ?? 3.0, phase: k * 0.5 + jitter(k) * 0.1, size: 1.7 });
      break;
    }
    case 'geyser': {
      const count = n ?? Math.max(2, Math.round(len / 24));
      for (let k = 0; k < count; k++) push({ kind, distance: along(k, count), lateral: [-0.5, 0.45, 0, -0.15, 0.55][k % 5]! * hw, period: period ?? 3.6, phase: k * 0.29, size: 2 });
      break;
    }
    case 'cruiser':
      break; // whole-lap traffic: see CourseSpec.traffic
  }
}

const round = (v: number): number => Math.round(v * 10) / 10;
