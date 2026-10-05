import RAPIER from '@dimforge/rapier3d-compat';
import { Vector3 } from 'three';
import { SurfaceType } from '../types/surface';
import type { MeshData } from '../track/Extrude';

/** Collision layers (bit flags). */
export const Layer = {
  Ground: 1 << 0,
  Wall: 1 << 1,
  Kart: 1 << 2,
  Prop: 1 << 3,
} as const;

const groups = (membership: number, filter: number): number => ((membership & 0xffff) << 16) | (filter & 0xffff);

const GROUND_QUERY = groups(Layer.Kart, Layer.Ground);
const WALL_QUERY = groups(Layer.Kart, Layer.Wall | Layer.Prop);

export interface GroundHit {
  distance: number;
  point: Vector3;
  normal: Vector3;
  surface: SurfaceType;
}

export interface WallContact {
  normal: Vector3;
}

export interface MoveResult {
  movement: Vector3;
  contacts: WallContact[];
}

let rapierReady: Promise<void> | null = null;

/** Rapier's WASM must be initialised once before any world is created. */
export function initPhysics(): Promise<void> {
  rapierReady ??= RAPIER.init();
  return rapierReady;
}

/**
 * Thin wrapper over Rapier used purely as a collision/query engine. Kart motion is
 * our own arcade integrator; Rapier answers "where is the ground" and "what wall
 * did I hit", which keeps handling fully under our control and deterministic.
 */
export class PhysicsWorld {
  readonly world: RAPIER.World;
  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly surfaces = new Map<number, SurfaceType>();
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.controller = this.world.createCharacterController(0.02);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.setSlideEnabled(true);
    this.controller.disableAutostep();
    this.controller.disableSnapToGround();
    this.controller.setApplyImpulsesToDynamicBodies(false);
    this.controller.setMaxSlopeClimbAngle(Math.PI / 2);
  }

  addTrimesh(mesh: MeshData, layer: number, surface: SurfaceType = SurfaceType.Road): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.trimesh(mesh.positions, mesh.indices)
      .setCollisionGroups(groups(layer, 0xffff))
      .setFriction(0);
    const collider = this.world.createCollider(desc);
    this.surfaces.set(collider.handle, surface);
    return collider;
  }

  addCylinder(position: Vector3, radius: number, halfHeight: number, layer = Layer.Prop): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cylinder(halfHeight, radius)
      .setTranslation(position.x, position.y + halfHeight, position.z)
      .setCollisionGroups(groups(layer, 0xffff));
    return this.world.createCollider(desc);
  }

  /** Kart body used only for wall sweeps (it never collides with the ground). */
  createKartCollider(radius: number): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.ball(radius).setCollisionGroups(groups(Layer.Kart, Layer.Wall | Layer.Prop));
    return this.world.createCollider(desc);
  }

  /** Small sphere used to sweep item projectiles against walls. */
  createProbeCollider(radius: number): RAPIER.Collider {
    return this.createKartCollider(radius);
  }

  removeCollider(collider: RAPIER.Collider): void {
    this.world.removeCollider(collider, false);
  }

  /** Must be called after static geometry is added so scene queries see it. */
  finalize(): void {
    this.world.step();
  }

  raycastGround(origin: Vector3, maxDistance: number, out?: GroundHit): GroundHit | null {
    this.ray.origin = { x: origin.x, y: origin.y, z: origin.z };
    this.ray.dir = { x: 0, y: -1, z: 0 };
    const hit = this.world.castRayAndGetNormal(this.ray, maxDistance, true, undefined, GROUND_QUERY);
    if (!hit) return null;
    const result = out ?? { distance: 0, point: new Vector3(), normal: new Vector3(), surface: SurfaceType.Road };
    result.distance = hit.timeOfImpact;
    result.point.set(origin.x, origin.y - hit.timeOfImpact, origin.z);
    result.normal.set(hit.normal.x, hit.normal.y, hit.normal.z);
    if (result.normal.y < 0) result.normal.negate();
    result.surface = this.surfaces.get(hit.collider.handle) ?? SurfaceType.Road;
    return result;
  }

  /** First wall/prop hit along a segment (used by the camera to avoid clipping). */
  raycastWalls(origin: Vector3, dir: Vector3, maxDistance: number): number | null {
    this.ray.origin = { x: origin.x, y: origin.y, z: origin.z };
    this.ray.dir = { x: dir.x, y: dir.y, z: dir.z };
    const hit = this.world.castRay(this.ray, maxDistance, true, undefined, groups(Layer.Kart, Layer.Wall));
    return hit ? hit.timeOfImpact : null;
  }

  /** Sweep the kart collider from `center` by `desired`, sliding along walls. */
  moveAgainstWalls(collider: RAPIER.Collider, center: Vector3, desired: Vector3, out: MoveResult): MoveResult {
    collider.setTranslation({ x: center.x, y: center.y, z: center.z });
    this.controller.computeColliderMovement(collider, { x: desired.x, y: desired.y, z: desired.z }, undefined, WALL_QUERY);
    const m = this.controller.computedMovement();
    out.movement.set(m.x, m.y, m.z);
    out.contacts.length = 0;
    const n = this.controller.numComputedCollisions();
    for (let i = 0; i < n; i++) {
      const c = this.controller.computedCollision(i);
      if (!c) continue;
      // normal2 is the outward normal on the character → points away from the wall when negated.
      const normal = new Vector3(-c.normal2.x, 0, -c.normal2.z);
      if (normal.lengthSq() < 1e-6) continue;
      out.contacts.push({ normal: normal.normalize() });
    }
    return out;
  }

  debugLines(include?: (collider: RAPIER.Collider) => boolean): { vertices: Float32Array; colors: Float32Array } {
    const buffers = this.world.debugRender(undefined, include);
    return { vertices: buffers.vertices, colors: buffers.colors };
  }

  dispose(): void {
    this.world.free();
  }
}
