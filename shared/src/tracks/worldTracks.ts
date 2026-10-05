import type { TrackDefinition } from '../types/track';
import { defineTrack } from './factory';

const UP = Math.PI / 2; // phase that turns a k=0 harmonic into a constant height

/**
 * The world tour: generated layouts (see generator.ts) dressed in themes
 * (themes.ts). Tweak a harmonic to reshape a track; `tools/check-tracks.ts`
 * verifies corner radii and runs autopilot laps + a CPU race on each.
 */
export const WORLD_TRACKS: TrackDefinition[] = [
  defineTrack({
    id: 'palm-bay',
    name: 'Palm Bay',
    theme: 'tropical',
    seed: 201,
    layout: {
      radius: 175,
      stretch: [1.25, 0.85],
      harmonics: [
        [2, 0.12, 0.4],
        [3, 0.1, 1.7],
        [5, 0.045, 0.3],
      ],
      elevation: [
        [0, 3, UP],
        [2, 3, 0.5],
        [3, 1.5, 2],
      ],
    },
  }),
  defineTrack({
    id: 'harvest-lane',
    name: 'Harvest Lane',
    theme: 'farm',
    seed: 202,
    infieldLake: false,
    layout: {
      radius: 185,
      stretch: [1.1, 0.95],
      harmonics: [
        [3, 0.14, 0.2],
        [4, 0.05, 1.1],
      ],
      elevation: [
        [0, 3, UP],
        [1, 3, 0.3],
        [3, 2, 1],
      ],
      clockwise: true,
    },
  }),
  defineTrack({
    id: 'pinewood-pass',
    name: 'Pinewood Pass',
    theme: 'alpine',
    seed: 203,
    layout: {
      radius: 170,
      harmonics: [
        [2, 0.15, 1.2],
        [5, 0.06, 0.8],
        [7, 0.025, 2.1],
      ],
      elevation: [
        [0, 8, UP],
        [1, 6, 0],
        [2, 4, 1.5],
      ],
      segments: [{ from: 0.55, to: 0.63, kind: 'tunnel', halfWidth: 8.5 }],
    },
  }),
  defineTrack({
    id: 'dune-canyon',
    name: 'Dune Canyon',
    theme: 'desert',
    seed: 204,
    layout: {
      radius: 190,
      stretch: [1.3, 0.8],
      harmonics: [
        [3, 0.1, 0.6],
        [6, 0.05, 0.2],
        [2, 0.08, 2],
      ],
      elevation: [
        [0, 4, UP],
        [2, 5, 1],
        [5, 1.5, 0.4],
      ],
    },
  }),
  defineTrack({
    id: 'maple-glen',
    name: 'Maple Glen',
    theme: 'autumn',
    seed: 205,
    layout: {
      radius: 165,
      harmonics: [
        [4, 0.11, 0.9],
        [2, 0.1, 0.1],
        [7, 0.022, 1.3],
      ],
      elevation: [
        [0, 3, UP],
        [3, 3, 0.2],
      ],
      clockwise: true,
    },
  }),
  defineTrack({
    id: 'mushroom-hollow',
    name: 'Mushroom Hollow',
    theme: 'mushroom',
    seed: 206,
    layout: {
      radius: 160,
      harmonics: [
        [5, 0.085, 0.4],
        [3, 0.08, 2.2],
        [2, 0.06, 0.7],
      ],
      elevation: [
        [0, 5, UP],
        [2, 4, 0.9],
        [4, 1.5, 0.3],
      ],
      clockwise: true,
    },
  }),
  defineTrack({
    id: 'temple-ruins',
    name: 'Temple Ruins',
    theme: 'ruins',
    seed: 207,
    layout: {
      radius: 180,
      stretch: [0.9, 1.2],
      harmonics: [
        [3, 0.13, 1.9],
        [5, 0.055, 0.5],
      ],
      elevation: [
        [0, 6, UP],
        [1, 5, 1.2],
        [3, 2, 0.5],
      ],
      segments: [{ from: 0.3, to: 0.38, kind: 'bridge', halfWidth: 8.5 }],
    },
  }),
  defineTrack({
    id: 'frost-peak',
    name: 'Frost Peak',
    theme: 'snow',
    seed: 208,
    layout: {
      radius: 175,
      harmonics: [
        [2, 0.16, 0.4],
        [4, 0.07, 1.9],
        [6, 0.025, 0.2],
      ],
      elevation: [
        [0, 10, UP],
        [1, 8, 2.5],
        [2, 4, 0.2],
        [5, 1.2, 1],
      ],
      segments: [{ from: 0.7, to: 0.78, kind: 'tunnel', halfWidth: 8.5 }],
    },
  }),
  defineTrack({
    id: 'sunset-coast',
    name: 'Sunset Coast',
    theme: 'sunset',
    seed: 209,
    layout: {
      radius: 200,
      stretch: [1.35, 0.8],
      harmonics: [
        [2, 0.1, 0.9],
        [3, 0.12, 0.2],
        [8, 0.012, 1],
      ],
      elevation: [
        [0, 3, UP],
        [2, 3, 0.2],
      ],
      segments: [{ from: 0.45, to: 0.53, kind: 'bridge', halfWidth: 9 }],
    },
  }),
  defineTrack({
    id: 'neon-metro',
    name: 'Neon Metro',
    theme: 'city',
    seed: 210,
    layout: {
      radius: 170,
      harmonics: [
        [4, 0.15, 0.785],
        [8, 0.018, 0.4],
      ],
      elevation: [
        [0, 2, UP],
        [2, 3, 0.6],
      ],
      clockwise: true,
      segments: [{ from: 0.25, to: 0.32, kind: 'tunnel', halfWidth: 9 }],
    },
  }),
  defineTrack({
    id: 'volcano-run',
    name: 'Volcano Run',
    theme: 'volcano',
    seed: 211,
    layout: {
      radius: 185,
      harmonics: [
        [3, 0.12, 1.4],
        [5, 0.065, 0.1],
        [2, 0.06, 2.6],
      ],
      elevation: [
        [0, 8, UP],
        [1, 7, 0.4],
        [3, 3, 1.9],
      ],
      segments: [{ from: 0.4, to: 0.48, kind: 'bridge', halfWidth: 8.5 }],
    },
  }),
];
