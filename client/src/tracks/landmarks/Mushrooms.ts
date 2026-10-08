import {
  BufferAttribute,
  Color,
  CubicBezierCurve3,
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
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3,
  type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { LandmarkPlacement } from '@shared/types/track';
import { SeededRandom } from '@shared/math/random';
import type { BuildContext } from '../BuildContext';
import { placeSetPiece, roadClearance } from './placement';

/** Clearance between the road and the lowest point of an arching cap (karts fly up to ~10 m). */
const ARCH_CLEAR = 14;
/** Stem foot sits this far outside the wall. */
const STEM_OUT = 4;
const START_CLEAR = 80;
const JUMP_CLEAR = 70;
const GROVE_RADIUS = 30;
const FIREFLIES = 70;
/** Cap dome: polar extent of the sphere segment and vertical squash. */
const CAP_THETA = 1.25;
const CAP_SQUASH = 0.8;
const STEM = '#f4e6d4';

interface CapStyle {
  cap: string;
  spot: string;
  gill: string;
}

const STYLES: CapStyle[] = [
  { cap: '#ff4f8b', spot: '#fff6c8', gill: '#ffd0e0' },
  { cap: '#9257ff', spot: '#8ff8ff', gill: '#e0cfff' },
  { cap: '#26c6b4', spot: '#ffb0ec', gill: '#c8fff4' },
];

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

/** Curved stem from `foot` to `top`: a tube tapering upwards with a flared foot and collar. */
function stem(foot: Vector3, top: Vector3, radius: number): BufferGeometry {
  const h = top.y - foot.y;
  const curve = new CubicBezierCurve3(
    foot,
    new Vector3(foot.x, foot.y + h * 0.55, foot.z),
    new Vector3(top.x + (foot.x - top.x) * 0.2, top.y - h * 0.25, top.z + (foot.z - top.z) * 0.2),
    top,
  );
  const tubular = 16;
  const radial = 10;
  const geo = new TubeGeometry(curve, tubular, 1, radial, false);
  const pos = geo.getAttribute('position');
  const centre = new Vector3();
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    const t = Math.floor(i / (radial + 1)) / tubular;
    curve.getPointAt(t, centre);
    const r = radius * (1.15 - t * 0.45 + Math.pow(1 - t, 6) * 0.7 + Math.pow(t, 10) * 0.5);
    v.fromBufferAttribute(pos, i).sub(centre).multiplyScalar(r).add(centre);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return tint(geo, STEM);
}

/** Cap with origin at the centre of its rim: dome, rounded lip and striped gills underneath. */
function capBody(rimR: number, style: CapStyle): BufferGeometry {
  const R = rimR / Math.sin(CAP_THETA);
  const dome = new SphereGeometry(R, 28, 9, 0, Math.PI * 2, 0, CAP_THETA);
  dome.translate(0, -R * Math.cos(CAP_THETA), 0);
  dome.scale(1, CAP_SQUASH, 1);
  const lip = new TorusGeometry(rimR, Math.max(0.5, rimR * 0.05), 6, 28);
  lip.rotateX(Math.PI / 2);
  const gills = new CylinderGeometry(rimR * 0.18, rimR * 0.98, rimR * 0.18, 28, 1, true).toNonIndexed();
  gills.translate(0, rimR * 0.09 + 0.1, 0);
  const gc = new Float32Array(gills.getAttribute('position').count * 3);
  const light = new Color(style.gill);
  const dark = light.clone().lerp(new Color(style.cap), 0.45);
  const gp = gills.getAttribute('position');
  for (let i = 0; i < gp.count; i += 3) {
    const a = Math.atan2(gp.getZ(i) + gp.getZ(i + 1) + gp.getZ(i + 2), gp.getX(i) + gp.getX(i + 1) + gp.getX(i + 2));
    const c = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 28) % 2 ? light : dark;
    for (let k = 0; k < 3; k++) gc.set([c.r, c.g, c.b], (i + k) * 3);
  }
  gills.setAttribute('color', new BufferAttribute(gc, 3));
  return mergeGeometries([tint(dome, style.cap), tint(lip, new Color(style.cap).multiplyScalar(0.8)), gills]);
}

