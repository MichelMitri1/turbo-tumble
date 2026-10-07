import * as THREE from 'three';
import type { WeaponDef, Attachments } from '../sim/weapons';
import { cloneModel, TEAM_LOOK } from './assets';
import { assembleGun } from './gunmodel';

/**
 * First-person weapon + arms, drawn in their own scene with their own camera
 * (so the gun never clips into walls) and animated like a modern shooter:
 * ADS, walk bob, look sway, sprint pose, recoil, reload, swap, knife, grenade.
 */
export interface VMState {
  adsT: number;
  speed: number;
  sprint: boolean;
  grounded: boolean;
  crouch: boolean;
  slide: boolean;
  reload: number; // 0..1 progress, -1 none
  swap: number; // 0..1 (1 = fully lowered)
  melee: number; // 0..1 progress, -1 none
  cooking: boolean;
  lookDX: number;
  lookDY: number;
}

const HIP = new THREE.Vector3(0.19, -0.255, -0.45);
/** Hipfire: muzzle tipped up a touch so it points at the crosshair from down low. */
const HIP_PITCH = 0.035;

export class ViewModel {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly holder = new THREE.Group();
  private readonly kick = new THREE.Group();
  private gun = new THREE.Group();
  private readonly arms = new THREE.Group();
  private readonly knife: THREE.Object3D;
  private readonly grenade: THREE.Object3D;
  private readonly flash: THREE.Mesh;
  private readonly flashLight = new THREE.PointLight('#ffb060', 0, 4, 2);
  private def: WeaponDef | null = null;
  private ads = new THREE.Vector3();
  private muzzle = new THREE.Vector3();
  private bob = 0;
  private recoilZ = 0;
  private recoilR = 0;
  private recoilVZ = 0;
  private recoilVR = 0;
  private swayX = 0;
  private swayY = 0;
  private sprintT = 0;
  private flashT = 0;
  private landT = 0;
  private wasGrounded = true;
  private readonly sleeve: THREE.MeshStandardMaterial;
  /** Full-screen optic overlay while aiming: sniper scope or ACOG. */
  scope: '' | 'sniper' | 'acog' = '';
  get scoped(): boolean {
    return this.scope !== '';
  }
  private acog = false;

