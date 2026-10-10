import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Bounds } from './world/city';

/**
 * Loads every model Velora uses (CC0: Kenney Car Kit + City Kits, Quaternius characters
 * and guns; see client/public/assets/LICENSES.md) and hands out clones.
 */

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

export const CAR_MODELS = ['compact', 'hatch', 'sedan', 'wagon', 'taxi', 'sports', 'super', 'muscle', 'suv', 'pickup', 'police', 'boxtruck', 'ambulance', 'firetruck', 'garbage', 'van', 'delivery', 'racer', 'tractor'] as const;
export type CarModel = (typeof CAR_MODELS)[number];
export const PEOPLE = ['casual', 'hoodie', 'suit', 'business', 'worker', 'worker2', 'punk', 'punk2', 'farmer', 'adventurer', 'woman', 'woman2', 'swat'] as const;
export type PersonModel = (typeof PEOPLE)[number];
export const FPS_PROPS = ['prop-container-long', 'prop-container-small', 'prop-watertank-floor', 'prop-crate', 'prop-explodingbarrel', 'prop-trafficcone', 'prop-barrier-single'];
export const GUNS = ['gun-pistol-1', 'gun-revolver-1', 'gun-submachinegun-4', 'gun-assaultrifle-1', 'gun-assaultrifle2-1', 'gun-shotgun-1', 'gun-sniperrifle-1', 'gun-rocketlauncher'];

interface Manifest {
  cars: Record<string, { len: number; min: number[]; max: number[]; wheels: Array<{ name: string; at: number[]; r: number; w: number }> }>;
  people: Record<string, { min: number[]; max: number[] }>;
  kits: Record<string, Bounds>;
}

export class Assets {
  manifest!: Manifest;
  fpsBounds: Bounds = {};
  kits: Record<string, THREE.Object3D> = {};
  cars = new Map<string, THREE.Object3D>();
  people = new Map<string, GLTF>();
  clips: THREE.AnimationClip[] = [];
  props = new Map<string, THREE.Object3D>();
  guns = new Map<string, THREE.Object3D>();

  async load(progress: (f: number) => void): Promise<void> {
    this.manifest = (await (await fetch('/assets/velora/manifest.json')).json()) as Manifest;
    const fps = (await (await fetch('/assets/fps/manifest.json')).json()) as Record<string, { min: number[]; max: number[] }>;
    for (const [k, v] of Object.entries(fps)) this.fpsBounds[k] = { min: v.min, max: v.max };
    const jobs: Array<() => Promise<void>> = [];
    for (const k of ['downtown', 'suburb', 'street']) jobs.push(async () => void (this.kits[k] = (await loader.loadAsync(`/assets/velora/${k}.glb`)).scene));
    for (const c of CAR_MODELS) jobs.push(async () => void this.cars.set(c, (await loader.loadAsync(`/assets/velora/cars/${c}.glb`)).scene));
    for (const p of PEOPLE)
      jobs.push(async () => {
        const g = await loader.loadAsync(`/assets/velora/people/${p}.glb`);
        this.people.set(p, g);
        if (g.animations.length) this.clips = g.animations;
      });
    for (const f of FPS_PROPS) jobs.push(async () => void this.props.set(f, (await loader.loadAsync(`/assets/fps/${f}.glb`)).scene));
    for (const f of GUNS) jobs.push(async () => void this.guns.set(f, (await loader.loadAsync(`/assets/fps/${f}.glb`)).scene));
    let done = 0;
    await Promise.all(
      jobs.map(async (j) => {
        await j();
        progress(++done / jobs.length);
      }),
    );
    for (const m of [...this.cars.values(), ...this.props.values(), ...this.guns.values()])
      m.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) mesh.castShadow = mesh.receiveShadow = true;
      });
  }

  car(name: string): THREE.Object3D {
    return this.cars.get(name)!.clone(true);
  }
  person(name: string): THREE.Object3D {
    const s = cloneSkinned(this.people.get(name)!.scene);
    s.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.frustumCulled = false;
      }
    });
    return s;
  }
  gun(name: string): THREE.Object3D {
    return this.guns.get(name)!.clone(true);
  }
  /** A kit model (downtown / suburb / street) or an fps prop. */
  model(kit: string, name: string): THREE.Object3D | null {
    if (kit === 'fps') return this.props.get(name) ?? null;
    return this.kits[kit]?.getObjectByName(name) ?? null;
  }
}

export const assets = new Assets();
