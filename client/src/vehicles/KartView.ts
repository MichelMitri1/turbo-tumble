import {
  CanvasTexture,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type Object3D,
  type Texture,
} from 'three';
import { clamp, damp } from '@shared/math/scalar';
import { HIT_DURATION } from '@shared/vehicles/KartSimulation';
import type { KartState } from '@shared/vehicles/KartState';
import type { KartRig } from './KartModelFactory';
import { KART_MODEL_SCALE } from '../config/roster';
import { createItemModel, type ModelKey } from '../items/ItemModels';
import { DriverRig, type DriverGesture, type DriverMood } from './DriverRig';

/** Where an active timed item is shown on the kart. */
const ACCESSORY_MOUNT: Partial<Record<ModelKey, { pos: [number, number, number]; scale: number }>> = {
  snapper: { pos: [0, 1.7, 1.75], scale: 2.0 },
  ember: { pos: [0, 3.3, 0], scale: 0.9 },
  fizzGold: { pos: [0, 3.4, 0], scale: 1.1 },
};

/** Render-interpolated kart data consumed by the view each frame. */
export interface KartRenderState {
  position: Vector3;
  quaternion: Quaternion;
  forwardSpeed: number;
  speed01: number;
  steer: number;
  grounded: boolean;
  respawnTimer: number;
  /** Ground height under the kart (for the contact shadow), or null. */
  groundY: number | null;
}

const WHEEL_RADIUS = 0.21 * KART_MODEL_SCALE;
const DRIFT_YAW = 0.42;

let blobTexture: Texture | null = null;
function getBlobTexture(): Texture {
  if (blobTexture) return blobTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 62);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.6, 'rgba(0,0,0,0.28)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  blobTexture = new CanvasTexture(c);
  return blobTexture;
}

const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);

/**
 * Visual kart: follows the simulated transform and adds cosmetic motion
 * (suspension, drift yaw, wheel spin & steer, driver lean) plus status looks
 * (spin-out, tumble, shrink, squish, invincibility shimmer, Jet Rocket form).
 */
export class KartView {
  readonly root = new Group();
  private readonly status = new Group();
  private readonly suspension = new Group();
  private readonly blob: Mesh;
  private readonly rocket: Object3D;
  private readonly baseEmissive: Color[];
  private wheelSpin = 0;
  private prevSpeed = 0;
  private accel = 0;
  private pitch = 0;
  private roll = 0;
  private squash = 0;
  private squashVel = 0;
  private lean = 0;
  private driftYaw = 0;
  private shrink = 1;
  private flat = 0;
  private time = 0;
  private readonly hue = new Color();
  private accessory: Object3D | null = null;
  private accessoryKey: ModelKey | null = null;
  private readonly driver: DriverRig;
  /** Set by the session during the countdown (drivers bounce in anticipation). */
  countdown = false;

  constructor(private readonly rig: KartRig) {
    this.root.name = rig.root.name;
    this.suspension.add(rig.root);
    this.status.add(this.suspension);
    this.root.add(this.status);

    this.rocket = createItemModel('rocketKart');
    this.rocket.scale.setScalar(2.4);
    this.rocket.position.y = 1.1;
    this.rocket.visible = false;
    this.root.add(this.rocket);
    this.baseEmissive = rig.materials.map((m) => m.emissive.clone());
    this.driver = new DriverRig(rig.character, rig.characterId, rig.color);

    const blobMat = new MeshBasicMaterial({ map: getBlobTexture(), transparent: true, depthWrite: false });
    blobMat.polygonOffset = true;
    blobMat.polygonOffsetFactor = -2;
    this.blob = new Mesh(new PlaneGeometry(2.6, 3.6), blobMat);
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.renderOrder = 1;
    this.blob.name = 'kart-contact-shadow';
  }

  /** The contact shadow lives in world space (not tilted with the kart). */
  get contactShadow(): Mesh {
    return this.blob;
  }

  /** Landing impact (m/s) → squash & stretch. */
  land(impact: number): void {
    this.squashVel -= clamp(impact * 0.045, 0, 0.6);
    this.driver.jolt(clamp(impact * 0.08, 0, 1.5));
  }

