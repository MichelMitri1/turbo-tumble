import { Vector3 } from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { PlayerInput } from '../types/input';
import { SURFACE_PARAMS, SurfaceType } from '../types/surface';
import { FIXED_DT, GRAVITY, KILL_PLANE_Y } from '../constants/simulation';
import { clamp, dampFactor, moveTowards, smoothstep } from '../math/scalar';
import type { GroundHit, MoveResult, PhysicsWorld } from '../physics/PhysicsWorld';
import type { TrackPath, TrackLocation } from '../track/TrackPath';
import type { KartStats } from './KartStats';
import { createKartEvents, isInvulnerable, isStunned, type HitKind, type KartEvents, type KartState } from './KartState';

/** Radius of the wall-collision sphere and its height above the ground contact. */
export const KART_COLLISION_RADIUS = 1.15;
const COLLIDER_HEIGHT = 1.0;
/** Ray starts this far above the kart so it can find ground it has dipped slightly below. */
const PROBE_LIFT = 2.0;
const PROBE_LENGTH = 80;
/** Max gap that keeps a grounded kart glued to the surface (handles crests & dips). */
const STICK_DISTANCE = 0.45;
/** Gap under which an airborne kart lands. */
const LAND_DISTANCE = 0.06;

const WORLD_UP = new Vector3(0, 1, 0);

/** Drift charge (s) needed for each mini-turbo stage, and the boost each stage gives. */
export const DRIFT_STAGE_CHARGE = [0, 0.75, 1.65, 2.7] as const;
const MINI_TURBO_DURATION = [0, 0.65, 1.15, 1.75] as const;
const MINI_TURBO_POWER = 7;
const MIN_DRIFT_SPEED = 9;

/** Durations of hit reactions (s). */
export const HIT_DURATION: Record<HitKind, number> = { spin: 1.15, tumble: 1.45, squish: 2.4 };

/**
 * Arcade kart integrator. Deterministic for a given input stream and collision world,
 * so the same code can run client-side (prediction) and server-side (authority).
 */
export class KartSimulation {
  readonly events: KartEvents = createKartEvents();
  private readonly collider: RAPIER.Collider;
  private readonly hit: GroundHit = { distance: 0, point: new Vector3(), normal: new Vector3(), surface: SurfaceType.Road };
  private readonly move: MoveResult = { movement: new Vector3(), contacts: [] };
  private readonly loc: TrackLocation = { index: 0, t: 0, splineDistance: 0, lateral: 0, height: 0, distanceSq: 0 };
  private readonly v1 = new Vector3();
  private readonly v2 = new Vector3();
  private readonly right = new Vector3();

  constructor(
    readonly state: KartState,
    public stats: KartStats,
    private readonly physics: PhysicsWorld,
    private readonly track: TrackPath,
  ) {
    this.collider = physics.createKartCollider(KART_COLLISION_RADIUS);
  }

  dispose(): void {
    this.physics.removeCollider(this.collider);
  }

  /** Place the kart at a world position facing `forward`, at rest. */
  placeAt(position: Vector3, forward: Vector3): void {
    const s = this.state;
    s.position.copy(position);
    s.velocity.set(0, 0, 0);
    s.forward.copy(forward).setY(0).normalize();
    s.up.copy(WORLD_UP);
    s.steer = 0;
    s.forwardSpeed = 0;
    s.airTime = 0;
    s.jumpCooldown = 0;
    s.jumpFlight = s.jumpTrick = false;
    s.slipstreamCharge = s.slipstreamTimer = s.slipstreamCooldown = 0;
    s.trackIndex = -1;
    s.grounded = false;
    this.probeGround(true);
    this.updateTrackLocation();
    s.safeTrackIndex = s.trackIndex;
  }

