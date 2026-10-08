import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DodecahedronGeometry,
  Group,
  IcosahedronGeometry,
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
import { SeededRandom } from '@shared/math/random';
import type { BuildContext } from '../BuildContext';
import { TrackMaterials } from '../materials';
import { placeSetPiece } from './placement';

const RADIUS = 18;
const OUTCROP_TOP = 8;
const MAST_H = 45;
const COIL_Y = OUTCROP_TOP + MAST_H + 6;
const CLOUD_Y = 150;
const STRIKE_TIME = 0.25;
const STRIKE_GAP: [number, number] = [3, 6];
const DISTANT_STRIKES = 3;
const BOLT_COLOR = '#f4f0ff';
const BOLT_GLOW = '#8a7aff';

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
  grad.addColorStop(0.2, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new CanvasTexture(c);
}

/** Jagged polyline from a to b, with a couple of forks; returns core and glow geometry. */
function boltGeometry(a: Vector3, b: Vector3, rng: SeededRandom, width: number): { core: BufferGeometry; glow: BufferGeometry } {
  const core: BufferGeometry[] = [];
  const glow: BufferGeometry[] = [];
  const len = a.distanceTo(b);
  const zigzag = (from: Vector3, to: Vector3, steps: number, jitter: number, w: number): Vector3[] => {
    const pts = [from.clone()];
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const p = from.clone().lerp(to, t);
      const j = jitter * Math.sin(t * Math.PI);
      p.x += rng.range(-j, j);
      p.z += rng.range(-j, j);
      p.y += rng.range(-j, j) * 0.3;
      pts.push(p);
    }
    pts.push(to.clone());
    for (let i = 0; i < pts.length - 1; i++) {
      core.push(strut(pts[i]!, pts[i + 1]!, w));
      glow.push(strut(pts[i]!, pts[i + 1]!, w * 4));
    }
    return pts;
  };
  const main = zigzag(a, b, 16, len * 0.09, width);
  for (let f = 0; f < 3; f++) {
    const start = main[rng.int(2, 9)]!;
    const end = start.clone().add(new Vector3(rng.range(-1, 1) * len * 0.2, -len * rng.range(0.12, 0.25), rng.range(-1, 1) * len * 0.2));
    zigzag(start, end, 6, len * 0.04, width * 0.55);
  }
  return { core: merge(core), glow: merge(glow) };
}

/** Dark storm-cloud cluster of flattened puffs centred at (x, y, z). */
function cloudCluster(rng: SeededRandom, x: number, y: number, z: number, size: number): BufferGeometry[] {
  const puffs: BufferGeometry[] = [];
  const n = rng.int(6, 9);
  for (let i = 0; i < n; i++) {
    const r = size * rng.range(0.45, 0.8);
    const a = rng.range(0, Math.PI * 2);
    const d = size * rng.range(0, 1.1);
    puffs.push(new IcosahedronGeometry(1, 1).scale(r * 1.3, r * 0.6, r).rotateY(rng.range(0, 6.28)).translate(x + Math.cos(a) * d, y + rng.range(-3, 6), z + Math.sin(a) * d));
  }
  return puffs;
}

interface Strike {
  core: Mesh;
  glow: Mesh;
  flash: Sprite;
  from: () => Vector3;
  to: () => Vector3;
  next: number;
  start: number;
  width: number;
  flashSize: number;
}

/**
 * Thunder Ridge's tesla mast: a rusty lattice tower on a red rock outcrop with a
 * glowing coil that lightning strikes every few seconds, distant strikes on the
 * horizon, and a slowly drifting deck of dark storm clouds overhead.
 */
