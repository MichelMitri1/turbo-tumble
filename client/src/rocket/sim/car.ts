import { Quaternion, Vector3 } from 'three';
import { arenaNormal, arenaRaycast } from './arena';
import * as C from './constants';
import { DEFAULT_RULES, type Rules } from './rules';

/** Per-tick inputs, Rocket League style (all analog values in −1..1). */
export interface Controls {
  throttle: number;
  steer: number;
  /** +1 = nose up. */
  pitch: number;
  /** +1 = turn right. */
  yaw: number;
  /** +1 = roll right. */
  roll: number;
  jump: boolean;
  boost: boolean;
  handbrake: boolean;
}

export const NO_CONTROLS: Controls = { throttle: 0, steer: 0, pitch: 0, yaw: 0, roll: 0, jump: false, boost: false, handbrake: false };

const V = () => new Vector3();

/**
 * One car: a rigid box on four sprung raycast wheels. Local frame: +x forward,
 * +y left, +z up. Driving, jumping, dodges, air control, boost and powerslide
 * follow RocketSim's model of Rocket League (see constants.ts).
 */
export class Car {
  readonly pos = V();
  readonly vel = V();
  readonly quat = new Quaternion();
  readonly angVel = V();
  boost: number = C.BOOST_SPAWN;
  // Cached basis (world space).
  readonly forward = V();
  readonly left = V();
  readonly up = V();
  // Wheels.
  readonly wheelContact = [false, false, false, false];
  readonly wheelDist = [0, 0, 0, 0];
  numContacts = 0;
  readonly groundNormal = new Vector3(0, 0, 1);
  onGround = false;
  /** Body touched the world this tick (normal, for auto-flip). */
  worldContact = false;
  readonly worldContactNormal = new Vector3(0, 0, 1);
  // Jump / dodge state.
  isJumping = false;
  hasJumped = false;
  jumpTime = 0;
  hasDoubleJumped = false;
  hasFlipped = false;
  isFlipping = false;
  flipTime = 0;
  /** Dodge direction (x forward, y right) captured at flip start. */
  readonly dodge = { x: 0, y: 0 };
  airTime = 0;
  airTimeSinceJump = 0;
  isAutoFlipping = false;
  autoFlipTimer = 0;
  autoFlipDir = 1;
  // Boost / slide / speed.
  isBoosting = false;
  boostingTime = 0;
  handbrakeVal = 0;
  supersonic = false;
  supersonicTime = 0;
  // Life.
  demolished = false;
  respawnTimer = 0;
  bumpCooldown = 0;
  lastJump = false;
  /** Controls used this tick (renderer reads steer / boost / handbrake). */
  readonly controls: Controls = { throttle: 0, steer: 0, pitch: 0, yaw: 0, roll: 0, jump: false, boost: false, handbrake: false };
  /** Match rules (gravity, jump, boost, air control…). */
  rules: Readonly<Rules> = DEFAULT_RULES;
  readonly invInertia: Vector3;
  readonly halfExtents: Vector3;
  readonly hitboxOffset: Vector3;
  /** Wheel hardpoints in local space, order FL FR BL BR. */
  readonly wheels: Array<{ local: Vector3; radius: number; maxLen: number; restLen: number }>;
  private readonly t1 = V();
  private readonly t2 = V();
  private readonly t3 = V();
  private readonly q1 = new Quaternion();

  constructor(
    readonly id: number,
    readonly team: 0 | 1,
    readonly body: C.CarBody,
  ) {
    const [lx, ly, lz] = body.hitbox;
    const m = C.CAR_MASS;
    this.invInertia = new Vector3(12 / (m * (ly * ly + lz * lz)), 12 / (m * (lx * lx + lz * lz)), 12 / (m * (lx * lx + ly * ly)));
    this.halfExtents = new Vector3(lx / 2, ly / 2, lz / 2);
    this.hitboxOffset = new Vector3(...body.offset);
    const mk = (o: [number, number, number], side: number, w: C.CarBody['front']) => {
      const local = new Vector3(o[0], o[1] * side, o[2]);
      const restHeight = C.CAR_REST_Z + o[2];
      return { local, radius: w.radius, maxLen: w.rest + w.radius, restLen: restHeight + SPRING_PRELOAD };
    };
    this.wheels = [mk(body.front.offset, 1, body.front), mk(body.front.offset, -1, body.front), mk(body.back.offset, 1, body.back), mk(body.back.offset, -1, body.back)];
    this.updateBasis();
  }

