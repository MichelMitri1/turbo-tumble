import { Quaternion, Vector3 } from 'three';
import type { PhysicsWorld } from '@shared/physics/PhysicsWorld';
import type { Racer } from '@shared/race/RaceTypes';
import type { HitKind, KartState } from '@shared/vehicles/KartState';
import { kartQuaternion } from '@shared/vehicles/KartState';
import type { KartView, KartRenderState } from './KartView';
import type { ChaseTarget } from '../rendering/ChaseCamera';

/** Presentation events accumulated over all ticks in a frame. */
export interface FrameEvents {
  landed: number;
  wallHit: number;
  hopped: boolean;
  respawned: boolean;
  driftStarted: boolean;
  driftStageUp: number;
  miniTurbo: number;
  hit: HitKind | null;
}

/**
 * Presentation side of one racer: interpolates the fixed-tick simulation for
 * rendering and collects per-frame events for camera / VFX / HUD.
 */
export class KartEntity {
  readonly frameEvents: FrameEvents = { landed: 0, wallHit: 0, hopped: false, respawned: false, driftStarted: false, driftStageUp: 0, miniTurbo: 0, hit: null };
  readonly render: KartRenderState = {
    position: new Vector3(),
    quaternion: new Quaternion(),
    forwardSpeed: 0,
    speed01: 0,
    steer: 0,
    grounded: true,
    respawnTimer: 0,
    groundY: null,
  };
  readonly chase: ChaseTarget = {
    position: new Vector3(),
    forward: new Vector3(0, 0, 1),
    velocity: new Vector3(),
    forwardSpeed: 0,
    speed01: 0,
    grounded: true,
    boost: 0,
    drift: 0,
    size: 1,
  };
  private readonly prevPos = new Vector3();
  private readonly prevQuat = new Quaternion();
  private readonly curQuat = new Quaternion();
  private readonly tmp = new Vector3();
  /** Visual offset left over from an online reconciliation; decays to zero. */
  private readonly correction = new Vector3();

  constructor(
    readonly racer: Racer,
    readonly view: KartView,
    private readonly physics: PhysicsWorld,
  ) {
    this.beforeTick();
  }

  get state(): KartState {
    return this.racer.state;
  }

  /** Snapshot the pre-tick transform for interpolation. */
  beforeTick(): void {
    this.prevPos.copy(this.state.position);
    kartQuaternion(this.state, this.prevQuat);
  }

  /** Fold this tick's simulation events into the frame's events. */
  afterTick(): void {
    const ev = this.racer.sim.events;
    const fe = this.frameEvents;
    fe.landed = Math.max(fe.landed, ev.landed);
    fe.wallHit = Math.max(fe.wallHit, ev.wallHit);
    fe.hopped ||= ev.hopped;
    fe.respawned ||= ev.respawned;
    fe.driftStarted ||= ev.driftStarted;
    fe.driftStageUp = Math.max(fe.driftStageUp, ev.driftStageUp);
    fe.miniTurbo = Math.max(fe.miniTurbo, ev.miniTurbo);
    fe.hit = ev.hit ?? fe.hit;
    // A teleport must not be interpolated across.
    if (ev.respawned) this.beforeTick();
  }

  /** Manual reset (R / View button): back onto the road at the nearest point. */
  reset(): void {
    const s = this.state;
    this.racer.sim.respawn(s.trackIndex >= 0 ? s.trackIndex : s.safeTrackIndex);
    this.frameEvents.respawned = true;
    this.beforeTick();
  }

  /**
   * The authoritative state moved the kart by `delta` (online reconciliation).
   * Small moves are smoothed out over a few frames; big ones (respawns) snap.
   */
  applyCorrection(delta: Vector3): void {
    if (delta.lengthSq() > 8 * 8) {
      this.correction.set(0, 0, 0);
      this.beforeTick();
      return;
    }
    this.prevPos.add(delta);
    this.correction.sub(delta);
  }

  /** Bleed off the reconciliation offset (call once per frame). */
  decayCorrection(dt: number): void {
    if (this.correction.lengthSq() < 1e-8) return;
    this.correction.multiplyScalar(Math.exp(-dt * 12));
  }

  clearFrameEvents(): void {
    const fe = this.frameEvents;
    fe.landed = 0;
    fe.wallHit = 0;
    fe.hopped = false;
    fe.respawned = false;
    fe.driftStarted = false;
    fe.driftStageUp = 0;
    fe.miniTurbo = 0;
    fe.hit = null;
  }

  /** Build interpolated render/camera state for blend factor `alpha` (0..1). */
  interpolate(alpha: number): void {
    const s = this.state;
    const r = this.render;
    kartQuaternion(s, this.curQuat);
    r.position.lerpVectors(this.prevPos, s.position, alpha).add(this.correction);
    r.quaternion.slerpQuaternions(this.prevQuat, this.curQuat, alpha);
    r.forwardSpeed = s.forwardSpeed;
    r.speed01 = Math.abs(s.forwardSpeed) / this.racer.sim.stats.maxSpeed;
    r.steer = s.steer;
    r.grounded = s.grounded;
    r.respawnTimer = s.respawnTimer;
    const hit = this.physics.raycastGround(this.tmp.copy(r.position).setY(r.position.y + 1.5), 40);
    r.groundY = hit ? hit.point.y : null;

    const c = this.chase;
    c.position.copy(r.position);
    c.forward.set(0, 0, 1).applyQuaternion(r.quaternion);
    c.velocity.copy(s.velocity);
    c.forwardSpeed = s.forwardSpeed;
    c.speed01 = r.speed01;
    c.grounded = s.grounded;
    c.boost = s.rocketTimer > 0 ? 1.3 : s.boostTimer > 0 ? 1 : 0;
    c.drift = s.drifting ? s.driftDir : 0;
    c.size = this.view.size;
  }
}
