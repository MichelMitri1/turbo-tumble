import * as THREE from 'three';
import { cloneModel, cloneSkinned, gunBounds, loaded } from './assets';
import { applyCamo } from './camo';
import { disposeTree } from './world3d';
import type { Game, GameEvent } from '../sim/game';
import type { Horde, Zombie } from '../sim/horde';
import { BOX_POOL, POWERUPS, ZPERKS, zdef, type PowerUp, type ZPerk } from '../sim/zweapons';
import { WEAPON } from '../sim/weapons';

/**
 * Everything zombies draws: the undead and hellhounds (skinned, animated), boarded windows,
 * doors and debris, chalk wall weapons, the four perk machines, the mystery box (and its
 * teddy bear), the Pack-a-Punch, the power switch, power-ups and Clockwork Monkeys.
 */

const tmpV = new THREE.Vector3();

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const glowTex = canvasTex(64, 64, (g) => {
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
});
const glow = (color: string, size: number, opacity = 0.8) => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity }));
  s.scale.setScalar(size);
  return s;
};

// ---------------------------------------------------------------- the undead

const SKIN = ['#7d8a6a', '#8a9077', '#6e7a63', '#94927a', '#7a6f62'];
const CLOTH = ['#3b3f45', '#4a3b2f', '#2f3a4a', '#5a5048', '#3a4a3a', '#6a5a4a', '#2a2a2e'];

class ZView {
  readonly root = new THREE.Group();
  private mixer: THREE.AnimationMixer;
  private acts = new Map<string, THREE.AnimationAction>();
  private cur: THREE.AnimationAction | null = null;
  private curName = '';
  private mats: THREE.MeshStandardMaterial[] = [];
  private fire: THREE.Sprite[] = [];
  private lastState = '';
  private body: THREE.Group;
  private x = 0;
  private z = 0;
  private y = 0;
  private yaw = 0;
  private first = true;
  private lastAtk = 0;

