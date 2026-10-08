import { BoxGeometry, BufferGeometry, Color, CylinderGeometry, Group, InstancedMesh, Matrix4, Mesh, Object3D, Quaternion, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { LandmarkPlacement } from '@shared/types/track';
import { SeededRandom } from '@shared/math/random';
import type { BuildContext } from '../BuildContext';
import { TrackMaterials } from '../materials';
import { placeSetPiece, roadClearance } from './placement';

const BASE_RADIUS = 14;
const MAX_RUN = 220;
const MIN_RUN = 70;
const PYLONS = 5;
const CABLE_GAP = 2.6;
const WHEEL_HEIGHT = 6;
const HANG = 3.2;
const CLEARANCE = 7.5;
const MAX_PYLON = 26;
const CHAIR_SPACING = 16;
const CHAIR_SPEED = 2.6;
const CHAIR_COLORS = ['#e8413a', '#2f7de0', '#f2b632', '#3fbf6a', '#9a5be0'];

const UP = new Vector3(0, 1, 0);
const SIDE = new Vector3(1, 0, 0);

/** A square beam from a to b. */
function strut(a: Vector3, b: Vector3, w: number): BufferGeometry {
  const dir = b.clone().sub(a);
  const g = new BoxGeometry(w, w, dir.length());
  const m = new Matrix4().lookAt(a, b, Math.abs(dir.normalize().y) > 0.99 ? SIDE : UP);
  m.setPosition(a.clone().add(b).multiplyScalar(0.5));
  return g.applyMatrix4(m);
}

function merge(list: BufferGeometry[]): BufferGeometry {
  return mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)))!;
}

/** Instance a kit model at many transforms: one draw call per sub-mesh. */
function instanceKit(ctx: BuildContext, name: string, height: number, at: Matrix4[], parent: Object3D): void {
  if (!at.length || !ctx.kits.has('holiday', name)) return;
  const o = ctx.kits.instantiate('holiday', name, height);
  o.updateMatrixWorld(true);
  const m = new Matrix4();
  o.traverse((c) => {
    const mesh = c as Mesh;
    if (!mesh.isMesh) return;
    const inst = new InstancedMesh(mesh.geometry, mesh.material, at.length);
    at.forEach((t, i) => inst.setMatrixAt(i, m.multiplyMatrices(t, mesh.matrixWorld)));
    inst.computeBoundingSphere();
    parent.add(inst);
  });
}

/** A lattice chairlift pylon of height h with its crossarm and sheaves (local, base at origin). */
function pylonGeometry(h: number): BufferGeometry[] {
  const parts: BufferGeometry[] = [];
  const corner = (y: number, sx: number, sz: number): Vector3 => {
    const w = 1.5 - (y / h) * 0.95;
    return new Vector3(sx * w, y, sz * w);
  };
  const corners: Array<[number, number]> = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
  for (const [sx, sz] of corners) parts.push(strut(corner(0, sx, sz), corner(h, sx, sz), 0.28));
  const levels = Math.max(3, Math.round(h / 2.6));
  for (let l = 0; l < levels; l++) {
    const y0 = (l / levels) * h;
    const y1 = ((l + 1) / levels) * h;
    for (let c = 0; c < 4; c++) {
      const [ax, az] = corners[c]!;
      const [bx, bz] = corners[(c + 1) % 4]!;
      parts.push(strut(corner(y1, ax, az), corner(y1, bx, bz), 0.16));
      parts.push(strut(corner(y0, ax, az), corner(y1, bx, bz), 0.12));
      parts.push(strut(corner(y0, bx, bz), corner(y1, ax, az), 0.12));
    }
  }
  // Crossarm, sheave trains and a little ladder cage on top.
  parts.push(new BoxGeometry(CABLE_GAP * 2 + 1.6, 0.45, 0.6).translate(0, h + 0.2, 0));
  for (const s of [-1, 1]) {
    parts.push(new BoxGeometry(0.25, 0.25, 2.6).translate(s * CABLE_GAP, h - 0.25, 0));
    for (const z of [-0.8, 0.8]) parts.push(new CylinderGeometry(0.4, 0.4, 0.22, 10).rotateZ(Math.PI / 2).translate(s * CABLE_GAP, h - 0.55, z));
  }
  parts.push(new BoxGeometry(2.6, 0.3, 2.6).translate(0, -0.15, 0).scale(1.2, 1, 1.2));
  return parts;
}