export function buildStormTower(ctx: BuildContext, p: LandmarkPlacement): void {
  const spot = placeSetPiece(ctx, p, RADIUS);
  if (!spot) return;
  const { terrain } = ctx;
  const rng = new SeededRandom(ctx.def.terrain.seed + 616);
  const g = new Group();
  g.name = 'storm-tower';
  g.position.copy(spot.position);
  g.position.y -= 2;

  // Rock outcrop with a few tumbled boulders.
  const rock = new CylinderGeometry(12, 17, OUTCROP_TOP + 2, 9, 3).toNonIndexed();
  const pos = rock.getAttribute('position');
  const jitter = new Map<string, [number, number]>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(2)},${pos.getY(i).toFixed(2)},${pos.getZ(i).toFixed(2)}`;
    let j = jitter.get(key);
    if (!j) jitter.set(key, (j = [rng.range(0.85, 1.12), rng.range(-0.6, 0.6)]));
    const top = pos.getY(i) > OUTCROP_TOP / 2;
    pos.setXYZ(i, pos.getX(i) * j[0], pos.getY(i) + (top ? j[1] * 0.4 : j[1]), pos.getZ(i) * j[0]);
  }
  rock.translate(0, (OUTCROP_TOP + 2) / 2 - 1, 0);
  rock.computeVertexNormals();
  const boulders: BufferGeometry[] = [rock];
  for (let i = 0; i < 6; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(2, 4.5);
    boulders.push(new DodecahedronGeometry(r, 0).scale(1, 0.7, 1.1).rotateY(rng.range(0, 6)).translate(Math.cos(a) * rng.range(15, 19), r * 0.4, Math.sin(a) * rng.range(15, 19)));
  }
  const rockMat = new MeshStandardMaterial({ color: '#9a4e32', roughness: 1, flatShading: true });
  g.add(new Mesh(merge(boulders), rockMat));

  // Three-legged rusty lattice mast with a platform, insulators and the coil.
  const rust: BufferGeometry[] = [];
  const legs = 3;
  const corner = (y: number, k: number): Vector3 => {
    const w = 4.6 - (y / MAST_H) * 3.6;
    const a = (k / legs) * Math.PI * 2;
    return new Vector3(Math.cos(a) * w, OUTCROP_TOP + y, Math.sin(a) * w);
  };
  for (let k = 0; k < legs; k++) rust.push(strut(corner(0, k), corner(MAST_H, k), 0.55));
  const levels = 15;
  for (let l = 0; l < levels; l++) {
    const y0 = (l / levels) * MAST_H;
    const y1 = ((l + 1) / levels) * MAST_H;
    for (let k = 0; k < legs; k++) {
      rust.push(strut(corner(y1, k), corner(y1, (k + 1) % legs), 0.28));
      rust.push(strut(corner(y0, k), corner(y1, (k + 1) % legs), 0.2));
    }
  }
  rust.push(new CylinderGeometry(3.4, 3.4, 0.5, 12).translate(0, OUTCROP_TOP + MAST_H, 0));
  rust.push(new CylinderGeometry(4.5, 5.2, 0.8, 3).rotateY(Math.PI / 6).translate(0, OUTCROP_TOP + 0.3, 0));
  g.add(new Mesh(merge(rust), TrackMaterials.paint('#8e4424')));
  const ceramic: BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) ceramic.push(new CylinderGeometry(i % 2 ? 0.7 : 1.3, i % 2 ? 0.7 : 1.3, 0.55, 12).translate(0, OUTCROP_TOP + MAST_H + 0.6 + i * 0.6, 0));
  g.add(new Mesh(merge(ceramic), TrackMaterials.paint('#e4dccb')));
  const torus = new Mesh(new TorusGeometry(3.4, 1.3, 10, 24).rotateX(Math.PI / 2).translate(0, COIL_Y, 0), new MeshStandardMaterial({ color: '#9aa0b0', metalness: 0.7, roughness: 0.3 }));
  const coilMat = new MeshStandardMaterial({ color: '#d8d0ff', emissive: '#9a84ff', emissiveIntensity: 2.5, roughness: 0.3 });
  const coil = new Mesh(new SphereGeometry(2, 16, 12).translate(0, COIL_Y + 0.6, 0), coilMat);
  g.add(torus, coil);
  g.traverse((o) => {
    o.castShadow = o.receiveShadow = true;
  });

  const glowMap = glowTexture();
  const coilGlow = new Sprite(new SpriteMaterial({ map: glowMap, color: '#a090ff', blending: AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
  coilGlow.position.y = COIL_Y + 0.6;
  coilGlow.scale.setScalar(16);
  g.add(coilGlow);

  // Crackling arcs crawling round the coil.
  const arcMat = new MeshBasicMaterial({ color: new Color(BOLT_COLOR), fog: false });
  const arcs = new Mesh(new BufferGeometry(), arcMat);
  g.add(arcs);
  const fx = new SeededRandom(ctx.def.terrain.seed + 617);
  const remakeArcs = (): void => {
    const parts: BufferGeometry[] = [];
    for (let k = 0; k < 3; k++) {
      const a = fx.range(0, Math.PI * 2);
      let prev = new Vector3(Math.cos(a) * 2, COIL_Y + 0.6 + fx.range(-1, 1), Math.sin(a) * 2);
      for (let s = 1; s <= 4; s++) {
        const next = new Vector3(Math.cos(a + fx.range(-0.4, 0.4)) * (2 + s * 1.4), COIL_Y + fx.range(-1.5, 2), Math.sin(a + fx.range(-0.4, 0.4)) * (2 + s * 1.4));
        parts.push(strut(prev, next, 0.14));
        prev = next;
      }
    }
    arcs.geometry.dispose();
    arcs.geometry = merge(parts);
  };

  // Storm-cloud deck drifting round the mast, one cluster straight overhead.
  const cloudParts: BufferGeometry[] = cloudCluster(rng, 0, CLOUD_Y, 0, 30);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const d = rng.range(90, 280);
    cloudParts.push(...cloudCluster(rng, Math.cos(a) * d, rng.range(CLOUD_Y - 20, CLOUD_Y + 20), Math.sin(a) * d, rng.range(22, 40)));
  }
  const cloudMat = new MeshStandardMaterial({ color: '#4a4458', emissive: '#c8c0ff', emissiveIntensity: 0, roughness: 1, flatShading: true });
  const clouds = new Mesh(merge(cloudParts), cloudMat);
  g.add(clouds);

  // Lightning: the main strike onto the coil plus distant strikes on the horizon.
  const coreMat = new MeshBasicMaterial({ color: new Color(BOLT_COLOR).multiplyScalar(1.5), fog: false });
  const glowMat = new MeshBasicMaterial({ color: BOLT_GLOW, transparent: true, opacity: 0.45, blending: AdditiveBlending, depthWrite: false, fog: false });
  const makeStrike = (from: () => Vector3, to: () => Vector3, width: number, flashSize: number, first: number): Strike => {
    const core = new Mesh(new BufferGeometry(), coreMat);
    const glow = new Mesh(new BufferGeometry(), glowMat);
    const flash = new Sprite(new SpriteMaterial({ map: glowMap, color: '#e8e4ff', blending: AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    core.visible = glow.visible = flash.visible = false;
    core.frustumCulled = glow.frustumCulled = false;
    g.add(core, glow, flash);
    return { core, glow, flash, from, to, next: first, start: -10, width, flashSize };
  };
  const strikes: Strike[] = [
    makeStrike(
      () => new Vector3(fx.range(-30, 30), CLOUD_Y - 8, fx.range(-30, 30)),
      () => new Vector3(0, COIL_Y + 2.2, 0),
      0.7,
      140,
      2,
    ),
  ];
  const cx = terrain.centerX - spot.position.x;
  const cz = terrain.centerZ - spot.position.z;
  for (let i = 0; i < DISTANT_STRIKES; i++) {
    let ground = new Vector3();
    strikes.push(
      makeStrike(
        () => {
          const a = fx.range(0, Math.PI * 2);
          const d = fx.range(450, 700);
          ground = new Vector3(cx + Math.cos(a) * d, 0, cz + Math.sin(a) * d);
          ground.y = terrain.sample(ground.x + spot.position.x, ground.z + spot.position.z) - spot.position.y + 2;
          return new Vector3(ground.x + fx.range(-60, 60), CLOUD_Y + 30, ground.z + fx.range(-60, 60));
        },
        () => ground,
        2.2,
        260,
        3 + i * 2.3,
      ),
    );
  }

  ctx.add(g);
  let arcTimer = 0;
  ctx.updatables.push({
    update: (dt, time) => {
      clouds.rotation.y += dt * 0.006;
      arcTimer -= dt;
      if (arcTimer <= 0) {
        remakeArcs();
        arcTimer = 0.06 + fx.range(0, 0.08);
        arcs.visible = fx.chance(0.7);
      }
      let lit = 0;
      strikes.forEach((s, i) => {
        if (time >= s.next) {
          const from = s.from();
          const to = s.to();
          const geo = boltGeometry(from, to, fx, s.width);
          s.core.geometry.dispose();
          s.glow.geometry.dispose();
          s.core.geometry = geo.core;
          s.glow.geometry = geo.glow;
          s.flash.position.copy(i === 0 ? to : from.clone().lerp(to, 0.7));
          s.start = time;
          s.next = time + (i === 0 ? fx.range(STRIKE_GAP[0], STRIKE_GAP[1]) : fx.range(2.5, 7));
        }
        const t = time - s.start;
        // Double flicker: on, brief gap, on again.
        const on = t >= 0 && t < STRIKE_TIME && !(t > 0.07 && t < 0.11);
        s.core.visible = s.glow.visible = s.flash.visible = on;
        if (on) {
          const k = 1 - t / STRIKE_TIME;
          s.flash.scale.setScalar(s.flashSize * (0.6 + 0.4 * k));
          s.flash.material.opacity = 0.35 + 0.5 * k;
          lit = Math.max(lit, i === 0 ? k : k * 0.4);
        }
      });
      cloudMat.emissiveIntensity = lit * 0.9;
      const hum = 0.75 + 0.25 * Math.sin(time * 9) * Math.sin(time * 3.7);
      coilMat.emissiveIntensity = 2 + hum + lit * 4;
      coilGlow.scale.setScalar(14 + hum * 4 + lit * 20);
    },
  });
}
