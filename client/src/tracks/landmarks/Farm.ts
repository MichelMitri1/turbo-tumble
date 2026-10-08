import {
  BoxGeometry,
  BufferAttribute,
  Color,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  RingGeometry,
  Shape,
  SphereGeometry,
  type BufferGeometry,
  type Object3D,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { LandmarkPlacement } from '@shared/types/track';
import { Noise2D } from '@shared/math/noise';
import type { BuildContext } from '../BuildContext';
import { TrackMaterials } from '../materials';
import { bakeStatic } from './Castle';
import { placeSetPiece } from './placement';

const RADIUS = 35;
/** Barn body: half width, wall height, depth; front gable faces the track. */
const BARN_HW = 8;
const BARN_WALL = 9;
const BARN_D = 22;
const BARN_Z = -4;
const RED = '#c8352c';
const RED_DARK = '#9c2a24';
const TRIM = '#fbf6ec';
const ROOF = '#4d4f5c';
const IRON = '#2d2d34';
const FENCE_Z = 24;

/** Flat vertex colour on a non-indexed copy of `geo`, ready for merging into one vertex-coloured mesh. */
function tint(geo: BufferGeometry, color: Color | string): BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new Color(color);
  const n = g.getAttribute('position').count;
  const data = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) data.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new BufferAttribute(data, 3));
  return g;
}

/** Box from (x, y, z) centre and size, optionally rolled about z. */
function box(w: number, h: number, d: number, x: number, y: number, z: number, color: string, rollZ = 0): BufferGeometry {
  const g = new BoxGeometry(w, h, d);
  if (rollZ) g.rotateZ(rollZ);
  g.translate(x, y, z);
  return tint(g, color);
}

/** White frame with an X brace on a face at depth z (door / hayloft). */
function bracedPanel(parts: BufferGeometry[], cx: number, cy: number, w: number, h: number, z: number, fill: string): void {
  const t = 0.35;
  parts.push(box(w, h, 0.2, cx, cy, z, fill));
  parts.push(box(w + t, t, 0.4, cx, cy + h / 2, z + 0.1, TRIM), box(w + t, t, 0.4, cx, cy - h / 2, z + 0.1, TRIM));
  parts.push(box(t, h, 0.4, cx - w / 2, cy, z + 0.1, TRIM), box(t, h, 0.4, cx + w / 2, cy, z + 0.1, TRIM));
  const diag = Math.hypot(w, h) - t;
  const ang = Math.atan2(h, w);
  parts.push(box(diag, t * 0.8, 0.3, cx, cy, z + 0.15, TRIM, ang), box(diag, t * 0.8, 0.3, cx, cy, z + 0.15, TRIM, -ang));
}

/** Little red tractor (local origin at its footprint centre, facing +x). */
function tractor(parts: BufferGeometry[]): void {
  parts.push(box(2.4, 1.1, 1.2, 0.3, 1.25, 0, '#d8402e'));
  parts.push(box(1.4, 0.9, 1.0, 1.6, 1.15, 0, '#d8402e'));
  parts.push(box(0.2, 0.7, 0.9, 2.32, 1.1, 0, '#3b3b44'));
  parts.push(box(0.8, 0.12, 1.4, -0.5, 3.1, 0, '#f2f2ea'));
  for (const [x, z] of [[-0.85, -0.6], [-0.85, 0.6], [-0.15, -0.6], [-0.15, 0.6]] as const) parts.push(box(0.1, 1.3, 0.1, x, 2.45, z, IRON));
  parts.push(box(0.5, 0.25, 0.6, -0.5, 1.95, 0, IRON));
  const pipe = new CylinderGeometry(0.08, 0.08, 1.1, 6);
  pipe.translate(1.6, 2.1, 0.35);
  parts.push(tint(pipe, IRON));
  for (const side of [-1, 1]) {
    const rear = new CylinderGeometry(0.95, 0.95, 0.55, 12);
    rear.rotateX(Math.PI / 2);
    rear.translate(-0.5, 0.95, side * 0.9);
    const rearHub = new CylinderGeometry(0.42, 0.42, 0.6, 8);
    rearHub.rotateX(Math.PI / 2);
    rearHub.translate(-0.5, 0.95, side * 0.92);
    const front = new CylinderGeometry(0.5, 0.5, 0.35, 10);
    front.rotateX(Math.PI / 2);
    front.translate(1.7, 0.5, side * 0.7);
    const frontHub = new CylinderGeometry(0.22, 0.22, 0.4, 6);
    frontHub.rotateX(Math.PI / 2);
    frontHub.translate(1.7, 0.5, side * 0.72);
    parts.push(tint(rear, '#26262c'), tint(rearHub, '#ffcf3a'), tint(front, '#26262c'), tint(frontHub, '#ffcf3a'));
  }
}

