import { PerspectiveCamera, Vector3 } from 'three';
import { clamp, damp, dampAngle, dampFactor } from '@shared/math/scalar';
import type { PhysicsWorld } from '@shared/physics/PhysicsWorld';
import type { ChaseCameraTuning } from '../config/camera';

/** What the camera needs to know about its kart each frame (render-interpolated). */
export interface ChaseTarget {
  position: Vector3;
  forward: Vector3;
  velocity: Vector3;
  /** Signed forward speed (m/s). */
  forwardSpeed: number;
  /** Speed normalised to the kart's top speed (0..1+). */
  speed01: number;
  grounded: boolean;
  /** 0..1 boost intensity (Phase 2). */
  boost: number;
  /** -1..1 drift direction amount (Phase 2). */
  drift: number;
  /** Visual kart size (Giant Gummy grows it): the camera backs off to keep it framed. */
  size?: number;
}

const UP = new Vector3(0, 1, 0);

/**
 * Third-person arcade chase camera: sits behind and above the kart, heading lags
 * slightly in turns for weight, height follows softly through jumps, FOV widens
 * with speed. Keeps clear of walls and the ground.
 */
export class ChaseCamera {
  readonly camera: PerspectiveCamera;
  private yaw = 0;
  private slope = 0;
  private refY = 0;
  private distance: number;
  private fov: number;
  private roll = 0;
  private grown = 0;
  private readonly pos = new Vector3();
  private readonly look = new Vector3();
  private readonly desired = new Vector3();
  private readonly lookTarget = new Vector3();
  private readonly dir = new Vector3();
  private readonly anchor = new Vector3();
  private readonly from = new Vector3();
  private readonly tmp = new Vector3();
  // Feedback springs.
  private trauma = 0;
  private landOffset = 0;
  private landVel = 0;
  private time = 0;
  /** After the finish: swing round to face the driver (0 = chase, 1 = finish shot). */
  finishMode = false;
  private finish = 0;

