import { Box3, Color, Matrix4, Mesh, MeshStandardMaterial, Quaternion, Vector3, type Object3D } from 'three';
import type { PropPlacement, ScatterRule } from '@shared/types/track';
import { SeededRandom } from '@shared/math/random';
import type { BuildContext, Footprint } from '../BuildContext';
import { createInstancedModel } from '../../rendering/InstancedModel';

/** Hand-placed props (track space) and procedural scatter (trees, rocks, flowers). */
export function buildDecor(ctx: BuildContext): void {
  for (const prop of ctx.def.decor.props) placeProp(ctx, prop);
  for (const rule of ctx.def.decor.scatter) scatter(ctx, rule);
}

function placeProp(ctx: BuildContext, prop: PropPlacement): void {
  const { path, terrain } = ctx;
  const distances: number[] = [];
  if (prop.repeat) {
    for (let d = prop.distance; d <= prop.repeat.until; d += prop.repeat.every) distances.push(d);
  } else {
    distances.push(prop.distance);
  }
  const side = prop.side === 'right' ? 1 : -1;
  const box = new Box3();
  for (const d of distances) {
    const frame = path.frameAtSplineDistance(path.startDistance + d);
    const right = frame.sample.flatRight;
    const pos = frame.position.clone().addScaledVector(right, side * (frame.wallOffset + prop.wallOffset));
    pos.y = terrain.sample(pos.x, pos.z);
    const obj = ctx.assets.instantiate(prop.model);
    obj.position.copy(pos);
    obj.scale.setScalar(prop.scale ?? 1);
    const toTrack = right.clone().multiplyScalar(-side);
    obj.rotation.y = Math.atan2(toTrack.x, toTrack.z) + ((prop.yaw ?? 0) * Math.PI) / 180;
    ctx.add(obj);
    box.setFromObject(obj);
    const size = box.getSize(new Vector3());
    ctx.footprints.push({ x: pos.x, z: pos.z, r: Math.max(size.x, size.z) * 0.6 + 1 });
  }
}

function blocked(footprints: Footprint[], x: number, z: number, pad: number): boolean {
  for (const f of footprints) {
    const dx = x - f.x;
    const dz = z - f.z;
    const r = f.r + pad;
    if (dx * dx + dz * dz < r * r) return true;
  }
  return false;
}

function scatter(ctx: BuildContext, rule: ScatterRule): void {
  const { path, terrain } = ctx;
  const rng = new SeededRandom(rule.seed);
  const target = Math.round(rule.count * ctx.graphics.decorDensity);
  const half = terrain.def.size / 2 - 12;
  const perModel = new Map<string, Matrix4[]>(rule.models.map((m) => [m, []]));
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const pos = new Vector3();
  const scl = new Vector3();
  let placed = 0;

  for (let attempt = 0; attempt < target * 10 && placed < target; attempt++) {
    const s = path.samples[rng.int(0, path.samples.length - 1)]!;
    const side = rng.chance(0.5) ? 1 : -1;
    // Bias towards the track so density is spent where players look.
    const dist = rule.minWallDistance + (rule.maxWallDistance - rule.minWallDistance) * Math.pow(rng.next(), 1.7);
    const along = rng.range(-1.5, 1.5) * path.spacing;
    const x = s.position.x + s.flatRight.x * side * (s.wallOffset + dist) + s.tangent.x * along;
    const z = s.position.z + s.flatRight.z * side * (s.wallOffset + dist) + s.tangent.z * along;
    if (Math.abs(x - terrain.centerX) > half || Math.abs(z - terrain.centerZ) > half) continue;

    // Must stay clear of every part of the track, not just the sample it was spawned from.
    const inf = terrain.influence(x, z);
    if (inf && inf.distance < inf.wallOffset + rule.minWallDistance) continue;
    if (blocked(ctx.footprints, x, z, rule.scale[1] * 0.3)) continue;
    if (rule.avoidWater && terrain.isUnderwater(x, z, 0.7)) continue;

    const scale = rng.range(rule.scale[0], rule.scale[1]);
    pos.set(x, terrain.sample(x, z) - 0.05, z);
    q.setFromAxisAngle(up, rng.range(0, Math.PI * 2));
    scl.setScalar(scale);
    perModel.get(rng.pick(rule.models))!.push(new Matrix4().compose(pos, q, scl));
    placed++;
  }

  for (const [model, matrices] of perModel) {
    if (!matrices.length) continue;
    const template = rule.tint ? tinted(ctx.assets.template(model), rule.tint, rule.tintAmount ?? 0.5) : ctx.assets.template(model);
    ctx.add(
      createInstancedModel(template, matrices, {
        castShadow: rule.castShadow ?? false,
        receiveShadow: true,
        name: `scatter:${model}`,
      }),
    );
  }
}

/** A copy of a model whose materials are blended towards a colour (snow, scorched rock…). */
function tinted(template: Object3D, color: string, amount: number): Object3D {
  const copy = template.clone(true);
  const target = new Color(color);
  const done = new Map<MeshStandardMaterial, MeshStandardMaterial>();
  copy.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh || !(m.material instanceof MeshStandardMaterial)) return;
    let t = done.get(m.material);
    if (!t) {
      t = m.material.clone();
      t.color.lerp(target, amount);
      done.set(m.material, t);
    }
    m.material = t;
  });
  return copy;
}