/** Glowing spots scattered over a cap made by capBody. */
function capSpots(rimR: number, rng: SeededRandom, count: number): BufferGeometry {
  const R = rimR / Math.sin(CAP_THETA);
  const spots: BufferGeometry[] = [];
  const n = new Vector3();
  const q = new Quaternion();
  for (let i = 0; i < count; i++) {
    const theta = Math.acos(1 - rng.next() * (1 - Math.cos(CAP_THETA * 0.88)));
    const phi = rng.range(0, Math.PI * 2);
    n.set(Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi));
    const s = rimR * rng.range(0.07, 0.13);
    const spot = new SphereGeometry(s, 8, 4);
    spot.scale(1, 0.3, 1);
    spot.applyQuaternion(q.setFromUnitVectors(new Vector3(0, 1, 0), n));
    spot.translate(n.x * R, (n.y * R - R * Math.cos(CAP_THETA)) * CAP_SQUASH, n.z * R);
    spots.push(spot);
  }
  return mergeGeometries(spots);
}

/** One breathing cap (body + spots) parented to a group at its rim centre. */
function makeCap(at: Vector3, rimR: number, style: CapStyle, bodyMat: MeshStandardMaterial, spotMat: MeshStandardMaterial, rng: SeededRandom): Group {
  const cap = new Group();
  cap.position.copy(at);
  const body = new Mesh(capBody(rimR, style), bodyMat);
  body.castShadow = true;
  body.receiveShadow = true;
  const spots = new Mesh(capSpots(rimR, rng, Math.round(10 + rimR * 0.9)), spotMat);
  cap.add(body, spots);
  cap.userData.phase = rng.range(0, Math.PI * 2);
  return cap;
}

/** Breathing pulse: caps swell sideways and settle (about their rim, so clearance never drops). */
function breathe(caps: Group[], time: number): void {
  for (const c of caps) {
    const s = Math.sin(time * 1.3 + (c.userData.phase as number)) * 0.035;
    c.scale.set(1 + s, 1 - s * 0.8, 1 + s);
  }
}

/**
 * Mushroom Hollow's toadstools. With `count` > 0: giant mushrooms whose curved
 * stems stand just outside the wall and whose glowing caps arch high over the
 * road at points spread round the lap. With `grove`: a cluster of huge
 * luminous mushrooms beside the track with fireflies drifting between them.
 */
export function buildGiantMushrooms(ctx: BuildContext, p: LandmarkPlacement): void {
  const rng = new SeededRandom(ctx.def.terrain.seed + 71 + (p.params?.grove ? 7 : 0));
  const bodyMats = new Map<string, MeshStandardMaterial>();
  const bodyMat = (style: CapStyle, glow: number): MeshStandardMaterial => {
    let m = bodyMats.get(style.cap);
    if (!m) bodyMats.set(style.cap, (m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.55, side: DoubleSide, emissive: new Color(style.cap), emissiveIntensity: glow })));
    return m;
  };
  const spotMats = new Map<string, MeshStandardMaterial>();
  const spotMat = (style: CapStyle): MeshStandardMaterial => {
    let m = spotMats.get(style.spot);
    if (!m) spotMats.set(style.spot, (m = new MeshStandardMaterial({ color: style.spot, emissive: new Color(style.spot), emissiveIntensity: 1.6, roughness: 0.4 })));
    return m;
  };
  const caps: Group[] = [];
  const stems: BufferGeometry[] = [];
  const count = Number(p.params?.count ?? 0);
  if (count > 0) buildArches(ctx, count, rng, stems, caps, (s) => bodyMat(s, 0.12), spotMat);
  let fireflies: InstancedMesh | null = null;
  let flyCentre = new Vector3();
  if (p.params?.grove) {
    const spot = placeSetPiece(ctx, p, GROVE_RADIUS);
    if (spot) {
      flyCentre = spot.position.clone();
      buildGrove(ctx, spot.position, rng, stems, caps, (s) => bodyMat(s, 0.55), spotMat);
      fireflies = new InstancedMesh(new IcosahedronGeometry(0.35, 0), new MeshBasicMaterial({ color: new Color('#eaff7a').multiplyScalar(2) }), FIREFLIES);
      fireflies.frustumCulled = false;
      ctx.add(fireflies);
    }
  }
  if (!caps.length) return;
  const stemMesh = new Mesh(mergeGeometries(stems), new MeshStandardMaterial({ vertexColors: true, roughness: 0.8, emissive: new Color('#ffd6f0'), emissiveIntensity: 0.08 }));
  stemMesh.name = 'mushroom-stems';
  stemMesh.castShadow = true;
  stemMesh.receiveShadow = true;
  ctx.add(stemMesh);
  for (const c of caps) ctx.add(c);

  const flies = Array.from({ length: FIREFLIES }, () => ({
    x: rng.range(-GROVE_RADIUS, GROVE_RADIUS),
    z: rng.range(-GROVE_RADIUS, GROVE_RADIUS),
    y: rng.range(1.5, 12),
    f: rng.range(0.2, 0.5),
    ph: rng.range(0, Math.PI * 2),
  }));
  const m = new Matrix4();
  const q = new Quaternion();
  const sv = new Vector3();
  const pv = new Vector3();
  ctx.updatables.push({
    update: (_dt, time) => {
      breathe(caps, time);
      for (const mat of spotMats.values()) mat.emissiveIntensity = 1.4 + Math.sin(time * 2.1) * 0.5;
      if (!fireflies) return;
      flies.forEach((f, i) => {
        const t = time * f.f + f.ph;
        pv.set(flyCentre.x + f.x + Math.sin(t * 1.3) * 4, flyCentre.y + f.y + Math.sin(t * 2.1) * 1.5, flyCentre.z + f.z + Math.cos(t) * 4);
        sv.setScalar(0.4 + Math.max(0, Math.sin(time * 3 + f.ph * 3)) * 0.9);
        fireflies.setMatrixAt(i, m.compose(pv, q, sv));
      });
      fireflies.instanceMatrix.needsUpdate = true;
    },
  });
}

