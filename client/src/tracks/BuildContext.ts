import type { Group, Object3D } from 'three';
import type { TrackDefinition } from '@shared/types/track';
import type { TrackPath } from '@shared/track/TrackPath';
import type { TerrainField } from '@shared/track/TerrainField';
import type { PhysicsWorld } from '@shared/physics/PhysicsWorld';
import type { AssetLoader } from '../assets/AssetLoader';
import type { GraphicsSettings } from '../config/graphics';

/** Anything on the track that animates each frame (windmills, crowds, water...). */
export interface Updatable {
  update(dt: number, time: number): void;
}

/** Circular no-scatter zone (x, z, radius) reserved by a landmark. */
export interface Footprint {
  x: number;
  z: number;
  r: number;
}

/** Everything a track sub-builder needs. Builders add to `root` and register updatables/footprints. */
export interface BuildContext {
  def: TrackDefinition;
  path: TrackPath;
  terrain: TerrainField;
  assets: AssetLoader;
  physics: PhysicsWorld;
  graphics: GraphicsSettings;
  root: Group;
  updatables: Updatable[];
  footprints: Footprint[];
  add(object: Object3D): void;
}
