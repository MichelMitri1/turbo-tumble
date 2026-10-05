import { CatmullRomCurve3, Vector3 } from 'three';
import type { SegmentKind, TrackAnchor, TrackDefinition } from '../types/track';
import { clamp, lerp, smoothstep } from '../math/scalar';

export interface TrackSample {
  index: number;
  /** Distance along the spline from control point 0. */
  distance: number;
  position: Vector3;
  tangent: Vector3;
  /** Banked right vector (follows the road surface). */
  right: Vector3;
  /** Banked surface normal. */
  up: Vector3;
  /** Horizontal right vector (no bank). */
  flatRight: Vector3;
  halfWidth: number;
  kind: SegmentKind;
  /** 1 on ground segments, smoothly → 0 on bridges (drives terrain shaping). */
  groundBlend: number;
  /** Lateral offset of the wall from the centerline (same both sides). */
  wallOffset: number;
  bank: number;
  /** Signed curvature (1/m), positive when turning right. */
  curvature: number;
  curb: boolean;
}

export interface TrackLocation {
  index: number;
  /** Fraction towards the next sample. */
  t: number;
  /** Distance along the spline (0..length). */
  splineDistance: number;
  /** Signed lateral offset (positive = right). */
  lateral: number;
  /** Height of the kart above the centerline point. */
  height: number;
  distanceSq: number;
}

export interface TrackFrame {
  position: Vector3;
  tangent: Vector3;
  right: Vector3;
  up: Vector3;
  halfWidth: number;
  wallOffset: number;
  sample: TrackSample;
}

const WORLD_UP = new Vector3(0, 1, 0);
const NARROW_SHOULDER: Record<SegmentKind, number> = { ground: 0, bridge: 0.7, tunnel: 1.1 };
const WALL_TAPER_LENGTH = 36;

export class TrackPath {
  readonly samples: TrackSample[] = [];
  readonly length: number;
  readonly spacing: number;
  readonly startDistance: number;
  readonly curve: CatmullRomCurve3;

  constructor(readonly def: TrackDefinition) {
    const p = def.path;
    this.curve = new CatmullRomCurve3(
      p.points.map((cp) => new Vector3(...cp.pos)),
      true,
      'centripetal',
    );
    this.curve.arcLengthDivisions = p.points.length * 200;
    this.length = this.curve.getLength();
    const count = Math.max(16, Math.round(this.length / p.sampleSpacing));
    this.spacing = this.length / count;
    this.startDistance = ((def.startDistance % this.length) + this.length) % this.length;
    this.buildSamples(count);
  }

