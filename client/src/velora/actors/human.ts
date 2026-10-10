import * as THREE from 'three';
import { assets, type PersonModel } from '../assets';

/**
 * One animated person (player, pedestrian, cop): a Quaternius character with the shared
 * animation set, a gun that sits in the right hand while armed, and simple ragdoll-ish
 * deaths (the death animation plus a shove).
 */

export type Pose = 'idle' | 'walk' | 'run' | 'sprint' | 'aim' | 'aimRun' | 'punch' | 'hit' | 'dead' | 'roll' | 'wave' | 'cower' | 'interact' | 'sit' | 'jump';
const CLIP: Record<Pose, string> = {
  idle: 'Idle',
  walk: 'Walk',
  run: 'Run',
  sprint: 'Run',
  aim: 'Idle_Gun_Pointing',
  aimRun: 'Run_Shoot',
  punch: 'Punch_Right',
  hit: 'HitRecieve',
  dead: 'Death',
  roll: 'Roll',
  wave: 'Wave',
  cower: 'HitRecieve',
  interact: 'Interact',
  sit: 'Idle_Neutral',
  jump: 'Roll',
};
const ONCE: Pose[] = ['punch', 'hit', 'dead', 'roll', 'interact'];

/** Gun models and how they sit (model units → metres; grip along the barrel). */
export interface GunLook {
  model: string;
  scale: number;
  grip: number;
}

const UP = new THREE.Vector3(0, 1, 0);

export class Human {
  readonly root = new THREE.Group();
  readonly model: THREE.Object3D;
  private mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private current = '';
  pose: Pose = 'idle';
  private hand: THREE.Object3D | null = null;
  private gun: THREE.Object3D | null = null;
  private gunKey = '';
  /** Facing (radians, 0 = +z). */
  heading = 0;
  private visualHeading = 0;
  private fireT = 0;

  constructor(readonly person: PersonModel) {
    this.model = assets.person(person);
    this.model.scale.setScalar(0.97);
    this.root.add(this.model);
    this.mixer = new THREE.AnimationMixer(this.model);
    for (const c of assets.clips) this.actions.set(c.name, this.mixer.clipAction(c));
    this.model.traverse((o) => {
      if (!this.hand && /WristR|Wrist_R|HandR/.test(o.name)) this.hand = o;
    });
    this.play('idle');
  }

  play(p: Pose, speed = 1): void {
    this.pose = p;
    const name = CLIP[p];
    const a = this.actions.get(name);
    if (!a) return;
    a.timeScale = speed;
    if (name === this.current) return;
    const prev = this.actions.get(this.current);
    a.reset();
    if (ONCE.includes(p)) {
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
    } else a.setLoop(THREE.LoopRepeat, Infinity);
    a.setEffectiveWeight(1).fadeIn(0.15).play();
    if (prev) prev.fadeOut(0.15);
    this.current = name;
  }

  /** Is a one-shot animation still playing? */
  busy(): boolean {
    const a = this.actions.get(this.current);
    return !!a && a.loop === THREE.LoopOnce && a.isRunning();
  }

  /** Hold a gun (null = empty hands). Mounted once the arm is in an aiming pose. */
  holdGun(look: GunLook | null): void {
    const key = look ? look.model : '';
    if (key === this.gunKey) return;
    this.gunKey = key;
    this.gun?.removeFromParent();
    this.gun = null;
  }

  private mountGun(look: GunLook): void {
    if (!this.hand) return;
    const g = assets.gun(look.model);
    const box = new THREE.Box3().setFromObject(g);
    const len = box.max.x - box.min.x;
    const gripX = box.min.x + len * look.grip;
    const gripY = box.min.y + (box.max.y - box.min.y) * 0.25;
    g.position.set(-gripX * look.scale, -gripY * look.scale, 0);
    g.scale.setScalar(look.scale);
    const holder = new THREE.Group();
    holder.add(g);
    // Muzzle along the facing direction in the aiming pose: offset = hand⁻¹ · desired.
    // Evaluate the aiming pose for a moment, then go back to whatever was playing.
    const aim = this.actions.get('Idle_Gun_Pointing');
    const was = this.current;
    this.mixer.stopAllAction();
    aim?.reset().setEffectiveWeight(1).play();
    this.mixer.update(0);
    this.root.rotation.y = this.visualHeading;
    this.root.updateMatrixWorld(true);
    const hq = new THREE.Quaternion();
    this.hand.getWorldQuaternion(hq);
    const hs = new THREE.Vector3();
    this.hand.getWorldScale(hs);
    const f = new THREE.Vector3(0, 0, 1).applyQuaternion(this.root.quaternion).normalize();
    const side = new THREE.Vector3().crossVectors(f, UP).normalize();
    const desired = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(f, UP, side));
    holder.quaternion.copy(hq.invert().multiply(desired));
    holder.scale.setScalar(1 / (hs.x || 1));
    holder.position.set(0, 0.08 / (hs.x || 1), 0);
    this.hand.add(holder);
    this.gun = holder;
    aim?.stop();
    this.current = '';
    const back = this.pose;
    this.play(back);
    void was;
  }

  private pendingLook: GunLook | null = null;
  setGunLook(look: GunLook | null): void {
    this.pendingLook = look;
    this.holdGun(look);
  }

  /** Muzzle position in the world (or the chest if unarmed). */
  muzzle(out = new THREE.Vector3()): THREE.Vector3 {
    if (this.gun) {
      this.gun.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(this.gun);
      const f = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
      b.getCenter(out);
      return out.addScaledVector(f, 0.25);
    }
    return out.set(this.root.position.x, this.root.position.y + 1.4, this.root.position.z);
  }

  fired(): void {
    this.fireT = 0.1;
  }

  update(dt: number): void {
    // Turn smoothly to the heading.
    let d = this.heading - this.visualHeading;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.visualHeading += d * Math.min(1, dt * 14);
    this.root.rotation.y = this.visualHeading;
    this.mixer.update(dt);
    if (this.pendingLook && !this.gun) this.mountGun(this.pendingLook);
    if (this.gun) this.gun.visible = true;
    this.fireT -= dt;
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.root.removeFromParent();
  }
}

/** Gun looks (Quaternius Ultimate Gun Pack, scaled like Zero Hour's). */
export const GUN_LOOK: Record<string, GunLook> = {
  pistol: { model: 'gun-pistol-1', scale: 0.12, grip: 0.22 },
  revolver: { model: 'gun-revolver-1', scale: 0.12, grip: 0.22 },
  smg: { model: 'gun-submachinegun-4', scale: 0.16, grip: 0.36 },
  rifle: { model: 'gun-assaultrifle-1', scale: 0.16, grip: 0.36 },
  carbine: { model: 'gun-assaultrifle2-1', scale: 0.16, grip: 0.36 },
  shotgun: { model: 'gun-shotgun-1', scale: 0.15, grip: 0.33 },
  sniper: { model: 'gun-sniperrifle-1', scale: 0.16, grip: 0.36 },
  rpg: { model: 'gun-rocketlauncher', scale: 0.16, grip: 0.36 },
};
