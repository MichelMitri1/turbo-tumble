import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

/** Converted CC0 models (tools/arena-assets.mjs) live here, plus manifest.json. */
const BASE = `${import.meta.env.BASE_URL}assets/arena/models/`;
/** `nature:<file>` reuses Turbo Tumble's Kenney nature kit. */
const urlFor = (name: string) => (name.startsWith('nature:') ? `${import.meta.env.BASE_URL}assets/environment/nature/${name.slice(7)}.glb` : `${BASE}${name}.glb`);

export interface ModelManifestEntry {
  anims: string[];
  bytes: number;
}

interface Template {
  scene: THREE.Group;
  clips: THREE.AnimationClip[];
  /** Height (m) of the posed model at scale 1, measured once. */
  height: number;
  /** Lowest point at scale 1 (to stand the model on the ground). */
  minY: number;
  radius: number;
}

/** Scale target: a height (default) or a footprint width for wide, flat models. */
export interface SizeSpec {
  width?: number;
}

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const templates = new Map<string, Promise<Template>>();
let manifestPromise: Promise<Record<string, ModelManifestEntry>> | null = null;

export function modelManifest(): Promise<Record<string, ModelManifestEntry>> {
  manifestPromise ??= fetch(`${BASE}manifest.json`).then((r) => r.json() as Promise<Record<string, ModelManifestEntry>>);
  return manifestPromise;
}

function measure(scene: THREE.Object3D): { height: number; minY: number; radius: number } {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene, true);
  if (box.isEmpty()) return { height: 1, minY: 0, radius: 0.5 };
  const size = box.getSize(new THREE.Vector3());
  return { height: Math.max(0.01, size.y), minY: box.min.y, radius: Math.max(size.x, size.z) / 2 };
}

export function loadTemplate(name: string): Promise<Template> {
  let p = templates.get(name);
  if (!p) {
    p = loader.loadAsync(urlFor(name)).then((gltf: GLTF) => {
      const scene = gltf.scene;
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = true;
        m.receiveShadow = true;
        m.frustumCulled = false; // skinned bounds lag behind the animation
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) {
          const s = mat as THREE.MeshStandardMaterial;
          if (s.isMeshStandardMaterial) {
            s.roughness = Math.max(0.55, s.roughness);
            s.metalness = Math.min(0.15, s.metalness);
          }
        }
      });
      // Measure in the first frame of Idle when present (bind poses can be T-poses).
      const idle = gltf.animations.find((c) => /idle/i.test(c.name)) ?? gltf.animations[0];
      if (idle) {
        const mixer = new THREE.AnimationMixer(scene);
        mixer.clipAction(idle).play();
        mixer.update(0);
      }
      return { scene, clips: gltf.animations, ...measure(scene) };
    });
    templates.set(name, p);
  }
  return p;
}

export function preload(names: Iterable<string>, onProgress?: (done: number, total: number) => void): Promise<void> {
  const list = [...new Set(names)];
  let done = 0;
  return Promise.all(
    list.map((n) =>
      loadTemplate(n)
        .catch((e) => console.warn(`[arena] model ${n} failed`, e))
        .finally(() => onProgress?.(++done, list.length)),
    ),
  ).then(() => undefined);
}

export interface ModelInstance {
  root: THREE.Group;
  clips: THREE.AnimationClip[];
  /** Height after scaling to the requested size. */
  height: number;
  mixer: THREE.AnimationMixer | null;
}

/**
 * A fresh, independently animatable copy of a loaded model, scaled so it is `height`
 * metres tall and standing on y = 0. Materials are cloned when `tint` is given.
 */
export async function instantiate(name: string, height: number, tint?: TintSpec, size: SizeSpec = {}): Promise<ModelInstance> {
  const t = await loadTemplate(name);
  const inner = (t.clips.length ? cloneSkinned(t.scene) : t.scene.clone(true)) as THREE.Group;
  if (tint) applyTint(inner, tint);
  const k = size.width ? size.width / Math.max(0.01, t.radius * 2) : height / t.height;
  inner.scale.setScalar(k);
  inner.position.y = -t.minY * k;
  const root = new THREE.Group();
  root.add(inner);
  const mixer = t.clips.length ? new THREE.AnimationMixer(inner) : null;
  return { root, clips: t.clips, height: t.height * k, mixer };
}

export interface TintSpec {
  /** Multiply every material colour by this colour. */
  color?: string;
  /** Hue shift in turns (0..1) applied to every material colour. */
  hue?: number;
  /** Extra saturation / lightness offsets. */
  sat?: number;
  light?: number;
  /** Self-glow (magic units). */
  emissive?: string;
  emissiveIntensity?: number;
}

const hsl = { h: 0, s: 0, l: 0 };
function applyTint(root: THREE.Object3D, tint: TintSpec): void {
  const mul = tint.color ? new THREE.Color(tint.color) : null;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const tintOne = (src: THREE.Material): THREE.Material => {
      const mat = src.clone() as THREE.MeshStandardMaterial;
      if (mat.color) {
        if (tint.hue || tint.sat || tint.light) {
          mat.color.getHSL(hsl);
          mat.color.setHSL((hsl.h + (tint.hue ?? 0) + 1) % 1, THREE.MathUtils.clamp(hsl.s + (tint.sat ?? 0), 0, 1), THREE.MathUtils.clamp(hsl.l + (tint.light ?? 0), 0, 1));
        }
        if (mul) mat.color.multiply(mul);
      }
      if (tint.emissive && 'emissive' in mat) {
        mat.emissive = new THREE.Color(tint.emissive);
        mat.emissiveIntensity = tint.emissiveIntensity ?? 0.4;
      }
      return mat;
    };
    m.material = Array.isArray(m.material) ? m.material.map(tintOne) : tintOne(m.material);
  });
}

/** First clip whose name matches one of the patterns, in priority order. */
export function findClip(clips: THREE.AnimationClip[], ...patterns: RegExp[]): THREE.AnimationClip | undefined {
  for (const p of patterns) {
    const c = clips.find((clip) => p.test(clip.name));
    if (c) return c;
  }
  return undefined;
}