/**
 * Harvest Lane farmstead: a big red gambrel barn with white trim, X-braced doors
 * and a hayloft, a domed silo, a kit farmhouse, hay bales, fences round a dirt
 * yard, a little tractor puffing smoke and a weather vane swinging on the ridge.
 */
export function buildBarn(ctx: BuildContext, p: LandmarkPlacement): void {
  const spot = placeSetPiece(ctx, p, RADIUS);
  if (!spot) return;
  const { kits, terrain } = ctx;
  const g = new Group();
  g.name = 'barn';
  g.position.copy(spot.position);
  g.rotation.y = spot.yaw;
  const cos = Math.cos(spot.yaw);
  const sin = Math.sin(spot.yaw);
  /** Ground height (relative to the group) under a local point. */
  const groundAt = (x: number, z: number): number =>
    terrain.sample(spot.position.x + x * cos + z * sin, spot.position.z - x * sin + z * cos) - spot.position.y;
  const lowest = (x: number, z: number, hw: number, hd: number): number =>
    Math.min(groundAt(x - hw, z - hd), groundAt(x + hw, z - hd), groundAt(x - hw, z + hd), groundAt(x + hw, z + hd), groundAt(x, z));
  const parts: BufferGeometry[] = [];

  // Dirt yard draped over the terrain, with a track running out to the road.
  const noise = new Noise2D(ctx.def.terrain.seed + 41);
  const yard = new RingGeometry(0.01, 24, 28, 7).rotateX(-Math.PI / 2).toNonIndexed();
  const yp = yard.getAttribute('position');
  for (let i = 0; i < yp.count; i++) {
    const a = Math.atan2(yp.getZ(i), yp.getX(i));
    const f = 1 + noise.noise(Math.cos(a) * 1.5, Math.sin(a) * 1.5) * 0.14;
    yp.setXYZ(i, yp.getX(i) * f, 0, yp.getZ(i) * f);
  }
  yard.translate(0, 0, 6);
  const lane = new BoxGeometry(5, 0.01, 14, 1, 1, 8).toNonIndexed();
  lane.translate(0, 0, 29);
  for (const geo of [yard, lane]) {
    const pos = geo.getAttribute('position');
    const col = new Float32Array(pos.count * 3);
    const c = new Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, groundAt(x, z) + 0.22 + pos.getY(i));
      c.set('#b48a58').lerp(new Color('#8f6a3e'), 0.5 + noise.noise(x * 0.15, z * 0.15) * 0.5);
      col.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new BufferAttribute(col, 3));
    geo.computeVertexNormals();
  }
  const dirt = new Mesh(mergeGeometries([yard, lane]), TrackMaterials.vertexColor());
  dirt.receiveShadow = true;
  g.add(dirt);

  // Barn: gambrel profile extruded front to back, on a stone footing.
  const by = lowest(0, BARN_Z, BARN_HW, BARN_D / 2);
  const profile: Array<[number, number]> = [
    [BARN_HW, BARN_WALL],
    [BARN_HW - 2, BARN_WALL + 4.4],
    [0, BARN_WALL + 6.4],
    [-BARN_HW + 2, BARN_WALL + 4.4],
    [-BARN_HW, BARN_WALL],
  ];
  const shape = new Shape();
  shape.moveTo(-BARN_HW, 0);
  shape.lineTo(BARN_HW, 0);
  for (const [x, y] of profile) shape.lineTo(x, y);
  shape.closePath();
  const body = new ExtrudeGeometry(shape, { depth: BARN_D, bevelEnabled: false });
  body.translate(0, by, BARN_Z - BARN_D / 2);
  parts.push(tint(body, RED));
  parts.push(box(BARN_HW * 2 + 0.6, 4, BARN_D + 0.6, 0, by - 1.8, BARN_Z, '#9a948a'));
  const front = BARN_Z + BARN_D / 2;
  const back = BARN_Z - BARN_D / 2;
  for (let k = 0; k < profile.length - 1; k++) {
    const [x0, y0] = profile[k]!;
    const [x1, y1] = profile[k + 1]!;
    const len = Math.hypot(x1 - x0, y1 - y0);
    const ang = Math.atan2(y1 - y0, x1 - x0);
    const nx = -Math.sin(ang) * 0.32;
    const ny = Math.cos(ang) * 0.32;
    const mx = (x0 + x1) / 2;
    const my = by + (y0 + y1) / 2;
    parts.push(box(len + 0.9, 0.5, BARN_D + 1.6, mx + nx, my + ny, BARN_Z, ROOF, ang));
    for (const z of [front + 0.2, back - 0.2]) parts.push(box(len + 0.2, 0.4, 0.3, mx, my - 0.1, z, TRIM, ang));
  }
  for (const sx of [-1, 1]) {
    for (const z of [front, back]) parts.push(box(0.5, BARN_WALL, 0.5, sx * BARN_HW, by + BARN_WALL / 2, z, TRIM));
  }
  // Side windows (built facing +z then turned onto the side walls).
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const win: BufferGeometry[] = [];
      bracedPanel(win, 0, 0, 1.8, 1.8, 0, '#3a2f2c');
      for (const w of win) {
        w.rotateY((sx * Math.PI) / 2);
        w.translate(sx * (BARN_HW + 0.05), by + 5, BARN_Z - 7 + k * 7);
        parts.push(w);
      }
    }
  }
  bracedPanel(parts, -2.1, by + 3.6, 4, 7, front + 0.05, RED_DARK);
  bracedPanel(parts, 2.1, by + 3.6, 4, 7, front + 0.05, RED_DARK);
  parts.push(box(8.8, 0.4, 0.5, 0, by + 7.3, front + 0.2, TRIM));
  bracedPanel(parts, 0, by + BARN_WALL + 2.4, 2.8, 2.8, front + 0.05, '#3a2f2c');
  parts.push(box(0.5, 0.5, 2.4, 0, by + BARN_WALL + 5.1, front + 1.1, '#6b4a33'));
  // Weather vane mast on the front of the ridge.
  const vaneY = by + BARN_WALL + 6.4;
  const mast = new CylinderGeometry(0.1, 0.12, 3.6, 6);
  mast.translate(0, vaneY + 1.8, front - 2);
  parts.push(tint(mast, IRON));
  for (const r of [0, Math.PI / 2]) {
    const bar = box(2.2, 0.12, 0.12, 0, vaneY + 2.6, 0, IRON);
    bar.rotateY(r);
    bar.translate(0, 0, front - 2);
    parts.push(bar);
  }
  const ball = new SphereGeometry(0.3, 8, 6);
  ball.translate(0, vaneY + 3.7, front - 2);
  parts.push(tint(ball, '#ffcf3a'));

  // Silo with hoops, ladder and a domed cap.
  const siloX = -BARN_HW - 4.6;
  const siloZ = BARN_Z - 4;
  const sy = lowest(siloX, siloZ, 3.6, 3.6) - 0.5;
  const silo = new CylinderGeometry(3.6, 3.8, 21, 16);
  silo.translate(siloX, sy + 10.5, siloZ);
  parts.push(tint(silo, '#dfe2e6'));
  for (const h of [4, 9, 14, 19]) {
    const hoop = new CylinderGeometry(3.75, 3.75, 0.45, 16, 1, true);
    hoop.translate(siloX, sy + h, siloZ);
    parts.push(tint(hoop, '#8d97a3'));
  }
  const dome = new SphereGeometry(3.9, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.translate(siloX, sy + 21, siloZ);
  parts.push(tint(dome, '#c03a30'));
  parts.push(box(0.6, 20, 0.2, siloX + 2.6, sy + 10.5, siloZ + 2.7, '#5a5f68'));

  // Tractor parked in the yard.
  const tr: BufferGeometry[] = [];
  tractor(tr);
  const trX = -12;
  const trZ = 12;
  const trY = lowest(trX, trZ, 2.2, 1.5);
  for (const t of tr) {
    t.scale(1.5, 1.5, 1.5);
    t.rotateY(0.5);
    t.translate(trX, trY, trZ);
    parts.push(t);
  }
  const statics = new Mesh(mergeGeometries(parts), TrackMaterials.shell());
  g.add(statics);

  // Kit pieces: farmhouse, hay bales and fences (baked into a few meshes).
  const kit = new Group();
  const add = (kitId: 'suburban' | 'graveyard', name: string, h: number, x: number, z: number, rotY = 0, sink = 0.1): Object3D | null => {
    if (!kits.has(kitId, name)) return null;
    const o = kits.instantiate(kitId, name, h);
    const size = kits.size(kitId, name).multiplyScalar(h / Math.max(0.01, kits.size(kitId, name).y));
    o.position.set(x, lowest(x, z, size.x / 2, size.z / 2) - sink, z);
    o.rotation.y = rotY;
    kit.add(o);
    return o;
  };
  add('suburban', 'building-type-c', 10, 19, -5, 0, 0.3);
  for (const [x, z, sc] of [[-19, 0, 1], [-18, -14, 0.9], [18, 13, 1.1]] as const) add('suburban', 'tree-large', 11 * sc, x, z);
  // Hay: a stacked pyramid by the barn doors plus a few round bundles.
  const hay = 'hay-bale';
  if (kits.has('graveyard', hay)) {
    const hs = kits.size('graveyard', hay).multiplyScalar(1.4 / kits.size('graveyard', hay).y);
    const hx = 10;
    const hz = 9;
    const hy = lowest(hx, hz, hs.x * 1.5, hs.z);
    for (let row = 0; row < 3; row++) {
      for (let k = 0; k < 3 - row; k++) {
        for (const dz of [-hs.z / 2, hs.z / 2]) {
          const o = kits.instantiate('graveyard', hay, 1.4);
          o.position.set(hx + (k - (2 - row) / 2) * hs.x, hy + row * hs.y, hz + dz);
          kit.add(o);
        }
      }
    }
  }
  for (const [x, z, r] of [[-15, 9, 0.4], [-17, 13, 1.2], [6, 16, 2], [15, 5, 0.9], [-4, 14, 2.6]] as const) add('graveyard', 'hay-bale-bundled', 1.6, x, z, r);
  // Fences along the front of the yard (gap for the lane) and down both sides.
  if (kits.has('suburban', 'fence')) {
    const fs = kits.size('suburban', 'fence');
    const fl = (fs.x * 1.4) / fs.y;
    for (let x = 3.5 + fl / 2; x < 22; x += fl) {
      for (const sx of [-1, 1]) add('suburban', 'fence', 1.4, sx * x, FENCE_Z, 0, 0.05);
    }
    for (let z = FENCE_Z - fl / 2; z > 2; z -= fl) {
      for (const sx of [-1, 1]) add('suburban', 'fence', 1.4, sx * 22.5, z, Math.PI / 2, 0.05);
    }
  }
  g.add(bakeStatic(kit));

  // Animated: the weather vane arrow and puffs from the tractor's exhaust.
  const vane = new Group();
  vane.position.set(0, vaneY + 3.1, front - 2);
  const iron = TrackMaterials.paint(IRON);
  const shaft = new Mesh(new BoxGeometry(3.2, 0.12, 0.12), iron);
  const tip = new Mesh(new ConeGeometry(0.3, 0.7, 4), iron);
  tip.rotation.z = -Math.PI / 2;
  tip.position.x = 1.9;
  const fin = new Mesh(new BoxGeometry(0.9, 0.8, 0.06), iron);
  fin.position.x = -1.4;
  const rooster = new Mesh(new IcosahedronGeometry(0.45, 0), TrackMaterials.paint('#ffcf3a'));
  rooster.position.set(0, 0.45, 0);
  rooster.scale.set(1.4, 1, 0.3);
  vane.add(shaft, tip, fin, rooster);
  g.add(vane);
  const smokeMat = TrackMaterials.paint('#e8e4dc');
  const exhaust = { x: trX + Math.cos(0.5) * 2.4 + Math.sin(0.5) * 0.52, y: trY + 4.1, z: trZ - Math.sin(0.5) * 2.4 + Math.cos(0.5) * 0.52 };
  const puffs: Mesh[] = [];
  for (let i = 0; i < 5; i++) {
    const m = new Mesh(new IcosahedronGeometry(0.5, 0), smokeMat);
    m.userData.phase = i / 5;
    puffs.push(m);
    g.add(m);
  }

  g.traverse((o) => {
    if ((o as Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  dirt.castShadow = false;
  for (const m of puffs) m.castShadow = false;
  ctx.add(g);
  ctx.updatables.push({
    update: (_dt, time) => {
      vane.rotation.y = Math.sin(time * 0.35) * 2.2 + Math.sin(time * 1.7) * 0.25;
      for (const m of puffs) {
        const k = (time * 0.45 + (m.userData.phase as number)) % 1;
        m.position.set(exhaust.x + k * 1.2, exhaust.y + k * 3.5, exhaust.z + Math.sin(k * 6) * 0.3);
        m.scale.setScalar(0.4 + k * 1.4);
      }
    },
  });
}
