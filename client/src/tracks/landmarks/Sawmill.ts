import { BoxGeometry, ConeGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, PlaneGeometry, Vector3, type Object3D } from 'three';
import type { LandmarkPlacement } from '@shared/types/track';
import { SeededRandom } from '@shared/math/random';
import type { BuildContext } from '../BuildContext';
import { TrackMaterials } from '../materials';
import { placeSetPiece } from './placement';
import { Batch, finish, fireAt, groundFn, groundRange, kit, kitName, lagoon, rockGeometry, signTexture, xf } from './Coast';

const RADIUS = 25;
const HOUSE_W = 9;
const HOUSE_D = 11;
/** Water-wheel diameter. */
const WHEEL_D = 11;

/** Timber-framed mill house: stone plinth, plaster walls, dark beams, gabled roof, chimney and a name board. */
function millHouse(b: Batch, g: Group, x: number, y: number, z: number, name: string): void {
  const W = HOUSE_W;
  const D = HOUSE_D;
  const WALL = 7;
  const at = (dx: number, dy: number, dz: number, ry = 0): ReturnType<typeof xf> => xf(x + dx, y + dy, z + dz, ry);
  b.add(new BoxGeometry(W + 0.4, 1.4, D + 0.4).translate(0, 0.7, 0), '#8f897e', at(0, 0, 0));
  b.add(new BoxGeometry(W, WALL - 1.4, D).translate(0, (WALL + 1.4) / 2, 0), '#f4ecd8', at(0, 0, 0));
  // Beams: corner posts, a mid band and diagonal braces on the long walls.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) b.add(new BoxGeometry(0.5, WALL - 1.4, 0.5).translate(0, (WALL + 1.4) / 2, 0), '#6a4428', at((sx * W) / 2, 0, (sz * D) / 2));
  }
  b.add(new BoxGeometry(W + 0.3, 0.4, D + 0.3).translate(0, 4.2, 0), '#6a4428', at(0, 0, 0));
  b.add(new BoxGeometry(W + 0.3, 0.4, D + 0.3).translate(0, WALL, 0), '#6a4428', at(0, 0, 0));
  // Gables (plaster) and roof.
  const r = (W / 2 + 1.2) / 0.866;
  b.add(new CylinderGeometry(W / 2 / 0.866, W / 2 / 0.866, D, 3).rotateX(-Math.PI / 2).scale(1, 0.5, 1).translate(0, WALL + (W / 2 / 0.866) * 0.25, 0), '#f4ecd8', at(0, 0, 0));
  b.add(new CylinderGeometry(r, r, D + 1.6, 3, 1, true).rotateX(-Math.PI / 2).scale(1, 0.5, 1).translate(0, WALL + r * 0.25 - 0.25, 0), '#b8483a', at(0, 0, 0));
  b.add(new BoxGeometry(0.5, 0.5, D + 1.8).translate(0, WALL + r * 0.75 - 0.25, 0), '#7a2f28', at(0, 0, 0));
  b.add(new BoxGeometry(1.4, 4, 1.4).translate(0, WALL + 2.6, 0), '#8f897e', at(-W / 4, 0, -D / 4));
  b.add(new BoxGeometry(1.7, 0.4, 1.7).translate(0, WALL + 4.6, 0), '#6f6a62', at(-W / 4, 0, -D / 4));
  // Door, windows with shutters (front +Z and west -X).
  b.add(new BoxGeometry(2.2, 3.2, 0.3).translate(0, 3.0, 0), '#5a3a28', at(-1.5, 0, D / 2 + 0.05));
  b.add(new BoxGeometry(2.6, 0.3, 0.5).translate(0, 4.7, 0), '#6a4428', at(-1.5, 0, D / 2 + 0.1));
  for (const [wx, wy, wz, ry] of [
    [2.3, 3.2, D / 2 + 0.05, 0],
    [0, 5.6, D / 2 + 0.05, 0],
    [-W / 2 - 0.05, 3.2, -2, Math.PI / 2],
    [-W / 2 - 0.05, 3.2, 2.5, Math.PI / 2],
  ] as const) {
    b.add(new BoxGeometry(1.3, 1.3, 0.2).translate(0, wy, 0), '#2f3b52', at(wx, 0, wz, ry));
    b.add(new BoxGeometry(0.5, 1.4, 0.15).translate(-0.95, wy, 0.1), '#3f7a4a', at(wx, 0, wz, ry));
    b.add(new BoxGeometry(0.5, 1.4, 0.15).translate(0.95, wy, 0.1), '#3f7a4a', at(wx, 0, wz, ry));
  }
  const board = new Mesh(new PlaneGeometry(5, 1.25), new MeshStandardMaterial({ map: signTexture(name, '#6a4428', '#ffe6b0'), roughness: 0.8 }));
  board.position.set(x, y + WALL + 1.2, z + D / 2 + 0.75);
  g.add(board);
}