  get speed(): number {
    return this.vel.length();
  }

  get forwardSpeed(): number {
    return this.vel.dot(this.forward);
  }

  updateBasis(): void {
    this.forward.set(1, 0, 0).applyQuaternion(this.quat);
    this.left.set(0, 1, 0).applyQuaternion(this.quat);
    this.up.set(0, 0, 1).applyQuaternion(this.quat);
  }

  /** Place the car at rest (kickoff / respawn). */
  place(x: number, y: number, yaw: number, boost = this.rules.boostMode === 'unlimited' ? C.BOOST_MAX : this.rules.boostMode === 'none' ? 0 : C.BOOST_SPAWN): void {
    this.pos.set(x, y, C.CAR_REST_Z);
    this.vel.set(0, 0, 0);
    this.angVel.set(0, 0, 0);
    this.quat.setFromAxisAngle(new Vector3(0, 0, 1), yaw);
    this.boost = boost;
    this.isJumping = this.hasJumped = this.hasDoubleJumped = this.hasFlipped = this.isFlipping = false;
    this.jumpTime = this.flipTime = this.airTime = this.airTimeSinceJump = 0;
    this.isBoosting = false;
    this.handbrakeVal = 0;
    this.supersonic = false;
    this.demolished = false;
    this.respawnTimer = 0;
    this.isAutoFlipping = false;
    this.updateBasis();
    this.numContacts = 4;
    this.onGround = true;
  }

  /** Apply a world-space angular acceleration-like torque through the inertia tensor. */
  private applyTorque(torqueWorld: Vector3, dt: number): void {
    const local = this.t3.copy(torqueWorld).applyQuaternion(this.q1.copy(this.quat).invert());
    local.multiply(this.invInertia);
    this.angVel.add(local.applyQuaternion(this.quat).multiplyScalar(dt));
  }

  /** Apply a force at a world point (linear + angular). */
  private applyForceAt(force: Vector3, point: Vector3, dt: number): void {
    this.vel.addScaledVector(force, dt / C.CAR_MASS);
    const r = this.t2.copy(point).sub(this.pos);
    this.applyTorque(r.cross(force), dt);
  }

  // ---------------------------------------------------------------------- wheels

