import { PhysicsWorld } from '../../../shared/src/physics/PhysicsWorld';
import { TerrainField } from '../../../shared/src/track/TerrainField';
import { TrackPath } from '../../../shared/src/track/TrackPath';
import { buildTrackColliders } from '../../../shared/src/track/TrackColliders';
import { getTrack } from '../../../shared/src/tracks/registry';
import type { TrackDefinition } from '../../../shared/src/types/track';

interface TrackData {
  def: TrackDefinition;
  path: TrackPath;
  terrainMesh: ReturnType<TerrainField['buildMesh']>;
}

/** Track path + terrain are immutable, so build them once per track for the whole process. */
const cache = new Map<string, TrackData>();

function trackData(trackId: string): TrackData {
  let data = cache.get(trackId);
  if (!data) {
    const def = getTrack(trackId);
    const path = new TrackPath(def);
    const terrainMesh = new TerrainField(path, def.terrain).buildMesh();
    data = { def, path, terrainMesh };
    cache.set(trackId, data);
  }
  return data;
}

export interface TrackWorld {
  def: TrackDefinition;
  path: TrackPath;
  physics: PhysicsWorld;
}

/** A fresh collision world for one race (kart colliders are per race). */
export function createTrackWorld(trackId: string): TrackWorld {
  const { def, path, terrainMesh } = trackData(trackId);
  const physics = new PhysicsWorld();
  buildTrackColliders(physics, path, terrainMesh);
  return { def, path, physics };
}
