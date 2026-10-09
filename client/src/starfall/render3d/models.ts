import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Prop } from '../sim/maps';

/**
 * 3D models built from primitives in the original's style: chunky crewmates with a big visor,
 * a backpack and two stubby legs, a black cartoon outline (inverted hull), dead half-bodies
 * with a bone, see-through ghosts, and every map prop.
 */

/** Materials go through this so the vision fog can darken them. */
export type MatFn = (color: string | number, opts?: { emissive?: string | number; transparent?: boolean; opacity?: number; flat?: boolean }) => THREE.Material;

export const OUTLINE = new THREE.MeshBasicMaterial({ color: 0x0b0b10, side: THREE.BackSide });
export const OUTLINE_RED = new THREE.MeshBasicMaterial({ color: 0xff2020, side: THREE.BackSide });
const OUTLINE_GHOST = new THREE.MeshBasicMaterial({ color: 0x0b0b10, side: THREE.BackSide, transparent: true, opacity: 0.35, depthWrite: false });

const G = {
  body: new THREE.CapsuleGeometry(0.36, 0.5, 8, 20),
  leg: new THREE.CapsuleGeometry(0.135, 0.16, 6, 12),
  pack: new RoundedBoxGeometry(0.46, 0.5, 0.24, 3, 0.08),
  visor: new THREE.SphereGeometry(1, 24, 16),
  tail: new THREE.ConeGeometry(0.36, 0.5, 20, 1, true),
  cut: new THREE.CylinderGeometry(0.36, 0.36, 0.32, 20),
  disc: new THREE.CircleGeometry(0.35, 20),
  bone: new THREE.CylinderGeometry(0.045, 0.045, 0.28, 8),
  knob: new THREE.SphereGeometry(0.06, 10, 8),
  shadow: new THREE.CircleGeometry(0.42, 20),
};
const VISOR = new THREE.MeshLambertMaterial({ color: 0x95cadc, emissive: 0x1d3a46 });
const VISOR_SHINE = new THREE.MeshBasicMaterial({ color: 0xffffff });
const SHADOW = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false });

function outlined(geo: THREE.BufferGeometry, mat: THREE.Material, scale = 1.07): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  const o = new THREE.Mesh(geo, OUTLINE);
  o.scale.setScalar(scale);
  o.name = 'outline';
  m.add(o);
  return m;
}

/** One crewmate (local +z = forward, feet at y = 0). */
export class Bean3D {
  readonly root = new THREE.Group();
  private body: THREE.Group;
  private legs: THREE.Mesh[] = [];
  private mat: THREE.MeshLambertMaterial;
  private outlines: THREE.Mesh[] = [];
  private ghostBits: THREE.Object3D[] = [];
  private heading = 0;
  private phase = 0;
  private lastX = NaN;
  private lastY = NaN;
  ghost = false;

  constructor(color: string) {
    this.mat = new THREE.MeshLambertMaterial({ color });
    this.body = new THREE.Group();
    this.root.add(this.body);
    const body = outlined(G.body, this.mat);
    body.position.y = 0.88;
    const pack = outlined(G.pack, this.mat, 1.09);
    pack.position.set(0, 0.86, -0.4);
    const visor = new THREE.Mesh(G.visor, VISOR);
    visor.scale.set(0.27, 0.16, 0.2);
    visor.position.set(0, 1.04, 0.27);
    const vo = new THREE.Mesh(G.visor, OUTLINE);
    vo.scale.setScalar(1.12);
    vo.name = 'outline';
    visor.add(vo);
    const shine = new THREE.Mesh(G.visor, VISOR_SHINE);
    shine.scale.set(0.3, 0.22, 0.3);
    shine.position.set(0.35, 0.35, 0.85);
    visor.add(shine);
    this.body.add(body, pack, visor);
    for (const x of [-0.17, 0.17]) {
      const leg = outlined(G.leg, this.mat, 1.12);
      leg.position.set(x, 0.24, 0.02);
      this.legs.push(leg);
      this.body.add(leg);
    }
    // Ghost tail (replaces the legs).
    const tail = new THREE.Mesh(G.tail, this.mat);
    tail.rotation.x = Math.PI;
    tail.position.y = 0.4;
    this.ghostBits.push(tail);
    this.body.add(tail);
    tail.visible = false;
    const sh = new THREE.Mesh(G.shadow, SHADOW);
    sh.rotation.x = -Math.PI / 2;
    sh.position.y = 0.02;
    sh.name = 'shadow';
    this.root.add(sh);
    this.root.traverse((o) => {
      if (o.name === 'outline') this.outlines.push(o as THREE.Mesh);
    });
  }

