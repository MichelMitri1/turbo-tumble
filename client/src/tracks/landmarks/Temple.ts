import {
  BoxGeometry,
  BufferAttribute,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SphereGeometry,
  type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { LandmarkPlacement } from '@shared/types/track';
import { Noise2D } from '@shared/math/noise';
import { SeededRandom } from '@shared/math/random';
import type { BuildContext } from '../BuildContext';
import { TrackMaterials } from '../materials';
import { placeSetPiece, roadClearance, type ResolvedPlacement } from './placement';

const PYRAMID_RADIUS = 40;
const IDOL_RADIUS = 16;
/** The idol head is modelled ~15 m tall (above the mound) and scaled up to ~22 m. */
const HEAD_SCALE = 1.45;
const TIERS = 7;
const TIER_H = 3.4;
const BASE_HALF = 25;
const TOP_HALF = 8;
const STAIR_HALF = 4.5;
const STONE = '#b8ad90';
const STONE_DARK = '#8f8670';
const MOSS = '#5f9a3a';
const MOSS_DARK = '#3f7a2e';
const WOOD = '#6b4a30';

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

function box(w: number, h: number, d: number, x: number, y: number, z: number, color: string): BufferGeometry {
  return tint(new BoxGeometry(w, h, d).translate(x, y, z), color);
}

/** Per-face moss: faces pointing up or sitting in noisy patches turn green. */
function mossify(geo: BufferGeometry, noise: Noise2D, amount: number, ox = 0, oz = 0): BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.computeVertexNormals();
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const col = g.getAttribute('color') ?? new BufferAttribute(new Float32Array(pos.count * 3), 3);
  const c = new Color();
  const moss = new Color(MOSS);
  const mossDark = new Color(MOSS_DARK);
  for (let i = 0; i < pos.count; i += 3) {
    const x = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3 + ox;
    const y = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
    const z = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3 + oz;
    const n = noise.noise(x * 0.18 + y * 0.1, z * 0.18 - y * 0.07);
    const up = nor.getY(i);
    c.setRGB(col.getX(i), col.getY(i), col.getZ(i));
    if (n + up * 0.45 > 1 - amount) c.copy(n > 0.5 ? mossDark : moss);
    for (let k = 0; k < 3; k++) col.setXYZ(i + k, c.r, c.g, c.b);
  }
  g.setAttribute('color', col);
  return g;
}

let FLAME_OUTER: MeshBasicMaterial | null = null;
let FLAME_INNER: MeshBasicMaterial | null = null;
let flameCount = 0;

/** Brazier / torch flame: an outer and inner cone that flicker via `flicker`. */
function flame(size: number): Group {
  const f = new Group();
  FLAME_OUTER ??= new MeshBasicMaterial({ color: '#ff3c00', transparent: true, opacity: 0.9 });
  FLAME_INNER ??= new MeshBasicMaterial({ color: '#ffc21a' });
  const outer = new Mesh(new ConeGeometry(0.9 * size, 2.6 * size, 6), FLAME_OUTER);
  outer.position.y = 1.3 * size;
  const inner = new Mesh(new ConeGeometry(0.55 * size, 1.9 * size, 5), FLAME_INNER);
  inner.position.y = 0.95 * size;
  f.add(outer, inner);
  f.userData.phase = (flameCount++ * 2.39) % 10;
  return f;
}

function flicker(flames: Group[], time: number): void {
  for (const f of flames) {
    const ph = f.userData.phase as number;
    f.scale.set(1 + Math.sin(time * 11 + ph) * 0.08, 1 + Math.sin(time * 13 + ph) * 0.18 + Math.sin(time * 7.3 + ph * 2) * 0.1, 1 + Math.cos(time * 9 + ph) * 0.08);
    f.rotation.y = time * 2 + ph;
  }
}

