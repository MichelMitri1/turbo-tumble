import { Matrix4, Quaternion, Vector3 } from 'three';
import { armJoints, type LiveArm, type V3 } from '../sim/arm';
import type { Hand } from './swing';

/**
 * Camera-estimated racket arm → the player's arm (motion play).
 *
 * Accuracy: the pose model's 2D image points are far more precise than its 3D guess, so each arm
 * segment's direction takes its across/up components from the image (scaled to metres by your torso)
 * and only its depth from your arm's known length (√(L² − 2D²)), the model choosing in front or behind.
 * The racket's angle comes from the hand tracker (21 points: the knuckles fix the hand's orientation
 * even round a grip), through a per-player calibration (hold the racket straight up once).
 *
 * Clean + responsive: One Euro filters (still when you're still, no lag when you swing), velocities
 * on the camera's own frame clock, and a short prediction that covers the camera's lag and draws the
 * arm smoothly between camera frames. Racket rotation uses quaternion smoothing without prediction.
 */

/** One Euro filter (Casiez et al. 2012). */
class OneEuro {
  private x: number | null = null;
  private dx = 0;
  constructor(
    public minCutoff: number,
    public beta: number,
    private readonly dCutoff = 1.2,
  ) {}
  private static alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
  filter(v: number, dt: number): number {
    if (this.x === null) {
      this.x = v;
      return v;
    }
    const d = (v - this.x) / dt;
    this.dx += (d - this.dx) * OneEuro.alpha(this.dCutoff, dt);
    this.x += (v - this.x) * OneEuro.alpha(this.minCutoff + this.beta * Math.abs(this.dx), dt);
    return this.x;
  }
}

export type Smoothing = 'responsive' | 'balanced' | 'smooth';
/** Tuning hook (tools): override a preset. */
export function tunePreset(s: Smoothing, v: Partial<{ min: number; beta: number; lead: number; rate: number }>): void {
  Object.assign(PRESET[s], v);
}
const PRESET: Record<Smoothing, { min: number; beta: number; lead: number; rate: number }> = {
  // Tuned with a synthetic benchmark (circles + camera noise + lag): error vs the real arm, moving / still.
  responsive: { min: 1.2, beta: 28, lead: 1.15, rate: 0.85 },
  balanced: { min: 1.4, beta: 18, lead: 1.0, rate: 0.8 },
  smooth: { min: 0.9, beta: 10, lead: 0.8, rate: 0.7 },
};

/** The racket in the hand's own frame (from calibration): shaft and face normal. */
export interface RacketCal {
  dir: V3;
  normal: V3;
}

export interface PoseIn {
  image: Float32Array;
  world: Float32Array;
}
export interface HandIn {
  image: Float32Array;
  world: Float32Array;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const mix = (...terms: Array<[V3, number]>): V3 => terms.reduce<V3>((s, [v, k]) => [s[0] + v[0] * k, s[1] + v[1] * k, s[2] + v[2] * k], [0, 0, 0]);
const ok = (v: V3) => Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2]);

/** Pose landmarks used (left, right). */
const SH = [11, 12];
const EL = [13, 14];
const WR = [15, 16];

interface Sample {
  yaw: number;
  upper: V3;
  fore: V3;
  dir: V3;
  normal: V3;
}

export class ArmTracker {
  hand: Hand = 'right';
  smoothing: Smoothing = 'balanced';
  /** Calibrated racket-in-hand (null = a typical padel grip). */
  cal: RacketCal | null = null;
  /** Pipeline lag estimate (s): detection + half a frame + display. */
  latency = 0.05;
  /** Is the hand tracker seeing the racket hand? */
  handSeen = false;
  /** For the preview: the racket line in image coords (wrist → tip), or null. */
  racket2d: [number, number, number, number] | null = null;

