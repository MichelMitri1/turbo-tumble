import { BoxGeometry, CanvasTexture, CylinderGeometry, Group, LatheGeometry, Mesh, MeshStandardMaterial, SRGBColorSpace, Vector2 } from 'three';
import type { LandmarkPlacement } from '@shared/types/track';
import type { BuildContext } from '../BuildContext';
import { TrackMaterials } from '../materials';

const SCHEMES = [
  ['#ff4f9a', '#ffd23f'],
  ['#3fa9f5', '#fffaf0'],
  ['#ff8c1a', '#7a4fff'],
];

function stripes(a: string, b: string): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 8;
  const ctx = c.getContext('2d')!;
  for (let i = 0; i < 12; i++) {
    ctx.fillStyle = i % 2 === 0 ? a : b;
    ctx.fillRect((i * 256) / 12, 0, 256 / 12 + 1, 8);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Drifting hot-air balloon. `position` is absolute; Y is height above the terrain. */
export function buildBalloon(ctx: BuildContext, p: LandmarkPlacement): void {
  const [x, y, z] = p.position ?? [0, 60, 0];
  const scheme = SCHEMES[Number(p.params?.color ?? 0) % SCHEMES.length]!;
  const g = new Group();
  g.name = 'balloon';
  const baseY = ctx.terrain.sample(x, z) + y;
  g.position.set(x, baseY, z);

  const profile: Vector2[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const a = -Math.PI / 2 + t * Math.PI * 1.08;
    const r = Math.cos(a) * 7 * (t < 0.35 ? 0.55 + t * 1.3 : 1);
    profile.push(new Vector2(Math.max(0.6, r), Math.sin(a) * 8 + 8));
  }
  const envelope = new Mesh(
    new LatheGeometry(profile, 24),
    new MeshStandardMaterial({ map: stripes(scheme[0]!, scheme[1]!), roughness: 0.6 }),
  );
  envelope.position.y = 4;
  const basket = new Mesh(new BoxGeometry(1.8, 1.4, 1.8), TrackMaterials.paint('#9a6a3e'));
  const ropeMat = TrackMaterials.paint('#5a4632');
  for (const [rx, rz] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]] as const) {
    const rope = new Mesh(new CylinderGeometry(0.05, 0.05, 4.2, 4), ropeMat);
    rope.position.set(rx, 2.6, rz);
    g.add(rope);
  }
  g.add(envelope, basket);
  ctx.add(g);

  const phase = x * 0.01 + z * 0.02;
  ctx.updatables.push({
    update: (_dt, time) => {
      g.position.x = x + Math.sin(time * 0.03 + phase) * 30;
      g.position.z = z + Math.cos(time * 0.025 + phase) * 30;
      g.position.y = baseY + Math.sin(time * 0.4 + phase) * 1.6;
      g.rotation.y = time * 0.05;
    },
  });
}
