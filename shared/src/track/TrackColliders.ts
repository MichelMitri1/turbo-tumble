import type RAPIER from '@dimforge/rapier3d-compat';
import { Layer, type PhysicsWorld } from '../physics/PhysicsWorld';
import { SurfaceType } from '../types/surface';
import type { MeshData } from './Extrude';
import type { TrackPath } from './TrackPath';
import { buildCurbSurfaces, buildRoadSurface, buildTunnelKerbs, buildWallColliders } from './TrackGeometry';

/**
 * Build the complete static collision world for a track. Shared so the client
 * (prediction) and the server (authority) simulate against identical geometry.
 */
export function buildTrackColliders(physics: PhysicsWorld, path: TrackPath, terrainMesh: MeshData): { terrain: RAPIER.Collider } {
  const terrain = physics.addTrimesh(terrainMesh, Layer.Ground, SurfaceType.Offroad);
  physics.addTrimesh(buildRoadSurface(path), Layer.Ground, SurfaceType.Road);
  const curbs = buildCurbSurfaces(path);
  if (curbs) physics.addTrimesh(curbs, Layer.Ground, SurfaceType.Curb);
  const kerbs = buildTunnelKerbs(path);
  if (kerbs) physics.addTrimesh(kerbs, Layer.Ground, SurfaceType.Curb);
  physics.addTrimesh(buildWallColliders(path), Layer.Wall);
  for (const hazard of path.def.hazards) {
    physics.addCylinder(path.anchorToWorld(hazard).position, hazard.radius, hazard.obstacleHeight / 2);
  }
  physics.finalize();
  return { terrain };
}