/** Small timber station: walls, snowy gable roof, red wheel canopy. Local origin on the ground. */
function stationParts(width: number, depth: number, wallH: number): { wood: BufferGeometry[]; snow: BufferGeometry[]; trim: BufferGeometry[] } {
  const wood: BufferGeometry[] = [new BoxGeometry(width, wallH, depth).translate(0, wallH / 2, 0)];
  const snow: BufferGeometry[] = [];
  const trim: BufferGeometry[] = [];
  const pitch = 0.5;
  const half = width / 2 + 0.8;
  const slab = half / Math.cos(pitch);
  for (const s of [-1, 1]) {
    const roof = new BoxGeometry(slab, 0.6, depth + 1.6).rotateZ(-s * pitch).translate((s * half) / 2, wallH + (Math.tan(pitch) * half) / 2 + 0.2, 0);
    snow.push(roof);
  }
  // Gable infill, door and windows.
  const side = (width / 2) * Math.SQRT2;
  wood.push(new BoxGeometry(side, side, depth).rotateZ(Math.PI / 4).scale(1, Math.tan(pitch), 1).translate(0, wallH, 0));
  trim.push(new BoxGeometry(1.8, 2.8, 0.3).translate(0, 1.4, depth / 2 + 0.05));
  for (const x of [-width / 3, width / 3]) trim.push(new BoxGeometry(1.4, 1.2, 0.3).translate(x, wallH * 0.62, depth / 2 + 0.05));
  return { wood, snow, trim };
}

/** Bull-wheel terminal: two posts, a canopy and the horizontal wheel the cable turns around. */
function terminalParts(): { steel: BufferGeometry[]; red: BufferGeometry[] } {
  const steel: BufferGeometry[] = [];
  for (const x of [-1.6, 1.6]) steel.push(new BoxGeometry(0.7, WHEEL_HEIGHT + 1.2, 0.7).translate(x, (WHEEL_HEIGHT + 1.2) / 2, -1.5));
  steel.push(new CylinderGeometry(CABLE_GAP + 0.3, CABLE_GAP + 0.3, 0.5, 20).translate(0, WHEEL_HEIGHT, 0));
  steel.push(new CylinderGeometry(0.5, 0.5, 1.4, 10).translate(0, WHEEL_HEIGHT + 0.7, 0));
  const red = [new BoxGeometry(CABLE_GAP * 2 + 3, 0.7, CABLE_GAP * 2 + 4).translate(0, WHEEL_HEIGHT + 1.7, 0), new BoxGeometry(CABLE_GAP * 2 + 2, 1.2, 1).translate(0, WHEEL_HEIGHT + 0.9, -CABLE_GAP - 1.4)];
  return { steel, red };
}

/**
 * Frost Peak chairlift: a base station by the track, lattice pylons climbing the
 * slope to a top station, chairs circling the cable loop, snowmen and pines at the foot.
 */