/** Circular saw blade (disc with teeth), axle along local X. */
function bladeMesh(r: number): Mesh {
  const b = new Batch();
  b.add(new CylinderGeometry(r, r, 0.08, 28).rotateZ(Math.PI / 2), '#c8ced8');
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    b.add(new ConeGeometry(0.16, 0.42, 3).rotateZ(Math.PI / 2).rotateX(Math.PI / 2), '#e8ecf2', xf(0, Math.sin(a) * (r + 0.12), Math.cos(a) * (r + 0.12), 0, -a));
  }
  b.add(new CylinderGeometry(0.35, 0.35, 0.3, 10).rotateZ(Math.PI / 2), '#e8413a');
  return b.build(new MeshStandardMaterial({ vertexColors: true, metalness: 0.6, roughness: 0.3 }));
}

/** A pyramid of logs (3-2-1 rows), axis along local Z. */
function logPile(ctx: BuildContext, g: Group, ground: (x: number, z: number) => number, x: number, z: number, yaw: number, len: number): void {
  const name = kitName(ctx, 'survival', 'tree-log');
  if (!name) return;
  const size = ctx.kits.size('survival', name);
  const k = len / size.z;
  const d = size.x * k;
  const y0 = groundRange(ground, x, z, len, d * 3).min - 0.1;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 3 - row; i++) {
      const lx = (i - (2 - row) / 2) * d * 0.98;
      const o = ctx.kits.instantiate('survival', name);
      o.scale.setScalar(k);
      o.position.set(x + lx * c, y0 + row * d * 0.86, z - lx * s);
      o.rotation.y = yaw;
      g.add(o);
    }
  }
}

/** Water channel (flume) on trestles, its water scrolling towards the wheel. */
function flume(b: Batch, from: Vector3, to: Vector3, ground: (x: number, z: number) => number): Mesh {
  const dir = to.clone().sub(from);
  const len = dir.length();
  const yaw = Math.atan2(dir.x, dir.z);
  const pitch = Math.asin(dir.y / len);
  const mid = from.clone().add(to).multiplyScalar(0.5);
  const m = xf(mid.x, mid.y, mid.z, yaw, -pitch);
  b.add(new BoxGeometry(1.8, 0.2, len), '#8a5a3b', m);
  b.add(new BoxGeometry(0.2, 0.8, len).translate(-0.9, 0.4, 0), '#8a5a3b', m);
  b.add(new BoxGeometry(0.2, 0.8, len).translate(0.9, 0.4, 0), '#8a5a3b', m);
  // Trestles: paired legs with a cross beam and an X brace.
  for (const t of [0.12, 0.45, 0.78]) {
    const p = from.clone().lerp(to, t);
    const gy = ground(p.x, p.z) - 0.3;
    const h = p.y - gy;
    const at = xf(p.x, 0, p.z, yaw);
    b.add(new BoxGeometry(0.3, h, 0.3).translate(-1.1, (p.y + gy) / 2, 0), '#6a4428', at);
    b.add(new BoxGeometry(0.3, h, 0.3).translate(1.1, (p.y + gy) / 2, 0), '#6a4428', at);
    b.add(new BoxGeometry(2.6, 0.3, 0.35).translate(0, p.y - 0.2, 0), '#6a4428', at);
    const brace = Math.hypot(2.2, h * 0.6);
    const ang = Math.atan2(2.2, h * 0.6);
    for (const sgn of [-1, 1]) b.add(new BoxGeometry(0.18, brace, 0.18).rotateZ(sgn * ang).translate(0, gy + h * 0.45, 0), '#7a5232', at);
  }
  const water = new Mesh(new BoxGeometry(1.4, 0.1, len), new MeshStandardMaterial({ color: '#5ac8f0', emissive: '#2a8ab8', emissiveIntensity: 0.35, roughness: 0.2 }));
  water.position.copy(mid).add(new Vector3(0, 0.25, 0));
  water.rotation.set(-pitch, yaw, 0, 'YXZ');
  return water;
}

