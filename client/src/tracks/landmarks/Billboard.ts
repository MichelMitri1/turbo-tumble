import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, PlaneGeometry } from 'three';
import type { LandmarkPlacement } from '@shared/types/track';
import type { BuildContext } from '../BuildContext';
import { brandTexture } from '../../rendering/ProceduralTextures';
import { TrackMaterials } from '../materials';
import { resolvePlacement } from './placement';

/** Two-post sponsor billboard, angled towards oncoming traffic. */
export function buildBillboard(ctx: BuildContext, p: LandmarkPlacement): void {
  const r = resolvePlacement(ctx, p);
  const g = new Group();
  g.name = 'billboard';
  g.position.copy(r.position);
  // Face the track, then swing ~40° to face karts approaching from behind.
  g.rotation.y = r.yaw + (r.side === 1 ? 0.7 : -0.7);

  const w = 11;
  const h = 4.4;
  const postH = 8.2;
  const postMat = TrackMaterials.paint('#4b4a5c');
  for (const x of [-w * 0.33, w * 0.33]) {
    const post = new Mesh(new CylinderGeometry(0.22, 0.28, postH, 8), postMat);
    post.position.set(x, postH / 2, -0.3);
    g.add(post);
  }
  const frame = new Mesh(new BoxGeometry(w + 0.5, h + 0.5, 0.45), TrackMaterials.paint('#f6f3ee'));
  frame.position.set(0, postH - h / 2 + 0.6, -0.2);
  g.add(frame);

  const brand = Number(p.params?.brand ?? 0);
  const faceMat = new MeshStandardMaterial({ map: brandTexture(brand), roughness: 0.55, emissive: '#ffffff', emissiveIntensity: 0.1 });
  faceMat.emissiveMap = faceMat.map;
  const face = new Mesh(new PlaneGeometry(w, h), faceMat);
  face.position.set(0, postH - h / 2 + 0.6, 0.04);
  g.add(face);

  g.traverse((o) => {
    o.castShadow = true;
    o.receiveShadow = true;
  });
  ctx.add(g);
  ctx.footprints.push({ x: r.position.x, z: r.position.z, r: 8 });
}
