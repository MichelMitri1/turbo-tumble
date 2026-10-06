import type { MoverKind, StreamDefinition, TrackDifficulty } from '../shared/src/types/track';

/**
 * Recipes for tools/design-courses.ts: what kind of layout each course gets
 * (corner mix, length, hills) and which features it carries. The designer turns a
 * recipe into a concrete segment list (shared/src/tracks/layouts.ts).
 */
export interface Recipe {
  id: string;
  seed: number;
  difficulty: TrackDifficulty;
  /** Target lap length (m). */
  length: number;
  /** Piece weights: kink, sweeper, corner, tight, hairpin, esses, chicane, compound, carousel. */
  mix: Partial<Record<Piece, number>>;
  /** Hill amplitude (m). */
  hills: number;
  space?: boolean;
  /** One crossing with an overpass (total turn 0). */
  figure8?: boolean;
  features: {
    void?: number;
    jumps?: number;
    gapJumps?: number;
    streams?: { n: number; style: StreamDefinition['style'] };
    movers?: Partial<Record<Exclude<MoverKind, 'cruiser'>, number>>;
    hazards?: number;
    shortcuts?: number;
    boosts?: number;
    tunnels?: number;
  };
}

export type Piece = 'kink' | 'sweeper' | 'corner' | 'tight' | 'hairpin' | 'esses' | 'chicane' | 'compound' | 'carousel';

const EASY = { kink: 2, sweeper: 3, corner: 3, tight: 1, hairpin: 1, esses: 2, chicane: 1, compound: 2 };
const MEDIUM = { kink: 2, sweeper: 2, corner: 3, tight: 2, hairpin: 1.5, esses: 2.5, chicane: 1.5, compound: 2, carousel: 0.3 };
const HARD = { kink: 1.5, sweeper: 1.5, corner: 3, tight: 3, hairpin: 2, esses: 3, chicane: 2, compound: 2.5, carousel: 0.5 };

