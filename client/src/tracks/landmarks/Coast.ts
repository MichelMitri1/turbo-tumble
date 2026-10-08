import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  CanvasTexture,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  RingGeometry,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { LandmarkPlacement } from '@shared/types/track';
import { SeededRandom } from '@shared/math/random';
import type { BuildContext } from '../BuildContext';
import type { KitId } from '../kits';
import { TrackMaterials } from '../materials';
import { placeSetPiece, roadClearance } from './placement';

// ------------------------------------------------------------------ shared set-piece helpers

const dummy = new Object3D();
const UP = new Vector3(0, 1, 0);

/** Transform from a position, Euler rotation (yaw first in the argument list) and scale. */
export function xf(x: number, y: number, z: number, ry = 0, rx = 0, rz = 0, s: number | [number, number, number] = 1): Matrix4 {
  dummy.position.set(x, y, z);
  dummy.rotation.set(rx, ry, rz);
  if (typeof s === 'number') dummy.scale.setScalar(s);
  else dummy.scale.set(s[0], s[1], s[2]);
  dummy.updateMatrix();
  return dummy.matrix.clone();
}

/** Collects coloured parts and merges them into a single vertex-coloured mesh (one draw call). */
export class Batch {
  private readonly parts: BufferGeometry[] = [];

  get empty(): boolean {
    return this.parts.length === 0;
  }

  /** Adds `geo` (kept if it already carries vertex colours, else painted `color`). */
  add(geo: BufferGeometry, color: string | Color, m?: Matrix4): this {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') g.deleteAttribute(k);
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    if (m) g.applyMatrix4(m);
    if (!g.getAttribute('color')) {
      const c = color instanceof Color ? color : new Color(color);
      const n = g.getAttribute('position').count;
      const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
      g.setAttribute('color', new BufferAttribute(arr, 3));
    }
    this.parts.push(g);
    return this;
  }

  /** A box-section beam between two points. */
  beam(a: Vector3, b: Vector3, thick: number, color: string, round = false): this {
    const len = a.distanceTo(b);
    const geo = round ? new CylinderGeometry(thick / 2, thick / 2, len, 6) : new BoxGeometry(thick, len, thick);
    const q = new Quaternion().setFromUnitVectors(UP, b.clone().sub(a).normalize());
    const m = new Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new Vector3(1, 1, 1));
    return this.add(geo, color, m);
  }

  build(material: Material): Mesh {
    const geo = mergeGeometries(this.parts) ?? new BoxGeometry(0, 0, 0);
    for (const p of this.parts) p.dispose();
    this.parts.length = 0;
    return new Mesh(geo, material);
  }
}

/** Ground height relative to a set piece's origin, in its local (yawed) frame. */
export function groundFn(ctx: BuildContext, origin: Vector3, yaw: number): (x: number, z: number) => number {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return (x, z) => ctx.terrain.sample(origin.x + x * c + z * s, origin.z - x * s + z * c) - origin.y;
}

/** Highest / lowest ground over a local rectangle (sampled on a grid). */
export function groundRange(ground: (x: number, z: number) => number, cx: number, cz: number, w: number, d: number): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i <= 4; i++) {
    for (let j = 0; j <= 4; j++) {
      const h = ground(cx + (i / 4 - 0.5) * w, cz + (j / 4 - 0.5) * d);
      min = Math.min(min, h);
      max = Math.max(max, h);
    }
  }
  return { min, max };
}

/** Faceted low-poly rock: a jittered icosahedron. */
export function rockGeometry(rng: SeededRandom, r: number, sx = 1, sy = 1, sz = 1, detail = 1): BufferGeometry {
  let geo: BufferGeometry = new IcosahedronGeometry(r, detail);
  geo.deleteAttribute('uv');
  geo.deleteAttribute('normal');
  geo = mergeVertices(geo);
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const k = rng.range(0.78, 1.18);
    pos.setXYZ(i, pos.getX(i) * k * sx, pos.getY(i) * k * sy, pos.getZ(i) * k * sz);
  }
  const flat = geo.toNonIndexed();
  flat.computeVertexNormals();
  return flat;
}

