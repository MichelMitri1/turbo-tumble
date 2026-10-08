import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { LandmarkPlacement } from '@shared/types/track';
import { SeededRandom } from '@shared/math/random';
import type { BuildContext } from '../BuildContext';
import { findClearSpot, roadClearance } from './placement';

const ORB_R = 37;
const ORB_HEIGHT = 72;
const CHUNKS = 18;
const FALLS: [number, number] = [3, 4];
const FALL_NEAR = 60;
const FALL_FAR = 200;
const LAVA_SPAN = 12;
const PILLARS = 16;
const CRUST = new Color('#2a0c06');
const HOT = new Color('#ff6a10');
const WHITE_HOT = new Color('#ffd860');

function merge(list: BufferGeometry[]): BufferGeometry {
  return mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)))!;
}

function glowTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new CanvasTexture(c);
}

/** Flowing lava: long bright streaks and dark crust flecks (tiles vertically). */
function lavaTexture(rng: SeededRandom): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ff4a08';
  g.fillRect(0, 0, 64, 256);
  g.filter = 'blur(1.5px)';
  const streak = (color: string, w: [number, number], h: [number, number], n: number): void => {
    g.fillStyle = color;
    for (let i = 0; i < n; i++) {
      const x = rng.range(0, 64);
      const y = rng.range(0, 256);
      const sw = rng.range(w[0], w[1]);
      const sh = rng.range(h[0], h[1]);
      // Draw wrapped so the texture tiles seamlessly.
      for (const dy of [-256, 0, 256]) for (const dx of [-64, 0, 64]) g.fillRect(x + dx, y + dy, sw, sh);
    }
  };
  streak('#c82200', [5, 12], [50, 120], 10);
  streak('#ff9a20', [3, 8], [60, 140], 12);
  streak('#ffe070', [2, 4], [40, 100], 10);
  streak('#5a1404', [3, 6], [6, 14], 6);
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Hex basalt column, base at y = 0. */
function column(r: number, h: number): BufferGeometry {
  return new CylinderGeometry(r * 0.96, r, h, 6, 1).rotateY(Math.PI / 6);
}

/** Basalt cliff of stepped hex columns (local +Z faces the road), tallest at the lip where lava pours. */
function cliffGeometry(rng: SeededRandom, height: number): BufferGeometry {
  const cols: BufferGeometry[] = [];
  const r = 2.3;
  const dx = r * 1.73;
  for (let row = 0; row < 5; row++) {
    const z = 1 - row * r * 1.5;
    for (let i = -4; i <= 4; i++) {
      const x = i * dx + (row % 2 ? dx / 2 : 0);
      const centre = Math.abs(x) < 4.5 && row < 3;
      const edge = 1 - Math.abs(x) / (5 * dx);
      const h = centre ? height : height * (0.45 + 0.5 * edge) * rng.range(0.82, 1.02) * (row === 0 ? 0.85 : 1);
      cols.push(column(r, h + 5).translate(x, (h + 5) / 2 - 5, z));
    }
  }
  // A few toppled columns at the foot.
  for (let i = 0; i < 4; i++) cols.push(column(r * 0.8, rng.range(5, 9)).rotateZ(Math.PI / 2 + rng.range(-0.2, 0.2)).rotateY(rng.range(-0.8, 0.8)).translate((rng.chance(0.5) ? 1 : -1) * rng.range(9, 15), 1.2, rng.range(3, 8)));
  return merge(cols);
}

