import {
  CanvasTexture,
  Color,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  Vector2,
  type Texture,
} from 'three';
import { SeededRandom } from '@shared/math/random';

/** Tileable ripple normal map: a sum of integer-frequency waves tiles exactly. */
function rippleNormalMap(size = 256): Texture {
  const rng = new SeededRandom(42);
  const waves = Array.from({ length: 28 }, () => {
    const fx = rng.int(-9, 9);
    const fy = rng.int(1, 9) * (rng.chance(0.5) ? 1 : -1);
    return { fx, fy, phase: rng.range(0, Math.PI * 2), amp: 1 / Math.hypot(fx, fy) };
  });
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0;
      for (const w of waves) v += Math.sin(((w.fx * x + w.fy * y) / size) * Math.PI * 2 + w.phase) * w.amp;
      h[y * size + x] = v * 0.25;
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const strength = 3.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = h[y * size + ((x - 1 + size) % size)]!;
      const r = h[y * size + ((x + 1) % size)]!;
      const d = h[((y - 1 + size) % size) * size + x]!;
      const u = h[((y + 1) % size) * size + x]!;
      let nx = (l - r) * strength;
      let ny = (d - u) * strength;
      const len = Math.hypot(nx, ny, 1);
      nx /= len;
      ny /= len;
      const i = (y * size + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (1 / len) * 0.5 * 255 + 127;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  return tex;
}

export class Water {
  readonly mesh: Mesh;
  private readonly normalA: Texture;

  constructor(level: number, centerX: number, centerZ: number, size: number, color = '#27a6d9') {
    this.normalA = rippleNormalMap();
    this.normalA.repeat.set(size / 24, size / 24);
    const mat = new MeshStandardMaterial({
      color: new Color(color),
      roughness: 0.12,
      metalness: 0.0,
      normalMap: this.normalA,
      normalScale: new Vector2(0.55, 0.55),
      transparent: true,
      opacity: 0.88,
      envMapIntensity: 1.2,
    });
    const geo = new PlaneGeometry(size, size, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new Mesh(geo, mat);
    this.mesh.position.set(centerX, level, centerZ);
    this.mesh.receiveShadow = true;
    this.mesh.name = 'water';
  }

  update(time: number): void {
    this.normalA.offset.set(time * 0.012, time * 0.008);
  }
}