  constructor(
    readonly dog: boolean,
    male: boolean,
    seed: number,
  ) {
    const g = loaded(dog ? 'hellhound' : male ? 'zombie-male' : 'zombie-female')!;
    this.body = cloneSkinned(g.scene) as THREE.Group;
    // The rigs are big (a 2.8 m zombie, a 3.8 m wolf at 0.92 / 0.72): scale to ~1.95 m / ~1.6 m.
    const scale = dog ? 0.3 : 0.64 + ((seed % 7) - 3) * 0.006;
    this.body.scale.setScalar(scale);
    this.root.add(this.body);
    const pick = <T>(a: T[], k: number) => a[(seed * 7 + k * 13) % a.length]!;
    this.body.traverse((n) => {
      const m = n as THREE.SkinnedMesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.frustumCulled = false;
      const mats = (Array.isArray(m.material) ? m.material : [m.material]).map((src) => {
        const mat = (src as THREE.MeshStandardMaterial).clone();
        mat.roughness = 0.9;
        if (dog) {
          if (mat.name === 'Main') mat.color.set('#1e1614');
          if (mat.name === 'Main_Light') mat.color.set('#4a1c10');
          if (mat.name === 'Nose') mat.color.set('#110c0b');
          if (mat.name === 'Eyes_Black') {
            mat.color.set('#ff6a10');
            mat.emissive.set('#ff4a00');
            mat.emissiveIntensity = 3;
          }
        } else {
          if (mat.name === 'Skin') mat.color.set(pick(SKIN, 1));
          if (mat.name === 'Clothes') mat.color.set(pick(CLOTH, 2));
          if (mat.name === 'Pants' || mat.name === 'DarkClothes') mat.color.set(pick(CLOTH, 3)).multiplyScalar(0.7);
          if (mat.name === 'Guts' || mat.name === 'Brain') mat.color.set('#6a1010');
          if (mat.name === 'Face') {
            // Glowing eyes.
            mat.emissive.set('#ff9a20');
            mat.emissiveIntensity = 0.55;
          }
        }
        this.mats.push(mat);
        return mat;
      });
      m.material = Array.isArray(m.material) ? mats : mats[0]!;
    });
    this.mixer = new THREE.AnimationMixer(this.body);
    for (const clip of g.animations) {
      const a = this.mixer.clipAction(clip);
      if (['Death', 'StandUp', 'Jump', 'SwordSlash', 'Attack', 'RecieveHit'].includes(clip.name)) {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
      this.acts.set(clip.name, a);
    }
    // Hellhounds burn.
    if (dog)
      for (let i = 0; i < 4; i++) {
        const f = glow(i % 2 ? '#ff7a20' : '#ff3a10', 0.55, 0.55);
        this.fire.push(f);
        this.root.add(f);
      }
  }

  private play(name: string, fade = 0.2, speed = 1, restart = false): void {
    const a = this.acts.get(name);
    if (!a) return;
    a.timeScale = speed;
    if (this.curName === name && !restart) return;
    a.reset();
    a.enabled = true;
    a.setEffectiveWeight(1);
    if (this.cur && fade > 0) a.crossFadeFrom(this.cur, fade, false);
    else this.cur?.stop();
    a.play();
    this.cur = a;
    this.curName = name;
  }

  update(zb: Zombie, dt: number, time: number, smooth: number): void {
    // Smooth toward the sim (online snapshots are 30 Hz).
    const k = this.first ? 1 : Math.min(1, dt * smooth);
    this.first = false;
    this.x += (zb.x - this.x) * k;
    this.z += (zb.z - this.z) * k;
    this.y += (zb.y - this.y) * k;
    let dy = zb.yaw - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw += dy * Math.min(1, dt * 12);
    let y = this.y;
    let x = this.x;
    let z = this.z;
    const entered = zb.state !== this.lastState;
    this.lastState = zb.state;
    const swingStart = zb.atk > 0 && this.lastAtk <= 0;
    this.lastAtk = zb.atk;
    if (this.dog) {
      if (zb.state === 'dead') this.play('Death', 0.1);
      else if (zb.atk > 0) this.play('Attack', 0.1, 1.6, swingStart);
      else if (zb.v > 0.5) this.play('Gallop', 0.2, Math.max(0.7, zb.v / 7));
      else this.play('Idle', 0.3);
    } else {
      switch (zb.state) {
        case 'rise':
          if (entered) this.play('StandUp', 0, 1.1, true);
          break;
        case 'barrier':
          this.play(zb.atk > 0 ? 'SwordSlash' : 'Punch', 0.15, zb.atk > 0 ? 1.1 : 0.7, swingStart);
          break;
        case 'climb':
          if (entered) this.play('Jump', 0.1, zb.pace === 0 ? 0.65 : 0.95, true);
          break;
        case 'dead':
          if (entered) this.play('Death', 0.1, 1.2, true);
          break;
        default:
          if (zb.atk > 0) this.play('SwordSlash', 0.1, 1.15, swingStart);
          else if (zb.v > 0.3) {
            if (zb.pace === 0) this.play('Walk', 0.25, Math.max(0.5, zb.v / 1.1) * 0.9);
            else this.play('Run', 0.25, Math.max(0.7, zb.v / 4.6));
          } else this.play('Idle', 0.3);
      }
    }
    // Dead: thrown by blasts, then sink into the floor.
    if (zb.state === 'dead') {
      const t = zb.t;
      const fl = Math.min(t, 0.45);
      x = this.x + zb.flingX * fl * 2.2;
      z = this.z + zb.flingZ * fl * 2.2;
      if (t > 2.1) y -= (t - 2.1) * 0.9;
    }
    this.root.position.set(x, y, z);
    this.root.rotation.y = this.yaw + Math.PI;
    // Burning (Hades) / hellhound flames.
    const burn = zb.burnT > 0;
    for (const m of this.mats) if (!this.dog && m.name === 'Clothes') m.emissive.set(burn ? '#ff4a10' : '#000000');
    this.fire.forEach((f, i) => {
      f.position.set(Math.sin(time * 9 + i * 2) * 0.12, 0.35 + i * 0.07 + Math.sin(time * 13 + i) * 0.05, (i - 1.5) * 0.3);
      (f.material as THREE.SpriteMaterial).opacity = zb.state === 'dead' ? Math.max(0, 0.5 - zb.t * 0.4) : 0.35 + Math.random() * 0.3;
    });
    this.mixer.update(dt);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    for (const m of this.mats) m.dispose();
    for (const f of this.fire) f.material.dispose();
    this.root.removeFromParent();
  }
}

// ---------------------------------------------------------------- props

const PERK_GLYPH: Record<ZPerk, string> = { jug: '♥', revive: '✚', speed: '⚡', dtap: '✦' };

function perkMachine(perk: ZPerk): { g: THREE.Group; sign: THREE.MeshStandardMaterial; halo: THREE.Sprite } {
  const info = ZPERKS[perk];
  const g = new THREE.Group();
  const col = new THREE.Color(info.color);
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.0, 0.8), new THREE.MeshStandardMaterial({ color: col.clone().multiplyScalar(0.55), roughness: 0.55, metalness: 0.3 }));
  body.position.y = 1;
  body.castShadow = true;
  const face = canvasTex(256, 512, (c) => {
    c.fillStyle = '#111';
    c.fillRect(0, 0, 256, 512);
    const gr = c.createLinearGradient(0, 0, 0, 512);
    gr.addColorStop(0, info.color);
    gr.addColorStop(1, '#0a0a0a');
    c.fillStyle = gr;
    c.fillRect(12, 12, 232, 488);
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.fillRect(30, 200, 196, 250);
    c.fillStyle = '#f8f0dc';
    c.textAlign = 'center';
    c.font = 'bold 120px Georgia, serif';
    c.fillText(PERK_GLYPH[perk], 128, 165);
    c.font = 'bold 30px Georgia, serif';
    const words = info.name.toUpperCase().split(' ');
    words.forEach((w, i) => c.fillText(w, 128, 250 + i * 40));
    // Bottles on the shelf.
    for (let i = 0; i < 3; i++) {
      c.fillStyle = info.color;
      c.fillRect(60 + i * 52, 380, 26, 50);
      c.fillRect(66 + i * 52, 360, 14, 22);
    }
  });
  const front = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 1.84), new THREE.MeshStandardMaterial({ map: face, emissiveMap: face, emissive: '#ffffff', emissiveIntensity: 0.15, roughness: 0.4 }));
  front.position.set(0, 1.02, 0.401);
  const sign = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.05 });
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.3, 0.85), sign);
  top.position.y = 2.15;
  const halo = glow(info.color, 2.6, 0);
  halo.position.set(0, 1.6, 0.6);
  g.add(body, front, top, halo);
  return { g, sign, halo };
}

