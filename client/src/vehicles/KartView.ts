import {
  CanvasTexture,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  Vector4,
  type PerspectiveCamera,
  type WebGLRenderer,
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
import { GIANT_SCALE } from '@shared/race/RaceSimulation';
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
/** Name tags live on camera layers TAG_LAYER_FIRST + player slot (4 = spectator / TV camera). */
export const TAG_LAYER_FIRST = 1;
const TAG_FULL = 38;
const TAG_FAR = 70;
/** Tag height (m) at its natural size, and the most screen pixels it may cover (CSS px). */
const TAG_WORLD_HEIGHT = 0.7;
const TAG_MAX_PX = 24;
const tagPos = new Vector3();
const tagViewport = new Vector4();
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
  private readonly extraMaterials: MeshStandardMaterial[] = [];
  private wheelSpin = 0;
  private prevSpeed = 0;
  private accel = 0;
  private pitch = 0;
  private roll = 0;
  private squash = 0;
  private squashVel = 0;
  private lean = 0;
  private driftYaw = 0;
  private trickHeld = false;
  private trickTime = 0;
  private trickCount = 0;
  /** Set when a trick starts (the session adds a sparkle burst). */
  private trickFx = false;
  private giant = 1;
  private ghostOn = false;
  private ghostMats: Array<{ m: MeshStandardMaterial; transparent: boolean; opacity: number; depthWrite: boolean }> | null = null;
  private readonly carrier: Object3D;
  /** Seconds the carrier keeps flying off after letting go. */
  private carrierAway = 0;
  private lifting = false;
  private tag: Sprite | null = null;
  private tagKey = '';
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

    this.carrier = createItemModel('carrier');
    this.carrier.visible = false;
    this.root.add(this.carrier);

    const blobMat = new MeshBasicMaterial({ map: getBlobTexture(), transparent: true, depthWrite: false });
    blobMat.polygonOffset = true;
    blobMat.polygonOffsetFactor = -2;
    this.blob = new Mesh(new PlaneGeometry(2.6, 3.6), blobMat);
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.renderOrder = 1;
    this.blob.name = 'kart-contact-shadow';
  }

  /**
   * Free what this kart owns on the GPU: its cloned materials, the driver's topper
   * and scarf, the contact shadow. Shared model geometry and textures stay cached.
   */
  dispose(): void {
    for (const m of this.rig.materials) m.dispose();
    for (const m of this.extraMaterials) m.dispose();
    if (this.tag) {
      const mat = this.tag.material as SpriteMaterial;
      mat.map?.dispose();
      mat.dispose();
    }
    this.driver.dispose();
    this.blob.geometry.dispose();
    (this.blob.material as MeshBasicMaterial).dispose();
    this.root.removeFromParent();
    this.blob.removeFromParent();
  }

  /** Shader warm-up: a see-through copy beside the kart so the Phantom look is compiled too. */
  warmupLooks(): void {
    const copy = this.rig.root.clone(true);
    copy.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh || !(m.material instanceof MeshStandardMaterial)) return;
      const ghost = m.material.clone();
      ghost.transparent = true;
      ghost.opacity = 0.3;
      m.material = ghost;
      this.extraMaterials.push(ghost);
    });
    copy.position.x = 3;
    this.root.add(copy);
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
    if (k.jumpTrick && !this.trickHeld) {
      this.trickTime = 0.45;
      this.trickCount++;
      this.trickFx = true;
      this.driver.gesture('boost');
    }
    this.trickHeld = k.jumpTrick;
    if (s.grounded) this.trickTime = 0;
    if (this.trickTime > 0) {
      // Tricks alternate between a flat spin and a barrel roll.
      this.trickTime = Math.max(0, this.trickTime - dt);
      const turn = easeOut(1 - this.trickTime / 0.45) * Math.PI * 2;
      if (this.trickCount % 2) this.suspension.rotation.y += turn;
      else this.suspension.rotation.z += turn;
    }
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
    const blinkOff = s.respawnTimer > 0 && k.liftTimer <= 0 && Math.floor(s.respawnTimer * 12) % 2 === 1;
    this.status.visible = !blinkOff && k.rocketTimer <= 0;
    this.updateCarrier(k, dt);
    if (this.tag) this.tag.position.y = 1.5 + 2.2 * this.giant;
    this.updateGhost(k);

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
    this.giant = damp(this.giant, k.megaTimer > 0 ? GIANT_SCALE : 1, k.megaTimer > 0 ? 3.5 : 5, dt);
    const size = this.shrink * this.giant;
    this.status.scale.set(size * (1 + this.flat * 0.4), size * (1 - this.flat * 0.72), size * (1 + this.flat * 0.4));

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

  /**
   * Floating name / place tag over the kart. `hiddenLayer`: the camera layer of the
   * player driving this kart (they never see their own tag); tags fade with distance.
   */
  setTag(name: string, place: number, color: string, hiddenLayer: number | null): void {
    if (!this.tag) {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 64;
      const tex = new CanvasTexture(canvas);
      tex.colorSpace = SRGBColorSpace;
      const mat = new SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
      const tag = new Sprite(mat);
      tag.name = 'kart-tag';
      tag.scale.set(TAG_WORLD_HEIGHT * 4, TAG_WORLD_HEIGHT, 1);
      tag.position.y = 3.7;
      tag.renderOrder = 10;
      tag.layers.disableAll();
      for (let l = TAG_LAYER_FIRST; l <= TAG_LAYER_FIRST + 4; l++) if (l !== hiddenLayer) tag.layers.enable(l);
      tag.onBeforeRender = (renderer, _s, camera) => this.fitTag(renderer, camera as PerspectiveCamera);
      this.root.add(tag);
      this.tag = tag;
    }
    const key = `${place}|${name}|${color}`;
    if (key === this.tagKey) return;
    this.tagKey = key;
    const tex = (this.tag.material as SpriteMaterial).map as CanvasTexture;
    const c = tex.image as HTMLCanvasElement;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, 256, 64);
    g.font = '900 34px "Nunito", sans-serif';
    const text = name.length > 11 ? `${name.slice(0, 10)}…` : name;
    const w = Math.min(196, g.measureText(text).width) + 74;
    const x0 = (256 - w) / 2;
    g.fillStyle = 'rgba(27,20,70,0.78)';
    g.beginPath();
    g.roundRect(x0, 8, w, 48, 24);
    g.fill();
    g.fillStyle = color;
    g.beginPath();
    g.arc(x0 + 28, 32, 20, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#1b1446';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(place), x0 + 28, 34, 34);
    g.fillStyle = '#ffffff';
    g.textAlign = 'left';
    g.fillText(text, x0 + 56, 34, 196);
    tex.needsUpdate = true;
  }

  /**
   * Per view, just before the tag draws: a fixed small on-screen size (shrinking
   * with distance, never growing as karts close in), faded out when very close,
   * near the screen edges or in the lane straight ahead of your own kart.
   */
  private fitTag(renderer: WebGLRenderer, camera: PerspectiveCamera): void {
    const tag = this.tag!;
    const mat = tag.material as SpriteMaterial;
    const world = tag.getWorldPosition(tagPos);
    const d = camera.position.distanceTo(world);
    renderer.getCurrentViewport(tagViewport);
    const viewH = Math.max(1, tagViewport.w);
    const worldH = TAG_WORLD_HEIGHT;
    // Pixels the tag would cover at its natural world size; cap it.
    const span = 2 * d * Math.tan((camera.fov * Math.PI) / 360);
    const px = (worldH / span) * viewH;
    const cap = TAG_MAX_PX * renderer.getPixelRatio();
    const k = px > cap ? cap / px : 1;
    tag.scale.set(worldH * 4 * k, worldH * k, 1);
    tag.updateMatrixWorld();
    // Where it lands on screen.
    const ndc = tagPos.project(camera);
    let alpha = Math.min(1, (TAG_FAR - d) / (TAG_FAR - TAG_FULL), (d - 4) / 4);
    if (ndc.z > 1 || Math.abs(ndc.x) > 0.86 || Math.abs(ndc.y) > 0.9) alpha = 0;
    // Keep the lane right above your own kart clear.
    if (ndc.y > -0.65 && ndc.y < 0.3) alpha *= Math.min(1, Math.max(0.12, (Math.abs(ndc.x) - 0.08) / 0.12));
    mat.opacity = Math.max(0, alpha);
  }

  /** True once per trick start (consumed by the session for its sparkle burst). */
  takeTrick(): boolean {
    const t = this.trickFx;
    this.trickFx = false;
    return t;
  }

  /** Visual size multiplier (Giant Gummy) — the chase camera backs off to match. */
  get size(): number {
    return this.giant * this.shrink;
  }

  /** Pickup carrier: hangs over the kart while lowering it, then flies off. */
  private updateCarrier(k: KartState, dt: number): void {
    const lifting = k.liftTimer > 0;
    if (this.lifting && !lifting) this.carrierAway = 0.9;
    this.lifting = lifting;
    this.carrierAway = Math.max(0, this.carrierAway - dt);
    const c = this.carrier;
    c.visible = lifting || this.carrierAway > 0;
    if (!c.visible) return;
    const away = 1 - this.carrierAway / 0.9;
    c.position.set(Math.sin(this.time * 2.1) * 0.12, 3.9 + (lifting ? Math.sin(this.time * 3) * 0.08 : away * away * 9), 0);
    c.rotation.set(0, lifting ? 0 : away * 2, Math.sin(this.time * 2.6) * 0.06);
    c.scale.setScalar(1.3 * (lifting ? 1 : 1 - away * 0.6));
    const rotor = c.getObjectByName('rotor');
    if (rotor) rotor.rotation.y = this.time * 26;
    const hookParts = ['cable', 'hook'].map((n) => c.getObjectByName(n));
    for (const part of hookParts) if (part) part.visible = lifting;
  }

  /** Phantom: the kart turns see-through (flickering back just before it ends). */
  private updateGhost(k: KartState): void {
    const on = k.ghostTimer > 0;
    if (!on && !this.ghostOn) return;
    // Remember each material's own look the first time (some parts are already see-through).
    const mats = (this.ghostMats ??= [...this.rig.materials, ...this.driver.materials].map((m) => ({ m, transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite })));
    if (on !== this.ghostOn) {
      this.ghostOn = on;
      for (const g of mats) {
        g.m.transparent = on || g.transparent;
        g.m.depthWrite = on ? false : g.depthWrite;
        g.m.opacity = g.opacity;
        g.m.needsUpdate = true;
      }
    }
    if (on) {
      const flicker = k.ghostTimer < 0.8 && Math.floor(k.ghostTimer * 14) % 2 === 0;
      for (const g of mats) g.m.opacity = g.opacity * (flicker ? 0.75 : 0.3);
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
    this.blob.scale.setScalar((0.6 + 0.4 * k) * this.shrink * this.giant);
    (this.blob.material as MeshBasicMaterial).opacity = k;
  }
}

const tmpV = new Vector3();
