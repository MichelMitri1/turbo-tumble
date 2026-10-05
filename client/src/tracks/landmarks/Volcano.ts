import { BufferAttribute, CircleGeometry, Color, CylinderGeometry, IcosahedronGeometry, Mesh, MeshBasicMaterial, MeshStandardMaterial } from 'three';
import type { LandmarkPlacement } from '@shared/types/track';
import { Noise2D } from '@shared/math/noise';
import { smoothstep } from '@shared/math/scalar';
import type { BuildContext } from '../BuildContext';

/** A big volcano on the horizon: dark slopes heating to orange, a lava crater and drifting smoke. */
export function buildVolcano(ctx: BuildContext, p: LandmarkPlacement): void {
  const terrain = ctx.terrain;
  const angle = Number(p.params?.angle ?? 0.7);
  const dist = Math.min(terrain.def.size * 0.44, Number(p.params?.distance ?? 520) + terrain.def.size * 0.1);
  const cx = terrain.centerX + Math.cos(angle) * dist;
  const cz = terrain.centerZ + Math.sin(angle) * dist;
  const base = terrain.sample(cx, cz) - 6;
  const height = 230;
  const geo = new CylinderGeometry(48, 270, height, 28, 8, true).toNonIndexed();
  const noise = new Noise2D(ctx.def.terrain.seed + 9);
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const rock = new Color('#2a201d');
  const hot = new Color('#ff5a1a');
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const t = (y + height / 2) / height;
    const n = noise.noise(x * 0.03, z * 0.03) * 18 * (1 - t);
    const r = Math.hypot(x, z) || 1;
    pos.setXYZ(i, x + (x / r) * n, y, z + (z / r) * n);
    // Lava streaks glow down from the rim.
    const streak = Math.max(0, Math.sin(Math.atan2(z, x) * 7 + noise.noise(t * 3, 1) * 2)) ** 6;
    c.copy(rock).lerp(hot, smoothstep(0.82, 1, t) + streak * smoothstep(0.35, 0.95, t) * 0.8);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const cone = new Mesh(geo, new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, emissive: '#ff3a00', emissiveIntensity: 0.0 }));
  cone.position.set(cx, base + height / 2, cz);
  cone.name = 'volcano';
  ctx.add(cone);

  const crater = new Mesh(new CircleGeometry(50, 24), new MeshBasicMaterial({ color: new Color('#ff7a2a').multiplyScalar(1.5) }));
  crater.rotation.x = -Math.PI / 2;
  crater.position.set(cx, base + height - 6, cz);
  ctx.add(crater);

  // Smoke puffs rising and recycling.
  const smokeMat = new MeshStandardMaterial({ color: '#4a3a36', roughness: 1, flatShading: true, transparent: true, opacity: 0.85 });
  const puffs: Mesh[] = [];
  for (let i = 0; i < 14; i++) {
    const m = new Mesh(new IcosahedronGeometry(1, 1), smokeMat);
    m.userData.phase = i / 14;
    puffs.push(m);
    ctx.add(m);
  }
  ctx.updatables.push({
    update: (_dt, time) => {
      for (const m of puffs) {
        const k = (time * 0.025 + (m.userData.phase as number)) % 1;
        m.position.set(cx + Math.sin(k * 5 + (m.userData.phase as number) * 9) * 30 + k * 120, base + height + k * 260, cz + k * 40);
        m.scale.setScalar(30 + k * 70);
      }
    },
  });
}
