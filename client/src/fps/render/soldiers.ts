import * as THREE from 'three';
import { WEAPON } from '../sim/weapons';
import { cloneModel, gunBounds, soldierRig, type SoldierRig } from './assets';
import { applyCamo } from './camo';

/** What the renderer needs to pose another player. */
export interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  vx: number;
  vz: number;
  crouch: boolean;
  sprint: boolean;
  slide: boolean;
  ads: boolean;
  alive: boolean;
  weapon: string;
  camo: string;
  reloading: boolean;
}

const UP = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);
const tq = new THREE.Quaternion();
const tv = new THREE.Vector3();
/** At most this many bones get a hand tweak per frame (torso, chest, four leg bones). */
const MAX_TWEAKS = 6;

/** A third-person soldier: SWAT rig, team colours, the real weapon in hand. */
export class SoldierView {
  readonly root = new THREE.Group();
  private rig: SoldierRig;
  private actions = new Map<string, THREE.AnimationAction>();
  private current = '';
  private gun: THREE.Object3D | null = null;
  private deadT = 0;
  private wasAlive = true;
  private fireT = 0;
  readonly head = new THREE.Vector3();
  readonly muzzle = new THREE.Vector3();

  constructor(readonly team: 0 | 1) {
    this.rig = soldierRig(team);
    const s = 1.8 / this.rig.height;
    this.rig.root.scale.setScalar(s);
    this.root.add(this.rig.root);
    for (const [name, clip] of this.rig.clips) {
      const a = this.rig.mixer.clipAction(clip);
      if (name === 'Death') {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
      this.actions.set(name, a);
    }
    this.play('Idle_Gun_Pointing', 0);
  }

  private play(name: string, fade = 0.18): void {
    if (name === this.current) return;
    const next = this.actions.get(name);
    if (!next) return;
    const prev = this.actions.get(this.current);
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    if (prev) prev.fadeOut(fade);
    this.current = name;
  }

  fired(): void {
    this.fireT = 0.08;
  }

  private gunWeapon = '';
  private gunCamo = '';
  private needsMount = true;

  private setGun(weapon: string, camo: string): void {
    if (weapon === this.gunWeapon && camo === this.gunCamo && !this.needsMount) return;
    const def = WEAPON[weapon];
    const hand = this.rig.bones.WristR;
    if (!def || !hand) return;
    this.gunWeapon = weapon;
    this.gunCamo = camo;
    if (this.gun) this.gun.removeFromParent();
    const g = cloneModel(def.model);
    applyCamo(g, camo);
    const b = gunBounds(def.model);
    const len = b.max.x - b.min.x;
    const gripX = b.min.x + len * (def.cls === 'pistol' ? 0.22 : 0.36);
    const gripY = b.min.y + (b.max.y - b.min.y) * 0.25;
    g.position.set(-gripX * def.scale, -gripY * def.scale, 0);
    g.scale.setScalar(def.scale);
    const holder = new THREE.Group();
    holder.add(g);
    // Mount so the muzzle points where the soldier faces, in the current (aiming) hand pose:
    // world = hand · offset  →  offset = hand⁻¹ · desired.
    this.root.updateMatrixWorld(true);
    const hq = new THREE.Quaternion();
    hand.getWorldQuaternion(hq);
    const hs = new THREE.Vector3();
    hand.getWorldScale(hs);
    const f = new THREE.Vector3(0, 0, 1).applyQuaternion(this.root.quaternion).normalize();
    const side = new THREE.Vector3().crossVectors(f, UP).normalize();
    const desired = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(f, UP, side));
    holder.quaternion.copy(hq.invert().multiply(desired));
    holder.scale.setScalar(1 / (hs.x || 1));
    holder.position.set(0, 0.08 / (hs.x || 1), 0);
    hand.add(holder);
    this.gun = holder;
    this.needsMount = false;
  }

