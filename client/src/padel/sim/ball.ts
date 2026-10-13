import { COURT, PANELS, netHeight, type Material } from './court';

/**
 * The padel ball: 6.6 cm, 57 g, a little softer than a tennis ball. Air drag and spin (Magnus);
 * bounces on the sand-filled turf (a drop from 2.54 m comes back up ~1.4 m), lively off the glass,
 * dead and a bit random off the mesh; the net stops it.
 */
export const BALL_R = 0.033;
const G = 9.81;
/** Drag: ½ρC_dA/m (1/m). */
const DRAG = 0.0195;
/** Magnus: acceleration per (ω × v), and how fast the spin dies away (1/s). */
const MAGNUS = 0.0011;
const SPIN_DECAY = 0.25;
/** Bounce: normal restitution and the tangential speed kept, per surface. */
const FLOOR = { e: 0.78, keep: 0.8 };
const GLASS = { e: 0.68, keep: 0.9 };
const MESH = { e: 0.32, keep: 0.6 };

export type BallEvent =
  | { k: 'floor'; x: number; z: number; speed: number }
  | { k: 'wall'; mat: Material; side: 0 | 1; x: number; y: number; z: number; speed: number }
  | { k: 'net'; x: number; y: number; speed: number }
  | { k: 'out'; x: number; y: number; z: number };

export interface BallState {
  pos: [number, number, number];
  vel: [number, number, number];
  spin: [number, number, number];
}

export class Ball {
  readonly pos = [0, 1, 0] as [number, number, number];
  readonly vel = [0, 0, 0] as [number, number, number];
  /** Angular velocity (rad/s): topspin on a ball going +z is about +x (the top of the ball turns forward). */
  readonly spin = [0, 0, 0] as [number, number, number];
  /** Out of the cage (gone for good until the next point). */
  out = false;
  /** Random source for the mesh's uneven bounces (seeded by the match). */
  rand: () => number = Math.random;

  set(s: BallState): void {
    this.pos.splice(0, 3, ...s.pos);
    this.vel.splice(0, 3, ...s.vel);
    this.spin.splice(0, 3, ...s.spin);
    this.out = false;
  }

  copyTo(o: Ball): void {
    o.pos.splice(0, 3, ...this.pos);
    o.vel.splice(0, 3, ...this.vel);
    o.spin.splice(0, 3, ...this.spin);
    o.out = this.out;
  }

