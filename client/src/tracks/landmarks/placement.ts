import { Vector3 } from 'three';
import type { LandmarkPlacement } from '@shared/types/track';
import type { TrackFrame } from '@shared/track/TrackPath';
import type { BuildContext } from '../BuildContext';

export interface ResolvedPlacement {
  /** World position on the terrain. */
  position: Vector3;
  /** Yaw (radians) so local +Z faces the track (side placements) or follows `yaw`. */
  yaw: number;
  /** +1 right / -1 left of the driving direction (0 for absolute placements). */
  side: number;
  frame: TrackFrame | null;
}

/** Resolve a landmark's track-space or absolute placement to a world transform. */
export function resolvePlacement(ctx: BuildContext, p: LandmarkPlacement): ResolvedPlacement {
  const extraYaw = ((p.yaw ?? 0) * Math.PI) / 180;
  if (p.anchor) {
    const frame = ctx.path.frameAtSplineDistance(ctx.path.startDistance + p.anchor.distance);
    const side = p.anchor.side === 'left' ? -1 : p.anchor.side === 'right' ? 1 : 0;
    const flatRight = frame.sample.flatRight;
    const position = frame.position.clone();
    if (side !== 0) position.addScaledVector(flatRight, side * (frame.wallOffset + (p.anchor.wallOffset ?? 0)));
    position.addScaledVector(flatRight, p.anchor.lateral ?? 0);
    position.y = side !== 0 ? ctx.terrain.sample(position.x, position.z) : position.y;
    // Face the track: local +Z points back towards the centreline.
    const toTrack = flatRight.clone().multiplyScalar(-side || 1);
    const yaw = side !== 0 ? Math.atan2(toTrack.x, toTrack.z) + extraYaw : Math.atan2(frame.tangent.x, frame.tangent.z) + extraYaw;
    return { position, yaw, side, frame };
  }
  const [x, y, z] = p.position ?? [0, 0, 0];
  return { position: new Vector3(x, ctx.terrain.sample(x, z) + y, z), yaw: extraYaw, side: 0, frame: null };
}

/** Sample indices covering a centred length of track around a lap distance. */
export function sampleRange(ctx: BuildContext, centerLapDistance: number, length: number): number[] {
  const { path } = ctx;
  const start = path.startDistance + centerLapDistance - length / 2;
  const count = Math.max(2, Math.round(length / path.spacing) + 1);
  const first = Math.round(path.wrapDistance(start) / path.spacing);
  return Array.from({ length: count }, (_, k) => path.wrapIndex(first + k));
}
