import { BoxGeometry, ConeGeometry, CylinderGeometry, Group, Mesh } from 'three';
import type { LandmarkPlacement } from '@shared/types/track';
import type { BuildContext } from '../BuildContext';
import { TrackMaterials } from '../materials';
import { resolvePlacement } from './placement';

/** Big storybook windmill with turning sails — a landmark visible from much of the lap. */
export function buildWindmill(ctx: BuildContext, p: LandmarkPlacement): void {
  const r = resolvePlacement(ctx, p);
  const s = p.scale ?? 1;
  const g = new Group();
  g.name = 'windmill';
  g.position.copy(r.position);
  g.position.y -= 0.5;
  g.rotation.y = r.yaw;
  g.scale.setScalar(s);

  const white = TrackMaterials.paint('#fbf6ec');
  const red = TrackMaterials.paint('#e8413a');
  const wood = TrackMaterials.paint('#8a5a3b');
  const dark = TrackMaterials.paint('#3a2f4f');

  const tower = new Mesh(new CylinderGeometry(2.6, 4.0, 16, 8), white);
  tower.position.y = 8;
  const base = new Mesh(new CylinderGeometry(4.3, 4.6, 1.4, 8), TrackMaterials.paint('#b9ad9c'));
  base.position.y = 0.7;
  const cap = new Mesh(new ConeGeometry(3.6, 5, 8), red);
  cap.position.y = 18.4;
  const door = new Mesh(new BoxGeometry(1.8, 3.2, 0.4), wood);
  door.position.set(0, 2.2, 3.85);
  door.rotation.x = -0.09;
  const win1 = new Mesh(new BoxGeometry(1.2, 1.4, 0.3), dark);
  win1.position.set(0, 9.5, 3.15);
  win1.rotation.x = -0.09;
  g.add(tower, base, cap, door, win1);

  // Rotor.
  const rotor = new Group();
  rotor.position.set(0, 15, 3.6);
  const hub = new Mesh(new CylinderGeometry(0.7, 0.7, 1.2, 10), red);
  hub.rotation.x = Math.PI / 2;
  rotor.add(hub);
  for (let i = 0; i < 4; i++) {
    const arm = new Group();
    arm.rotation.z = (i * Math.PI) / 2;
    const spar = new Mesh(new BoxGeometry(0.35, 11, 0.3), wood);
    spar.position.y = 5.5;
    const sail = new Mesh(new BoxGeometry(2.6, 8.5, 0.12), white);
    sail.position.set(1.4, 6.4, -0.1);
    arm.add(spar, sail);
    rotor.add(arm);
  }
  g.add(rotor);

  g.traverse((o) => {
    o.castShadow = true;
    o.receiveShadow = true;
  });
  ctx.add(g);
  ctx.updatables.push({ update: (dt) => (rotor.rotation.z -= dt * 0.55) });
  ctx.footprints.push({ x: r.position.x, z: r.position.z, r: 12 * s });
}
