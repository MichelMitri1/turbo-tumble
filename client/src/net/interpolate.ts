import { Vector3 } from 'three';
import type { ItemEntity } from '@shared/items/ItemEntities';
import { KART_FULL, KART_REMOTE, type FieldType } from '@shared/net/StateCodec';
import type { KartState } from '@shared/vehicles/KartState';

/** Teleports (respawns) are never interpolated across. */
const TELEPORT_SQ = 15 * 15;
const BLENDABLE = new Set<FieldType>(['f32', 'f64', 'ms', 'snorm']);

type Bag = Record<string, unknown>;

/** Write the blend of two compact (remote-layout) kart states into `out`. */
export function lerpKartState(a: KartState, b: KartState, t: number, out: KartState): void {
  const teleport = a.position.distanceToSquared(b.position) > TELEPORT_SQ;
  const k = teleport ? 1 : t;
  const A = a as unknown as Bag;
  const B = b as unknown as Bag;
  const O = out as unknown as Bag;
  for (const key in KART_REMOTE) {
    const type = KART_REMOTE[key as keyof KartState]!;
    if (type === 'vec' || type === 'unit') {
      const v = (O[key] as Vector3).lerpVectors(A[key] as Vector3, B[key] as Vector3, k);
      if (type === 'unit' && v.lengthSq() > 1e-6) v.normalize();
    } else if (BLENDABLE.has(type)) {
      O[key] = (A[key] as number) + ((B[key] as number) - (A[key] as number)) * k;
    } else {
      O[key] = B[key];
    }
  }
}

/** Copy a full (own-layout) kart state into `out`. */
export function copyKartState(src: KartState, out: KartState): void {
  const S = src as unknown as Bag;
  const O = out as unknown as Bag;
  for (const key in KART_FULL) {
    const v = S[key];
    if (v instanceof Vector3) (O[key] as Vector3).copy(v);
    else O[key] = v;
  }
}

/** Copy the fields a snapshot carries for an entity (keeps the target's Vector3s). */
export function copyEntity(src: ItemEntity, out: ItemEntity): void {
  out.id = src.id;
  out.kind = src.kind;
  out.item = src.item;
  out.position.copy(src.position);
  out.velocity.copy(src.velocity);
  out.owner = src.owner;
  out.age = src.age;
  out.radius = src.radius;
  out.attach = src.attach;
  out.slotIndex = src.slotIndex;
  out.phase = src.phase;
  out.phaseTime = src.phaseTime;
  out.dead = false;
}