function mysteryBox(): { g: THREE.Group; lid: THREE.Group; qm: THREE.MeshStandardMaterial } {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: '#5a3a1e', roughness: 0.85 });
  const trim = new THREE.MeshStandardMaterial({ color: '#2a2018', roughness: 0.6, metalness: 0.4 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.6, 0.75), wood);
  base.position.y = 0.3;
  base.castShadow = true;
  const q = canvasTex(128, 128, (c) => {
    c.fillStyle = 'rgba(0,0,0,0)';
    c.clearRect(0, 0, 128, 128);
    c.fillStyle = '#9fe8ff';
    c.font = 'bold 110px Georgia, serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('?', 64, 70);
  });
  const qm = new THREE.MeshStandardMaterial({ map: q, transparent: true, emissive: '#7fd8ff', emissiveMap: q, emissiveIntensity: 1.5, depthWrite: false });
  for (const side of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.45), qm);
    p.position.set(side * 0.45, 0.32, 0.376);
    g.add(p);
  }
  const lid = new THREE.Group();
  lid.position.set(0, 0.6, -0.375);
  const lm = new THREE.Mesh(new THREE.BoxGeometry(1.74, 0.12, 0.78), wood);
  lm.position.set(0, 0.06, 0.375);
  lid.add(lm);
  const bands = [-0.6, 0, 0.6].map((x) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.62, 0.77), trim);
    b.position.set(x, 0.31, 0);
    return b;
  });
  g.add(base, lid, ...bands);
  return { g, lid, qm };
}

function teddyBear(): THREE.Group {
  const g = new THREE.Group();
  const fur = new THREE.MeshStandardMaterial({ color: '#8a5a32', roughness: 1 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), fur);
  body.scale.set(1, 1.2, 0.9);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), fur);
  head.position.y = 0.25;
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), fur);
    ear.position.set(s * 0.09, 0.34, 0);
    const arm = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), fur);
    arm.position.set(s * 0.18, 0.12, 0);
    arm.scale.set(1, 1.6, 1);
    g.add(ear, arm);
  }
  g.add(body, head);
  return g;
}

function papMachine(): { g: THREE.Group; panels: THREE.MeshStandardMaterial; rollers: THREE.Mesh[] } {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: '#5a5070', roughness: 0.4, metalness: 0.5 });
  const panels = new THREE.MeshStandardMaterial({ color: '#6a5aff', emissive: '#7a5aff', emissiveIntensity: 0.3 });
  const brass = new THREE.MeshStandardMaterial({ color: '#c8a050', roughness: 0.35, metalness: 0.85 });
  // A brass trim band and the logo plate.
  const band = new THREE.Mesh(new THREE.BoxGeometry(1.64, 0.1, 1.24), brass);
  band.position.y = 0.9;
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(1.1, 0.42),
    new THREE.MeshStandardMaterial({
      map: canvasTex(256, 96, (c) => {
        c.fillStyle = '#1a1028';
        c.fillRect(0, 0, 256, 96);
        c.strokeStyle = '#c8a050';
        c.lineWidth = 6;
        c.strokeRect(4, 4, 248, 88);
        c.fillStyle = '#e8d0ff';
        c.font = 'bold 27px Georgia, serif';
        c.textAlign = 'center';
        c.fillText('PACK-A-PUNCH', 128, 58);
      }),
      emissive: '#9a7aff',
      emissiveIntensity: 0.35,
    }),
  );
  plate.position.set(0, 0.45, 0.601);
  g.add(band, plate);
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 1.2), metal);
  base.position.y = 0.45;
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.7, 1.0), metal);
  top.position.y = 1.25;
  const slot = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.12, 0.2), new THREE.MeshStandardMaterial({ color: '#05050a' }));
  slot.position.set(0, 0.95, 0.55);
  const glowPanels = [-0.66, 0.66].map((x) => {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.6, 0.9), panels);
    p.position.set(x, 1.25, 0);
    return p;
  });
  const rollers = [-0.35, 0, 0.35].map((x) => {
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.95, 10), new THREE.MeshStandardMaterial({ color: '#8a8aa0', metalness: 0.8, roughness: 0.3 }));
    r.rotation.z = Math.PI / 2;
    r.position.set(0, 1.65, x * 0.6);
    return r;
  });
  const lamp = glow('#7a5aff', 2.2, 0.5);
  lamp.position.set(0, 1.9, 0);
  g.add(base, top, slot, ...glowPanels, ...rollers, lamp);
  return { g, panels, rollers };
}