  step(input: PlayerInput, dt: number): void {
    const s = this.state;
    const ev = this.events;
    ev.landed = 0;
    ev.wallHit = 0;
    ev.hopped = false;
    ev.jumped = false;
    ev.respawned = false;
    ev.driftStarted = false;
    ev.driftStageUp = 0;
    ev.miniTurbo = 0;
    ev.hit = null;

    this.tickTimers(dt);
    const stunned = isStunned(s);

    // --- Steering input smoothing (keyboard gets a short ramp, analog stays crisp).
    const steerTarget = stunned ? 0 : clamp(input.steer, -1, 1);
    const steerRate = Math.abs(steerTarget) > Math.abs(s.steer) ? 7 : 11;
    s.steer = moveTowards(s.steer, steerTarget, steerRate * dt);

    // --- Hop on drift press (grounded only).
    const driftPressed = input.drift && !s.driftHeld;
    s.driftHeld = input.drift;
    if (driftPressed && !s.grounded && s.jumpFlight && !stunned) s.jumpTrick = true;
    if (driftPressed && s.grounded && !stunned) {
      s.velocity.addScaledVector(s.up, this.stats.hopSpeed);
      s.grounded = false;
      ev.hopped = true;
    }
    this.updateDrift(input, stunned);

    if (s.grounded) this.groundDynamics(input, dt, stunned);
    else this.airDynamics(input, dt, stunned);

    this.integrateAgainstWalls(dt);
    this.probeGround(false);
    this.updateTrackLocation();
    this.launchFromRamp();
    this.updateStuck(input, dt);

    // Fell into the void (well below the road) → back to the last checkpoint.
    const roadY = s.trackIndex >= 0 ? this.track.samples[s.trackIndex]!.position.y : 0;
    const fell = s.position.y < KILL_PLANE_Y || (!s.grounded && s.airTime > 0.35 && s.position.y < roadY - 14);
    if (fell) this.respawn(s.respawnIndex >= 0 ? s.respawnIndex : s.safeTrackIndex - 3);
    else if (s.offTrackTicks > 60 * 6 || s.stuckTime > 4) this.respawn();
  }

  private tickTimers(dt: number): void {
    const s = this.state;
    const dec = (v: number): number => (v > 0 ? Math.max(0, v - dt) : 0);
    s.respawnTimer = dec(s.respawnTimer);
    s.jumpCooldown = dec(s.jumpCooldown);
    s.boostTimer = dec(s.boostTimer);
    if (s.boostTimer === 0) s.boostPower = 0;
    s.spinTimer = dec(s.spinTimer);
    s.tumbleTimer = dec(s.tumbleTimer);
    s.squishTimer = dec(s.squishTimer);
    s.invincibleTimer = dec(s.invincibleTimer);
    s.shrinkTimer = dec(s.shrinkTimer);
    s.rocketTimer = dec(s.rocketTimer);
    s.inkTimer = dec(s.inkTimer);
  }

  /** Hold drift + steer → slide; charge builds sparks; releasing fires a mini-turbo. */
  private updateDrift(input: PlayerInput, stunned: boolean): void {
    const s = this.state;
    if (s.drifting) {
      const tooSlow = s.forwardSpeed < MIN_DRIFT_SPEED * 0.6;
      if (stunned || tooSlow || s.rocketTimer > 0) {
        this.endDrift(false);
      } else if (!input.drift) {
        this.endDrift(true);
      }
      return;
    }
    if (input.drift && s.grounded && !stunned && s.rocketTimer <= 0 && Math.abs(input.steer) > 0.35 && s.forwardSpeed > MIN_DRIFT_SPEED) {
      s.drifting = true;
      s.driftDir = Math.sign(input.steer);
      s.driftCharge = 0;
      s.driftStage = 0;
      this.events.driftStarted = true;
    }
  }

  private endDrift(fireTurbo: boolean): void {
    const s = this.state;
    if (fireTurbo && s.driftStage > 0) {
      this.giveBoost(MINI_TURBO_DURATION[s.driftStage]!, MINI_TURBO_POWER);
      this.events.miniTurbo = s.driftStage;
    }
    s.drifting = false;
    s.driftDir = 0;
    s.driftCharge = 0;
    s.driftStage = 0;
  }

  /** Add (or extend) a speed boost. */
  giveBoost(duration: number, power: number): void {
    const s = this.state;
    s.boostPower = s.boostTimer > 0 ? Math.max(s.boostPower, power) : power;
    s.boostTimer = Math.max(s.boostTimer, duration);
  }

  /** Apply an item/collision hit. Returns false if the kart is currently immune. */
  applyHit(kind: HitKind): boolean {
    const s = this.state;
    if (isInvulnerable(s)) return false;
    this.endDrift(false);
    s.boostTimer = 0;
    s.boostPower = 0;
    s.jumpTrick = false;
    s.slipstreamCharge = s.slipstreamTimer = 0;
    s.coins = Math.max(0, s.coins - 3);
    if (kind === 'spin') s.spinTimer = HIT_DURATION.spin;
    if (kind === 'squish') s.squishTimer = HIT_DURATION.squish;
    if (kind === 'tumble') {
      s.tumbleTimer = HIT_DURATION.tumble;
      s.velocity.multiplyScalar(0.3);
      s.velocity.y = 8;
      s.grounded = false;
    }
    this.events.hit = kind;
    return true;
  }

