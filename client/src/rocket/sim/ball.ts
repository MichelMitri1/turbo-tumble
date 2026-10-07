import { Vector3 } from 'three';
import { arenaDistance, arenaNormal } from './arena';
import * as C from './constants';
import { DEFAULT_RULES, type Rules } from './rules';

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
