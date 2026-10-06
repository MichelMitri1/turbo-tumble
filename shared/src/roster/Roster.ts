import { BASE_KART_STATS, withModifiers, type KartStats } from '../vehicles/KartStats';
import type { RacerSetup } from '../race/RaceSimulation';

/**
 * Gameplay half of the roster (ids, names, stat deltas). Shared so the server
 * builds exactly the same racers as the client; the client adds models/colours.
 */
export interface RosterEntry {
  id: string;
  name: string;
  /** Additive deltas on BASE_KART_STATS. */
  stats: Partial<KartStats>;
}

export const CHARACTER_ROSTER: readonly RosterEntry[] = [
  { id: 'bix', name: 'Bix', stats: {} },
  { id: 'pip', name: 'Pip', stats: { turnRate: 0.07 } },
  { id: 'zuzu', name: 'Zuzu', stats: { maxSpeed: 0.5 } },
  { id: 'tuko', name: 'Tuko', stats: { grip: -0.5 } },
  { id: 'mox', name: 'Mox', stats: { weight: 0.3 } },
  { id: 'nova', name: 'Nova', stats: { accelRate: 0.06 } },
  { id: 'rumble', name: 'Rumble', stats: { weight: 0.35, accelRate: -0.05 } },
  { id: 'kiki', name: 'Kiki', stats: { turnRate: 0.08, maxSpeed: -0.2 } },
  { id: 'juno', name: 'Juno', stats: { maxSpeed: 0.3 } },
  { id: 'sprig', name: 'Sprig', stats: { grip: 0.4 } },
  { id: 'blaze', name: 'Blaze', stats: { grip: -0.6, turnRate: 0.05 } },
  { id: 'pearl', name: 'Pearl', stats: { weight: 0.15, maxSpeed: 0.2 } },
];

export const KART_ROSTER: readonly RosterEntry[] = [
  { id: 'comet', name: 'Comet', stats: {} },
  { id: 'bubblegum', name: 'Bubblegum', stats: { accelRate: 0.1 } },
  { id: 'sunburst', name: 'Sunburst', stats: { maxSpeed: 0.5, accelRate: -0.05 } },
  { id: 'lagoon', name: 'Lagoon', stats: { turnRate: 0.1 } },
  { id: 'mocha', name: 'Mocha', stats: { weight: 0.25 } },
];

export function characterEntry(id: string): RosterEntry {
  return CHARACTER_ROSTER.find((c) => c.id === id) ?? CHARACTER_ROSTER[0]!;
}

export function kartEntry(id: string): RosterEntry {
  return KART_ROSTER.find((k) => k.id === id) ?? KART_ROSTER[0]!;
}

/** Final stats for a driver + kart combination. */
export function racerStats(characterId: string, kartId: string): KartStats {
  return withModifiers(BASE_KART_STATS, kartEntry(kartId).stats, characterEntry(characterId).stats);
}

const ROMAN = ['', ' II', ' III', ' IV'];

/** `count` CPU racers with varied driver/kart combos (ids cpu-0..). */
export function cpuField(count: number): RacerSetup[] {
  const out: RacerSetup[] = [];
  for (let i = 0; i < count; i++) {
    const c = CHARACTER_ROSTER[i % CHARACTER_ROSTER.length]!;
    const k = KART_ROSTER[(i * 2 + 1) % KART_ROSTER.length]!;
    // Small roster for now (Phase 7 adds racers): repeat drivers get a numeral.
    const name = `${c.name}${ROMAN[Math.floor(i / CHARACTER_ROSTER.length)] ?? ''}`;
    out.push({ id: `cpu-${i}`, name, characterId: c.id, kartId: k.id, isAI: true, stats: racerStats(c.id, k.id) });
  }
  return out;
}

export function humanSetup(id: string, name: string, characterId: string, kartId: string): RacerSetup {
  const c = characterEntry(characterId);
  const k = kartEntry(kartId);
  return { id, name, characterId: c.id, kartId: k.id, isAI: false, stats: racerStats(c.id, k.id) };
}