  /** Raycast the wheels (also used by replays, which only restore snapshots). */
  updateWheels(): void {
    const dir = this.t1.copy(this.up).negate();
    let n = 0;
    const normalSum = this.t3.set(0, 0, 0);
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i]!;
      const hp = this.t2.copy(w.local).applyQuaternion(this.quat).add(this.pos);
      const t = arenaRaycast(hp, dir, w.maxLen);
      this.wheelContact[i] = t >= 0;
      this.wheelDist[i] = t;
      if (t >= 0) {
        n++;
        const p = hp.addScaledVector(dir, t);
        normalSum.add(arenaNormal(p.x, p.y, p.z, this.wheelNormals[i]));
      }
    }
    this.numContacts = n;
    if (n) this.groundNormal.copy(normalSum).normalize();
    this.onGround = n >= 3;
  }
  private readonly wheelNormals = [V(), V(), V(), V()];

  // ---------------------------------------------------------------------- tick

  /** Inputs → forces/velocities for one tick (collisions are handled by the world). */
  tick(dt: number, input: Controls): void {
    if (this.demolished) return;
    Object.assign(this.controls, input);
    const ctl = this.controls;
    this.updateBasis();
    this.updateWheels();
    const jumpPressed = ctl.jump && !this.lastJump;
    this.lastJump = ctl.jump;
    const fwdSpeed = this.forwardSpeed;

    this.updateDrive(dt, ctl, fwdSpeed);
    if (!this.onGround) this.updateAir(dt, ctl, this.numContacts === 0);
    else this.isFlipping = false;
    this.updateJump(dt, ctl, jumpPressed);
    this.updateAutoFlip(dt, jumpPressed);
    this.updateDoubleJumpOrFlip(dt, ctl, jumpPressed, fwdSpeed);
    if (ctl.throttle && ((this.numContacts > 0 && this.numContacts < 4) || this.worldContact)) this.updateAutoRoll(dt);
    this.updateBoost(dt, ctl);

    // Gravity, speed limits, supersonic.
    this.vel.z += C.GRAVITY * this.rules.gravity * dt;
    if (this.vel.lengthSq() > C.CAR_MAX_SPEED * C.CAR_MAX_SPEED) this.vel.setLength(C.CAR_MAX_SPEED);
    if (this.angVel.lengthSq() > C.CAR_MAX_ANG * C.CAR_MAX_ANG) this.angVel.setLength(C.CAR_MAX_ANG);
    const sp = this.speed;
    if (sp >= C.SUPERSONIC_START) {
      this.supersonic = true;
      this.supersonicTime = 0;
    } else if (this.supersonic) {
      this.supersonicTime += dt;
      if (sp < C.SUPERSONIC_MAINTAIN || this.supersonicTime > C.SUPERSONIC_MAINTAIN_TIME) this.supersonic = false;
    }
    this.bumpCooldown = Math.max(0, this.bumpCooldown - dt);
  }

  /** Integrate position and orientation (after collisions adjusted velocities). */
  integrate(dt: number): void {
    if (this.demolished) return;
    this.pos.addScaledVector(this.vel, dt);
    const w = this.angVel;
    const angle = w.length() * dt;
    if (angle > 1e-9) {
      this.q1.setFromAxisAngle(this.t1.copy(w).normalize(), angle);
      this.quat.premultiply(this.q1).normalize();
    }
    this.updateBasis();
  }

  private updateDrive(dt: number, ctl: Controls, fwdSpeed: number): void {
    // Powerslide is analog.
    this.handbrakeVal = Math.max(0, Math.min(1, this.handbrakeVal + (ctl.handbrake ? C.POWERSLIDE_RISE : -C.POWERSLIDE_FALL) * dt));
    if (!this.numContacts) return;
    const absF = Math.abs(fwdSpeed);
    let realThrottle = ctl.throttle;
    if (ctl.boost && this.boost > 0) realThrottle = 1;
    let engine = realThrottle;
    let brake = 0;
    if (!ctl.handbrake) {
      if (Math.abs(realThrottle) >= 0.001) {
        if (absF > C.STOPPING_SPEED && Math.sign(realThrottle) !== Math.sign(fwdSpeed)) {
          brake = 1;
          engine = 0;
        }
      } else {
        engine = 0;
        brake = absF < C.STOPPING_SPEED ? 1 : C.COAST_BRAKE_FACTOR;
      }
    }
    const contactFrac = this.numContacts / 4;
    let driveScale = C.curve(C.DRIVE_TORQUE_CURVE, absF);
    if (this.numContacts < 3) driveScale /= 4;

    // Suspension springs (push the body along each contact normal).
    for (let i = 0; i < 4; i++) {
      if (!this.wheelContact[i]) continue;
      const w = this.wheels[i]!;
      const hp = this.t2.copy(w.local).applyQuaternion(this.quat).add(this.pos);
      const r = hp.clone().sub(this.pos);
      const pointVel = this.t1.copy(this.angVel).cross(r).add(this.vel);
      const n = this.wheelNormals[i]!;
      const compression = w.restLen - this.wheelDist[i]!;
      const closing = -pointVel.dot(n);
      const f = Math.max(0, SPRING_K * compression + SPRING_C * closing);
      this.applyForceAt(this.t3.copy(n).multiplyScalar(f), hp, dt);
    }

    const N = this.groundNormal;
    const fs = this.t1.copy(this.forward).addScaledVector(N, -this.forward.dot(N)).normalize();
    const ls = this.t2.crossVectors(N, fs);
    let vF = this.vel.dot(fs);
    const vL = this.vel.dot(ls);

    // Brake / coast, then engine.
    if (brake > 0) {
      const dv = brake * C.BRAKE_ACCEL * dt * contactFrac;
      const next = Math.abs(vF) <= dv ? 0 : vF - Math.sign(vF) * dv;
      this.vel.addScaledVector(fs, next - vF);
      vF = next;
    }
    if (engine) this.vel.addScaledVector(fs, engine * C.THROTTLE_ACCEL * driveScale * dt * contactFrac);

    // Lateral friction (the slip curve, powerslide, and less grip on walls when not driving).
    const slip = Math.abs(vL) > 5 ? Math.abs(vL) / (Math.abs(vF) + Math.abs(vL)) : 0;
    let lat = C.curve(C.LAT_FRICTION_CURVE, slip);
    if (this.handbrakeVal) lat *= (0.1 - 1) * this.handbrakeVal + 1;
    if (realThrottle === 0) lat *= C.curve(C.NON_STICKY_FRICTION_CURVE, N.z);
    this.vel.addScaledVector(ls, -vL * Math.min(1, lat * contactFrac));
    // Powerslide also bleeds a bit of forward speed.
    if (this.handbrakeVal && !engine) this.vel.addScaledVector(fs, -vF * (1 - C.curve(C.HANDBRAKE_LONG_CURVE, slip)) * 0.02 * this.handbrakeVal);

    // Steering: bicycle model (wheelbase ≈ 85 uu) on Rocket League's steer-angle curve.
    let steerAngle = C.curve(C.STEER_ANGLE_CURVE, absF);
    if (this.handbrakeVal) steerAngle += (C.curve(C.POWERSLIDE_STEER_CURVE, absF) - steerAngle) * this.handbrakeVal;
    const curvature = Math.tan(steerAngle) / WHEELBASE;
    const targetYaw = -ctl.steer * curvature * vF;
    const yawNow = this.angVel.dot(N);
    const response = Math.min(1, (this.onGround ? 22 : 6) * dt) * (this.handbrakeVal ? 0.55 : 1);
    this.angVel.addScaledVector(N, (targetYaw - yawNow) * response);

    // Sticky force into the surface.
    const fullStick = realThrottle !== 0 || absF > C.STOPPING_SPEED;
    const sticky = 0.5 + (fullStick ? 1 - Math.abs(N.z) : 0);
    this.vel.addScaledVector(N, sticky * C.GRAVITY * dt);
  }

  private updateAir(dt: number, ctl: Controls, airControl: boolean): void {
    if (this.isFlipping) this.isFlipping = this.hasFlipped && this.flipTime < C.FLIP_TORQUE_TIME;
    let doAir = true;
    let pitchScaleFlip = 1;
    if (this.isFlipping) {
      const dx = this.dodge.x;
      const dy = this.dodge.y;
      if (dx || dy) {
        // Flip cancel: pulling against a front/back flip.
        if (dx !== 0 && ctl.pitch !== 0 && Math.sign(dx) === Math.sign(ctl.pitch)) pitchScaleFlip = 1 - Math.min(1, Math.abs(ctl.pitch));
        else doAir = false;
        const right = this.t1.copy(this.left).negate();
        const acc = this.t2.copy(this.forward).multiplyScalar(C.FLIP_TORQUE_X * dy).addScaledVector(right, -C.FLIP_TORQUE_Y * dx * pitchScaleFlip);
        this.angVel.addScaledVector(acc, dt);
        if (pitchScaleFlip < 1) doAir = true;
      }
    }
    doAir = doAir && !this.isAutoFlipping && airControl;
    if (doAir) {
      let pitchScale = 1;
      if (this.isFlipping) pitchScale = 0;
      else if (this.hasFlipped && this.flipTime < C.FLIP_TORQUE_TIME + C.FLIP_PITCHLOCK_EXTRA) pitchScale = 0;
      const right = this.t1.copy(this.left).negate();
      const p = ctl.pitch * pitchScale;
      // Torque axes: pitch about right, yaw about −up, roll about forward.
      const w = this.angVel;
      const dP = w.dot(right) * C.AIR_DAMPING.pitch * (1 - Math.abs(p));
      const dY = -w.dot(this.up) * C.AIR_DAMPING.yaw * (1 - Math.abs(ctl.yaw));
      const dR = w.dot(this.forward) * C.AIR_DAMPING.roll;
      const k = this.rules.airControl;
      const acc = this.t2
        .copy(right)
        .multiplyScalar(p * C.AIR_TORQUE.pitch * k - dP)
        .addScaledVector(this.up, -(ctl.yaw * C.AIR_TORQUE.yaw * k - dY))
        .addScaledVector(this.forward, ctl.roll * C.AIR_TORQUE.roll * k - dR);
      w.addScaledVector(acc, C.TORQUE_SCALE * dt);
    }
    if (ctl.throttle) this.vel.addScaledVector(this.forward, ctl.throttle * C.THROTTLE_AIR_ACCEL * dt);
  }

  private updateJump(dt: number, ctl: Controls, pressed: boolean): void {
    if (this.onGround && !this.isJumping) {
      if (!(this.hasJumped && this.jumpTime < C.JUMP_MIN_TIME + 1 / 40)) {
        this.hasJumped = false;
        this.jumpTime = 0;
      }
    }
    if (this.isJumping) {
      this.isJumping = this.jumpTime < C.JUMP_MIN_TIME || (ctl.jump && this.jumpTime < C.JUMP_MAX_TIME);
    } else if (this.onGround && pressed) {
      this.isJumping = true;
      this.jumpTime = 0;
      this.vel.addScaledVector(this.up, C.JUMP_IMPULSE * this.rules.jumpHeight);
    }
    if (this.isJumping) {
      this.hasJumped = true;
      this.vel.addScaledVector(this.up, C.JUMP_ACCEL * this.rules.jumpHeight * (this.jumpTime < C.JUMP_MIN_TIME ? 0.62 : 1) * dt);
    }
    if (this.isJumping || this.hasJumped) this.jumpTime += dt;
  }

  /** RocketSim's auto-roll: throttle on a side / partial contact rolls the wheels back down. */
  private updateAutoRoll(dt: number): void {
    const gUp = this.numContacts > 0 ? this.groundNormal : this.worldContactNormal;
    // RL is left-handed: RocketSim's "right" is numerically our `left`.
    const right = this.left.clone();
    const crossRight = gUp.clone().cross(this.forward);
    const crossForward = gUp.clone().negate().cross(crossRight);
    const rightFactor = 1 - Math.max(0, Math.min(1, right.dot(crossRight)));
    const forwardFactor = 1 - Math.max(0, Math.min(1, this.forward.dot(crossForward)));
    const tRight = this.forward.clone().multiplyScalar((right.dot(gUp) >= 0 ? -1 : 1) * rightFactor);
    const tForward = right.multiplyScalar((this.forward.dot(gUp) >= 0 ? 1 : -1) * forwardFactor);
    this.vel.addScaledVector(gUp, -C.AUTOROLL_FORCE * dt);
    this.angVel.addScaledVector(tRight.add(tForward), C.AUTOROLL_TORQUE * dt);
  }

  private updateAutoFlip(dt: number, pressed: boolean): void {
    if (pressed && this.worldContact && this.worldContactNormal.z > Math.SQRT1_2 && this.up.z < -0.7) {
      this.autoFlipTimer = C.AUTOFLIP_TIME;
      this.autoFlipDir = this.left.z > 0 ? -1 : 1;
      this.isAutoFlipping = true;
      this.vel.addScaledVector(this.up, -C.AUTOFLIP_IMPULSE);
    }
    if (this.isAutoFlipping) {
      if (this.autoFlipTimer <= 0) this.isAutoFlipping = false;
      else {
        this.angVel.addScaledVector(this.forward, C.AUTOFLIP_TORQUE * this.autoFlipDir * dt * 2.2);
        this.autoFlipTimer -= dt;
      }
    }
  }

  private updateDoubleJumpOrFlip(dt: number, ctl: Controls, pressed: boolean, fwdSpeed: number): void {
    if (this.onGround) {
      this.hasDoubleJumped = false;
      this.hasFlipped = false;
      this.airTime = 0;
      this.airTimeSinceJump = 0;
      this.flipTime = 0;
    } else {
      this.airTime += dt;
      if (this.hasJumped && !this.isJumping) this.airTimeSinceJump += dt;
      else this.airTimeSinceJump = 0;
      if (pressed && (this.airTimeSinceJump < C.DOUBLEJUMP_MAX_DELAY || !this.hasJumped) && !this.hasDoubleJumped && !this.hasFlipped && !this.isAutoFlipping) {
        // Without a first jump (fell off a wall / ramp) RL still gives one dodge or double jump.
        const mag = Math.abs(ctl.yaw) + Math.abs(ctl.pitch) + Math.abs(ctl.roll);
        if (mag >= C.DODGE_DEADZONE) this.startFlip(ctl, fwdSpeed);
        else {
          this.vel.addScaledVector(this.up, C.JUMP_IMPULSE * this.rules.jumpHeight);
          this.hasDoubleJumped = true;
        }
      }
    }
    if (this.isFlipping) {
      this.flipTime += dt;
      if (this.flipTime <= C.FLIP_TORQUE_TIME && this.flipTime >= C.FLIP_Z_DAMP_START && (this.vel.z < 0 || this.flipTime < C.FLIP_Z_DAMP_END)) {
        this.vel.z *= Math.pow(1 - C.FLIP_Z_DAMP_120, dt * 120);
      }
    } else if (this.hasFlipped) this.flipTime += dt;
  }

  private startFlip(ctl: Controls, fwdSpeed: number): void {
    this.flipTime = 0;
    this.hasFlipped = true;
    this.isFlipping = true;
    let dx = -ctl.pitch;
    let dy = ctl.yaw + ctl.roll;
    if (Math.abs(dy) < 0.1 && Math.abs(dx) < 0.1) {
      dx = dy = 0;
    } else {
      const l = Math.hypot(dx, dy);
      dx /= l;
      dy /= l;
    }
    this.dodge.x = dx;
    this.dodge.y = dy;
    if (Math.abs(dx) < 0.1) dx = 0;
    if (Math.abs(dy) < 0.1) dy = 0;
    if (!dx && !dy) return;
    const ratio = Math.abs(fwdSpeed) / C.CAR_MAX_SPEED;
    const backwards = Math.abs(fwdSpeed) < 100 ? dx < 0 : dx >= 0 !== fwdSpeed >= 0;
    let ix = dx * C.FLIP_INITIAL_VEL;
    let iy = dy * C.FLIP_INITIAL_VEL;
    ix *= ((backwards ? C.FLIP_BACKWARD_SCALE : C.FLIP_FORWARD_SCALE) - 1) * ratio + 1;
    iy *= (C.FLIP_SIDE_SCALE - 1) * ratio + 1;
    if (backwards) ix *= C.FLIP_BACKWARD_X;
    const f2 = this.t1.set(this.forward.x, this.forward.y, 0);
    if (f2.lengthSq() < 1e-6) f2.set(1, 0, 0);
    f2.normalize();
    const r2 = this.t2.set(f2.y, -f2.x, 0);
    this.vel.addScaledVector(f2, ix).addScaledVector(r2, iy);
  }

  private updateBoost(dt: number, ctl: Controls): void {
    if (this.boost > 0) {
      if (this.isBoosting) this.isBoosting = ctl.boost || this.boostingTime < C.BOOST_MIN_TIME;
      else this.isBoosting = ctl.boost;
    } else this.isBoosting = false;
    this.boostingTime = this.isBoosting ? this.boostingTime + dt : 0;
    if (this.isBoosting) {
      if (this.rules.boostMode === 'unlimited') this.boost = C.BOOST_MAX;
      else this.boost = Math.max(0, this.boost - C.BOOST_PER_SECOND * dt);
      this.vel.addScaledVector(this.forward, (this.onGround ? C.BOOST_ACCEL_GROUND : C.BOOST_ACCEL_AIR) * this.rules.boostStrength * dt);
    }
  }

  /** Flip reset: wheels on the ball give back the dodge. */
  flipReset(): void {
    if (this.onGround) return;
    this.hasFlipped = false;
    this.hasDoubleJumped = false;
    this.hasJumped = false;
    this.airTimeSinceJump = 0;
  }

  /** Hitbox center in world space. */
  hitboxCenter(out: Vector3): Vector3 {
    return out.copy(this.hitboxOffset).applyQuaternion(this.quat).add(this.pos);
  }

  /** Apply an impulse at a world point. */
  applyImpulse(impulse: Vector3, point: Vector3): void {
    this.vel.addScaledVector(impulse, 1 / C.CAR_MASS);
    const r = this.t2.copy(point).sub(this.pos);
    const ang = r.cross(impulse).applyQuaternion(this.q1.copy(this.quat).invert()).multiply(this.invInertia).applyQuaternion(this.quat);
    this.angVel.add(ang);
  }

  /** Effective inverse mass of the car at a point along a direction (for impulses). */
  invMassAt(point: Vector3, n: Vector3): number {
    const r = this.t2.copy(point).sub(this.pos);
    const rn = this.t3.copy(r).cross(n).applyQuaternion(this.q1.copy(this.quat).invert()).multiply(this.invInertia).applyQuaternion(this.quat);
    return 1 / C.CAR_MASS + rn.cross(r).dot(n);
  }
}

const WHEELBASE = 85;
/** Suspension: preload compression at rest, stiffness and damping (per wheel). */
const SPRING_PRELOAD = 6;
const SPRING_K = (C.CAR_MASS * 650 * 1.5) / 4 / SPRING_PRELOAD;
const SPRING_C = 2 * Math.sqrt(SPRING_K * (C.CAR_MASS / 4));