export const RECIPES: Recipe[] = [
  // ---------------------------------------------------------------- Sunny Cup (easy)
  { id: 'sunny-circuit', seed: 11, difficulty: 'easy', length: 2700, mix: EASY, hills: 6, features: { jumps: 1, movers: { sweeper: 1, roller: 1, pendulum: 1 }, hazards: 1, shortcuts: 1, boosts: 2 } },
  { id: 'palm-bay', seed: 12, difficulty: 'easy', length: 2700, mix: { ...EASY, esses: 3 }, hills: 4, features: { jumps: 1, streams: { n: 2, style: 'water' }, movers: { geyser: 2, roller: 1 }, shortcuts: 1, boosts: 1 } },
  { id: 'harvest-lane', seed: 13, difficulty: 'easy', length: 2700, mix: { ...EASY, compound: 3 }, hills: 7, features: { jumps: 1, movers: { roller: 2, sweeper: 1 }, hazards: 1, shortcuts: 1, boosts: 1 } },
  { id: 'maple-glen', seed: 14, difficulty: 'easy', length: 2700, mix: { ...EASY, esses: 4, sweeper: 4 }, hills: 9, features: { jumps: 1, movers: { pendulum: 2, roller: 1 }, shortcuts: 1, boosts: 1, tunnels: 1 } },
  // ---------------------------------------------------------------- Splash Cup (medium)
  { id: 'coral-cove', seed: 21, difficulty: 'medium', length: 2500, mix: MEDIUM, hills: 6, features: { void: 1, gapJumps: 1, streams: { n: 2, style: 'water' }, movers: { geyser: 2, roller: 1, sweeper: 1 }, shortcuts: 1 } },
  { id: 'pinewood-pass', seed: 22, difficulty: 'medium', length: 2500, mix: { ...MEDIUM, hairpin: 3 }, hills: 16, features: { jumps: 1, tunnels: 1, movers: { roller: 2, pendulum: 2 }, shortcuts: 2 } },
  { id: 'river-rapids', seed: 23, difficulty: 'medium', length: 2500, mix: { ...MEDIUM, esses: 4 }, hills: 8, features: { void: 1, gapJumps: 1, streams: { n: 3, style: 'water' }, movers: { geyser: 2, roller: 1, pendulum: 1 } } },
  { id: 'dune-canyon', seed: 24, difficulty: 'medium', length: 2500, mix: { ...MEDIUM, carousel: 1 }, hills: 10, features: { gapJumps: 1, movers: { roller: 2, geyser: 2, stomper: 1 }, hazards: 2, shortcuts: 1 } },
  // ---------------------------------------------------------------- Wild Cup (medium)
  { id: 'mushroom-hollow', seed: 31, difficulty: 'medium', length: 2500, mix: MEDIUM, hills: 12, features: { void: 2, jumps: 1, streams: { n: 1, style: 'neon' }, movers: { geyser: 2, sweeper: 2, roller: 1 }, shortcuts: 1 } },
  { id: 'temple-ruins', seed: 32, difficulty: 'medium', length: 2500, mix: { ...MEDIUM, chicane: 3 }, hills: 10, features: { gapJumps: 1, movers: { stomper: 2, pendulum: 2, roller: 1 }, shortcuts: 1 } },
  { id: 'jungle-falls', seed: 33, difficulty: 'medium', length: 2500, mix: { ...MEDIUM, compound: 3 }, hills: 14, features: { void: 1, gapJumps: 1, streams: { n: 2, style: 'water' }, movers: { pendulum: 2, roller: 2, geyser: 1 } } },
  { id: 'sunset-coast', seed: 34, difficulty: 'medium', length: 2500, mix: { ...MEDIUM, sweeper: 4, kink: 3 }, hills: 8, features: { void: 2, jumps: 1, movers: { sweeper: 2, roller: 1 }, boosts: 1 } },
  // ---------------------------------------------------------------- Thunder Cup (medium–hard)
  { id: 'frost-peak', seed: 41, difficulty: 'hard', length: 2350, mix: HARD, hills: 16, features: { void: 2, gapJumps: 1, movers: { roller: 2, stomper: 2, pendulum: 1 }, tunnels: 1 } },
  { id: 'neon-metro', seed: 42, difficulty: 'medium', length: 2500, mix: { ...MEDIUM, carousel: 0 }, hills: 0, figure8: true, features: { streams: { n: 1, style: 'neon' }, movers: { stomper: 2, sweeper: 2 }, boosts: 2 } },
  { id: 'moonlit-marsh', seed: 43, difficulty: 'medium', length: 2500, mix: { ...MEDIUM, esses: 4 }, hills: 6, features: { void: 1, gapJumps: 1, streams: { n: 1, style: 'water' }, movers: { geyser: 2, pendulum: 2, sweeper: 1 } } },
  { id: 'clockwork-factory', seed: 44, difficulty: 'hard', length: 2350, mix: { ...HARD, chicane: 3 }, hills: 8, features: { gapJumps: 1, streams: { n: 2, style: 'neon' }, movers: { stomper: 3, sweeper: 2, pendulum: 1 } } },
  // ---------------------------------------------------------------- Extreme Cup (hard)
  { id: 'volcano-run', seed: 51, difficulty: 'hard', length: 2350, mix: HARD, hills: 14, features: { void: 1, gapJumps: 2, streams: { n: 1, style: 'lava' }, movers: { geyser: 3, roller: 2, stomper: 1 }, shortcuts: 1 } },
  { id: 'sky-garden', seed: 52, difficulty: 'hard', length: 2350, mix: HARD, hills: 20, space: true, features: { void: 2, gapJumps: 2, streams: { n: 2, style: 'wind' }, movers: { sweeper: 2, pendulum: 2, roller: 1 } } },
  { id: 'glacier-gauntlet', seed: 53, difficulty: 'hard', length: 2350, mix: { ...HARD, hairpin: 3 }, hills: 14, features: { void: 2, gapJumps: 1, movers: { roller: 2, stomper: 2, sweeper: 1 }, shortcuts: 1 } },
  { id: 'thunder-ridge', seed: 54, difficulty: 'hard', length: 2350, mix: HARD, hills: 18, features: { void: 3, gapJumps: 2, movers: { pendulum: 2, roller: 2, stomper: 1 } } },
  // ---------------------------------------------------------------- Cosmic Cup (hard)
  { id: 'starlight-highway', seed: 61, difficulty: 'hard', length: 2350, mix: { ...HARD, sweeper: 3 }, hills: 22, space: true, features: { void: 2, gapJumps: 2, streams: { n: 2, style: 'neon' }, movers: { sweeper: 2, geyser: 2, pendulum: 1 } } },
  { id: 'magma-core', seed: 62, difficulty: 'hard', length: 2350, mix: HARD, hills: 12, features: { void: 1, gapJumps: 1, streams: { n: 2, style: 'lava' }, movers: { geyser: 3, stomper: 2, roller: 1 } } },
  { id: 'comet-coaster', seed: 63, difficulty: 'hard', length: 2350, mix: { ...HARD, carousel: 0 }, hills: 0, space: true, figure8: true, features: { void: 1, gapJumps: 2, movers: { pendulum: 2, roller: 1, sweeper: 1 } } },
  { id: 'prism-road', seed: 64, difficulty: 'hard', length: 2350, mix: { ...HARD, carousel: 1 }, hills: 24, space: true, features: { void: 2, gapJumps: 2, streams: { n: 2, style: 'neon' }, movers: { sweeper: 2, stomper: 1, roller: 1, pendulum: 1 } } },
];
