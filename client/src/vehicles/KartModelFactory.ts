import { Group, MeshStandardMaterial, type Mesh, type Object3D } from 'three';
import type { AssetLoader } from '../assets/AssetLoader';
import { KART_MODEL_SCALE, type CharacterDefinition, type KartBodyDefinition } from '../config/roster';

export interface KartRig {
  /** Scaled model root (+Z forward, sits on y=0). */
  root: Group;
  body: Object3D;
  character: Object3D | null;
  wheels: Array<{ node: Object3D; front: boolean; left: boolean }>;
  /** This rig's own material copies (safe to tint per kart). */
  materials: MeshStandardMaterial[];
  /** Driver identity (for toppers / scarf colour). */
  characterId: string;
  color: string;
}

const CHARACTER_NODE = 'character';

/** Compose a kart rig from a body model and a (possibly different) driver model. */
export function buildKartRig(assets: AssetLoader, body: KartBodyDefinition, character: CharacterDefinition): KartRig {
  const bodyScene = assets.instantiate(body.model);
  const bodyRoot = findNamed(bodyScene, body.model) ?? bodyScene;

  // Swap in the requested driver.
  const ownDriver = bodyRoot.getObjectByName(CHARACTER_NODE);
  let driver: Object3D | null = null;
  if (character.model === body.model) {
    driver = ownDriver ?? null;
  } else {
    const donor = assets.template(character.model).getObjectByName(CHARACTER_NODE);
    const seat = ownDriver?.parent ?? bodyRoot;
    if (ownDriver) seat.remove(ownDriver);
    if (donor) {
      driver = donor.clone(true);
      seat.add(driver);
    }
  }

  const wheels: KartRig['wheels'] = [];
  bodyRoot.traverse((o) => {
    if (!o.name.startsWith('wheel-')) return;
    o.rotation.order = 'YXZ';
    wheels.push({ node: o, front: o.name.includes('front'), left: o.name.includes('left') });
  });

  const root = new Group();
  root.name = `kart:${body.id}:${character.id}`;
  bodyScene.scale.setScalar(KART_MODEL_SCALE);
  root.add(bodyScene);
  // Per-rig materials so effects (invincibility shimmer, flashes) don't leak to other karts.
  const materials: MeshStandardMaterial[] = [];
  const cloned = new Map<MeshStandardMaterial, MeshStandardMaterial>();
  root.traverse((o) => {
    o.castShadow = true;
    o.receiveShadow = true;
    const m = o as Mesh;
    if (m.isMesh && m.material instanceof MeshStandardMaterial) {
      let c = cloned.get(m.material);
      if (!c) {
        c = m.material.clone();
        cloned.set(m.material, c);
        materials.push(c);
      }
      m.material = c;
    }
  });
  return { root, body: bodyRoot, character: driver, wheels, materials, characterId: character.id, color: character.color };
}

function findNamed(root: Object3D, name: string): Object3D | undefined {
  let found: Object3D | undefined;
  root.traverse((o) => {
    if (!found && o.name === name) found = o;
  });
  return found;
}
