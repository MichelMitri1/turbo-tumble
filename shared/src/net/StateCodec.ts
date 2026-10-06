import { Vector3 } from 'three';
import { ALL_ITEMS, type ItemId } from '../items/ItemTypes';
import type { Attachment, EntityKind, ItemEntity } from '../items/ItemEntities';
import type { ItemSlot, RacerProgress } from '../race/RaceTypes';
import type { KartState } from '../vehicles/KartState';
import type { ByteReader, ByteWriter } from './ByteBuffer';

/**
 * Wire types for simulation fields. Layout tables below map each field of a
 * state object to one of these; `FullLayout` makes the compiler insist every
 * field is listed, so new state can't silently go un-networked.
 */
export type FieldType =
  | 'f32'
  | 'f64'
  | 'u8'
  | 'i8'
  | 'i32'
  | 'u32'
  | 'bool'
  /** 3 × f32 */
  | 'vec'
  /** unit vector, 3 × i16 */
  | 'unit'
  /** -1..1 as i8 */
  | 'snorm'
  /** seconds 0..65 as u16 milliseconds */
  | 'ms'
  | 'item'
  | 'kind'
  | 'attach'
  | 'f32list'
  | 'i32list'
  | 'u8list'
  | 'itemlist';

export type FullLayout<T> = { readonly [K in keyof T]-?: FieldType };
export type PartialLayout<T> = Partial<FullLayout<T>>;

export const ENTITY_KINDS: readonly EntityKind[] = ['puck', 'seeker', 'crown', 'goo', 'decoy', 'boom', 'fireball', 'rang', 'explosion', 'octo'];
const ATTACHMENTS: readonly Attachment[] = ['none', 'held', 'orbit', 'trail'];
const NO_ITEM = 255;

// ------------------------------------------------------------------ layouts

/** Everything a kart needs to resume simulation exactly (own karts, for reconciliation). */
export const KART_FULL: FullLayout<KartState> = {
  position: 'vec',
  velocity: 'vec',
  forward: 'vec',
  up: 'vec',
  grounded: 'bool',
  groundNormal: 'vec',
  surface: 'u8',
  airTime: 'f32',
  steer: 'f32',
  forwardSpeed: 'f32',
  driftHeld: 'bool',
  offTrackTicks: 'i32',
  stuckTime: 'f32',
  trackIndex: 'i32',
  safeTrackIndex: 'i32',
  respawnTimer: 'f32',
  drifting: 'bool',
  driftDir: 'i8',
  driftCharge: 'f32',
  driftStage: 'u8',
  boostTimer: 'f32',
  boostPower: 'f32',
  jumpCooldown: 'f32',
  respawnIndex: 'i32',
  jumpFlight: 'bool',
  jumpTrick: 'bool',
  slipstreamCharge: 'f32',
  slipstreamTimer: 'f32',
  slipstreamCooldown: 'f32',
  spinTimer: 'f32',
  tumbleTimer: 'f32',
  squishTimer: 'f32',
  invincibleTimer: 'f32',
  shrinkTimer: 'f32',
  rocketTimer: 'f32',
  inkTimer: 'f32',
  coins: 'u8',
};

/** What other clients need to draw a kart (interpolated, so compact is fine). */
export const KART_REMOTE: PartialLayout<KartState> = {
  position: 'vec',
  velocity: 'vec',
  forward: 'unit',
  up: 'unit',
  grounded: 'bool',
  surface: 'u8',
  steer: 'snorm',
  forwardSpeed: 'f32',
  trackIndex: 'i32',
  respawnTimer: 'ms',
  drifting: 'bool',
  driftDir: 'i8',
  driftCharge: 'ms',
  driftStage: 'u8',
  boostTimer: 'ms',
  jumpFlight: 'bool',
  jumpTrick: 'bool',
  slipstreamCharge: 'ms',
  slipstreamTimer: 'ms',
  boostPower: 'f32',
  spinTimer: 'ms',
  tumbleTimer: 'ms',
  squishTimer: 'ms',
  invincibleTimer: 'ms',
  shrinkTimer: 'ms',
  rocketTimer: 'ms',
  inkTimer: 'ms',
  coins: 'u8',
};

export const PROGRESS_FULL: FullLayout<RacerProgress> = {
  lap: 'u8',
  nextCheckpoint: 'f64',
  lapDistance: 'f32',
  total: 'f32',
  position: 'u8',
  finished: 'bool',
  finishTime: 'f32',
  lapStartTime: 'f32',
  lapTimes: 'f32list',
  bestLap: 'f32',
  wrongWayTime: 'f32',
  wrongWay: 'bool',
};

export const PROGRESS_PUBLIC: PartialLayout<RacerProgress> = {
  lap: 'u8',
  total: 'f32',
  position: 'u8',
  finished: 'bool',
  finishTime: 'f32',
  bestLap: 'f32',
};

export const SLOT_FULL: FullLayout<ItemSlot> = {
  item: 'item',
  uses: 'u8',
  roulette: 'f32',
  pending: 'item',
  heldEntity: 'i32',
  orbit: 'i32list',
  timer: 'f32',
  timedItem: 'item',
  octo: 'itemlist',
  pressed: 'bool',
  cooldown: 'f32',
};

export const SLOT_PUBLIC: PartialLayout<ItemSlot> = {
  item: 'item',
  uses: 'u8',
  roulette: 'ms',
  timer: 'ms',
  timedItem: 'item',
};

/** Item entities as drawn by clients. */
export const ENTITY_PUBLIC: PartialLayout<ItemEntity> = {
  id: 'u32',
  kind: 'kind',
  item: 'item',
  position: 'vec',
  velocity: 'vec',
  owner: 'u8',
  age: 'f32',
  radius: 'f32',
  attach: 'attach',
  slotIndex: 'u8',
  phase: 'u8',
  phaseTime: 'f32',
};

