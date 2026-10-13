import type { Stroke } from '../sim/match';

/**
 * A real swing → a stroke. Fed one pose per camera frame (MediaPipe's metric "world" landmarks,
 * centred on the hips, so stepping about doesn't count as swinging):
 *   speed      the racket hand's 3D speed at its fastest (≈ the hit) is the power
 *   direction  the way the hand is travelling at that moment is where the ball goes — sweep across
 *              your body for cross court, push through towards the screen for straight
 *   lob        a swing travelling mostly upwards (from low) is a lob
 * A backswing (the hand going back, away from the screen) is ignored; a stroke that's early waits
 * for the ball (`hold`) — the sim's timing assist absorbs the camera's lag.
 */
export interface Lm {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

export type Hand = 'right' | 'left' | 'auto';

/** MediaPipe pose landmark indices. */
export const P = { nose: 0, lShoulder: 11, rShoulder: 12, lElbow: 13, rElbow: 14, lWrist: 15, rWrist: 16, lHip: 23, rHip: 24 } as const;

/** Wrist speed (m/s) where a swing starts and where it's full power, at sensitivity 1. */
const START = 1.7;
const FULL = 6;
/** How early (s) a camera stroke may be and still wait for the ball. */
export const CAMERA_HOLD = 0.75;

interface Sample {
  t: number;
  x: number;
  y: number;
  z: number;
}

export interface CameraStroke extends Stroke {
  /** Peak hand speed (m/s), for the practice meter. */
  speed: number;
  hand: 'right' | 'left';
}

export class SwingDetector {
  hand: Hand = 'right';
  sens = 1;
  /** Live speed (m/s) of the racket hand, for the meter. */
  speed = 0;
  /** Last stroke and when (performance.now ms). */
  last: CameraStroke | null = null;
  lastAt = 0;
  private prev: [Sample | null, Sample | null] = [null, null];
  private vel: [[number, number, number], [number, number, number]] = [
    [0, 0, 0],
    [0, 0, 0],
  ];
  private stroke: { w: 0 | 1; peak: number; at: [number, number, number]; t0: number; y0: number; shoulderY: number } | null = null;
  private cool = 0;

  /** One camera frame (t in seconds). Returns a stroke when one finishes. */
  feed(t: number, world: Lm[]): CameraStroke | null {
    const ls = world[P.lShoulder];
    const rs = world[P.rShoulder];
    if (!ls || !rs) return null;
    let best = -1;
    let bestW: 0 | 1 = 1;
    for (const w of [0, 1] as const) {
      const lm = world[w === 0 ? P.lWrist : P.rWrist];
      if (!lm || (lm.visibility ?? 1) < 0.25) {
        this.prev[w] = null;
        continue;
      }
      const p = this.prev[w];
      this.prev[w] = { t, x: lm.x, y: lm.y, z: lm.z };
      if (!p) continue;
      const dt = t - p.t;
      if (dt <= 0.004 || dt > 0.2) continue;
      // Light smoothing: landmarks jitter frame to frame.
      const v = this.vel[w];
      const k = 0.7;
      v[0] += ((lm.x - p.x) / dt - v[0]) * k;
      v[1] += ((lm.y - p.y) / dt - v[1]) * k;
      v[2] += ((lm.z - p.z) / dt - v[2]) * k;
      const sp = Math.hypot(v[0], v[1], v[2]);
      const allowed = this.hand === 'auto' || (this.hand === 'right' ? w === 1 : w === 0);
      if (allowed && sp > best) {
        best = sp;
        bestW = w;
      }
    }
    if (best < 0) return null;
    const w = this.stroke ? this.stroke.w : bestW;
    const v = this.vel[w];
    const sp = Math.hypot(v[0], v[1], v[2]);
    this.speed = sp;
    const start = START / this.sens;
    if (this.cool > t) return null;
    if (!this.stroke) {
      if (sp > start) {
        const lm = world[w === 0 ? P.lWrist : P.rWrist]!;
        this.stroke = { w, peak: 0, at: [0, 0, 0], t0: t, y0: lm.y, shoulderY: (ls.y + rs.y) / 2 };
      } else return null;
    }
    const s = this.stroke;
    if (sp > s.peak) {
      s.peak = sp;
      s.at = [v[0], v[1], v[2]];
    }
    // The stroke ends once the hand has clearly slowed past its peak (or it's gone on too long).
    if (sp > Math.max(start * 0.6, s.peak * 0.55) && t - s.t0 < 0.55) return null;
    this.stroke = null;
    this.cool = t + 0.22;
    return this.finish(s, ls, rs, start);
  }

  private finish(s: NonNullable<SwingDetector['stroke']>, ls: Lm, rs: Lm, start: number): CameraStroke | null {
    // Body frame: right = left shoulder → right shoulder (flattened), forward = towards the camera.
    let rx = rs.x - ls.x;
    let rz = rs.z - ls.z;
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl;
    rz /= rl;
    // Towards the camera is −z; forward ⟂ right, pointing at the camera.
    let fx = rz;
    let fz = -rx;
    if (fz > 0) {
      fx = -fx;
      fz = -fz;
    }
    const [vx, vy, vz] = s.at;
    const lat = vx * rx + vz * rz;
    // Monocular depth is under-estimated: give the push towards the screen a little more weight.
    const fwd = (vx * fx + vz * fz) * 1.5;
    const up = -vy;
    // A backswing (hand going away from the screen, not upwards) isn't a stroke.
    if (fwd < -0.45 * s.peak && up < 0.4 * s.peak) return null;
    // The mirror image: MediaPipe's x is the image's, which for a camera facing you is your left —
    // `right` above is built from the shoulders, so it's already your right.
    const ang = Math.atan2(lat, Math.max(0.35 * Math.hypot(lat, fwd), fwd));
    const aim = Math.max(-1, Math.min(1, ang / ((55 * Math.PI) / 180)));
    const a = (aim * 40 * Math.PI) / 180;
    const power = Math.max(0.05, Math.min(1, (s.peak - start) / (FULL / this.sens - start)));
    // Lob: a mostly upward swing that started below the shoulders.
    const lob = up > 0.62 * s.peak && s.y0 > s.shoulderY + 0.15;
    const st: CameraStroke = { dx: Math.sin(a), dy: -Math.cos(a), power, lob, hold: CAMERA_HOLD, speed: s.peak, hand: s.w === 1 ? 'right' : 'left' };
    this.last = st;
    this.lastAt = performance.now();
    return st;
  }

  reset(): void {
    this.prev = [null, null];
    this.stroke = null;
    this.speed = 0;
  }
}
