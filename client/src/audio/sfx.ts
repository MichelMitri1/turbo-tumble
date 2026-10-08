import { noise, notes, tone, vowel, type SynthCtx } from './synth';

export interface SfxParams {
  /** 0..1 strength (impacts, bumps). */
  intensity?: number;
  /** Drift / mini-turbo stage 1..3, pulse index, etc. */
  stage?: number;
}

type Generator = (c: SynthCtx, p: SfxParams) => void;

const I = (p: SfxParams, d = 1): number => p.intensity ?? d;

function swish(c: SynthCtx): void {
  noise(c, { dur: 0.14, gain: 0.35, filter: { type: 'bandpass', freq: 2200, to: 700, q: 1.5 } });
  tone(c, { type: 'triangle', freq: 520, to: 240, dur: 0.12, gain: 0.18 });
}

/**
 * Every sound effect in the game, synthesised. Names are referenced by
 * RaceAudio / UI code; tools/audio-check renders each one offline to check
 * level and length.
 */
export const SFX = {
  // ---------------------------------------------------------------- UI
  uiMove: (c) => tone(c, { type: 'square', freq: 880, dur: 0.045, gain: 0.07, filter: { type: 'lowpass', freq: 2600 } }),
  uiChange: (c) => tone(c, { type: 'triangle', freq: 620, to: 930, dur: 0.07, gain: 0.16 }),
  uiConfirm: (c) =>
    notes(
      c,
      [
        ['C6', 0, 0.07],
        ['G6', 0.06, 0.14],
      ],
      { type: 'square', gain: 0.09, filter: { type: 'lowpass', freq: 3200 } },
    ),
  uiBack: (c) =>
    notes(
      c,
      [
        ['G5', 0, 0.07],
        ['C5', 0.06, 0.12],
      ],
      { type: 'square', gain: 0.08, filter: { type: 'lowpass', freq: 2400 } },
    ),
  uiReady: (c) =>
    notes(
      c,
      [
        ['E6', 0, 0.3],
        ['B6', 0.07, 0.4],
      ],
      { type: 'sine', gain: 0.22 },
    ),
  uiJoin: (c) => tone(c, { type: 'sine', freq: 300, to: 950, dur: 0.1, gain: 0.3 }),
  uiError: (c) => {
    tone(c, { type: 'square', freq: 196, dur: 0.1, gain: 0.08, filter: { type: 'lowpass', freq: 1500 } });
    tone(c, { type: 'square', freq: 185, at: 0.12, dur: 0.14, gain: 0.08, filter: { type: 'lowpass', freq: 1500 } });
  },

  // ---------------------------------------------------------------- start
  countBeep: (c) => {
    tone(c, { type: 'square', freq: 880, dur: 0.22, gain: 0.12, release: 0.08, filter: { type: 'lowpass', freq: 4000 } });
    tone(c, { type: 'sine', freq: 880, dur: 0.3, gain: 0.2 });
  },
  countGo: (c) => {
    tone(c, { type: 'square', freq: 1760, dur: 0.7, gain: 0.1, release: 0.3, vibrato: { rate: 7, depth: 0.01 }, filter: { type: 'lowpass', freq: 5000 } });
    tone(c, { type: 'sine', freq: 1760, dur: 0.8, gain: 0.18 });
    tone(c, { type: 'sine', freq: 880, dur: 0.6, gain: 0.12 });
  },
  rocketGood: (c) => {
    noise(c, { dur: 0.7, gain: 0.45, attack: 0.02, filter: { type: 'bandpass', freq: 500, to: 3500, q: 1.2 } });
    tone(c, { type: 'sawtooth', freq: 160, to: 640, dur: 0.6, gain: 0.14, filter: { type: 'lowpass', freq: 1800 } });
  },
  rocketStall: (c) => {
    for (const [at, g] of [
      [0, 0.5],
      [0.11, 0.35],
      [0.19, 0.45],
      [0.34, 0.3],
      [0.5, 0.2],
    ] as const)
      noise(c, { at, dur: 0.07, gain: g, filter: { type: 'lowpass', freq: 380 }, rate: 0.5 });
    tone(c, { type: 'sawtooth', freq: 95, to: 45, dur: 0.6, gain: 0.12, filter: { type: 'lowpass', freq: 400 } });
  },

  // ---------------------------------------------------------------- kart
  hop: (c) => tone(c, { type: 'sine', freq: 240, to: 560, dur: 0.1, gain: 0.22 }),
  land: (c, p) => {
    const k = I(p, 0.5);
    tone(c, { type: 'sine', freq: 130, to: 48, dur: 0.16, gain: 0.55 * k });
    noise(c, { dur: 0.1, gain: 0.35 * k, filter: { type: 'lowpass', freq: 500 } });
  },
  wallHit: (c, p) => {
    const k = I(p, 0.6);
    noise(c, { dur: 0.16, gain: 0.55 * k, filter: { type: 'bandpass', freq: 900, q: 2.5 } });
    tone(c, { type: 'triangle', freq: 190, to: 110, dur: 0.14, gain: 0.4 * k });
    tone(c, { type: 'sine', freq: 640 + Math.random() * 120, dur: 0.18, gain: 0.08 * k });
  },
  bump: (c, p) => {
    const k = I(p, 0.6);
    tone(c, { type: 'sine', freq: 170, to: 75, dur: 0.18, gain: 0.5 * k });
    noise(c, { dur: 0.12, gain: 0.3 * k, filter: { type: 'lowpass', freq: 900 } });
    tone(c, { type: 'triangle', freq: 330, to: 260, dur: 0.1, gain: 0.12 * k });
  },
  driftStage: (c, p) => {
    const note = ['E6', 'E6', 'A6', 'D7'][p.stage ?? 1] ?? 'E6';
    notes(c, [[note, 0, 0.22]], { type: 'sine', gain: 0.22 });
    noise(c, { dur: 0.12, gain: 0.08, filter: { type: 'highpass', freq: 6000 } });
  },
  miniTurbo: (c, p) => {
    const s = p.stage ?? 1;
    noise(c, { dur: 0.35 + s * 0.12, gain: 0.3 + s * 0.08, attack: 0.01, filter: { type: 'bandpass', freq: 400, to: 2200 + s * 600, q: 1.4 } });
    tone(c, { type: 'sawtooth', freq: 140, to: 300 + s * 140, dur: 0.3 + s * 0.08, gain: 0.12, filter: { type: 'lowpass', freq: 1400 } });
  },
  respawn: (c) => {
    tone(c, { type: 'sine', freq: 1300, to: 260, dur: 0.4, gain: 0.25 });
    notes(
      c,
      [
        ['C6', 0.35, 0.15],
        ['G6', 0.43, 0.2],
      ],
      { type: 'sine', gain: 0.15 },
    );
  },
  boostPad: (c) => {
    tone(c, { type: 'sawtooth', freq: 260, to: 1300, dur: 0.32, gain: 0.12, filter: { type: 'lowpass', freq: 3000 } });
    noise(c, { dur: 0.4, gain: 0.3, filter: { type: 'bandpass', freq: 800, to: 3000, q: 1 } });
  },
  coin: (c) => {
    notes(
      c,
      [
        ['G6', 0, 0.12],
        ['D7', 0.07, 0.3],
      ],
      { type: 'sine', gain: 0.24 },
    );
    noise(c, { at: 0.05, dur: 0.15, gain: 0.05, filter: { type: 'highpass', freq: 8000 } });
  },
  wrongWay: (c) => {
    tone(c, { type: 'square', freq: 233, dur: 0.12, gain: 0.07, filter: { type: 'lowpass', freq: 1600 } });
    tone(c, { type: 'square', freq: 233, at: 0.18, dur: 0.12, gain: 0.07, filter: { type: 'lowpass', freq: 1600 } });
  },

  // ---------------------------------------------------------------- items
  itemBox: (c) => {
    noise(c, { dur: 0.16, gain: 0.25, filter: { type: 'highpass', freq: 3000 } });
    notes(
      c,
      [
        ['E6', 0, 0.12],
        ['G#6', 0.04, 0.12],
        ['B6', 0.08, 0.25],
      ],
      { type: 'sine', gain: 0.16 },
    );
  },
  rouletteTick: (c) => tone(c, { type: 'square', freq: 1500, dur: 0.03, gain: 0.08, filter: { type: 'lowpass', freq: 5000 } }),
  itemReady: (c) =>
    notes(
      c,
      [
        ['C7', 0, 0.12],
        ['E7', 0.05, 0.3],
      ],
      { type: 'sine', gain: 0.2 },
    ),
  fizz: (c) => {
    noise(c, { dur: 0.5, gain: 0.35, attack: 0.01, filter: { type: 'bandpass', freq: 1400, to: 6000, q: 1.5 } });
    tone(c, { type: 'sine', freq: 320, to: 1300, dur: 0.28, gain: 0.22 });
    tone(c, { type: 'sine', freq: 900, at: 0.02, dur: 0.05, gain: 0.2 });
  },
  throw: (c) => swish(c),
  seekerLaunch: (c) => {
    tone(c, { type: 'square', freq: 600, to: 1300, dur: 0.16, gain: 0.08, filter: { type: 'lowpass', freq: 4000 } });
    notes(
      c,
      [
        ['A6', 0.16, 0.05],
        ['A6', 0.26, 0.05],
      ],
      { type: 'square', gain: 0.06, filter: { type: 'lowpass', freq: 5000 } },
    );
    noise(c, { dur: 0.3, gain: 0.2, filter: { type: 'bandpass', freq: 1500, to: 3000, q: 1 } });
  },
  crownLaunch: (c) => {
    tone(c, { type: 'sawtooth', freq: 380, to: 950, dur: 1.1, gain: 0.12, vibrato: { rate: 9, depth: 0.04 }, filter: { type: 'lowpass', freq: 2500 } });
    noise(c, { dur: 1, gain: 0.25, filter: { type: 'bandpass', freq: 600, to: 2400, q: 1 } });
  },
  alarm: (c) => {
    tone(c, { type: 'square', freq: 988, dur: 0.16, gain: 0.07, filter: { type: 'lowpass', freq: 3000 } });
    tone(c, { type: 'square', freq: 740, at: 0.18, dur: 0.16, gain: 0.07, filter: { type: 'lowpass', freq: 3000 } });
  },
  splat: (c) => {
    noise(c, { dur: 0.22, gain: 0.45, filter: { type: 'lowpass', freq: 1100, to: 220 } });
    tone(c, { type: 'sine', freq: 200, to: 90, dur: 0.16, gain: 0.3 });
  },
  fuse: (c) => {
    noise(c, { dur: 0.45, gain: 0.12, filter: { type: 'highpass', freq: 4500 } });
    swish(c);
  },
  clunk: (c) => {
    tone(c, { type: 'square', freq: 210, dur: 0.06, gain: 0.12, filter: { type: 'lowpass', freq: 900 } });
    noise(c, { dur: 0.08, gain: 0.3, filter: { type: 'lowpass', freq: 1200 } });
  },
  paint: (c) => {
    noise(c, { dur: 0.3, gain: 0.4, filter: { type: 'bandpass', freq: 600, to: 2600, q: 4 } });
    tone(c, { type: 'sine', freq: 300, to: 520, dur: 0.25, gain: 0.15, vibrato: { rate: 18, depth: 0.08 } });
  },
  zap: (c) => {
    noise(c, { dur: 0.09, gain: 0.7, filter: { type: 'highpass', freq: 1800 } });
    noise(c, { at: 0.04, dur: 1.4, gain: 0.55, attack: 0.02, filter: { type: 'lowpass', freq: 700, to: 70 }, rate: 0.6 });
    tone(c, { type: 'sine', freq: 70, to: 32, dur: 1, gain: 0.35 });
  },
  prism: (c) => {
    notes(
      c,
      [
        ['C6', 0, 0.2],
        ['E6', 0.05, 0.2],
        ['G6', 0.1, 0.2],
        ['C7', 0.15, 0.25],
        ['E7', 0.2, 0.4],
      ],
      { type: 'sine', gain: 0.16 },
    );
    noise(c, { dur: 0.6, gain: 0.08, filter: { type: 'highpass', freq: 7000 } });
  },
  jetRocket: (c) => {
    noise(c, { dur: 1.4, gain: 0.6, attack: 0.05, filter: { type: 'lowpass', freq: 300, to: 1800 }, rate: 0.7 });
    tone(c, { type: 'sawtooth', freq: 80, to: 210, dur: 1.2, gain: 0.15, filter: { type: 'lowpass', freq: 900 } });
  },
  fire: (c) => {
    noise(c, { dur: 0.35, gain: 0.4, attack: 0.02, filter: { type: 'bandpass', freq: 800, to: 400, q: 0.8 } });
    for (const at of [0.03, 0.11, 0.2]) noise(c, { at, dur: 0.03, gain: 0.15, filter: { type: 'highpass', freq: 5000 } });
  },
  rang: (c) => tone(c, { type: 'sawtooth', freq: 420, dur: 0.6, gain: 0.08, vibrato: { rate: 22, depth: 0.12 }, filter: { type: 'lowpass', freq: 2200 } }),
  chomp: (c) => {
    for (const at of [0, 0.12]) {
      noise(c, { at, dur: 0.07, gain: 0.45, filter: { type: 'lowpass', freq: 700 } });
      tone(c, { type: 'square', freq: 120, at, dur: 0.06, gain: 0.1, filter: { type: 'lowpass', freq: 600 } });
    }
  },
  horn: (c) => {
    for (const f of [349, 440, 523]) tone(c, { type: 'square', freq: f, dur: 0.6, gain: 0.07, attack: 0.02, release: 0.15, vibrato: { rate: 6, depth: 0.006 }, filter: { type: 'lowpass', freq: 2000 } });
    noise(c, { dur: 0.6, gain: 0.15, filter: { type: 'lowpass', freq: 600, to: 120 } });
  },
  bubbles: (c) => {
    for (let i = 0; i < 5; i++) tone(c, { type: 'sine', freq: 400 + i * 90, to: 900 + i * 150, at: i * 0.06, dur: 0.06, gain: 0.15 });
  },
  quakePulse: (c, p) => {
    const k = 0.7 + 0.15 * (p.stage ?? 0);
    tone(c, { type: 'sine', freq: 75, to: 30, dur: 0.5, gain: 0.7 * k });
    noise(c, { dur: 0.45, gain: 0.4 * k, filter: { type: 'lowpass', freq: 260 }, rate: 0.5 });
  },
  explosion: (c, p) => {
    const k = I(p, 1);
    noise(c, { dur: 1, gain: 0.7 * k, attack: 0.004, filter: { type: 'lowpass', freq: 3200, to: 140 } });
    tone(c, { type: 'sine', freq: 95, to: 30, dur: 0.6, gain: 0.55 * k });
    for (const at of [0.08, 0.17, 0.3]) noise(c, { at, dur: 0.05, gain: 0.2 * k, filter: { type: 'highpass', freq: 3000 } });
  },
  shockwave: (c) => {
    tone(c, { type: 'sine', freq: 220, to: 40, dur: 0.45, gain: 0.55 });
    noise(c, { dur: 0.4, gain: 0.35, filter: { type: 'lowpass', freq: 1600, to: 200 } });
  },
  hitSpin: (c) => {
    tone(c, { type: 'triangle', freq: 640, to: 300, dur: 0.14, gain: 0.3 });
    tone(c, { type: 'sine', freq: 950, at: 0.12, dur: 0.6, gain: 0.1, vibrato: { rate: 9, depth: 0.08 } });
  },
  hitTumble: (c) => {
    noise(c, { dur: 0.35, gain: 0.5, filter: { type: 'bandpass', freq: 1400, q: 1 } });
    tone(c, { type: 'triangle', freq: 520, to: 160, dur: 0.3, gain: 0.3 });
    tone(c, { type: 'sine', freq: 900, at: 0.25, dur: 0.6, gain: 0.08, vibrato: { rate: 9, depth: 0.08 } });
  },
  hitSquish: (c) => {
    tone(c, { type: 'sine', freq: 420, to: 70, dur: 0.32, gain: 0.45 });
    noise(c, { dur: 0.25, gain: 0.3, filter: { type: 'lowpass', freq: 600 } });
  },
  blocked: (c) => {
    tone(c, { type: 'sine', freq: 2400, dur: 0.18, gain: 0.15 });
    tone(c, { type: 'sine', freq: 3620, dur: 0.12, gain: 0.08 });
  },
  poof: (c) => noise(c, { dur: 0.18, gain: 0.25, filter: { type: 'bandpass', freq: 1300, to: 400, q: 0.8 } }),

  /** Shot homing in: a short two-tone radar ping (urgency 0..1 raises the pitch). */
  incoming: (c, p) => {
    const k = I(p, 0.5);
    tone(c, { type: 'square', freq: 1200 + k * 500, dur: 0.07, gain: 0.07, filter: { type: 'lowpass', freq: 4000 } });
    tone(c, { type: 'sine', freq: 1800 + k * 700, at: 0.06, dur: 0.08, gain: 0.1 });
  },
  phantom: (c) => {
    tone(c, { type: 'sine', freq: 520, to: 260, dur: 0.7, gain: 0.18, vibrato: { rate: 6, depth: 0.05 } });
    tone(c, { type: 'triangle', freq: 780, to: 390, at: 0.05, dur: 0.6, gain: 0.08, vibrato: { rate: 5, depth: 0.06 } });
    noise(c, { dur: 0.5, gain: 0.1, filter: { type: 'bandpass', freq: 2500, to: 900, q: 2 } });
  },
  steal: (c) => {
    notes(
      c,
      [
        ['A6', 0, 0.06],
        ['E7', 0.05, 0.12],
      ],
      { type: 'square', gain: 0.07, filter: { type: 'lowpass', freq: 5000 } },
    );
    swish(c);
  },
  giant: (c) => {
    tone(c, { type: 'sawtooth', freq: 70, to: 140, dur: 0.9, gain: 0.16, filter: { type: 'lowpass', freq: 700 } });
    notes(
      c,
      [
        ['C4', 0, 0.18],
        ['G4', 0.15, 0.18],
        ['C5', 0.3, 0.5],
      ],
      { type: 'square', gain: 0.07, filter: { type: 'lowpass', freq: 1800 } },
    );
    noise(c, { dur: 0.8, gain: 0.2, filter: { type: 'lowpass', freq: 300, to: 900 } });
  },
  feather: (c) => {
    noise(c, { dur: 0.45, gain: 0.3, filter: { type: 'bandpass', freq: 600, to: 3800, q: 1.2 } });
    tone(c, { type: 'sine', freq: 400, to: 1400, dur: 0.35, gain: 0.16 });
  },
  trick: (c) => {
    tone(c, { type: 'sine', freq: 900, to: 1700, dur: 0.12, gain: 0.12 });
    noise(c, { dur: 0.18, gain: 0.08, filter: { type: 'highpass', freq: 6000 } });
  },
  /** Character barks (stage: 0 hit, 1 boost, 2 finish, 3 overtake); pitch comes from the driver. */
  voice: (c, p) => {
    const g = 0.2;
    switch (p.stage ?? 0) {
      case 0: // "oof!"
        vowel(c, { dur: 0.22, gain: g, f0: 300, to: 200, from: [650, 1100], end: [380, 760] });
        break;
      case 1: // "wa-hoo!"
        vowel(c, { dur: 0.13, gain: g, f0: 260, to: 360, from: [380, 760], end: [720, 1150] });
        vowel(c, { at: 0.12, dur: 0.24, gain: g, f0: 390, to: 470, from: [520, 900], end: [340, 720] });
        break;
      case 2: // "yeah!"
        vowel(c, { dur: 0.4, gain: g, f0: 290, to: 420, from: [480, 1900], end: [760, 1250] });
        break;
      default: // "see ya!"
        vowel(c, { dur: 0.11, gain: g * 0.85, f0: 360, to: 380, from: [300, 2300], end: [320, 2200] });
        vowel(c, { at: 0.12, dur: 0.2, gain: g, f0: 410, to: 320, from: [330, 2100], end: [720, 1200] });
        break;
    }
  },

  // ---------------------------------------------------------------- race
  lap: (c) =>
    notes(
      c,
      [
        ['D6', 0, 0.15],
        ['A6', 0.1, 0.35],
      ],
      { type: 'sine', gain: 0.2 },
    ),
  crowdCheer: (c, p) => {
    const k = I(p, 1);
    for (const [f, g] of [
      [700, 0.25],
      [1300, 0.22],
      [2400, 0.12],
    ] as const)
      noise(c, { dur: 2.2, gain: g * k, attack: 0.35, release: 1.4, filter: { type: 'bandpass', freq: f, q: 0.7 } });
    for (let i = 0; i < 3; i++) tone(c, { type: 'sine', freq: 1900 + i * 250, to: 2600 + i * 200, at: 0.2 + i * 0.35, dur: 0.35, gain: 0.04 * k });
  },
} satisfies Record<string, Generator>;

export type SfxName = keyof typeof SFX;

/** Interface sounds go to the UI bus; everything else is in-world SFX. */
export function isUiSound(name: SfxName): boolean {
  return name.startsWith('ui') || name === 'rouletteTick' || name === 'itemReady';
}
