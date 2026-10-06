import type { KartStats } from '@shared/vehicles/KartStats';
import { characterEntry, kartEntry } from '@shared/roster/Roster';
import type { ModelId } from '../assets/AssetManifest';

/**
 * Original racers. Each Kenney Car Kit file contains a kart body and a driver; the
 * model factory can pair any driver with any body, so characters and karts are
 * selected independently.
 */
export interface CharacterDefinition {
  id: string;
  name: string;
  /** GLB that contains this driver's `character` node. */
  model: ModelId;
  color: string;
  tagline: string;
  /** Small handling modifiers (additive deltas) layered on the kart's stats. */
  stats: Partial<KartStats>;
  /** Hue rotation (degrees) applied to the driver's skin colours — new racers reuse a base model. */
  hue?: number;
  /** Signature helmet topper (see DriverRig); defaults to the character id. */
  topper?: string;
}

export interface KartBodyDefinition {
  id: string;
  engine: string;
  name: string;
  /** GLB whose body + wheels are used. */
  model: ModelId;
  color: string;
  stats: Partial<KartStats>;
}

export const CHARACTERS: readonly CharacterDefinition[] = [
  { id: 'bix', name: 'Bix', model: 'kart-oobi', color: '#8a6cff', tagline: 'Cosmic courier', stats: characterEntry('bix').stats },
  { id: 'pip', name: 'Pip', model: 'kart-oodi', color: '#ff6fae', tagline: 'Turbo prankster', stats: characterEntry('pip').stats },
  { id: 'zuzu', name: 'Zuzu', model: 'kart-ooli', color: '#ffb52e', tagline: 'Sunny speedster', stats: characterEntry('zuzu').stats },
  { id: 'tuko', name: 'Tuko', model: 'kart-oopi', color: '#2fd0b5', tagline: 'Chill drifter', stats: characterEntry('tuko').stats },
  { id: 'mox', name: 'Mox', model: 'kart-oozi', color: '#c9a48a', tagline: 'Heavy hitter', stats: characterEntry('mox').stats },
  { id: 'nova', name: 'Nova', model: 'kart-oobi', color: '#4dd6ff', tagline: 'Star surfer', hue: 180, stats: characterEntry('nova').stats },
  { id: 'rumble', name: 'Rumble', model: 'kart-oozi', color: '#d9583a', tagline: 'Volcano brute', hue: -25, stats: characterEntry('rumble').stats },
  { id: 'kiki', name: 'Kiki', model: 'kart-oodi', color: '#ffe14d', tagline: 'Glitter racer', hue: 75, stats: characterEntry('kiki').stats },
  { id: 'juno', name: 'Juno', model: 'kart-ooli', color: '#3f7bff', tagline: 'Night rider', hue: 190, stats: characterEntry('juno').stats },
  { id: 'sprig', name: 'Sprig', model: 'kart-oopi', color: '#7ddc4a', tagline: 'Forest sprinter', hue: -55, stats: characterEntry('sprig').stats },
  { id: 'blaze', name: 'Blaze', model: 'kart-oobi', color: '#ff5a2a', tagline: 'Drift demon', hue: 105, stats: characterEntry('blaze').stats },
  { id: 'pearl', name: 'Pearl', model: 'kart-oodi', color: '#c9b8ff', tagline: 'Cool captain', hue: -70, stats: characterEntry('pearl').stats },
];

export const KART_BODIES: readonly KartBodyDefinition[] = [
  { id: 'comet', engine: 'svr-v8', name: 'Comet', model: 'kart-oobi', color: '#8a6cff', stats: kartEntry('comet').stats },
  { id: 'bubblegum', engine: 'lfa-v10', name: 'Bubblegum', model: 'kart-oodi', color: '#ff6fae', stats: kartEntry('bubblegum').stats },
  { id: 'sunburst', engine: 'italia-v8', name: 'Sunburst', model: 'kart-ooli', color: '#ffb52e', stats: kartEntry('sunburst').stats },
  { id: 'lagoon', engine: 'gt3-flat6', name: 'Lagoon', model: 'kart-oopi', color: '#2fd0b5', stats: kartEntry('lagoon').stats },
  { id: 'mocha', engine: 'aventador-v12', name: 'Mocha', model: 'kart-oozi', color: '#c9a48a', stats: kartEntry('mocha').stats },
];

export function getCharacter(id: string): CharacterDefinition {
  return CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0]!;
}

export function getKartBody(id: string): KartBodyDefinition {
  return KART_BODIES.find((k) => k.id === id) ?? KART_BODIES[0]!;
}

/** Metres per model unit for kart GLBs (Kenney karts are ~1 unit wide). */
export const KART_MODEL_SCALE = 2.2;
