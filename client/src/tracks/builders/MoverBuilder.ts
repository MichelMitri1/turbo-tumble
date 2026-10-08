import {
  BoxGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  DodecahedronGeometry,
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
import { TrackMaterials } from '../materials';

interface MoverLook {
  rock: string;
  block: string;
  jet: string;
  jetGlow: number;
}

const DEFAULT_LOOK: MoverLook = { rock: '#8a7f74', block: '#646b78', jet: '#8fe0ff', jetGlow: 0.4 };
const LOOKS: Record<string, Partial<MoverLook>> = {
  magma: { rock: '#2a2020', block: '#2a2222', jet: '#ff6a1a', jetGlow: 1.8 },
  glacier: { rock: '#e8f6ff', block: '#9fd8f6', jet: '#d8f6ff', jetGlow: 0.6 },
  mesa: { rock: '#b8703a', block: '#8a4a2a', jet: '#ffd8a0', jetGlow: 0.2 },
  beach: { rock: '#b88a5a', block: '#8a6a4a', jet: '#bff8ff', jetGlow: 0.5 },
  river: { rock: '#7a6a5a', block: '#6a6a6a', jet: '#d8f6ff', jetGlow: 0.5 },
  jungle: { rock: '#7a7a5a', block: '#6a6a4a', jet: '#c8fff0', jetGlow: 0.5 },
  marsh: { rock: '#4a4a3a', block: '#3a3a40', jet: '#9aff6a', jetGlow: 1.4 },
  factory: { rock: '#5a5a62', block: '#5a606e', jet: '#e8f0ff', jetGlow: 0.6 },
  starlight: { rock: '#7a8aff', block: '#3a4a96', jet: '#9af0ff', jetGlow: 1.4 },
  comet: { rock: '#5affd8', block: '#2a6a6a', jet: '#9afff0', jetGlow: 1.4 },
  prism: { rock: '#ff8af0', block: '#6a4a96', jet: '#ffd8ff', jetGlow: 1.4 },
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
      stomperDecor(ctx, body, s);
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
      const ball = rollerSkin(ctx, def, mats);
      root.add(ball);
      // Skins are modelled rolling about local +Z: turn that onto the road direction.
      const align = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), pose.tangent);
      return {
        root,
        update(p, d) {
          root.position.copy(p.position);
          q.setFromAxisAngle(p.tangent, p.value / d.size);
          ball.quaternion.copy(q).multiply(align);
        },
      };
    }
    case 'sweeper': {
      const post = mesh(new CylinderGeometry(SWEEPER_POST, SWEEPER_POST + 0.2, 2.4, 14), mats.stripe);
      post.position.y = 1.2;
      root.add(post);
      const arm = new Group();
      const bar = sweeperArm(ctx, def, mats);
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

const SPACE = new Set(['space', 'starlight', 'comet', 'prism', 'sky']);

/** The rolling hazard wears the course: hay bales, snowballs, tumbleweeds, lava rocks, barrels… */
function rollerSkin(ctx: BuildContext, def: MoverDefinition, mats: Mats): Object3D {
  const r = def.size;
  const theme = ctx.def.theme;
  const g = new Group();
  if (theme === 'farm' || theme === 'autumn') {
    // Round hay bale rolling on its side (axis along the road, like the sphere it replaces).
    const hay = new MeshStandardMaterial({ color: theme === 'farm' ? '#e8c45a' : '#d89a4a', roughness: 1, flatShading: true });
    const bale = mesh(new CylinderGeometry(r, r, r * 1.5, 16), hay);
    bale.rotation.x = Math.PI / 2;
    g.add(bale);
    for (const z of [-0.4, 0.4]) {
      const band = mesh(new TorusGeometry(r * 1.01, 0.06, 4, 20), new MeshStandardMaterial({ color: '#8a3a2a', roughness: 0.8 }));
      band.position.z = z * r;
      g.add(band);
    }
    return g;
  }
  if (theme === 'snow' || theme === 'glacier' || theme === 'alpine') {
    const snow = new MeshStandardMaterial({ color: '#f6faff', roughness: 0.85, flatShading: true });
    g.add(mesh(new IcosahedronGeometry(r, 2), snow));
    for (let i = 0; i < 5; i++) {
      const lump = mesh(new IcosahedronGeometry(r * 0.32, 1), snow);
      lump.position.setFromSphericalCoords(r * 0.85, (i / 5) * Math.PI, i * 2.1);
      g.add(lump);
    }
    return g;
  }
  if (theme === 'desert' || theme === 'mesa') {
    // Tumbleweed: a tangle of twig loops.
    const twig = new MeshStandardMaterial({ color: theme === 'mesa' ? '#8a5a3a' : '#a8804a', roughness: 1 });
    for (let i = 0; i < 7; i++) {
      const loop = mesh(new TorusGeometry(r * (0.75 + (i % 3) * 0.1), 0.07, 4, 14), twig, false);
      loop.rotation.set(i * 0.9, i * 1.7, i * 0.4);
      g.add(loop);
    }
    g.add(mesh(new IcosahedronGeometry(r * 0.55, 0), new MeshStandardMaterial({ color: '#7a5a3a', wireframe: true }), false));
    return g;
  }
  if (theme === 'volcano' || theme === 'magma') {
    g.add(mesh(new IcosahedronGeometry(r, 1), mats.rock));
    const glow = TrackMaterials.emissive('#ff5a1a', 2.2);
    for (let i = 0; i < 6; i++) {
      const seam = mesh(new BoxGeometry(r * 1.2, 0.12, 0.12), glow, false);
      seam.position.setFromSphericalCoords(r * 0.92, 0.4 + (i / 6) * 2.4, i * 1.9);
      seam.lookAt(0, 0, 0);
      g.add(seam);
    }
    return g;
  }
  if ((theme === 'beach' || theme === 'tropical') && ctx.kits.has('pirate', 'barrel')) {
    const barrel = ctx.kits.instantiate('pirate', 'barrel');
    const size = ctx.kits.size('pirate', 'barrel');
    barrel.scale.setScalar((r * 2) / Math.max(size.x, size.y));
    // Lying on its side, rolling about the road direction.
    const holder = new Group();
    barrel.position.y = -r;
    holder.add(barrel);
    holder.rotation.x = Math.PI / 2;
    g.add(holder);
    return g;
  }
  if (SPACE.has(theme)) {
    const rock = new MeshStandardMaterial({ color: LOOKS[theme]?.rock ?? '#8a7cff', roughness: 0.9, flatShading: true });
    const ast = mesh(new DodecahedronGeometry(r, 1), rock);
    ast.scale.set(1, 0.85, 1.1);
    g.add(ast);
    for (let i = 0; i < 4; i++) {
      const crater = mesh(new SphereGeometry(r * 0.25, 8, 6), new MeshStandardMaterial({ color: '#3a2a6a', roughness: 1 }), false);
      crater.position.setFromSphericalCoords(r * 0.9, 0.5 + i * 0.7, i * 2.4);
      g.add(crater);
    }
    return g;
  }
  if (theme === 'mushroom') {
    g.add(mesh(new IcosahedronGeometry(r, 2), new MeshStandardMaterial({ color: '#d8487a', roughness: 0.7 })));
    const spot = TrackMaterials.emissive('#fff0f8', 0.6);
    for (let i = 0; i < 8; i++) {
      const sp = mesh(new SphereGeometry(r * 0.22, 8, 6), spot, false);
      sp.position.setFromSphericalCoords(r * 0.92, (i / 8) * Math.PI + 0.2, i * 2.3);
      sp.scale.setScalar(1).multiplyScalar(1);
      g.add(sp);
    }
    return g;
  }
  g.add(mesh(new IcosahedronGeometry(r, 1), mats.rock));
  return g;
}

/** Stomper faces: an angry stone face in the ruins, frost on ice blocks, a press plate in the factory. */
function stomperDecor(ctx: BuildContext, body: Group, s: number): void {
  const theme = ctx.def.theme;
  if (theme === 'ruins' || theme === 'jungle' || theme === 'desert' || theme === 'mesa') {
    const dark = TrackMaterials.paint('#2a2420');
    const eye = TrackMaterials.emissive('#ff4a2a', 1.6);
    for (const z of [-1, 1]) {
      for (const x of [-1, 1]) {
        const brow = mesh(new BoxGeometry(s * 0.28, 0.25, 0.1), dark, false);
        brow.position.set(x * s * 0.2, 0.75, (z * s) / 2 + z * 0.06);
        brow.rotation.z = x * z * 0.35;
        body.add(brow);
        const e = mesh(new BoxGeometry(s * 0.12, s * 0.12, 0.1), eye, false);
        e.position.set(x * s * 0.2, 0.35, (z * s) / 2 + z * 0.06);
        body.add(e);
      }
      const mouth = mesh(new BoxGeometry(s * 0.5, 0.3, 0.1), dark, false);
      mouth.position.set(0, -0.35, (z * s) / 2 + z * 0.06);
      body.add(mouth);
    }
  } else if (theme === 'snow' || theme === 'glacier') {
    const frost = new MeshStandardMaterial({ color: '#e8f8ff', roughness: 0.15, transparent: true, opacity: 0.55 });
    body.add(mesh(new BoxGeometry(s + 0.3, 2.9, s + 0.3), frost, false));
  } else if (theme === 'factory') {
    const plate = TrackMaterials.paint('#2a2c34');
    for (let i = -1; i <= 1; i++) {
      const rib = mesh(new BoxGeometry(s + 0.1, 0.2, 0.3), plate, false);
      rib.position.set(0, 1.0, i * s * 0.3);
      body.add(rib);
    }
  }
}

/** Sweeper arms: a toothed cog in the factory, a laser bar in space, striped bar elsewhere. */
function sweeperArm(ctx: BuildContext, def: MoverDefinition, mats: Mats): Object3D {
  const theme = ctx.def.theme;
  if (theme === 'factory') {
    const g = new Group();
    const cog = TrackMaterials.paint('#b87a3a');
    g.add(mesh(new BoxGeometry(def.size * 2, 0.7, 0.9), cog));
    for (let i = -3; i <= 3; i++) {
      if (!i) continue;
      const tooth = mesh(new BoxGeometry(0.5, 0.5, 1.4), cog);
      tooth.position.x = (i / 3) * def.size * 0.92;
      g.add(tooth);
    }
    return g;
  }
  if (SPACE.has(theme)) {
    const color = theme === 'sky' ? '#ffffff' : (LOOKS[theme]?.jet ?? '#9af0ff');
    const g = new Group();
    g.add(mesh(new BoxGeometry(def.size * 2, 0.35, 0.35), new MeshBasicMaterial({ color: new Color(color).multiplyScalar(1.6) }), false));
    g.add(mesh(new BoxGeometry(def.size * 2, 0.9, 0.9), new MeshBasicMaterial({ color, transparent: true, opacity: 0.3, depthWrite: false }), false));
    return g;
  }
  return mesh(new BoxGeometry(def.size * 2, 0.7, 0.7), mats.stripe);
}
