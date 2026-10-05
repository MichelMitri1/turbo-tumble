import { Color, DoubleSide, MeshStandardMaterial, type Texture } from 'three';
import { checkerTexture, curbTexture, rockTexture, roadTexture } from '../rendering/ProceduralTextures';

/** Shared, lazily-created materials for procedural track geometry. */
const cache = new Map<string, MeshStandardMaterial>();

function get(key: string, make: () => MeshStandardMaterial): MeshStandardMaterial {
  let m = cache.get(key);
  if (!m) cache.set(key, (m = make()));
  return m;
}

const repeat = (t: Texture, x: number, y: number): Texture => {
  const c = t.clone();
  c.repeat.set(x, y);
  c.needsUpdate = true;
  return c;
};

export const TrackMaterials = {
  road: () => get('road', () => new MeshStandardMaterial({ map: roadTexture(), roughness: 0.86, metalness: 0, vertexColors: true })),
  roadLip: () => get('roadLip', () => new MeshStandardMaterial({ color: '#3f434e', roughness: 0.95, vertexColors: true })),
  curb: () => get('curb', () => new MeshStandardMaterial({ map: curbTexture(), roughness: 0.7 })),
  barrier: () =>
    get('barrier', () => new MeshStandardMaterial({ map: curbTexture(), roughness: 0.55, color: new Color('#ffffff') })),
  paint: (color: string) => get(`paint-${color}`, () => new MeshStandardMaterial({ color, roughness: 0.6, side: DoubleSide })),
  emissive: (color: string, intensity = 2.5) =>
    get(`emissive-${color}-${intensity}`, () => new MeshStandardMaterial({ color, emissive: new Color(color), emissiveIntensity: intensity, roughness: 0.4 })),
  stone: () => get('stone', () => new MeshStandardMaterial({ map: repeat(rockTexture(), 1, 1), color: '#b8ab9a', roughness: 0.95, side: DoubleSide })),
  tunnelInner: () =>
    get('tunnelInner', () => new MeshStandardMaterial({ map: rockTexture(), color: '#b3a594', roughness: 0.95, emissive: '#2a2218', emissiveIntensity: 0.6 })),
  shell: () => get('shell', () => new MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true })),
  vertexColor: () => get('vertexColor', () => new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: DoubleSide })),
  checker: () => get('checker', () => new MeshStandardMaterial({ map: checkerTexture(8), roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 })),
  linePaint: () =>
    get('linePaint', () => new MeshStandardMaterial({ color: '#f4f1e8', roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 })),
};