  private updateStuck(input: PlayerInput, dt: number): void {
    const s = this.state;
    const trying = input.throttle > 0.5 || input.brake > 0.5;
    if (trying && s.grounded && Math.abs(s.forwardSpeed) < 1.2 && !isStunned(s)) s.stuckTime += dt;
    else s.stuckTime = 0;
  }

  /** Current speed cap including surface, boosts, coins and status effects. */
  private speedCap(): { vmax: number; gripMul: number; accelBoost: boolean } {
    const s = this.state;
    const st = this.stats;
    const surf = SURFACE_PARAMS[s.surface];
    const powered = s.boostTimer > 0 || s.invincibleTimer > 0 || s.rocketTimer > 0;
    // Boosts and invincibility ignore off-road slowdown.
    const speedMul = powered ? Math.max(1, surf.speedMul) : surf.speedMul;
    const gripMul = powered ? Math.max(1, surf.gripMul) : surf.gripMul;
    let vmax = st.maxSpeed * (1 + 0.006 * s.coins) * speedMul;
    if (s.shrinkTimer > 0) vmax *= 0.7;
    if (s.squishTimer > 0) vmax *= 0.45;
    if (s.invincibleTimer > 0) vmax += 4;
    if (s.boostTimer > 0) vmax += s.boostPower;
    if (s.rocketTimer > 0) vmax = st.maxSpeed + 17;
    return { vmax, gripMul, accelBoost: powered };
  }

  private groundDynamics(input: PlayerInput, dt: number, stunned: boolean): void {
    const s = this.state;
    const st = this.stats;
    const surf = SURFACE_PARAMS[s.surface];
    const n = s.groundNormal;
    const right = this.right.crossVectors(s.forward, s.up).normalize();

    // Decompose velocity in the ground plane.
    let vF = s.velocity.dot(s.forward);
    let vR = s.velocity.dot(right);

    const { vmax, gripMul, accelBoost } = this.speedCap();
    const throttle = stunned ? 0 : s.rocketTimer > 0 ? 1 : clamp(input.throttle, 0, 1);
    const brake = stunned ? 0 : clamp(input.brake, 0, 1);

    if (stunned) {
      // Spin-outs scrub almost all speed; tumbles stop the kart.
      vF = moveTowards(vF, 0, (s.tumbleTimer > 0 ? 30 : 20) * dt);
    } else if (throttle > 0.05 && brake < 0.5) {
      if (vF < -0.5) {
        vF += st.brakeDecel * throttle * dt;
      } else if (vF < vmax) {
        const rate = accelBoost ? Math.max(st.accelRate, 3.2) : st.accelRate;
        const accel = Math.max(st.accelMin, rate * (vmax - vF)) * throttle;
        vF = Math.min(vmax, vF + accel * dt);
      } else {
        vF -= (vF - vmax) * dampFactor(surf.overspeedDrag, dt);
      }
    } else if (brake > 0.05) {
      if (vF > 0.5) {
        vF = Math.max(0, vF - st.brakeDecel * brake * dt);
      } else {
        vF = Math.max(-st.reverseMaxSpeed, vF - st.reverseAccel * brake * dt);
      }
    } else {
      const coast = st.coastDecel + Math.abs(vF) * 0.06;
      vF = moveTowards(vF, 0, coast * dt);
      if (Math.abs(vF) > vmax) vF -= (vF - Math.sign(vF) * vmax) * dampFactor(surf.overspeedDrag, dt);
    }

    // Speed-sensitive steering: none at a standstill, full at mid speed, a bit less at top speed.
    const speed = Math.abs(vF);
    const authority =
      smoothstep(0, st.fullSteerSpeed, speed) * (1 - (1 - st.highSpeedTurn) * clamp(speed / st.maxSpeed, 0, 1));
    const direction = vF >= -0.1 ? 1 : -1;
    let grip = st.grip * gripMul;
    let yawRate: number;
    if (s.drifting) {
      // Drifting: always turning into the drift; stick only tightens or widens the arc.
      const tight = clamp(s.steer * s.driftDir, -1, 1);
      const arc = s.driftDir * (0.6 + 0.45 * tight);
      yawRate = -arc * st.turnRate * 1.12 * authority;
      grip *= 0.5;
      if (s.surface === SurfaceType.Road || s.surface === SurfaceType.Curb || s.surface === SurfaceType.Boost) {
        s.driftCharge += dt * (0.75 + 0.55 * Math.max(0, tight));
        const prev = s.driftStage;
        while (s.driftStage < 3 && s.driftCharge >= DRIFT_STAGE_CHARGE[s.driftStage + 1]!) s.driftStage++;
        if (s.driftStage !== prev) this.events.driftStageUp = s.driftStage;
      }
    } else {
      yawRate = -s.steer * st.turnRate * authority * direction;
    }
    s.forward.applyAxisAngle(s.up, yawRate * dt);

    // Lateral grip bleeds sideways velocity; the rotated heading carries forward speed with it.
    vR *= 1 - dampFactor(grip, dt);
    right.crossVectors(s.forward, s.up).normalize();
    s.velocity.copy(s.forward).multiplyScalar(vF).addScaledVector(right, vR);

    // Slopes: gravity component along the ground plane.
    const g = this.v1.set(0, -GRAVITY, 0);
    g.addScaledVector(n, -g.dot(n));
    s.velocity.addScaledVector(g, st.slopeFactor * dt);

    s.forwardSpeed = vF;
  }

