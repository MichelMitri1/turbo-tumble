import * as THREE from 'three';
import { instantiate, findClip, type TintSpec } from './assets';
import type { CardDefinition, ModelSpec, PropSpec, Team } from './types';

/**
 * Builds the 3D look of a card: the GLB model (scaled to the card's height), its
 * mount and props, or a procedural build for the few things no pack covers.
 */

export const TEAM_COLORS: Record<Team, { main: string; light: string; dark: string }> = {
  blue: { main: '#2f9bff', light: '#8fd0ff', dark: '#1a4f9e' },
  red: { main: '#ff4b5c', light: '#ffa0a8', dark: '#9e1a2c' },
};

const toon = (color: string, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.05, ...opts });
function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export interface BuiltModel {
  root: THREE.Group;
  /** Main animated model (plus rider, if mounted). */
  mixers: THREE.AnimationMixer[];
  clips: THREE.AnimationClip[];
  riderClips: THREE.AnimationClip[];
  mountClips: THREE.AnimationClip[];
  riderMixer: THREE.AnimationMixer | null;
  mountMixer: THREE.AnimationMixer | null;
  /** All materials (for hit flashes / fades). */
  materials: THREE.MeshStandardMaterial[];
  height: number;
}

const BONES = {
  hand: [/^Fist\.R$/, /^Hand\.?R$/i, /^RightHand$/i, /^LowerArm\.R$/, /^arm-right$/],
  head: [/^Head$/, /^head$/],
  back: [/^Torso$/, /^Chest$/i, /^torso$/, /^Spine/i],
};

function findBone(root: THREE.Object3D, kind: keyof typeof BONES): THREE.Object3D | null {
  for (const re of BONES[kind]) {
    let found: THREE.Object3D | null = null;
    root.traverse((o) => {
      if (!found && re.test(o.name)) found = o;
    });
    if (found) return found;
  }
  return null;
}

async function buildProp(p: PropSpec): Promise<THREE.Object3D> {
  if (p.model.startsWith('proc:')) return procProp(p.model.slice(5), p.height);
  const inst = await instantiate(p.model, p.height, p.tint as TintSpec | undefined);
  if (inst.mixer) {
    const idle = findClip(inst.clips, /^idle$/i, /idle/i);
    if (idle) inst.mixer.clipAction(idle).play();
    inst.root.userData.mixer = inst.mixer;
  }
  return inst.root;
}

/** Attach `obj` (already sized in world units) to a bone, cancelling the bone's scale. */
function attach(model: THREE.Object3D, obj: THREE.Object3D, p: PropSpec): void {
  model.updateMatrixWorld(true);
  const bone = p.at === 'offset' ? null : findBone(model, p.at);
  if (!bone) {
    const [x, y, z] = p.offset ?? (p.at === 'head' ? [0, 1, 0] : p.at === 'back' ? [0, 0.6, -0.3] : [0.35, 0.5, 0.15]);
    obj.position.set(x, y, z);
    if (p.rotation) obj.rotation.set(...p.rotation);
    model.add(obj);
    return;
  }
  const s = new THREE.Vector3();
  bone.getWorldScale(s);
  const holder = new THREE.Group();
  holder.scale.setScalar(1 / (s.x || 1));
  bone.add(holder);
  holder.add(obj);
  if (p.at === 'hand') {
    obj.rotation.set(...(p.rotation ?? [Math.PI / 2, 0, 0]));
  } else if (p.at === 'back') {
    obj.position.set(0, 0.05, -0.25);
    obj.rotation.set(...(p.rotation ?? [0.2, 0, 0]));
  } else if (p.at === 'head') {
    obj.position.set(0, 0.32, 0);
  }
  if (p.offset) obj.position.add(new THREE.Vector3(...p.offset));
}

