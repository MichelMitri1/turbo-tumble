import { Matrix4, Quaternion, Vector3 } from 'three';
import { SurfaceType } from '../types/surface';

export type HitKind = 'spin' | 'tumble' | 'squish';

/** Full simulation state of one kart. Plain data so it can be snapshotted / networked. */
export interface KartState {
  position: Vector3;
  velocity: Vector3;
  /** Unit heading, kept orthogonal to `up`. */
  forward: Vector3;
  /** Unit kart up (smoothed ground normal on the ground, drifts to world up in the air). */
  up: Vector3;
  grounded: boolean;
  groundNormal: Vector3;
  surface: SurfaceType;
  airTime: number;
  /** Smoothed steering (-1..1). */
  steer: number;
  /** Signed speed along `forward` (m/s). */
  forwardSpeed: number;
  /** Drift button state last tick (edge detection). */
  driftHeld: boolean;
  /** Ticks airborne without progress (respawn heuristic). */
  offTrackTicks: number;
  /** Seconds with throttle held but barely moving (stuck heuristic). */
  stuckTime: number;
  /** Last track sample index (tracking hint). */
  trackIndex: number;
  /** Last sample index where the kart was safely on the road (respawn point). */
  safeTrackIndex: number;
  /** Seconds of post-respawn grace (blinking, no hits). */
  respawnTimer: number;

  // --- Drift / mini-turbo
  drifting: boolean;
  /** -1 left, +1 right. */
  driftDir: number;
  /** Seconds of charge accumulated in this drift. */
  driftCharge: number;
  /** 0 none, 1 cyan, 2 orange, 3 magenta. */
  driftStage: number;

  // --- Boost
  boostTimer: number;
  /** Extra top speed while boosting (m/s). */
  boostPower: number;

  // --- Status effects (seconds remaining)
  spinTimer: number;
  tumbleTimer: number;
  squishTimer: number;
  invincibleTimer: number;
  shrinkTimer: number;
  rocketTimer: number;
  inkTimer: number;
  /** 0..10 — each coin adds a little top speed. */
  coins: number;
}

/** Per-tick events produced by the simulation for presentation (camera, VFX, audio). */
export interface KartEvents {
  /** Downward speed at touchdown, 0 if no landing this tick. */
  landed: number;
  /** Impact speed into a wall, 0 if none. */
  wallHit: number;
  hopped: boolean;
  respawned: boolean;
  /** Drift started this tick. */
  driftStarted: boolean;
  /** Spark stage reached this tick (0 if unchanged). */
  driftStageUp: number;
  /** Mini-turbo stage fired this tick (0 if none). */
  miniTurbo: number;
  /** Hit received this tick. */
  hit: HitKind | null;
}

export function createKartState(): KartState {
  return {
    position: new Vector3(),
    velocity: new Vector3(),
    forward: new Vector3(0, 0, 1),
    up: new Vector3(0, 1, 0),
    grounded: false,
    groundNormal: new Vector3(0, 1, 0),
    surface: SurfaceType.Road,
    airTime: 0,
    steer: 0,
    forwardSpeed: 0,
    driftHeld: false,
    offTrackTicks: 0,
    stuckTime: 0,
    trackIndex: -1,
    safeTrackIndex: 0,
    respawnTimer: 0,
    drifting: false,
    driftDir: 0,
    driftCharge: 0,
    driftStage: 0,
    boostTimer: 0,
    boostPower: 0,
    spinTimer: 0,
    tumbleTimer: 0,
    squishTimer: 0,
    invincibleTimer: 0,
    shrinkTimer: 0,
    rocketTimer: 0,
    inkTimer: 0,
    coins: 0,
  };
}

export function createKartEvents(): KartEvents {
  return { landed: 0, wallHit: 0, hopped: false, respawned: false, driftStarted: false, driftStageUp: 0, miniTurbo: 0, hit: null };
}

/** True while the kart has no control (spinning out or tumbling). Squished karts still drive, slowly. */
export function isStunned(s: KartState): boolean {
  return s.spinTimer > 0 || s.tumbleTimer > 0;
}

/** True while hits are ignored. */
export function isInvulnerable(s: KartState): boolean {
  return s.invincibleTimer > 0 || s.rocketTimer > 0 || s.respawnTimer > 0;
}

const xAxis = new Vector3();
const zAxis = new Vector3();
const basis = new Matrix4();

/** Orientation quaternion from the forward/up basis (+Z forward, +Y up — matches the kart models). */
export function kartQuaternion(state: KartState, out: Quaternion): Quaternion {
  xAxis.crossVectors(state.up, state.forward).normalize();
  zAxis.crossVectors(xAxis, state.up).normalize();
  basis.makeBasis(xAxis, state.up, zAxis);
  return out.setFromRotationMatrix(basis);
}
