import { CanvasTexture, Color, Group, MeshStandardMaterial, type Mesh, type Object3D, type Texture } from 'three';
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
  // Drivers get their own texture: new racers rotate a base driver's colours round the
  // hue wheel, and every helmet is dyed in the character's colour so racers read apart.
  if (driver) {
    driver.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh || !(m.material instanceof MeshStandardMaterial)) return;
      const shifted = m.material.clone();
      if (shifted.map) shifted.map = driverTexture(shifted.map, character.hue ?? 0, character.color);
      m.material = shifted;
      materials.push(shifted);
    });
  }
  return { root, body: bodyRoot, character: driver, wheels, materials, characterId: character.id, color: character.color };
}

function findNamed(root: Object3D, name: string): Object3D | undefined {
  let found: Object3D | undefined;
  root.traverse((o) => {
    if (!found && o.name === name) found = o;
  });
  return found;
}

const shiftedCache = new Map<string, Texture>();

/**
 * Copy of a driver texture with saturated colours hue-rotated by `degrees`, and the
 * bright neutral helmet shell dyed towards `helmet` (darks / greys untouched).
 */
function driverTexture(tex: Texture, degrees: number, helmet: string): Texture {
  const key = `${tex.uuid}:${degrees}:${helmet}`;
  const cached = shiftedCache.get(key);
  if (cached) return cached;
  const img = tex.image as CanvasImageSource & { width: number; height: number };
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const g = canvas.getContext('2d')!;
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, canvas.width, canvas.height);
  const d = data.data;
  const shift = degrees / 360;
  const hex = new Color(helmet).getHex(); // sRGB, like the texture's pixels
  // Pastel-ish dye: keep the shell bright so shading still reads.
  const dr = 0.35 + ((hex >> 16) & 255) / 255 * 0.65, dg = 0.35 + ((hex >> 8) & 255) / 255 * 0.65, db = 0.35 + (hex & 255) / 255 * 0.65;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i]! / 255, gg = d[i + 1]! / 255, b = d[i + 2]! / 255;
    const max = Math.max(r, gg, b), min = Math.min(r, gg, b);
    const l = (max + min) / 2;
    const delta = max - min;
    if (delta < 0.12) {
      // Bright neutral = helmet shell → dye it; dark visor and greys stay.
      if (l > 0.72) {
        d[i] = r * dr * 255;
        d[i + 1] = gg * dg * 255;
        d[i + 2] = b * db * 255;
      }
      continue;
    }
    if (shift === 0) continue;
    const s = delta / (1 - Math.abs(2 * l - 1));
    let h = max === r ? ((gg - b) / delta) % 6 : max === gg ? (b - r) / delta + 2 : (r - gg) / delta + 4;
    h = (h / 6 + shift + 1) % 1;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h * 6) % 2) - 1));
    const m = l - c / 2;
    const [r1, g1, b1] = h < 1 / 6 ? [c, x, 0] : h < 2 / 6 ? [x, c, 0] : h < 3 / 6 ? [0, c, x] : h < 4 / 6 ? [0, x, c] : h < 5 / 6 ? [x, 0, c] : [c, 0, x];
    d[i] = (r1 + m) * 255;
    d[i + 1] = (g1 + m) * 255;
    d[i + 2] = (b1 + m) * 255;
  }
  g.putImageData(data, 0, 0);
  const out = new CanvasTexture(canvas);
  out.colorSpace = tex.colorSpace;
  out.flipY = tex.flipY;
  out.wrapS = tex.wrapS;
  out.wrapT = tex.wrapT;
  out.magFilter = tex.magFilter;
  out.minFilter = tex.minFilter;
  out.channel = tex.channel;
  shiftedCache.set(key, out);
  return out;
}
