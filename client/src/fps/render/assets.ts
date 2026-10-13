import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { WEAPONS } from '../sim/weapons';
import { BACKDROP_MODELS } from './backdrop';
import { GENERATED } from './props3d';
import { loadSurfaces } from './textures';

/** Loads and caches the Zero Hour models (meshopt GLBs from tools/fps-assets.mjs). */
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const cache = new Map<string, Promise<GLTF>>();
const ready = new Map<string, GLTF>();

export function load(name: string): Promise<GLTF> {
  let p = cache.get(name);
  const build = GENERATED[name];
  if (!p && build) {
    // Built from the scanned surfaces (render/props3d.ts) rather than downloaded.
    p = loadSurfaces().then(() => {
      const scene = build();
      scene.traverse((n) => {
        const m = n as THREE.Mesh;
        if (m.isMesh) m.geometry.userData.cached = true;
      });
      const g = { scene, scenes: [scene], animations: [], cameras: [], asset: {}, parser: null, userData: {} } as unknown as GLTF;
      ready.set(name, g);
      return g;
    });
    cache.set(name, p);
  }
  if (!p) {
    p = loader.loadAsync(`/assets/fps/${name}.glb`).then((g) => {
      // Clones share this geometry for the page lifetime: mark it so per-match cleanup leaves it alone.
      g.scene.traverse((n) => {
        const m = n as THREE.Mesh;
        if (m.isMesh) m.geometry.userData.cached = true;
      });
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
  // Surfaces first: the generated props are made of them.
  await loadSurfaces();
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
      n.castShadow = !n.userData.noShadow;
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
  { body: '#5d6b7a', dark: '#2a323b', accent: '#5b8bd4', camo: ['#3c4652', '#7d8894'] },
  // Militia (red team): desert tan.
  { body: '#a48c62', dark: '#5a4a32', accent: '#d45b4b', camo: ['#76603e', '#c4ae86'] },
] as const;

/**
 * Uniform camo and fabric grain for the (untextured) soldier: blotches of three tones from noise in
 * the bind-pose position (so the pattern rides with the body as it animates), plus fine weave and
 * roughness variation. Gear gets only the grain.
 */
const CLOTH_GLSL = `varying vec3 vClP;
uniform vec3 clA; uniform vec3 clB; uniform float clK; uniform float clCamo;
float clHash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float clNoise(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(clHash(i), clHash(i + vec3(1,0,0)), f.x), mix(clHash(i + vec3(0,1,0)), clHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(clHash(i + vec3(0,0,1)), clHash(i + vec3(1,0,1)), f.x), mix(clHash(i + vec3(0,1,1)), clHash(i + vec3(1,1,1)), f.x), f.y), f.z); }`;
function cloth(mat: THREE.MeshStandardMaterial, k: number, camo: readonly [string, string] | null): void {
  const u = { clA: { value: new THREE.Color(camo?.[0] ?? '#000') }, clB: { value: new THREE.Color(camo?.[1] ?? '#000') }, clK: { value: k }, clCamo: { value: camo ? 1 : 0 } };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vClP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvClP = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${CLOTH_GLSL}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  vec3 clP = vClP * clK;
  if (clCamo > 0.5) {
    float a = smoothstep(0.52, 0.58, clNoise(clP * 5.6 + vec3(3.7)) * 0.7 + clNoise(clP * 13.0) * 0.3);
    float b = smoothstep(0.6, 0.66, clNoise(clP * 7.8 + vec3(11.3)) * 0.65 + clNoise(clP * 16.0 + vec3(5.0)) * 0.35);
    diffuseColor.rgb = mix(mix(diffuseColor.rgb, clA, a), clB, b * (1.0 - a));
  }
  diffuseColor.rgb *= 0.9 + 0.16 * clNoise(clP * 140.0);`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = clamp(roughnessFactor * (0.85 + 0.3 * clNoise(vClP * clK * 37.0)), 0.3, 1.0);');
  };
  mat.customProgramCacheKey = () => 'soldiercloth';
}

/** Rig height (the skinned bounds walk every vertex: measure once). */
let rigHeight = 0;
/** Model units → metres for the uniform's camo (measured once). */
let clothScale = 0;

/** A skinned soldier for third-person use. */
export function soldierRig(team: 0 | 1): SoldierRig {
  const g = ready.get('soldier')!;
  const root = cloneSkinned(g.scene) as THREE.Group;
  const bones: Record<string, THREE.Bone> = {};
  const materials: THREE.MeshStandardMaterial[] = [];
  const look = TEAM_LOOK[team];
  // Bind-pose units → metres: the tallest part (the body) is about 1.8 m.
  if (!clothScale) {
    let tall = 0;
    root.traverse((n) => {
      const g = (n as THREE.Mesh).geometry;
      if (!g) return;
      if (!g.boundingBox) g.computeBoundingBox();
      tall = Math.max(tall, g.boundingBox!.max.y - g.boundingBox!.min.y);
    });
    clothScale = 1.8 / (tall || 1.8);
  }
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
      if (mat.name === 'Swat' || mat.name === 'Swat_Black' || mat.name === 'Grey' || mat.name === 'DarkBrown') cloth(mat, clothScale, mat.name === 'Swat' ? look.camo : null);
      materials.push(mat);
      return mat;
    });
    m.material = Array.isArray(m.material) ? mats : mats[0]!;
  });
  if (!rigHeight) {
    const box = new THREE.Box3().setFromObject(root);
    rigHeight = box.max.y - box.min.y || 1.8;
  }
  const height = rigHeight;
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
