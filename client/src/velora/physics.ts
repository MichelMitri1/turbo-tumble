import RAPIER from '@dimforge/rapier3d-compat';
import { HALF, SIZE } from './world/layout';
import type { City } from './world/city';
import { GRID, VERTS } from './world/terrain';

/**
 * The Rapier world: the land (a heightfield), bridge and freeway decks with their crash
 * barriers, buildings (rotated boxes) and the edges of the map. Vehicles and the player add
 * their own bodies.
 */

export const G = {
  WORLD: 0x0001,
  CAR: 0x0002,
  PLAYER: 0x0004,
};
export const groups = (member: number, filter: number) => (member << 16) | filter;

export class Physics {
  world!: RAPIER.World;
  R = RAPIER;
  statics = new Set<number>();

  async init(city: City): Promise<void> {
    await RAPIER.init();
    const w = (this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 }));
    const add = (d: RAPIER.ColliderDesc) => {
      const c = w.createCollider(d.setCollisionGroups(groups(G.WORLD, 0xffff)));
      this.statics.add(c.handle);
      return c;
    };
    // Land: Rapier wants heights column-major (x index major, z index minor).
    const t = city.terrain.h;
    const hf = new Float32Array(VERTS * VERTS);
    for (let j = 0; j < VERTS; j++) for (let i = 0; i < VERTS; i++) hf[i * VERTS + j] = t[j * VERTS + i]!;
    add(RAPIER.ColliderDesc.heightfield(GRID, GRID, hf, { x: SIZE, y: 1, z: SIZE }).setFriction(1));
    // Bridge / freeway decks (wherever a road is off the ground) + barriers.
    const net = city.net;
    for (const e of net.edges) {
      if (!e.raised) continue;
      const n = e.px.length;
      let k = 0;
      while (k < n) {
        if (!e.up[k]) {
          k++;
          continue;
        }
        let j = k;
        while (j < n && e.up[j]) j++;
        const a = Math.max(0, k - 3);
        const b = Math.min(n - 1, j + 2);
        // No barriers where ramps join / leave (or at junctions on the deck).
        const gaps = [e.a, e.b].map((id) => net.nodes[id]!).filter((nd) => nd.edges.length > 2 || nd.edges.some((x) => net.edges[x]!.type === 'ramp'));
        this.deck(e, a, b, add, (x, z) => gaps.some((g) => Math.hypot(g.x - x, g.z - z) < 46));
        k = j;
      }
    }
    // Buildings.
    for (const p of city.placements) {
      if (!p.box) continue;
      const q = { x: 0, y: Math.sin(p.yaw / 2), z: 0, w: Math.cos(p.yaw / 2) };
      add(RAPIER.ColliderDesc.cuboid(p.box.hx, p.box.h / 2, p.box.hz).setTranslation(p.x, p.y + p.box.h / 2, p.z).setRotation(q));
    }
    // Edges of the map.
    const wall = (x: number, z: number, hx: number, hz: number) => add(RAPIER.ColliderDesc.cuboid(hx, 60, hz).setTranslation(x, 20, z));
    wall(-HALF, 0, 1, HALF);
    wall(HALF, 0, 1, HALF);
    wall(0, -HALF, HALF, 1);
    wall(0, HALF, HALF, 1);
  }

  /** A deck (trimesh) for samples a…b of an edge, with barriers along both sides. */
  private deck(e: City['net']['edges'][number], a: number, b: number, add: (d: RAPIER.ColliderDesc) => RAPIER.Collider, noRail: (x: number, z: number) => boolean): void {
    const half = e.spec.width / 2 + 0.5;
    const verts: number[] = [];
    const idx: number[] = [];
    for (let k = a; k <= b; k++) {
      const k0 = Math.max(0, k - 1);
      const k1 = Math.min(e.px.length - 1, k + 1);
      let tx = e.px[k1]! - e.px[k0]!;
      let tz = e.pz[k1]! - e.pz[k0]!;
      const l = Math.hypot(tx, tz) || 1;
      tx /= l;
      tz /= l;
      const x = e.px[k]!;
      const y = e.py[k]!;
      const z = e.pz[k]!;
      verts.push(x + tz * half, y, z - tx * half, x - tz * half, y, z + tx * half);
      if (k > a) {
        const i = (k - a) * 2;
        idx.push(i - 2, i - 1, i, i - 1, i + 1, i);
      }
      // Barriers every other sample (cars stay on the bridge / freeway).
      if ((k - a) % 2 === 0 && k < b && !noRail(e.px[k]!, e.pz[k]!)) {
        const nx = e.px[Math.min(b, k + 2)]! - x;
        const nz = e.pz[Math.min(b, k + 2)]! - z;
        const len = Math.hypot(nx, nz);
        if (len < 0.5) continue;
        const yaw = Math.atan2(nx, nz);
        const q = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
        for (const side of [1, -1]) {
          const ox = x + nx / 2 + (-nz / len) * side * (half + 0.15);
          const oz = z + nz / 2 + (nx / len) * side * (half + 0.15);
          add(RAPIER.ColliderDesc.cuboid(0.15, 0.55, len / 2 + 0.05).setTranslation(ox, y + 0.55, oz).setRotation(q));
        }
      }
    }
    add(RAPIER.ColliderDesc.trimesh(new Float32Array(verts), new Uint32Array(idx)).setFriction(1));
  }

  step(dt: number): void {
    this.world.timestep = dt;
    this.world.step();
  }

  /** First static / car hit along a ray. */
  ray(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number, exclude?: RAPIER.RigidBody): { toi: number; collider: RAPIER.Collider } | null {
    const r = new RAPIER.Ray({ x: ox, y: oy, z: oz }, { x: dx, y: dy, z: dz });
    const hit = this.world.castRay(r, max, true, undefined, undefined, undefined, exclude);
    return hit ? { toi: hit.timeOfImpact, collider: hit.collider } : null;
  }
}

export const physics = new Physics();
