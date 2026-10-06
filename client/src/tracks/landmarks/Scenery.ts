import { BufferAttribute, Color, ConeGeometry, IcosahedronGeometry, Mesh, MeshStandardMaterial, type BufferGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { LandmarkPlacement } from '@shared/types/track';
import { Noise2D } from '@shared/math/noise';
import { SeededRandom } from '@shared/math/random';
import { smoothstep } from '@shared/math/scalar';
import type { BuildContext } from '../BuildContext';

/** Ring of stylised distant mountains (fog gives aerial perspective). */
export function buildMountains(ctx: BuildContext, p: LandmarkPlacement): void {
  const radius = Number(p.params?.radius ?? 750);
  const count = Number(p.params?.count ?? 30);
  const rng = new SeededRandom(ctx.def.terrain.seed + 3);
  const noise = new Noise2D(ctx.def.terrain.seed + 4);
  const green = new Color(String(p.params?.low ?? '#5aa44a'));
  const rock = new Color(String(p.params?.mid ?? '#8e8fa6'));
  const snow = new Color(String(p.params?.peak ?? '#f4f7ff'));
  const snowCaps = p.params?.snow !== false;
  const parts: BufferGeometry[] = [];

  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rng.range(-0.08, 0.08);
    const dist = radius + rng.range(-80, 160);
    const h = rng.range(110, 280);
    const r = rng.range(140, 260);
    const geo = new ConeGeometry(r, h, 9, 5).toNonIndexed();
    const pos = geo.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);
    const c = new Color();
    for (let v = 0; v < pos.count; v++) {
      const x = pos.getX(v);
      const y = pos.getY(v);
      const z = pos.getZ(v);
      const t = (y + h / 2) / h;
      const n = noise.noise(x * 0.02 + i * 7, z * 0.02) * (1 - t) * r * 0.25;
      pos.setXYZ(v, x + (x / r) * n, y, z + (z / r) * n);
      c.copy(green).lerp(rock, smoothstep(0.15, 0.5, t));
      if (snowCaps ? h > 190 : true) c.lerp(snow, smoothstep(snowCaps ? 0.72 : 0.6, snowCaps ? 0.8 : 1, t));
      colors.set([c.r, c.g, c.b], v * 3);
    }
    geo.setAttribute('color', new BufferAttribute(colors, 3));
    geo.translate(ctx.terrain.centerX + Math.cos(a) * dist, h / 2 - 12, ctx.terrain.centerZ + Math.sin(a) * dist);
    parts.push(geo);
  }
  const merged = mergeGeometries(parts);
  merged.computeVertexNormals();
  const mesh = new Mesh(merged, new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
  mesh.name = 'mountains';
  ctx.add(mesh);
}

/** Puffy low-poly clouds drifting slowly around the arena. */
export function buildClouds(ctx: BuildContext, p?: LandmarkPlacement): void {
  const count = ctx.def.sky.clouds;
  const lowY = Number(p?.params?.minY ?? 130);
  const highY = Number(p?.params?.maxY ?? 240);
  const rng = new SeededRandom(ctx.def.terrain.seed + 5);
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(180, 900);
    const cx = Math.cos(a) * d;
    const cz = Math.sin(a) * d;
    const cy = rng.range(lowY, highY);
    const size = rng.range(14, 30);
    const puffs = rng.int(5, 9);
    for (let k = 0; k < puffs; k++) {
      const r = size * rng.range(0.45, 0.9);
      const g = new IcosahedronGeometry(r, 1);
      g.scale(1, 0.65, 1);
      g.translate(cx + rng.range(-1.6, 1.6) * size, cy + rng.range(-0.2, 0.35) * size, cz + rng.range(-0.8, 0.8) * size);
      parts.push(g);
    }
  }
  const mesh = new Mesh(
    mergeGeometries(parts),
    new MeshStandardMaterial({ color: '#ffffff', emissive: '#dfeeff', emissiveIntensity: 0.35, roughness: 1, flatShading: true }),
  );
  mesh.name = 'clouds';
  mesh.position.set(ctx.terrain.centerX, 0, ctx.terrain.centerZ);
  ctx.add(mesh);
  ctx.updatables.push({ update: (dt) => (mesh.rotation.y += dt * 0.0025) });
}
