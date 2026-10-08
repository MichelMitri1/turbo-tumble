/**
 * The arenas. Every one has the exact same collision (the sim never changes);
 * only the look, sky, lighting, surroundings and weather differ. Shared by the
 * browser and the server (no three.js here).
 */
export const ARENA_IDS = ['dome', 'mannfield', 'urban', 'badlands', 'frosty', 'starbase'] as const;
export type ArenaId = (typeof ARENA_IDS)[number];

export const ARENAS: Record<ArenaId, { name: string; desc: string }> = {
  dome: { name: 'Champions Dome', desc: 'Night · indoor stadium, hex glass, roaring crowd' },
  mannfield: { name: 'Mannfield', desc: 'Day · open-air stadium, blue sky, bright grass' },
  urban: { name: 'Urban Central', desc: 'Dusk · rooftop pitch below a city skyline' },
  badlands: { name: 'Badlands', desc: 'Desert · dirt floor, mesas and tyre stacks' },
  frosty: { name: 'Frosty Mannfield', desc: 'Snow · falling snow, blue lines, cold floodlights' },
  starbase: { name: 'Starbase ARC', desc: 'Space · metal deck, neon walls, a planet overhead' },
};

export const isArenaId = (v: unknown): v is ArenaId => typeof v === 'string' && (ARENA_IDS as readonly string[]).includes(v);

/** Resolve an arena choice ('random' picks one). */
export function pickArena(choice: ArenaId | 'random'): ArenaId {
  if (choice !== 'random') return choice;
  return ARENA_IDS[Math.floor(Math.random() * ARENA_IDS.length)]!;
}