  private buildSamples(count: number): void {
    const p = this.def.path;
    const n = p.points.length;
    const groundShoulder: number[] = [];

    for (let i = 0; i < count; i++) {
      const u = i / count;
      const position = this.curve.getPointAt(u);
      const tangent = this.curve.getTangentAt(u).normalize();
      const seg = this.curve.getUtoTmapping(u, 0) * n;
      const i0 = Math.floor(seg) % n;
      const i1 = (i0 + 1) % n;
      const f = smoothstep(0, 1, seg - Math.floor(seg));
      const a = p.points[i0]!;
      const b = p.points[i1]!;
      const halfWidth = lerp(a.halfWidth ?? p.defaultHalfWidth, b.halfWidth ?? p.defaultHalfWidth, f);
      groundShoulder.push(lerp(a.shoulder ?? p.defaultShoulder, b.shoulder ?? p.defaultShoulder, f));
      const manualBank = lerp(a.bank ?? 0, b.bank ?? 0, f);
      const flatRight = new Vector3().crossVectors(tangent, WORLD_UP).normalize();
      this.samples.push({
        index: i,
        distance: i * this.spacing,
        position,
        tangent,
        right: flatRight.clone(),
        up: WORLD_UP.clone(),
        flatRight,
        halfWidth,
        kind: a.kind ?? 'ground',
        groundBlend: 1,
        wallOffset: 0,
        bank: (manualBank * Math.PI) / 180,
        curvature: 0,
        curb: false,
      });
    }

    const s = this.samples;
    // Curvature (signed: + turning right).
    const rawK = s.map((cur, i) => {
      const prev = s[(i - 1 + count) % count]!;
      const next = s[(i + 1) % count]!;
      const dT = next.tangent.clone().sub(prev.tangent).divideScalar(2 * this.spacing);
      return dT.dot(cur.flatRight);
    });
    const k = this.smoothLoop(rawK, 6);

    // Automatic banking: outer edge raised.
    const maxBank = (p.autoBankDeg * Math.PI) / 180;
    const bankGain = maxBank / 0.025;
    const rawBank = s.map((cur, i) => cur.bank + clamp(-k[i]! * bankGain, -maxBank, maxBank));
    const bank = this.smoothLoop(rawBank, 10);

    // Bank strength per segment kind (full on ground, reduced on bridges, none in tunnels),
    // smoothed so the road doesn't twist abruptly at kind boundaries.
    const BANK_BY_KIND: Record<SegmentKind, number> = { ground: 1, bridge: 0.4, tunnel: 0 };
    const bankMul = this.smoothLoop(
      s.map((cur) => BANK_BY_KIND[cur.kind]),
      12,
    );

    // Distance (in samples) to the nearest non-ground sample, for wall taper & terrain blend.
    const distToNarrow = this.distanceToKind((kind) => kind !== 'ground');

    s.forEach((cur, i) => {
      cur.curvature = k[i]!;
      cur.bank = bank[i]! * Math.min(BANK_BY_KIND[cur.kind] === 0 ? 0 : 1, bankMul[i]!);
      cur.right
        .copy(cur.flatRight)
        .multiplyScalar(Math.cos(cur.bank))
        .addScaledVector(WORLD_UP, Math.sin(cur.bank))
        .normalize();
      cur.up.crossVectors(cur.right, cur.tangent).normalize();
      // Bank around the inner edge: the outer edge rises, the inner edge stays at grade.
      cur.position.y += cur.halfWidth * Math.abs(Math.sin(cur.bank));

      const dNarrow = distToNarrow[i]! * this.spacing;
      if (cur.kind === 'ground') {
        const taper = smoothstep(0, WALL_TAPER_LENGTH, dNarrow);
        const narrowKind = this.nearestNarrowKind(i);
        cur.wallOffset = cur.halfWidth + lerp(NARROW_SHOULDER[narrowKind], groundShoulder[i]!, taper);
        cur.groundBlend = smoothstep(0, 18, dNarrow);
      } else {
        cur.wallOffset = cur.halfWidth + NARROW_SHOULDER[cur.kind];
        cur.groundBlend = cur.kind === 'tunnel' ? 1 : 0;
      }
    });
    // Tunnels keep ground under them.
    s.forEach((cur) => {
      if (cur.kind === 'tunnel') cur.groundBlend = 1;
    });

    // Curbs on ground corners (dilated so they lead in/out of the corner).
    const cornerThreshold = 1 / 110;
    const isCorner = s.map((cur) => cur.kind === 'ground' && Math.abs(cur.curvature) > cornerThreshold);
    const dilate = 7;
    s.forEach((cur, i) => {
      if (cur.kind !== 'ground') return;
      for (let d = -dilate; d <= dilate; d++) {
        if (isCorner[(i + d + count) % count]) {
          cur.curb = true;
          return;
        }
      }
    });
  }

  private smoothLoop(values: number[], radius: number): number[] {
    const n = values.length;
    return values.map((_, i) => {
      let sum = 0;
      let w = 0;
      for (let d = -radius; d <= radius; d++) {
        const weight = 1 - Math.abs(d) / (radius + 1);
        sum += values[(i + d + n) % n]! * weight;
        w += weight;
      }
      return sum / w;
    });
  }