  setGhost(on: boolean): void {
    if (on === this.ghost) return;
    this.ghost = on;
    this.mat.transparent = on;
    this.mat.opacity = on ? 0.5 : 1;
    this.mat.depthWrite = !on;
    for (const l of this.legs) l.visible = !on;
    for (const g of this.ghostBits) g.visible = on;
    for (const o of this.outlines) o.material = on ? OUTLINE_GHOST : OUTLINE;
    this.root.getObjectByName('shadow')!.visible = !on;
  }

  setGlow(red: boolean): void {
    if (this.ghost) return;
    for (const o of this.outlines) o.material = red ? OUTLINE_RED : OUTLINE;
  }

  /** Place it (sim x, y), walking animation from movement. */
  update(x: number, y: number, dt: number, t: number, moving: boolean, left: boolean): void {
    const dx = Number.isNaN(this.lastX) ? 0 : x - this.lastX;
    const dy = Number.isNaN(this.lastY) ? 0 : y - this.lastY;
    this.lastX = x;
    this.lastY = y;
    const d = Math.hypot(dx, dy);
    if (d > 0.002 && d < 1) this.heading = Math.atan2(dx, dy);
    else if (moving && d === 0) this.heading = left ? -Math.PI / 2 : Math.PI / 2;
    // Turn smoothly.
    let r = this.heading - this.root.rotation.y;
    r = Math.atan2(Math.sin(r), Math.cos(r));
    this.root.rotation.y += r * Math.min(1, dt * 14);
    this.root.position.set(x, 0, y);
    const walking = d > 0.002 || moving;
    if (walking) this.phase += d * 5.2 + (d === 0 ? dt * 8 : 0);
    const s = Math.sin(this.phase);
    if (this.ghost) {
      this.body.position.y = 0.25 + Math.sin(t * 2.5) * 0.08;
      this.body.rotation.z = Math.sin(t * 1.7) * 0.06;
      return;
    }
    this.body.position.y = walking ? Math.abs(s) * 0.05 : 0;
    this.body.rotation.z = walking ? s * 0.06 : 0;
    this.legs[0]!.position.z = walking ? 0.02 + s * 0.13 : 0.02;
    this.legs[1]!.position.z = walking ? 0.02 - s * 0.13 : 0.02;
    this.legs[0]!.position.y = 0.24 + (walking ? Math.max(0, s) * 0.06 : 0);
    this.legs[1]!.position.y = 0.24 + (walking ? Math.max(0, -s) * 0.06 : 0);
  }

  dispose(): void {
    this.mat.dispose();
    this.root.removeFromParent();
  }
}

/** The bottom half of a crewmate, a bone sticking out. */
export function deadBody(color: string, shadow: string): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color });
  const inner = new THREE.MeshLambertMaterial({ color: shadow });
  const cut = outlined(G.cut, mat, 1.08);
  cut.position.y = 0.42;
  const top = new THREE.Mesh(G.disc, inner);
  top.rotation.x = -Math.PI / 2;
  top.position.y = 0.585;
  const bone = new THREE.Mesh(G.bone, new THREE.MeshLambertMaterial({ color: 0xf4f1e6 }));
  bone.position.set(0, 0.72, 0);
  for (const dx of [-0.05, 0.05]) {
    const k = new THREE.Mesh(G.knob, bone.material);
    k.position.set(dx, 0.14, 0);
    bone.add(k);
  }
  g.add(cut, top, bone);
  for (const x of [-0.17, 0.17]) {
    const leg = outlined(G.leg, mat, 1.12);
    leg.position.set(x, 0.18, 0);
    g.add(leg);
  }
  const sh = new THREE.Mesh(G.shadow, SHADOW);
  sh.rotation.x = -Math.PI / 2;
  sh.position.y = 0.02;
  g.add(sh);
  g.rotation.y = Math.random() * Math.PI * 2;
  return g;
}

// ---------------------------------------------------------------- props

