import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
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
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
} from 'three';
import type { LandmarkPlacement } from '@shared/types/track';
import { Noise2D } from '@shared/math/noise';
import { SeededRandom } from '@shared/math/random';
import type { BuildContext } from '../BuildContext';
import { TrackMaterials } from '../materials';
import { placeSetPiece } from './placement';
import { Batch, finish, groundFn, groundRange, lagoon, rockGeometry, xf } from './Coast';

const RADIUS = 35;
const CLIFF_W = 62;
const CLIFF_D = 22;
/** Local z of the cliff's front face (the track is towards +Z). */
const FRONT = -6;
const BURY = 10;

interface Style {
  height: number;
  rock: [string, string];
  top: string;
  pool: { deep: string; shallow: string; wet: string };
  mist: number;
}

const STYLES: Record<string, Style> = {
  river: { height: 44, rock: ['#8d98a8', '#6c7888'], top: '#5aa64a', pool: { deep: '#1f86b8', shallow: '#7fe2f2', wet: '#7d8a8a' }, mist: 16 },
  jungle: { height: 52, rock: ['#6c7a5a', '#525e46'], top: '#3f9a36', pool: { deep: '#14907e', shallow: '#6fe0c8', wet: '#5f6a52' }, mist: 28 },
};

/** Falling-water texture: pale translucent sheet with bright vertical streaks. */
function waterTexture(rng: SeededRandom): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(175,225,250,0.62)';
  g.fillRect(0, 0, 64, 256);
  for (let i = 0; i < 70; i++) {
    g.fillStyle = `rgba(255,255,255,${rng.range(0.45, 0.95).toFixed(2)})`;
    const w = rng.range(1.5, 5);
    const x = rng.range(0, 64);
    const y = rng.range(0, 256);
    const h = rng.range(30, 140);
    g.fillRect(x, y, w, h);
    g.fillRect(x, y - 256, w, h);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

/**
 * A falling sheet from `lip` down to `bottomY`: shoots out and drops on a parabola,
 * never closer than `clear` metres to the cliff face (`faceZ(y)`), bowed across.
 */
function sheetGeometry(lip: Vector3, width: number, bottomY: number, faceZ: (y: number) => number): BufferGeometry {
  const cols = 8;
  const rows = 16;
  const drop = lip.y - bottomY;
  const pos: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  for (let j = 0; j <= rows; j++) {
    const t = j / rows;
    const y = lip.y - drop * t;
    const z = Math.max(lip.z + 0.85 * Math.sqrt(drop * t), faceZ(y) + 1.4);
    const w = width * (1 + t * 0.35);
    for (let i = 0; i <= cols; i++) {
      const u = i / cols;
      pos.push(lip.x + (u - 0.5) * w, y, z + Math.cos((u - 0.5) * Math.PI) * 1.2);
      uv.push(u * (width / 8), ((1 - t) * drop) / 14);
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i;
      index.push(a, a + cols + 1, a + 1, a + 1, a + cols + 1, a + cols + 2);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

/** Low-poly pine (trunk + stacked cones). */
function pine(b: Batch, x: number, y: number, z: number, h: number, green: string): void {
  b.add(new CylinderGeometry(0.25 * h * 0.1, 0.35 * h * 0.1, h * 0.3, 5).translate(0, h * 0.15, 0), '#6a4428', xf(x, y, z));
  for (let k = 0; k < 3; k++) {
    const r = h * (0.32 - k * 0.07);
    b.add(new ConeGeometry(r, h * 0.42, 7).translate(0, h * (0.38 + k * 0.2), 0), green, xf(x, y, z, k * 0.7));
  }
}

/** Jungle tree: slim trunk with a lumpy canopy. */
function jungleTree(b: Batch, rng: SeededRandom, x: number, y: number, z: number, h: number): void {
  b.add(new CylinderGeometry(0.35, 0.55, h, 6).translate(0, h / 2, 0), '#6a4a2e', xf(x, y, z));
  const greens = ['#2f8a3a', '#3f9a36', '#4fae46'];
  for (let k = 0; k < 3; k++) {
    b.add(rockGeometry(rng, h * 0.28, 1.2, 0.7, 1.2, 0), rng.pick(greens), xf(x + rng.range(-1.5, 1.5), y + h + rng.range(-1, 1), z + rng.range(-1.5, 1.5)));
  }
}

/**
 * A tall faceted cliff facing the road with a cascading waterfall (scrolling,
 * translucent sheets) into a plunge pool, drifting mist and boulders.
 * `params.style`: 'river' (grey-blue rock, pines, a rainbow) or 'jungle'
 * (mossy rock, hanging vines, a second smaller fall, thicker mist).
 */
export function buildWaterfall(ctx: BuildContext, p: LandmarkPlacement): void {
  const spot = placeSetPiece(ctx, p, RADIUS);
  if (!spot) return;
  const styleId = String(p.params?.style ?? 'river') === 'jungle' ? 'jungle' : 'river';
  const style = STYLES[styleId]!;
  const jungle = styleId === 'jungle';
  const rng = new SeededRandom(ctx.def.terrain.seed + 755);
  const noise = new Noise2D(ctx.def.terrain.seed + 756);
  const ground = groundFn(ctx, spot.position, spot.yaw);
  const g = new Group();
  g.name = 'waterfall';
  g.position.copy(spot.position);
  g.rotation.y = spot.yaw;
  const H = style.height;

  // Cliff: a subdivided box bent into a tapering, leaning, notched rock wall.
  const out = new Vector3();
  const deform = (x: number, y: number, z: number): Vector3 => {
    const u = x / (CLIFF_W / 2);
    const v = (y + BURY) / (H + BURY);
    const back = (FRONT - z) / CLIFF_D;
    const hx = (1 - 0.34 * u * u + noise.noise(x * 0.09, 3.1) * 0.14 + noise.noise(x * 0.25, z * 0.2) * 0.05) * (1 + back * 0.12);
    let ny = -BURY + (y + BURY) * hx;
    ny -= 3.5 * Math.exp(-((x / 5) ** 2)) * v ** 6 * (1 - back);
    let nz = z - 5 * Math.exp(-((x / 11) ** 2)) * (1 - back) - Math.max(0, v - 0.2) * 4;
    const nx = x * (1 - 0.28 * back);
    const k = v > 0.05 ? 1 : 0;
    nz += noise.noise(x * 0.09 + 7, y * 0.09) * 2.2 * k * (1 - Math.exp(-((x / 6) ** 2)) * 0.7);
    ny += noise.noise(x * 0.11, z * 0.11 + 4) * 1.6 * k * v;
    return out.set(nx + noise.noise(y * 0.08, z * 0.08 + 9) * 1.8 * k, ny, nz);
  };
  const box = new BoxGeometry(CLIFF_W, H + BURY, CLIFF_D, 16, 13, 5);
  box.translate(0, (H + BURY) / 2 - BURY, FRONT - CLIFF_D / 2);
  const bp = box.getAttribute('position');
  for (let i = 0; i < bp.count; i++) {
    const d = deform(bp.getX(i), bp.getY(i), bp.getZ(i));
    bp.setXYZ(i, d.x, d.y, d.z);
  }
  const cliffGeo = box.toNonIndexed();
  cliffGeo.deleteAttribute('uv');
  cliffGeo.computeVertexNormals();
  const cn = cliffGeo.getAttribute('normal');
  const cp = cliffGeo.getAttribute('position');
  const colors = new Float32Array(cp.count * 3);
  const rockA = new Color(style.rock[0]);
  const rockB = new Color(style.rock[1]);
  const top = new Color(style.top);
  const wet = new Color(style.rock[1]).multiplyScalar(0.7);
  const c = new Color();
  for (let t = 0; t < cp.count; t += 3) {
    const y = (cp.getY(t) + cp.getY(t + 1) + cp.getY(t + 2)) / 3;
    const ny = cn.getY(t);
    if (ny > 0.62) c.copy(top);
    else if (jungle && ny > 0.3 && noise.noise(cp.getX(t) * 0.2, y * 0.2) > -0.1) c.copy(top).lerp(rockB, 0.3);
    else c.copy(rockA).lerp(rockB, 0.5 + 0.5 * Math.sin(y * 0.45 + noise.noise(cp.getX(t) * 0.05, 1) * 2));
    if (y < 3 && ny < 0.62) c.lerp(wet, 0.5);
    for (let v = 0; v < 3; v++) colors.set([c.r, c.g, c.b], (t + v) * 3);
  }
  cliffGeo.setAttribute('color', new BufferAttribute(colors, 3));
  const cliff = new Mesh(cliffGeo, TrackMaterials.shell());
  g.add(cliff);

  /** Front face depth at height y across a span of x (furthest forward). */
  const faceZ = (x0: number, x1: number) => (y: number) => {
    let z = -Infinity;
    for (let k = 0; k <= 6; k++) z = Math.max(z, deform(x0 + ((x1 - x0) * k) / 6, y, FRONT).z);
    return z;
  };

  // Plunge pool at the foot of the fall.
  const mainFace = faceZ(-7, 7);
  const POOL_R = 12;
  const poolZ = mainFace(0) + POOL_R - 3;
  const poolY = groundRange(ground, 0, poolZ, POOL_R * 2, POOL_R * 2).max + 0.3;
  const look = { ...style.pool, dry: ctx.def.terrain.palette.grassA };
  const foams: Mesh[] = [];
  lagoon(g, ground, 0, poolZ, POOL_R, poolY, foams, look);

  // Main fall.
  const tex = waterTexture(rng);
  const sheetMat = new MeshStandardMaterial({ map: tex, transparent: true, emissive: '#cfeeff', emissiveIntensity: 0.35, roughness: 0.25, side: DoubleSide, depthWrite: false });
  const backTex = tex.clone();
  backTex.needsUpdate = true;
  backTex.repeat.set(1.3, 0.8);
  const backMat = new MeshStandardMaterial({ map: backTex, color: '#9fd4f0', transparent: true, emissive: '#7fc4e8', emissiveIntensity: 0.25, roughness: 0.25, side: DoubleSide, depthWrite: false });
  const lipTop = deform(0, H, FRONT).clone();
  const falls: Array<{ lip: Vector3; width: number; bottom: number; face: (y: number) => number }> = [{ lip: new Vector3(0, lipTop.y - 0.6, lipTop.z + 0.6), width: 11, bottom: poolY, face: mainFace }];

  if (jungle) {
    // Second, smaller fall from a ledge on the right into its own pool.
    const sx = 18;
    const sFace = faceZ(sx - 3, sx + 3);
    const ledgeY = H * 0.55;
    const sPoolZ = sFace(0) + 5;
    const sPoolY = groundRange(ground, sx, sPoolZ, 12, 12).max + 0.3;
    lagoon(g, ground, sx, sPoolZ, 5, sPoolY, foams, look);
    falls.push({ lip: new Vector3(sx, ledgeY, sFace(ledgeY) + 0.8), width: 4.5, bottom: sPoolY, face: sFace });
  }
  const impacts: Vector3[] = [];
  for (const f of falls) {
    const front = new Mesh(sheetGeometry(f.lip, f.width, f.bottom, f.face), sheetMat);
    const back = new Mesh(sheetGeometry(f.lip.clone().add(new Vector3(0, 0.3, -0.5)), f.width * 1.08, f.bottom, f.face), backMat);
    front.renderOrder = 3;
    back.renderOrder = 2;
    g.add(back, front);
    const drop = f.lip.y - f.bottom;
    impacts.push(new Vector3(f.lip.x, f.bottom, Math.max(f.lip.z + 0.85 * Math.sqrt(drop), f.face(f.bottom) + 1.4) + 1.2));
  }

  // Churning foam where the water lands.
  const churnMat = new MeshStandardMaterial({ color: '#ffffff', emissive: '#e8f6ff', emissiveIntensity: 0.4, roughness: 0.9, flatShading: true, transparent: true, opacity: 0.9 });
  const churn: Mesh[] = [];
  impacts.forEach((pt, i) => {
    const s = i === 0 ? 1 : 0.55;
    for (let k = 0; k < 3; k++) {
      const m = new Mesh(new IcosahedronGeometry(2.2 * s, 1), churnMat);
      m.position.set(pt.x + (k - 1) * 2.6 * s, pt.y, pt.z + (k === 1 ? 0.6 : 0));
      m.scale.set(1.3, 0.45, 1);
      m.userData.phase = k * 2.1 + i;
      churn.push(m);
      g.add(m);
    }
  });

  // Boulders round the pool and at the cliff foot, plus vegetation on top.
  const b = new Batch();
  const tones = [style.rock[0], style.rock[1], '#9aa0a8'];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + rng.range(-0.15, 0.15);
    const d = POOL_R + rng.range(0.5, 3);
    const x = Math.sin(a) * d;
    const z = poolZ + Math.cos(a) * d;
    const r = Math.abs(Math.cos(a)) > 0.8 && Math.cos(a) > 0 ? rng.range(0.8, 1.4) : rng.range(1.4, 3.2);
    b.add(rockGeometry(rng, r, 1, 0.75, 1), jungle ? rng.pick([...tones, style.top]) : rng.pick(tones), xf(x, Math.max(ground(x, z), poolY - 0.4) + r * 0.2, z, rng.range(0, 6)));
  }
  for (let i = 0; i < 7; i++) {
    const x = rng.range(-28, 28);
    if (Math.abs(x) < 8) continue;
    const z = faceZ(x - 1, x + 1)(1) + rng.range(1, 3.5);
    const r = rng.range(2, 4.5);
    b.add(rockGeometry(rng, r, 1, 0.8, 1), rng.pick(tones), xf(x, ground(x, z) + r * 0.2, z, rng.range(0, 6)));
  }
  // A couple of rocks splitting the lip.
  b.add(rockGeometry(rng, 1.6, 1, 0.8, 1), style.rock[1], xf(-5.2, lipTop.y - 0.6, lipTop.z + 0.2));
  b.add(rockGeometry(rng, 1.4, 1, 0.8, 1), style.rock[0], xf(5.4, lipTop.y - 0.4, lipTop.z + 0.2));
  const trees = jungle ? 12 : 14;
  for (let i = 0; i < trees; i++) {
    const x = rng.range(-24, 24);
    if (Math.abs(x) < 6) continue;
    const zq = FRONT - rng.range(2, CLIFF_D - 3);
    const tp = deform(x, H, zq);
    if (jungle) jungleTree(b, rng, tp.x, tp.y - 0.5, tp.z, rng.range(6, 10));
    else pine(b, tp.x, tp.y - 0.5, tp.z, rng.range(8, 13), rng.pick(['#2f6b3a', '#3a7a44', '#2a5e34']));
  }
  if (jungle) {
    // Vines trailing down the face (following its lean), dotted with leaves.
    for (let i = 0; i < 16; i++) {
      const x = rng.range(-26, 26);
      if (Math.abs(x) < 7 || Math.abs(x - 18) < 4) continue;
      const topY = deform(x, H, FRONT).y - 0.5;
      const len = rng.range(8, 22);
      let prev: Vector3 | null = null;
      for (let s = 0; s <= 6; s++) {
        const y = topY - (len * s) / 6;
        const pt = new Vector3(x + Math.sin(s * 1.3 + i) * 0.4, y, faceZ(x - 1, x + 1)(y) + 0.9);
        if (prev) b.beam(prev, pt, 0.22, '#3a7a2a');
        if (s > 0) b.add(new IcosahedronGeometry(0.55, 0), rng.pick(['#4fae46', '#3f9a36', '#62c050']), xf(pt.x, pt.y, pt.z + 0.2, rng.range(0, 6)));
        prev = pt;
      }
    }
    // Ferns and bushes round the pool.
    for (let i = 0; i < 10; i++) {
      const a = rng.range(0, Math.PI * 2);
      const d = POOL_R + rng.range(4, 9);
      const x = Math.sin(a) * d;
      const z = poolZ + Math.cos(a) * d;
      b.add(rockGeometry(rng, rng.range(1.2, 2.2), 1.2, 0.7, 1.2, 0), rng.pick(['#2f8a3a', '#4fae46']), xf(x, ground(x, z) + 0.4, z));
    }
  }
  g.add(b.build(TrackMaterials.shell()));

  // River style: a faint rainbow arcing through the spray.
  if (!jungle) {
    const R = 15;
    const tube = 1.1;
    const arc = new TorusGeometry(R, tube, 4, 48, Math.PI);
    const ap = arc.getAttribute('position');
    const ac = new Float32Array(ap.count * 3);
    for (let i = 0; i < ap.count; i++) {
      const t = (Math.hypot(ap.getX(i), ap.getY(i)) - (R - tube)) / (2 * tube);
      c.setHSL(0.78 * (1 - Math.min(1, Math.max(0, t))), 1, 0.55);
      ac.set([c.r, c.g, c.b], i * 3);
    }
    arc.setAttribute('color', new BufferAttribute(ac, 3));
    const rainbow = new Mesh(arc, new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.28, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }));
    rainbow.position.set(0, poolY - 2, poolZ + 4);
    rainbow.rotation.y = 0.35;
    g.add(rainbow);
  }

  // Mist puffs rising from the plunge pools.
  const mistMat = new MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.25, transparent: true, opacity: 0.38, roughness: 1, flatShading: true, depthWrite: false });
  const mist = new InstancedMesh(new IcosahedronGeometry(1, 1), mistMat, style.mist);
  mist.renderOrder = 4;
  g.add(mist);
  finish(g);
  ctx.add(g);

  const m = new Matrix4();
  const q = new Quaternion();
  const sc = new Vector3();
  const pos = new Vector3();
  const up = new Vector3(0, 1, 0);
  ctx.updatables.push({
    update: (dt, time) => {
      tex.offset.y += dt * 1.1;
      backTex.offset.y += dt * 0.8;
      for (const ch of churn) {
        const ph = ch.userData.phase as number;
        const s = 1 + Math.sin(time * 3.2 + ph) * 0.15;
        ch.scale.set(1.3 * s, 0.45 * (2 - s), s);
        ch.rotation.y = time * 0.4 + ph;
      }
      for (const f of foams) f.scale.setScalar(1 + Math.sin(time * 1.8) * 0.015);
      for (let i = 0; i < style.mist; i++) {
        const src = impacts[i % impacts.length]!;
        const big = i % impacts.length === 0 ? 1 : 0.5;
        const ph = (i * 0.618) % 1;
        const k = (time * 0.16 + ph) % 1;
        pos.set(src.x + Math.sin(ph * 37) * (2 + k * 9) * big, src.y + 0.5 + k * 16 * big, src.z + Math.cos(ph * 23) * k * 5 * big + k * 4 * big);
        sc.setScalar((1.5 + k * 4) * big * Math.sqrt(Math.sin(Math.PI * k)));
        q.setFromAxisAngle(up, ph * 6 + time * 0.2);
        mist.setMatrixAt(i, m.compose(pos, q, sc));
      }
      mist.instanceMatrix.needsUpdate = true;
    },
  });
}