/** Lava sheet pouring over the lip and bulging outward as it falls (UVs tiled every LAVA_SPAN m). */
function fallGeometry(width: number, height: number, lipZ: number): BufferGeometry {
  const g = new PlaneGeometry(width, height, 1, 10);
  const pos = g.getAttribute('position');
  const uv = g.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) {
    const t = 1 - (pos.getY(i) + height / 2) / height;
    pos.setXYZ(i, pos.getX(i) * (1 + t * 0.35), height - t * height, lipZ + 0.6 + t * t * 5.5);
    uv.setXY(i, uv.getX(i), (uv.getY(i) * height) / LAVA_SPAN);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Magma Core: a giant pulsing magma orb floating over a basalt vent with obsidian
 * chunks orbiting it, basalt cliffs pouring lava falls into glowing pools, and dark
 * crystal pillars with smouldering tips across the caldera.
 */
export function buildMagmaCore(ctx: BuildContext, _p: LandmarkPlacement): void {
  const { terrain, path } = ctx;
  const rng = new SeededRandom(ctx.def.terrain.seed + 717);
  const glowMap = glowTexture();
  const lava = lavaTexture(rng);
  const lavaMat = new MeshBasicMaterial({ map: lava, color: new Color('#ffffff').multiplyScalar(1.25) });
  const basalt = new MeshStandardMaterial({ color: '#3a2c32', roughness: 0.85, metalness: 0.1, flatShading: true });
  const updates: Array<(dt: number, time: number) => void> = [(dt) => (lava.offset.y += dt * 0.35)];
  const half = terrain.def.size / 2 - 30;

  // (a) The core, over the clearest spot near the middle of the map.
  const centre = new Vector3(terrain.centerX, 0, terrain.centerZ);
  let clear = 0;
  let spot: Vector3 | null = null;
  for (const r of [58, 46, 34]) {
    spot = findClearSpot(ctx, centre, r, { maxDist: 420, margin: 2 });
    if (spot) {
      clear = r;
      break;
    }
  }
  if (spot) {
    ctx.footprints.push({ x: spot.x, z: spot.z, r: 18 });
    const core = new Group();
    core.name = 'magma-core';
    core.position.copy(spot);

    // Vent: a ring of leaning basalt fangs round a lava pool, with a heat tether up to the orb.
    const fangs: BufferGeometry[] = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + rng.range(-0.15, 0.15);
      const h = rng.range(7, 15);
      fangs.push(new ConeGeometry(rng.range(2, 3.2), h, 6).translate(0, h / 2, 0).rotateX(-rng.range(0.15, 0.4)).rotateY(-a + Math.PI / 2).translate(Math.cos(a) * 12, -1, Math.sin(a) * 12));
    }
    fangs.push(new CylinderGeometry(12, 15, 3, 10).translate(0, 0.2, 0));
    core.add(new Mesh(merge(fangs), basalt));
    const vent = new Mesh(new CircleGeometry(10, 20).rotateX(-Math.PI / 2).translate(0, 1.8, 0), lavaMat);
    const tether = new Mesh(
      new CylinderGeometry(3, 7, ORB_HEIGHT - ORB_R + 2, 16, 1, true).translate(0, (ORB_HEIGHT - ORB_R) / 2 + 1, 0),
      new MeshBasicMaterial({ color: '#ff6a20', transparent: true, opacity: 0.16, blending: AdditiveBlending, depthWrite: false }),
    );
    core.add(vent, tether);

    // The orb: faceted magma with dark crust plates over white-hot seams.
    const orbGeo = new IcosahedronGeometry(ORB_R, 3);
    const pos = orbGeo.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);
    const c = new Color();
    for (let f = 0; f < pos.count; f += 3) {
      const x = (pos.getX(f) + pos.getX(f + 1) + pos.getX(f + 2)) / 3;
      const y = (pos.getY(f) + pos.getY(f + 1) + pos.getY(f + 2)) / 3;
      const z = (pos.getZ(f) + pos.getZ(f + 1) + pos.getZ(f + 2)) / 3;
      const n = Math.sin(x * 0.16 + Math.sin(z * 0.11) * 2) * Math.cos(y * 0.14 + Math.sin(x * 0.09) * 2) + Math.sin(z * 0.21 + y * 0.07) * 0.5;
      const seam = Math.abs(n) < 0.18;
      c.copy(seam ? WHITE_HOT : n > 0.25 ? CRUST : HOT);
      if (!seam && n > 0.25) c.lerp(HOT, rng.range(0, 0.25));
      for (let k = 0; k < 3; k++) colors.set([c.r, c.g, c.b], (f + k) * 3);
    }
    orbGeo.setAttribute('color', new BufferAttribute(colors, 3));
    const orbMat = new MeshBasicMaterial({ vertexColors: true });
    const orb = new Mesh(orbGeo, orbMat);
    orb.position.y = ORB_HEIGHT;
    const shell = new Mesh(new IcosahedronGeometry(ORB_R * 1.14, 2), new MeshBasicMaterial({ color: '#ff5a10', transparent: true, opacity: 0.2, blending: AdditiveBlending, depthWrite: false }));
    shell.position.y = ORB_HEIGHT;
    const halo = new Sprite(new SpriteMaterial({ map: glowMap, color: '#ff6a20', blending: AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.7 }));
    halo.position.y = ORB_HEIGHT;
    halo.scale.setScalar(ORB_R * 5.5);
    core.add(orb, shell, halo);

    // Obsidian chunks orbiting in a tilted ring.
    const ringR = Math.max(ORB_R + 16, clear + 4);
    const chunkGeos: BufferGeometry[] = [];
    for (let i = 0; i < CHUNKS; i++) {
      const a = (i / CHUNKS) * Math.PI * 2 + rng.range(-0.1, 0.1);
      const s = rng.range(2.5, 6.5);
      chunkGeos.push(new DodecahedronGeometry(s, 0).scale(1, rng.range(0.6, 1.3), rng.range(0.7, 1.2)).rotateY(rng.range(0, 6)).rotateX(rng.range(0, 6)).translate(Math.cos(a) * (ringR + rng.range(-5, 5)), rng.range(-5, 5), Math.sin(a) * (ringR + rng.range(-5, 5))));
    }
    const chunkMat = new MeshStandardMaterial({ color: '#1a1220', emissive: '#ff3a10', emissiveIntensity: 0.18, roughness: 0.3, metalness: 0.4, flatShading: true });
    const ring = new Mesh(merge(chunkGeos), chunkMat);
    const tilt = new Group();
    tilt.position.y = ORB_HEIGHT;
    tilt.rotation.set(0.28, 0, 0.12);
    tilt.add(ring);
    core.add(tilt);

    // Glowing drips falling from the orb into the vent.
    const drops: Mesh[] = [];
    for (let i = 0; i < 4; i++) {
      const d = new Mesh(new IcosahedronGeometry(1.2, 0), lavaMat);
      d.userData.phase = i / 4;
      drops.push(d);
      core.add(d);
    }
    core.traverse((o) => {
      if (o === orb || o === shell || o === tether) return;
      o.castShadow = o.receiveShadow = true;
    });
    ctx.add(core);
    const fallH = ORB_HEIGHT - ORB_R;
    updates.push((dt, time) => {
      const k = 1 + Math.sin(time * 1.6) * 0.12 + Math.sin(time * 4.3) * 0.05;
      orbMat.color.setScalar(0.95 + (k - 1) * 1.5);
      orb.rotation.y += dt * 0.08;
      shell.scale.setScalar(1 + (k - 1) * 0.4);
      halo.material.opacity = 0.55 + (k - 1) * 1.2;
      ring.rotation.y += dt * 0.12;
      for (const d of drops) {
        const t = (time * 0.45 + (d.userData.phase as number)) % 1;
        d.position.set(Math.sin((d.userData.phase as number) * 9) * 3, fallH - t * t * (fallH - 2), Math.cos((d.userData.phase as number) * 9) * 3);
        d.scale.set(1, 1 + t * 1.5, 1);
      }
    });
  }

  // (b) Lava falls: basalt cliffs pouring into glowing pools, facing the road.
  const fallCount = rng.int(FALLS[0], FALLS[1]);
  const cliffs: BufferGeometry[] = [];
  const sheets: BufferGeometry[] = [];
  const rims: BufferGeometry[] = [];
  let made = 0;
  for (let attempt = 0; attempt < 500 && made < fallCount; attempt++) {
    const s = path.samples[rng.int(0, path.samples.length - 1)]!;
    const side = rng.chance(0.5) ? 1 : -1;
    const out = rng.range(FALL_NEAR, FALL_FAR);
    const x = s.position.x + s.flatRight.x * side * (s.wallOffset + out);
    const z = s.position.z + s.flatRight.z * side * (s.wallOffset + out);
    if (Math.abs(x - terrain.centerX) > half || Math.abs(z - terrain.centerZ) > half) continue;
    if (roadClearance(ctx, x, z) < 26 || terrain.isUnderwater(x, z, 1)) continue;
    if (ctx.footprints.some((f) => Math.hypot(f.x - x, f.z - z) < f.r + 22)) continue;
    ctx.footprints.push({ x, z, r: 20 });
    made++;
    const height = rng.range(30, 50);
    const yaw = Math.atan2(-s.flatRight.x * side, -s.flatRight.z * side);
    const ground = terrain.sample(x, z);
    const place = (g: BufferGeometry): BufferGeometry => g.rotateY(yaw).translate(x, ground, z);
    cliffs.push(place(cliffGeometry(rng, height)));
    sheets.push(place(fallGeometry(7, height, 1 + 2.3)));
    const second = height * rng.range(0.55, 0.75);
    sheets.push(place(fallGeometry(2.6, second, 1 + 2.3).translate(-8.5, 0, -0.6)));
    sheets.push(place(new CircleGeometry(10, 20).rotateX(-Math.PI / 2).translate(-1.5, 0.35, 11)));
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const r = rng.range(1.4, 2.6);
      rims.push(place(new DodecahedronGeometry(r, 0).scale(1.2, 0.6, 1).translate(-1.5 + Math.cos(a) * 10.5, 0.2, 11 + Math.sin(a) * 10.5)));
    }
    const glow = new Sprite(new SpriteMaterial({ map: glowMap, color: '#ff5a10', blending: AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.6 }));
    const gp = new Vector3(-1.5, 3, 11).applyAxisAngle(new Vector3(0, 1, 0), yaw);
    glow.position.set(x + gp.x, ground + gp.y, z + gp.z);
    glow.scale.setScalar(30);
    glow.name = `lava-fall-${made}`;
    ctx.add(glow);
    updates.push((_dt, time) => (glow.material.opacity = 0.5 + Math.sin(time * 2 + x) * 0.12));
  }
  if (cliffs.length) {
    const cliffMesh = new Mesh(merge([...cliffs, ...rims]), basalt);
    cliffMesh.castShadow = cliffMesh.receiveShadow = true;
    ctx.add(cliffMesh);
    ctx.add(new Mesh(merge(sheets), lavaMat));
  }

  // (c) Dark crystal pillars with smouldering purple / red tips.
  const bodies: BufferGeometry[] = [];
  const tips: [BufferGeometry[], BufferGeometry[]] = [[], []];
  let pillars = 0;
  for (let attempt = 0; attempt < 400 && pillars < PILLARS; attempt++) {
    const s = path.samples[rng.int(0, path.samples.length - 1)]!;
    const side = rng.chance(0.5) ? 1 : -1;
    const out = s.wallOffset + rng.range(18, 150);
    const x = s.position.x + s.flatRight.x * side * out;
    const z = s.position.z + s.flatRight.z * side * out;
    if (roadClearance(ctx, x, z) < 10 || terrain.isUnderwater(x, z, 0.5)) continue;
    if (ctx.footprints.some((f) => Math.hypot(f.x - x, f.z - z) < f.r + 6)) continue;
    pillars++;
    const kind = pillars % 2;
    const n = rng.int(1, 3);
    for (let k = 0; k < n; k++) {
      const r = rng.range(1, 1.8) * (k ? 0.7 : 1);
      const h = rng.range(8, 18) * (k ? 0.6 : 1);
      const lean = k ? rng.range(0.2, 0.45) : rng.range(0, 0.1);
      const dir = rng.range(0, Math.PI * 2);
      const ox = k ? Math.cos(dir) * r * 1.6 : 0;
      const oz = k ? Math.sin(dir) * r * 1.6 : 0;
      const orient = (g: BufferGeometry): BufferGeometry => g.rotateZ(lean).rotateY(dir).translate(x + ox, terrain.sample(x + ox, z + oz) - 1, z + oz);
      bodies.push(orient(new CylinderGeometry(r * 0.85, r, h, 6).translate(0, h / 2, 0)));
      tips[kind]!.push(orient(new ConeGeometry(r * 0.85, h * 0.35, 6).translate(0, h + h * 0.175, 0)));
    }
  }
  if (bodies.length) {
    const body = new Mesh(merge(bodies), new MeshStandardMaterial({ color: '#1c1226', roughness: 0.3, metalness: 0.5, flatShading: true }));
    body.castShadow = body.receiveShadow = true;
    ctx.add(body);
    const tipMats = [new MeshStandardMaterial({ color: '#d070ff', emissive: '#a03aff', emissiveIntensity: 2.4, flatShading: true }), new MeshStandardMaterial({ color: '#ff5a6a', emissive: '#ff1a3a', emissiveIntensity: 2.4, flatShading: true })];
    tips.forEach((list, i) => list.length && ctx.add(new Mesh(merge(list), tipMats[i]!)));
    updates.push((_dt, time) => tipMats.forEach((m, i) => (m.emissiveIntensity = 2 + Math.sin(time * 1.7 + i * 2) * 0.8)));
  }

  ctx.updatables.push({ update: (dt, time) => updates.forEach((u) => u(dt, time)) });
}
