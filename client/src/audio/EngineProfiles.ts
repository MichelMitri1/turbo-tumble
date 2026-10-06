import type { EngineTuning } from './EngineDynamics';

export interface EngineSample {
  url: string;
  rpm: number;
  /** Seamless, steady-RPM loops, with their original source documented alongside the asset. */
  loopStart?: number;
  loopEnd?: number;
}

export interface EngineProfile {
  id: string;
  name: string;
  inspiration: string;
  description: string;
  tuning: EngineTuning;
  /** Exhaust firing events over one four-stroke cycle, separated by bank. */
  banks: readonly [readonly number[], readonly number[]];
  rasp: number;
  bass: number;
  intake: number;
  whine: number;
  crackle: number;
  brightness: number;
  /** Optional authentic recordings replace the designed exhaust layers in their RPM band. */
  samples?: readonly EngineSample[];
  /** What the recordings actually are (shown in menus when samples exist). */
  recordedFrom?: string;
}

/** Real recordings (CC BY-SA, Wikimedia Commons) — built by tools/make-engine-loops.mjs. */
const REC = (file: string, rpm: number): EngineSample => ({ url: `assets/audio/engines/${file}`, rpm });

/** Designed voices are explicitly labelled as inspirations, not authentic recordings. */
export const ENGINE_PROFILES: readonly EngineProfile[] = [
  { id: 'svr-v8', name: 'Supercharged V8', inspiration: 'Jaguar F-Type SVR', description: 'Deep bark · supercharger whine · lift-off crackles', tuning: { idle: 750, redline: 6800, response: 7, gears: 5 }, banks: [[0, 0.125, 0.375, 0.75], [0.25, 0.5, 0.625, 0.875]], rasp: 0.7, bass: 0.8, intake: 0.18, whine: 0.13, crackle: 0.9, brightness: 3000, recordedFrom: 'Jaguar 5.0 supercharged V8', samples: [REC('svr-v8-5550.wav', 5550)] },
  { id: 'lfa-v10', name: 'Screaming V10', inspiration: 'Lexus LFA', description: 'Fast-revving tenor · sharp intake howl', tuning: { idle: 900, redline: 9000, response: 11, gears: 6 }, banks: [[0, 0.2, 0.4, 0.6, 0.8], [0.1, 0.3, 0.5, 0.7, 0.9]], rasp: 0.22, bass: 0.18, intake: 0.52, whine: 0, crackle: 0.2, brightness: 5200, recordedFrom: 'Lexus LFA V10', samples: [REC('lfa-v10-1550.wav', 1550), REC('lfa-v10-4450.wav', 4450)] },
  { id: 'italia-v8', name: 'Flat-plane V8', inspiration: 'Ferrari 458 Italia', description: 'Metallic snarl · bright high-rev scream', tuning: { idle: 850, redline: 9000, response: 9, gears: 6 }, banks: [[0, 0.25, 0.5, 0.75], [0.125, 0.375, 0.625, 0.875]], rasp: 0.5, bass: 0.25, intake: 0.4, whine: 0, crackle: 0.55, brightness: 4600, recordedFrom: 'Ferrari 458 Italia V8', samples: [REC('italia-v8-3000.wav', 3000), REC('italia-v8-4400.wav', 4400)] },
  { id: 'gt3-flat6', name: 'Racing Flat-six', inspiration: 'Porsche 911 GT3', description: 'Dry boxer rasp · mechanical high-rev howl', tuning: { idle: 900, redline: 9000, response: 9.5, gears: 6 }, banks: [[0, 1 / 3, 2 / 3], [1 / 6, 0.5, 5 / 6]], rasp: 0.8, bass: 0.32, intake: 0.3, whine: 0, crackle: 0.35, brightness: 3900, recordedFrom: 'Porsche 997 GT3 RS flat-six', samples: [REC('gt3-flat6-3300.wav', 3300)] },
  { id: 'aventador-v12', name: 'Operatic V12', inspiration: 'Lamborghini Aventador', description: 'Rich twelve-cylinder roar · piercing top end', tuning: { idle: 850, redline: 8500, response: 6.5, gears: 6 }, banks: [[0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6], [1 / 12, 3 / 12, 5 / 12, 7 / 12, 9 / 12, 11 / 12]], rasp: 0.38, bass: 0.5, intake: 0.42, whine: 0, crackle: 0.45, brightness: 4400, recordedFrom: 'Lamborghini Aventador V12', samples: [REC('aventador-v12-1700.wav', 1700), REC('aventador-v12-7550.wav', 7550)] },
];

export function getEngineProfile(id: string): EngineProfile {
  return ENGINE_PROFILES.find((p) => p.id === id) ?? ENGINE_PROFILES[0]!;
}

export function engineLabel(profile: EngineProfile): string {
  return profile.samples?.length ? `${profile.recordedFrom ?? profile.inspiration} · real recording` : `${profile.inspiration}-inspired`;
}