  private readonly f = new Map<string, OneEuro>();
  private lastT = 0;
  private seenAt = 0;
  private arrival = 0;
  private k = 0;
  private lu = 0;
  private lf = 0;
  private signU = 1;
  private signF = 1;
  private s: Sample | null = null;
  private ds: Sample = { yaw: 0, upper: [0, 0, 0], fore: [0, 0, 0], dir: [0, 0, 0], normal: [0, 0, 0] };
  private prevHead: V3 | null = null;
  private vel: V3 = [0, 0, 0];
  private basis: [V3, V3, V3] | null = null;
  private rotation: Quaternion | null = null;
  private candidate: Quaternion | null = null;
  private handAt = 0;
  private calib: { until: number; started: number; last: number; dir: V3; normal: V3; n: number; done: (ok: boolean) => void } | null = null;

  private filt(key: string, v: number, dt: number, kind: 'img' | 'z' | 'vec'): number {
    const p = PRESET[this.smoothing];
    let fl = this.f.get(key);
    const min = kind === 'z' ? p.min * 0.6 : p.min;
    const beta = kind === 'img' ? p.beta : kind === 'z' ? p.beta * 0.35 : p.beta * 0.22;
    if (!fl) this.f.set(key, (fl = new OneEuro(min, beta)));
    fl.minCutoff = min;
    fl.beta = beta;
    return fl.filter(v, dt);
  }

