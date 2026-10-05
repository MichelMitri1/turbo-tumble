import type { SegmentKind, TrackControlPoint } from '../types/track';

/** r(θ) / y(θ) term: amplitude · sin(k·θ + phase). */
export type Harmonic = [k: number, amplitude: number, phase: number];

export interface LayoutSpec {
  /** Mean radius (m). */
  radius: number;
  /** Shape: r(θ) = radius · (1 + Σ amp·sin(kθ + phase)). Keep Σ|amp| < ~0.45. */
  harmonics: Harmonic[];
  /** Non-uniform scale (x, z) for ovals. */
  stretch?: [number, number];
  /** Elevation: y(θ) = base + Σ amp·sin(kθ + phase) (metres), clamped ≥ 0. */
  elevation?: Harmonic[];
  /** Control points around the lap. */
  points?: number;
  /** Race clockwise instead of counter-clockwise. */
  clockwise?: boolean;
  /** Segment kinds / widths over lap fractions measured from the start line. */
  segments?: Array<{ from: number; to: number; kind?: SegmentKind; halfWidth?: number }>;
}

export interface GeneratedLayout {
  points: TrackControlPoint[];
  /** Spline distance from control point 0 to the start line. */
  startDistance: number;
  /** Approximate lap length (m). */
  length: number;
  /** Lap distances (from the start line) of the straightest stretches, best first. */
  straights: number[];
  /** Smallest inner radius of the shape (for infield lakes / hills). */
  innerRadius: number;
  /** World position at a lap fraction (for placing lakes under bridges, hills over tunnels). */
  at(fraction: number): { x: number; y: number; z: number };
}

const DENSE = 1440;

/**
 * Track layouts from a few numbers. The centerline is a star-shaped closed curve
 * (radius as a positive function of angle), so it can never cross itself; the
 * start line is put on the longest straight, with the grid on the straight too.
 */
export function generateLayout(spec: LayoutSpec): GeneratedLayout {
  const [sx, sz] = spec.stretch ?? [1, 1];
  const dir = spec.clockwise ? -1 : 1;
  const radiusAt = (t: number): number => spec.radius * (1 + spec.harmonics.reduce((a, [k, amp, ph]) => a + amp * Math.sin(k * t + ph), 0));
  const heightAt = (t: number): number => Math.max(0, (spec.elevation ?? []).reduce((a, [k, amp, ph]) => a + amp * Math.sin(k * t + ph), 0));
  const pos = (t: number): [number, number, number] => {
    const r = radiusAt(t);
    return [Math.cos(t) * r * sx, heightAt(t), Math.sin(t) * r * sz];
  };

  // Dense polyline (in driving order) for arc length + curvature.
  const thetas: number[] = [];
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  const arc: number[] = [0];
  for (let i = 0; i <= DENSE; i++) {
    const t = (dir * i * Math.PI * 2) / DENSE;
    const [x, y, z] = pos(t);
    thetas.push(t);
    xs.push(x);
    ys.push(y);
    zs.push(z);
    if (i > 0) arc.push(arc[i - 1]! + Math.hypot(x - xs[i - 1]!, y - ys[i - 1]!, z - zs[i - 1]!));
  }
  const length = arc[DENSE]!;
  const heading = (i: number): number => Math.atan2(zs[(i + 1) % DENSE]! - zs[i]!, xs[(i + 1) % DENSE]! - xs[i]!);
  const turn: number[] = [];
  for (let i = 0; i < DENSE; i++) {
    let d = heading((i + 1) % DENSE) - heading(i);
    d = Math.atan2(Math.sin(d), Math.cos(d));
    turn.push(Math.abs(d));
  }
  // Straightness of a window centred on each dense sample.
  const window = Math.max(4, Math.round((150 / length) * DENSE));
  const bend = (c: number): number => {
    let sum = 0;
    for (let o = -window; o <= window; o++) sum += turn[(c + o + DENSE) % DENSE]!;
    return sum;
  };
  const scores = Array.from({ length: DENSE }, (_, i) => bend(i));
  const startIdx = scores.indexOf(Math.min(...scores));
  // Start line a little past the middle of the straightest stretch so the grid sits on it.
  const startDense = (startIdx + Math.round(window * 0.45)) % DENSE;

  // Control points: point 0 ~70 m before the start line.
  const n = spec.points ?? 40;
  const step = DENSE / n;
  const lead = Math.round((70 / length) * DENSE);
  const firstDense = (startDense - lead + DENSE) % DENSE;
  const lapFractionOf = (denseIndex: number): number => (((arc[denseIndex]! - arc[startDense]!) % length) + length) % length / length;
  const points: TrackControlPoint[] = [];
  for (let i = 0; i < n; i++) {
    const di = Math.round(firstDense + i * step) % DENSE;
    const p = pos(thetas[di]!);
    const cp: TrackControlPoint = { pos: [round(p[0]), round(p[1]), round(p[2])] };
    const u = lapFractionOf(di);
    for (const seg of spec.segments ?? []) {
      if (u >= seg.from && u < seg.to) {
        if (seg.kind) cp.kind = seg.kind;
        if (seg.halfWidth) cp.halfWidth = seg.halfWidth;
      }
    }
    points.push(cp);
  }
  const startDistance = (((arc[startDense]! - arc[firstDense]!) % length) + length) % length;

  // Straights for boost pads: local minima of bend away from the start.
  const straights: number[] = [];
  const order = scores.map((s, i) => [s, i] as const).sort((a, b) => a[0] - b[0]);
  for (const [, i] of order) {
    const d = lapFractionOf(i) * length;
    if (d < 120 || d > length - 60) continue;
    if (straights.every((o) => Math.abs(o - d) > length * 0.18)) straights.push(d);
    if (straights.length >= 4) break;
  }

  let inner = Infinity;
  for (let i = 0; i < DENSE; i++) inner = Math.min(inner, Math.hypot(xs[i]!, zs[i]!));

  return {
    points,
    startDistance,
    length,
    straights,
    innerRadius: inner,
    at(fraction: number) {
      const target = (arc[startDense]! + fraction * length) % length;
      let i = arc.findIndex((a) => a >= target);
      if (i < 0) i = 0;
      const [x, y, z] = pos(thetas[i]!);
      return { x, y, z };
    },
  };
}

const round = (v: number): number => Math.round(v * 10) / 10;