  /** Driver body language for race moments (items, hits, starts). */
  gesture(kind: DriverGesture): void {
    this.driver.gesture(kind);
  }

  /** After the finish: celebrate, sulk, or keep racing. */
  setMood(mood: DriverMood): void {
    this.driver.setMood(mood);
  }

  /** A projectile is closing in from behind (side: +1 look over the right shoulder). */
  setThreat(active: boolean, side = 1): void {
    this.driver.setThreat(active, side);
  }

  /** Wall hit → quick wobble. */
  bump(impact: number): void {
    this.squashVel -= clamp(impact * 0.02, 0, 0.25);
    this.roll += clamp(impact * 0.01, 0, 0.12) * (Math.random() < 0.5 ? -1 : 1);
  }

  /** Show the active timed item (Snapper Pot, Ember Blaster, Golden Fizz) on the kart. */
  setAccessory(key: ModelKey | null): void {
    if (key === this.accessoryKey) return;
    if (this.accessory) this.status.remove(this.accessory);
    this.accessory = null;
    this.accessoryKey = key;
    const mount = key ? ACCESSORY_MOUNT[key] : undefined;
    if (!key || !mount) return;
    this.accessory = createItemModel(key);
    this.accessory.position.set(...mount.pos);
    this.accessory.scale.setScalar(mount.scale);
    this.status.add(this.accessory);
  }

  /** Mini-turbo / boost kick: nose lifts. */
  kick(strength: number): void {
    this.squashVel += strength * 0.15;
    this.pitch -= strength * 0.05;
    if (strength >= 2) this.driver.gesture('boost');
  }

  update(s: KartRenderState, k: KartState, dt: number): void {
    this.time += dt;
    this.root.position.copy(s.position);
    this.root.quaternion.copy(s.quaternion);

    // Longitudinal acceleration (smoothed) drives pitch: nose lifts on throttle, dips on brake.
    const rawAccel = dt > 0 ? (s.forwardSpeed - this.prevSpeed) / dt : 0;
    this.prevSpeed = s.forwardSpeed;
    this.accel = damp(this.accel, clamp(rawAccel, -40, 40), 8, dt);
    const targetPitch = s.grounded ? clamp(-this.accel * 0.0035, -0.06, 0.05) : -0.04;
    this.pitch = damp(this.pitch, targetPitch, 10, dt);

    // Body rolls slightly outward in turns; the driver leans in. Drifts swing the nose in.
    const turnLoad = (k.drifting ? k.driftDir : s.steer) * clamp(s.speed01 * 1.4, 0, 1);
    this.roll = damp(this.roll, -turnLoad * (k.drifting ? 0.08 : 0.045), 8, dt);
    this.lean = damp(this.lean, turnLoad * 0.22, 9, dt);
    this.driftYaw = damp(this.driftYaw, k.drifting ? -k.driftDir * DRIFT_YAW : 0, k.drifting ? 9 : 6, dt);

    // Squash spring.
    this.squashVel += (-160 * this.squash - 14 * this.squashVel) * dt;
    this.squash += this.squashVel * dt;
    const sq = clamp(this.squash, -0.35, 0.35);

    // Engine idle shimmy (+ drift rumble).
    const idle =
      Math.sin(this.time * 38) * 0.012 * (1 - clamp(s.speed01 * 3, 0, 1)) +
      Math.sin(this.time * 23) * 0.006 * clamp(s.speed01, 0, 1) +
      (k.drifting ? Math.sin(this.time * 47) * 0.02 : 0);

    this.suspension.rotation.set(this.pitch, this.driftYaw, this.roll);
    this.suspension.position.y = idle;
    this.suspension.scale.set(1 - sq * 0.5, 1 + sq, 1 - sq * 0.5);

    this.applyStatus(k, dt);

    // Wheels.
    this.wheelSpin += (s.forwardSpeed / WHEEL_RADIUS) * dt;
    const steerVis = k.drifting ? k.driftDir * 0.15 - (k.steer - k.driftDir) * 0.25 : s.steer;
    for (const w of this.rig.wheels) {
      w.node.rotation.x = this.wheelSpin;
      w.node.rotation.y = w.front ? -steerVis * 0.42 : 0;
    }

    // Driver.
    this.driver.update({
      dt,
      lean: this.lean,
      pitch: this.pitch,
      steer: s.steer,
      speed01: s.speed01,
      accel: this.accel,
      airborne: !s.grounded,
      stunned: k.spinTimer > 0 || k.tumbleTimer > 0,
      countdown: this.countdown,
    });

    // Respawn blink.
    const blinkOff = s.respawnTimer > 0 && Math.floor(s.respawnTimer * 12) % 2 === 1;
    this.status.visible = !blinkOff && k.rocketTimer <= 0;

    this.updateShadow(s);
  }