  private airDynamics(input: PlayerInput, dt: number, stunned: boolean): void {
    const s = this.state;
    const st = this.stats;
    s.airTime += dt;
    s.velocity.y -= GRAVITY * dt;

    // Limited air steering keeps jumps controllable (drifts keep curving through hops).
    const vF = s.velocity.dot(s.forward);
    const airSteer = s.drifting ? s.driftDir * (0.6 + 0.45 * clamp(s.steer * s.driftDir, -1, 1)) : s.steer;
    const yawRate = -airSteer * st.turnRate * st.airControl * (vF >= 0 ? 1 : -1);
    s.forward.applyAxisAngle(s.up, yawRate * dt);

    // Throttle maintains air speed a little (arcade feel), no braking in the air.
    if (s.jumpFlight && !stunned) s.velocity.applyAxisAngle(WORLD_UP, yawRate * dt * 0.65);
    if (!stunned && input.throttle > 0.1) {
      const hv = this.v1.set(s.velocity.x, 0, s.velocity.z);
      const hs = hv.length();
      if (hs < st.maxSpeed * 0.9) s.velocity.addScaledVector(this.v2.copy(s.forward).setY(0).normalize(), 3 * dt);
    }

    // Self-right towards world up while flying.
    s.up.lerp(WORLD_UP, dampFactor(3, dt)).normalize();
    this.orthonormalize();
    s.forwardSpeed = s.velocity.dot(s.forward);
  }

  private integrateAgainstWalls(dt: number): void {
    const s = this.state;
    const center = this.v1.copy(s.position).addScaledVector(WORLD_UP, COLLIDER_HEIGHT);
    const desired = this.v2.copy(s.velocity).multiplyScalar(dt);
    const res = this.physics.moveAgainstWalls(this.collider, center, desired, this.move);
    s.position.add(res.movement);

    for (const c of res.contacts) {
      const vn = s.velocity.dot(c.normal);
      if (vn >= 0) continue;
      const impact = -vn;
      // Reflect the into-wall component, keep most of the tangential speed.
      s.velocity.addScaledVector(c.normal, -vn * (1 + this.stats.wallBounce));
      const headOn = clamp(impact / Math.max(1, s.velocity.length() + impact), 0, 1);
      s.velocity.multiplyScalar(1 - 0.35 * headOn);
      // Turn the nose away from the wall so you don't grind along it.
      const into = s.forward.dot(c.normal);
      if (into < -0.2) {
        const tangent = this.right.copy(s.forward).addScaledVector(c.normal, -into).normalize();
        s.forward.lerp(tangent, 0.35 * headOn + 0.1).normalize();
        this.orthonormalize();
      }
      this.events.wallHit = Math.max(this.events.wallHit, impact);
    }
  }