/** Giant toadstools arching over the road at `count` spots spread round the lap. */
function buildArches(
  ctx: BuildContext,
  count: number,
  rng: SeededRandom,
  stems: BufferGeometry[],
  caps: Group[],
  bodyMat: (s: CapStyle) => MeshStandardMaterial,
  spotMat: (s: CapStyle) => MeshStandardMaterial,
): void {
  const { path, terrain, def } = ctx;
  const L = path.length;
  const trail = def.shortcuts.flatMap((sc) => path.shortcutPoints(sc).map((pt) => ({ pt, r: sc.halfWidth })));
  const blocked = (d: number): boolean => {
    if (d < START_CLEAR || d > L - START_CLEAR) return true;
    if (def.jumps.some((j) => d > j.distance - 25 && d < j.distance + j.length + JUMP_CLEAR)) return true;
    if ((def.gaps ?? []).some((gp) => d > gp.distance - 25 && d < gp.distance + gp.length + JUMP_CLEAR)) return true;
    for (let o = -25; o <= 25; o += 5) {
      const s = path.frameAtSplineDistance(path.startDistance + d + o).sample;
      if (s.kind !== 'ground' || s.open) return true;
    }
    return false;
  };
  const placed: Vector3[] = [];
  let side = rng.chance(0.5) ? 1 : -1;
  for (let k = 0; k < count; k++) {
    const target = (L * (k + 0.5)) / count;
    let done = false;
    for (let step = 0; step <= 12 && !done; step++) {
      const off = (step % 2 ? 1 : -1) * Math.ceil(step / 2) * 10;
      const d = target + off;
      if (blocked(d)) continue;
      for (const sd of [side, -side]) {
        const f = path.frameAtSplineDistance(path.startDistance + d);
        const right = f.sample.flatRight;
        const foot = f.position.clone().addScaledVector(right, sd * (f.wallOffset + STEM_OUT));
        if (roadClearance(ctx, foot.x, foot.z) < STEM_OUT - 0.5) continue;
        if (trail.some((t) => Math.hypot(t.pt.x - foot.x, t.pt.z - foot.z) < t.r + 6)) continue;
        if (placed.some((q) => Math.hypot(q.x - foot.x, q.z - foot.z) < 60)) continue;
        const rimR = f.halfWidth + 6;
        const centre = f.position.clone().addScaledVector(right, sd * f.wallOffset * 0.5);
        // Rim height clears every bit of road under (or near) the cap.
        let roadTop = f.position.y;
        for (const s of path.samples) {
          if (Math.hypot(s.position.x - centre.x, s.position.z - centre.z) < rimR + s.wallOffset) roadTop = Math.max(roadTop, s.position.y);
        }
        const rimY = roadTop + ARCH_CLEAR + rimR * 0.05;
        foot.y = terrain.sample(foot.x, foot.z) - 1;
        const style = STYLES[k % STYLES.length]!;
        const at = new Vector3(centre.x, rimY, centre.z);
        stems.push(stem(foot, at.clone().setY(rimY + 1), 2.3));
        const cap = makeCap(at, rimR, style, bodyMat(style), spotMat(style), rng);
        cap.name = `giantMushrooms-arch-${k}`;
        caps.push(cap);
        placed.push(foot);
        side = -sd;
        done = true;
        break;
      }
    }
  }
}

