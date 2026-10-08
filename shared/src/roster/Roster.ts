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

/*
 * Stat deltas are deliberately wide (light/medium/heavy archetypes) but balanced:
 * in "points" (0.5 m/s top speed = 0.07 accel = 0.07 turn = 1 pt; 0.2 weight or
 * 0.6 grip = ½ pt) every entry nets out to about zero.
 */
export const CHARACTER_ROSTER: readonly RosterEntry[] = [
  { id: 'bix', name: 'Bix', stats: {} },
  { id: 'pip', name: 'Pip', stats: { maxSpeed: -1.0, accelRate: 0.07, turnRate: 0.14, weight: -0.4 } },
  { id: 'zuzu', name: 'Zuzu', stats: { maxSpeed: 1.0, accelRate: -0.07, turnRate: -0.07 } },
  { id: 'tuko', name: 'Tuko', stats: { grip: -1.5, turnRate: 0.17, maxSpeed: -0.6 } },
  { id: 'mox', name: 'Mox', stats: { weight: 0.8, maxSpeed: 0.5, accelRate: -0.14, turnRate: -0.07 } },
  { id: 'nova', name: 'Nova', stats: { accelRate: 0.21, maxSpeed: -0.9, turnRate: -0.05, weight: -0.2 } },
  { id: 'rumble', name: 'Rumble', stats: { weight: 1.0, maxSpeed: 1.0, accelRate: -0.17, turnRate: -0.15 } },
  { id: 'kiki', name: 'Kiki', stats: { turnRate: 0.21, accelRate: 0.07, maxSpeed: -1.4, weight: -0.5 } },
  { id: 'juno', name: 'Juno', stats: { maxSpeed: 0.9, turnRate: -0.1, weight: 0.3, accelRate: -0.07 } },
  { id: 'sprig', name: 'Sprig', stats: { grip: 1.2, accelRate: 0.07, maxSpeed: -0.6, weight: -0.3 } },
  { id: 'blaze', name: 'Blaze', stats: { grip: -1.8, turnRate: 0.14, accelRate: -0.04 } },
  { id: 'pearl', name: 'Pearl', stats: { weight: 0.5, maxSpeed: 0.3, accelRate: -0.08, grip: -0.6 } },
];

export const KART_ROSTER: readonly RosterEntry[] = [
  { id: 'comet', name: 'Comet', stats: {} },
  { id: 'bubblegum', name: 'Bubblegum', stats: { accelRate: 0.2, maxSpeed: -1.3, turnRate: 0.05, weight: -0.3 } },
  { id: 'sunburst', name: 'Sunburst', stats: { maxSpeed: 1.7, accelRate: -0.14, turnRate: -0.1 } },
  { id: 'lagoon', name: 'Lagoon', stats: { turnRate: 0.2, grip: 0.6, maxSpeed: -1.3, accelRate: -0.05 } },
  { id: 'mocha', name: 'Mocha', stats: { weight: 0.9, maxSpeed: 0.6, accelRate: -0.14, turnRate: -0.1 } },
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
