import { Box3, Vector3, type Object3D } from 'three';
import type { BuildContext } from '../BuildContext';
import { HAZARD_SKINS } from './skins';

/** Road obstacles reuse the scenery kit and the shared physics dimensions. */
export function buildHazards(ctx: BuildContext): void {
  const skins = (HAZARD_SKINS[ctx.def.theme] ?? []).filter((s) => ctx.kits.has(s.kit, s.name));
  ctx.def.hazards.forEach((hazard, i) => {
    // A themed kit model (snowman, crate, gravestone…) when the course has one.
    const skin = skins.length ? skins[i % skins.length]! : null;
    const object: Object3D = skin ? ctx.kits.instantiate(skin.kit, skin.name) : ctx.assets.instantiate(hazard.model);
    const box = new Box3().setFromObject(object);
    const size = box.getSize(new Vector3());
    const width = Math.max(size.x, size.z, 0.001);
    if (skin) object.scale.setScalar(Math.min((hazard.radius * 2.1) / width, (hazard.obstacleHeight * (skin.tall ?? 1)) / Math.max(size.y, 0.001)));
    else object.scale.set((hazard.radius * 2) / width, hazard.obstacleHeight / Math.max(size.y, 0.001), (hazard.radius * 2) / width);
    const frame = ctx.path.anchorToWorld(hazard);
    object.position.copy(frame.position);
    object.rotation.y = Math.atan2(frame.tangent.x, frame.tangent.z) + Math.PI + (i % 2 ? 0.3 : -0.3);
    object.name = `obstacle:${skin ? skin.name : hazard.model}`;
    ctx.add(object);
  });
}