/** A grove of 8-12 luminous mushrooms of mixed sizes around `centre`. */
function buildGrove(
  ctx: BuildContext,
  centre: Vector3,
  rng: SeededRandom,
  stems: BufferGeometry[],
  caps: Group[],
  bodyMat: (s: CapStyle) => MeshStandardMaterial,
  spotMat: (s: CapStyle) => MeshStandardMaterial,
): void {
  const n = rng.int(8, 12);
  const spots: Array<{ x: number; z: number; r: number; h: number }> = [];
  for (let attempt = 0; attempt < 200 && spots.length < n; attempt++) {
    const first = spots.length === 0;
    const h = first ? 24 : rng.range(7, 19);
    const r = h * rng.range(0.4, 0.55);
    const a = rng.range(0, Math.PI * 2);
    const d = first ? 0 : rng.range(6, GROVE_RADIUS + 2 - r);
    const x = centre.x + Math.cos(a) * d;
    const z = centre.z + Math.sin(a) * d;
    // Caps may overlap in plan only when their heights differ enough to nest.
    if (spots.some((s) => Math.hypot(s.x - x, s.z - z) < (Math.abs(s.h - h) > 6 ? 4 : s.r + r * 0.8))) continue;
    spots.push({ x, z, r, h });
  }
  spots.forEach((s, i) => {
    const style = STYLES[(i + 1) % STYLES.length]!;
    const ground = ctx.terrain.sample(s.x, s.z);
    const lean = rng.range(0, Math.PI * 2);
    const tilt = s.h * rng.range(0.05, 0.15);
    const foot = new Vector3(s.x, ground - 1, s.z);
    const at = new Vector3(s.x + Math.cos(lean) * tilt, ground + s.h, s.z + Math.sin(lean) * tilt);
    stems.push(stem(foot, at.clone().setY(at.y + 0.6), Math.max(0.7, s.h * 0.08)));
    const cap = makeCap(at, s.r, style, bodyMat(style), spotMat(style), rng);
    cap.name = `giantMushrooms-grove-${i}`;
    caps.push(cap);
  });
  // Little glowing mushrooms dotted on the ground between the giants.
  const small: BufferGeometry[] = [];
  const dummy = new Object3D();
  for (let i = 0; i < 26; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(3, GROVE_RADIUS);
    const x = centre.x + Math.cos(a) * d;
    const z = centre.z + Math.sin(a) * d;
    const y = ctx.terrain.sample(x, z);
    const h = rng.range(0.8, 2.2);
    dummy.position.set(x, y, z);
    dummy.updateMatrix();
    const st = tint(new CylinderGeometry(h * 0.12, h * 0.16, h, 5).translate(0, h / 2, 0), STEM);
    const style = STYLES[i % STYLES.length]!;
    const cp = tint(new SphereGeometry(h * 0.45, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, h, 0), new Color(style.cap).multiplyScalar(1.6));
    small.push(st.applyMatrix4(dummy.matrix), cp.applyMatrix4(dummy.matrix));
  }
  const glow = new Mesh(mergeGeometries(small), new MeshStandardMaterial({ vertexColors: true, emissive: new Color('#ff9ae0'), emissiveIntensity: 0.35, roughness: 0.6 }));
  glow.name = 'giantMushrooms-glow';
  ctx.add(glow);
}