  private probeGround(force: boolean): void {
    const s = this.state;
    const origin = this.v1.copy(s.position).addScaledVector(WORLD_UP, PROBE_LIFT);
    const hit = this.physics.raycastGround(origin, PROBE_LENGTH, this.hit);
    const wasGrounded = s.grounded;

    if (!hit) {
      s.grounded = false;
      return;
    }

    const gap = s.position.y - hit.point.y;
    const vn = s.velocity.dot(hit.normal);
    const stick = force || (wasGrounded ? gap < STICK_DISTANCE : gap < LAND_DISTANCE);
    const movingAway = vn > 1.5 && !force;

    if (stick && !movingAway && hit.normal.y > 0.55) {
      s.grounded = true;
      s.position.y = hit.point.y;
      s.groundNormal.copy(hit.normal);
      s.surface = hit.surface;
      if (!wasGrounded) {
        this.events.landed = Math.max(0, -vn);
        s.airTime = 0;
        if (s.jumpFlight && s.jumpTrick && !isStunned(s)) {
          this.giveBoost(1.1, 7);
          this.events.miniTurbo = 1;
        }
        s.jumpFlight = s.jumpTrick = false;
      }
      // Remove velocity into/out of the surface.
      s.velocity.addScaledVector(hit.normal, -s.velocity.dot(hit.normal));
      s.up.lerp(hit.normal, dampFactor(14, FIXED_DT)).normalize();
      this.orthonormalize();
    } else {
      s.grounded = false;
      // Never sink through the ground when falling fast.
      if (gap < 0) {
        s.position.y = hit.point.y;
        if (s.velocity.y < 0) s.velocity.y = 0;
      }
    }
  }

  private orthonormalize(): void {
    const s = this.state;
    s.forward.addScaledVector(s.up, -s.forward.dot(s.up));
    if (s.forward.lengthSq() < 1e-6) s.forward.set(0, 0, 1).addScaledVector(s.up, -s.up.z);
    s.forward.normalize();
  }

  /** A forward crossing of the raised lip launches; driving beside it does not. */
  private launchFromRamp(): void {
    const s = this.state;
    if (s.jumpCooldown > 0 || s.forwardSpeed < 10 || s.airTime > 0.2 || isStunned(s)) return;
    for (const jump of this.track.def.jumps) {
      const lipDistance = this.track.startDistance + jump.distance + jump.length;
      const delta = this.track.wrapDistance(this.loc.splineDistance - lipDistance + 2);
      if (delta > 3.5 || Math.abs(this.loc.lateral - (jump.lateral ?? 0)) > jump.width / 2 - 0.3) continue;
      const lip = this.track.anchorToWorld({ distance: jump.distance + jump.length, lateral: this.loc.lateral });
      if (s.position.y < lip.position.y + jump.rise - 1.3 || s.position.y > lip.position.y + jump.rise + 2 || s.forward.dot(lip.tangent) < 0.7) continue;
      this.endDrift(false);
      s.position.y = Math.max(s.position.y, lip.position.y + jump.rise + 0.12);
      s.velocity.y = jump.launchSpeed;
      s.grounded = false;
      s.airTime = 0;
      s.jumpCooldown = 1.5;
      s.jumpFlight = true;
      s.jumpTrick = false;
      this.events.jumped = true;
      return;
    }
  }

  private updateTrackLocation(): void {
    const s = this.state;
    const loc = this.track.locate(s.position, s.trackIndex, 30, this.loc);
    // Outside the walls of the stretch we were on (shortcut across a hairpin, teleport):
    // search the whole lap — another part of the road may be the nearest now.
    const near = s.trackIndex >= 0 ? this.track.samples[s.trackIndex]!.wallOffset + 3 : 0;
    if (s.trackIndex < 0 || loc.distanceSq > near * near) {
      const windowIndex = loc.index;
      const windowD = loc.distanceSq;
      this.track.locate(s.position, -1, 0, this.loc);
      if (this.loc.distanceSq > windowD - 1) this.track.locate(s.position, windowIndex, 2, this.loc);
    }
    s.trackIndex = this.loc.index;
    const sample = this.track.samples[s.trackIndex]!;
    const onRoad = Math.abs(this.loc.lateral) < sample.halfWidth + 0.5 && s.grounded;
    if (onRoad) {
      s.safeTrackIndex = s.trackIndex;
      s.offTrackTicks = 0;
    } else if (!s.grounded) {
      s.offTrackTicks++;
    } else {
      s.offTrackTicks = 0;
    }
  }

  /**
   * Drop the kart back on the road centre. Defaults to a little behind the last safe
   * point so the kart isn't respawned right at the edge it fell from.
   */
  respawn(atIndex = this.state.safeTrackIndex - 3): void {
    const s = this.state;
    const sample = this.track.samples[this.track.wrapIndex(atIndex)]!;
    const pos = this.v1.copy(sample.position).addScaledVector(sample.up, 1.2);
    this.placeAt(pos, sample.tangent);
    this.endDrift(false);
    s.spinTimer = s.tumbleTimer = s.squishTimer = 0;
    s.stuckTime = 0;
    s.respawnTimer = 1.5;
    this.events.respawned = true;
  }
}
