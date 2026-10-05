import { BoxGeometry, BufferAttribute, CanvasTexture, Color, Mesh, MeshBasicMaterial, MeshStandardMaterial, SRGBColorSpace, type BufferGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { LandmarkPlacement } from '@shared/types/track';
import { SeededRandom } from '@shared/math/random';
import type { BuildContext } from '../BuildContext';

const NEON = ['#ff3fb4', '#3fe8ff', '#b46bff', '#ffe14d', '#4dff9a'];

/** Night-time facade: dark wall with a grid of randomly lit windows. Texel (0,0) is plain wall (used for roofs). */
function windowTexture(rng: SeededRandom): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0d0f1c';
  g.fillRect(0, 0, 256, 256);
  const lit = ['#ffd88a', '#fff2c8', '#8ae8ff', '#ff9ad8', '#c8b8ff'];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if (x === 0 && y === 7) continue; // keep the roof texel dark
      g.fillStyle = rng.chance(0.42) ? rng.pick(lit) : '#151a2c';
      g.fillRect(x * 32 + 7, y * 32 + 8, 18, 16);
    }
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Scale a box's UVs so windows keep their size: ~4 m per window. */
function tileUVs(geo: BoxGeometry, w: number, h: number, d: number): void {
  const uv = geo.getAttribute('uv') as BufferAttribute;
  // Faces: +x, -x, +y, -y, +z, -z (4 vertices each).
  const spans: Array<[number, number] | null> = [[d, h], [d, h], null, null, [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    const span = spans[f];
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      if (!span) uv.setXY(i, 0.01, 0.01);
      else uv.setXY(i, (uv.getX(i) * span[0]) / 32, (uv.getY(i) * span[1]) / 32);
    }
  }
}

/**
 * Neon Metro skyline: towers packed around the circuit (clear of the road),
 * lit windows, neon roof outlines and a few vertical neon strips.
 */
export function buildSkyline(ctx: BuildContext, p: LandmarkPlacement): void {
  const { path, terrain } = ctx;
  const rng = new SeededRandom(ctx.def.terrain.seed + 77);
  const count = Number(p.params?.count ?? 220);
  const towers: BufferGeometry[] = [];
  const neon = new Map<string, BufferGeometry[]>(NEON.map((c) => [c, []]));
  const placed: Array<{ x: number; z: number; r: number }> = [];
  const half = terrain.def.size / 2 - 20;

  for (let attempt = 0; attempt < count * 12 && towers.length < count; attempt++) {
    const s = path.samples[rng.int(0, path.samples.length - 1)]!;
    const side = rng.chance(0.5) ? 1 : -1;
    const out = 16 + Math.pow(rng.next(), 1.4) * 300;
    const w = rng.range(12, 26);
    const dd = rng.range(12, 26);
    const x = s.position.x + s.flatRight.x * side * (s.wallOffset + out + w / 2);
    const z = s.position.z + s.flatRight.z * side * (s.wallOffset + out + dd / 2);
    if (Math.abs(x - terrain.centerX) > half || Math.abs(z - terrain.centerZ) > half) continue;
    const inf = terrain.influence(x, z);
    const r = Math.hypot(w, dd) / 2;
    if (inf && inf.distance < inf.wallOffset + r + 6) continue;
    if (placed.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + r + 3)) continue;
    placed.push({ x, z, r });

    const h = rng.range(18, 40) + out * rng.range(0.15, 0.4);
    const geo = new BoxGeometry(w, h, dd);
    tileUVs(geo, w, h, dd);
    const tint = new Color().setHSL(rng.range(0.6, 0.78), 0.35, rng.range(0.55, 0.85));
    const colors = new Float32Array(geo.getAttribute('position').count * 3);
    for (let i = 0; i < colors.length; i += 3) colors.set([tint.r, tint.g, tint.b], i);
    geo.setAttribute('color', new BufferAttribute(colors, 3));
    const y = terrain.sample(x, z) - 1;
    geo.translate(x, y + h / 2, z);
    towers.push(geo);

    // Neon roof outline + an occasional vertical strip.
    const color = rng.pick(NEON);
    const list = neon.get(color)!;
    const top = y + h + 0.3;
    for (const [bw, bd, ox, oz] of [
      [w, 0.5, 0, dd / 2],
      [w, 0.5, 0, -dd / 2],
      [0.5, dd, w / 2, 0],
      [0.5, dd, -w / 2, 0],
    ] as const) {
      const strip = new BoxGeometry(bw + 0.4, 0.6, bd + 0.4);
      strip.translate(x + ox, top, z + oz);
      list.push(strip);
    }
    if (rng.chance(0.35)) {
      const strip = new BoxGeometry(0.6, h * 0.8, 0.6);
      strip.translate(x + (w / 2) * (rng.chance(0.5) ? 1 : -1), y + h * 0.5, z + dd / 2);
      list.push(strip);
    }
  }

  if (!towers.length) return;
  const tex = windowTexture(rng);
  const buildings = new Mesh(
    mergeGeometries(towers),
    new MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: new Color('#ffffff'), emissiveIntensity: 1.1, vertexColors: true, roughness: 0.85 }),
  );
  buildings.name = 'skyline';
  buildings.receiveShadow = true;
  ctx.add(buildings);
  for (const [color, parts] of neon) {
    if (!parts.length) continue;
    const m = new Mesh(mergeGeometries(parts), new MeshBasicMaterial({ color: new Color(color).multiplyScalar(1.6) }));
    m.name = `neon-${color}`;
    ctx.add(m);
  }
}
