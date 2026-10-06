import { BufferAttribute, Color, Mesh, MeshStandardMaterial, RingGeometry } from 'three';
import type { MeshData } from '@shared/track/Extrude';
import { Noise2D } from '@shared/math/noise';
import { clamp, smoothstep } from '@shared/math/scalar';
import type { BuildContext } from '../BuildContext';
import { toGeometry } from '../../rendering/meshData';
import { grassDetailTexture } from '../../rendering/ProceduralTextures';

/** Colour the terrain grid and add it (plus an outer ground skirt) to the scene. */
export function buildTerrainVisual(ctx: BuildContext, data: MeshData): void {
  const { terrain } = ctx;
  const pal = terrain.def.palette;
  const grassA = new Color(pal.grassA);
  const grassB = new Color(pal.grassB);
  const shoulder = new Color(pal.shoulder);
  const sand = new Color(pal.sand);
  const rock = new Color(pal.rock);
  const noise = new Noise2D(terrain.def.seed + 99);
  const water = terrain.def.waterLevel;

  const geo = toGeometry(data, true);
  const pos = data.positions;
  const normals = geo.getAttribute('normal');
  const colors = new Float32Array(pos.length);
  const c = new Color();

  for (let i = 0; i < pos.length / 3; i++) {
    const x = pos[i * 3]!;
    const y = pos[i * 3 + 1]!;
    const z = pos[i * 3 + 2]!;
    // Large soft patches + fine variation.
    const patch = noise.fbm(x * 0.012, z * 0.012, 3) * 0.5 + 0.5;
    c.copy(grassA).lerp(grassB, clamp(patch * 1.3 - 0.15, 0, 1));
    c.offsetHSL(0, 0, noise.noise(x * 0.15, z * 0.15) * 0.025);

    // Mown stripes inside the walls and a little beyond.
    const inf = terrain.influence(x, z);
    if (inf && inf.distance < inf.wallOffset + 14) {
      const stripe = Math.floor(inf.sample.distance / 9) % 2 === 0 ? 0.035 : -0.015;
      c.lerp(shoulder, 0.35).offsetHSL(0, 0, stripe);
    }

    // Steep slopes → rock.
    const ny = normals.getY(i);
    c.lerp(rock, smoothstep(0.86, 0.7, ny));

    // Beaches around lakes only.
    if (water !== null && terrain.lakeDistance(x, z) < 1.6) c.lerp(sand, smoothstep(water + 1.8, water + 0.6, y));

    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3));

  const tex = grassDetailTexture();
  const mat = new MeshStandardMaterial({ vertexColors: true, map: tex, roughness: 1, metalness: 0 });
  const mesh = new Mesh(geo, mat);
  mesh.name = 'terrain';
  mesh.receiveShadow = true;
  ctx.add(mesh);

  // Outer ground ring so the horizon never shows the terrain edge. (Nothing may sit
  // under the terrain itself: roads dip below the base height and chasms go far deeper.)
  const half = terrain.def.size / 2;
  const edgeY = terrain.def.baseHeight - 2;
  const ringMat = new MeshStandardMaterial({ color: grassA.clone().multiplyScalar(0.92), roughness: 1 });
  const ring = new Mesh(new RingGeometry(half * 0.98, 3200, 64, 1), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(terrain.centerX, edgeY, terrain.centerZ);
  ring.name = 'ground-ring';
  ctx.add(ring);
}
