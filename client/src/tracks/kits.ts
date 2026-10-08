import { Box3, Group, Mesh, MeshStandardMaterial, Vector3, type Material, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/**
 * Kenney CC0 kits packed one GLB per kit (client/public/assets/environment/kits/,
 * see LICENSES.md): each top-level node is one model, named after its source file.
 * Track set pieces (landmarks, themed hazards / movers) pull models from here.
 */
export type KitId = 'pirate' | 'castle' | 'town' | 'graveyard' | 'holiday' | 'factory' | 'industrial' | 'survival' | 'suburban' | 'space';

interface KitModel {
  template: Object3D;
  /** Footprint (x, z) and height at scale 1, after recentring. */
  size: Vector3;
}

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

/** Loaded once per session; kits are shared between tracks. */
class KitLibrary {
  private readonly kits = new Map<KitId, Map<string, KitModel>>();
  private readonly pending = new Map<KitId, Promise<void>>();

  load(ids: Iterable<KitId>): Promise<void> {
    return Promise.all([...new Set(ids)].map((id) => this.loadKit(id))).then(() => undefined);
  }

  private loadKit(id: KitId): Promise<void> {
    let p = this.pending.get(id);
    if (!p) {
      p = loader.loadAsync(`${import.meta.env.BASE_URL}assets/environment/kits/${id}.glb`).then((gltf) => {
        const models = new Map<string, KitModel>();
        for (const node of [...gltf.scene.children]) {
          sanitize(node);
          // three.js de-duplicates names ("name_1") if anything else shares one.
          const name = node.name.replace(/_\d+$/, '');
          const { template, size } = recentre(node);
          models.set(models.has(name) ? node.name : name, { template, size });
        }
        this.kits.set(id, models);
      });
      this.pending.set(id, p);
    }
    return p;
  }

  has(kit: KitId, name: string): boolean {
    return Boolean(this.kits.get(kit)?.has(name));
  }

  private entry(kit: KitId, name: string): KitModel {
    const m = this.kits.get(kit)?.get(name);
    if (!m) throw new Error(`Kit model ${kit}/${name} requested before it was loaded`);
    return m;
  }

  /** Size (x, y, z) of a model at scale 1. */
  size(kit: KitId, name: string): Vector3 {
    return this.entry(kit, name).size.clone();
  }

  /**
   * A new instance (geometry & materials shared) with its footprint centred on the
   * origin and its base at y = 0. `height` scales it uniformly to that height.
   */
  instantiate(kit: KitId, name: string, height?: number): Object3D {
    const m = this.entry(kit, name);
    const o = m.template.clone(true);
    if (height) o.scale.setScalar(height / Math.max(0.01, m.size.y));
    return o;
  }
}

export const kits = new KitLibrary();
export type { KitLibrary };

const box = new Box3();
const center = new Vector3();

function recentre(node: Object3D): KitModel {
  node.position.set(0, 0, 0);
  node.updateMatrixWorld(true);
  box.setFromObject(node);
  box.getCenter(center);
  const size = box.getSize(new Vector3());
  const wrapper = new Group();
  wrapper.name = node.name;
  node.position.set(-center.x, -box.min.y, -center.z);
  wrapper.add(node);
  return { template: wrapper, size };
}

/** Same treatment as the asset loader: matte toon materials, shadows on. */
function sanitize(root: Object3D): void {
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const mats: Material[] = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (!(m instanceof MeshStandardMaterial)) continue;
      m.metalness = Math.min(m.metalness, 0.3);
      m.roughness = Math.max(0.5, Math.min(m.roughness, 0.9));
      if (m.map) m.map.anisotropy = 4;
    }
  });
}