  constructor(team: 0 | 1) {
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.01, 10);
    this.scene.add(new THREE.HemisphereLight('#e6eeff', '#4a4236', 1.5));
    const key = new THREE.DirectionalLight('#fff2e0', 1.6);
    key.position.set(0.4, 1, 0.6);
    this.scene.add(key, this.flashLight);
    this.scene.add(this.camera);
    this.camera.add(this.holder);
    this.holder.add(this.kick);
    this.kick.add(this.gun, this.arms);
    this.sleeve = new THREE.MeshStandardMaterial({ color: TEAM_LOOK[team].body, roughness: 0.9 });
    this.knife = cloneModel('item-knife-1');
    this.knife.scale.setScalar(0.32);
    this.knife.visible = false;
    this.camera.add(this.knife);
    this.grenade = cloneModel('item-grenade');
    this.grenade.scale.setScalar(0.22);
    this.grenade.visible = false;
    this.camera.add(this.grenade);
    // Muzzle flash: an additive star sprite.
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,255,230,1)');
    grd.addColorStop(0.25, 'rgba(255,200,90,0.9)');
    grd.addColorStop(1, 'rgba(255,120,20,0)');
    g.fillStyle = grd;
    g.translate(64, 64);
    for (let i = 0; i < 6; i++) {
      g.rotate(Math.PI / 3);
      g.beginPath();
      g.moveTo(0, -6);
      g.lineTo(60, 0);
      g.lineTo(0, 6);
      g.fill();
    }
    g.beginPath();
    g.arc(0, 0, 26, 0, Math.PI * 2);
    g.fill();
    const tex = new THREE.CanvasTexture(c);
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.flash.visible = false;
    this.kick.add(this.flash);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  setWeapon(def: WeaponDef, att: Attachments, camo: string): void {
    this.def = def;
    this.acog = att.optic === 'acog' && !def.scoped;
    this.kick.remove(this.gun);
    const { gun, b, s, gripX, foreX, sightX, sightY } = assembleGun(def, att, camo);
    this.gun = gun;
    const gripY = b.min.y + (b.max.y - b.min.y) * 0.25;
    const pistol = def.cls === 'pistol';
    // Where the sight is relative to the grip (holder space).
    const sy = (sightY - gripY) * s;
    const sz = (sightX - gripX) * s;
    // Far enough out that the gun sits low in the frame; the ACOG comes closer so you look through it.
    this.ads.set(0, -sy, (att.optic === 'acog' && !def.scoped ? -0.3 : -0.42) + sz * 0.5);
    this.muzzle.set(0, ((b.min.y + b.max.y) / 2 - gripY) * s + 0.01, -(b.max.x - gripX) * s - (att.muzzle === 'suppressor' ? 0.2 : 0));
    this.flash.position.copy(this.muzzle);
    this.flash.scale.setScalar(def.cls === 'shotgun' || def.cls === 'sniper' ? 1.5 : pistol ? 0.8 : 1);
    this.flashLight.position.copy(this.muzzle);
    // Arms.
    this.arms.clear();
    this.arm(new THREE.Vector3(0, -0.02, 0.02), new THREE.Vector3(0.12, -0.2, 0.32));
    this.arm(new THREE.Vector3(0, -0.035, -(foreX - gripX) * s), new THREE.Vector3(-0.2, -0.24, -(foreX - gripX) * s + 0.32));
    this.kick.add(this.gun);
  }

  private arm(hand: THREE.Vector3, elbow: THREE.Vector3): void {
    const glove = new THREE.MeshStandardMaterial({ color: '#1d1f22', roughness: 0.8 });
    const len = hand.distanceTo(elbow);
    const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.038, len, 4, 10), this.sleeve);
    fore.position.copy(hand).add(elbow).multiplyScalar(0.5);
    fore.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), elbow.clone().sub(hand).normalize());
    const fist = new THREE.Mesh(new THREE.SphereGeometry(0.042, 10, 8), glove);
    fist.scale.set(1, 1.1, 1.4);
    fist.position.copy(hand);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.043, 0.043, 0.04, 10), glove);
    cuff.position.copy(hand).lerp(elbow, 0.12);
    cuff.quaternion.copy(fore.quaternion);
    this.arms.add(fore, fist, cuff);
  }

  /** A shot was fired: recoil + flash. */
  fire(): void {
    const d = this.def;
    if (!d) return;
    const k = d.cls === 'shotgun' || d.cls === 'sniper' ? 2.6 : d.cls === 'pistol' ? 1.6 : 1;
    this.recoilVZ += 0.9 * k;
    this.recoilVR += 1.4 * k;
    this.flashT = 0.045;
    this.flash.rotation.z = Math.random() * Math.PI;
  }

  /** Muzzle position in world space (for tracers). */
  muzzleWorld(out: THREE.Vector3, worldCam: THREE.Camera): THREE.Vector3 {
    // Map the viewmodel muzzle (viewmodel camera space) onto the world camera.
    out.copy(this.muzzle);
    this.kick.updateWorldMatrix(true, false);
    out.applyMatrix4(this.kick.matrixWorld);
    out.applyMatrix4(this.camera.matrixWorldInverse);
    // Pull it closer to the eye (the viewmodel uses a narrower FOV).
    out.multiplyScalar(1.4);
    return out.applyMatrix4(worldCam.matrixWorld);
  }

  update(dt: number, s: VMState): void {
    const d = this.def;
    if (!d) return;
    // Sprint pose blend.
    this.sprintT += ((s.sprint ? 1 : 0) - this.sprintT) * Math.min(1, dt * 9);
    // Walk bob.
    const moving = s.grounded ? Math.min(1, s.speed / 5) : 0;
    this.bob += dt * (s.sprint ? 13 : 9.5) * Math.max(0.2, moving);
    const bobAmt = moving * (1 - s.adsT * 0.85) * (s.sprint ? 1.8 : 1);
    const bx = Math.sin(this.bob) * 0.011 * bobAmt;
    const by = -Math.abs(Math.cos(this.bob)) * 0.012 * bobAmt;
    // Sway lags behind the mouse.
    this.swayX += (Math.max(-0.06, Math.min(0.06, -s.lookDX * 0.02)) - this.swayX) * Math.min(1, dt * 10);
    this.swayY += (Math.max(-0.05, Math.min(0.05, s.lookDY * 0.02)) - this.swayY) * Math.min(1, dt * 10);
    // Landing dip.
    if (s.grounded && !this.wasGrounded) this.landT = 1;
    this.wasGrounded = s.grounded;
    this.landT = Math.max(0, this.landT - dt * 4);
    // Recoil spring.
    const kz = 260;
    const cz = 22;
    this.recoilVZ += (-kz * this.recoilZ - cz * this.recoilVZ) * dt;
    this.recoilZ += this.recoilVZ * dt;
    this.recoilVR += (-kz * this.recoilR - cz * this.recoilVR) * dt;
    this.recoilR += this.recoilVR * dt;
    // Position: hip ↔ ADS.
    const a = easeInOut(s.adsT);
    const pos = HIP.clone().lerp(this.ads, a);
    pos.x += bx + this.swayX * (1 - a * 0.7);
    pos.y += by + this.swayY * (1 - a * 0.7) - this.landT * 0.03 - (s.crouch ? 0.006 : 0);
    // Sprint: gun tilts down and across.
    pos.x += this.sprintT * 0.02;
    pos.y -= this.sprintT * 0.06;
    pos.z += this.sprintT * 0.04;
    // Reload: dip, roll and come back.
    let rx = -this.sprintT * 0.45 + HIP_PITCH * (1 - a);
    let ry = this.sprintT * 0.75;
    let rz = this.sprintT * 0.35 + (s.slide ? 0.25 : 0);
    if (s.reload >= 0) {
      const r = Math.sin(Math.min(1, s.reload) * Math.PI);
      pos.y -= r * 0.09;
      pos.x -= r * 0.02;
      rz += r * 0.55;
      rx -= r * 0.35;
    }
    // Swap: lower out of view.
    pos.y -= s.swap * 0.35;
    rx -= s.swap * 0.8;
    // Grenade cook / knife: gun drops away.
    if (s.cooking || s.melee >= 0) {
      pos.y -= 0.12;
      pos.x += 0.05;
      rx -= 0.4;
    }
    this.holder.position.copy(pos);
    this.holder.rotation.set(rx + this.swayY * 2, ry + this.swayX * 2, rz);
    this.kick.position.set(0, this.recoilR * 0.004, this.recoilZ * 0.02 * (1 - a * 0.6));
    this.kick.rotation.set(this.recoilR * 0.025 * (1 - a * 0.5), 0, 0);
    // Knife lunge.
    this.knife.visible = s.melee >= 0;
    if (s.melee >= 0) {
      const p = Math.sin(Math.min(1, s.melee) * Math.PI);
      this.knife.position.set(-0.05 + p * 0.05, -0.12 + p * 0.04, -0.25 - p * 0.25);
      this.knife.rotation.set(-Math.PI / 2 + 0.3, 0, -0.4);
    }
    this.grenade.visible = s.cooking;
    if (s.cooking) {
      this.grenade.position.set(-0.14, -0.08 + Math.sin(performance.now() / 200) * 0.004, -0.3);
    }
    // Muzzle flash.
    this.flashT -= dt;
    this.flash.visible = this.flashT > 0 && s.melee < 0;
    this.flashLight.intensity = this.flashT > 0 ? 3 : 0;
    // Snipers and the ACOG: look through the optic (HUD overlay) once it's up.
    this.scope = s.adsT > 0.85 ? (d.scoped ? 'sniper' : this.acog ? 'acog' : '') : '';
    this.holder.visible = !this.scoped;
  }
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
