import {
  BoxGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type Material,
  type Object3D,
} from 'three';
import { CRUISER_HALF_LENGTH, MoverField, PENDULUM_ARM, PENDULUM_PIVOT, STOMPER_HEIGHT, SWEEPER_POST, type MoverPose } from '@shared/race/Movers';
import { gantryOffset } from '@shared/track/TrackColliders';
import type { MoverDefinition } from '@shared/types/track';
import type { BuildContext } from '../BuildContext';

interface MoverLook {
  rock: string;
  block: string;
  jet: string;
  jetGlow: number;
}

const DEFAULT_LOOK: MoverLook = { rock: '#8a7f74', block: '#646b78', jet: '#8fe0ff', jetGlow: 0.4 };
const LOOKS: Record<string, Partial<MoverLook>> = {
  volcano: { rock: '#4a3a34', block: '#3a3030', jet: '#ff7a1a', jetGlow: 1.6 },
  snow: { rock: '#f4f8ff', block: '#9fc2e6', jet: '#eef8ff' },
  alpine: { rock: '#eef4fb', block: '#7f8a9a', jet: '#eef8ff' },
  desert: { rock: '#c99a62', block: '#a8744a', jet: '#ffe2a0', jetGlow: 0.2 },
  farm: { rock: '#e3c25a', block: '#8a5a32' },
  autumn: { rock: '#9a6a3a', block: '#7a4a2a' },
  space: { rock: '#8a7cff', block: '#4a4a96', jet: '#9af0ff', jetGlow: 1.4 },
  sky: { rock: '#ffffff', block: '#7a8ac8', jet: '#bff4ff', jetGlow: 0.8 },
  city: { rock: '#50565f', block: '#59606e', jet: '#9fe0ff', jetGlow: 0.8 },
  mushroom: { rock: '#d8487a', block: '#6a3a98', jet: '#c6ff7a', jetGlow: 1.2 },
  ruins: { rock: '#9a8f78', block: '#857c68', jet: '#8fe8ff' },
  tropical: { rock: '#b88a5a', block: '#7a5a3a', jet: '#bff0ff' },
};

const BUS_COLORS = ['#ff5a4f', '#ffc83d', '#3fa0ff', '#45d17a', '#c86bff', '#ff8a3d'];

/** Diagonal warning stripes (black / yellow) for pistons, arms and rails. */
function stripeTexture(a = '#1d1d22', b = '#ffcf2e'): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = a;
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = b;
  for (let i = -64; i < 128; i += 32) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + 16, 0);
    g.lineTo(i + 80, 64);
    g.lineTo(i + 64, 64);
    g.fill();
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

const UP = new Vector3(0, 1, 0);
const tmp = new Vector3();
const tmp2 = new Vector3();
const q = new Quaternion();

/** A visual for one mover: built once, posed every frame from the shared MoverField. */
interface MoverVisual {
  root: Object3D;
  update(pose: MoverPose, def: MoverDefinition, time: number): void;
}

/**
 * Moving obstacles (stomping pistons, rolling boulders, spinning arms, wrecking
 * balls, geysers, traffic). Poses come from the same MoverField the simulation uses,
 * evaluated at the race clock, so what you see is exactly what hits you.
 */
export function buildMovers(ctx: BuildContext): void {
  const defs = ctx.def.movers ?? [];
  if (!defs.length) return;
  const field = new MoverField(ctx.path);
  const look = { ...DEFAULT_LOOK, ...(LOOKS[ctx.def.theme] ?? {}) };
  const stripes = stripeTexture();
  const mats = {
    block: new MeshStandardMaterial({ color: look.block, roughness: 0.6, metalness: 0.35 }),
    stripe: new MeshStandardMaterial({ map: stripes, roughness: 0.5, emissive: new Color('#ff3a1a'), emissiveIntensity: 0 }),
    rod: new MeshStandardMaterial({ color: '#b8c0cc', roughness: 0.3, metalness: 0.8 }),
    rock: new MeshStandardMaterial({ color: look.rock, roughness: 0.95, flatShading: true }),
    metal: new MeshStandardMaterial({ color: '#2f3440', roughness: 0.4, metalness: 0.7 }),
    shadow: new MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }),
    jet: new MeshStandardMaterial({ color: look.jet, emissive: new Color(look.jet), emissiveIntensity: look.jetGlow, transparent: true, opacity: 0.78, roughness: 0.2, depthWrite: false }),
    dust: new MeshBasicMaterial({ color: '#e8ddc8', transparent: true, opacity: 0, side: DoubleSide, depthWrite: false }),
    glass: new MeshStandardMaterial({ color: '#203040', roughness: 0.15, metalness: 0.6 }),
    wheel: new MeshStandardMaterial({ color: '#1a1a1e', roughness: 0.8 }),
  };
  const visuals: Array<{ i: number; v: MoverVisual }> = [];
  defs.forEach((def, i) => {
    const v = makeVisual(def, i, field, mats, ctx);
    v.root.name = `mover:${def.kind}`;
    ctx.add(v.root);
    visuals.push({ i, v });
  });
  ctx.updatables.push({
    update: (_dt, time, raceTime) => {
      const t = raceTime ?? time;
      field.update(t);
      for (const { i, v } of visuals) v.update(field.poses[i]!, defs[i]!, t);
    },
  });
}