  constructor(
    public tuning: ChaseCameraTuning,
    private readonly physics: PhysicsWorld | null,
  ) {
    this.camera = new PerspectiveCamera(tuning.fov, 16 / 9, 0.3, 2400);
    this.distance = tuning.distance;
    this.fov = tuning.fov;
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Shake amount 0..1 (accumulates, decays). */
  addTrauma(amount: number): void {
    this.trauma = clamp(this.trauma + amount, 0, 1);
  }

  /** Downward kick on landing (impact in m/s). */
  kickLanding(impact: number): void {
    this.landVel -= clamp(impact * 0.12, 0, 2.2);
  }

  /** Jump straight to the resting pose behind the target (spawn / respawn). */
  snap(t: ChaseTarget): void {
    this.yaw = Math.atan2(t.forward.x, t.forward.z);
    this.refY = t.position.y;
    this.slope = 0;
    this.distance = this.tuning.distance;
    this.fov = this.tuning.fov;
    this.trauma = 0;
    this.landOffset = this.landVel = 0;
    this.finishMode = false;
    this.finish = 0;
    this.computeDesired(t);
    this.pos.copy(this.desired);
    this.look.copy(this.lookTarget);
    this.apply();
  }

  update(t: ChaseTarget, dt: number): void {
    const k = this.tuning;
    this.time += dt;

    // Heading: follow the kart's facing with lag. Finish shot: swing round to the
    // front and sway slowly so the celebrating driver is on show.
    this.finish = damp(this.finish, this.finishMode ? 1 : 0, 1.6, dt);
    const fwdYaw = Math.atan2(t.forward.x, t.forward.z) + (this.finishMode ? Math.PI * 0.88 + Math.sin(this.time * 0.35) * 0.25 : 0);
    this.yaw = dampAngle(this.yaw, fwdYaw, this.finishMode ? 1.4 : k.yawFollow * (0.7 + 0.5 * clamp(t.speed01, 0, 1)), dt);

    // Slope follow (pitch the rig with hills, but gently).
    const fwdSlope = t.grounded ? clamp(t.forward.y, -0.5, 0.5) : this.slope;
    this.slope = damp(this.slope, fwdSlope, 4, dt);

    // Height: snappy on the ground, floaty in the air so jumps read clearly.
    this.refY = damp(this.refY, t.position.y, t.grounded ? k.heightFollowGround : k.heightFollowAir, dt);
    // Never let the reference lag so far that the kart leaves the frame.
    this.refY = clamp(this.refY, t.position.y - 2.5, t.position.y + 2.5);

    // Speed sensation: pull back + widen FOV.
    const sp = clamp(t.speed01, 0, 1.3);
    const grown = Math.max(0, (t.size ?? 1) - 1);
    const chaseDistance = k.distance + k.speedDistance * sp + t.boost * 0.6 + grown * 2.2;
    this.grown = damp(this.grown, grown, 3, dt);
    this.distance = damp(this.distance, chaseDistance + (8 - chaseDistance) * this.finish, 3, dt);
    this.fov = damp(this.fov, k.fov + (k.speedFov * sp + k.boostFov * t.boost) * (1 - this.finish), 4, dt);

    // Landing spring.
    const stiffness = 90;
    const dampingC = 13;
    this.landVel += (-stiffness * this.landOffset - dampingC * this.landVel) * dt;
    this.landOffset += this.landVel * dt;

    this.computeDesired(t);
    this.pos.lerp(this.desired, dampFactor(k.positionFollow, dt));
    this.look.lerp(this.lookTarget, dampFactor(k.positionFollow * 1.4, dt));
    this.roll = damp(this.roll, -t.drift * 0.035, 4, dt);

    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    this.apply();
  }

  private computeDesired(t: ChaseTarget): void {
    const k = this.tuning;
    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    // Horizontal back vector, tilted by slope so we stay behind the kart on hills.
    this.dir.set(-sinY, -this.slope * k.slopeInfluence, -cosY).normalize();
    const anchor = this.anchor.set(t.position.x, this.refY, t.position.z);

    const f = this.finish;
    this.lookTarget
      .set(sinY, this.slope * k.slopeInfluence, cosY)
      .normalize()
      .multiplyScalar(k.lookAhead * (1 - f))
      .add(anchor)
      .addScaledVector(UP, k.lookHeight + (1.2 - k.lookHeight) * f)
      // Finish shot: aim right of the kart so it sits in the left third (results panel on the right).
      .addScaledVector(this.tmp.set(-cosY, 0, sinY), 2.6 * f);

    this.desired.copy(anchor).addScaledVector(this.dir, this.distance).addScaledVector(UP, k.height + (2.2 - k.height) * f + this.landOffset * 0.35 + this.grown * 1.4);
    this.avoidObstacles(anchor);
  }

  /** Pull the camera in front of walls and keep it above the ground. */
  private avoidObstacles(anchor: Vector3): void {
    if (!this.physics) return;
    const from = this.from.copy(anchor).addScaledVector(UP, 1.6);
    const toCam = this.tmp.copy(this.desired).sub(from);
    const len = toCam.length();
    if (len > 0.01) {
      toCam.divideScalar(len);
      const hit = this.physics.raycastWalls(from, toCam, len);
      if (hit !== null) this.desired.copy(from).addScaledVector(toCam, Math.max(0.5, hit - 0.35));
    }
    const ground = this.physics.raycastGround(this.tmp.copy(this.desired).addScaledVector(UP, 20), 60);
    if (ground) {
      const minY = ground.point.y + this.tuning.groundClearance;
      if (this.desired.y < minY) this.desired.y = minY;
    }
  }

  private apply(): void {
    const cam = this.camera;
    cam.position.copy(this.pos);
    cam.position.y += this.landOffset * 0.25;
    if (this.trauma > 0) {
      const s = this.trauma * this.trauma * 0.35;
      cam.position.x += Math.sin(this.time * 47.3) * s;
      cam.position.y += Math.sin(this.time * 61.7 + 1.3) * s;
      cam.position.z += Math.sin(this.time * 53.1 + 2.1) * s;
    }
    cam.up.set(0, 1, 0);
    cam.lookAt(this.look.x, this.look.y + this.landOffset * 0.12, this.look.z);
    if (this.roll !== 0) cam.rotateZ(this.roll);
    const framedFov = Math.min(105, 2 * Math.atan(Math.tan(this.fov * Math.PI / 360) / Math.min(1, cam.aspect)) * 180 / Math.PI);
    if (Math.abs(cam.fov - framedFov) > 0.01) {
      cam.fov = framedFov;
      cam.updateProjectionMatrix();
    }
  }
}