export function buildSkiLift(ctx: BuildContext, p: LandmarkPlacement): void {
  const spot = placeSetPiece(ctx, p, BASE_RADIUS);
  if (!spot) return;
  const { terrain } = ctx;
  const rng = new SeededRandom(ctx.def.terrain.seed + 311);
  const half = terrain.def.size / 2 - 40;
  const outward = new Vector3(-Math.sin(spot.yaw), 0, -Math.cos(spot.yaw));

  // Pick the climb direction (roughly away from the track) with the longest clear run up the slope.
  let best = { dir: outward, run: 0, score: -Infinity };
  for (let off = -1.2; off <= 1.21; off += 0.2) {
    const dir = outward.clone().applyAxisAngle(UP, off);
    const hut = spot.position.clone().addScaledVector(dir, -9);
    if (roadClearance(ctx, hut.x, hut.z) < 8) continue;
    let run = 0;
    for (let d = 10; d <= MAX_RUN + 12; d += 6) {
      const x = spot.position.x + dir.x * d;
      const z = spot.position.z + dir.z * d;
      if (Math.abs(x - terrain.centerX) > half || Math.abs(z - terrain.centerZ) > half || roadClearance(ctx, x, z) < 9) break;
      run = d - 12;
    }
    const end = spot.position.clone().addScaledVector(dir, run);
    const gain = terrain.sample(end.x, end.z) - spot.position.y;
    const score = Math.min(run, MAX_RUN) + Math.max(-20, gain) * 2 - Math.abs(off) * 25;
    if (run >= MIN_RUN && score > best.score) best = { dir, run, score };
  }
  const run = Math.min(MAX_RUN, best.run);
  const f = best.dir;
  const theta = Math.atan2(f.x, f.z);
  const lat = new Vector3(Math.cos(theta), 0, -Math.sin(theta));
  const world = (d: number, l = 0): Vector3 => spot.position.clone().addScaledVector(f, d).addScaledVector(lat, l);
  const ground = (d: number, l = 0): number => {
    const w = world(d, l);
    return terrain.sample(w.x, w.z) - spot.position.y;
  };

  const g = new Group();
  g.name = 'ski-lift';
  g.position.copy(spot.position);
  g.rotation.y = theta;

  const steel = TrackMaterials.paint('#6a7488');
  const red = TrackMaterials.paint('#e04a36');
  const wood = TrackMaterials.paint('#8a5a3b');
  const snow = TrackMaterials.paint('#f4f8ff');
  const dark = TrackMaterials.paint('#2c2f3a');
  const steelParts: BufferGeometry[] = [];
  const redParts: BufferGeometry[] = [];
  const woodParts: BufferGeometry[] = [];
  const snowParts: BufferGeometry[] = [];
  const trimParts: BufferGeometry[] = [];

  const addStation = (d: number, y: number, w: number, dep: number, wallH: number, back: number, flip = false): void => {
    const s = stationParts(w, dep, wallH);
    const shift = (geo: BufferGeometry): BufferGeometry => geo.rotateY(flip ? Math.PI : 0).translate(0, y, d + back);
    woodParts.push(...s.wood.map(shift), new BoxGeometry(w + 1, 1.2, dep + 1).translate(0, y - 0.4, d + back));
    snowParts.push(...s.snow.map(shift));
    trimParts.push(...s.trim.map(shift));
  };

  const lift = run >= MIN_RUN;
  let cableMesh: Mesh | null = null;
  const supports: Array<{ d: number; y: number }> = [];
  if (lift) {
    // Base terminal in front of the station hut, top terminal at the end of the run.
    const yTop = ground(run);
    const t0 = terminalParts();
    const t1 = terminalParts();
    steelParts.push(...t0.steel.map((x) => x.translate(0, ground(0), 0)), ...t1.steel.map((x) => x.rotateY(Math.PI).translate(0, yTop, run)));
    redParts.push(...t0.red.map((x) => x.translate(0, ground(0), 0)), ...t1.red.map((x) => x.rotateY(Math.PI).translate(0, yTop, run)));
    addStation(0, ground(-9), 12, 8, 5, -9, true);
    addStation(run, yTop, 9, 7, 4.2, 8.5);

    supports.push({ d: 0, y: ground(0) + WHEEL_HEIGHT });
    const heights: number[] = [];
    for (let i = 1; i <= PYLONS; i++) {
      supports.push({ d: (run * i) / (PYLONS + 1), y: 0 });
      heights.push(13 + rng.range(0, 3));
    }
    supports.push({ d: run, y: yTop + WHEEL_HEIGHT });
    // Raise pylons until the chairs clear the snow between every pair of supports.
    const top = (i: number): number => (i === 0 || i === supports.length - 1 ? supports[i]!.y : ground(supports[i]!.d) + heights[i - 1]! - 0.55);
    for (let pass = 0; pass < 6; pass++) {
      for (let i = 0; i < supports.length - 1; i++) {
        const a = supports[i]!;
        const b = supports[i + 1]!;
        const need = HANG + (i === 0 || i === supports.length - 2 ? 2 : CLEARANCE);
        let deficit = 0;
        for (let t = 0.1; t < 0.95; t += 0.1) {
          const cy = top(i) + (top(i + 1) - top(i)) * t;
          deficit = Math.max(deficit, need - (cy - ground(a.d + (b.d - a.d) * t)));
        }
        if (deficit > 0) {
          if (i > 0) heights[i - 1] = Math.min(MAX_PYLON, heights[i - 1]! + deficit);
          if (i + 1 < supports.length - 1) heights[i] = Math.min(MAX_PYLON, heights[i]! + deficit);
        }
      }
    }
    supports.forEach((s, i) => (s.y = top(i)));
    for (let i = 1; i < supports.length - 1; i++) {
      const s = supports[i]!;
      const h = heights[i - 1]!;
      const gy = Math.min(ground(s.d, -1.5), ground(s.d, 1.5)) - 0.3;
      const pyl = pylonGeometry(h + (ground(s.d) - gy));
      steelParts.push(...pyl.map((x) => x.translate(0, gy, s.d)));
    }

    // Cable loop: up one side, round the top wheel, down the other, round the base wheel.
    const loop: Vector3[] = [];
    const arc = (d: number, y: number, from: number, dirSign: number): void => {
      for (let k = 1; k < 8; k++) {
        const a = from + (k / 8) * Math.PI;
        loop.push(new Vector3(Math.cos(a) * CABLE_GAP, y, d + dirSign * Math.sin(a) * CABLE_GAP));
      }
    };
    for (const s of supports) loop.push(new Vector3(CABLE_GAP, s.y, s.d));
    arc(run, supports[supports.length - 1]!.y, 0, 1);
    for (let i = supports.length - 1; i >= 0; i--) loop.push(new Vector3(-CABLE_GAP, supports[i]!.y, supports[i]!.d));
    arc(0, supports[0]!.y, Math.PI, 1);
    const cum = [0];
    for (let i = 0; i < loop.length; i++) cum.push(cum[i]! + loop[i]!.distanceTo(loop[(i + 1) % loop.length]!));
    const total = cum[cum.length - 1]!;
    const cables: BufferGeometry[] = [];
    for (let i = 0; i < loop.length; i++) cables.push(strut(loop[i]!, loop[(i + 1) % loop.length]!, 0.24));
    cableMesh = new Mesh(merge(cables), dark);
    g.add(cableMesh);

    // Chairs: hanger + coloured seat, instanced, moving round the loop.
    const n = Math.max(6, Math.round(total / CHAIR_SPACING));
    const hanger = merge([
      new BoxGeometry(0.16, HANG, 0.16).translate(0, -HANG / 2, 0),
      new BoxGeometry(2.6, 0.14, 0.14).translate(0, -HANG + 0.1, -0.35),
      new BoxGeometry(0.5, 0.35, 0.5).translate(0, -0.1, 0),
      new BoxGeometry(2.2, 0.1, 0.1).translate(0, -HANG - 0.6, 0.75),
    ]);
    const seat = merge([new BoxGeometry(2.5, 0.28, 0.95).translate(0, -HANG - 0.05, 0.05), new BoxGeometry(2.5, 1.0, 0.18).translate(0, -HANG + 0.45, -0.45)]);
    const hangers = new InstancedMesh(hanger, steel, n);
    const seats = new InstancedMesh(seat, TrackMaterials.paint('#ffffff'), n);
    for (let i = 0; i < n; i++) seats.setColorAt(i, new Color(CHAIR_COLORS[i % CHAIR_COLORS.length]!));
    g.add(hangers, seats);
    const pos = new Vector3();
    const q = new Quaternion();
    const one = new Vector3(1, 1, 1);
    const m = new Matrix4();
    let seg = 0;
    const place = (time: number): void => {
      for (let i = 0; i < n; i++) {
        const s = (((time * CHAIR_SPEED + (i * total) / n) % total) + total) % total;
        if (cum[seg]! > s) seg = 0;
        while (cum[seg + 1]! < s) seg++;
        const a = loop[seg]!;
        const b = loop[(seg + 1) % loop.length]!;
        pos.lerpVectors(a, b, (s - cum[seg]!) / Math.max(1e-4, cum[seg + 1]! - cum[seg]!));
        q.setFromAxisAngle(UP, Math.atan2(b.x - a.x, b.z - a.z));
        m.compose(pos, q, one);
        hangers.setMatrixAt(i, m);
        seats.setMatrixAt(i, m);
        seg = 0;
      }
      hangers.instanceMatrix.needsUpdate = true;
      seats.instanceMatrix.needsUpdate = true;
    };
    place(0);
    hangers.computeBoundingSphere();
    seats.computeBoundingSphere();
    hangers.frustumCulled = false;
    seats.frustumCulled = false;
    ctx.updatables.push({ update: (_dt, time) => place(time) });
  } else {
    addStation(0, ground(0), 12, 8, 5, 0, true);
  }

  if (steelParts.length) g.add(new Mesh(merge(steelParts), steel));
  if (redParts.length) g.add(new Mesh(merge(redParts), red));
  g.add(new Mesh(merge(woodParts), wood), new Mesh(merge(snowParts), snow), new Mesh(merge(trimParts), dark));

  // Holiday props at the foot and snowy pines lining the lift line (all off the road).
  const props = new Map<string, Matrix4[]>();
  const put = (name: string, d: number, l: number, yaw: number, size: number): void => {
    const w = world(d, l);
    if (roadClearance(ctx, w.x, w.z) < size + 2) return;
    const list = props.get(name) ?? [];
    list.push(new Matrix4().compose(new Vector3(l, ground(d, l) - 0.15, d), new Quaternion().setFromAxisAngle(UP, yaw), new Vector3(1, 1, 1)));
    props.set(name, list);
  };
  put('snowman-hat', 4, -9, 0.2, 2);
  put('snowman', 6, 8, -0.4, 2);
  put('snowman', -3, 11, 0.6, 2);
  put('sled', 3, -5.5, 0.9, 1.5);
  put('lantern', 2, -4.2, 0, 1);
  put('lantern', 2, 4.2, 0, 1);
  put('lantern', -14, -4, 0, 1);
  put('lantern', -14, 4, 0, 1);
  const trees = ['tree-snow-a', 'tree-snow-b', 'tree-snow-c'];
  const reach = lift ? run : 20;
  for (let i = 0; i < 26; i++) {
    const d = rng.range(-10, reach + 10);
    const side = rng.chance(0.5) ? 1 : -1;
    put(trees[i % 3]!, d, side * rng.range(12, 30), rng.range(0, 6.28), 4);
  }
  const heights: Record<string, number> = { 'snowman-hat': 3.4, snowman: 3, sled: 1.1, lantern: 3, 'tree-snow-a': 11, 'tree-snow-b': 13, 'tree-snow-c': 9 };
  for (const [name, list] of props) instanceKit(ctx, name, heights[name] ?? 3, list, g);
  g.traverse((o) => {
    o.castShadow = o !== cableMesh;
    o.receiveShadow = true;
  });
  ctx.add(g);
  // Keep scattered trees out of the pylons and cables.
  for (let d = 16; lift && d < run; d += 16) {
    const w = world(d);
    ctx.footprints.push({ x: w.x, z: w.z, r: 7 });
  }
}