export async function buildCardModel(card: CardDefinition, team: Team): Promise<BuiltModel> {
  const v = card.visual;
  const root = new THREE.Group();
  const out: BuiltModel = { root, mixers: [], clips: [], riderClips: [], mountClips: [], riderMixer: null, mountMixer: null, materials: [], height: v.height };
  if (v.model.startsWith('proc:')) {
    root.add(procModel(v.model.slice(5), v.height, team));
  } else if (v.mount) {
    const mount = await instantiate(v.mount.model, v.mount.height, v.mount.tint as TintSpec | undefined);
    const rider = await instantiate(v.model, v.height, v.tint as TintSpec | undefined);
    rider.root.position.y = v.mount.seat - v.height * 0.32;
    rider.root.position.z = -0.05;
    mount.root.add(rider.root);
    root.add(mount.root);
    out.mountMixer = mount.mixer;
    out.mountClips = mount.clips;
    out.riderMixer = rider.mixer;
    out.riderClips = rider.clips;
    if (mount.mixer) out.mixers.push(mount.mixer);
    if (rider.mixer) out.mixers.push(rider.mixer);
    for (const p of v.props ?? []) attach(rider.root, await buildProp(p), p);
  } else {
    const inst = await instantiate(v.model, v.height, v.tint as TintSpec | undefined, { width: v.width });
    if (v.yaw) inst.root.rotation.y = v.yaw;
    root.add(inst.root);
    out.clips = inst.clips;
    if (inst.mixer) out.mixers.push(inst.mixer);
    for (const p of v.props ?? []) attach(inst.root, await buildProp(p), p);
  }
  // Prop models with their own idle loops (goblins riding on backs…).
  root.traverse((o) => {
    if (o.userData.mixer) out.mixers.push(o.userData.mixer as THREE.AnimationMixer);
  });
  // Every instance gets its own materials so hits can flash and deaths can fade.
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const own = (mat: THREE.Material) => {
      const c = mat.clone() as THREE.MeshStandardMaterial;
      c.transparent = false;
      c.userData.baseEmissive = c.emissive ? c.emissive.clone() : new THREE.Color(0);
      c.userData.baseEmissiveIntensity = c.emissiveIntensity ?? 1;
      out.materials.push(c);
      return c;
    };
    m.material = Array.isArray(m.material) ? m.material.map(own) : own(m.material);
  });
  return out;
}

// ============================================================================ procedural

const WOOD = '#9a6237';
const WOOD_DARK = '#6b4129';
const METAL = '#b9c8d5';
const GOLD = '#ffcf3f';

function procProp(kind: string, h: number): THREE.Object3D {
  const g = new THREE.Group();
  const s = h;
  switch (kind) {
    case 'crown': {
      const band = mesh(new THREE.CylinderGeometry(0.5 * s, 0.45 * s, 0.35 * s, 10, 1, true), toon(GOLD, { metalness: 0.5, roughness: 0.3, side: THREE.DoubleSide }));
      g.add(band);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        g.add(mesh(new THREE.ConeGeometry(0.1 * s, 0.35 * s, 5), toon(GOLD, { metalness: 0.5, roughness: 0.3 }), Math.cos(a) * 0.45 * s, 0.3 * s, Math.sin(a) * 0.45 * s));
      }
      break;
    }
    case 'axe':
    case 'hammer':
    case 'mace':
    case 'pickaxe': {
      g.add(mesh(new THREE.CylinderGeometry(0.035 * s, 0.04 * s, s, 6), toon(WOOD_DARK), 0, s * 0.5, 0));
      if (kind === 'axe') g.add(mesh(new THREE.BoxGeometry(0.06 * s, 0.32 * s, 0.38 * s), toon(METAL, { metalness: 0.6, roughness: 0.3 }), 0, s * 0.85, 0.15 * s));
      if (kind === 'hammer') g.add(mesh(new THREE.BoxGeometry(0.28 * s, 0.24 * s, 0.42 * s), toon('#8a8f9c', { metalness: 0.5 }), 0, s * 0.9, 0));
      if (kind === 'mace') g.add(mesh(new THREE.DodecahedronGeometry(0.17 * s), toon('#4d4a5e', { metalness: 0.6, roughness: 0.3 }), 0, s * 0.92, 0));
      if (kind === 'pickaxe') {
        const head = mesh(new THREE.TorusGeometry(0.25 * s, 0.035 * s, 6, 12, Math.PI), toon(METAL, { metalness: 0.6 }), 0, s * 0.82, 0);
        head.rotation.y = Math.PI / 2;
        g.add(head);
      }
      break;
    }
    case 'bow':
    case 'crossbow':
    case 'slingshot': {
      const arc = mesh(new THREE.TorusGeometry(0.4 * s, 0.03 * s, 6, 16, Math.PI), toon(WOOD));
      arc.rotation.z = Math.PI / 2;
      g.add(arc);
      if (kind === 'crossbow') g.add(mesh(new THREE.BoxGeometry(0.06 * s, 0.06 * s, 0.7 * s), toon(WOOD_DARK), 0, 0, 0.1 * s));
      break;
    }
    case 'staff':
      g.add(mesh(new THREE.CylinderGeometry(0.03 * s, 0.035 * s, s, 6), toon(WOOD_DARK), 0, s * 0.45, 0));
      g.add(mesh(new THREE.IcosahedronGeometry(0.1 * s), toon('#7ef0ff', { emissive: '#3fd8ff', emissiveIntensity: 0.8 }), 0, s * 0.98, 0));
      break;
    case 'gun':
    case 'blowgun':
    case 'launcher':
      g.add(mesh(new THREE.CylinderGeometry(0.06 * s, 0.07 * s, s, 8), toon(kind === 'launcher' ? '#d23a3a' : '#3b3f4a', { metalness: 0.4 }), 0, s * 0.5, 0));
      if (kind === 'gun') g.add(mesh(new THREE.BoxGeometry(0.1 * s, 0.25 * s, 0.12 * s), toon(WOOD), 0, 0.1 * s, -0.05 * s));
      break;
    case 'hook':
      g.add(mesh(new THREE.CylinderGeometry(0.03 * s, 0.03 * s, s, 6), toon(WOOD), 0, s * 0.5, 0));
      g.add(mesh(new THREE.TorusGeometry(0.12 * s, 0.03 * s, 6, 10, Math.PI * 1.4), toon(METAL, { metalness: 0.6 }), 0, s, 0.1 * s));
      break;
    case 'balloon':
      return balloon(h, '#ffcf3f', '#ff6a3d');
    default:
      g.add(mesh(new THREE.BoxGeometry(0.2 * s, 0.2 * s, 0.2 * s), toon('#ff00ff')));
  }
  return g;
}