/**
 * Riverside sawmill. Variant 0: a lumber camp — mill house with a turning water
 * wheel fed by a flume, log piles, a spinning saw bench, tents and a campfire.
 * Variant 1: a wide mill beside a pond, its wheel turning, fences and lanterns.
 */
export function buildSawmill(ctx: BuildContext, p: LandmarkPlacement): void {
  const spot = placeSetPiece(ctx, p, RADIUS);
  if (!spot) return;
  const variant = Number(p.params?.variant ?? 0);
  const rng = new SeededRandom(ctx.def.terrain.seed + 866 + variant);
  const ground = groundFn(ctx, spot.position, spot.yaw);
  const g = new Group();
  g.name = `sawmill-${variant}`;
  g.position.copy(spot.position);
  g.rotation.y = spot.yaw;
  const b = new Batch();
  const spinners: Array<{ o: Object3D; speed: number }> = [];

  // Mill house on a stone footing, the kit water wheel turning against its east (+X) wall.
  const MX = -8;
  const MZ = -8;
  const millRange = groundRange(ground, MX, MZ, HOUSE_W + 8, HOUSE_D + 2);
  const footY = millRange.max + 0.6;
  b.add(new BoxGeometry(HOUSE_W + 1, footY - millRange.min + 1, HOUSE_D + 1).translate(0, -(footY - millRange.min + 1) / 2, 0), '#9a948a', xf(MX, footY, MZ));
  millHouse(b, g, MX, footY, MZ, variant === 0 ? 'SAWMILL' : 'OLD MILL');
  const wheelName = kitName(ctx, 'town', variant === 0 ? 'watermill' : 'watermill-wide') ?? kitName(ctx, 'town', 'watermill');
  let thick = 5;
  const wz = MZ + 0.5;
  let wx = MX + HOUSE_W / 2 + thick / 2;
  const hubY = footY + WHEEL_D / 2 - 0.9;
  if (wheelName) {
    const size = ctx.kits.size('town', wheelName);
    thick = (size.x * WHEEL_D) / size.y;
    wx = MX + HOUSE_W / 2 + thick / 2 + 0.2;
    const pivot = new Group();
    pivot.position.set(wx, hubY, wz);
    const wheel = ctx.kits.instantiate('town', wheelName, WHEEL_D);
    wheel.position.y = -WHEEL_D / 2;
    pivot.add(wheel);
    g.add(pivot);
    spinners.push({ o: pivot, speed: -0.45 });
  }
  // Wheel pit (stone trough with water) and the axle into the house.
  const pitLow = groundRange(ground, wx, wz, thick + 2, WHEEL_D + 2).min - 0.5;
  b.add(new BoxGeometry(thick + 1.6, footY - pitLow, WHEEL_D + 1.4).translate(0, (footY + pitLow) / 2 - 0.2, 0), '#8a847a', xf(wx, 0, wz));
  b.add(new BoxGeometry(thick + 0.6, 0.1, WHEEL_D + 0.6), '#4ab0e0', xf(wx, footY - 0.12, wz));
  b.add(new CylinderGeometry(0.5, 0.5, thick + 1.4, 8).rotateZ(Math.PI / 2), '#4a3a2a', xf(wx - 0.4, hubY, wz));

  // Flume carrying water onto the top of the wheel.
  const flumeEnd = new Vector3(wx, hubY + WHEEL_D / 2 + 0.5, wz - 1.6);
  const flumeStart = new Vector3(wx + 1, Math.max(flumeEnd.y + 1.2, ground(wx + 1, MZ - 18) + 2.5), MZ - 18);
  const flumeWater = flume(b, flumeStart, flumeEnd, ground);
  g.add(flumeWater);
  const spill = new Mesh(new BoxGeometry(1.3, 1.4, 0.25), flumeWater.material);
  spill.position.set(flumeEnd.x, flumeEnd.y - 0.5, flumeEnd.z + 0.2);
  g.add(spill);

  if (variant === 0) {
    // Lumber camp.
    logPile(ctx, g, ground, 10, -10, 0.1, 7);
    logPile(ctx, g, ground, 16, -2, 0.5, 6);
    logPile(ctx, g, ground, -16, 6, -0.3, 6.5);
    for (let i = 0; i < 6; i++) {
      const x = rng.range(4, 14);
      const z = rng.range(-2, 8);
      kit(ctx, g, 'survival', 'resource-wood', 1.0, x, ground(x, z), z, rng.range(0, 6.28));
    }
    // Saw bench with a big spinning blade cutting a log.
    const SX = 4;
    const SZ = 4;
    const sy = ground(SX, SZ);
    const sLow = groundRange(ground, SX, SZ, 3, 7).min - sy - 0.3;
    b.add(new BoxGeometry(2.6, 1.3 - sLow, 7).translate(0, (1.3 + sLow) / 2, 0), '#8a5a3b', xf(SX, sy, SZ, 0.3));
    b.add(new BoxGeometry(3.0, 0.2, 7.4).translate(0, 1.35, 0), '#a8784a', xf(SX, sy, SZ, 0.3));
    b.add(new CylinderGeometry(0.75, 0.75, 6, 10).rotateX(Math.PI / 2).translate(0.9, 2.2, -1), '#b8875a', xf(SX, sy, SZ, 0.3));
    b.add(new BoxGeometry(0.25, 1.6, 0.25).translate(-0.6, 2.2, 1.4), '#e8413a', xf(SX, sy, SZ, 0.3));
    const blade = new Group();
    blade.position.set(SX + Math.cos(0.3) * -0.6 + Math.sin(0.3) * 1.4, sy + 1.6, SZ + Math.cos(0.3) * 1.4 + Math.sin(0.3) * 0.6);
    blade.rotation.y = 0.3;
    const disc = bladeMesh(1.7);
    blade.add(disc);
    g.add(blade);
    spinners.push({ o: disc, speed: 14 });
    // Tents, campfire, signpost.
    kit(ctx, g, 'survival', 'tent-canvas', 3.6, -14, ground(-14, -6) - 0.1, -6, 0.9);
    kit(ctx, g, 'survival', 'tent-canvas', 3.6, -18, ground(-18, 2) - 0.1, 2, 1.6);
    kit(ctx, g, 'survival', 'campfire-pit', 0.8, -9, ground(-9, 4), 4, 0);
    fireAt(ctx, g, -9, ground(-9, 4) + 0.35, 4);
    for (const [lx, lz, a] of [
      [-11, 5.5, 0.4],
      [-7.2, 5.4, -0.5],
    ] as const) {
      b.add(new CylinderGeometry(0.4, 0.4, 2.2, 8).rotateZ(Math.PI / 2), '#8a5a3b', xf(lx, ground(lx, lz) + 0.4, lz, a));
    }
    kit(ctx, g, 'survival', 'signpost', 3, 8, ground(8, 14) - 0.1, 14, 0.2);
    kit(ctx, g, 'survival', 'barrel', 1.3, -3, ground(-3, 2), 2, 0);
    kit(ctx, g, 'survival', 'box-large', 1.2, -1.5, ground(-1.5, 3.2), 3.2, 0.4);
    // Plank stacks.
    for (let i = 0; i < 5; i++) b.add(new BoxGeometry(1.2, 0.18, 5), i % 2 ? '#d9a86a' : '#c99a5a', xf(12, ground(12, 9) + 0.1 + i * 0.2, 9, 1.2 + i * 0.04));
  } else {
    // Mill pond with fences and lanterns.
    const PX = 12;
    const PZ = 4;
    const PR = 8;
    const pondY = groundRange(ground, PX, PZ, PR * 2 + 2, PR * 2 + 2).max + 0.25;
    lagoon(g, ground, PX, PZ, PR, pondY, [], { deep: '#1f86b8', shallow: '#7fe2f2', wet: '#7d8a6a', dry: ctx.def.terrain.palette.grassA });
    // Tail race from the wheel pit to the pond.
    b.add(new BoxGeometry(2.2, 0.12, Math.hypot(PX - wx, PZ - wz)), '#4ab0e0', xf((wx + PX) / 2, Math.max(footY - 0.3, pondY) + 0.05, (wz + PZ) / 2, Math.atan2(PX - wx, PZ - wz)));
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const x = PX + Math.sin(a) * (PR + 1.5);
      const z = PZ + Math.cos(a) * (PR + 1.5);
      b.add(rockGeometry(rng, rng.range(0.8, 1.5), 1, 0.7, 1), rng.pick(['#8a8478', '#a09888']), xf(x, ground(x, z) + 0.2, z));
    }
    // Lily pads.
    for (let i = 0; i < 6; i++) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(2, PR - 1.5);
      b.add(new CylinderGeometry(0.8, 0.8, 0.06, 8), '#4fae46', xf(PX + Math.sin(a) * d, pondY + 0.05, PZ + Math.cos(a) * d));
    }
    // Fence run along the front.
    const fenceName = kitName(ctx, 'town', 'fence');
    if (fenceName) {
      const fs = ctx.kits.size('town', fenceName);
      const k = 1.6 / fs.y;
      const span = fs.z * k;
      for (let x = -20; x < 0; x += span) {
        const z = 12;
        kit(ctx, g, 'town', 'fence', 1.6, x + span / 2, ground(x + span / 2, z) - 0.05, z, Math.PI / 2);
      }
    }
    for (const [lx, lz] of [
      [-21, 12],
      [1, 12],
      [PX - PR - 2, PZ + 6],
      [PX + PR + 1, PZ - 4],
    ] as const) {
      kit(ctx, g, 'town', 'lantern', 3.4, lx, ground(lx, lz) - 0.05, lz, 0);
      const glow = new Mesh(new CylinderGeometry(0.22, 0.22, 0.5, 6), TrackMaterials.emissive('#ffd27a', 3));
      glow.position.set(lx, ground(lx, lz) + 2.9, lz);
      g.add(glow);
    }
    kit(ctx, g, 'town', 'cart', 2.2, -16, ground(-16, 4) - 0.05, 4, 0.7);
    logPile(ctx, g, ground, -18, -6, 0.2, 6);
    kit(ctx, g, 'town', 'tree-high-round', 11, 20, ground(20, -10) - 0.2, -10, 0);
    kit(ctx, g, 'town', 'tree-crooked', 9, -20, ground(-20, -14) - 0.2, -14, 1.2);
  }
  g.add(b.build(TrackMaterials.vertexColor()));
  finish(g);
  ctx.add(g);

  const water = flumeWater.material as MeshStandardMaterial;
  ctx.updatables.push({
    update: (dt, time) => {
      for (const sp of spinners) sp.o.rotation.x += dt * sp.speed;
      water.emissiveIntensity = 0.35 + Math.sin(time * 6) * 0.08;
    },
  });
}
