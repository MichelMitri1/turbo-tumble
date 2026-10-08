import type { Group, Object3D } from 'three';
import type { TrackDefinition } from '@shared/types/track';
import type { TrackPath } from '@shared/track/TrackPath';
import type { TerrainField } from '@shared/track/TerrainField';
import type { PhysicsWorld } from '@shared/physics/PhysicsWorld';
import type { AssetLoader } from '../assets/AssetLoader';
import type { GraphicsSettings } from '../config/graphics';
import type { KitLibrary } from './kits';

/** Anything on the track that animates each frame (windmills, crowds, water...). */
export interface Updatable {
  /** `raceTime`: the race clock (moving obstacles follow it so visuals match the simulation). */
  update(dt: number, time: number, raceTime?: number): void;
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
  /** Kenney kit models for set pieces (loaded per track from landmark needs). */
  kits: KitLibrary;
  physics: PhysicsWorld;
  graphics: GraphicsSettings;
  root: Group;
  updatables: Updatable[];
  footprints: Footprint[];
  add(object: Object3D): void;
}
