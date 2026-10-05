import { Box3, Color, Group, Mesh, MeshStandardMaterial, Vector3, type Material, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BRANDED_MATERIALS, MATERIAL_TINTS, MODELS, isModelId, type ModelId } from './AssetManifest';
import { brandStripTexture } from '../rendering/ProceduralTextures';

export type ProgressCallback = (loaded: number, total: number) => void;

/**
 * Loads glTF models on demand (per track / per roster) and caches a normalised
 * template per id. Callers get clones; materials and geometry are shared.
 */
export class AssetLoader {
  private readonly gltf = new GLTFLoader();
  private readonly pending = new Map<ModelId, Promise<Object3D>>();
  private readonly templates = new Map<ModelId, Object3D>();
  private readonly base = import.meta.env.BASE_URL;

  async loadModels(ids: Iterable<string>, onProgress?: ProgressCallback): Promise<void> {
    const unique = [...new Set(ids)];
    for (const id of unique) {
      if (!isModelId(id)) throw new Error(`Asset "${id}" is not in the asset manifest`);
    }
    let done = 0;
    onProgress?.(0, unique.length);
    await Promise.all(
      unique.map((id) =>
        this.load(id as ModelId).then(() => {
          done++;
          onProgress?.(done, unique.length);
        }),
      ),
    );
  }

  private load(id: ModelId): Promise<Object3D> {
    let p = this.pending.get(id);
    if (!p) {
      const entry = MODELS[id];
      p = this.gltf.loadAsync(this.base + entry.url).then((gltf) => {
        const root = gltf.scene;
        sanitizeMaterials(root);
        const template = entry.pivot === 'base-center' ? recenter(root) : root;
        template.userData.assetId = id;
        this.templates.set(id, template);
        return template;
      });
      this.pending.set(id, p);
    }
    return p;
  }

  has(id: string): boolean {
    return isModelId(id) && this.templates.has(id);
  }

  /** Shared template (do not mutate). */
  template(id: string): Object3D {
    const t = isModelId(id) ? this.templates.get(id) : undefined;
    if (!t) throw new Error(`Model "${id}" requested before it was loaded`);
    return t;
  }

  /** A new scene-graph instance sharing geometry & materials with the template. */
  instantiate(id: string): Object3D {
    return this.template(id).clone(true);
  }
}

const box = new Box3();
const center = new Vector3();

function recenter(root: Object3D): Object3D {
  root.updateMatrixWorld(true);
  box.setFromObject(root);
  box.getCenter(center);
  const wrapper = new Group();
  root.position.sub(new Vector3(center.x, box.min.y, center.z));
  wrapper.add(root);
  return wrapper;
}

/** Kenney kits export some materials as fully metallic; the toon look wants matte. */
function sanitizeMaterials(root: Object3D): void {
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const mats: Material[] = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (!(m instanceof MeshStandardMaterial)) continue;
      m.metalness = 0;
      m.roughness = Math.max(0.55, Math.min(m.roughness, 0.9));
      const tint = MATERIAL_TINTS[m.name];
      if (tint) m.color = new Color(tint);
      if (BRANDED_MATERIALS.includes(m.name)) {
        m.map = brandStripTexture();
        m.color = new Color('#ffffff');
      }
      if (m.map) m.map.anisotropy = 4;
    }
  });
}