  /** Bones we tweak by hand get their animated pose back before each mixer update (preallocated: no garbage per frame). */
  private savedBones: THREE.Bone[] = [];
  private savedQ = Array.from({ length: MAX_TWEAKS }, () => new THREE.Quaternion());
  private tweak(bone: THREE.Bone | undefined, axis: THREE.Vector3, angle: number): void {
    if (!bone || !angle || this.savedBones.length >= MAX_TWEAKS) return;
    this.savedQ[this.savedBones.length]!.copy(bone.quaternion);
    this.savedBones.push(bone);
    bone.quaternion.multiply(tq.setFromAxisAngle(axis, angle));
  }

  update(p: Pose, dt: number): void {
    this.savedBones.forEach((bone, i) => bone.quaternion.copy(this.savedQ[i]!));
    this.savedBones.length = 0;
    this.root.position.set(p.x, p.y, p.z);
    this.root.rotation.y = p.yaw + Math.PI;
    // Animation choice.
    if (!p.alive) {
      if (this.wasAlive) {
        this.deadT = 0;
        this.play('Death', 0.1);
      }
      this.deadT += dt;
      this.wasAlive = false;
      this.rig.mixer.update(dt);
      return;
    }
    this.wasAlive = true;
    const speed = Math.hypot(p.vx, p.vz);
    // Local velocity (forward = −z rotated by yaw).
    const sy = Math.sin(p.yaw);
    const cy = Math.cos(p.yaw);
    const fwd = -sy * p.vx - cy * p.vz;
    const right = cy * p.vx - sy * p.vz;
    this.fireT -= dt;
    let anim = 'Idle_Gun_Pointing';
    if (speed > 0.6) {
      if (p.sprint) anim = 'Run';
      else if (Math.abs(right) > Math.abs(fwd) * 1.2) anim = right > 0 ? 'Run_Right' : 'Run_Left';
      else if (fwd < -0.3) anim = 'Run_Back';
      else anim = speed > 3.5 ? 'Run_Shoot' : 'Walk';
    } else if (this.fireT > 0) anim = 'Idle_Gun_Shoot';
    this.play(anim);
    const a = this.actions.get(this.current);
    if (a && (anim === 'Run' || anim.startsWith('Run_'))) a.timeScale = Math.max(0.6, speed / 5);
    this.rig.mixer.update(dt);
    // The gun is mounted once, in the aiming pose.
    if (this.needsMount || p.weapon !== this.gunWeapon || p.camo !== this.gunCamo) {
      if (this.current === 'Idle_Gun_Pointing' || !this.gun) this.setGun(p.weapon, p.camo);
    }
    // Aim pitch through the upper body; crouch by bending the legs.
    const b = this.rig.bones;
    this.tweak(b.Torso, X, -p.pitch * 0.5);
    this.tweak(b.Chest, X, -p.pitch * 0.35);
    if (p.crouch || p.slide) {
      const k = p.slide ? 1.2 : 1;
      this.tweak(b.UpperLegL, X, -1.2 * k);
      this.tweak(b.UpperLegR, X, -0.7 * k);
      this.tweak(b.LowerLegL, X, 1.5 * k);
      this.tweak(b.LowerLegR, X, 1.9 * k);
      this.rig.root.position.y = -0.42 * k;
    } else this.rig.root.position.y = 0;
    // Head / muzzle world positions (name tags, tracers).
    this.root.updateMatrixWorld(true);
    if (b.Head) b.Head.getWorldPosition(this.head);
    if (this.gun) {
      this.muzzle.set(0, 0, 0);
      this.gun.localToWorld(this.muzzle);
      this.muzzle.addScaledVector(tv.set(-Math.sin(p.yaw), Math.sin(p.pitch), -Math.cos(p.yaw)).normalize(), 0.6);
    } else this.muzzle.set(p.x, p.y + 1.4, p.z);
  }

  dispose(): void {
    this.root.removeFromParent();
    this.rig.mixer.stopAllAction();
    // The rig's materials and skeletons (bone textures) are per-soldier; geometry is shared with the model cache.
    for (const m of this.rig.materials) m.dispose();
    this.rig.root.traverse((n) => (n as THREE.SkinnedMesh).skeleton?.dispose());
  }
}
