import { Vector3 } from 'three';
import { arenaDistance, arenaNormal } from './arena';
import * as C from './constants';

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
  private readonly n = new Vector3();
  private readonly t = new Vector3();

  reset(): void {
    this.pos.set(0, 0, C.BALL_WORLD_RADIUS);
    this.vel.set(0, 0, 0);
    this.angVel.set(0, 0, 0);
    this.lastTouch = -1;
    this.lastTouchTeam = -1;
  }

  tick(dt: number): void {
    this.bounce = 0;
    this.vel.z += C.GRAVITY * dt;
    this.vel.multiplyScalar(Math.pow(1 - C.BALL_DRAG, dt));
    if (this.vel.lengthSq() > C.BALL_MAX_SPEED ** 2) this.vel.setLength(C.BALL_MAX_SPEED);
    this.pos.addScaledVector(this.vel, dt);
    this.collideWorld();
    if (this.angVel.lengthSq() > C.BALL_MAX_ANG ** 2) this.angVel.setLength(C.BALL_MAX_ANG);
  }

  private collideWorld(): void {
    const r = C.BALL_WORLD_RADIUS;
    for (let iter = 0; iter < 3; iter++) {
      const p = this.pos;
      const d = arenaDistance(p.x, p.y, p.z);
      if (d >= r) return;
      const n = arenaNormal(p.x, p.y, p.z, this.n);
      p.addScaledVector(n, r - d);
      const vn = this.vel.dot(n);
      if (vn >= 0) continue;
      // Normal restitution + Coulomb friction at the contact (spin couples in).
      const m = C.BALL_MASS;
      const I = 0.4 * m * C.BALL_RADIUS * C.BALL_RADIUS;
      const jn = -(1 + C.BALL_RESTITUTION) * vn * m;
      // Contact point velocity.
      const rc = this.t.copy(n).multiplyScalar(-C.BALL_RADIUS);
      const u = new Vector3().crossVectors(this.angVel, rc).add(this.vel);
      const ut = u.addScaledVector(n, -u.dot(n));
      const utLen = ut.length();
      this.vel.addScaledVector(n, jn / m);
      if (utLen > 1e-3) {
        const k = 1 / m + (C.BALL_RADIUS * C.BALL_RADIUS) / I;
        const jt = Math.min(C.BALL_FRICTION * jn, utLen / k);
        const J = ut.multiplyScalar(-jt / utLen);
        this.vel.addScaledVector(J, 1 / m);
        this.angVel.add(new Vector3().crossVectors(rc, J).multiplyScalar(1 / I));
      }
      this.bounce = Math.max(this.bounce, -vn);
    }
  }
}
