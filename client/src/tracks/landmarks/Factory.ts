import { Group, IcosahedronGeometry, Mesh, MeshStandardMaterial, Vector3, type Object3D } from 'three';
import type { LandmarkPlacement } from '@shared/types/track';
import { SeededRandom } from '@shared/math/random';
import type { BuildContext } from '../BuildContext';
import type { KitId } from '../kits';
import { roadClearance } from './placement';

interface Piece {
  kit: KitId;
  name: string;
  /** Target height (m) range. */
  height: [number, number];
  /** Footprint radius at that height, roughly (for spacing). */
  radius: number;
  weight: number;
}

const BUILDINGS: Piece[] = [
  { kit: 'industrial', name: 'building-a', height: [22, 30], radius: 20, weight: 2 },
  { kit: 'industrial', name: 'building-d', height: [24, 34], radius: 16, weight: 2 },
  { kit: 'industrial', name: 'building-g', height: [20, 28], radius: 18, weight: 2 },
  { kit: 'industrial', name: 'building-k', height: [12, 16], radius: 16, weight: 1.5 },
  { kit: 'industrial', name: 'building-n', height: [30, 40], radius: 14, weight: 1.5 },
  { kit: 'industrial', name: 'building-r', height: [20, 26], radius: 24, weight: 1.5 },
  { kit: 'industrial', name: 'detail-tank-large', height: [10, 14], radius: 11, weight: 1.5 },
  { kit: 'industrial', name: 'water-tower', height: [24, 30], radius: 7, weight: 0.8 },
  { kit: 'industrial', name: 'shipping-container-a', height: [3, 3.4], radius: 5, weight: 1.2 },
  { kit: 'industrial', name: 'shipping-container-b', height: [3, 3.4], radius: 5, weight: 1.2 },
  { kit: 'industrial', name: 'shipping-container-c', height: [3, 3.4], radius: 5, weight: 1.2 },
];
const MACHINES: Piece[] = [
  { kit: 'factory', name: 'crane', height: [16, 22], radius: 9, weight: 1 },
  { kit: 'factory', name: 'robot-arm-a', height: [9, 12], radius: 3, weight: 1.4 },
  { kit: 'factory', name: 'robot-arm-b', height: [9, 12], radius: 3, weight: 1.4 },
  { kit: 'factory', name: 'hopper-high-round', height: [10, 14], radius: 6, weight: 1 },
  { kit: 'factory', name: 'machine-fortified', height: [6, 8], radius: 5, weight: 1 },
  { kit: 'factory', name: 'machine', height: [6, 8], radius: 5, weight: 1 },
  { kit: 'factory', name: 'box-large', height: [2.4, 3], radius: 3, weight: 1.2 },
];

function pickWeighted(rng: SeededRandom, list: Piece[]): Piece {
  let x = rng.next() * list.reduce((a, p) => a + p.weight, 0);
  for (const p of list) if ((x -= p.weight) <= 0) return p;
  return list[0]!;
}

/**
 * Clockwork Factory: a brick-and-steel works packed round the circuit — sheds,
 * tanks and container stacks, smoking chimneys, giant cogs turning on gantries,
 * robot arms swinging and conveyors full of crates beside the road.
 */