  private distanceToKind(pred: (k: SegmentKind) => boolean): number[] {
    const n = this.samples.length;
    const dist = new Array<number>(n).fill(Number.POSITIVE_INFINITY);
    this.samples.forEach((s, i) => {
      if (pred(s.kind)) dist[i] = 0;
    });
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < n * 2; i++) {
        const idx = i % n;
        dist[idx] = Math.min(dist[idx]!, dist[(idx - 1 + n) % n]! + 1);
      }
      for (let i = n * 2; i >= 0; i--) {
        const idx = i % n;
        dist[idx] = Math.min(dist[idx]!, dist[(idx + 1) % n]! + 1);
      }
    }
    return dist;
  }

  private nearestNarrowKind(i: number): SegmentKind {
    const n = this.samples.length;
    for (let d = 0; d < n / 2; d++) {
      const a = this.samples[(i + d) % n]!;
      if (a.kind !== 'ground') return a.kind;
      const b = this.samples[(i - d + n) % n]!;
      if (b.kind !== 'ground') return b.kind;
    }
    return 'ground';
  }

  wrapIndex(i: number): number {
    const n = this.samples.length;
    return ((i % n) + n) % n;
  }

  wrapDistance(d: number): number {
    return ((d % this.length) + this.length) % this.length;
  }

  /** Convert a spline distance to distance along the lap (0 at the start line). */
  lapDistance(splineDistance: number): number {
    return this.wrapDistance(splineDistance - this.startDistance);
  }

  /** Interpolated frame at a spline distance. */
  frameAtSplineDistance(distance: number, out?: TrackFrame): TrackFrame {
    const d = this.wrapDistance(distance);
    const fi = d / this.spacing;
    const i0 = Math.floor(fi) % this.samples.length;
    const i1 = (i0 + 1) % this.samples.length;
    const f = fi - Math.floor(fi);
    const a = this.samples[i0]!;
    const b = this.samples[i1]!;
    const frame: TrackFrame = out ?? {
      position: new Vector3(),
      tangent: new Vector3(),
      right: new Vector3(),
      up: new Vector3(),
      halfWidth: 0,
      wallOffset: 0,
      sample: a,
    };
    frame.position.lerpVectors(a.position, b.position, f);
    frame.tangent.lerpVectors(a.tangent, b.tangent, f).normalize();
    frame.right.lerpVectors(a.right, b.right, f).normalize();
    frame.up.lerpVectors(a.up, b.up, f).normalize();
    frame.halfWidth = lerp(a.halfWidth, b.halfWidth, f);
    frame.wallOffset = lerp(a.wallOffset, b.wallOffset, f);
    frame.sample = f < 0.5 ? a : b;
    return frame;
  }

  /** Resolve a track-space anchor (lap distance + lateral + height) to world space. */
  anchorToWorld(anchor: TrackAnchor): TrackFrame {
    const frame = this.frameAtSplineDistance(this.startDistance + anchor.distance);
    frame.position
      .addScaledVector(frame.right, anchor.lateral ?? 0)
      .addScaledVector(frame.up, anchor.height ?? 0);
    return frame;
  }

  /**
   * Find where a world position is relative to the track. With a hint index only a
   * window of samples is searched (cheap per-tick tracking); without, the whole lap.
   */
  locate(pos: Vector3, hint = -1, window = 40, out?: TrackLocation): TrackLocation {
    const n = this.samples.length;
    let best = -1;
    let bestD = Number.POSITIVE_INFINITY;
    const from = hint >= 0 ? -window : 0;
    const to = hint >= 0 ? window : n - 1;
    for (let o = from; o <= to; o++) {
      const i = hint >= 0 ? (hint + o + n) % n : o;
      const sp = this.samples[i]!.position;
      const dx = pos.x - sp.x;
      const dy = (pos.y - sp.y) * 1.5;
      const dz = pos.z - sp.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    // Refine on the segment towards whichever neighbour the point projects onto.
    const s = this.samples[best]!;
    const rel = tmp.copy(pos).sub(s.position);
    let along = rel.dot(s.tangent);
    let index = best;
    if (along < 0) {
      index = (best - 1 + n) % n;
      along += this.spacing;
    }
    const t = clamp(along / this.spacing, 0, 1);
    const base = this.samples[index]!;
    const result: TrackLocation = out ?? {
      index: 0,
      t: 0,
      splineDistance: 0,
      lateral: 0,
      height: 0,
      distanceSq: 0,
    };
    result.index = index;
    result.t = t;
    result.splineDistance = this.wrapDistance(base.distance + t * this.spacing);
    result.lateral = rel.dot(s.flatRight);
    result.height = pos.y - s.position.y;
    result.distanceSq = bestD;
    return result;
  }

  /** World-space bounds of the centerline expanded by the widest wall. */
  bounds(): { minX: number; maxX: number; minZ: number; maxZ: number } {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const s of this.samples) {
      minX = Math.min(minX, s.position.x - s.wallOffset);
      maxX = Math.max(maxX, s.position.x + s.wallOffset);
      minZ = Math.min(minZ, s.position.z - s.wallOffset);
      maxZ = Math.max(maxZ, s.position.z + s.wallOffset);
    }
    return { minX, maxX, minZ, maxZ };
  }

  /** Contiguous runs of samples matching a predicate: [start, endInclusive] (may wrap). */
  runs(pred: (s: TrackSample) => boolean): Array<[number, number]> {
    const n = this.samples.length;
    const flags = this.samples.map(pred);
    if (flags.every(Boolean)) return [[0, n]];
    const out: Array<[number, number]> = [];
    // Start scanning just after a non-matching sample so wrapping runs stay whole.
    const startAt = flags.findIndex((f) => !f);
    let runStart = -1;
    for (let k = 1; k <= n; k++) {
      const i = (startAt + k) % n;
      if (flags[i] && runStart < 0) runStart = i;
      if (!flags[i] && runStart >= 0) {
        out.push([runStart, (i - 1 + n) % n]);
        runStart = -1;
      }
    }
    if (runStart >= 0) out.push([runStart, (startAt - 1 + n) % n]);
    return out;
  }

  /** Sample indices of a run in order (handles wrap; [0, n] means the full closed loop). */
  runIndices(run: [number, number]): number[] {
    const n = this.samples.length;
    const [a, b] = run;
    if (b === n) {
      const all = Array.from({ length: n }, (_, i) => i);
      all.push(0);
      return all;
    }
    const out: number[] = [];
    const len = ((b - a + n) % n) + 1;
    for (let k = 0; k < len; k++) out.push((a + k) % n);
    return out;
  }
}

const tmp = new Vector3();
