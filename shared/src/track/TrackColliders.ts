import type RAPIER from '@dimforge/rapier3d-compat';
import { Layer, type PhysicsWorld } from '../physics/PhysicsWorld';
import { SurfaceType } from '../types/surface';
import type { MeshData } from './Extrude';
import type { TrackPath } from './TrackPath';
import { buildCurbSurfaces, buildRoadSurface, buildShortcutSurfaces, buildTunnelKerbs, buildWallColliders } from './TrackGeometry';
import type { TerrainField } from './TerrainField';
import { buildJumpSurface } from './JumpGeometry';

/**
 * Build the complete static collision world for a track. Shared so the client
 * (prediction) and the server (authority) simulate against identical geometry.
 */
export function buildTrackColliders(physics: PhysicsWorld, path: TrackPath, terrainMesh: MeshData, terrainField?: TerrainField): { terrain: RAPIER.Collider } {
  const terrain = physics.addTrimesh(terrainMesh, Layer.Ground, SurfaceType.Offroad);
  physics.addTrimesh(buildRoadSurface(path), Layer.Ground, SurfaceType.Road);
  for (const jump of path.def.jumps) physics.addTrimesh(buildJumpSurface(path, jump), Layer.Ground, SurfaceType.Road);
  const curbs = buildCurbSurfaces(path);
  if (curbs) physics.addTrimesh(curbs, Layer.Ground, SurfaceType.Curb);
  const kerbs = buildTunnelKerbs(path);
  if (kerbs) physics.addTrimesh(kerbs, Layer.Ground, SurfaceType.Curb);
  if (terrainField) {
    const trails = buildShortcutSurfaces(path, (x, z) => terrainField.sample(x, z));
    if (trails) physics.addTrimesh(trails, Layer.Ground, SurfaceType.Trail);
  }
  const walls = buildWallColliders(path);
  if (walls) physics.addTrimesh(walls, Layer.Wall);
  for (const hazard of path.def.hazards) {
    physics.addCylinder(path.anchorToWorld(hazard).position, hazard.radius, hazard.obstacleHeight / 2);
  }
  // Pendulum gantries stand just off the road edges.
  for (const m of path.def.movers ?? []) {
    if (m.kind !== 'pendulum') continue;
    for (const side of [-1, 1]) {
      const f = path.anchorToWorld({ distance: m.distance });
      const pos = f.position.clone().addScaledVector(f.right, side * gantryOffset(f.halfWidth, f.wallOffset));
      physics.addCylinder(pos, 0.45, 5);
    }
  }
  physics.finalize();
  return { terrain };
}

/** Lateral offset of a pendulum gantry post (between the road edge and the wall). */
export function gantryOffset(halfWidth: number, wallOffset: number): number {
  return Math.min(halfWidth + 1.2, Math.max(halfWidth + 0.6, wallOffset - 0.6));
}
