import type { Cup } from '../race/GrandPrix';

/**
 * Grand Prix cups. Until more tracks land (Phase 7) the Sunny Cup runs Sunny Circuit
 * four times; cups only reference track ids, so new tracks slot straight in.
 */
export const CUPS: readonly Cup[] = [{ id: 'sunny-cup', name: 'Sunny Cup', tracks: ['sunny-circuit', 'sunny-circuit', 'sunny-circuit', 'sunny-circuit'] }];

export function getCup(id: string): Cup {
  const c = CUPS.find((cup) => cup.id === id);
  if (!c) throw new Error(`Unknown cup "${id}"`);
  return c;
}