/** Build a map prop. Returns the object and its height (to fade it if it hides you). */
export function prop3d(p: Prop, mat: MatFn): { obj: THREE.Object3D; h: number; anim?: (t: number) => void } {
  const g = new THREE.Group();
  g.position.set(p.x, 0, p.y);
  const w = p.w ?? (p.r ?? 0.5) * 2;
  const d = p.h ?? (p.r ?? 0.5) * 2;
  const box = (bw: number, bh: number, bd: number, color: string | number, y = bh / 2, x = 0, z = 0, emissive?: string | number) => {
    const m = new THREE.Mesh(new RoundedBoxGeometry(bw, bh, bd, 2, Math.min(0.06, bw / 4, bh / 4, bd / 4)), mat(color, { emissive }));
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return m;
  };
  const cyl = (r: number, h: number, color: string | number, y = h / 2, x = 0, z = 0, emissive?: string | number, seg = 24) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat(color, { emissive }));
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return m;
  };
  const screen = (bw: number, bd: number, y: number, color: string, z = 0) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(bw, bd), mat(color, { emissive: color, flat: true }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(0, y, z);
    g.add(m);
    return m;
  };
  let h = 1;
  let anim: ((t: number) => void) | undefined;
  switch (p.kind) {
    case 'roundtable':
      cyl(p.r!, 0.08, '#c6d0d9', 0.78);
      cyl(0.16, 0.74, '#6d7a87', 0.37);
      h = 0.8;
      break;
    case 'table':
      box(w, 0.1, d, '#b6c0ca', 0.78);
      box(w * 0.9, 0.7, d * 0.8, '#6d7a87', 0.36);
      h = 0.8;
      break;
    case 'button': {
      cyl(0.5, 0.12, '#5f6b77', 0.86);
      const b = cyl(0.3, 0.12, '#e0242c', 0.96, 0, 0, '#5a0000');
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.44, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat('#bfe6ff', { transparent: true, opacity: 0.35 }));
      dome.position.y = 0.9;
      g.add(dome);
      anim = (t) => (b.scale.y = 1 + Math.sin(t * 3) * 0.05);
      h = 1.3;
      break;
    }
    case 'engine': {
      const e = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2 * 0.85, d, 24), mat('#8f9aa6'));
      e.rotation.x = Math.PI / 2;
      e.position.y = w / 2;
      e.castShadow = true;
      g.add(e);
      const glow = new THREE.Mesh(new THREE.CircleGeometry(w / 2 * 0.7, 24), mat('#ffb347', { emissive: '#ff8a00', flat: true }));
      glow.position.set(0, w / 2, d / 2 + 0.02);
      g.add(glow);
      for (let i = 0; i < 4; i++) box(w + 0.1, 0.12, 0.3, '#3d4650', w / 2, 0, -d / 2 + 0.8 + i * (d - 1.6) / 3);
      anim = (t) => ((glow.material as THREE.MeshLambertMaterial).emissiveIntensity = 0.7 + Math.sin(t * 8) * 0.3);
      h = w;
      break;
    }
    case 'reactor': {
      cyl(p.r!, 0.5, '#4b5560');
      const core = cyl(p.r! * 0.6, 2.4, '#5fd6ff', 1.6, 0, 0, '#2a9bd6');
      cyl(p.r! * 0.75, 0.3, '#4b5560', 2.9);
      anim = (t) => core.scale.set(1 + Math.sin(t * 2) * 0.04, 1, 1 + Math.sin(t * 2) * 0.04);
      h = 3;
      break;
    }
    case 'console':
      box(w, 0.9, d, '#58636f');
      screen(w * 0.8, d * 0.6, 0.91, '#41d1ff');
      h = 0.9;
      break;
    case 'cams':
      box(w, 0.9, d, '#58636f');
      for (let i = 0; i < 4; i++) {
        const s = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.5), mat('#7cf59a', { emissive: '#2a8a40', flat: true }));
        s.position.set(-w / 2 + 0.4 + (i * (w - 0.8)) / 3, 1.25, -d / 2 + 0.05);
        g.add(s);
      }
      box(w, 0.7, 0.08, '#2b313b', 1.25, 0, -d / 2);
      h = 1.6;
      break;
    case 'vitals':
      box(w, 0.9, d, '#58636f');
      box(w, 0.8, 0.08, '#10202a', 1.35, 0, -d / 2 + 0.04, '#0a3a1a');
      h = 1.75;
      break;
    case 'bed':
      box(w, 0.5, d, '#e9eef3');
      box(0.5, 0.12, d * 0.8, '#9fd3ff', 0.55, -w / 2 + 0.35);
      h = 0.6;
      break;
    case 'scanner': {
      cyl(0.75, 0.08, '#6f7b87', 0.04);
      const ring = cyl(0.6, 0.02, '#4cf1a0', 0.09, 0, 0, '#2ad48a');
      anim = (t) => ((ring.material as THREE.MeshLambertMaterial).emissiveIntensity = 0.6 + Math.sin(t * 3) * 0.4);
      h = 0.1;
      break;
    }
    case 'crate':
      box(w, 1.2, d, '#c08a4b');
      h = 1.2;
      break;
    case 'boxes':
      box(w / 2, 0.9, d * 0.6, '#b37c45', 0.45, -w / 4, d / 6);
      box(w / 2, 1.3, d * 0.6, '#c99358', 0.65, w / 4, -d / 6);
      h = 1.3;
      break;
    case 'shelf':
      box(w, 1.8, d, '#7c858e');
      for (let i = 0; i < Math.floor(w); i++) box(0.5, 0.35, 0.4, ['#e9c46a', '#7ad3f5', '#f28482', '#84dc8a'][i % 4]!, 1.98, -w / 2 + 0.55 + i, 0);
      h = 2.2;
      break;
    case 'chair':
      cyl(w / 2, 0.5, '#d14b4b', 0.45);
      cyl(0.1, 0.3, '#4b5560', 0.15);
      h = 0.7;
      break;
    case 'adminmap': {
      box(w, 0.85, d, '#3a4855');
      const s = screen(w - 0.4, d - 0.4, 0.86, '#4cf1ff');
      anim = (t) => ((s.material as THREE.MeshLambertMaterial).emissiveIntensity = 0.7 + Math.sin(t * 2) * 0.2);
      h = 0.9;
      break;
    }
    case 'locker':
      box(w, 2.1, d, '#7a8a9a');
      h = 2.1;
      break;
    case 'rocket': {
      const r = p.r!;
      cyl(r * 0.7, 3.4, '#d9dee4', 1.7);
      const nose = new THREE.Mesh(new THREE.ConeGeometry(r * 0.7, 1.6, 24), mat('#e04a3b'));
      nose.position.y = 4.2;
      g.add(nose);
      for (let i = 0; i < 3; i++) {
        const fin = box(0.15, 1.2, 1.1, '#e04a3b', 0.6);
        fin.rotation.y = (i / 3) * Math.PI * 2;
        fin.position.set(Math.sin(fin.rotation.y) * r * 0.75, 0.6, Math.cos(fin.rotation.y) * r * 0.75);
      }
      h = 5;
      break;
    }
    case 'plant':
    case 'tree': {
      const r = p.r ?? 0.8;
      cyl(r * 0.45, r * 0.6, '#7a5130', r * 0.3, 0, 0, undefined, 12);
      const tall = p.kind === 'tree' ? 2.4 : 1;
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(r * 0.42, 12, 8), mat(p.kind === 'tree' ? '#2f8f5b' : '#3faa4f'));
        leaf.position.set(Math.cos(a) * r * 0.35, r * 0.6 + tall * 0.5 + (i % 2) * 0.2, Math.sin(a) * r * 0.35);
        leaf.castShadow = true;
        g.add(leaf);
      }
      if (p.kind === 'tree') cyl(0.12, tall, '#6b4626', r * 0.6 + tall / 2, 0, 0, undefined, 8);
      h = r * 0.6 + tall;
      break;
    }
    case 'railing':
      box(w, 0.08, d, '#8b97a3', 1.0);
      for (let x = -w / 2; x <= w / 2; x += 1) box(0.08, 1, 0.08, '#8b97a3', 0.5, x);
      h = 1;
      break;
    case 'vending':
      box(w, 2, d, '#d6463f');
      box(0.06, 0.8, d * 0.6, '#ffe066', 1.3, -w / 2, 0, '#806600');
      h = 2;
      break;
    case 'drill': {
      const r = p.r!;
      cyl(r, 0.4, '#d9a33b');
      const bit = new THREE.Group();
      bit.position.y = 0.4;
      for (let i = 0; i < 3; i++) {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, r * 1.6), mat('#5e6670'));
        arm.rotation.y = (i / 3) * Math.PI;
        arm.position.y = 0.15;
        bit.add(arm);
      }
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.05, 1.6, 12), mat('#9aa6b2'));
      shaft.position.y = 1.2;
      bit.add(shaft);
      g.add(bit);
      anim = (t) => (bit.rotation.y = t * 2);
      h = 2;
      break;
    }
    case 'rockpile': {
      const r = p.r!;
      for (const [dx, dz, s] of [[-0.3, 0.2, 0.7], [0.35, 0.15, 0.6], [0, -0.25, 0.75]] as const) {
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(r * s * 0.6, 0), mat('#8b7d72', { flat: true }));
        rock.position.set(dx * r, r * s * 0.4, dz * r);
        rock.castShadow = true;
        g.add(rock);
        const snow = new THREE.Mesh(new THREE.SphereGeometry(r * s * 0.45, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2.5), mat('#f0f5fa'));
        snow.position.set(dx * r, r * s * 0.62, dz * r);
        g.add(snow);
      }
      h = r;
      break;
    }
    case 'lava': {
      const m = new THREE.Mesh(new THREE.CircleGeometry(p.r!, 24), mat('#ff7b2e', { emissive: '#ff4a00', flat: true }));
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.03;
      g.add(m);
      anim = (t) => ((m.material as THREE.MeshLambertMaterial).emissiveIntensity = 0.8 + Math.sin(t * 3) * 0.2);
      h = 0;
      break;
    }
    case 'machine': {
      box(w, 1.4, d, '#6f7a85');
      const lights: THREE.Mesh[] = [];
      for (let i = 0; i < 3; i++) {
        const l = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), mat('#ffd23f', { emissive: '#ffd23f' }));
        l.position.set(-w / 3 + (i * w) / 3, 1.45, 0);
        g.add(l);
        lights.push(l);
      }
      anim = (t) => lights.forEach((l, i) => (l.visible = Math.sin(t * 4 + i * 2) > 0));
      h = 1.5;
      break;
    }
    case 'pipes': {
      for (const dz of [-d / 4, d / 4]) {
        const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, w, 12), mat('#a7b2bd'));
        pipe.rotation.z = Math.PI / 2;
        pipe.position.set(0, 0.4, dz);
        pipe.castShadow = true;
        g.add(pipe);
      }
      h = 0.6;
      break;
    }
    case 'shield': {
      const r = p.r!;
      cyl(r, 0.6, '#4b5560', 0.3);
      for (let i = 0; i < 7; i++) {
        const a = (i / 6) * Math.PI * 2;
        const hex = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.26, r * 0.26, 0.1, 6), mat('#7fd8ff', { emissive: '#1d6a8a' }));
        hex.position.set(i === 6 ? 0 : Math.cos(a) * r * 0.55, 0.65, i === 6 ? 0 : Math.sin(a) * r * 0.55);
        g.add(hex);
      }
      h = 0.7;
      break;
    }
    case 'chute':
      box(1.4, 1.4, 1, '#77818b');
      box(0.9, 0.5, 0.05, '#20262c', 0.9, 0, 0.5);
      h = 1.4;
      break;
    case 'telescope': {
      const r = p.r!;
      cyl(r, 0.6, '#5a6470');
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 2, 16), mat('#c9d3dc'));
      tube.position.set(0.3, 1.3, -0.3);
      tube.rotation.set(-0.6, 0, -0.4);
      tube.castShadow = true;
      g.add(tube);
      h = 2;
      break;
    }
    case 'dropship': {
      const hull = new THREE.Mesh(new THREE.CylinderGeometry(w / 2 - 0.6, w / 2, 2.6, 8, 1), mat('#c9d2db'));
      hull.scale.z = d / w;
      hull.position.y = 1.3;
      hull.castShadow = true;
      g.add(hull);
      const top = new THREE.Mesh(new THREE.SphereGeometry(w / 2 - 0.6, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat('#e15b4c'));
      top.scale.set(1, 0.4, d / w);
      top.position.y = 2.6;
      g.add(top);
      box(w - 1.5, 0.5, 0.1, '#95cadc', 1.6, 0, d / 2 - 0.15, '#1d3a46');
      h = 3.4;
      break;
    }
  }
  return { obj: g, h, anim };
}