function balloon(h: number, a: string, b: string): THREE.Group {
  const g = new THREE.Group();
  const env = new THREE.SphereGeometry(0.42 * h, 16, 12);
  const stripes = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const seg = mesh(new THREE.SphereGeometry(0.43 * h, 16, 12, (i / 6) * Math.PI * 2, Math.PI / 6), toon(i % 2 ? a : b));
    seg.position.y = 0.55 * h;
    stripes.add(seg);
  }
  g.add(mesh(env, toon(a), 0, 0.55 * h, 0));
  g.add(stripes);
  for (const [x, z] of [[-0.12, -0.12], [0.12, -0.12], [-0.12, 0.12], [0.12, 0.12]]) {
    const rope = mesh(new THREE.CylinderGeometry(0.008 * h, 0.008 * h, 0.35 * h, 4), toon('#6b4129'), x * h, 0.12 * h, z * h);
    g.add(rope);
  }
  return g;
}

/** Whole-unit procedural builds. */
function procModel(kind: string, h: number, team: Team): THREE.Group {
  const g = new THREE.Group();
  const tc = TEAM_COLORS[team];
  switch (kind) {
    case 'ram': {
      const log = mesh(new THREE.CylinderGeometry(0.28 * h, 0.3 * h, 2.2 * h, 12), toon(WOOD));
      log.rotation.x = Math.PI / 2;
      log.position.y = 0.55 * h;
      g.add(log);
      g.add(mesh(new THREE.ConeGeometry(0.3 * h, 0.35 * h, 12), toon(METAL, { metalness: 0.6 }), 0, 0.55 * h, 1.25 * h).rotateX(Math.PI / 2));
      // Two raiders carrying it (static pose — the log bobs while running).
      for (const side of [-1, 1]) {
        const body = mesh(new THREE.CapsuleGeometry(0.2 * h, 0.35 * h, 4, 8), toon(tc.main), side * 0.4 * h, 0.45 * h, side * 0.3 * h);
        g.add(body);
        g.add(mesh(new THREE.SphereGeometry(0.17 * h, 10, 8), toon('#e0a070'), side * 0.4 * h, 0.85 * h, side * 0.3 * h));
        g.add(mesh(new THREE.SphereGeometry(0.18 * h, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), toon(METAL, { metalness: 0.5 }), side * 0.4 * h, 0.9 * h, side * 0.3 * h));
      }
      break;
    }
    case 'bomb-balloon': {
      const b = balloon(h, tc.main, '#ffcf3f');
      b.position.y = 0.35 * h;
      g.add(b);
      g.add(mesh(new THREE.CylinderGeometry(0.2 * h, 0.17 * h, 0.18 * h, 10), toon(WOOD), 0, 0.12 * h, 0));
      g.add(mesh(new THREE.SphereGeometry(0.12 * h, 12, 10), toon('#2a2638', { metalness: 0.4, roughness: 0.4 }), 0, -0.02 * h, 0));
      break;
    }
    case 'cart': {
      g.add(mesh(new THREE.BoxGeometry(0.9 * h, 0.35 * h, 1.1 * h), toon(WOOD), 0, 0.45 * h, 0));
      for (const x of [-0.5, 0.5]) for (const z of [-0.35, 0.35]) {
        const w = mesh(new THREE.CylinderGeometry(0.22 * h, 0.22 * h, 0.12 * h, 14), toon(WOOD_DARK), x * h, 0.22 * h, z * h);
        w.rotation.z = Math.PI / 2;
        g.add(w);
      }
      const barrel = mesh(new THREE.CylinderGeometry(0.16 * h, 0.2 * h, 0.9 * h, 12), toon('#3b3f4a', { metalness: 0.5 }), 0, 0.8 * h, 0.2 * h);
      barrel.rotation.x = Math.PI / 2.3;
      barrel.name = 'weapon';
      g.add(barrel);
      g.add(mesh(new THREE.BoxGeometry(0.95 * h, 0.08 * h, 0.2 * h), toon(tc.main), 0, 0.64 * h, -0.5 * h));
      break;
    }
    case 'volt': {
      g.add(mesh(new THREE.BoxGeometry(1 * h, 0.35 * h, 1.2 * h), toon('#6b4129'), 0, 0.42 * h, 0));
      for (const x of [-0.55, 0.55]) for (const z of [-0.4, 0.4]) {
        const w = mesh(new THREE.CylinderGeometry(0.22 * h, 0.22 * h, 0.12 * h, 14), toon('#3b3f4a'), x * h, 0.22 * h, z * h);
        w.rotation.z = Math.PI / 2;
        g.add(w);
      }
      const coil = mesh(new THREE.CylinderGeometry(0.22 * h, 0.3 * h, 0.7 * h, 12), toon('#ffcf3f', { metalness: 0.6, roughness: 0.3 }), 0, 0.95 * h, 0);
      g.add(coil);
      for (let i = 0; i < 4; i++) g.add(mesh(new THREE.TorusGeometry(0.28 * h, 0.04 * h, 6, 16), toon('#b87333', { metalness: 0.7 }), 0, (0.7 + i * 0.15) * h, 0).rotateX(Math.PI / 2));
      const orb = mesh(new THREE.SphereGeometry(0.2 * h, 14, 10), toon('#bff2ff', { emissive: '#3fd8ff', emissiveIntensity: 1.2 }), 0, 1.4 * h, 0);
      orb.name = 'charge';
      g.add(orb);
      break;
    }
    case 'hut':
    case 'longhouse': {
      const w = kind === 'hut' ? 0.85 : 1;
      g.add(mesh(new THREE.CylinderGeometry(0.4 * w * h, 0.44 * w * h, 0.55 * h, 8), toon(kind === 'hut' ? '#8a6a3a' : '#7a5230'), 0, 0.27 * h, 0));
      g.add(mesh(new THREE.ConeGeometry(0.58 * w * h, 0.6 * h, 8), toon(kind === 'hut' ? '#c9a14a' : tc.main), 0, 0.82 * h, 0));
      g.add(mesh(new THREE.BoxGeometry(0.22 * h, 0.34 * h, 0.08 * h), toon('#3a2a1a'), 0, 0.17 * h, 0.43 * w * h));
      g.add(mesh(new THREE.ConeGeometry(0.08 * h, 0.2 * h, 6), toon('#e8e0c8'), 0, 1.18 * h, 0));
      break;
    }
    case 'pump': {
      g.add(mesh(new THREE.CylinderGeometry(0.55 * h, 0.6 * h, 0.4 * h, 10), toon('#6a6f80'), 0, 0.2 * h, 0));
      const tank = mesh(new THREE.SphereGeometry(0.45 * h, 18, 14), new THREE.MeshPhysicalMaterial({ color: '#ff6ad5', roughness: 0.15, transmission: 0.2, emissive: '#c02ab0', emissiveIntensity: 0.35, clearcoat: 1 }), 0, 0.85 * h, 0);
      tank.name = 'charge';
      g.add(tank);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        g.add(mesh(new THREE.CylinderGeometry(0.05 * h, 0.05 * h, 0.9 * h, 6), toon(GOLD, { metalness: 0.6 }), Math.cos(a) * 0.45 * h, 0.7 * h, Math.sin(a) * 0.45 * h));
      }
      break;
    }
    case 'furnace': {
      g.add(mesh(new THREE.CylinderGeometry(0.55 * h, 0.65 * h, 0.9 * h, 10), toon('#5a5560'), 0, 0.45 * h, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.15 * h, 0.18 * h, 0.6 * h, 8), toon('#3a3640'), 0.25 * h, 1.1 * h, 0));
      const mouth = mesh(new THREE.CircleGeometry(0.22 * h, 12), toon('#ff8c1a', { emissive: '#ff5a1a', emissiveIntensity: 1.4 }), 0, 0.35 * h, 0.64 * h);
      mouth.name = 'charge';
      g.add(mouth);
      break;
    }
    case 'cage': {
      g.add(mesh(new THREE.CylinderGeometry(0.65 * h, 0.7 * h, 0.12 * h, 12), toon('#6a6f80'), 0, 0.06 * h, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.65 * h, 0.65 * h, 0.1 * h, 12), toon('#6a6f80'), 0, 1 * h, 0));
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        g.add(mesh(new THREE.CylinderGeometry(0.03 * h, 0.03 * h, 0.95 * h, 5), toon('#3b3f4a', { metalness: 0.6 }), Math.cos(a) * 0.6 * h, 0.52 * h, Math.sin(a) * 0.6 * h));
      }
      g.add(mesh(new THREE.SphereGeometry(0.3 * h, 12, 10), toon('#74bd4b'), 0, 0.45 * h, 0));
      break;
    }
    case 'drill': {
      g.add(mesh(new THREE.CylinderGeometry(0.7 * h, 0.8 * h, 0.2 * h, 12), toon('#7a5a3a'), 0, 0.1 * h, 0));
      const bit = mesh(new THREE.ConeGeometry(0.35 * h, 1 * h, 10), toon(METAL, { metalness: 0.7, roughness: 0.3 }), 0, 0.7 * h, 0);
      bit.rotation.x = Math.PI;
      bit.name = 'spin';
      g.add(bit);
      break;
    }
    case 'egg':
      g.add(mesh(new THREE.SphereGeometry(0.4 * h, 16, 14).scale(1, 1.3, 1), toon('#ffcf6a', { emissive: '#ff6a1a', emissiveIntensity: 0.4 }), 0, 0.5 * h, 0));
      break;
    // Spell icons (portraits only).
    case 'fireball':
      g.add(mesh(new THREE.IcosahedronGeometry(0.45 * h, 2), toon('#ff8c1a', { emissive: '#ff4a1a', emissiveIntensity: 1 }), 0, 0.5 * h, 0));
      break;
    case 'snowball':
      g.add(mesh(new THREE.IcosahedronGeometry(0.45 * h, 2), toon('#f4fbff'), 0, 0.5 * h, 0));
      break;
    case 'void':
      g.add(mesh(new THREE.IcosahedronGeometry(0.42 * h, 2), toon('#2a1a4a', { emissive: '#7b2fc0', emissiveIntensity: 0.8 }), 0, 0.5 * h, 0));
      break;
    case 'bolt': {
      const shape = new THREE.Shape([new THREE.Vector2(0.1, 0.5), new THREE.Vector2(-0.15, 0.02), new THREE.Vector2(0.03, 0.02), new THREE.Vector2(-0.1, -0.5), new THREE.Vector2(0.18, 0.08), new THREE.Vector2(0, 0.08)].map((p) => p.multiplyScalar(h)));
      g.add(mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.12 * h, bevelEnabled: false }), toon('#ffe14d', { emissive: '#ffcf3f', emissiveIntensity: 0.8 }), 0, 0.5 * h, 0));
      break;
    }
    case 'log': {
      const l = mesh(new THREE.CylinderGeometry(0.22 * h, 0.22 * h, 1 * h, 14), toon(WOOD), 0, 0.3 * h, 0);
      l.rotation.z = Math.PI / 2;
      g.add(l);
      break;
    }
    case 'tornado':
      for (let i = 0; i < 5; i++) g.add(mesh(new THREE.TorusGeometry((0.12 + i * 0.07) * h, 0.04 * h, 6, 18), toon('#c8e8f0'), 0, (0.1 + i * 0.18) * h, 0).rotateX(Math.PI / 2));
      break;
    default:
      g.add(mesh(new THREE.BoxGeometry(0.5 * h, 0.5 * h, 0.5 * h), toon('#ff00ff'), 0, 0.25 * h, 0));
  }
  return g;
}

export function procSpellIcon(kind: string, h: number): THREE.Group {
  return procModel(kind, h, 'blue');
}

/** Team crown tower: Kenney castle stack + team roof/flags + a defender on top (added by the scene). */
export function towerColors(team: Team): { roof: THREE.Color; trim: THREE.Color } {
  return { roof: new THREE.Color(TEAM_COLORS[team].main), trim: new THREE.Color(TEAM_COLORS[team].light) };
}

export function modelSpecHeight(v: ModelSpec): number {
  return v.mount ? v.mount.seat + v.height * 0.7 : v.height;
}