export function buildFactoryYard(ctx: BuildContext, _p: LandmarkPlacement): void {
  const { path, terrain } = ctx;
  const rng = new SeededRandom(ctx.def.terrain.seed + 404);
  const half = terrain.def.size / 2 - 30;
  const placed: Array<{ x: number; z: number; r: number }> = [];
  const spin: Array<{ o: Object3D; speed: number; axis: 'x' | 'y' | 'z' }> = [];
  const swing: Array<{ o: Object3D; phase: number }> = [];
  const smokers: Vector3[] = [];

  /** A free spot `out` metres beyond a random sample's wall, or null. */
  const spot = (out: number, r: number): { x: number; z: number; yaw: number } | null => {
    const s = path.samples[rng.int(0, path.samples.length - 1)]!;
    const side = rng.chance(0.5) ? 1 : -1;
    const x = s.position.x + s.flatRight.x * side * (s.wallOffset + out + r);
    const z = s.position.z + s.flatRight.z * side * (s.wallOffset + out + r);
    if (Math.abs(x - terrain.centerX) > half || Math.abs(z - terrain.centerZ) > half) return null;
    if (roadClearance(ctx, x, z) < r + 3) return null;
    if (placed.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + r + 2)) return null;
    if (ctx.footprints.some((f) => Math.hypot(f.x - x, f.z - z) < f.r + r)) return null;
    placed.push({ x, z, r });
    // Face the road.
    return { x, z, yaw: Math.atan2(-s.flatRight.x * side, -s.flatRight.z * side) };
  };
  const put = (piece: Piece, at: { x: number; z: number; yaw: number }): Object3D => {
    const o = ctx.kits.instantiate(piece.kit, piece.name, rng.range(piece.height[0], piece.height[1]));
    o.position.set(at.x, terrain.sample(at.x, at.z) - 0.2, at.z);
    // Buildings face the road; machines and containers sit square or across.
    o.rotation.y = at.yaw + (piece.name.startsWith('building') || rng.chance(0.5) ? 0 : Math.PI / 2);
    ctx.add(o);
    return o;
  };

  // Sheds, tanks and containers (big first, packed tighter near the road).
  for (let i = 0, made = 0; i < 900 && made < 46; i++) {
    const piece = pickWeighted(rng, BUILDINGS);
    const at = spot(4 + Math.pow(rng.next(), 1.5) * 150, piece.radius);
    if (!at) continue;
    put(piece, at);
    made++;
    if (piece.name.startsWith('shipping')) {
      // Stack containers two or three high.
      for (let k = 1; k < rng.int(1, 3); k++) {
        const c = put(rng.pick(BUILDINGS.filter((b) => b.name.startsWith('shipping'))), at);
        c.position.y += k * 3.2;
        c.rotation.y += rng.range(-0.2, 0.2);
      }
    }
  }
  // Chimney stacks with smoke.
  for (let i = 0, made = 0; i < 400 && made < 9; i++) {
    const at = spot(20 + rng.next() * 140, 7);
    if (!at) continue;
    const h = rng.range(34, 52);
    const o = ctx.kits.instantiate('industrial', rng.chance(0.6) ? 'chimney-large' : 'chimney-medium', h);
    o.position.set(at.x, terrain.sample(at.x, at.z) - 0.3, at.z);
    ctx.add(o);
    smokers.push(new Vector3(at.x, o.position.y + h, at.z));
    made++;
  }
  // Machines and robot arms close to the walls.
  for (let i = 0, made = 0; i < 600 && made < 26; i++) {
    const piece = pickWeighted(rng, MACHINES);
    const at = spot(2 + rng.next() * 18, piece.radius);
    if (!at) continue;
    const o = put(piece, at);
    if (piece.name.startsWith('robot')) swing.push({ o, phase: rng.range(0, 6.28) });
    made++;
  }
  // Giant cogs standing on edge beside the road, turning in meshing pairs.
  const cogNames = ['cog-a', 'cog-b', 'cog-c', 'cog-d', 'cog-e'];
  for (let i = 0, made = 0; i < 400 && made < 10; i++) {
    const size = rng.range(12, 22);
    const at = spot(3 + rng.next() * 12, size * 0.55);
    if (!at) continue;
    const group = new Group();
    group.position.set(at.x, terrain.sample(at.x, at.z) + size * 0.5 + 1.5, at.z);
    group.rotation.y = at.yaw + Math.PI / 2;
    for (const [k, offset] of [[0, 0], [1, size * 0.86]] as const) {
      if (k === 1 && rng.chance(0.4)) break;
      const holder = new Group();
      holder.position.x = offset;
      const cog = ctx.kits.instantiate('factory', rng.pick(cogNames));
      const unit = ctx.kits.size('factory', 'cog-a').x;
      cog.scale.setScalar((size * (k ? 0.75 : 1)) / unit);
      cog.position.y = -cog.scale.y * 0.11;
      const wheel = new Group();
      wheel.rotation.x = Math.PI / 2;
      wheel.add(cog);
      holder.add(wheel);
      group.add(holder);
      spin.push({ o: holder, speed: (k ? -1.33 : 1) * rng.range(0.25, 0.5), axis: 'z' });
    }
    // A steel post behind the hub.
    const post = ctx.kits.instantiate('factory', 'structure-tall', size * 0.5 + 2);
    post.position.set(0, -(size * 0.5 + 1.5), -1);
    group.add(post);
    ctx.add(group);
    made++;
  }
  // Conveyor runs with crates riding along them.
  const crates: Array<{ o: Object3D; from: Vector3; to: Vector3; phase: number }> = [];
  for (let i = 0, made = 0; i < 300 && made < 6; i++) {
    const at = spot(1.5 + rng.next() * 4, 5);
    if (!at) continue;
    const dir = new Vector3(Math.cos(at.yaw), 0, -Math.sin(at.yaw));
    const segs = 5;
    const unit = 4;
    for (let k = 0; k < segs; k++) {
      const c = ctx.kits.instantiate('factory', 'conveyor-long-stripe-sides');
      c.scale.setScalar(unit / 2);
      const p = new Vector3(at.x, 0, at.z).addScaledVector(dir, (k - segs / 2) * unit);
      c.position.set(p.x, terrain.sample(p.x, p.z) + 0.6, p.z);
      c.rotation.y = at.yaw + Math.PI / 2;
      ctx.add(c);
    }
    const from = new Vector3(at.x, 0, at.z).addScaledVector(dir, (-segs / 2) * unit);
    const to = new Vector3(at.x, 0, at.z).addScaledVector(dir, (segs / 2 - 1) * unit);
    from.y = terrain.sample(from.x, from.z) + 1.4;
    to.y = terrain.sample(to.x, to.z) + 1.4;
    for (let k = 0; k < 4; k++) {
      const box = ctx.kits.instantiate('factory', rng.chance(0.5) ? 'box-small' : 'box-wide', 1.4);
      ctx.add(box);
      crates.push({ o: box, from, to, phase: k / 4 });
    }
    made++;
  }

  // Smoke puffs drifting up from every chimney.
  const smokeMat = new MeshStandardMaterial({ color: '#8a8078', roughness: 1, flatShading: true, transparent: true, opacity: 0.7 });
  const puffs: Array<{ m: Mesh; src: Vector3; phase: number }> = [];
  const puffGeo = new IcosahedronGeometry(1, 1);
  for (const src of smokers) {
    for (let k = 0; k < 6; k++) {
      const m = new Mesh(puffGeo, smokeMat);
      ctx.add(m);
      puffs.push({ m, src, phase: k / 6 });
    }
  }

  ctx.updatables.push({
    update: (dt, time) => {
      for (const s of spin) s.o.rotation[s.axis] += dt * s.speed;
      for (const s of swing) s.o.rotation.y = Math.sin(time * 0.8 + s.phase) * 0.9 + s.phase;
      for (const c of crates) {
        const t = (time * 0.12 + c.phase) % 1;
        c.o.position.lerpVectors(c.from, c.to, t);
      }
      for (const p of puffs) {
        const k = (time * 0.09 + p.phase) % 1;
        p.m.position.set(p.src.x + k * 18, p.src.y + k * 40, p.src.z + Math.sin(k * 6 + p.phase * 9) * 4);
        p.m.scale.setScalar(2.5 + k * 9);
      }
    },
  });
}
