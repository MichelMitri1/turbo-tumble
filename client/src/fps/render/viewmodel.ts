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
const tmpPos = new THREE.Vector3();

/** One weapon ready to show: the assembled gun, its two arms, and where its sight / muzzle / off hand are. */
interface Build {
  gun: THREE.Group;
  right: THREE.Group;
  left: THREE.Group;
  ads: THREE.Vector3;
  muzzle: THREE.Vector3;
  hand: THREE.Vector3;
  /** Geometry / materials made for this build (the model geometry itself is shared). */
  own: Array<{ dispose(): void }>;
}

export class ViewModel {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly holder = new THREE.Group();
  private readonly kick = new THREE.Group();
  private gun = new THREE.Group();
  /** Built weapons by weapon / attachments / camo: swapping back and forth rebuilds nothing. */
  private builds = new Map<string, Build>();
  private build: Build | null = null;
  private readonly mag: THREE.Mesh;
  private settleT = 0;
  private adsIn = false;
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
    this.kick.add(this.gun);
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
    // The magazine in the off hand during a reload.
    this.mag = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.11, 0.055), new THREE.MeshStandardMaterial({ color: '#2b2e33', roughness: 0.5, metalness: 0.6 }));
    this.mag.rotation.x = 0.2;
    this.mag.visible = false;
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  setWeapon(def: WeaponDef, att: Attachments, camo: string): void {
    this.def = def;
    this.acog = att.optic === 'acog' && !def.scoped;
    const key = `${def.id}:${att.optic}${att.muzzle}${att.under}:${camo}`;
    let bd = this.builds.get(key);
    if (!bd) this.builds.set(key, (bd = this.assemble(def, att, camo)));
    if (this.build) this.kick.remove(this.build.gun, this.build.right, this.build.left);
    this.build = bd;
    this.gun = bd.gun;
    this.ads.copy(bd.ads);
    this.muzzle.copy(bd.muzzle);
    this.flash.position.copy(this.muzzle);
    this.flash.scale.setScalar(def.cls === 'shotgun' || def.cls === 'sniper' ? 1.5 : def.cls === 'pistol' ? 0.8 : 1);
    this.flashLight.position.copy(this.muzzle);
    bd.left.add(this.mag);
    this.mag.position.copy(bd.hand).add(tmpPos.set(0, 0.06, 0.01));
    this.kick.add(bd.gun, bd.right, bd.left);
  }

  private assemble(def: WeaponDef, att: Attachments, camo: string): Build {
    const { gun, b, s, gripX, foreX, sightX, sightY } = assembleGun(def, att, camo);
    const own: Build['own'] = [];
    // Optics, lasers etc. are built fresh per gun (the model meshes share the cached geometry).
    for (const o of gun.children.slice(1))
      o.traverse((n) => {
        const m = n as THREE.Mesh;
        if (m.isMesh && !m.geometry.userData.cached) own.push(m.geometry);
      });
    const gripY = b.min.y + (b.max.y - b.min.y) * 0.25;
    // Where the sight is relative to the grip (holder space).
    const sy = (sightY - gripY) * s;
    const sz = (sightX - gripX) * s;
    // Far enough out that the gun sits low in the frame; the ACOG comes closer so you look through it.
    const ads = new THREE.Vector3(0, -sy, (att.optic === 'acog' && !def.scoped ? -0.3 : -0.42) + sz * 0.5);
    const muzzle = new THREE.Vector3(0, ((b.min.y + b.max.y) / 2 - gripY) * s + 0.01, -(b.max.x - gripX) * s - (att.muzzle === 'suppressor' ? 0.2 : 0));
    const hand = new THREE.Vector3(0, -0.035, -(foreX - gripX) * s);
    const right = this.arm(new THREE.Vector3(0, -0.02, 0.02), new THREE.Vector3(0.12, -0.2, 0.32), own);
    const left = this.arm(hand, new THREE.Vector3(-0.2, -0.24, hand.z + 0.32), own);
    return { gun, right, left, ads, muzzle, hand, own };
  }

  private arm(hand: THREE.Vector3, elbow: THREE.Vector3, own: Build['own']): THREE.Group {
    const g = new THREE.Group();
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
    g.add(fore, fist, cuff);
    own.push(fore.geometry, fist.geometry, cuff.geometry, glove);
    return g;
  }

  dispose(): void {
    for (const b of this.builds.values()) for (const o of b.own) o.dispose();
    this.builds.clear();
    this.mag.geometry.dispose();
    (this.mag.material as THREE.Material).dispose();
    this.flash.geometry.dispose();
    const fm = this.flash.material as THREE.MeshBasicMaterial;
    fm.map?.dispose();
    fm.dispose();
    this.sleeve.dispose();
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

  /** Shader warm-up: show every piece (flash, knife, grenade, mag) for one render so each gets compiled and its pipeline built. */
  warm(on: boolean): void {
    for (const o of [this.flash, this.knife, this.grenade, this.mag]) o.visible = on;
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
    // Sight-in: a 0.1 s settle as the optic lines up.
    if (s.adsT > 0.98 && !this.adsIn) {
      this.adsIn = true;
      this.settleT = 0.1;
    } else if (s.adsT < 0.9) this.adsIn = false;
    this.settleT = Math.max(0, this.settleT - dt);
    const settle = this.settleT > 0 ? Math.sin((1 - this.settleT / 0.1) * Math.PI) : 0;
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
    pos.y += by + this.swayY * (1 - a * 0.7) - this.landT * 0.03 - (s.crouch ? 0.006 : 0) - settle * 0.005;
    // Sprint: gun drops low and angles across the body.
    pos.x += this.sprintT * 0.02;
    pos.y -= this.sprintT * 0.1;
    pos.z += this.sprintT * 0.06;
    let rx = -this.sprintT * 0.5 + HIP_PITCH * (1 - a) + settle * 0.012;
    let ry = this.sprintT * 0.5;
    let rz = this.sprintT * 0.3 + (s.slide ? 0.25 : 0);
    // Reload, two stages: tilt in → off hand drops away with the mag (out) → comes back and seats it (in) → tilt back.
    let drop = 0;
    if (s.reload >= 0) {
      const r = Math.min(1, s.reload);
      const tilt = smooth(0, 0.15, r) * (1 - smooth(0.8, 1, r));
      drop = smooth(0.1, 0.3, r) * (1 - smooth(0.42, 0.62, r));
      const seat = Math.exp(-(((r - 0.64) / 0.045) ** 2));
      // Canted right and drawn in a little: the magwell turns to the support hand (pitch reads huge down the barrel, so barely any).
      pos.x -= tilt * 0.03;
      pos.y += tilt * 0.02 + seat * 0.01;
      pos.z += tilt * 0.02;
      rx += tilt * 0.05 + seat * 0.04;
      ry += tilt * 0.1;
      rz -= tilt * 0.6;
    }
    if (this.build) {
      this.build.left.position.set(-drop * 0.05, -drop * 0.3, drop * 0.08);
      this.build.left.rotation.set(drop * 0.6, 0, -drop * 0.3);
    }
    this.mag.visible = s.reload >= 0 && s.reload > 0.12 && s.reload < 0.64;
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

function smooth(a: number, b: number, t: number): number {
  const x = Math.max(0, Math.min(1, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