type Mats = Record<'block' | 'stripe' | 'rod' | 'rock' | 'metal' | 'shadow' | 'jet' | 'dust' | 'glass' | 'wheel', Material>;

function yawOf(t: Vector3): number {
  return Math.atan2(t.x, t.z);
}

function mesh(geo: ConstructorParameters<typeof Mesh>[0], mat: Material, shadow = true): Mesh {
  const m = new Mesh(geo, mat);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

function makeVisual(def: MoverDefinition, index: number, field: MoverField, mats: Mats, ctx: BuildContext): MoverVisual {
  const pose = field.pose(index, 0, field.poses[index]!);
  const root = new Group();
  switch (def.kind) {
    case 'stomper': {
      const s = def.size * 2;
      const body = new Group();
      body.add(mesh(new BoxGeometry(s, 2.6, s), mats.block));
      const bandMat = (mats.stripe as MeshStandardMaterial).clone();
      const band = mesh(new BoxGeometry(s + 0.12, 0.7, s + 0.12), bandMat);
      band.position.y = -0.9;
      body.add(band);
      const cap = mesh(new BoxGeometry(s * 0.55, 0.5, s * 0.55), mats.metal);
      cap.position.y = 1.55;
      body.add(cap);
      const rod = mesh(new CylinderGeometry(0.45, 0.45, 40, 10), mats.rod, false);
      rod.position.y = 21.8;
      body.add(rod);
      root.add(body);
      const shadow = new Mesh(new PlaneGeometry(s, s), mats.shadow.clone());
      shadow.rotation.x = -Math.PI / 2;
      root.add(shadow);
      const dust = new Mesh(new RingGeometry(def.size, def.size + 1.4, 24), mats.dust.clone());
      dust.rotation.x = -Math.PI / 2;
      root.add(dust);
      root.position.copy(pose.base);
      root.rotation.y = yawOf(pose.tangent);
      return {
        root,
        update(p, _d, t) {
          const shake = p.warning ? Math.sin(t * 60) * 0.12 : 0;
          bandMat.emissiveIntensity = p.warning ? 0.7 + 0.6 * Math.sin(t * 40) : 0;
          body.position.set(shake, p.value + 1.3 + 0.02, 0);
          shadow.position.y = 0.08;
          (shadow.material as MeshBasicMaterial).opacity = 0.55 * (1 - p.value / STOMPER_HEIGHT) + (p.warning ? 0.15 : 0.05);
          const since = p.u - 0.68;
          const dm = dust.material as MeshBasicMaterial;
          if (since >= 0 && since < 0.12) {
            const k = since / 0.12;
            dust.scale.setScalar(1 + k * 1.6);
            dust.position.y = 0.3;
            dm.opacity = 0.7 * (1 - k);
          } else dm.opacity = 0;
        },
      };
    }
    case 'roller': {
      const ball = mesh(new IcosahedronGeometry(def.size, 1), mats.rock);
      root.add(ball);
      return {
        root,
        update(p, d) {
          root.position.copy(p.position);
          q.setFromAxisAngle(p.tangent, p.value / d.size);
          ball.quaternion.copy(q);
        },
      };
    }
    case 'sweeper': {
      const post = mesh(new CylinderGeometry(SWEEPER_POST, SWEEPER_POST + 0.2, 2.4, 14), mats.stripe);
      post.position.y = 1.2;
      root.add(post);
      const arm = new Group();
      const bar = mesh(new BoxGeometry(def.size * 2, 0.7, 0.7), mats.stripe);
      arm.add(bar);
      for (const e of [-1, 1]) {
        const knob = mesh(new SphereGeometry(0.55, 12, 8), mats.metal);
        knob.position.x = e * def.size;
        arm.add(knob);
      }
      arm.position.y = 1.1;
      root.add(arm);
      root.position.copy(pose.base);
      return {
        root,
        update(p) {
          tmp.copy(p.tangent).multiplyScalar(Math.cos(p.value)).addScaledVector(p.right, Math.sin(p.value));
          arm.rotation.y = Math.atan2(-tmp.z, tmp.x);
        },
      };
    }
    case 'pendulum': {
      const f = ctx.path.anchorToWorld({ distance: def.distance });
      const off = gantryOffset(f.halfWidth, f.wallOffset);
      const pivot = pose.base.clone();
      pivot.y += PENDULUM_PIVOT;
      for (const side of [-1, 1]) {
        const leg = mesh(new CylinderGeometry(0.45, 0.55, PENDULUM_PIVOT + 0.6, 10), mats.stripe);
        leg.position.copy(f.position).addScaledVector(f.right, side * off);
        leg.position.y += (PENDULUM_PIVOT + 0.6) / 2;
        root.add(leg);
      }
      const beam = mesh(new BoxGeometry(off * 2 + 1, 0.8, 0.8), mats.metal);
      beam.position.copy(pivot);
      beam.position.y += 0.4;
      beam.rotation.y = Math.atan2(-pose.right.z, pose.right.x);
      root.add(beam);
      const chain = mesh(new CylinderGeometry(0.14, 0.14, PENDULUM_ARM, 6), mats.rod, false);
      root.add(chain);
      const ball = new Group();
      ball.add(mesh(new SphereGeometry(def.size, 16, 12), mats.metal));
      const spike = new ConeGeometry(0.32, 0.9, 8);
      for (const dir of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
        const sp = mesh(spike, mats.rod, false);
        tmp.set(dir[0], dir[1], dir[2]);
        sp.position.copy(tmp).multiplyScalar(def.size + 0.35);
        sp.quaternion.setFromUnitVectors(UP, tmp);
        ball.add(sp);
      }
      root.add(ball);
      return {
        root,
        update(p) {
          ball.position.copy(p.position);
          tmp2.copy(pivot).sub(p.position);
          chain.position.copy(p.position).addScaledVector(tmp2, 0.5);
          chain.quaternion.setFromUnitVectors(UP, tmp2.normalize());
        },
      };
    }
    case 'geyser': {
      const vent = mesh(new TorusGeometry(def.size * 0.85, 0.35, 8, 20), mats.metal);
      vent.rotation.x = Math.PI / 2;
      vent.position.y = 0.15;
      root.add(vent);
      const hole = new Mesh(new PlaneGeometry(def.size * 1.6, def.size * 1.6), mats.shadow.clone());
      (hole.material as MeshBasicMaterial).opacity = 0.6;
      hole.rotation.x = -Math.PI / 2;
      hole.position.y = 0.06;
      root.add(hole);
      const jet = new Mesh(new CylinderGeometry(def.size * 0.55, def.size * 0.85, 1, 14, 1, true), mats.jet);
      root.add(jet);
      root.position.copy(pose.base);
      return {
        root,
        update(p, _d, t) {
          const h = p.value > 0 ? 13 * Math.min(1, p.value * 3) : p.warning ? 0.5 + 0.4 * Math.abs(Math.sin(t * 14)) : 0.01;
          jet.visible = h > 0.05;
          jet.scale.set(1 + (p.value > 0 ? 0.08 * Math.sin(t * 30) : 0), h, 1);
          jet.position.y = h / 2;
        },
      };
    }
    case 'cruiser': {
      const color = BUS_COLORS[index % BUS_COLORS.length]!;
      const L = CRUISER_HALF_LENGTH * 2;
      const W = def.size * 2;
      const body = mesh(new BoxGeometry(W, 2.2, L), new MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.2 }));
      body.position.y = 1.6;
      root.add(body);
      const windows = mesh(new BoxGeometry(W + 0.06, 0.7, L * 0.86), mats.glass);
      windows.position.y = 2.05;
      root.add(windows);
      const roof = mesh(new BoxGeometry(W * 0.8, 0.3, L * 0.7), new MeshStandardMaterial({ color: '#ffffff', roughness: 0.5 }));
      roof.position.y = 2.85;
      root.add(roof);
      const wheelGeo = new CylinderGeometry(0.55, 0.55, 0.4, 14);
      for (const x of [-1, 1]) {
        for (const z of [-1, 1]) {
          const w = mesh(wheelGeo, mats.wheel);
          w.rotation.z = Math.PI / 2;
          w.position.set(x * (W / 2 - 0.1), 0.55, z * (L / 2 - 1.1));
          root.add(w);
        }
      }
      return {
        root,
        update(p) {
          root.position.copy(p.base);
          root.rotation.y = yawOf(p.tangent);
        },
      };
    }
  }
}
