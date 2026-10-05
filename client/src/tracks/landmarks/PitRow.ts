import type { LandmarkPlacement } from '@shared/types/track';
import type { BuildContext } from '../BuildContext';
import { resolvePlacement } from './placement';

export const PIT_ROW_MODELS = ['pitsGarage', 'pitsOffice'] as const;
const UNIT = 8;

/** Row of pit garages (Kenney Racing Kit) along the track edge, ending in an office. */
export function buildPitRow(ctx: BuildContext, p: LandmarkPlacement): void {
  const a = p.anchor;
  if (!a) throw new Error('pitRow needs an anchor');
  const length = a.length ?? 40;
  const count = Math.max(1, Math.floor(length / UNIT));
  for (let i = 0; i < count; i++) {
    const distance = a.distance - length / 2 + UNIT * (i + 0.5);
    const r = resolvePlacement(ctx, { ...p, anchor: { ...a, distance } });
    const model = ctx.assets.instantiate(i === count - 1 ? 'pitsOffice' : 'pitsGarage');
    model.scale.setScalar(UNIT);
    model.position.copy(r.position);
    model.position.y -= 0.1;
    model.rotation.y = r.yaw;
    ctx.add(model);
    ctx.footprints.push({ x: r.position.x, z: r.position.z, r: UNIT * 0.8 });
  }
}
