import type { SeededRandom } from '../math/random';
import type { ItemId } from './ItemTypes';

/**
 * Weights at five points along the field: leader → last place. Leaders mostly get
 * defensive items; the back gets catch-up items. Interpolated by race position.
 */
const TABLE: Record<ItemId, [number, number, number, number, number]> = {
  goo: [30, 14, 5, 0, 0],
  goo3: [6, 10, 6, 2, 0],
  puck: [22, 18, 10, 4, 0],
  puck3: [0, 8, 12, 8, 2],
  seeker: [0, 14, 16, 12, 6],
  seeker3: [0, 0, 8, 12, 10],
  decoy: [10, 6, 2, 0, 0],
  coin: [22, 10, 4, 0, 0],
  horn: [3, 4, 4, 3, 1],
  fizz: [0, 10, 14, 12, 8],
  fizz3: [0, 0, 6, 12, 14],
  fizzGold: [0, 0, 2, 8, 10],
  boomBall: [0, 5, 8, 6, 2],
  ember: [0, 5, 7, 5, 2],
  rang: [0, 5, 7, 5, 2],
  snapper: [0, 3, 6, 6, 3],
  paint: [0, 3, 6, 6, 3],
  octo: [0, 0, 1, 4, 6],
  crownBuster: [0, 0, 2, 5, 6],
  prism: [0, 0, 2, 8, 12],
  zap: [0, 0, 0, 2, 6],
  jetRocket: [0, 0, 0, 4, 12],
  quake: [0, 0, 2, 4, 4],
};

export interface RollContext {
  /** 1-based race position. */
  position: number;
  racerCount: number;
  /** Items that may not be rolled right now (e.g. a Crown Buster is already in play). */
  blocked: ReadonlySet<ItemId>;
}

export function itemWeights(ctx: RollContext): Array<[ItemId, number]> {
  const f = ctx.racerCount <= 1 ? 0.5 : (ctx.position - 1) / (ctx.racerCount - 1);
  const x = f * 4;
  const i0 = Math.min(3, Math.floor(x));
  const t = x - i0;
  const out: Array<[ItemId, number]> = [];
  for (const [id, row] of Object.entries(TABLE) as Array<[ItemId, number[]]>) {
    if (ctx.blocked.has(id)) continue;
    const w = row[i0]! + (row[i0 + 1]! - row[i0]!) * t;
    if (w > 0) out.push([id, w]);
  }
  return out;
}

export function rollItem(ctx: RollContext, rng: SeededRandom): ItemId {
  const weights = itemWeights(ctx);
  const total = weights.reduce((s, [, w]) => s + w, 0);
  let r = rng.next() * total;
  for (const [id, w] of weights) {
    r -= w;
    if (r <= 0) return id;
  }
  return weights[weights.length - 1]?.[0] ?? 'goo';
}
