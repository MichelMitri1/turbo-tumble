import {
  BoxGeometry,
  CapsuleGeometry,
  Color,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { extrudeAlongPath, type ProfilePoint } from '@shared/track/Extrude';
import type { TrackSample } from '@shared/track/TrackPath';
import type { LandmarkPlacement } from '@shared/types/track';
import { SeededRandom } from '@shared/math/random';
import type { BuildContext } from '../BuildContext';
import { toGeometry } from '../../rendering/meshData';
import { TrackMaterials } from '../materials';
import { sampleRange } from './placement';

const TIER_DEPTH = 1.5;
const TIER_RISE = 0.8;
const FRONT_WALL = 1.4;
const SEAT_COLORS = ['#3fa9f5', '#ff4f9a', '#ffd23f', '#3fd8a0'].map((c) => new Color(c));
const CONCRETE = new Color('#dcd6cc');
const FAN_COLORS = ['#ff5a5a', '#ffd23f', '#3fa9f5', '#7ddc4a', '#ff8c1a', '#b678ff', '#ffffff', '#ff4f9a', '#2fd0b5'].map((c) => new Color(c));

/** Tiered grandstand following the track edge, with an animated instanced crowd. */
export function buildGrandstand(ctx: BuildContext, p: LandmarkPlacement): void {
  const a = p.anchor;
  if (!a?.side) throw new Error('grandstand needs an anchored side placement');
  const side = a.side === 'right' ? 1 : -1;
  const tiers = Number(p.params?.tiers ?? 6);
  const roof = Boolean(p.params?.roof ?? false);
  const length = a.length ?? 60;
  const idx = sampleRange(ctx, a.distance, length);
  const { path, terrain } = ctx;

  const inner = (s: TrackSample): number => s.wallOffset + (a.wallOffset ?? 2);
  const baseY = (s: TrackSample): number => {
    const x = s.position.x + s.flatRight.x * side * inner(s);
    const z = s.position.z + s.flatRight.z * side * inner(s);
    return terrain.sample(x, z) - s.position.y;
  };

  const profile = (s: TrackSample): ProfilePoint[] => {
    const x0 = inner(s);
    const b = baseY(s);
    const pts: ProfilePoint[] = [
      { x: x0, y: b - 1, color: [CONCRETE.r, CONCRETE.g, CONCRETE.b] },
      { x: x0, y: b + FRONT_WALL, color: [CONCRETE.r, CONCRETE.g, CONCRETE.b] },
    ];
    for (let i = 0; i < tiers; i++) {
      const c = SEAT_COLORS[i % SEAT_COLORS.length]!;
      const y = b + FRONT_WALL + i * TIER_RISE;
      pts.push({ x: x0 + i * TIER_DEPTH, y, color: [c.r, c.g, c.b] });
      pts.push({ x: x0 + (i + 1) * TIER_DEPTH, y, color: [c.r, c.g, c.b] });
      pts.push({ x: x0 + (i + 1) * TIER_DEPTH, y: y + TIER_RISE, color: [CONCRETE.r, CONCRETE.g, CONCRETE.b] });
    }
    const back = x0 + tiers * TIER_DEPTH;
    const top = b + FRONT_WALL + tiers * TIER_RISE + 1.2;
    pts.push({ x: back, y: top, color: [CONCRETE.r, CONCRETE.g, CONCRETE.b] });
    pts.push({ x: back + 0.5, y: top, color: [CONCRETE.r, CONCRETE.g, CONCRETE.b] });
    pts.push({ x: back + 0.5, y: b - 1, color: [CONCRETE.r, CONCRETE.g, CONCRETE.b] });
    if (side === 1) return pts;
    // Mirror to the left and reverse so faces still point outward/up.
    return pts.map((q) => ({ ...q, x: -q.x })).reverse();
  };

  const stand = new Mesh(toGeometry(extrudeAlongPath(path, idx, profile, { frame: 'flat' })), TrackMaterials.vertexColor());
  stand.name = 'grandstand';
  stand.castShadow = true;
  stand.receiveShadow = true;
  ctx.add(stand);

  const q = new Quaternion();
  const pos = new Vector3();
  const up = new Vector3(0, 1, 0);
  if (roof) {
    const roofProfile = (s: TrackSample): ProfilePoint[] => {
      const x0 = inner(s) - 1.5;
      const back = inner(s) + tiers * TIER_DEPTH + 0.5;
      const yb = baseY(s) + FRONT_WALL + tiers * TIER_RISE + 5.5;
      const pts = [
        { x: x0, y: yb - 0.8 },
        { x: back, y: yb + 0.9 },
      ];
      return side === 1 ? pts : pts.map((r) => ({ x: -r.x, y: r.y })).reverse();
    };
    const roofMesh = new Mesh(toGeometry(extrudeAlongPath(path, idx, roofProfile, { frame: 'flat' })), TrackMaterials.paint('#e8413a'));
    roofMesh.name = 'grandstand-roof';
    roofMesh.castShadow = true;
    ctx.add(roofMesh);

    const posts: Matrix4[] = [];
    idx.forEach((i, k) => {
      if (k % 5 !== 0) return;
      const s = path.samples[i]!;
      const back = inner(s) + tiers * TIER_DEPTH + 0.25;
      const b = baseY(s);
      const yTop = b + FRONT_WALL + tiers * TIER_RISE + 6.3;
      pos.copy(s.position).addScaledVector(s.flatRight, side * back);
      pos.y += b;
      posts.push(new Matrix4().compose(pos, q.identity(), new Vector3(0.35, yTop - b, 0.35)));
    });
    const post = new InstancedMesh(new BoxGeometry(1, 1, 1).translate(0, 0.5, 0), TrackMaterials.paint('#f6f3ee'), posts.length);
    posts.forEach((m, i) => post.setMatrixAt(i, m));
    post.computeBoundingSphere();
    post.castShadow = true;
    ctx.add(post);
  }

  // Crowd.
  const rng = new SeededRandom(Math.round(a.distance * 31 + side * 7));
  const fans: Array<{ base: Vector3; yaw: number; phase: number; speed: number; jump: number }> = [];
  idx.forEach((i) => {
    const s = path.samples[i]!;
    const toTrack = s.flatRight.clone().multiplyScalar(-side);
    const yaw = Math.atan2(toTrack.x, toTrack.z);
    for (let t = 0; t < tiers; t++) {
      for (const along of [-0.5, 0.5]) {
        if (!rng.chance(0.82)) continue;
        const lateral = inner(s) + (t + 0.55) * TIER_DEPTH;
        const base = s.position.clone().addScaledVector(s.flatRight, side * lateral).addScaledVector(s.tangent, along + rng.range(-0.15, 0.15));
        base.y += baseY(s) + FRONT_WALL + t * TIER_RISE;
        fans.push({ base, yaw: yaw + rng.range(-0.3, 0.3), phase: rng.range(0, Math.PI * 2), speed: rng.range(2.5, 5.5), jump: rng.chance(0.35) ? rng.range(0.15, 0.4) : rng.range(0.02, 0.06) });
      }
    }
  });

  const body = new CapsuleGeometry(0.27, 0.55, 2, 6).translate(0, 0.55, 0);
  const head = new SphereGeometry(0.21, 7, 5).translate(0, 1.18, 0);
  const fanGeo = mergeGeometries([body, head]);
  const crowd = new InstancedMesh(fanGeo, new MeshStandardMaterial({ roughness: 0.8 }), fans.length);
  crowd.name = 'crowd';
  crowd.castShadow = false;
  crowd.receiveShadow = true;
  fans.forEach((_, i) => crowd.setColorAt(i, rng.pick(FAN_COLORS)));
  const m = new Matrix4();
  const scale = new Vector3(1, 1, 1);
  const place = (time: number): void => {
    fans.forEach((f, i) => {
      const hop = Math.abs(Math.sin(time * f.speed + f.phase)) * f.jump;
      pos.copy(f.base);
      pos.y += hop;
      q.setFromAxisAngle(up, f.yaw);
      crowd.setMatrixAt(i, m.compose(pos, q, scale));
    });
    crowd.instanceMatrix.needsUpdate = true;
  };
  place(0);
  crowd.computeBoundingSphere();
  ctx.add(crowd);
  ctx.updatables.push({ update: (_dt, time) => place(time) });

  // Keep scenery out of the stand.
  idx.forEach((i, k) => {
    if (k % 3 !== 0) return;
    const s = path.samples[i]!;
    const mid = inner(s) + (tiers * TIER_DEPTH) / 2;
    ctx.footprints.push({ x: s.position.x + s.flatRight.x * side * mid, z: s.position.z + s.flatRight.z * side * mid, r: (tiers * TIER_DEPTH) / 2 + 4 });
  });
}
