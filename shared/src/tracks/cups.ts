import type { Cup } from '../race/GrandPrix';

/** Grand Prix cups: four tracks each, easiest first. */
export const CUPS: readonly Cup[] = [
  { id: 'sunny-cup', name: 'Sunny Cup', tracks: ['sunny-circuit', 'palm-bay', 'harvest-lane', 'pinewood-pass'] },
  { id: 'wild-cup', name: 'Wild Cup', tracks: ['dune-canyon', 'maple-glen', 'mushroom-hollow', 'temple-ruins'] },
  { id: 'extreme-cup', name: 'Extreme Cup', tracks: ['frost-peak', 'sunset-coast', 'neon-metro', 'volcano-run'] },
];

export function getCup(id: string): Cup {
  const c = CUPS.find((cup) => cup.id === id);
  if (!c) throw new Error(`Unknown cup "${id}"`);
  return c;
}
