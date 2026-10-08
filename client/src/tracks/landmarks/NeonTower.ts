import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  RepeatWrapping,
  SRGBColorSpace,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { LandmarkPlacement } from '@shared/types/track';
import type { BuildContext } from '../BuildContext';
import { TrackMaterials } from '../materials';
import { placeSetPiece } from './placement';

const RADIUS = 20;
const SIDES = 8;
const BAND_SPAN = 12;
/** Tapered shaft sections, bottom to top: [base radius, top radius, height]. */
const SECTIONS: Array<[number, number, number]> = [
  [14, 11.5, 48],
  [10.2, 8.4, 40],
  [7.4, 5.6, 34],
  [4.6, 2.6, 26],
];
const RINGS: Array<{ y: number; gap: number; color: string; speed: number }> = [
  { y: 30, gap: 7, color: '#ff3fb4', speed: 0.5 },
  { y: 62, gap: 6.5, color: '#3fe8ff', speed: -0.7 },
  { y: 86, gap: 6, color: '#ffe14d', speed: 0.6 },
  { y: 110, gap: 5.5, color: '#b46bff', speed: -0.9 },
  { y: 136, gap: 5, color: '#4dff9a', speed: 1.1 },
];
const GLOBE_Y = 172;
const GLOBE_R = 11;

const UP = new Vector3(0, 1, 0);
const SIDE = new Vector3(1, 0, 0);

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

function glowTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new CanvasTexture(c);
}

/** Facade glow: thin horizontal light bands and scattered lit panels (v repeats every BAND_SPAN m). */
function bandTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#05060f';
  g.fillRect(0, 0, 64, 128);
  const lit = ['#5a7cff', '#c86bff', '#3fe8ff', '#ff6ac8'];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 4; col++) {
      if ((row * 7 + col * 3) % 5 > 1) continue;
      g.fillStyle = lit[(row + col) % lit.length]!;
      g.globalAlpha = 0.55;
      g.fillRect(col * 16 + 3, row * 16 + 5, 10, 8);
    }
  }
  g.globalAlpha = 1;
  g.fillStyle = '#7ab8ff';
  g.fillRect(0, 0, 64, 3);
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Scale a shaft section's UVs so bands keep a constant spacing. */
function bandUVs(geo: CylinderGeometry, h: number): CylinderGeometry {
  const uv = geo.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 4, (uv.getY(i) * h) / BAND_SPAN);
  return geo;
}

/** Shaft radius at height y (for hugging rings and lights to the taper). */
function radiusAt(y: number): number {
  let base = 0;
  for (const [r0, r1, h] of SECTIONS) {
    if (y <= base + h) return r0 + ((r1 - r0) * (y - base)) / h;
    base += h;
  }
  return 1;
}

/**
 * Neon Metro's hero spire: a ~130 m tapered tower with corner light strips, stacked
 * rotating neon rings, a spinning holographic globe on top, blinking aircraft lights
 * and two searchlights sweeping the night sky from its podium.
 */