  /** One step: forces, then collisions (floor, walls, net) found by crossing the surfaces in between. */
  step(dt: number, events: BallEvent[] | null): void {
    if (this.out) return;
    const p = this.pos;
    const v = this.vel;
    const w = this.spin;
    const speed = Math.hypot(v[0], v[1], v[2]);
    // Drag, Magnus (ω × v), gravity.
    const ax = -DRAG * speed * v[0] + MAGNUS * (w[1] * v[2] - w[2] * v[1]);
    const ay = -DRAG * speed * v[1] + MAGNUS * (w[2] * v[0] - w[0] * v[2]) - G;
    const az = -DRAG * speed * v[2] + MAGNUS * (w[0] * v[1] - w[1] * v[0]);
    v[0] += ax * dt;
    v[1] += ay * dt;
    v[2] += az * dt;
    const decay = Math.exp(-SPIN_DECAY * dt);
    w[0] *= decay;
    w[1] *= decay;
    w[2] *= decay;
    const ox = p[0], oy = p[1], oz = p[2];
    p[0] += v[0] * dt;
    p[1] += v[1] * dt;
    p[2] += v[2] * dt;

    // Net: crossing z = 0 below the band.
    if ((oz < 0) !== (p[2] < 0) && Math.abs(p[0]) <= COURT.halfW) {
      const f = oz / (oz - p[2]);
      const y = oy + (p[1] - oy) * f;
      const x = ox + (p[0] - ox) * f;
      const h = netHeight(x);
      if (y < h + BALL_R * 0.4) {
        const sp = Math.hypot(v[0], v[1], v[2]);
        // Clipped the tape near the top: it can roll over, slowed right down; otherwise it drops back.
        const over = y > h - BALL_R * 1.2 && this.rand() < 0.45;
        if (over) {
          v[0] *= 0.35;
          v[2] *= 0.2;
          v[1] = Math.abs(v[1]) * 0.3 + 0.6;
        } else {
          p[2] = Math.sign(oz || -v[2]) * (BALL_R + 0.005);
          v[2] *= -0.08;
          v[0] *= 0.3;
          v[1] *= 0.3;
        }
        events?.push({ k: 'net', x, y, speed: sp });
      }
    }

    // Walls and fences: a panel crossed (ball surface hits its plane) inside its span.
    for (const pan of PANELS) {
      const i = pan.axis === 'x' ? 0 : 2;
      const j = pan.axis === 'x' ? 2 : 0;
      const plane = pan.at + pan.normal * BALL_R;
      const before = (i === 0 ? ox : oz) - plane;
      const after = p[i] - plane;
      if (before * pan.normal < 0 || after * pan.normal >= 0) continue; // must go from inside to past it
      const f = before / (before - after);
      const y = oy + (p[1] - oy) * f;
      const along = (j === 0 ? ox : oz) + (p[j] - (j === 0 ? ox : oz)) * f;
      if (along < pan.from || along > pan.to || y < pan.y0 || y > pan.y1) continue;
      const sp = Math.hypot(v[0], v[1], v[2]);
      const k = pan.mat === 'glass' ? GLASS : MESH;
      p[i] = plane + pan.normal * 0.001;
      v[i] = -v[i] * k.e;
      v[j] *= k.keep;
      v[1] *= k.keep;
      if (pan.mat === 'mesh') {
        // The mesh gives: uneven, a little random.
        v[j] += (this.rand() - 0.5) * 0.25 * sp;
        v[1] += (this.rand() - 0.5) * 0.15 * sp;
      }
      w[0] *= 0.5;
      w[1] *= 0.5;
      w[2] *= 0.5;
      events?.push({ k: 'wall', mat: pan.mat, side: p[2] < 0 ? 0 : 1, x: p[0], y, z: p[2], speed: sp });
    }

    // Floor (inside the cage): bounce with spin — topspin kicks it on, backspin checks it.
    if (p[1] < BALL_R && v[1] < 0) {
      const inside = Math.abs(p[0]) <= COURT.halfW && Math.abs(p[2]) <= COURT.halfL;
      const sp = Math.hypot(v[0], v[1], v[2]);
      p[1] = BALL_R;
      v[1] = -v[1] * FLOOR.e;
      // Spin at the contact point turns into a push along the ground (and the spin is partly used up).
      // The contact point moves at ω × (0, −R, 0) = (ω_z R, 0, −ω_x R); friction pushes the ball the other way.
      const sx = -w[2] * BALL_R;
      const sz = w[0] * BALL_R;
      v[0] = v[0] * FLOOR.keep + sx * 0.25;
      v[2] = v[2] * FLOOR.keep + sz * 0.25;
      w[0] *= 0.6;
      w[1] *= 0.8;
      w[2] *= 0.6;
      if (Math.abs(v[1]) < 0.4) v[1] = 0;
      events?.push({ k: 'floor', x: p[0], z: p[2], speed: sp });
      if (!inside) this.out = true;
    }
    // Left the cage: over a wall, or outside the court lines.
    if (!this.out && (Math.abs(p[0]) > COURT.halfW + 0.05 || Math.abs(p[2]) > COURT.halfL + 0.05)) {
      this.out = true;
      events?.push({ k: 'out', x: p[0], y: p[1], z: p[2] });
    }
  }
}

/** Predicted path: samples every `dt` for `secs` (events included), on a scratch ball. */
export interface PathSample {
  t: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Floor bounces so far (in total, and on each team's side), and wall hits so far. */
  floors: number;
  f0: number;
  f1: number;
  walls: number;
  out: boolean;
}

const scratch = new Ball();
export function predict(b: Ball, secs: number, dt: number, out: PathSample[], stepsPerSample = 4): PathSample[] {
  b.copyTo(scratch);
  scratch.rand = () => 0.5;
  out.length = 0;
  const ev: BallEvent[] = [];
  let floors = 0;
  let f0 = 0;
  let f1 = 0;
  let walls = 0;
  const h = dt / stepsPerSample;
  for (let t = 0; t <= secs + 1e-9; t += dt) {
    out.push({ t, x: scratch.pos[0], y: scratch.pos[1], z: scratch.pos[2], vx: scratch.vel[0], vy: scratch.vel[1], vz: scratch.vel[2], floors, f0, f1, walls, out: scratch.out });
    if (scratch.out) break;
    for (let s = 0; s < stepsPerSample; s++) {
      ev.length = 0;
      scratch.step(h, ev);
      for (const e of ev) {
        if (e.k === 'floor') {
          floors++;
          if (e.z < 0) f0++;
          else f1++;
        }
        else if (e.k === 'wall') walls++;
      }
    }
  }
  return out;
}
