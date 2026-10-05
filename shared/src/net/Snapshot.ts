import type { ItemEntity } from '../items/ItemEntities';
import type { RacePhase, RaceSimulation } from '../race/RaceSimulation';
import { createItemSlot, createProgress, type ItemSlot, type RacerProgress } from '../race/RaceTypes';
import { createKartState, type KartState } from '../vehicles/KartState';
import { ByteReader, type ByteWriter } from './ByteBuffer';
import { ENTITY_PUBLIC, KART_FULL, KART_REMOTE, PROGRESS_FULL, PROGRESS_PUBLIC, SLOT_FULL, SLOT_PUBLIC, createBlankEntity, readFields, writeFields } from './StateCodec';

/**
 * Binary race snapshot, sent ~30 times a second.
 *
 *   common  (encoded once, identical for every client)
 *     u32 tick · f32 time · u8 phase · u8 racers × (compact kart, public progress, public slot)
 *     u16 entities × entity · box bits · coin bits
 *   own     (per client)
 *     u32 ack (last input seq applied) · u8 n × (u8 racer, full kart, full progress, full slot)
 *
 * Own karts carry full precision so the client can rewind and replay its
 * prediction; everyone else's kart is only drawn, so compact is plenty.
 */
const PHASES: readonly RacePhase[] = ['countdown', 'racing', 'complete'];

export interface RacerSnapshot {
  kart: KartState;
  progress: RacerProgress;
  slot: ItemSlot;
}

export interface OwnRacerSnapshot extends RacerSnapshot {
  index: number;
}

export interface RaceSnapshot {
  tick: number;
  time: number;
  phase: RacePhase;
  racers: RacerSnapshot[];
  entities: ItemEntity[];
  boxes: boolean[];
  coins: boolean[];
  /** Last input sequence number the server applied for this client. */
  ack: number;
  own: OwnRacerSnapshot[];
}

function writeBits(w: ByteWriter, flags: boolean[]): void {
  for (let i = 0; i < flags.length; i += 8) {
    let byte = 0;
    for (let b = 0; b < 8 && i + b < flags.length; b++) if (flags[i + b]) byte |= 1 << b;
    w.u8(byte);
  }
}

function readBits(r: ByteReader, count: number): boolean[] {
  const out: boolean[] = [];
  for (let i = 0; i < count; i += 8) {
    const byte = r.u8();
    for (let b = 0; b < 8 && i + b < count; b++) out.push((byte & (1 << b)) !== 0);
  }
  return out;
}

export function encodeSnapshotCommon(w: ByteWriter, race: RaceSimulation, tick: number): void {
  w.u32(tick);
  w.f32(race.time);
  w.u8(PHASES.indexOf(race.phase));
  w.u8(race.racers.length);
  for (const r of race.racers) {
    writeFields(w, r.state, KART_REMOTE);
    writeFields(w, r.progress, PROGRESS_PUBLIC);
    writeFields(w, r.slot, SLOT_PUBLIC);
  }
  const live = race.items.entities.list.filter((e) => !e.dead);
  w.u16(live.length);
  for (const e of live) writeFields(w, e, ENTITY_PUBLIC);
  writeBits(
    w,
    race.pickups.boxes.map((b) => b.respawn <= 0),
  );
  writeBits(
    w,
    race.pickups.coins.map((c) => c.respawn <= 0),
  );
}

export function encodeSnapshotOwn(w: ByteWriter, race: RaceSimulation, ack: number, own: readonly number[]): void {
  w.u32(ack >>> 0);
  w.u8(own.length);
  for (const index of own) {
    const r = race.racers[index]!;
    w.u8(index);
    writeFields(w, r.state, KART_FULL);
    writeFields(w, r.progress, PROGRESS_FULL);
    writeFields(w, r.slot, SLOT_FULL);
  }
}

export function decodeSnapshot(bytes: Uint8Array, boxCount: number, coinCount: number): RaceSnapshot {
  const r = new ByteReader(bytes);
  const tick = r.u32();
  const time = r.f32();
  const phase = PHASES[r.u8()] ?? 'racing';
  const racerCount = r.u8();
  const racers: RacerSnapshot[] = [];
  for (let i = 0; i < racerCount; i++) {
    racers.push({
      kart: readFields(r, createKartState(), KART_REMOTE),
      progress: readFields(r, createProgress(), PROGRESS_PUBLIC),
      slot: readFields(r, createItemSlot(), SLOT_PUBLIC),
    });
  }
  const entityCount = r.u16();
  const entities: ItemEntity[] = [];
  for (let i = 0; i < entityCount; i++) entities.push(readFields(r, createBlankEntity(), ENTITY_PUBLIC));
  const boxes = readBits(r, boxCount);
  const coins = readBits(r, coinCount);
  const ack = r.u32();
  const ownCount = r.u8();
  const own: OwnRacerSnapshot[] = [];
  for (let i = 0; i < ownCount; i++) {
    const index = r.u8();
    own.push({
      index,
      kart: readFields(r, createKartState(), KART_FULL),
      progress: readFields(r, createProgress(), PROGRESS_FULL),
      slot: readFields(r, createItemSlot(), SLOT_FULL),
    });
  }
  return { tick, time, phase, racers, entities, boxes, coins, ack, own };
}
