import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { WEAPONS } from '../sim/weapons';
import { BACKDROP_MODELS } from './backdrop';

/** Loads and caches the Zero Hour models (meshopt GLBs from tools/fps-assets.mjs). */
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const cache = new Map<string, Promise<GLTF>>();
const ready = new Map<string, GLTF>();

export function load(name: string): Promise<GLTF> {
  let p = cache.get(name);
  if (!p) {
    p = loader.loadAsync(`/assets/fps/${name}.glb`).then((g) => {
      ready.set(name, g);
      return g;
    });
    cache.set(name, p);
  }
  return p;
}

export function loaded(name: string): GLTF | undefined {
  return ready.get(name);
}

/** Everything a match needs. */
export async function preload(props: string[], onProgress?: (f: number) => void): Promise<void> {
  const names = ['soldier', 'item-grenade', 'item-knife-1', 'acc-scope-3', 'acc-silencer-1', 'acc-grip', 'acc-flashlight', ...new Set(WEAPONS.map((w) => w.model)), ...new Set([...props, ...BACKDROP_MODELS])];
  let done = 0;
  await Promise.all(
    names.map((n) =>
      load(n)
        .catch(() => undefined)
        .finally(() => onProgress?.(++done / names.length)),
    ),
  );
}

/** A static clone (shared geometry, own materials when tinting). */
export function cloneModel(name: string, tint?: string, gritty = 0): THREE.Group {
  const g = ready.get(name);
  if (!g) return new THREE.Group();
  const o = g.scene.clone(true) as THREE.Group;
  if (tint || gritty) {
    const col = tint ? new THREE.Color(tint) : null;
    o.traverse((n) => {
      const m = n as THREE.Mesh;
      if (!m.isMesh) return;
      const mats = (Array.isArray(m.material) ? m.material : [m.material]).map((src) => {
        const mat = (src as THREE.MeshStandardMaterial).clone();
        if (col && isPaint(mat)) mat.color.copy(col);
        if (gritty) {
          // Desaturate the toon colours a little for a grittier look.
          const hsl = { h: 0, s: 0, l: 0 };
          mat.color.getHSL(hsl);
          mat.color.setHSL(hsl.h, hsl.s * (1 - gritty * 0.5), hsl.l * (1 - gritty * 0.15));
          mat.roughness = Math.min(1, (mat.roughness ?? 0.8) + 0.15);
        }
        return mat;
      });
      m.material = Array.isArray(m.material) ? mats : mats[0]!;
    });
  }
  o.traverse((n) => {
    if ((n as THREE.Mesh).isMesh) {
      n.castShadow = true;
      n.receiveShadow = true;
    }
  });
  return o;
}

/** The dominant (most saturated, largest) colour of a prop is its "paint". */
function isPaint(m: THREE.MeshStandardMaterial): boolean {
  const hsl = { h: 0, s: 0, l: 0 };
  m.color.getHSL(hsl);
  return hsl.s > 0.35 && hsl.l > 0.12 && hsl.l < 0.8;
}

export interface SoldierRig {
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  clips: Map<string, THREE.AnimationClip>;
  bones: Record<string, THREE.Bone>;
  materials: THREE.MeshStandardMaterial[];
  height: number;
}

export const TEAM_LOOK = [
  // Coalition (blue team): dark urban camo.
  { body: '#5d6b7a', dark: '#2a323b', accent: '#5b8bd4' },
  // Militia (red team): desert tan.
  { body: '#a48c62', dark: '#5a4a32', accent: '#d45b4b' },
] as const;

/** A skinned soldier for third-person use. */
export function soldierRig(team: 0 | 1): SoldierRig {
  const g = ready.get('soldier')!;
  const root = cloneSkinned(g.scene) as THREE.Group;
  const bones: Record<string, THREE.Bone> = {};
  const materials: THREE.MeshStandardMaterial[] = [];
  const look = TEAM_LOOK[team];
  root.traverse((n) => {
    if ((n as THREE.Bone).isBone) bones[n.name] = n as THREE.Bone;
    if (n.name === 'Pistol') n.visible = false;
    const m = n as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    m.frustumCulled = false;
    const mats = (Array.isArray(m.material) ? m.material : [m.material]).map((src) => {
      const mat = (src as THREE.MeshStandardMaterial).clone();
      if (mat.name === 'Swat') mat.color.set(look.body);
      if (mat.name === 'Swat_Black') mat.color.set(look.dark);
      mat.roughness = 0.85;
      materials.push(mat);
      return mat;
    });
    m.material = Array.isArray(m.material) ? mats : mats[0]!;
  });
  const box = new THREE.Box3().setFromObject(root);
  const height = box.max.y - box.min.y || 1.8;
  const mixer = new THREE.AnimationMixer(root);
  const clips = new Map(g.animations.map((a) => [a.name, a]));
  return { root, mixer, clips, bones, materials, height };
}

/** Gun model info: muzzle position and sight height in model units. */
export interface GunInfo {
  min: THREE.Vector3;
  max: THREE.Vector3;
}
const gunInfo = new Map<string, GunInfo>();
export function gunBounds(model: string): GunInfo {
  let i = gunInfo.get(model);
  if (!i) {
    const g = ready.get(model);
    const box = g ? new THREE.Box3().setFromObject(g.scene) : new THREE.Box3(new THREE.Vector3(-1, -0.5, -0.2), new THREE.Vector3(3, 0.8, 0.2));
    i = { min: box.min.clone(), max: box.max.clone() };
    gunInfo.set(model, i);
  }
  return i;
}

export { cloneSkinned };
