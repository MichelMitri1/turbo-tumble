import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import type { LandmarkPlacement } from '@shared/types/track';
import { SeededRandom } from '@shared/math/random';
import type { BuildContext } from '../BuildContext';
import { TrackMaterials } from '../materials';

/**
 * Comet Coaster: the course is a roller coaster in deep space — lattice towers hold
 * the road up from the abyss, an asteroid belt circles it, and a great icy comet
 * streaks round the sky trailing a glowing tail.
 */
export function buildComet(ctx: BuildContext, _p: LandmarkPlacement): void {
  const { path, def } = ctx;
  const rng = new SeededRandom(def.terrain.seed + 31);
  const ys = path.samples.map((s) => s.position.y);
  const low = Math.min(...ys);
  const cx = path.samples.reduce((a, s) => a + s.position.x, 0) / path.samples.length;
  const cz = path.samples.reduce((a, s) => a + s.position.z, 0) / path.samples.length;

  // Coaster supports: a lattice tower under the road every ~45 m (none under gaps).
  const steel = new MeshStandardMaterial({ color: '#2a8a9a', roughness: 0.4, metalness: 0.5 });
  const braceMat = TrackMaterials.emissive('#5affd8', 0.8);
  const col = new CylinderGeometry(0.35, 0.35, 1, 6);
  const brace = new BoxGeometry(0.2, 1, 0.2);
  const cols: Matrix4[] = [];
  const braces: Matrix4[] = [];
  const up = new Vector3(0, 1, 0);
  const q = new Quaternion();
  const L = path.length;
  for (let d = 20; d < L - 10; d += 45) {
    const f = path.frameAtSplineDistance(path.startDistance + d);
    if (f.sample.gap || (def.gaps ?? []).some((g) => d > g.distance - 30 && d < g.distance + g.length + 30)) continue;
    const top = f.position.y - 2.2;
    const bottom = low - 120;
    const h = top - bottom;
    const yaw = Math.atan2(f.tangent.x, f.tangent.z);
    q.setFromAxisAngle(up, yaw);
    for (const side of [-1, 1]) {
      const p = f.position.clone().addScaledVector(f.sample.flatRight, side * f.halfWidth * 0.55);
      cols.push(new Matrix4().compose(new Vector3(p.x, bottom + h / 2, p.z), q, new Vector3(1, h, 1)));
    }
    // X-bracing between the two legs every 12 m.
    for (let y = top - 4; y > bottom + 10; y -= 12) {
      for (const tilt of [-1, 1]) {
        const m = new Matrix4().compose(new Vector3(f.position.x, y - 6, f.position.z), new Quaternion().setFromAxisAngle(up, yaw).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), tilt * Math.atan2(f.halfWidth * 1.1, 12))), new Vector3(1, Math.hypot(f.halfWidth * 1.1, 12), 1));
        braces.push(m);
      }
    }
  }
  const instanced = (geo: CylinderGeometry | BoxGeometry, mat: MeshStandardMaterial, list: Matrix4[], name: string): void => {
    if (!list.length) return;
    const im = new InstancedMesh(geo, mat, list.length);
    list.forEach((m, i) => im.setMatrixAt(i, m));
    im.name = name;
    ctx.add(im);
  };
  instanced(col, steel, cols, 'coaster-legs');
  instanced(brace, braceMat, braces, 'coaster-braces');

  // Asteroid belt round the course (one instanced mesh, turning slowly).
  const belt = new Group();
  belt.position.set(cx, low - 10, cz);
  const count = 220;
  const rocks = new InstancedMesh(new DodecahedronGeometry(1, 0), new MeshStandardMaterial({ color: '#5a6a72', roughness: 0.95, flatShading: true }), count);
  const inner = Math.max(260, ctx.terrain.def.size * 0.32);
  const m = new Matrix4();
  for (let i = 0; i < count; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = inner + rng.range(0, 220);
    const s = rng.range(2, 14);
    m.compose(new Vector3(Math.cos(a) * d, rng.range(-40, 60), Math.sin(a) * d), new Quaternion().setFromAxisAngle(new Vector3(rng.next(), rng.next(), rng.next()).normalize(), rng.range(0, 6)), new Vector3(s, s * rng.range(0.6, 1), s * rng.range(0.7, 1.2)));
    rocks.setMatrixAt(i, m);
    rocks.setColorAt(i, new Color().setHSL(rng.range(0.45, 0.55), 0.15, rng.range(0.3, 0.5)));
  }
  belt.add(rocks);
  ctx.add(belt);

  // The comet: an icy nucleus, a glowing coma and a long two-tone tail.
  const comet = new Group();
  const nucleus = new Mesh(new IcosahedronGeometry(14, 1), new MeshStandardMaterial({ color: '#d8fff4', emissive: new Color('#8affe8'), emissiveIntensity: 0.9, roughness: 0.6, flatShading: true }));
  const coma = new Mesh(new SphereGeometry(30, 20, 14), new MeshBasicMaterial({ color: '#7affe0', transparent: true, opacity: 0.25, blending: AdditiveBlending, depthWrite: false }));
  comet.add(nucleus, coma);
  const tails: Mesh[] = [];
  for (const [len, rad, color, op] of [[420, 34, '#9affea', 0.35], [300, 20, '#ffffff', 0.4], [360, 26, '#5ab8ff', 0.25]] as const) {
    const tail = new Mesh(new ConeGeometry(rad, len, 20, 1, true), new MeshBasicMaterial({ color, transparent: true, opacity: op, blending: AdditiveBlending, depthWrite: false }));
    tail.geometry.translate(0, -len / 2, 0);
    tail.rotation.x = -Math.PI / 2;
    comet.add(tail);
    tails.push(tail);
  }
  ctx.add(comet);
  const orbit = Math.max(700, ctx.terrain.def.size * 0.6);
  const ahead = new Vector3();

  // Sparkling dust left behind.
  const sparks = new InstancedMesh(new IcosahedronGeometry(1, 0), new MeshBasicMaterial({ color: '#bffff2' }), 60);
  ctx.add(sparks);
  const trail: Vector3[] = Array.from({ length: 60 }, () => new Vector3());

  ctx.updatables.push({
    update: (_dt, time) => {
      belt.rotation.y = time * 0.01;
      const t = time * 0.035;
      const pos = (u: number, out: Vector3): Vector3 => out.set(cx + Math.cos(u) * orbit, low + 210 + Math.sin(u * 2) * 50, cz + Math.sin(u) * orbit * 0.7);
      pos(t, comet.position);
      pos(t + 0.01, ahead);
      comet.lookAt(ahead);
      nucleus.rotation.x = time * 0.3;
      coma.scale.setScalar(1 + 0.08 * Math.sin(time * 3));
      tails.forEach((tl, i) => (tl.scale.x = tl.scale.z = 1 + 0.06 * Math.sin(time * 4 + i)));
      for (let i = 0; i < trail.length; i++) {
        pos(t - 0.004 - i * 0.0035, trail[i]!).add(new Vector3(Math.sin(i * 7.3) * 20, Math.cos(i * 3.1) * 16, Math.sin(i * 1.7) * 20));
        m.compose(trail[i]!, q.identity(), new Vector3(1, 1, 1).multiplyScalar(2.5 - i * 0.035));
        sparks.setMatrixAt(i, m);
      }
      sparks.instanceMatrix.needsUpdate = true;
    },
  });
}
