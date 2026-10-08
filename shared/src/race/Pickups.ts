import { Vector3 } from 'three';
import type { TrackDefinition } from '../types/track';
import type { TrackPath } from '../track/TrackPath';

export const ITEM_BOX_RESPAWN = 0.8;
export const COIN_RESPAWN = 14;
const BOX_PICK_RADIUS = 2.2;
const COIN_PICK_RADIUS = 1.9;

export interface ItemBoxState {
  position: Vector3;
  /** Track anchor (distance from the start line, lateral offset) — CPUs steer for boxes. */
  distance: number;
  lateral: number;
  /** Seconds until it reappears (0 = available). */
  respawn: number;
}

export interface CoinState {
  position: Vector3;
  /** Track anchor (CPUs steer for coins too). */
  distance: number;
  lateral: number;
  respawn: number;
}

export interface BoostPadState {
  center: Vector3;
  tangent: Vector3;
  right: Vector3;
  halfLength: number;
  halfWidth: number;
}

export interface StreamZone extends BoostPadState {
  strength: number;
}

/** Static track pickups: item boxes, coins, boost pads and speed streams. */
export class Pickups {
  readonly boxes: ItemBoxState[] = [];
  readonly coins: CoinState[] = [];
  readonly pads: BoostPadState[] = [];
  /** Streams split into short boxes that follow the road's curve. */
  readonly streams: StreamZone[] = [];
  private readonly tmp = new Vector3();

  constructor(track: TrackPath, def: TrackDefinition) {
    for (const row of def.itemBoxes) {
      for (let k = 0; k < row.count; k++) {
        const lateral = (row.lateral ?? 0) + (k - (row.count - 1) / 2) * row.spacing;
        const f = track.anchorToWorld({ distance: row.distance, lateral, height: 1.2 + (row.height ?? 0) });
        this.boxes.push({ position: f.position.clone(), distance: row.distance, lateral, respawn: 0 });
      }
    }
    for (const row of def.coins) {
      for (let k = 0; k < row.count; k++) {
        const distance = row.distance + k * row.spacing;
        const lateral = row.lateral ?? 0;
        const f = track.anchorToWorld({ distance, lateral, height: 1.0 + (row.height ?? 0) });
        this.coins.push({ position: f.position.clone(), distance, lateral, respawn: 0 });
      }
    }
    for (const st of def.streams ?? []) {
      const pieces = Math.max(1, Math.ceil(st.length / 8));
      const piece = st.length / pieces;
      for (let k = 0; k < pieces; k++) {
        const f = track.anchorToWorld({ distance: st.distance + (k + 0.5) * piece, lateral: st.lateral ?? 0 });
        this.streams.push({ center: f.position.clone(), tangent: f.tangent.clone(), right: f.right.clone(), halfLength: piece / 2 + 0.6, halfWidth: st.width / 2, strength: st.strength });
      }
    }
    for (const pad of def.boostPads) {
      const f = track.anchorToWorld({ distance: pad.distance, lateral: pad.lateral ?? 0 });
      this.pads.push({ center: f.position.clone(), tangent: f.tangent.clone(), right: f.right.clone(), halfLength: pad.length / 2, halfWidth: pad.width / 2 });
    }
  }

  tick(dt: number): void {
    for (const b of this.boxes) if (b.respawn > 0) b.respawn = Math.max(0, b.respawn - dt);
    for (const c of this.coins) if (c.respawn > 0) c.respawn = Math.max(0, c.respawn - dt);
  }

  /** Index of an available box touched at `pos`, or -1. Marks it collected. */
  takeBox(pos: Vector3): number {
    for (let i = 0; i < this.boxes.length; i++) {
      const b = this.boxes[i]!;
      if (b.respawn > 0) continue;
      if (this.tmp.copy(b.position).sub(pos).setY((b.position.y - pos.y - 1) * 0.6).lengthSq() < BOX_PICK_RADIUS * BOX_PICK_RADIUS) {
        b.respawn = ITEM_BOX_RESPAWN;
        return i;
      }
    }
    return -1;
  }

  takeCoin(pos: Vector3): number {
    for (let i = 0; i < this.coins.length; i++) {
      const c = this.coins[i]!;
      if (c.respawn > 0) continue;
      if (this.tmp.copy(c.position).sub(pos).setY((c.position.y - pos.y - 1) * 0.6).lengthSq() < COIN_PICK_RADIUS * COIN_PICK_RADIUS) {
        c.respawn = COIN_RESPAWN;
        return i;
      }
    }
    return -1;
  }

  /** Push strength of the stream under `pos` (0 = none). */
  onStream(pos: Vector3): number {
    for (const p of this.streams) {
      const rel = this.tmp.copy(pos).sub(p.center);
      if (Math.abs(rel.y) > 1.5) continue;
      if (Math.abs(rel.dot(p.tangent)) < p.halfLength && Math.abs(rel.dot(p.right)) < p.halfWidth) return p.strength;
    }
    return 0;
  }

  /** True if a grounded kart at `pos` is on a boost pad. */
  onPad(pos: Vector3): boolean {
    for (const p of this.pads) {
      const rel = this.tmp.copy(pos).sub(p.center);
      if (Math.abs(rel.y) > 1.5) continue;
      if (Math.abs(rel.dot(p.tangent)) < p.halfLength && Math.abs(rel.dot(p.right)) < p.halfWidth) return true;
    }
    return false;
  }
}
