import { Vector3 } from 'three';
import type { TrackPath } from './TrackPath';
import { clamp } from '../math/scalar';

export interface RacingLine {
  /** Lateral offset of the line from the centreline at each sample (m, + = right). */
  lateral: Float32Array;
  /** Signed curvature of the line at each sample (1/m, + = turning right). */
  curvature: Float32Array;
  /** Target speed at each sample (m/s) including braking zones. */
  speed: Float32Array;
}

export interface RacingLineOptions {
  /** Distance kept from the road edge (m). */
  margin: number;
  iterations: number;
  /** Usable lateral acceleration for the speed profile (m/s²). */
  lateralAccel: number;
  /** Braking deceleration used to build braking zones (m/s²). */
  brakeDecel: number;
  /** Speed cap of the profile (m/s). */
  topSpeed: number;
}

const DEFAULTS: RacingLineOptions = { margin: 2.4, iterations: 1500, lateralAccel: 30, brakeDecel: 22, topSpeed: 40 };

const cache = new WeakMap<TrackPath, RacingLine>();

/**
 * Racing line by relaxation towards minimum curvature (each point is pulled to the
 * smooth curve through its neighbours) while staying inside the road. The result
 * runs wide on entry, clips the apex and uses the full width on exit.
 * A speed profile is then derived from the line's curvature with braking zones.
 */
export function computeRacingLine(path: TrackPath, options: Partial<RacingLineOptions> = {}): RacingLine {
  const cached = cache.get(path);
  if (cached && Object.keys(options).length === 0) return cached;
  const o = { ...DEFAULTS, ...options };
  const s = path.samples;
  const n = s.length;
  const lat = new Float32Array(n);
  const px = new Float64Array(n);
  const pz = new Float64Array(n);
  const limit = s.map((x) => Math.max(0, x.halfWidth - o.margin));

  const place = (i: number): void => {
    px[i] = s[i]!.position.x + s[i]!.flatRight.x * lat[i]!;
    pz[i] = s[i]!.position.z + s[i]!.flatRight.z * lat[i]!;
  };
  for (let i = 0; i < n; i++) place(i);

  for (let it = 0; it < o.iterations; it++) {
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n;
      const b = (i + 1) % n;
      const a2 = (i - 2 + n) % n;
      const b2 = (i + 2) % n;
      // Minimum-curvature stencil (zero 4th difference) → smooth out-in-out arcs.
      const mx = (4 * (px[a]! + px[b]!) - px[a2]! - px[b2]!) / 6 - s[i]!.position.x;
      const mz = (4 * (pz[a]! + pz[b]!) - pz[a2]! - pz[b2]!) / 6 - s[i]!.position.z;
      const target = mx * s[i]!.flatRight.x + mz * s[i]!.flatRight.z;
      lat[i] = clamp(lat[i]! + (target - lat[i]!) * 0.6, -limit[i]!, limit[i]!);
      place(i);
    }
  }

  // Curvature of the line from three-point circles (spread out for stability).
  const curvature = new Float32Array(n);
  const k = 3;
  const v1 = new Vector3();
  const v2 = new Vector3();
  for (let i = 0; i < n; i++) {
    const a = (i - k + n) % n;
    const b = (i + k) % n;
    v1.set(px[i]! - px[a]!, 0, pz[i]! - pz[a]!);
    v2.set(px[b]! - px[i]!, 0, pz[b]! - pz[i]!);
    const c = Math.hypot(px[b]! - px[a]!, pz[b]! - pz[a]!);
    const cross = v1.x * v2.z - v1.z * v2.x;
    // Heading +Z turning right (towards -X) gives cross > 0 ⇒ positive curvature.
    curvature[i] = c > 1e-6 ? (2 * cross) / (v1.length() * v2.length() * c) : 0;
  }

  // Speed profile: corner limit, then backward pass for braking zones.
  const speed = new Float32Array(n);
  for (let i = 0; i < n; i++) speed[i] = Math.min(o.topSpeed, Math.sqrt(o.lateralAccel / Math.max(1e-4, Math.abs(curvature[i]!))));
  for (let pass = 0; pass < 2; pass++) {
    for (let i = n - 1; i >= 0; i--) {
      const next = speed[(i + 1) % n]!;
      speed[i] = Math.min(speed[i]!, Math.sqrt(next * next + 2 * o.brakeDecel * path.spacing));
    }
  }

  const line = { lateral: lat, curvature, speed };
  if (Object.keys(options).length === 0) cache.set(path, line);
  return line;
}