/** Ground-hugging disc (rings of vertices draped over the terrain). */
export function drapedDisc(ground: (x: number, z: number) => number, cx: number, cz: number, r: number, lift: number, wobble = 0.12): BufferGeometry {
  const geo = new RingGeometry(0.01, r, 40, 6);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const a = Math.atan2(pos.getZ(i), pos.getX(i));
    const k = 1 + wobble * (Math.sin(a * 3 + 1.3) * 0.6 + Math.sin(a * 7 + 0.4) * 0.4);
    const x = pos.getX(i) * k + cx;
    const z = pos.getZ(i) * k + cz;
    pos.setXYZ(i, x, ground(x, z) + lift, z);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Text sign texture (bold toon lettering on a coloured board). */
export function signTexture(text: string, bg: string, fg: string, w = 512, h = 128): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = fg;
  g.lineWidth = 8;
  g.strokeRect(10, 10, w - 20, h - 20);
  g.fillStyle = fg;
  g.font = `900 ${Math.round(h * 0.52)}px "Trebuchet MS", Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 4);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Shadows on every opaque mesh. */
export function finish(g: Object3D): void {
  g.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const solid = !mats.some((x) => x.transparent || x instanceof MeshBasicMaterial);
    m.castShadow = solid;
    m.receiveShadow = solid;
  });
}

/** Loaded name of a kit model (GLTF de-duplication can suffix a node name with `_1`), or null. */
export function kitName(ctx: BuildContext, id: KitId, name: string): string | null {
  if (ctx.kits.has(id, name)) return name;
  return ctx.kits.has(id, `${name}_1`) ? `${name}_1` : null;
}

/** A kit model placed in a set piece's local frame (scaled to `height`, base on `y`). */
export function kit(ctx: BuildContext, parent: Object3D, id: KitId, name: string, height: number, x: number, y: number, z: number, yaw = 0): Object3D | null {
  const n = kitName(ctx, id, name);
  if (!n) return null;
  const o = ctx.kits.instantiate(id, n, height);
  o.position.set(x, y, z);
  o.rotation.y = yaw;
  parent.add(o);
  return o;
}

/** Parasol with an alternating-colour canopy, plus a beach towel at its foot. */
export function parasol(b: Batch, x: number, y: number, z: number, a: string, c: string, towel: string, tilt = 0): void {
  const canopy = new ConeGeometry(2.4, 0.9, 10, 1, true).toNonIndexed();
  const n = canopy.getAttribute('position').count;
  const colors = new Float32Array(n * 3);
  const ca = new Color(a);
  const cc = new Color(c);
  for (let t = 0; t < n / 3; t++) {
    const col = Math.floor(t / 2) % 2 === 0 ? ca : cc;
    for (let v = 0; v < 3; v++) colors.set([col.r, col.g, col.b], (t * 3 + v) * 3);
  }
  canopy.setAttribute('color', new BufferAttribute(colors, 3));
  const m = xf(x, y, z, 0, tilt, tilt * 0.5);
  b.add(new CylinderGeometry(0.07, 0.07, 3.2, 5).translate(0, 1.6, 0), '#f4f1e8', m);
  b.add(canopy.translate(0, 3.25, 0), '#ffffff', m);
  b.add(new SphereGeometry(0.16, 6, 4).translate(0, 3.75, 0), a, m);
  b.add(new BoxGeometry(1.1, 0.06, 2.2), towel, xf(x + 1.2, y + 0.05, z + 0.4, 0.4));
}

const SAND = '#f4e3a8';

// ------------------------------------------------------------------ lighthouse

const LIGHTHOUSE_RADIUS = 12;
const TOWER_BASE = 3.2;
const TOWER_TOP = 31;
const LAMP_Y = 32.9;

/** Striped lighthouse on a rocky outcrop: gallery, glowing lamp room and a sweeping light beam. */
export function buildLighthouse(ctx: BuildContext, p: LandmarkPlacement): void {
  const spot = placeSetPiece(ctx, p, LIGHTHOUSE_RADIUS);
  if (!spot) return;
  const stripe = String(p.params?.stripes ?? '#e8413a');
  const rng = new SeededRandom(ctx.def.terrain.seed + 311);
  const ground = groundFn(ctx, spot.position, spot.yaw);
  const g = new Group();
  g.name = 'lighthouse';
  g.position.copy(spot.position);
  g.rotation.y = spot.yaw;

  // Rocky outcrop.
  const rocks = new Batch();
  const rockTones = ['#8f8a84', '#a39d92', '#7d7a78', '#b0a898'];
  rocks.add(rockGeometry(rng, 7, 1, 0.42, 1), '#968f86', xf(0, ground(0, 0) + 0.6, 0, rng.range(0, 6)));
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2 + rng.range(-0.2, 0.2);
    const d = rng.range(5, 8.5);
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    const r = rng.range(1.8, 3.4);
    rocks.add(rockGeometry(rng, r, 1, rng.range(0.6, 1.1), 1), rng.pick(rockTones), xf(x, ground(x, z) + r * 0.25, z, rng.range(0, 6)));
  }
  g.add(rocks.build(TrackMaterials.shell()));

  // Tower: plinth, striped shaft, gallery, lamp room, roof.
  const b = new Batch();
  const sink = Math.min(0, groundRange(ground, 0, 0, 10, 10).min) - 1;
  b.add(new CylinderGeometry(4.6, 5.0, TOWER_BASE - sink, 12).translate(0, (TOWER_BASE + sink) / 2, 0), '#d9d2c4');
  b.add(new CylinderGeometry(4.9, 4.9, 0.4, 12).translate(0, TOWER_BASE, 0), '#8a7f72');
  const bands = 7;
  const bandH = (TOWER_TOP - TOWER_BASE) / bands;
  for (let i = 0; i < bands; i++) {
    const r0 = 3.7 - (i / bands) * 1.3;
    const r1 = 3.7 - ((i + 1) / bands) * 1.3;
    b.add(new CylinderGeometry(r1, r0, bandH, 20).translate(0, TOWER_BASE + bandH * (i + 0.5), 0), i % 2 === 0 ? '#fbf6ec' : stripe);
  }
  b.add(new BoxGeometry(1.8, 2.8, 0.6), '#5a3a28', xf(0, TOWER_BASE + 1.4, 3.55));
  b.add(new BoxGeometry(2.3, 0.3, 0.9), stripe, xf(0, TOWER_BASE + 3.0, 3.55));
  for (let i = 0; i < 4; i++) {
    const y = TOWER_BASE + bandH * (i * 1.7 + 1.6);
    const r = 3.7 - ((y - TOWER_BASE) / (TOWER_TOP - TOWER_BASE)) * 1.3;
    const a = i * 1.9 + 0.4;
    b.add(new BoxGeometry(0.8, 1.3, 0.4), '#2f3b52', xf(Math.sin(a) * r, y, Math.cos(a) * r, a));
  }
  // Gallery + railing.
  b.add(new CylinderGeometry(3.9, 3.0, 0.7, 20).translate(0, TOWER_TOP + 0.1, 0), '#33384a');
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    b.add(new BoxGeometry(0.12, 1.1, 0.12), '#33384a', xf(Math.cos(a) * 3.7, TOWER_TOP + 1.0, Math.sin(a) * 3.7));
  }
  b.add(new TorusGeometry(3.7, 0.09, 4, 32).rotateX(Math.PI / 2), '#33384a', xf(0, TOWER_TOP + 1.55, 0));
  // Lamp room frame + roof.
  b.add(new CylinderGeometry(2.2, 2.3, 0.5, 16).translate(0, TOWER_TOP + 0.7, 0), '#33384a');
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.add(new BoxGeometry(0.16, 3.0, 0.16), '#33384a', xf(Math.cos(a) * 1.95, TOWER_TOP + 2.4, Math.sin(a) * 1.95));
  }
  b.add(new CylinderGeometry(2.45, 2.45, 0.35, 16).translate(0, TOWER_TOP + 4.0, 0), '#33384a');
  b.add(new ConeGeometry(2.6, 2.4, 16).translate(0, TOWER_TOP + 5.35, 0), stripe);
  b.add(new SphereGeometry(0.42, 8, 6).translate(0, TOWER_TOP + 6.7, 0), '#33384a');
  b.add(new CylinderGeometry(0.05, 0.05, 1.6).translate(0, TOWER_TOP + 7.4, 0), '#33384a');
  // Keeper's cottage tucked against the outcrop.
  const cx = -7.4;
  const cz = -4;
  const cy = ground(cx, cz);
  const cs = groundRange(ground, cx, cz, 5, 4).min - cy - 0.5;
  b.add(new BoxGeometry(5, 3.4 - cs, 4.2).translate(0, (3.4 + cs) / 2, 0), '#fbf6ec', xf(cx, cy, cz, 0.5));
  b.add(new CylinderGeometry(3.2, 3.2, 5.8, 3).rotateZ(Math.PI / 2).rotateX(-Math.PI / 2).scale(1, 0.62, 0.8).translate(0, 4.4, 0), stripe, xf(cx, cy, cz, 0.5));
  b.add(new BoxGeometry(1.1, 1.0, 0.2).translate(-1.2, 2.0, 2.15), '#2f3b52', xf(cx, cy, cz, 0.5));
  b.add(new BoxGeometry(1.0, 2.0, 0.2).translate(1.0, 1.0, 2.15), '#5a3a28', xf(cx, cy, cz, 0.5));
  g.add(b.build(TrackMaterials.vertexColor()));

  // Lamp, glass and the rotating beam.
  const lamp = new Mesh(new IcosahedronGeometry(1.05, 1), TrackMaterials.emissive('#fff1a8', 4));
  lamp.position.y = LAMP_Y;
  const glass = new Mesh(
    new CylinderGeometry(1.9, 1.9, 2.9, 16, 1, true),
    new MeshStandardMaterial({ color: '#d8f4ff', emissive: '#fff0b8', emissiveIntensity: 0.7, transparent: true, opacity: 0.4, roughness: 0.1, side: DoubleSide, depthWrite: false }),
  );
  glass.position.y = TOWER_TOP + 2.4;
  g.add(lamp, glass);

  const beam = new Group();
  beam.position.y = LAMP_Y;
  const beamMat = new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.3, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, fog: false });
  const BEAM_LEN = 75;
  const cone = new ConeGeometry(7, BEAM_LEN, 20, 6, true);
  cone.translate(0, -BEAM_LEN / 2, 0);
  const cpos = cone.getAttribute('position');
  const fade = new Float32Array(cpos.count * 3);
  const warm = new Color('#ffe7a0');
  for (let i = 0; i < cpos.count; i++) {
    const t = -cpos.getY(i) / BEAM_LEN;
    const k = (1 - t) ** 2.2;
    fade.set([warm.r * k, warm.g * k, warm.b * k], i * 3);
  }
  cone.setAttribute('color', new BufferAttribute(fade, 3));
  for (const dir of [1, -1]) {
    const m = new Mesh(cone, beamMat);
    m.rotation.z = (dir * Math.PI) / 2 + dir * 0.06;
    m.renderOrder = 2;
    beam.add(m);
  }
  const halo = new Mesh(new SphereGeometry(2.6, 12, 8), new MeshBasicMaterial({ color: '#fff0b0', transparent: true, opacity: 0.25, blending: AdditiveBlending, depthWrite: false }));
  halo.position.y = LAMP_Y;
  g.add(beam, halo);

  // Gulls circling the lamp.
  const gullGeo = new Batch()
    .add(new BoxGeometry(1.5, 0.08, 0.5), '#ffffff', xf(-0.7, 0.18, 0, 0, 0, 0.35))
    .add(new BoxGeometry(1.5, 0.08, 0.5), '#ffffff', xf(0.7, 0.18, 0, 0, 0, -0.35))
    .add(new BoxGeometry(0.3, 0.3, 0.9), '#e9eef2')
    .build(TrackMaterials.vertexColor());
  const gulls = new InstancedMesh(gullGeo.geometry, gullGeo.material, 4);
  g.add(gulls);
  finish(g);
  ctx.add(g);

  const e = new Object3D();
  ctx.updatables.push({
    update: (dt, time) => {
      beam.rotation.y += dt * 0.8;
      lamp.scale.setScalar(1 + Math.sin(time * 6) * 0.05);
      for (let i = 0; i < 4; i++) {
        const a = time * (0.35 + i * 0.05) + i * 1.7;
        const r = 9 + i * 2.5;
        e.position.set(Math.cos(a) * r, 26 + i * 2.5 + Math.sin(time * 1.3 + i) * 1.2, Math.sin(a) * r);
        e.rotation.set(0, -a, 0.4 + Math.sin(time * 4 + i) * 0.15);
        e.updateMatrix();
        gulls.setMatrixAt(i, e.matrix);
      }
      gulls.instanceMatrix.needsUpdate = true;
    },
  });
}

// ------------------------------------------------------------------ resort

const RESORT_RADIUS = 30;

/** Pool-water texture: soft caustic network on turquoise. */
function causticTexture(rng: SeededRandom): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#38d8e8';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(230,255,255,0.75)';
  g.lineWidth = 2.5;
  for (let i = 0; i < 26; i++) {
    g.beginPath();
    let x = rng.range(0, 128);
    let y = rng.range(0, 128);
    g.moveTo(x, y);
    for (let k = 0; k < 4; k++) {
      x += rng.range(-22, 22);
      y += rng.range(-22, 22);
      g.lineTo(x, y);
    }
    g.stroke();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(3, 2);
  return t;
}

/** Thatched stilt hut (round walls, layered cone roof) into a batch. */
function stiltHut(b: Batch, ground: (x: number, z: number) => number, x: number, z: number, yaw: number, wall: string, scale = 1): void {
  const s = scale;
  const floor = Math.max(ground(x, z), groundRange(ground, x, z, 6 * s, 6 * s).max) + 2.6 * s;
  for (const [px, pz] of [
    [-2.2, -2.2],
    [2.2, -2.2],
    [-2.2, 2.2],
    [2.2, 2.2],
  ] as const) {
    const lx = x + (px * Math.cos(yaw) + pz * Math.sin(yaw)) * s;
    const lz = z + (-px * Math.sin(yaw) + pz * Math.cos(yaw)) * s;
    const gy = ground(lx, lz) - 0.4;
    b.add(new CylinderGeometry(0.22 * s, 0.26 * s, floor - gy, 6).translate(0, (floor + gy) / 2, 0), '#7a5232', xf(lx, 0, lz));
  }
  const m = xf(x, floor, z, yaw, 0, 0, s);
  b.add(new BoxGeometry(6, 0.4, 6.4), '#a8784a', m);
  b.add(new CylinderGeometry(2.4, 2.6, 3.2, 10).translate(0, 1.8, 0), wall, m);
  b.add(new BoxGeometry(1.1, 2.0, 0.3), '#4a2f1e', xf(x + Math.sin(yaw) * 2.45 * s, floor + 1.2 * s, z + Math.cos(yaw) * 2.45 * s, yaw, 0, 0, s));
  b.add(new ConeGeometry(4.3, 2.4, 10).translate(0, 3.8, 0), '#c99a45', m);
  b.add(new ConeGeometry(3.4, 2.8, 10).translate(0, 5.1, 0), '#e0b45a', m);
  b.add(new ConeGeometry(0.5, 1.2, 6).translate(0, 6.9, 0), '#9c7034', m);
  // Steps down to the sand.
  for (let k = 0; k < 4; k++) {
    const d = 3.4 + k * 0.7;
    const sx = x + Math.sin(yaw) * d * s;
    const sz = z + Math.cos(yaw) * d * s;
    b.add(new BoxGeometry(1.4, 0.15, 0.6), '#a8784a', xf(sx, floor - (k + 1) * 0.62 * s, sz, yaw, 0, 0, s));
  }
}

/** Tiki torches: bamboo poles in `b`, flames as one instanced, flickering mesh. */
function tikiTorches(ctx: BuildContext, g: Group, b: Batch, spots: Array<[number, number, number]>): void {
  for (const [x, y, z] of spots) {
    b.add(new CylinderGeometry(0.13, 0.17, 3.6, 6).translate(0, 1.6, 0), '#a8803a', xf(x, y, z));
    b.add(new CylinderGeometry(0.32, 0.22, 0.6, 6).translate(0, 3.5, 0), '#5a3a22', xf(x, y, z));
  }
  const flameGeo = new ConeGeometry(0.34, 1.2, 6).translate(0, 0.6, 0);
  const flames = new InstancedMesh(flameGeo, TrackMaterials.emissive('#ff8a1a', 2), spots.length);
  g.add(flames);
  const m = new Matrix4();
  const q = new Quaternion();
  const s = new Vector3();
  const v = new Vector3();
  ctx.updatables.push({
    update: (_dt, time) => {
      spots.forEach(([x, y, z], i) => {
        const f = 1 + Math.sin(time * 13 + i * 2.1) * 0.12 + Math.sin(time * 21 + i) * 0.08;
        s.set(1 / Math.sqrt(f), f, 1 / Math.sqrt(f));
        q.setFromAxisAngle(UP, time * 2 + i);
        m.compose(v.set(x, y + 3.75, z), q, s);
        flames.setMatrixAt(i, m);
      });
      flames.instanceMatrix.needsUpdate = true;
    },
  });
}

/** Tiki beach resort: stilt huts, a turquoise pool on a wooden deck, parasols, palms and tiki torches. */
export function buildResort(ctx: BuildContext, p: LandmarkPlacement): void {
  const spot = placeSetPiece(ctx, p, RESORT_RADIUS);
  if (!spot) return;
  const rng = new SeededRandom(ctx.def.terrain.seed + 422);
  const ground = groundFn(ctx, spot.position, spot.yaw);
  const g = new Group();
  g.name = 'resort';
  g.position.copy(spot.position);
  g.rotation.y = spot.yaw;

  const sand = new Mesh(drapedDisc(ground, 0, -2, RESORT_RADIUS - 2, 0.3), new MeshStandardMaterial({ color: SAND, roughness: 1, polygonOffset: true, polygonOffsetFactor: -4 }));
  sand.receiveShadow = true;
  g.add(sand);

  const b = new Batch();
  // Pool deck.
  const PX = 0;
  const PZ = 4;
  const deckR = groundRange(ground, PX, PZ, 24, 15);
  const deckY = deckR.max + 0.6;
  b.add(new BoxGeometry(24, deckY - deckR.min + 1, 15).translate(0, -(deckY - deckR.min + 1) / 2, 0), '#c49462', xf(PX, deckY, PZ));
  for (let i = 0; i < 12; i++) b.add(new BoxGeometry(0.08, 0.04, 15), '#9c7048', xf(PX - 11 + i * 2, deckY + 0.02, PZ));
  // Pool coping.
  b.add(new BoxGeometry(17.2, 0.3, 0.8), '#f4f1e8', xf(PX, deckY + 0.15, PZ - 4.9));
  b.add(new BoxGeometry(17.2, 0.3, 0.8), '#f4f1e8', xf(PX, deckY + 0.15, PZ + 4.9));
  b.add(new BoxGeometry(0.8, 0.3, 9), '#f4f1e8', xf(PX - 8.2, deckY + 0.15, PZ));
  b.add(new BoxGeometry(0.8, 0.3, 9), '#f4f1e8', xf(PX + 8.2, deckY + 0.15, PZ));
  // Slide + ladder.
  b.add(new BoxGeometry(1.4, 0.2, 7), '#ff5aa0', xf(PX + 6.5, deckY + 1.8, PZ - 1, 0, 0.5));
  b.add(new BoxGeometry(1.6, 3.6, 1.6).translate(0, 1.8, 0), '#ffd23f', xf(PX + 6.5, deckY, PZ - 5.2));
  // Loungers along the front of the pool.
  for (let i = 0; i < 4; i++) {
    const lx = PX - 7 + i * 4.6;
    const lz = PZ + 6.2;
    b.add(new BoxGeometry(1.2, 0.35, 2.4).translate(0, 0.45, 0), '#ffffff', xf(lx, deckY, lz));
    b.add(new BoxGeometry(1.2, 0.2, 1.0), '#f4f1e8', xf(lx, deckY + 0.95, lz - 1.1, 0, -0.6));
    b.add(new BoxGeometry(1.0, 0.06, 1.8), rng.pick(['#ff6f61', '#3fc7e8', '#ffd23f']), xf(lx, deckY + 0.66, lz + 0.1));
  }
  const parasolColors: Array<[string, string, string]> = [
    ['#ff4f9a', '#fff6e6', '#3fc7e8'],
    ['#2ab7c9', '#fff6e6', '#ffd23f'],
    ['#ffb21a', '#fff6e6', '#ff6f61'],
  ];
  for (let i = 0; i < 3; i++) {
    const [a, c, t] = parasolColors[i]!;
    parasol(b, PX - 4.7 + i * 4.6, deckY, PZ + 6.4, a, c, t, 0.05);
  }

  // Stilt huts along the back.
  const walls = ['#e8c88a', '#d9b070', '#f0d49a', '#dcb77e'];
  const hutX = [-19, -7, 5, 17];
  hutX.forEach((hx, i) => {
    const hz = -14 - Math.abs(hx) * 0.15 + rng.range(-1, 1);
    stiltHut(b, ground, hx, hz, rng.range(-0.25, 0.25) + hx * -0.012, walls[i]!, 1.4);
  });

  // Tiki bar beside the pool.
  const bx = 18.5;
  const bz = 6;
  const by = ground(bx, bz);
  const bs = groundRange(ground, bx, bz, 7, 6).min - by - 0.4;
  b.add(new BoxGeometry(7, 0.4 - bs, 6).translate(0, (0.4 + bs) / 2, 0), '#a8784a', xf(bx, by, bz, -0.4));
  for (const [dx, dz] of [
    [-3, -2.6],
    [3, -2.6],
    [-3, 2.6],
    [3, 2.6],
  ] as const) {
    b.add(new CylinderGeometry(0.2, 0.2, 4.2, 6).translate(dx, 2.5, dz), '#7a5232', xf(bx, by, bz, -0.4));
  }
  b.add(new ConeGeometry(5.6, 2.8, 4).rotateY(Math.PI / 4).scale(1, 1, 0.85).translate(0, 5.9, 0), '#e0b45a', xf(bx, by, bz, -0.4));
  b.add(new BoxGeometry(5.4, 1.3, 1.0).translate(0, 1.05, 1.6), '#8a5a32', xf(bx, by, bz, -0.4));
  b.add(new BoxGeometry(5.8, 0.15, 1.4).translate(0, 1.75, 1.6), '#5a3a22', xf(bx, by, bz, -0.4));
  for (let k = 0; k < 3; k++) b.add(new CylinderGeometry(0.35, 0.3, 0.9, 8).translate(-1.8 + k * 1.8, 0.85, 2.9), rng.pick(['#ff6f61', '#3fc7e8', '#ffd23f']), xf(bx, by, bz, -0.4));
  b.add(new BoxGeometry(5.2, 0.06, 0.06).translate(0, 4.4, 2.6), '#3a2a1a', xf(bx, by, bz, -0.4));

  // Welcome arch: two tiki totems carrying a sign.
  const ax = -17;
  const az = 13;
  const signY = ground(ax, az) + 7.4;
  const totem = (tx: number): void => {
    const ty = ground(ax + tx, az) - 0.5;
    const faces = ['#8a5a32', '#b8803e', '#6a4428'];
    for (let k = 0; k < 3; k++) {
      const y0 = ty + k * 2.6;
      b.add(new BoxGeometry(1.6, 2.6, 1.6).translate(0, y0 + 1.3, 0), faces[k]!, xf(ax + tx, 0, az));
      b.add(new BoxGeometry(1.2, 0.3, 0.3), '#2a1a10', xf(ax + tx, y0 + 0.9, az + 0.85));
      b.add(new BoxGeometry(0.35, 0.35, 0.3), '#fff6e6', xf(ax + tx - 0.4, y0 + 1.8, az + 0.85));
      b.add(new BoxGeometry(0.35, 0.35, 0.3), '#fff6e6', xf(ax + tx + 0.4, y0 + 1.8, az + 0.85));
    }
    b.add(new ConeGeometry(1.4, 1.6, 4).rotateY(Math.PI / 4).translate(0, ty + 8.6, 0), '#2ab7c9', xf(ax + tx, 0, az));
  };
  totem(-4.2);
  totem(4.2);
  const signMat = new MeshStandardMaterial({ map: signTexture('TIKI RESORT', '#2ab7c9', '#fff6e6'), roughness: 0.7 });
  const sign = new Mesh(new PlaneGeometry(7, 1.75), signMat);
  sign.position.set(ax, signY, az + 0.85);
  b.add(new BoxGeometry(7.6, 2.2, 0.5), '#6a4428', xf(ax, signY, az + 0.5));
  g.add(sign);

  // Surfboards stuck in the sand.
  ['#ff6f61', '#3fc7e8', '#ffd23f', '#7ad65a'].forEach((col, i) => {
    const sx = -8 + i * 1.6;
    const sz = -4.5 + (i % 2) * 0.4;
    b.add(new SphereGeometry(1, 10, 6).scale(0.42, 1.6, 0.12), col, xf(sx, ground(sx, sz) + 0.9, sz, 0.2 * i, 0, (i - 1.5) * 0.12));
  });

  // Tiki torches ring the deck.
  const torchSpots: Array<[number, number, number]> = [];
  for (const [tx, tz] of [
    [-12.8, -3],
    [-12.8, 11.5],
    [12.8, -3],
    [12.8, 11.5],
    [-23, 2],
    [23, -6],
    [-12, 15],
    [-22, 13],
  ] as const) {
    torchSpots.push([tx, ground(tx, tz) - 0.3, tz]);
  }
  tikiTorches(ctx, g, b, torchSpots);

  g.add(b.build(TrackMaterials.vertexColor()));

  // Pool water.
  const water = new Mesh(
    new PlaneGeometry(15.6, 9).rotateX(-Math.PI / 2),
    new MeshStandardMaterial({ map: causticTexture(rng), color: '#ffffff', emissive: '#19b8cc', emissiveIntensity: 0.35, roughness: 0.15, metalness: 0.1 }),
  );
  water.position.set(PX, deckY + 0.08, PZ);
  water.receiveShadow = true;
  g.add(water);
  const waterMap = (water.material as MeshStandardMaterial).map!;

  // Palms.
  const palmSpots: Array<[number, number]> = [
    [-26, -2],
    [-25, -17],
    [-13, -24],
    [-1, -25],
    [11, -24],
    [25, -14],
    [26, 0],
    [-10, 13],
    [9, 15],
    [-26, 9],
  ];
  palmSpots.forEach(([x, z], i) => kit(ctx, g, 'pirate', i % 2 ? 'palm-bend' : 'palm-detailed-straight', rng.range(12, 17), x, ground(x, z) - 0.2, z, rng.range(0, 6.28)));
  finish(g);
  sand.castShadow = false;
  ctx.add(g);

  ctx.updatables.push({
    update: (dt) => {
      waterMap.offset.x += dt * 0.03;
      waterMap.offset.y += dt * 0.017;
    },
  });
}

// ------------------------------------------------------------------ cove

const COVE_RADIUS = 28;

/** One small red crab (vertex-coloured), ~1.6 m across, facing +Z. */
function crabGeometry(): BufferGeometry {
  const b = new Batch();
  const red = '#e8413a';
  b.add(new SphereGeometry(0.5, 10, 6).scale(1.15, 0.5, 0.85).translate(0, 0.45, 0), red);
  for (const sx of [-1, 1]) {
    b.add(new SphereGeometry(0.24, 8, 5).scale(1, 0.75, 1.35), '#ff5a4a', xf(sx * 0.72, 0.55, 0.62, sx * 0.4));
    b.add(new BoxGeometry(0.12, 0.12, 0.45), red, xf(sx * 0.5, 0.48, 0.42, sx * -0.6));
    b.add(new CylinderGeometry(0.04, 0.04, 0.35, 4).translate(0, 0.17, 0), '#c8322a', xf(sx * 0.16, 0.62, 0.3));
    b.add(new SphereGeometry(0.1, 6, 4), '#ffffff', xf(sx * 0.16, 0.85, 0.32));
    b.add(new SphereGeometry(0.055, 5, 3), '#1a1a22', xf(sx * 0.16, 0.86, 0.41));
    for (let k = 0; k < 3; k++) {
      b.add(new BoxGeometry(0.6, 0.08, 0.08), '#c8322a', xf(sx * 0.72, 0.3, -0.25 + k * 0.25, 0, 0, sx * -0.6));
    }
  }
  const mesh = b.build(TrackMaterials.vertexColor());
  return mesh.geometry.scale(1.25, 1.25, 1.25);
}

/** Crabs scuttling sideways on the sand (one instanced mesh). */
function crabs(ctx: BuildContext, g: Group, rng: SeededRandom, ground: (x: number, z: number) => number, count: number, keepOut: Array<[number, number, number]>): void {
  const crabsList: Array<{ x: number; z: number; yaw: number; amp: number; speed: number; phase: number }> = [];
  for (let attempt = 0; attempt < 80 && crabsList.length < count; attempt++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(4, COVE_RADIUS - 6);
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (keepOut.some(([kx, kz, kr]) => Math.hypot(kx - x, kz - z) < kr)) continue;
    crabsList.push({ x, z, yaw: rng.range(0, Math.PI * 2), amp: rng.range(1.5, 3.5), speed: rng.range(0.5, 1.1), phase: rng.range(0, 6.28) });
  }
  const mesh = new InstancedMesh(crabGeometry(), TrackMaterials.vertexColor(), crabsList.length);
  mesh.castShadow = true;
  g.add(mesh);
  const m = new Matrix4();
  const q = new Quaternion();
  const e = new Object3D();
  const one = new Vector3(1, 1, 1);
  ctx.updatables.push({
    update: (_dt, time) => {
      crabsList.forEach((c, i) => {
        const s = Math.sin(time * c.speed + c.phase);
        // Scuttle, pause at the ends, scuttle back.
        const off = Math.sign(s) * Math.min(1, Math.abs(s) * 1.6) * c.amp;
        const x = c.x + Math.cos(c.yaw) * off;
        const z = c.z - Math.sin(c.yaw) * off;
        const moving = Math.abs(s) < 0.62;
        e.position.set(x, ground(x, z) + (moving ? Math.abs(Math.sin(time * 18 + i)) * 0.08 : 0), z);
        e.rotation.set(0, c.yaw, moving ? Math.sin(time * 18 + i) * 0.08 : 0);
        q.setFromEuler(e.rotation);
        mesh.setMatrixAt(i, m.compose(e.position, q, one));
      });
      mesh.instanceMatrix.needsUpdate = true;
    },
  });
}

export interface PoolLook {
  deep: string;
  shallow: string;
  wet: string;
  dry: string;
}

const LAGOON: PoolLook = { deep: '#12a6c4', shallow: '#6ff2e2', wet: '#e2c98e', dry: '#f2e2b8' };

/** Flat pool of water (deep centre, pale shallows) on a bank that eases down to the terrain, with a foam ring. */
export function lagoon(g: Group, ground: (x: number, z: number) => number, cx: number, cz: number, r: number, y: number, foams: Mesh[], look: PoolLook = LAGOON): void {
  const water = new CircleGeometry(r + 0.6, 40).rotateX(-Math.PI / 2);
  const wp = water.getAttribute('position');
  const wc = new Float32Array(wp.count * 3);
  const deep = new Color(look.deep);
  const shallow = new Color(look.shallow);
  const c = new Color();
  for (let i = 0; i < wp.count; i++) {
    c.copy(deep).lerp(shallow, Math.min(1, Math.hypot(wp.getX(i), wp.getZ(i)) / r) ** 2);
    wc.set([c.r, c.g, c.b], i * 3);
  }
  water.setAttribute('color', new BufferAttribute(wc, 3));
  const wm = new Mesh(water, new MeshStandardMaterial({ vertexColors: true, roughness: 0.15, metalness: 0.05, emissive: '#0b6f80', emissiveIntensity: 0.25 }));
  wm.position.set(cx, y, cz);
  wm.receiveShadow = true;
  g.add(wm);

  const BANK = 3;
  const bank = new RingGeometry(r, r + BANK, 40, 3).rotateX(-Math.PI / 2);
  const bp = bank.getAttribute('position');
  const bc = new Float32Array(bp.count * 3);
  const wet = new Color(look.wet);
  const dry = new Color(look.dry);
  for (let i = 0; i < bp.count; i++) {
    const x = bp.getX(i) + cx;
    const z = bp.getZ(i) + cz;
    const t = (Math.hypot(bp.getX(i), bp.getZ(i)) - r) / BANK;
    const gy = ground(x, z) - 0.25;
    const s = t * t * (3 - 2 * t);
    bp.setXYZ(i, x, y + 0.05 + (gy - y - 0.05) * s, z);
    c.copy(wet).lerp(dry, s);
    bc.set([c.r, c.g, c.b], i * 3);
  }
  bank.setAttribute('color', new BufferAttribute(bc, 3));
  bank.computeVertexNormals();
  const bm = new Mesh(bank, TrackMaterials.vertexColor());
  bm.receiveShadow = true;
  g.add(bm);

  const foam = new Mesh(new RingGeometry(r - 0.5, r + 0.25, 40).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.75, depthWrite: false }));
  foam.position.set(cx, y + 0.07, cz);
  g.add(foam);
  foams.push(foam);
}

/** Small flickering campfire flame. */
export function fireAt(ctx: BuildContext, g: Group, x: number, y: number, z: number): void {
  const fire = new Group();
  fire.position.set(x, y, z);
  const outer = new Mesh(new ConeGeometry(0.75, 1.9, 7).translate(0, 0.95, 0), TrackMaterials.emissive('#ff6a10', 1.8));
  const inner = new Mesh(new ConeGeometry(0.42, 1.2, 6).translate(0, 0.6, 0), TrackMaterials.emissive('#ffc83a', 2.2));
  inner.position.y = 0.05;
  fire.add(outer, inner);
  g.add(fire);
  ctx.updatables.push({
    update: (_dt, time) => {
      outer.scale.set(1, 1 + Math.sin(time * 11) * 0.15 + Math.sin(time * 17.3) * 0.08, 1);
      inner.scale.set(1, 1 + Math.sin(time * 14 + 1) * 0.18, 1);
      fire.rotation.y = time * 1.5;
    },
  });
}

/**
 * Coral Cove beach scene. Variant 0: a big shipwreck half-buried in the sand with
 * spilled cargo and a pirate flag. Variant 1: a beach-hut village with a dock and
 * bobbing boats. Both: parasols, towels and scuttling crabs.
 */
export function buildCove(ctx: BuildContext, p: LandmarkPlacement): void {
  const spot = placeSetPiece(ctx, p, COVE_RADIUS);
  if (!spot) return;
  const variant = Number(p.params?.variant ?? 0);
  const rng = new SeededRandom(ctx.def.terrain.seed + 533 + variant * 17);
  const ground = groundFn(ctx, spot.position, spot.yaw);
  const g = new Group();
  g.name = `cove-${variant}`;
  g.position.copy(spot.position);
  g.rotation.y = spot.yaw;
  const b = new Batch();
  const keepOut: Array<[number, number, number]> = [];
  const bobbers: Array<{ o: Object3D; y: number; phase: number }> = [];
  const foams: Mesh[] = [];
  let flag: Object3D | null = null;

  if (variant === 0) {
    // The wreck: long side to the road, keeled over and sunk into the sand.
    const wreck = kitName(ctx, 'pirate', 'ship-wreck');
    if (wreck) {
      const size = ctx.kits.size('pirate', wreck);
      const k = 26 / size.z;
      const ship = ctx.kits.instantiate('pirate', wreck);
      ship.scale.setScalar(k);
      const holder = new Group();
      holder.position.set(-2, groundRange(ground, -2, -4, 22, 10).min - 2.6, -4);
      holder.rotation.set(0.08, Math.PI / 2 + 0.25, 0.32, 'YXZ');
      holder.add(ship);
      g.add(holder);
      keepOut.push([-2, -4, 14]);
    }
    const cargo: Array<[string, number, number, number]> = [
      ['barrel', 1.5, 9, 4],
      ['barrel', 1.5, 10.4, 5.4],
      ['barrel', 1.5, -12.5, 6],
      ['crate', 1.2, 11.5, 2.8],
      ['crate', 1.2, -14, 4],
      ['crate', 1.2, 7.6, 7.2],
      ['chest', 1.3, 4, 8],
    ];
    for (const [name, h, x, z] of cargo) {
      const o = kit(ctx, g, 'pirate', name, h, x, ground(x, z) - 0.1, z, rng.range(0, 6.28));
      if (o && name === 'barrel' && rng.chance(0.4)) {
        o.rotation.z = Math.PI / 2;
        o.position.y += 0.6;
      }
    }
    // Spilled gold by the chest.
    const gold = new Batch();
    for (let i = 0; i < 14; i++) {
      const x = 4 + rng.range(-1.6, 1.6);
      const z = 9.3 + rng.range(-0.8, 1.2);
      gold.add(new CylinderGeometry(0.22, 0.22, 0.06, 8), '#ffd23f', xf(x, ground(x, z) + 0.06 + rng.range(0, 0.15), z, 0, rng.range(-0.4, 0.4), rng.range(-0.4, 0.4)));
    }
    const goldMesh = gold.build(new MeshStandardMaterial({ vertexColors: true, emissive: '#ffb21a', emissiveIntensity: 0.6, metalness: 0.5, roughness: 0.35 }));
    g.add(goldMesh);
    kit(ctx, g, 'pirate', 'rocks-sand-a', 4, 15, ground(15, -8) - 0.5, -8, 0.6);
    kit(ctx, g, 'pirate', 'rocks-sand-b', 3.2, -17, ground(-17, -9) - 0.4, -9, 2.1);
    kit(ctx, g, 'pirate', 'cannon', 1.4, -8, ground(-8, 8) - 0.05, 8, 2.6);
    flag = kit(ctx, g, 'pirate', 'flag-pirate-high', 9, 16, ground(16, 3) - 0.2, 3, -0.6);
    keepOut.push([4, 8, 3], [10, 5, 3], [-13, 5, 3]);
  } else {
    // Beach-hut village around a lagoon with a dock and moored boats.
    const LX = 9;
    const LZ = 5;
    const LR = 11;
    const waterY = groundRange(ground, LX, LZ, LR * 2 + 4, LR * 2 + 4).max + 0.25;
    lagoon(g, ground, LX, LZ, LR, waterY, foams);
    keepOut.push([LX, LZ, LR + 2]);
    const hutName = kitName(ctx, 'pirate', 'structure');
    const roofName = kitName(ctx, 'pirate', 'structure-roof');
    if (hutName) {
      const hs = ctx.kits.size('pirate', hutName);
      const k = 7.5 / hs.x;
      const hutSpots: Array<[number, number]> = [
        [-16, -6],
        [-5, -16],
        [8, -18],
        [-18, 7],
      ];
      for (const [hx, hz] of hutSpots) {
        const base = groundRange(ground, hx, hz, 7, 7).min - 0.3;
        const yaw = Math.atan2(-6 - hx, 2 - hz) + rng.range(-0.2, 0.2);
        const hut = ctx.kits.instantiate('pirate', hutName);
        hut.scale.setScalar(k);
        hut.position.set(hx, base, hz);
        hut.rotation.y = yaw;
        g.add(hut);
        if (roofName) {
          const roof = ctx.kits.instantiate('pirate', roofName);
          roof.scale.setScalar(k);
          roof.position.set(hx, base + hs.y * k - 0.2, hz);
          roof.rotation.y = yaw;
          g.add(roof);
        }
        keepOut.push([hx, hz, 6]);
      }
    }
    const dockName = kitName(ctx, 'pirate', 'structure-platform-dock');
    if (dockName) {
      const ds = ctx.kits.size('pirate', dockName);
      const k = 4.6 / ds.x;
      for (let i = 0; i < 3; i++) {
        const piece = ctx.kits.instantiate('pirate', dockName);
        piece.scale.setScalar(k);
        piece.position.set(LX - LR - 1 + i * ds.x * k * 0.98, waterY + 0.9 - ds.y * k, LZ);
        g.add(piece);
      }
      keepOut.push([LX - LR - 2, LZ, 4]);
    }
    const boats: Array<[string, number, number, number, number, number]> = [
      ['boat-row-large', 1.7, LX - 5, LZ + 3.4, 0.2, 0.45],
      ['boat-row-small', 1.5, LX - 7.5, LZ - 3.2, -0.3, 0.4],
      ['ship-small', 14, LX + 4, LZ + 1, 0.15, 1.7],
    ];
    boats.forEach(([name, h, x, z, yaw, sink], i) => {
      const o = kit(ctx, g, 'pirate', name, h, x, waterY - sink, z, yaw);
      if (o) bobbers.push({ o, y: waterY - sink, phase: i * 2.1 });
    });
    kit(ctx, g, 'pirate', 'barrel', 1.5, -6, ground(-6, 1), 1, 0.3);
    kit(ctx, g, 'pirate', 'barrel', 1.5, -7.3, ground(-7.3, 2.2), 2.2, 1.3);
    kit(ctx, g, 'pirate', 'crate', 1.2, -6.5, ground(-6.5, 8.8), 8.8, 0.7);
    kit(ctx, g, 'pirate', 'chest', 1.1, -10, ground(-10, -2), -2, 0.9);
    keepOut.push([-7, 3, 3]);
    // Village fire pit and tiki torches.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const x = -7 + Math.cos(a) * 1.4;
      const z = -6 + Math.sin(a) * 1.4;
      b.add(rockGeometry(rng, 0.45, 1, 0.7, 1, 0), '#9a9088', xf(x, ground(x, z) + 0.15, z));
    }
    b.add(new CylinderGeometry(0.15, 0.15, 2.2, 5).rotateZ(Math.PI / 2), '#6a4428', xf(-7, ground(-7, -6) + 0.25, -6, 0.6));
    b.add(new CylinderGeometry(0.15, 0.15, 2.2, 5).rotateZ(Math.PI / 2), '#6a4428', xf(-7, ground(-7, -6) + 0.35, -6, -0.6));
    keepOut.push([-7, -6, 3]);
    const torches: Array<[number, number, number]> = [];
    for (const [tx, tz] of [
      [-11, -11],
      [1, -11],
      [-12, 2],
      [-3, 6],
    ] as const) {
      torches.push([tx, ground(tx, tz) - 0.3, tz]);
    }
    tikiTorches(ctx, g, b, torches);
    fireAt(ctx, g, -7, ground(-7, -6) + 0.3, -6);
  }

  // Parasols and towels on the sand.
  const pcols: Array<[string, string, string]> = [
    ['#ff4f9a', '#fff6e6', '#3fc7e8'],
    ['#2ab7c9', '#fff6e6', '#ffd23f'],
    ['#ffb21a', '#fff6e6', '#ff6f61'],
  ];
  const parasolSpots: Array<[number, number]> = variant === 0 ? [[-14, 13], [-6, 15], [17, 12]] : [[-14, 15], [-5, 18], [-22, -1]];
  parasolSpots.forEach(([x, z], i) => {
    const [a, c, t] = pcols[i % pcols.length]!;
    parasol(b, x, ground(x, z) - 0.2, z, a, c, t, rng.range(-0.12, 0.12));
    keepOut.push([x + 0.6, z, 2.6]);
  });
  // Palms on the edge.
  for (let i = 0; i < 7; i++) {
    const a = rng.range(-Math.PI * 0.95, -Math.PI * 0.05);
    const d = rng.range(18, 25);
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (roadClearance(ctx, spot.position.x + x, spot.position.z + z) < 4 || keepOut.some(([kx, kz, kr]) => Math.hypot(kx - x, kz - z) < kr + 1)) continue;
    kit(ctx, g, 'pirate', i % 2 ? 'palm-bend' : 'palm-detailed-straight', rng.range(9, 13), x, ground(x, z) - 0.2, z, rng.range(0, 6.28));
  }
  if (!b.empty) g.add(b.build(TrackMaterials.vertexColor()));
  crabs(ctx, g, rng, ground, variant === 0 ? 7 : 6, keepOut);
  finish(g);
  ctx.add(g);

  ctx.updatables.push({
    update: (_dt, time) => {
      for (const { o, y, phase } of bobbers) {
        o.position.y = y + Math.sin(time * 1.1 + phase) * 0.18;
        o.rotation.z = Math.sin(time * 0.8 + phase) * 0.04;
        o.rotation.x = Math.sin(time * 0.6 + phase * 1.3) * 0.025;
      }
      if (flag) flag.rotation.y = -0.6 + Math.sin(time * 1.7) * 0.12;
      for (const f of foams) f.scale.setScalar(1 + Math.sin(time * 1.4) * 0.012);
    },
  });
}

// ------------------------------------------------------------------ boardwalk

const BOARDWALK_RADIUS = 32;
const DECK_W = 58;
const DECK_D = 13;
const WHEEL_R = 15;
const GONDOLAS = 12;
const GONDOLA_COLORS = ['#ff4f5a', '#ffd23f', '#3fa9f5', '#5ad66a', '#ff7ad0', '#ff9a2a'];

/** Ferris-wheel gondola hanging from its pivot at the origin (white body tinted per instance). */
function gondolaGeometry(): BufferGeometry {
  const b = new Batch();
  b.add(new CylinderGeometry(0.07, 0.07, 1.0).translate(0, -0.5, 0), '#3a3a44');
  b.add(new SphereGeometry(1.25, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.55, 1).translate(0, -1.05, 0), '#ffffff');
  b.add(new CylinderGeometry(1.0, 1.0, 0.25, 10).translate(0, -1.15, 0), '#ffffff');
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    b.add(new BoxGeometry(0.1, 1.3, 0.1).translate(Math.cos(a) * 0.95, -1.85, Math.sin(a) * 0.95), '#f4f1e8');
  }
  b.add(new CylinderGeometry(1.05, 0.9, 0.9, 10).translate(0, -2.75, 0), '#ffffff');
  return b.build(TrackMaterials.vertexColor()).geometry;
}

/** Seaside pier: plank deck on posts, a slowly turning Ferris wheel, stalls, banners and string lights. */
export function buildBoardwalk(ctx: BuildContext, p: LandmarkPlacement): void {
  const spot = placeSetPiece(ctx, p, BOARDWALK_RADIUS);
  if (!spot) return;
  const ground = groundFn(ctx, spot.position, spot.yaw);
  const g = new Group();
  g.name = 'boardwalk';
  g.position.copy(spot.position);
  g.rotation.y = spot.yaw;

  const range = groundRange(ground, 0, 0, DECK_W, DECK_D);
  const deckY = range.max + 1.8;
  const b = new Batch();
  // Deck planks, frame and posts.
  const planks = 14;
  for (let i = 0; i < planks; i++) {
    const z = -DECK_D / 2 + (i + 0.5) * (DECK_D / planks);
    b.add(new BoxGeometry(DECK_W, 0.35, DECK_D / planks - 0.06), i % 2 ? '#c49462' : '#b8875a', xf(0, deckY - 0.17, z));
  }
  b.add(new BoxGeometry(DECK_W + 0.4, 0.6, 0.4), '#7a5232', xf(0, deckY - 0.5, DECK_D / 2));
  b.add(new BoxGeometry(DECK_W + 0.4, 0.6, 0.4), '#7a5232', xf(0, deckY - 0.5, -DECK_D / 2));
  for (let x = -DECK_W / 2 + 1; x <= DECK_W / 2 - 1; x += 4.2) {
    for (const z of [-DECK_D / 2 + 0.4, 0, DECK_D / 2 - 0.4]) {
      const gy = ground(x, z) - 0.5;
      b.add(new CylinderGeometry(0.28, 0.32, deckY - gy, 6).translate(0, (deckY + gy) / 2, 0), '#6a4428', xf(x, 0, z));
    }
  }
  // Railings (front and back) and steps at both ends.
  for (const z of [-DECK_D / 2 + 0.2, DECK_D / 2 - 0.2]) {
    for (let x = -DECK_W / 2 + 0.3; x <= DECK_W / 2; x += 2.4) b.add(new BoxGeometry(0.16, 1.1, 0.16), '#f4f1e8', xf(x, deckY + 0.55, z));
    b.add(new BoxGeometry(DECK_W, 0.14, 0.14), '#f4f1e8', xf(0, deckY + 1.1, z));
    b.add(new BoxGeometry(DECK_W, 0.1, 0.1), '#f4f1e8', xf(0, deckY + 0.6, z));
  }
  for (const sx of [-1, 1]) {
    const ex = sx * (DECK_W / 2 + 0.5);
    const steps = Math.max(1, Math.round((deckY - ground(ex, 0)) / 0.45));
    for (let k = 0; k < steps; k++) {
      const x = ex + sx * k * 0.55;
      const h = deckY - (k + 1) * 0.45;
      const gy = ground(x, 0) - 0.3;
      if (h < gy) break;
      b.add(new BoxGeometry(0.6, h - gy + 0.3, 4).translate(0, (h + gy) / 2, 0), '#b8875a', xf(x, 0, 0));
    }
  }

  // Ferris wheel frame (static A-frames) at the west end.
  const WX = -DECK_W / 2 + WHEEL_R + 1;
  const WZ = -1.5;
  const hubY = deckY + WHEEL_R + 3.6;
  for (const sz of [-1, 1]) {
    for (const sx of [-1, 1]) {
      b.beam(new Vector3(WX + sx * 7.5, deckY, WZ + sz * 3.4), new Vector3(WX, hubY, WZ + sz * 2.1), 0.55, '#f4f1e8');
    }
    b.beam(new Vector3(WX - 5, deckY + 6, WZ + sz * 3.0), new Vector3(WX + 5, deckY + 6, WZ + sz * 3.0), 0.35, '#f4f1e8');
  }
  b.add(new BoxGeometry(17, 0.5, 8), '#e8413a', xf(WX, deckY + 0.25, WZ));
  // Ticket booth.
  b.add(new BoxGeometry(2.6, 2.6, 2.2).translate(0, 1.3, 0), '#ff4f9a', xf(WX + 9.8, deckY, WZ + 3.6));
  b.add(new ConeGeometry(2.1, 1.3, 4).rotateY(Math.PI / 4).translate(0, 3.25, 0), '#fff6e6', xf(WX + 9.8, deckY, WZ + 3.6));

  // Rotating wheel: rims, spokes, cross bars, hub, bulbs.
  const wheel = new Group();
  wheel.position.set(WX, hubY, WZ);
  const wb = new Batch();
  const bulbs = new Batch();
  for (const sz of [-1.7, 1.7]) {
    wb.add(new TorusGeometry(WHEEL_R, 0.32, 5, 48), '#f4f1e8', xf(0, 0, sz));
    wb.add(new TorusGeometry(WHEEL_R * 0.55, 0.2, 4, 32), '#ff4f9a', xf(0, 0, sz));
    for (let i = 0; i < GONDOLAS * 2; i++) {
      const a = (i / (GONDOLAS * 2)) * Math.PI * 2;
      wb.beam(new Vector3(0, 0, sz * 0.6), new Vector3(Math.cos(a) * WHEEL_R, Math.sin(a) * WHEEL_R, sz), 0.2, '#f4f1e8');
    }
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      bulbs.add(new IcosahedronGeometry(0.28, 0), GONDOLA_COLORS[i % GONDOLA_COLORS.length]!, xf(Math.cos(a) * (WHEEL_R + 0.35), Math.sin(a) * (WHEEL_R + 0.35), sz));
    }
  }
  for (let i = 0; i < GONDOLAS; i++) {
    const a = (i / GONDOLAS) * Math.PI * 2;
    wb.add(new CylinderGeometry(0.12, 0.12, 3.6, 5).rotateX(Math.PI / 2), '#3a3a44', xf(Math.cos(a) * WHEEL_R, Math.sin(a) * WHEEL_R, 0));
  }
  wb.add(new CylinderGeometry(1.3, 1.3, 4.6, 12).rotateX(Math.PI / 2), '#e8413a');
  wb.add(new CylinderGeometry(0.6, 0.6, 5.2, 8).rotateX(Math.PI / 2), '#ffd23f');
  wheel.add(wb.build(TrackMaterials.vertexColor()), bulbs.build(new MeshBasicMaterial({ vertexColors: true })));
  g.add(wheel);

  const gondolas = new InstancedMesh(gondolaGeometry(), TrackMaterials.vertexColor(), GONDOLAS);
  for (let i = 0; i < GONDOLAS; i++) gondolas.setColorAt(i, new Color(GONDOLA_COLORS[i % GONDOLA_COLORS.length]!));
  g.add(gondolas);

  // Stalls, cargo and banners on the east half.
  const stallH = 5.2;
  [
    ['stall-red', 6],
    ['stall-green', 13],
    ['stall-red', 20],
  ].forEach(([name, x]) => kit(ctx, g, 'town', name as string, stallH, x as number, deckY, -3.4, 0));
  kit(ctx, g, 'pirate', 'barrel', 1.4, 24.5, deckY, -4.6, 0.4);
  kit(ctx, g, 'pirate', 'barrel', 1.4, 25.6, deckY, -3.2, 1.1);
  kit(ctx, g, 'pirate', 'crate', 1.1, 2.4, deckY, -4.8, 0.3);
  kit(ctx, g, 'pirate', 'crate', 1.1, 2.6, deckY + 1.1, -4.6, 0.9);
  for (let i = 0; i < 4; i++) {
    const x = 4 + i * 7;
    b.add(new CylinderGeometry(0.14, 0.14, 7.5, 6).translate(0, 3.75, 0), '#f4f1e8', xf(x - 1.5, deckY, DECK_D / 2 - 0.3));
    kit(ctx, g, 'town', i % 2 ? 'banner-green' : 'banner-red', 3.6, x - 1.5, deckY + 3.8, DECK_D / 2 - 0.1, Math.PI / 2);
  }
  // Pier sign over the middle of the deck.
  const signX = 1;
  b.add(new CylinderGeometry(0.2, 0.2, 7, 6).translate(0, 3.5, 0), '#7a5232', xf(signX - 4.2, deckY, DECK_D / 2 - 0.5));
  b.add(new CylinderGeometry(0.2, 0.2, 7, 6).translate(0, 3.5, 0), '#7a5232', xf(signX + 4.2, deckY, DECK_D / 2 - 0.5));
  b.add(new BoxGeometry(9, 2.3, 0.4), '#2a4a9a', xf(signX, deckY + 6.2, DECK_D / 2 - 0.5));
  const sign = new Mesh(new PlaneGeometry(8.4, 1.9), new MeshStandardMaterial({ map: signTexture('SUNSET PIER', '#ff7a3a', '#fff6e6'), roughness: 0.7, emissive: '#ffffff', emissiveIntensity: 0.15 }));
  sign.position.set(signX, deckY + 6.2, DECK_D / 2 - 0.28);
  g.add(sign);

  // String lights sagging between poles along both rails.
  const lightPts: Vector3[] = [];
  for (const z of [-DECK_D / 2 + 0.25, DECK_D / 2 - 0.25]) {
    const poles: number[] = [];
    for (let x = -DECK_W / 2 + 0.5; x <= DECK_W / 2; x += 9.5) poles.push(x);
    for (const x of poles) b.add(new CylinderGeometry(0.12, 0.12, 5, 6).translate(0, 2.5, 0), '#3a3a44', xf(x, deckY, z));
    for (let k = 0; k + 1 < poles.length; k++) {
      const x0 = poles[k]!;
      const x1 = poles[k + 1]!;
      const n = 8;
      let prev = new Vector3(x0, deckY + 5, z);
      for (let j = 1; j <= n; j++) {
        const t = j / n;
        const pt = new Vector3(x0 + (x1 - x0) * t, deckY + 5 - Math.sin(Math.PI * t) * 1.1, z);
        b.beam(prev, pt, 0.05, '#2a2a30');
        if (j < n) lightPts.push(pt.clone().add(new Vector3(0, -0.22, 0)));
        prev = pt;
      }
    }
  }
  const lights = new InstancedMesh(new SphereGeometry(0.2, 6, 4), new MeshBasicMaterial({ color: '#ffffff' }), lightPts.length);
  const lm = new Matrix4();
  lightPts.forEach((pt, i) => {
    lights.setMatrixAt(i, lm.makeTranslation(pt.x, pt.y, pt.z));
    lights.setColorAt(i, new Color(GONDOLA_COLORS[i % GONDOLA_COLORS.length]!));
  });
  g.add(lights);
  g.add(b.build(TrackMaterials.vertexColor()));
  finish(g);
  ctx.add(g);

  const m = new Matrix4();
  const q = new Quaternion();
  const pos = new Vector3();
  const one = new Vector3(1, 1, 1);
  const axis = new Vector3(0, 0, 1);
  const bright = new Color();
  ctx.updatables.push({
    update: (dt, time) => {
      wheel.rotation.z += dt * 0.12;
      for (let i = 0; i < GONDOLAS; i++) {
        const a = wheel.rotation.z + (i / GONDOLAS) * Math.PI * 2;
        pos.set(WX + Math.cos(a) * WHEEL_R, hubY + Math.sin(a) * WHEEL_R, WZ);
        q.setFromAxisAngle(axis, Math.sin(time * 1.3 + i) * 0.05);
        gondolas.setMatrixAt(i, m.compose(pos, q, one));
      }
      gondolas.instanceMatrix.needsUpdate = true;
      // Chasing string lights.
      const step = Math.floor(time * 6);
      for (let i = 0; i < lightPts.length; i++) {
        bright.set(GONDOLA_COLORS[i % GONDOLA_COLORS.length]!);
        if ((i + step) % 4 === 0) bright.multiplyScalar(0.25);
        lights.setColorAt(i, bright);
      }
      if (lights.instanceColor) lights.instanceColor.needsUpdate = true;
    },
  });
}
