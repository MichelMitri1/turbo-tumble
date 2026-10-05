import { Group, type Object3D } from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { TrackDefinition } from '@shared/types/track';
import { TrackPath } from '@shared/track/TrackPath';
import { TerrainField } from '@shared/track/TerrainField';
import { buildTrackColliders } from '@shared/track/TrackColliders';
import type { PhysicsWorld } from '@shared/physics/PhysicsWorld';
import type { AssetLoader } from '../assets/AssetLoader';
import type { GraphicsSettings } from '../config/graphics';
import type { BuildContext, Updatable } from './BuildContext';
import { buildTerrainVisual } from './builders/TerrainBuilder';
import { buildRoad } from './builders/RoadBuilder';
import { buildBridges } from './builders/BridgeBuilder';
import { buildTunnels } from './builders/TunnelBuilder';
import { buildBoostPads } from './builders/BoostPadBuilder';
import { buildDecor } from './decor/DecorBuilder';
import { getLandmark } from './landmarks';
import { Water } from '../rendering/Water';

export interface TrackLoadDeps {
  assets: AssetLoader;
  physics: PhysicsWorld;
  graphics: GraphicsSettings;
}

export type TrackProgress = (fraction: number, label: string) => void;

/** A built, playable track: shared path/terrain data plus its scene graph. */
export class TrackRuntime {
  constructor(
    readonly def: TrackDefinition,
    readonly path: TrackPath,
    readonly terrain: TerrainField,
    readonly root: Group,
    private readonly updatables: Updatable[],
    /** Big terrain trimesh (excluded from the live collider debug view). */
    readonly terrainCollider: RAPIER.Collider,
  ) {}

  update(dt: number, time: number): void {
    for (const u of this.updatables) u.update(dt, time);
  }
}

/** Every asset-manifest model a track references (loaded lazily per track). */
export function requiredModels(def: TrackDefinition): string[] {
  const ids = new Set<string>();
  def.decor.props.forEach((p) => ids.add(p.model));
  def.decor.scatter.forEach((r) => r.models.forEach((m) => ids.add(m)));
  def.decor.landmarks.forEach((l) => getLandmark(l.type).models?.forEach((m) => ids.add(m)));
  return [...ids];
}

const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

/** Build colliders + visuals for a track. Yields between stages so the loading UI stays live. */
export async function loadTrack(def: TrackDefinition, deps: TrackLoadDeps, onProgress: TrackProgress): Promise<TrackRuntime> {
  onProgress(0.02, 'Surveying the circuit');
  const path = new TrackPath(def);
  const terrain = new TerrainField(path, def.terrain);

  await deps.assets.loadModels(requiredModels(def), (done, total) => onProgress(0.05 + 0.4 * (done / Math.max(1, total)), 'Unpacking scenery'));

  const root = new Group();
  root.name = `track:${def.id}`;
  const ctx: BuildContext = {
    def,
    path,
    terrain,
    assets: deps.assets,
    physics: deps.physics,
    graphics: deps.graphics,
    root,
    updatables: [],
    footprints: [],
    add: (o: Object3D) => root.add(o),
  };

  onProgress(0.5, 'Shaping the hills');
  await nextFrame();
  const terrainData = terrain.buildMesh();
  const { terrain: terrainCollider } = buildTrackColliders(deps.physics, path, terrainData);
  buildTerrainVisual(ctx, terrainData);

  onProgress(0.65, 'Paving the road');
  await nextFrame();
  buildRoad(ctx);
  buildBridges(ctx);
  buildTunnels(ctx);
  buildBoostPads(ctx);
  if (def.terrain.waterLevel !== null) {
    for (const lake of def.terrain.lakes) {
      // Sized to the lake's carved basin (shore blend reaches ~1.6× the radii).
      const size = Math.max(lake.radiusX, lake.radiusZ) * 3.4;
      const liquid = def.terrain.liquid;
      const water = new Water(def.terrain.waterLevel, lake.x, lake.z, size, liquid?.color, liquid ?? {});
      root.add(water.mesh);
      ctx.updatables.push({ update: (_dt, time) => water.update(time) });
    }
  }

  onProgress(0.8, 'Building the grandstands');
  await nextFrame();
  for (const placement of def.decor.landmarks) getLandmark(placement.type).build(ctx, placement);

  onProgress(0.9, 'Planting trees');
  await nextFrame();
  buildDecor(ctx);

  onProgress(1, 'Ready');
  return new TrackRuntime(def, path, terrain, root, ctx.updatables, terrainCollider);
}