export function buildNeonTower(ctx: BuildContext, p: LandmarkPlacement): void {
  const spot = placeSetPiece(ctx, p, RADIUS);
  if (!spot) return;
  const g = new Group();
  g.name = 'neon-tower';
  g.position.copy(spot.position);
  g.position.y -= 0.4;
  g.rotation.y = spot.yaw;

  const glass = new MeshStandardMaterial({ color: '#1a1f3e', roughness: 0.22, metalness: 0.65, flatShading: true, emissive: '#ffffff', emissiveMap: bandTexture(), emissiveIntensity: 1.1 });
  const trim = TrackMaterials.paint('#2a2f4a');

  // Podium, shaft sections with glowing ledges, and corner light strips.
  const body: BufferGeometry[] = [new CylinderGeometry(RADIUS - 2, RADIUS, 3, SIDES).translate(0, 1.5, 0), new CylinderGeometry(13, 15, 4, SIDES).translate(0, 5, 0)];
  const ledges: BufferGeometry[] = [new CylinderGeometry(RADIUS - 1.85, RADIUS - 1.85, 0.5, SIDES).translate(0, 3.1, 0)];
  const strips = new Map<string, BufferGeometry[]>([['#ff3fb4', []], ['#3fe8ff', []]]);
  let y = 7;
  SECTIONS.forEach(([r0, r1, h], i) => {
    body.push(bandUVs(new CylinderGeometry(r1, r0, h, SIDES, 1), h).translate(0, y + h / 2, 0));
    ledges.push(new CylinderGeometry(r1 + 0.7, r1 + 0.7, 0.9, SIDES).translate(0, y + h, 0));
    const color = i % 2 ? '#3fe8ff' : '#ff3fb4';
    for (let k = 0; k < SIDES; k++) {
      const a = (k / SIDES) * Math.PI * 2;
      const out = 0.25;
      const p0 = new Vector3(Math.sin(a) * (r0 + out), y + 0.6, Math.cos(a) * (r0 + out));
      const p1 = new Vector3(Math.sin(a) * (r1 + out), y + h - 0.6, Math.cos(a) * (r1 + out));
      strips.get(color)!.push(strut(p0, p1, 0.7));
    }
    y += h;
  });
  const shaftTop = y;
  // Antenna mast through the globe.
  body.push(new CylinderGeometry(0.35, 1.2, GLOBE_Y + GLOBE_R + 8 - shaftTop, 6).translate(0, (shaftTop + GLOBE_Y + GLOBE_R + 8) / 2, 0));
  const shaft = new Mesh(merge(body), glass);
  const ledgeMesh = new Mesh(merge(ledges), TrackMaterials.emissive('#3fe8ff', 2.4));
  g.add(shaft, ledgeMesh);
  for (const [color, list] of strips) g.add(new Mesh(merge(list), TrackMaterials.emissive(color, 2.6)));
  // Dark spokes holding each ring off the shaft.
  const spokes: BufferGeometry[] = [];
  for (const ring of RINGS) {
    const r = radiusAt(ring.y);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 8;
      spokes.push(strut(new Vector3(Math.sin(a) * (r - 0.5), ring.y, Math.cos(a) * (r - 0.5)), new Vector3(Math.sin(a) * (r + ring.gap - 0.8), ring.y, Math.cos(a) * (r + ring.gap - 0.8)), 0.5));
    }
  }
  g.add(new Mesh(merge(spokes), trim));

  // Rotating rings: broken arcs (so the spin reads) with bright pods.
  const rings: Array<{ pivot: Group; speed: number }> = [];
  for (const ring of RINGS) {
    const radius = radiusAt(ring.y) + ring.gap;
    const parts: BufferGeometry[] = [];
    const arcs = 3;
    for (let k = 0; k < arcs; k++) {
      const arc = new TorusGeometry(radius, 0.9, 6, 24, ((Math.PI * 2) / arcs) * 0.78);
      parts.push(arc.rotateZ((k / arcs) * Math.PI * 2));
      const a = (k / arcs) * Math.PI * 2 - 0.25;
      parts.push(new BoxGeometry(2.6, 2.6, 2.6).translate(Math.cos(a) * radius, Math.sin(a) * radius, 0));
    }
    const thin = new TorusGeometry(radius + 2.2, 0.3, 4, 64);
    const mesh = new Mesh(merge([...parts, thin]), TrackMaterials.emissive(ring.color, 2.8));
    mesh.rotation.x = Math.PI / 2;
    const pivot = new Group();
    pivot.position.y = ring.y;
    pivot.add(mesh);
    g.add(pivot);
    rings.push({ pivot, speed: ring.speed });
  }

  // Holographic globe: latitude / longitude bands, a faint shell and an orbiting logo ring.
  const globe = new Group();
  globe.position.y = GLOBE_Y;
  const bands: BufferGeometry[] = [];
  for (let k = 1; k < 6; k++) {
    const lat = -Math.PI / 2 + (k / 6) * Math.PI;
    bands.push(new TorusGeometry(Math.cos(lat) * GLOBE_R, 0.25, 4, 40).rotateX(Math.PI / 2).translate(0, Math.sin(lat) * GLOBE_R, 0));
  }
  for (let k = 0; k < 6; k++) bands.push(new TorusGeometry(GLOBE_R, 0.25, 4, 40).rotateY((k / 6) * Math.PI));
  const holo = new MeshBasicMaterial({ color: new Color('#6af4ff').multiplyScalar(1.4), transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false });
  const shell = new MeshBasicMaterial({ color: '#2a8cff', transparent: true, opacity: 0.16, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
  globe.add(new Mesh(merge(bands), holo), new Mesh(new SphereGeometry(GLOBE_R * 0.97, 20, 14), shell));
  const logo = new Mesh(new TorusGeometry(GLOBE_R * 1.55, 0.7, 4, 48), new MeshBasicMaterial({ color: new Color('#ff5ad0').multiplyScalar(1.3), transparent: true, opacity: 0.85, blending: AdditiveBlending, depthWrite: false }));
  logo.rotation.x = Math.PI / 2 - 0.45;
  const logoPivot = new Group();
  logoPivot.add(logo);
  globe.add(logoPivot);
  g.add(globe);

  // Aircraft warning lights at each setback and the mast tip.
  const lightGeos: BufferGeometry[] = [new SphereGeometry(0.9, 8, 6).translate(0, GLOBE_Y + GLOBE_R + 8.4, 0)];
  let ly = 7;
  for (const [, r1, h] of SECTIONS) {
    ly += h;
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      lightGeos.push(new SphereGeometry(0.55, 8, 6).translate(Math.sin(a) * (r1 + 0.6), ly + 0.9, Math.cos(a) * (r1 + 0.6)));
    }
  }
  const red = new MeshStandardMaterial({ color: '#ff2a2a', emissive: '#ff1a1a', emissiveIntensity: 3, roughness: 0.4 });
  g.add(new Mesh(merge(lightGeos), red));
  const tipGlow = new Sprite(new SpriteMaterial({ map: glowTexture(), color: '#ff3a3a', blending: AdditiveBlending, depthWrite: false, transparent: true }));
  tipGlow.position.y = GLOBE_Y + GLOBE_R + 8.4;
  tipGlow.scale.setScalar(9);
  const globeGlow = new Sprite(new SpriteMaterial({ map: tipGlow.material.map, color: '#3ac8ff', blending: AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55 }));
  globeGlow.position.y = GLOBE_Y;
  globeGlow.scale.setScalar(GLOBE_R * 5);
  g.add(tipGlow, globeGlow);

  // Searchlights sweeping from the podium.
  const beamMat = new MeshBasicMaterial({ color: '#9ad8ff', transparent: true, opacity: 0.1, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
  const beams: Group[] = [];
  for (const s of [-1, 1]) {
    const pivot = new Group();
    pivot.position.set(s * 14, 7.5, 0);
    const tilt = new Group();
    tilt.rotation.z = s * 0.32;
    const beam = new Mesh(new ConeGeometry(14, 260, 20, 1, true).translate(0, -130, 0).rotateX(Math.PI), beamMat);
    tilt.add(beam);
    pivot.add(tilt);
    g.add(pivot);
    beams.push(pivot);
  }

  shaft.castShadow = shaft.receiveShadow = true;
  ctx.add(g);
  ctx.updatables.push({
    update: (dt, time) => {
      for (const r of rings) r.pivot.rotation.y += dt * r.speed;
      globe.rotation.y += dt * 0.45;
      logoPivot.rotation.y -= dt * 0.9;
      const on = time % 1.6 < 0.35;
      red.emissiveIntensity = on ? 4 : 0.25;
      tipGlow.visible = on;
      globeGlow.material.opacity = 0.45 + Math.sin(time * 2.2) * 0.12;
      beams[0]!.rotation.y = time * 0.35;
      beams[1]!.rotation.y = -time * 0.28 + 2;
    },
  });
}