/** Local → ground height helper for a resolved set-piece spot. */
function groundSampler(ctx: BuildContext, spot: ResolvedPlacement): (x: number, z: number) => number {
  const cos = Math.cos(spot.yaw);
  const sin = Math.sin(spot.yaw);
  return (x, z) => ctx.terrain.sample(spot.position.x + x * cos + z * sin, spot.position.z - x * sin + z * cos) - spot.position.y;
}

/**
 * placeSetPiece, then (on tracks with water) pushed further out — along the
 * anchor's side first, then spiralling — until the whole footprint is dry land.
 */
function placeDry(ctx: BuildContext, p: LandmarkPlacement, radius: number): ResolvedPlacement | null {
  const spot = placeSetPiece(ctx, p, radius);
  const water = ctx.def.terrain.waterLevel;
  if (!spot || water === null) return spot;
  const dry = (x: number, z: number): boolean => {
    for (let a = 0; a < 8; a++) {
      const r = a === 0 ? 0 : radius * 0.9;
      if (ctx.terrain.sample(x + Math.cos(a) * r, z + Math.sin(a) * r) < water + 1.5) return false;
    }
    return true;
  };
  if (dry(spot.position.x, spot.position.z)) return spot;
  const own = ctx.footprints.pop()!;
  const ok = (x: number, z: number): boolean =>
    roadClearance(ctx, x, z) > radius + 4 && dry(x, z) && !ctx.footprints.some((f) => Math.hypot(f.x - x, f.z - z) < f.r + radius * 0.8);
  const candidates: Array<[number, number]> = [];
  const dir = spot.frame && spot.side ? spot.frame.sample.flatRight.clone().multiplyScalar(spot.side) : null;
  if (dir) for (let k = 6; k <= 200; k += 6) candidates.push([spot.position.x + dir.x * k, spot.position.z + dir.z * k]);
  for (let r = 8; r <= 200; r += 8) {
    const steps = Math.round((2 * Math.PI * r) / 10);
    for (let i = 0; i < steps; i++) candidates.push([spot.position.x + Math.cos((i / steps) * Math.PI * 2) * r, spot.position.z + Math.sin((i / steps) * Math.PI * 2) * r]);
  }
  const hit = candidates.find(([x, z]) => ok(x, z));
  if (!hit) {
    ctx.footprints.push(own);
    return spot;
  }
  const [x, z] = hit;
  ctx.footprints.push({ x, z, r: radius });
  spot.position.set(x, ctx.terrain.sample(x, z), z);
  if (spot.frame) spot.yaw = Math.atan2(spot.frame.position.x - x, spot.frame.position.z - z);
  return spot;
}