function powerIcon(kind: PowerUp): THREE.CanvasTexture {
  return canvasTex(128, 128, (c) => {
    c.clearRect(0, 0, 128, 128);
    c.strokeStyle = '#d8ffd0';
    c.fillStyle = '#d8ffd0';
    c.lineWidth = 7;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    switch (kind) {
      case 'maxammo':
        c.fillRect(30, 54, 68, 42);
        c.fillStyle = '#1e5a14';
        for (let i = 0; i < 4; i++) c.fillRect(38 + i * 15, 36, 9, 24);
        c.fillStyle = '#d8ffd0';
        for (let i = 0; i < 4; i++) c.fillRect(38 + i * 15, 30, 9, 22);
        break;
      case 'insta':
        c.beginPath();
        c.arc(64, 54, 30, 0, Math.PI * 2);
        c.fill();
        c.fillRect(46, 74, 36, 22);
        c.fillStyle = '#123a0e';
        c.beginPath();
        c.arc(52, 54, 8, 0, Math.PI * 2);
        c.arc(76, 54, 8, 0, Math.PI * 2);
        c.fill();
        break;
      case 'double':
        c.font = 'bold 64px Georgia, serif';
        c.fillText('x2', 64, 68);
        break;
      case 'nuke':
        c.beginPath();
        c.arc(64, 64, 34, 0, Math.PI * 2);
        c.stroke();
        for (let k = 0; k < 3; k++) {
          c.beginPath();
          c.moveTo(64, 64);
          c.arc(64, 64, 30, (k * 2 * Math.PI) / 3 - 0.5, (k * 2 * Math.PI) / 3 + 0.5);
          c.fill();
        }
        break;
      case 'carpenter':
        c.fillRect(58, 40, 12, 60);
        c.fillRect(34, 30, 60, 18);
        break;
      case 'firesale':
        c.font = 'bold 76px Georgia, serif';
        c.fillText('$', 64, 70);
        break;
    }
  });
}

function monkeyToy(): { g: THREE.Group; cymbals: THREE.Mesh[]; light: THREE.Sprite } {
  const g = new THREE.Group();
  const fur = new THREE.MeshStandardMaterial({ color: '#6a4220', roughness: 0.9 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), fur);
  body.position.y = 0.1;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), fur);
  head.position.y = 0.22;
  const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.05, 10), new THREE.MeshStandardMaterial({ color: '#b01818' }));
  hat.position.y = 0.3;
  const brass = new THREE.MeshStandardMaterial({ color: '#d8b040', metalness: 0.9, roughness: 0.25 });
  const cymbals = [-1, 1].map((s) => {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.01, 14), brass);
    c.rotation.z = Math.PI / 2;
    c.position.set(s * 0.13, 0.14, 0.03);
    return c;
  });
  const light = glow('#ff2020', 0.6, 0.8);
  light.position.y = 0.36;
  g.add(body, head, hat, ...cymbals, light);
  return { g, cymbals, light };
}

// ---------------------------------------------------------------- the whole lot

export class ZRender {
  readonly group = new THREE.Group();
  private zviews = new Map<number, ZView>();
  private boardMeshes: THREE.Mesh[][] = [];
  private boardShown: number[] = [];
  private flying: Array<{ m: THREE.Mesh; t: number; vx: number; vy: number; vz: number; spin: number }> = [];
  private doorViews: THREE.Group[] = [];
  private doorFade: number[] = [];
  private perkViews: Array<ReturnType<typeof perkMachine>> = [];
  private boxViews: Array<ReturnType<typeof mysteryBox> & { gun: THREE.Group | null; gunId: string; bear: THREE.Group; beam: THREE.Mesh; lidA: number }> = [];
  private papView: ReturnType<typeof papMachine> & { gun: THREE.Group | null; gunId: string };
  private lever: THREE.Mesh;
  private dropViews = new Map<number, THREE.Group>();
  private monkeyViews = new Map<number, ReturnType<typeof monkeyToy>>();
  private bolts: Array<{ o: THREE.Object3D; t: number; life: number }> = [];
  private poolIds = BOX_POOL.map(([id]) => id);
  /** Interior lights: [light, base intensity, needs the power]. */
  private lights: Array<[THREE.PointLight, number, boolean]> = [];