  /** One camera frame: t = frame time (s, camera clock), arrival = when it got to us (ms, performance.now). */
  feed(t: number, arrival: number, aspect: number, pose: PoseIn, handLm: HandIn | null): void {
    if (!Number.isFinite(t) || !Number.isFinite(aspect) || aspect <= 0) return;
    if (this.lastT && t <= this.lastT) return;
    if (this.lastT && t - this.lastT > 0.25) this.reset();
    const dt = this.lastT && t > this.lastT ? Math.min(0.2, t - this.lastT) : 1 / 30;
    this.lastT = t;
    const side = this.hand === 'left' ? 0 : 1;
    const img = (i: number, key: string): [number, number] | null => {
      if (!(pose.image[i * 4 + 3]! >= 0.5) ||
          !ok([pose.image[i * 4]!, pose.image[i * 4 + 1]!, pose.world[i * 4 + 2]!]) ||
          !ok(w3(i))) return null;
      return [this.filt(`${key}x`, pose.image[i * 4]! * aspect, dt, 'img'), this.filt(`${key}y`, pose.image[i * 4 + 1]!, dt, 'img')];
    };
    const wz = (i: number, key: string) => this.filt(`${key}z`, pose.world[i * 4 + 2]!, dt, 'z');
    const w3 = (i: number): V3 => [pose.world[i * 4]!, pose.world[i * 4 + 1]!, pose.world[i * 4 + 2]!];
    const sh = img(SH[side]!, 'sh');
    const osh = img(SH[1 - side]!, 'osh');
    const el = img(EL[side]!, 'el');
    const wr = img(WR[side]!, 'wr');
    if (!sh || !osh || !el || !wr) {
      this.stale(t);
      return;
    }
    const zs = wz(SH[side]!, 'sh');
    const zo = wz(SH[1 - side]!, 'osh');
    const ze = wz(EL[side]!, 'el');
    const zw = wz(WR[side]!, 'wr');
    // Metres per image unit, from the torso (shoulders → hips: upright, so barely foreshortened).
    const hl = pose.image[23 * 4 + 3]! > 0.3 && pose.image[24 * 4 + 3]! > 0.3;
    if (hl) {
      const im = (i: number) => [pose.image[i * 4]! * aspect, pose.image[i * 4 + 1]!] as const;
      const midI = (a: number, b: number) => [(im(a)[0] + im(b)[0]) / 2, (im(a)[1] + im(b)[1]) / 2];
      const [sx, sy] = midI(11, 12);
      const [hx, hy] = midI(23, 24);
      const imgT = Math.hypot(sx! - hx!, sy! - hy!);
      const wm = (a: number, b: number): V3 => {
        const p = w3(a);
        const q = w3(b);
        return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2];
      };
      const worldT = len(sub(wm(11, 12), wm(23, 24)));
      if (imgT > 0.05 && worldT > 0.2) this.k = this.k ? this.k + (worldT / imgT - this.k) * 0.04 : worldT / imgT;
    }
    if (!this.k) {
      this.stale(t);
      return;
    }
    const k = this.k;
    // Image → body frame (metres): your right is image −x, up is −y; depth from the model (towards you = −z).
    const d2 = (a: [number, number], b: [number, number]): [number, number] => [-(b[0] - a[0]) * k, -(b[1] - a[1]) * k];
    // Segment lengths: the model's 3D lengths, never shorter than what the image shows.
    const segLen = (L: number, world: number, flat: number) => {
      const target = Math.max(world, flat);
      return L ? L + (target - L) * (flat > L ? 0.3 : 0.03) : target;
    };
    const uFlat = d2(sh, el);
    const fFlat = d2(el, wr);
    this.lu = segLen(this.lu, len(sub(w3(EL[side]!), w3(SH[side]!))), Math.hypot(...uFlat));
    this.lf = segLen(this.lf, len(sub(w3(WR[side]!), w3(EL[side]!))), Math.hypot(...fFlat));
    const seg = (flat: [number, number], L: number, dzModel: number, which: 'u' | 'f'): V3 => {
      const m2 = flat[0] * flat[0] + flat[1] * flat[1];
      const mag = Math.sqrt(Math.max(0, L * L - m2));
      // In front or behind: the model decides, with hysteresis so it doesn't flicker.
      let sign = which === 'u' ? this.signU : this.signF;
      if (dzModel > 0.12 * L) sign = 1;
      else if (dzModel < -0.12 * L) sign = -1;
      if (which === 'u') this.signU = sign;
      else this.signF = sign;
      const depth = 0.75 * sign * mag + 0.25 * Math.max(-L, Math.min(L, dzModel));
      return unit([flat[0], flat[1], this.filt(`${which}Depth`, depth, dt, 'z')]);
    };
    const upper = seg(uFlat, this.lu, -(ze - zs), 'u');
    const fore = seg(fFlat, this.lf, -(zw - ze), 'f');
    // Shoulder turn: across (from the image) vs depth (from the model) of the shoulder line.
    const L = side === 1 ? osh : sh;
    const R = side === 1 ? sh : osh;
    const zL = side === 1 ? zo : zs;
    const zR = side === 1 ? zs : zo;
    const across = -(R[0] - L[0]) * k;
    const yaw = Math.max(-1.1, Math.min(1.1, Math.atan2(zR - zL, Math.max(0.05, across))));
    // A palm frame is usable only when its two measured axes are non-degenerate.
    this.handSeen = false;
    this.basis = null;
    if (handLm) {
      const hp = (i: number): V3 => [-handLm.world[i * 3]!, -handLm.world[i * 3 + 1]!, -handLm.world[i * 3 + 2]!];
      const acrossHand = sub(hp(5), hp(17));
      const alongHand = sub(hp(9), hp(0));
      const area = len(cross(acrossHand, alongHand));
      if (ok(acrossHand) && ok(alongHand) && len(acrossHand) > 0.015 && len(alongHand) > 0.02 &&
          area / (len(acrossHand) * len(alongHand)) > 0.25) {
        const ay = unit(alongHand);
        const az = unit(cross(acrossHand, ay));
        const ax = unit(cross(ay, az));
        const basis: [V3, V3, V3] = [ax, ay, az];
        const c = this.cal ?? DEFAULT_CAL;
        const dir = unit(mix([ax, c.dir[0]], [ay, c.dir[1]], [az, c.dir[2]]));
        const face = mix([ax, c.normal[0]], [ay, c.normal[1]], [az, c.normal[2]]);
        const normal = unit(sub(face, mix([dir, dot(face, dir)])));
        if (ok(dir) && ok(normal) && len(normal) > 0.5) {
          const q = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(
            new Vector3(...cross(dir, normal)), new Vector3(...dir), new Vector3(...normal),
          ));
          // Reject isolated large model flips; accept a consistent new orientation on the next frame.
          const jump = this.rotation?.angleTo(q) ?? 0;
          const consistent = this.candidate !== null && this.candidate.angleTo(q) < 0.35;
          if (jump < 1.2 || consistent) {
            this.handSeen = true;
            this.handAt = arrival;
            this.basis = basis;
            if (this.calib) this.calibSample();
            if (!this.rotation) this.rotation = q;
            else {
              const cutoff = this.smoothing === 'smooth' ? 3 : this.smoothing === 'responsive' ? 8 : 5;
              // Slerp preserves a rigid orthogonal frame, even through a 180-degree rotation.
              const alpha = 1 - Math.exp(-2 * Math.PI * (cutoff + Math.min(8, jump / dt * 0.15)) * dt);
              this.rotation.slerp(q, alpha);
            }
          }
          this.candidate = q;
        }
      }
    }
    if (!this.handSeen && this.calib) {
      this.calib.n = 0;
      this.calib.dir = [0, 0, 0];
      this.calib.normal = [0, 0, 0];
    }
    // Occlusion: hold the last reliable rotation rather than switch to a different grip model.
    const dir: V3 = this.rotation ? new Vector3(0, 1, 0).applyQuaternion(this.rotation).toArray() as V3 : fore;
    const normal: V3 = this.rotation ? new Vector3(0, 0, 1).applyQuaternion(this.rotation).toArray() as V3 :
      unit(cross(unit(cross(dir, Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), dir));
    const s: Sample = { yaw, upper, fore, dir, normal };
    // Rates (for prediction) and the racket head's velocity, on the camera's clock.
    const prev = this.s;
    if (prev) {
      const kr = PRESET[this.smoothing].rate;
      const r = (a: V3, b: V3, o: V3): V3 => [0, 1, 2].map((i) => o[i]! + ((a[i]! - b[i]!) / dt - o[i]!) * kr) as V3;
      this.ds = { yaw: this.ds.yaw + ((yaw - prev.yaw) / dt - this.ds.yaw) * kr, upper: r(upper, prev.upper, this.ds.upper), fore: r(fore, prev.fore, this.ds.fore), dir: r(dir, prev.dir, this.ds.dir), normal: r(normal, prev.normal, this.ds.normal) };
    }
    this.s = s;
    const head = armJoints({ side: side === 1 ? 1 : 2, ...s, vel: [0, 0, 0] }).head;
    if (this.prevHead) {
      const v = sub(head, this.prevHead).map((x) => x / dt) as V3;
      this.vel = [0, 1, 2].map((i) => this.vel[i]! + (v[i]! - this.vel[i]!) * 0.7) as V3;
    }
    this.prevHead = head;
    this.seenAt = t;
    this.arrival = arrival;
    // Preview: the racket line from the wrist, in image coords.
    const wx = wr[0] / aspect;
    const tipLen = 0.45 / k;
    this.racket2d = [wx, wr[1], wx - (dir[0] * tipLen) / aspect, wr[1] - dir[1] * tipLen];
  }

  /** The arm now: the last camera sample carried forward over the lag (and between frames). */
  predict(now: number): LiveArm | null {
    const s = this.s;
    if (!s) return null;
    const age = Math.max(0, (now - this.arrival) / 1000);
    if (now - this.handAt > 150) this.handSeen = false;
    if (age > 0.4) return null;
    // Look ahead by the lag (a share of it, per the smoothing), never far past the last frame.
    const ahead = Math.min(0.05, age + this.latency * PRESET[this.smoothing].lead) * (age > 0.12 ? Math.max(0, 1 - (age - 0.12) * 6) : 1);
    const go = (v: V3, d: V3): V3 => unit([v[0] + d[0] * ahead, v[1] + d[1] * ahead, v[2] + d[2] * ahead]);
    // Camera-derived wrist rotation is too ambiguous to extrapolate safely.
    let dir = s.dir;
    let normal = s.normal;
    normal = unit(sub(normal, dir.map((x) => x * dot(normal, dir)) as V3));
    if (!ok(normal)) normal = s.normal;
    if (!ok(dir)) dir = s.dir;
    return {
      side: this.hand === 'left' ? 2 : 1,
      yaw: Math.max(-1.1, Math.min(1.1, s.yaw + this.ds.yaw * ahead)),
      upper: go(s.upper, this.ds.upper),
      fore: go(s.fore, this.ds.fore),
      dir,
      normal,
      vel: [...this.vel],
    };
  }

  /** Calibrate the racket in the hand: hold it straight up, face to the screen, for two seconds. */
  calibrate(done: (ok: boolean) => void): void {
    this.calib?.done(false);
    const now = performance.now();
    const calibration = { until: now + 1800, started: now, last: now, dir: [0, 0, 0] as V3, normal: [0, 0, 0] as V3, n: 0, done };
    this.calib = calibration;
    setTimeout(() => {
      const c = this.calib;
      if (c !== calibration) return;
      this.calib = null;
      if (c.n < 12 || c.last - c.started < 650 || performance.now() - c.last > 300 ||
          len(c.dir) / c.n < 0.98 || len(c.normal) / c.n < 0.98) return done(false);
      const dir = unit(c.dir);
      const normal = unit(sub(c.normal, mix([dir, dot(c.normal, dir)])));
      if (!ok(normal) || len(normal) < 0.5) return done(false);
      this.cal = { dir, normal };
      this.rotation = null;
      this.candidate = null;
      this.prevHead = null;
      this.vel = [0, 0, 0];
      done(true);
    }, 1900);
  }

  private calibSample(): void {
    const c = this.calib!;
    const b = this.basis;
    if (!b || performance.now() > c.until) return;
    // The true racket: shaft up, face towards the screen. In the hand's frame:
    const up: V3 = [0, 1, 0];
    const fwd: V3 = [0, 0, 1];
    const local = (v: V3): V3 => [dot(v, b[0]), dot(v, b[1]), dot(v, b[2])];
    const d = local(up);
    const n = local(fwd);
    const now = performance.now();
    // Require a contiguous still hold; moving or losing the hand restarts the sample window.
    if (c.n && (now - c.last > 200 || dot(d, unit(c.dir)) < 0.97 || dot(n, unit(c.normal)) < 0.97)) {
      c.n = 0;
      c.dir = [0, 0, 0];
      c.normal = [0, 0, 0];
    }
    if (!c.n) c.started = now;
    c.last = now;
    c.dir = [c.dir[0] + d[0], c.dir[1] + d[1], c.dir[2] + d[2]];
    c.normal = [c.normal[0] + n[0], c.normal[1] + n[1], c.normal[2] + n[2]];
    c.n++;
  }

  /** Lost sight of the arm: hold the last pose briefly (prediction stops), then let go. */
  private stale(t: number): void {
    this.handSeen = false;
    this.basis = null;
    if (this.calib) {
      this.calib.n = 0;
      this.calib.dir = [0, 0, 0];
      this.calib.normal = [0, 0, 0];
    }
    this.ds = { yaw: 0, upper: [0, 0, 0], fore: [0, 0, 0], dir: [0, 0, 0], normal: [0, 0, 0] };
    this.vel = [0, 0, 0];
    this.prevHead = null;
    if (t - this.seenAt > 0.5) this.reset(false);
  }

  reset(clearCal = false): void {
    this.calib?.done(false);
    this.calib = null;
    this.s = null;
    this.ds = { yaw: 0, upper: [0, 0, 0], fore: [0, 0, 0], dir: [0, 0, 0], normal: [0, 0, 0] };
    this.rotation = null;
    this.candidate = null;
    this.basis = null;
    this.handAt = 0;
    this.k = this.lu = this.lf = 0;
    this.signU = this.signF = 1;
    this.prevHead = null;
    this.vel = [0, 0, 0];
    this.f.clear();
    this.lastT = 0;
    this.handSeen = false;
    this.racket2d = null;
    if (clearCal) this.cal = null;
  }
}

/** A typical padel grip: the racket leaves the hand on the index side, tilted towards the fingers. */
const DEFAULT_CAL: RacketCal = { dir: unit([0.75, 0.62, 0]), normal: [0, 0, 1] };