function finish(g: Group): void {
  g.traverse((o) => {
    if ((o as Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
}

/**
 * Temple Ruins' Mayan step pyramid: seven mossy sloped tiers, a central stair
 * between serpent-headed balustrades, a temple house with a roof comb and
 * flickering braziers on top, and carved columns and stelae round the plaza.
 */
export function buildStepPyramid(ctx: BuildContext, p: LandmarkPlacement): void {
  const spot = placeDry(ctx, p, PYRAMID_RADIUS);
  if (!spot) return;
  const groundAt = groundSampler(ctx, spot);
  const noise = new Noise2D(ctx.def.terrain.seed + 81);
  const rng = new SeededRandom(ctx.def.terrain.seed + 82);
  const g = new Group();
  g.name = 'stepPyramid';
  g.position.copy(spot.position);
  g.rotation.y = spot.yaw;
  let low = Infinity;
  let sum = 0;
  for (let i = -2; i <= 2; i++) {
    for (let j = -2; j <= 2; j++) {
      const h = groundAt((i / 2) * BASE_HALF, (j / 2) * BASE_HALF);
      low = Math.min(low, h);
      sum += h;
    }
  }
  const y0 = sum / 25;
  const parts: BufferGeometry[] = [];

  // Sloped tiers (square frustums), each with a darker recessed band.
  for (let k = 0; k < TIERS; k++) {
    const hb = BASE_HALF - ((BASE_HALF - TOP_HALF) * k) / TIERS;
    const ht = BASE_HALF - ((BASE_HALF - TOP_HALF) * (k + 0.8)) / TIERS;
    const bottom = k === 0 ? low - 2 : y0 + k * TIER_H;
    const h = y0 + (k + 1) * TIER_H - bottom;
    const tier = new CylinderGeometry(ht * Math.SQRT2, hb * Math.SQRT2, h, 4, 2);
    tier.rotateY(Math.PI / 4);
    parts.push(tint(tier.translate(0, bottom + h / 2, 0), k % 2 ? STONE : '#c2b797'));
    const band = new CylinderGeometry(ht * Math.SQRT2 + 0.3, ht * Math.SQRT2 + 0.3, 0.6, 4);
    band.rotateY(Math.PI / 4);
    parts.push(tint(band.translate(0, y0 + (k + 1) * TIER_H - 0.3, 0), STONE_DARK));
  }
  const top = y0 + TIERS * TIER_H;
  const topHalf = BASE_HALF - ((BASE_HALF - TOP_HALF) * (TIERS - 0.2)) / TIERS;

  // Central stair: stacked slabs, flanked by balustrades ending in serpent heads.
  const run = (BASE_HALF - topHalf) / (TIERS * 3);
  for (let i = 0; i < TIERS * 3; i++) {
    const zFront = BASE_HALF + 1 - i * run;
    const yb = i === 0 ? low - 1 : y0 + (i * TIER_H) / 3;
    const yt = y0 + ((i + 1) * TIER_H) / 3;
    parts.push(box(STAIR_HALF * 2, yt - yb, zFront - topHalf + 1, 0, (yt + yb) / 2, (zFront + topHalf - 1) / 2, i % 2 ? '#cfc5a6' : '#c4b998'));
  }
  const slope = Math.atan2(top - y0, BASE_HALF + 1 - topHalf);
  const balLen = Math.hypot(top - y0, BASE_HALF + 1 - topHalf);
  for (const sx of [-1, 1]) {
    const bal = new BoxGeometry(1.4, 1.6, balLen);
    bal.rotateX(slope);
    parts.push(tint(bal.translate(sx * (STAIR_HALF + 0.7), (top + y0) / 2 + 0.8, (BASE_HALF + 1 + topHalf) / 2), STONE_DARK));
    // Serpent head at the foot of each balustrade.
    const hx = sx * (STAIR_HALF + 0.7);
    const hz = BASE_HALF + 2.2;
    parts.push(box(2.6, 2.2, 3.2, hx, y0 + 1.3, hz, '#9a9076'));
    parts.push(box(2.4, 0.7, 2.4, hx, y0 + 0.3, hz + 0.9, '#857c64'));
    for (const ex of [-0.8, 0.8]) parts.push(box(0.5, 0.5, 0.3, hx + ex, y0 + 1.9, hz + 1.65, '#2a3a2a'));
    for (const fx of [-0.7, 0.7]) parts.push(tint(new ConeGeometry(0.18, 0.7, 4).rotateX(Math.PI).translate(hx + fx, y0 + 0.6, hz + 1.5), '#efe8d0'));
  }

  // Temple house with doorway, painted frieze and roof comb.
  parts.push(box(13, 6.5, 9, 0, top + 3.25, -1, STONE));
  parts.push(box(13.6, 1.2, 9.6, 0, top + 6.1, -1, '#b0423a'));
  parts.push(box(14, 0.8, 10, 0, top + 7.1, -1, STONE_DARK));
  parts.push(box(3, 4.2, 0.6, 0, top + 2.1, 3.3, '#1d1a16'));
  for (const sx of [-3.8, 3.8]) parts.push(box(1.6, 4.2, 0.6, sx, top + 2.1, 3.3, '#1d1a16'));
  for (let k = 0; k < 4; k++) parts.push(box(9 - k * 1.8, 1.4, 1.2, 0, top + 8.2 + k * 1.4, -1, k % 2 ? STONE : '#c9bf9f'));
  for (const sx of [-3, 0, 3]) parts.push(box(0.8, 0.8, 1.3, sx, top + 9.6, -1, '#2a2620'));

  // Braziers on the summit and at the foot of the stair.
  const flames: Group[] = [];
  const brazier = (x: number, y: number, z: number, s: number): void => {
    parts.push(tint(new CylinderGeometry(0.6 * s, 0.9 * s, 1.6 * s, 6).translate(x, y + 0.8 * s, z), STONE_DARK));
    parts.push(tint(new CylinderGeometry(1.3 * s, 0.7 * s, 0.9 * s, 8).translate(x, y + 2 * s, z), '#6a5f4c'));
    const f = flame(s);
    f.position.set(x, y + 2.2 * s, z);
    flames.push(f);
    g.add(f);
  };
  for (const sx of [-1, 1]) {
    brazier(sx * 6, top, 4.8, 1);
    brazier(sx * (STAIR_HALF + 4.5), groundAt(sx * (STAIR_HALF + 4.5), BASE_HALF + 3), BASE_HALF + 3, 1.3);
  }

  // Columns (some broken) and carved stelae round the plaza.
  const column = (x: number, z: number, h: number, broken: boolean): void => {
    const gy = groundAt(x, z);
    parts.push(box(2.6, 1, 2.6, x, gy + 0.3, z, STONE_DARK));
    const shaft = new CylinderGeometry(0.9, 1, h, 8, 3);
    if (broken) shaft.rotateZ(rng.range(-0.08, 0.08));
    parts.push(mossify(tint(shaft.translate(x, gy + h / 2 + 0.6, z), STONE), noise, 0.35));
    for (let k = 1; k < 4; k++) parts.push(tint(new CylinderGeometry(1.05, 1.05, 0.35, 8).translate(x, gy + 0.6 + (h * k) / 4, z), STONE_DARK));
    if (!broken) parts.push(box(2.8, 1, 2.8, x, gy + h + 1, z, '#a49a80'));
  };
  for (const sx of [-1, 1]) {
    column(sx * 12, 31, 9, false);
    column(sx * 20, 30, rng.range(4, 6), true);
    column(sx * 31, 8, 9, false);
    column(sx * 32, -6, rng.range(3, 5), true);
    // Stela: carved slab with relief blocks.
    const stx = sx * 31.5;
    const stz = 20;
    const gy = groundAt(stx, stz);
    parts.push(mossify(box(3, 7, 1.2, stx, gy + 3.2, stz, '#a99f84'), noise, 0.3));
    for (let k = 0; k < 3; k++) parts.push(box(1.8, 0.9, 0.3, stx, gy + 1.8 + k * 1.8, stz + 0.7, k === 1 ? '#7f765f' : '#c2b797'));
  }
  // Fallen column drums.
  for (let i = 0; i < 4; i++) {
    const x = rng.range(-28, 28);
    const z = rng.range(27, 33);
    if (Math.abs(x) < STAIR_HALF + 7) continue;
    const drum = new CylinderGeometry(1, 1, rng.range(1.5, 2.5), 8).rotateZ(Math.PI / 2).rotateY(rng.range(0, Math.PI));
    parts.push(tint(drum.translate(x, groundAt(x, z) + 0.8, z), STONE));
  }

  const body = mossify(mergeGeometries(parts), noise, 0.22);
  const mesh = new Mesh(body, TrackMaterials.shell());
  g.add(mesh);

  // Vines hanging down the tier faces.
  const vines: BufferGeometry[] = [];
  for (let i = 0; i < 26; i++) {
    const k = rng.int(1, TIERS - 1);
    const half = BASE_HALF - ((BASE_HALF - TOP_HALF) * (k - 0.2)) / TIERS;
    const face = rng.int(0, 3);
    const along = rng.range(-half + 2, half - 2);
    if (face === 0 && Math.abs(along) < STAIR_HALF + 2) continue;
    const len = rng.range(2, TIER_H * 1.8);
    const v = new BoxGeometry(0.5, len, 0.25).translate(along, y0 + k * TIER_H - len / 2, half + 0.2);
    v.rotateY((face * Math.PI) / 2);
    vines.push(tint(v, i % 2 ? MOSS : MOSS_DARK));
  }
  g.add(new Mesh(mergeGeometries(vines), TrackMaterials.shell()));
  finish(g);
  ctx.add(g);
  ctx.updatables.push({ update: (_dt, time) => flicker(flames, time) });
}

/**
 * Jungle Falls' idol: a giant mossy Olmec-style stone head half sunk in a
 * grassy mound, eyes glowing and pulsing, flanked by two flickering torches.
 */
export function buildIdol(ctx: BuildContext, p: LandmarkPlacement): void {
  const spot = placeDry(ctx, p, IDOL_RADIUS);
  if (!spot) return;
  const groundAt = groundSampler(ctx, spot);
  const noise = new Noise2D(ctx.def.terrain.seed + 91);
  const g = new Group();
  g.name = 'idol';
  g.position.copy(spot.position);
  g.rotation.y = spot.yaw;
  let low = Infinity;
  let high = -Infinity;
  for (let a = 0; a < 12; a++) {
    for (const r of [0, 6, 12]) {
      const h = groundAt(Math.cos(a) * r, Math.sin(a) * r);
      low = Math.min(low, h);
      high = Math.max(high, h);
    }
  }
  const gy = high;
  // Earth mound the head is sunk into.
  const mound = new CylinderGeometry(12, IDOL_RADIUS - 1, gy - low + 3, 14, 2);
  g.add(new Mesh(mossify(tint(mound.translate(0, (gy + low - 3) / 2 + 0.5, 0), '#6b5a3e'), noise, 0.7), TrackMaterials.shell()));
  // The head is modelled at unit scale around its own base, then scaled up.
  const headGroup = new Group();
  headGroup.position.y = gy;
  headGroup.scale.setScalar(HEAD_SCALE);
  g.add(headGroup);
  const parts: BufferGeometry[] = [];

  // Head: faceted rounded block, face flattened at the front.
  const HX = 7;
  const HY = 10;
  const HZ = 6.5;
  const cy = 6.5;
  const head = new IcosahedronGeometry(1, 2);
  head.scale(HX, HY, HZ);
  const hp = head.getAttribute('position');
  for (let i = 0; i < hp.count; i++) {
    const z = hp.getZ(i);
    if (z > HZ * 0.7) hp.setZ(i, HZ * 0.7);
    if (hp.getY(i) < -HY * 0.6) hp.setY(i, -HY * 0.6);
  }
  parts.push(tint(head.translate(0, cy, 0), '#9d9a86'));
  const faceZ = HZ * 0.7;
  // Helmet with a forehead band and ear flaps with spools.
  const helmet = new SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  helmet.scale(HX * 1.08, HY * 0.62, HZ * 1.08);
  parts.push(tint(helmet.translate(0, cy + HY * 0.28, -0.2), '#8c8a76'));
  parts.push(box(HX * 1.75, 1.6, 1.4, 0, cy + HY * 0.3, faceZ + 0.2, '#7d7b68'));
  for (let k = -2; k <= 2; k++) parts.push(box(1.1, 1.1, 0.6, k * 2.6, cy + HY * 0.3, faceZ + 1.1, '#a8a690'));
  for (const sx of [-1, 1]) {
    parts.push(box(1.6, 6, 3.6, sx * (HX - 0.2), cy - 0.5, 0.5, '#8c8a76'));
    parts.push(tint(new CylinderGeometry(1.3, 1.3, 0.8, 10).rotateZ(Math.PI / 2).translate(sx * (HX + 0.7), cy - 0.6, 0.8), '#a8a690'));
  }
  // Face: heavy brow, sunken eye sockets, broad nose, thick lips.
  parts.push(box(10, 1.3, 1.6, 0, cy + 1.9, faceZ + 0.4, '#a3a08b'));
  for (const sx of [-1, 1]) parts.push(box(3, 1.8, 0.6, sx * 2.4, cy + 0.6, faceZ + 0.05, '#2a2a24'));
  const nose = new CylinderGeometry(0.9, 2.1, 3.6, 4).rotateY(Math.PI / 4);
  nose.scale(1, 1, 0.6);
  parts.push(tint(nose.translate(0, cy - 1.4, faceZ + 0.7), '#a3a08b'));
  parts.push(box(5.2, 1.2, 1.8, 0, cy - 3.9, faceZ + 0.6, '#96937e'));
  parts.push(box(4.8, 1.1, 1.6, 0, cy - 5.1, faceZ + 0.5, '#8c8a76'));
  parts.push(box(4.2, 0.35, 0.4, 0, cy - 4.5, faceZ + 1.2, '#2a2a24'));
  // Mossy, weathered stone; hanging vines.
  const headMesh = new Mesh(mossify(mergeGeometries(parts), noise, 0.4), TrackMaterials.shell());
  headGroup.add(headMesh);
  const vines: BufferGeometry[] = [];
  for (let i = 0; i < 14; i++) {
    const a = -1.4 + (i / 13) * 2.8;
    const len = 3 + ((i * 37) % 7);
    const x = Math.sin(a) * HX * 1.02;
    const z = Math.cos(a) * HZ * 0.95;
    if (Math.abs(x) < 3.5 && z > 0) continue;
    vines.push(tint(new BoxGeometry(0.4, len, 0.3).translate(x, cy + HY * 0.45 - len / 2, Math.min(z, faceZ + 0.3)), i % 2 ? MOSS : MOSS_DARK));
  }
  headGroup.add(new Mesh(mergeGeometries(vines), TrackMaterials.shell()));

  // Glowing eyes (their own material so they can pulse).
  const eyeMat = new MeshStandardMaterial({ color: '#7dffcf', emissive: new Color('#38ffb0'), emissiveIntensity: 2, roughness: 0.3 });
  const eyes = new Mesh(
    mergeGeometries([-1, 1].map((sx) => new SphereGeometry(0.75, 10, 6).scale(1.3, 0.8, 0.5).translate(sx * 2.4, cy + 0.6, faceZ + 0.35))),
    eyeMat,
  );
  headGroup.add(eyes);

  // Torches either side.
  const flames: Group[] = [];
  const posts: BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    const x = sx * 13.5;
    const z = 6;
    const y = groundAt(x, z);
    posts.push(tint(new CylinderGeometry(0.3, 0.4, 7, 6).translate(x, y + 3.2, z), WOOD));
    posts.push(tint(new CylinderGeometry(1.1, 0.6, 1, 8).translate(x, y + 7, z), '#4a3b2c'));
    for (let k = 0; k < 3; k++) posts.push(tint(new CylinderGeometry(0.45, 0.45, 0.25, 6).translate(x, y + 1.5 + k * 1.8, z), '#3d6a2c'));
    const f = flame(1.4);
    f.position.set(x, y + 7.4, z);
    flames.push(f);
    g.add(f);
  }
  g.add(new Mesh(mergeGeometries(posts), TrackMaterials.shell()));
  finish(g);
  eyes.castShadow = false;
  ctx.add(g);
  ctx.updatables.push({
    update: (_dt, time) => {
      flicker(flames, time);
      eyeMat.emissiveIntensity = 1.6 + Math.pow((Math.sin(time * 1.4) + 1) / 2, 3) * 3;
    },
  });
}
