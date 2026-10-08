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

/** Distance from (x, z) to the nearest wall line of any part of the track (negative = on it). */
export function roadClearance(ctx: BuildContext, x: number, z: number): number {
  let best = Infinity;
  const s = ctx.path.samples;
  for (let i = 0; i < s.length; i += 2) {
    const p = s[i]!;
    const d = Math.hypot(p.position.x - x, p.position.z - z) - p.wallOffset;
    if (d < best) best = d;
  }
  return best;
}

/**
 * Nearest spot to `from` where a set piece of `radius` stands clear of every road
 * (by `margin`) and of other landmarks' footprints: walks outward along `dir`
 * first, then spirals. Returns null when nothing fits within `maxDist`.
 */
export function findClearSpot(ctx: BuildContext, from: Vector3, radius: number, opts: { dir?: Vector3; margin?: number; maxDist?: number } = {}): Vector3 | null {
  const margin = opts.margin ?? 4;
  const maxDist = opts.maxDist ?? 260;
  const ok = (x: number, z: number): boolean =>
    roadClearance(ctx, x, z) > radius + margin && !ctx.footprints.some((f) => Math.hypot(f.x - x, f.z - z) < f.r + radius * 0.8);
  const at = (x: number, z: number): Vector3 => new Vector3(x, ctx.def.space ? from.y : ctx.terrain.sample(x, z), z);
  if (opts.dir) {
    const d = opts.dir.clone().setY(0).normalize();
    for (let k = 0; k <= maxDist; k += 6) {
      const x = from.x + d.x * k;
      const z = from.z + d.z * k;
      if (ok(x, z)) return at(x, z);
    }
  }
  for (let r = 0; r <= maxDist; r += 8) {
    const steps = Math.max(1, Math.round((2 * Math.PI * r) / 10));
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const x = from.x + Math.cos(a) * r;
      const z = from.z + Math.sin(a) * r;
      if (ok(x, z)) return at(x, z);
    }
  }
  return null;
}

/**
 * Where a big set piece goes: beside the lap at `p.anchor` (pushed out from the
 * wall until it clears every road), or at `p.position`. Reserves its footprint.
 */
export function placeSetPiece(ctx: BuildContext, p: LandmarkPlacement, radius: number, margin = 4): ResolvedPlacement | null {
  const r = resolvePlacement(ctx, p);
  const dir = r.frame && r.side ? r.frame.sample.flatRight.clone().multiplyScalar(r.side) : undefined;
  const spot = findClearSpot(ctx, r.position, radius, { dir, margin });
  if (!spot) return null;
  ctx.footprints.push({ x: spot.x, z: spot.z, r: radius });
  // Face back towards the track point it was anchored to.
  const yaw = r.frame ? Math.atan2(r.frame.position.x - spot.x, r.frame.position.z - spot.z) + ((p.yaw ?? 0) * Math.PI) / 180 : r.yaw;
  return { ...r, position: spot, yaw };
}
