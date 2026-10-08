import { Vector3 } from 'three';
import { ARENA, arenaDistance, arenaNormal } from './arena';
import * as C from './constants';
import { DEFAULT_RULES, type Rules } from './rules';

export interface BallSample {
  t: number;
  pos: Vector3;
  vel: Vector3;
}

/**
 * Simulate a copy of the ball forward (no cars), one sample every `step`
 * seconds; shared by the bots and the shot / save statistics. The copy keeps
 * the ball's rules, so mutators (size, gravity, bounce…) are predicted too.
 */
export function predictBall(ball: Ball, seconds: number, step = 1 / 30, out: BallSample[] = []): BallSample[] {
  const sim = new Ball();
  sim.rules = ball.rules;
  sim.pos.copy(ball.pos);
  sim.vel.copy(ball.vel);
  sim.angVel.copy(ball.angVel);
  const sub = Math.max(1, Math.round(step / C.TICK));
  out.length = 0;
  for (let t = 0; t <= seconds + 1e-6; t += step) {
    out.push({ t, pos: sim.pos.clone(), vel: sim.vel.clone() });
    for (let k = 0; k < sub; k++) sim.tick(step / sub);
  }
  return out;
}

/** The team that scores if the ball follows `path` (first goal-line crossing), or -1. */
export function predictedGoal(path: ReadonlyArray<BallSample>, radius: number): 0 | 1 | -1 {
  for (const p of path) if (Math.abs(p.pos.y) >= ARENA.goalLineY + radius) return p.pos.y > 0 ? 0 : 1;
  return -1;
}

/** The ball: a solid sphere with spin, drag and the arena's bounce/friction. */
export class Ball {
  readonly pos = new Vector3(0, 0, C.BALL_WORLD_RADIUS);
  readonly vel = new Vector3();
  readonly angVel = new Vector3();
  /** Seconds since the last touch per car id (for hit effects / assists). */
  lastTouch = -1;
  lastTouchTeam: 0 | 1 | -1 = -1;
  /** Set when it hit the world this tick (for sounds). */
  bounce = 0;
  rules: Readonly<Rules> = DEFAULT_RULES;
  private readonly n = new Vector3();
  private readonly t = new Vector3();

  /** Car-collision radius (scaled by the ball-size rule). */
  get radius(): number {
    return C.BALL_RADIUS * this.rules.ballSize;
  }
  /** World-collision radius. */
  get worldRadius(): number {
    return C.BALL_WORLD_RADIUS * this.rules.ballSize;
  }
  get mass(): number {
    return C.BALL_MASS * this.rules.ballWeight;
  }

  reset(): void {
    this.pos.set(0, 0, this.worldRadius);
    this.vel.set(0, 0, 0);
    this.angVel.set(0, 0, 0);
    this.lastTouch = -1;
    this.lastTouchTeam = -1;
  }

  tick(dt: number): void {
    this.bounce = 0;
    const R = this.rules;
    this.vel.z += C.GRAVITY * R.gravity * dt;
    this.vel.multiplyScalar(Math.pow(1 - Math.min(0.95, C.BALL_DRAG * R.ballDrag), dt));
    if (this.vel.lengthSq() > R.ballMaxSpeed ** 2) this.vel.setLength(R.ballMaxSpeed);
    this.pos.addScaledVector(this.vel, dt);
    this.collideWorld();
    if (this.angVel.lengthSq() > C.BALL_MAX_ANG ** 2) this.angVel.setLength(C.BALL_MAX_ANG);
  }

  private collideWorld(): void {
    const r = this.worldRadius;
    const radius = this.radius;
    for (let iter = 0; iter < 3; iter++) {
      const p = this.pos;
      const d = arenaDistance(p.x, p.y, p.z);
      if (d >= r) return;
      const n = arenaNormal(p.x, p.y, p.z, this.n);
      p.addScaledVector(n, r - d);
      const vn = this.vel.dot(n);
      if (vn >= 0) continue;
      // Normal restitution + Coulomb friction at the contact (spin couples in).
      const m = this.mass;
      const I = 0.4 * m * radius * radius;
      const jn = -(1 + this.rules.ballBounce) * vn * m;
      // Contact point velocity.
      const rc = this.t.copy(n).multiplyScalar(-radius);
      const u = new Vector3().crossVectors(this.angVel, rc).add(this.vel);
      const ut = u.addScaledVector(n, -u.dot(n));
      const utLen = ut.length();
      this.vel.addScaledVector(n, jn / m);
      if (utLen > 1e-3) {
        const k = 1 / m + (radius * radius) / I;
        const jt = Math.min(C.BALL_FRICTION * jn, utLen / k);
        const J = ut.multiplyScalar(-jt / utLen);
        this.vel.addScaledVector(J, 1 / m);
        this.angVel.add(new Vector3().crossVectors(rc, J).multiplyScalar(1 / I));
      }
      this.bounce = Math.max(this.bounce, -vn);
    }
  }
}