  private applyStatus(k: KartState, dt: number): void {
    // Spin-out: two full turns easing out. Tumble: a full forward flip.
    const spinT = k.spinTimer > 0 ? 1 - k.spinTimer / HIT_DURATION.spin : 0;
    const tumbleT = k.tumbleTimer > 0 ? 1 - k.tumbleTimer / HIT_DURATION.tumble : 0;
    this.status.rotation.set(tumbleT > 0 ? -easeOut(tumbleT) * Math.PI * 2 : 0, spinT > 0 ? easeOut(spinT) * Math.PI * 4 : 0, 0);
    this.status.position.y = tumbleT > 0 ? Math.sin(tumbleT * Math.PI) * 0.8 : 0;

    // Shrink / squish.
    this.shrink = damp(this.shrink, k.shrinkTimer > 0 ? 0.55 : 1, 6, dt);
    this.flat = damp(this.flat, k.squishTimer > 0 ? 1 : 0, k.squishTimer > 0 ? 25 : 4, dt);
    this.status.scale.set(this.shrink * (1 + this.flat * 0.4), this.shrink * (1 - this.flat * 0.72), this.shrink * (1 + this.flat * 0.4));

    // Invincibility shimmer.
    const mats = this.rig.materials;
    if (k.invincibleTimer > 0) {
      this.hue.setHSL((this.time * 1.6) % 1, 1, 0.5);
      const pulse = k.invincibleTimer < 1.5 ? (Math.sin(this.time * 30) > 0 ? 0.9 : 0.15) : 0.75;
      for (const m of mats) {
        m.emissive.copy(this.hue);
        m.emissiveIntensity = pulse;
      }
    } else if (k.respawnTimer <= 0) {
      mats.forEach((m, i) => {
        m.emissive.copy(this.baseEmissive[i]!);
        m.emissiveIntensity = 1;
      });
    }

    // Timed-item accessory animation.
    if (this.accessory) {
      if (this.accessoryKey === 'snapper') {
        const bite = Math.max(0, Math.sin(this.time * 9));
        const top = this.accessory.getObjectByName('jawTop');
        const bottom = this.accessory.getObjectByName('jawBottom');
        if (top) top.rotation.x = -0.15 - bite * 0.6;
        if (bottom) bottom.rotation.x = 0.1 + bite * 0.4;
      } else {
        this.accessory.rotation.y = this.time * 3;
        this.accessory.position.y = (ACCESSORY_MOUNT[this.accessoryKey!]?.pos[1] ?? 3) + Math.sin(this.time * 4) * 0.12;
      }
    }

    // Jet Rocket form.
    this.rocket.visible = k.rocketTimer > 0;
    if (this.rocket.visible) {
      this.rocket.rotation.z = Math.sin(this.time * 6) * 0.08;
      const flame = this.rocket.getObjectByName('flame');
      if (flame) flame.scale.set(1, 1, 0.8 + Math.random() * 0.6);
    }
  }

  private updateShadow(s: KartRenderState): void {
    if (s.groundY === null) {
      this.blob.visible = false;
      return;
    }
    const h = Math.max(0, s.position.y - s.groundY);
    this.blob.visible = h < 12;
    this.blob.position.set(s.position.x, s.groundY + 0.04, s.position.z);
    const fwd = tmpV.set(0, 0, 1).applyQuaternion(s.quaternion);
    this.blob.rotation.set(-Math.PI / 2, 0, Math.atan2(fwd.x, fwd.z));
    const k = clamp(1 - h / 12, 0, 1);
    this.blob.scale.setScalar((0.6 + 0.4 * k) * this.shrink);
    (this.blob.material as MeshBasicMaterial).opacity = k;
  }
}

const tmpV = new Vector3();
