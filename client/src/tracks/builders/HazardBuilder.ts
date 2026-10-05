import { Box3, Vector3 } from 'three';
import type { BuildContext } from '../BuildContext';

/** Road obstacles reuse the scenery kit and the shared physics dimensions. */
export function buildHazards(ctx: BuildContext): void {
  for (const hazard of ctx.def.hazards) {
    const object = ctx.assets.instantiate(hazard.model);
    const box = new Box3().setFromObject(object);
    const size = box.getSize(new Vector3());
    const width = Math.max(size.x, size.z, 0.001);
    object.scale.set(hazard.radius * 2 / width, hazard.obstacleHeight / Math.max(size.y, 0.001), hazard.radius * 2 / width);
    object.position.copy(ctx.path.anchorToWorld(hazard).position);
    object.name = `obstacle:${hazard.model}`;
    ctx.add(object);
  }
}