// ------------------------------------------------------------------ codec

type Bag = Record<string, unknown>;
const itemCode = (v: unknown): number => (v === null || v === undefined ? NO_ITEM : Math.max(0, ALL_ITEMS.indexOf(v as ItemId)));
const itemFrom = (code: number): ItemId | null => (code === NO_ITEM ? null : (ALL_ITEMS[code] ?? null));

export function writeFields<T extends object>(w: ByteWriter, obj: T, layout: PartialLayout<T>): void {
  const o = obj as Bag;
  for (const key in layout) {
    const type = layout[key]!;
    const v = o[key];
    switch (type) {
      case 'f32':
        w.f32(v as number);
        break;
      case 'f64':
        w.f64(v as number);
        break;
      case 'u8':
        w.u8(Math.max(0, Math.min(255, v as number)));
        break;
      case 'i8':
        w.i8(Math.max(-128, Math.min(127, v as number)));
        break;
      case 'i32':
        w.i32(v as number);
        break;
      case 'u32':
        w.u32(v as number);
        break;
      case 'bool':
        w.u8(v ? 1 : 0);
        break;
      case 'vec': {
        const p = v as Vector3;
        w.f32(p.x);
        w.f32(p.y);
        w.f32(p.z);
        break;
      }
      case 'unit': {
        const p = v as Vector3;
        w.i16(Math.round(Math.max(-1, Math.min(1, p.x)) * 32767));
        w.i16(Math.round(Math.max(-1, Math.min(1, p.y)) * 32767));
        w.i16(Math.round(Math.max(-1, Math.min(1, p.z)) * 32767));
        break;
      }
      case 'snorm':
        w.i8(Math.round(Math.max(-1, Math.min(1, v as number)) * 127));
        break;
      case 'ms':
        w.u16(Math.round(Math.max(0, Math.min(65.535, v as number)) * 1000));
        break;
      case 'item':
        w.u8(itemCode(v));
        break;
      case 'kind':
        w.u8(ENTITY_KINDS.indexOf(v as EntityKind));
        break;
      case 'attach':
        w.u8(ATTACHMENTS.indexOf(v as Attachment));
        break;
      case 'f32list': {
        const list = v as number[];
        w.u8(list.length);
        for (const x of list) w.f32(x);
        break;
      }
      case 'i32list': {
        const list = v as number[];
        w.u8(list.length);
        for (const x of list) w.i32(x);
        break;
      }
      case 'u8list': {
        const list = v as number[];
        w.u8(list.length);
        for (const x of list) w.u8(x);
        break;
      }
      case 'itemlist': {
        const list = v as ItemId[];
        w.u8(list.length);
        for (const x of list) w.u8(itemCode(x));
        break;
      }
    }
  }
}

/** Read fields into `obj` (vectors are written into the existing Vector3s). */
export function readFields<T extends object>(r: ByteReader, obj: T, layout: PartialLayout<T>): T {
  const o = obj as Bag;
  for (const key in layout) {
    const type = layout[key]!;
    switch (type) {
      case 'f32':
        o[key] = r.f32();
        break;
      case 'f64':
        o[key] = r.f64();
        break;
      case 'u8':
        o[key] = r.u8();
        break;
      case 'i8':
        o[key] = r.i8();
        break;
      case 'i32':
        o[key] = r.i32();
        break;
      case 'u32':
        o[key] = r.u32();
        break;
      case 'bool':
        o[key] = r.u8() === 1;
        break;
      case 'vec': {
        const p = (o[key] as Vector3 | undefined) ?? (o[key] = new Vector3());
        (p as Vector3).set(r.f32(), r.f32(), r.f32());
        break;
      }
      case 'unit': {
        const p = ((o[key] as Vector3 | undefined) ?? (o[key] = new Vector3())) as Vector3;
        p.set(r.i16() / 32767, r.i16() / 32767, r.i16() / 32767);
        if (p.lengthSq() > 1e-6) p.normalize();
        break;
      }
      case 'snorm':
        o[key] = r.i8() / 127;
        break;
      case 'ms':
        o[key] = r.u16() / 1000;
        break;
      case 'item':
        o[key] = itemFrom(r.u8());
        break;
      case 'kind':
        o[key] = ENTITY_KINDS[r.u8()] ?? 'puck';
        break;
      case 'attach':
        o[key] = ATTACHMENTS[r.u8()] ?? 'none';
        break;
      case 'f32list':
      case 'i32list':
      case 'u8list':
      case 'itemlist': {
        const n = r.u8();
        const list: unknown[] = [];
        for (let i = 0; i < n; i++) {
          if (type === 'f32list') list.push(r.f32());
          else if (type === 'i32list') list.push(r.i32());
          else if (type === 'u8list') list.push(r.u8());
          else list.push(itemFrom(r.u8()));
        }
        o[key] = list;
        break;
      }
    }
  }
  return obj;
}

/** A blank entity for decoding (mirrors ItemEntities.spawn defaults). */
export function createBlankEntity(): ItemEntity {
  return {
    id: 0,
    kind: 'puck',
    item: null,
    position: new Vector3(),
    velocity: new Vector3(),
    owner: 0,
    age: 0,
    life: 0,
    radius: 1,
    attach: 'none',
    slotIndex: 0,
    target: -1,
    splineDistance: 0,
    trackIndex: -1,
    bounces: 0,
    phase: 0,
    phaseTime: 0,
    hits: [],
    dead: false,
  };
}
