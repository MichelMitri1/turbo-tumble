import type { Cup } from '../race/GrandPrix';

/** Grand Prix cups: four tracks each, getting harder cup by cup. */
export const CUPS: readonly Cup[] = [
  { id: 'sunny-cup', name: 'Sunny Cup', tracks: ['sunny-circuit', 'palm-bay', 'harvest-lane', 'maple-glen'] },
  { id: 'splash-cup', name: 'Splash Cup', tracks: ['coral-cove', 'pinewood-pass', 'river-rapids', 'dune-canyon'] },
  { id: 'wild-cup', name: 'Wild Cup', tracks: ['mushroom-hollow', 'temple-ruins', 'jungle-falls', 'sunset-coast'] },
  { id: 'thunder-cup', name: 'Thunder Cup', tracks: ['frost-peak', 'neon-metro', 'moonlit-marsh', 'clockwork-factory'] },
  { id: 'extreme-cup', name: 'Extreme Cup', tracks: ['volcano-run', 'sky-garden', 'glacier-gauntlet', 'thunder-ridge'] },
  { id: 'cosmic-cup', name: 'Cosmic Cup', tracks: ['starlight-highway', 'magma-core', 'comet-coaster', 'prism-road'] },
];

export function getCup(id: string): Cup {
  const c = CUPS.find((cup) => cup.id === id);
  if (!c) throw new Error(`Unknown cup "${id}"`);
  return c;
}