  constructor(
    scene: THREE.Scene,
    private readonly h: Horde,
  ) {
    const m = h.meta;
    scene.add(this.group);
    // Warm practical lights (the theater stays dim until the power is on).
    const L = (x: number, y: number, z: number, color: string, i: number, d: number, power = false) => {
      const l = new THREE.PointLight(color, i, d, 1.6);
      l.position.set(x, y, z);
      this.group.add(l);
      this.lights.push([l, i, power]);
    };
    L(-4, 4.3, 14, '#ffc98a', 22, 16);
    L(4, 4.3, 22, '#ffc98a', 22, 16);
    L(-14, 3, 16, '#ffb070', 8, 9);
    L(14, 3, 16, '#ffb070', 8, 9);
    L(-27, 3.5, -6, '#ffb88a', 16, 15);
    L(-27, 3.5, 10, '#ffb88a', 16, 15);
    L(22, 5, -2, '#a8c8ff', 18, 18);
    L(30, 5, 10, '#ffd2a0', 12, 14);
    L(-9, 7, -6, '#ffb070', 55, 24, true);
    L(9, 7, -6, '#ffb070', 55, 24, true);
    L(-9, 7, -16, '#ffb070', 45, 22, true);
    L(9, 7, -16, '#ffb070', 45, 22, true);
    L(0, 6, -23, '#ffe8c0', 60, 20, true);
    L(0, 2.6, -23.6, '#8a5aff', 18, 7, true); // the Pack-a-Punch's glow
    L(-17, 3, -6, '#ffb070', 6, 7);
    L(17, 3, -6, '#ffb070', 6, 7);
    // Windows: a frame and six boards.
    const plankMat = new THREE.MeshStandardMaterial({ color: '#7a5a3a', roughness: 0.95 });
    const frameMat = new THREE.MeshStandardMaterial({ color: '#2e2218', roughness: 0.9 });
    const plank = new THREE.BoxGeometry(1.9, 0.17, 0.05);
    m.windows.forEach((w) => {
      const along = w.nx ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
      const ang = Math.atan2(w.nx, w.nz);
      const frame = new THREE.Group();
      frame.position.set(w.x, 0, w.z);
      frame.rotation.y = ang;
      for (const [x, y, sx, sy] of [
        [0, w.sill - 0.05, w.w + 0.2, 0.1],
        [0, w.top + 0.05, w.w + 0.2, 0.1],
        [-w.w / 2 - 0.05, (w.sill + w.top) / 2, 0.1, w.top - w.sill],
        [w.w / 2 + 0.05, (w.sill + w.top) / 2, 0.1, w.top - w.sill],
      ] as Array<[number, number, number, number]>) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, 0.5), frameMat);
        b.position.set(x, y, 0);
        frame.add(b);
      }
      this.group.add(frame);
      const list: THREE.Mesh[] = [];
      for (let k = 0; k < 6; k++) {
        const p = new THREE.Mesh(plank, plankMat);
        const y = w.sill + 0.15 + (k / 5) * (w.top - w.sill - 0.3);
        p.position.set(w.x - w.nx * 0.1, y, w.z - w.nz * 0.1);
        p.rotation.y = ang;
        p.rotateZ((((k * 37) % 7) - 3) * 0.06);
        p.castShadow = true;
        p.userData.home = p.position.clone();
        p.userData.rot = p.rotation.clone();
        void along;
        this.group.add(p);
        list.push(p);
      }
      this.boardMeshes.push(list);
      this.boardShown.push(6);
    });
    // Doors / debris.
    m.doors.forEach((d) => {
      const [x0, z0, x1, z1] = d.box;
      const g = new THREE.Group();
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      g.position.set(cx, 0, cz);
      const wx = x1 - x0;
      const wz = z1 - z0;
      if (d.look === 'door') {
        const mat = new THREE.MeshStandardMaterial({ color: '#4a2a18', roughness: 0.8 });
        const band = new THREE.MeshStandardMaterial({ color: '#3a3a40', metalness: 0.7, roughness: 0.4 });
        const panel = new THREE.Mesh(new THREE.BoxGeometry(Math.max(wx, 0.12), 3.0, Math.max(wz, 0.12)), mat);
        panel.position.y = 1.5;
        panel.castShadow = true;
        g.add(panel);
        for (const y of [0.7, 2.3]) {
          const b = new THREE.Mesh(new THREE.BoxGeometry(Math.max(wx, 0.14) + 0.02, 0.12, Math.max(wz, 0.14) + 0.02), band);
          b.position.y = y;
          g.add(b);
        }
      } else {
        const parts: Array<[string, number, number, number, number, number]> = [
          ['prop-crate', -0.4, 0, -0.5, 1.1, 0],
          ['prop-crate', 0.3, 0, 0.6, 1.0, 1],
          ['prop-crate', 0, 1.0, 0, 1.0, 0],
          ['prop-pallet', 0, 2.0, 0, 1.2, 1],
          ['prop-woodplanks', 0.2, 0.2, -0.2, 1.0, 1],
        ];
        for (const [model, ox, oy, oz, s, rot] of parts) {
          const o = cloneModel(model);
          o.scale.setScalar(s);
          o.position.set(wx > wz ? oz : ox, oy, wx > wz ? ox : oz);
          o.rotation.y = rot * (Math.PI / 2) + 0.3;
          g.add(o);
        }
      }
      this.group.add(g);
      this.doorViews.push(g);
      this.doorFade.push(1);
    });
    // Chalk wall weapons.
    const chalk = new THREE.MeshBasicMaterial({ color: '#f2efe6', transparent: true, opacity: 0.82 });
    for (const w of m.wallbuys) {
      const model = w.weapon === 'frag' ? 'item-grenade' : w.weapon === 'bowie' ? 'item-knife-1' : WEAPON[w.weapon]?.model ?? '';
      const o = cloneModel(model);
      o.traverse((n) => {
        if ((n as THREE.Mesh).isMesh) (n as THREE.Mesh).material = chalk;
      });
      const holder = new THREE.Group();
      holder.position.set(w.x + w.nx * 0.025, w.y, w.z + w.nz * 0.025);
      holder.rotation.y = Math.atan2(w.nx, w.nz);
      if (w.weapon === 'frag') {
        o.scale.setScalar(0.5);
        const o2 = o.clone();
        o2.position.x = 0.2;
        holder.add(o2);
      } else if (w.weapon === 'bowie') {
        o.scale.setScalar(0.8);
        o.rotation.z = Math.PI / 2;
      } else {
        const b = gunBounds(model);
        const s = (WEAPON[w.weapon]!.scale ?? 0.15) * 1.35;
        o.scale.setScalar(s);
        o.position.set(-((b.min.x + b.max.x) / 2) * s, -((b.min.y + b.max.y) / 2) * s, 0);
      }
      // Lies flat on the wall.
      o.scale.z *= 0.15;
      holder.add(o);
      this.group.add(holder);
    }
    // Perk machines.
    for (const p of m.perks) {
      const v = perkMachine(p.perk);
      v.g.position.set(p.x, 0, p.z);
      v.g.rotation.y = Math.atan2(p.nx, p.nz);
      this.group.add(v.g);
      this.perkViews.push(v);
    }
    // Mystery box (one per spot; only the live one shows, all of them in a fire sale).
    for (const b of m.boxSpots) {
      const v = mysteryBox();
      v.g.position.set(b.x, 0, b.z);
      v.g.rotation.y = Math.atan2(b.nx, b.nz);
      const bear = teddyBear();
      bear.visible = false;
      v.g.add(bear);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 40, 16, 1, true), new THREE.MeshBasicMaterial({ color: '#9fe0ff', transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      beam.position.y = 20;
      v.g.add(beam);
      this.group.add(v.g);
      this.boxViews.push({ ...v, gun: null, gunId: '', bear, beam, lidA: 0 });
    }
    // Pack-a-Punch (on the stage).
    const pv = papMachine();
    pv.g.position.set(m.pap.x, 1, m.pap.z);
    pv.g.rotation.y = Math.atan2(m.pap.nx, m.pap.nz);
    this.group.add(pv.g);
    this.papView = { ...pv, gun: null, gunId: '' };
    // Power switch.
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.0, 0.18), new THREE.MeshStandardMaterial({ color: '#4a4a52', metalness: 0.6, roughness: 0.5 }));
    const pw = m.power;
    panel.position.set(pw.x + pw.nx * 0.09, 2.4, pw.z + pw.nz * 0.09);
    panel.rotation.y = Math.atan2(pw.nx, pw.nz);
    this.lever = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.55, 8), new THREE.MeshStandardMaterial({ color: '#c02020', metalness: 0.4 }));
    this.lever.position.set(0.15, -0.05, 0.2);
    this.lever.rotation.x = 0.9;
    panel.add(this.lever);
    this.group.add(panel);
  }

  /** Called with every event (box / power / board sounds are the audio's; here: visuals). */
  /** A coloured burst of light (ray bolts, hellhound lightning, the Thunder Cannon). */
  private flash(p: THREE.Vector3, color: string, size: number): void {
    const s = glow(color, size, 1);
    s.position.copy(p);
    this.group.add(s);
    this.bolts.push({ o: s, t: 0, life: 0.35 });
  }

  handle(e: GameEvent, g: Game, fxBlood: (p: THREE.Vector3) => void, fxDust: (p: THREE.Vector3) => void): void {
    const flash = (p: THREE.Vector3, color: string, size: number) => this.flash(p, color, size);
    switch (e.k) {
      case 'zhit':
        if (e.head || e.kill || Math.random() < 0.5) fxBlood(tmpV.set(e.x, e.y, e.z));
        break;
      case 'zspawn':
        if (e.dog) flash(tmpV.set(e.x, 1.2, e.z), '#bfe0ff', 6);
        else fxDust(tmpV.set(e.x, 0.1, e.z));
        break;
      case 'zthunder':
        flash(tmpV.set(e.x + e.dx * 4, e.y - 0.3, e.z + e.dz * 4), '#d8f0ff', 9);
        break;
      case 'explosion':
        if (e.kind === 'ray' || e.kind === 'ray2') flash(tmpV.set(e.x, e.y, e.z), e.kind === 'ray' ? '#40ff60' : '#ff4040', e.r * 2.2);
        break;
      case 'shot': {
        const zd = zdef(e.w);
        if (zd?.zm.proj === 'ray' || zd?.zm.proj === 'ray2') {
          for (const hit of e.hits) {
            const from = new THREE.Vector3(e.fx, e.fy - 0.15, e.fz);
            const to = new THREE.Vector3(hit[0], hit[1], hit[2]);
            const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
            const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: zd.zm.proj === 'ray' ? '#60ff70' : '#ff5050', transparent: true, opacity: 1, blending: THREE.AdditiveBlending }));
            this.group.add(line);
            this.bolts.push({ o: line, t: 0, life: 0.12 });
          }
        }
        break;
      }
    }
    void g;
  }

  /** Dev: draw the sim's hitboxes over the undead (`__zh.match.zr.debugHitboxes = true`). */
  debugHitboxes = false;
  private dbg = new THREE.Group();

  update(g: Game, dt: number, time: number, _online: boolean): void {
    const h = this.h;
    this.dbg.clear();
    if (this.debugHitboxes) {
      if (!this.dbg.parent) this.group.add(this.dbg);
      const red = new THREE.MeshBasicMaterial({ color: '#ff2020', wireframe: true });
      const blue = new THREE.MeshBasicMaterial({ color: '#20a0ff', wireframe: true });
      for (const zb of h.zombies) {
        if (zb.state === 'dead') continue;
        const hb = h.hitboxes(zb, null);
        const holder = new THREE.Group();
        holder.position.set(hb.at[0], hb.at[1], hb.at[2]);
        holder.rotation.y = hb.at[3];
        for (const [b, mat] of [
          [hb.head, red],
          [hb.body, blue],
        ] as const) {
          // Local (side, up, forward) → a child box; forward is −z in the holder's frame.
          const m = new THREE.Mesh(new THREE.BoxGeometry(b[3] - b[0], b[4] - b[1], b[5] - b[2]), mat);
          m.position.set((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, -(b[2] + b[5]) / 2);
          holder.add(m);
        }
        this.dbg.add(holder);
      }
    }
    // The undead.
    const seen = new Set<number>();
    for (const zb of h.zombies) {
      seen.add(zb.id);
      let v = this.zviews.get(zb.id);
      if (!v) {
        if (!loaded(zb.dog ? 'hellhound' : 'zombie-male')) continue;
        v = new ZView(zb.dog, zb.male, zb.id);
        this.zviews.set(zb.id, v);
        this.group.add(v.root);
      }
      v.update(zb, dt, time, 60);
    }
    for (const [id, v] of this.zviews)
      if (!seen.has(id)) {
        v.dispose();
        this.zviews.delete(id);
      }
    // Boards: torn off (they fly out) / nailed back (they snap in).
    h.meta.windows.forEach((w, i) => {
      const want = h.boards[i] ?? 6;
      const list = this.boardMeshes[i]!;
      while (this.boardShown[i]! > want) {
        const k = --this.boardShown[i]!;
        const m = list[k]!;
        const fly = m.clone();
        this.group.add(fly);
        this.flying.push({ m: fly, t: 0, vx: -w.nx * 3 + (Math.random() - 0.5), vy: 2 + Math.random() * 2, vz: -w.nz * 3 + (Math.random() - 0.5), spin: (Math.random() - 0.5) * 12 });
        m.visible = false;
      }
      while (this.boardShown[i]! < want) {
        const k = this.boardShown[i]!++;
        const m = list[k]!;
        m.visible = true;
        m.position.copy(m.userData.home as THREE.Vector3).addScaledVector(new THREE.Vector3(w.nx, 0, w.nz), 0.9);
        m.userData.snap = 0;
      }
      for (const m of list) {
        if (m.userData.snap === undefined) continue;
        m.userData.snap += dt * 6;
        const k = Math.min(1, m.userData.snap as number);
        m.position.lerp(m.userData.home as THREE.Vector3, k);
        if (k >= 1) delete m.userData.snap;
      }
    });
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const f = this.flying[i]!;
      f.t += dt;
      f.vy -= 12 * dt;
      f.m.position.x += f.vx * dt;
      f.m.position.y = Math.max(0.05, f.m.position.y + f.vy * dt);
      f.m.position.z += f.vz * dt;
      f.m.rotation.x += f.spin * dt;
      if (f.t > 3) {
        f.m.removeFromParent();
        this.flying.splice(i, 1);
      }
    }
    // Doors fade out once bought.
    this.doorViews.forEach((d, i) => {
      if (!h.doors[i] || !d.visible) return;
      this.doorFade[i] = Math.max(0, this.doorFade[i]! - dt * 1.5);
      d.position.y = -(1 - this.doorFade[i]!) * 3.2;
      if (this.doorFade[i]! <= 0) d.visible = false;
    });
    // Perk machines light up with the power (solo revive is always on).
    const solo = g.soldiers.length <= 1;
    this.perkViews.forEach((v, i) => {
      const p = h.meta.perks[i]!;
      const gone = p.perk === 'revive' && solo && h.reviveBought >= 3;
      v.g.visible = !gone;
      const on = h.power || (p.perk === 'revive' && solo);
      const flick = on ? 1.2 + Math.sin(time * 3 + i) * 0.25 : 0.05;
      v.sign.emissiveIntensity = flick;
      (v.halo.material as THREE.SpriteMaterial).opacity = on ? 0.35 + Math.sin(time * 2 + i) * 0.08 : 0;
    });
    // Mystery box.
    const fire = g.time < h.firesale;
    this.boxViews.forEach((v, i) => {
      const st = h.boxes[i]!;
      const active = i === h.boxAt || fire || st.state !== 'idle';
      v.g.visible = active;
      (v.beam.material as THREE.MeshBasicMaterial).opacity = active && st.state !== 'gone' ? 0.07 + Math.sin(time * 1.5) * 0.02 : 0;
      v.qm.emissiveIntensity = 1.2 + Math.sin(time * 4) * 0.4;
      // Lid.
      const open = st.state === 'roll' || st.state === 'offer' || st.state === 'bear';
      v.lidA += ((open ? -1.6 : 0) - v.lidA) * Math.min(1, dt * 6);
      v.lid.rotation.x = v.lidA;
      // Gone: rises and fades away.
      v.g.position.y = st.state === 'gone' ? Math.min(6, (5 - st.t) * 1.8) : 0;
      // The weapon on offer (cycling while it rolls).
      let gunId = '';
      let gy = 0.7;
      if (st.state === 'roll') {
        const left = st.t;
        const step = left > 1.2 ? 0.09 : 0.09 + (1.2 - left) * 0.35;
        const k = Math.floor(time / step);
        gunId = left < 0.25 ? (st.weapon === 'bear' ? '' : st.weapon) : this.poolIds[k % this.poolIds.length]!;
        gy = 0.4 + (4.2 - left) * 0.12;
      } else if (st.state === 'offer') {
        gunId = st.weapon;
        gy = 0.4 + Math.max(0, st.t / 12) * 0.55;
      }
      if (gunId !== v.gunId) {
        if (v.gun) disposeTree(v.gun);
        v.gun = null;
        v.gunId = gunId;
        const def = WEAPON[gunId];
        if (gunId === 'monkey') {
          v.gun = new THREE.Group();
          const toy = monkeyToy().g;
          toy.scale.setScalar(1.8);
          v.gun.add(toy);
          v.g.add(v.gun);
        } else if (def) {
          const o = cloneModel(def.model);
          const b = gunBounds(def.model);
          const s = def.scale * 1.1;
          o.scale.setScalar(s);
          o.position.set(-((b.min.x + b.max.x) / 2) * s, 0, 0);
          v.gun = new THREE.Group();
          v.gun.add(o);
          v.g.add(v.gun);
        }
      }
      if (v.gun) {
        v.gun.position.set(0, gy, 0);
        v.gun.rotation.y = Math.sin(time * 1.2) * 0.25;
      }
      v.bear.visible = st.state === 'bear' || (st.state === 'roll' && st.weapon === 'bear' && st.t < 0.3);
      if (v.bear.visible) v.bear.position.set(0, 0.7 + (st.state === 'bear' ? (3.5 - st.t) * 0.5 : 0), 0);
    });
    // Pack-a-Punch.
    const pp = h.pap;
    this.papView.panels.emissiveIntensity = h.power ? (pp.state === 'work' ? 1.5 + Math.sin(time * 18) * 0.8 : 0.9 + Math.sin(time * 2) * 0.2) : 0.05;
    for (const r of this.papView.rollers) r.rotation.x += dt * (pp.state === 'work' ? 14 : 0);
    const papGun = pp.state === 'ready' ? pp.weapon : '';
    if (papGun !== this.papView.gunId) {
      if (this.papView.gun) disposeTree(this.papView.gun);
      this.papView.gun = null;
      this.papView.gunId = papGun;
      const def = WEAPON[papGun];
      if (def) {
        const o = cloneModel(def.model);
        applyCamo(o, 'darkmatter');
        const b = gunBounds(def.model);
        const s = def.scale * 1.1;
        o.scale.setScalar(s);
        o.position.set(-((b.min.x + b.max.x) / 2) * s, 0, 0);
        this.papView.gun = new THREE.Group();
        this.papView.gun.add(o);
        this.papView.gun.rotation.y = Math.PI / 2;
        this.papView.gun.position.set(0, 0.98, 0.7);
        this.papView.g.add(this.papView.gun);
      }
    }
    // Lights: the theater wakes up with the power (flickering).
    for (const [l, base, power] of this.lights) l.intensity = power && !h.power ? base * 0.18 : base * (power ? 0.92 + Math.sin(time * 23 + l.position.x) * 0.04 : 1);
    // Power lever.
    this.lever.rotation.x += ((h.power ? -0.9 : 0.9) - this.lever.rotation.x) * Math.min(1, dt * 8);
    // Power-ups.
    const dseen = new Set<number>();
    for (const d of h.drops) {
      dseen.add(d.id);
      let v = this.dropViews.get(d.id);
      if (!v) {
        v = new THREE.Group();
        const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: powerIcon(d.kind), color: '#ffffff', transparent: true, depthWrite: false }));
        icon.scale.setScalar(0.75);
        const halo = glow('#30ff40', 1.8, 0.75);
        v.add(halo, icon);
        v.userData.icon = icon;
        this.dropViews.set(d.id, v);
        this.group.add(v);
      }
      v.position.set(d.x, d.y + Math.sin(time * 3 + d.id) * 0.12, d.z);
      // Blinks when it's about to vanish.
      v.visible = d.t > 6 || Math.sin(time * (d.t < 2.5 ? 30 : 14)) > 0;
    }
    for (const [id, v] of this.dropViews)
      if (!dseen.has(id)) {
        disposeTree(v);
        this.dropViews.delete(id);
      }
    // Clockwork Monkeys.
    const mseen = new Set<number>();
    for (const mk of h.monkeys) {
      mseen.add(mk.id);
      let v = this.monkeyViews.get(mk.id);
      if (!v) {
        v = monkeyToy();
        this.monkeyViews.set(mk.id, v);
        this.group.add(v.g);
      }
      v.g.position.set(mk.x, mk.y - 0.07, mk.z);
      const clap = Math.abs(Math.sin(time * 14)) * 0.08;
      v.cymbals[0]!.position.x = -0.13 + clap;
      v.cymbals[1]!.position.x = 0.13 - clap;
      v.light.visible = Math.sin(time * 16) > 0;
    }
    for (const [id, v] of this.monkeyViews)
      if (!mseen.has(id)) {
        disposeTree(v.g);
        this.monkeyViews.delete(id);
      }
    // Ray bolts.
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i]!;
      b.t += dt;
      if ((b.o as THREE.Sprite).isSprite) ((b.o as THREE.Sprite).material as THREE.SpriteMaterial).opacity = Math.max(0, 1 - b.t / b.life);
      if (b.t > b.life) {
        disposeTree(b.o);
        this.bolts.splice(i, 1);
      }
    }
  }

  dispose(): void {
    for (const v of this.zviews.values()) v.dispose();
    this.zviews.clear();
    disposeTree(this.group);
  }
}

export const POWERUP_NAMES = Object.fromEntries(Object.entries(POWERUPS).map(([k, v]) => [k, v.name])) as Record<PowerUp, string>;
