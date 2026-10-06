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
    // Coastal rollers, a narrow lagoon crossing and scattered beach rocks.
    obstacles: [
      { fraction: 0.2, lateral: -4, model: 'rock_largeA', radius: 1.7, obstacleHeight: 2.4 },
      { fraction: 0.27, lateral: 4, model: 'rock_largeA', radius: 1.8, obstacleHeight: 2.5 },
      { fraction: 0.56, lateral: -3.8, model: 'rock_largeA', radius: 2, obstacleHeight: 2.8 },
      { fraction: 0.66, lateral: 3.5, model: 'rock_largeA', radius: 1.8, obstacleHeight: 2.5 },
      { fraction: 0.84, lateral: 0, model: 'rock_largeA', radius: 2, obstacleHeight: 2.7 },
    ],
    jumps: [0.2, 0.49, 0.77],
    launchSpeed: 15,
    layout: {
      radius: 250,
      stretch: [1.3, 0.8],
      harmonics: [
        [2, 0.19, 0.4],
        [3, 0.12, 1.7],
        [5, 0.04, 0.3],
      ],
      elevation: [
        [0, 12, UP],
        [2, 9, 0.5],
        [3, 3, 2],
      ],
      segments: [
        { from: 0.38, to: 0.48, kind: 'bridge', halfWidth: 6.8 },
      ],
    },
  }),
  defineTrack({
    id: 'harvest-lane',
    name: 'Harvest Lane',
    theme: 'farm',
    seed: 202,
    infieldLake: false,
    // Rolling farmland with a left-right slalom between tree stumps.
    obstacles: [
      { fraction: 0.18, lateral: -3, model: 'stump_round', radius: 1.8, obstacleHeight: 1.8 },
      { fraction: 0.23, lateral: 3, model: 'stump_round', radius: 1.8, obstacleHeight: 1.8 },
      { fraction: 0.28, lateral: -3, model: 'stump_round', radius: 1.8, obstacleHeight: 1.8 },
      { fraction: 0.54, lateral: 4, model: 'stump_round', radius: 2, obstacleHeight: 1.8 },
      { fraction: 0.6, lateral: -4, model: 'stump_round', radius: 2, obstacleHeight: 1.8 },
      { fraction: 0.81, lateral: 0, model: 'stump_round', radius: 2, obstacleHeight: 1.8 },
    ],
    jumps: [0.18, 0.46, 0.79],
    launchSpeed: 16,
    layout: {
      radius: 270,
      stretch: [1.15, 0.85],
      harmonics: [
        [3, 0.22, 0.2],
        [4, 0.08, 1.1],
      ],
      elevation: [
        [0, 15, UP],
        [3, 10, 0.3],
        [5, 3, 1],
      ],
      clockwise: true,
      segments: [
        { from: 0.32, to: 0.43, kind: 'ground', halfWidth: 6.5 },
      ],
    },
  }),
  defineTrack({
    id: 'pinewood-pass',
    name: 'Pinewood Pass',
    theme: 'alpine',
    seed: 203,
    // A long mountain climb, tight switchbacks and a rock-lined tunnel.
    obstacles: [
      { fraction: 0.19, lateral: 4, model: 'rock_tallA', radius: 2, obstacleHeight: 3.8 },
      { fraction: 0.35, lateral: -3.5, model: 'rock_tallA', radius: 2, obstacleHeight: 3.5 },
      { fraction: 0.46, lateral: 3.5, model: 'rock_tallA', radius: 1.8, obstacleHeight: 3.2 },
      { fraction: 0.69, lateral: -4, model: 'rock_tallA', radius: 2.2, obstacleHeight: 3.6 },
      { fraction: 0.86, lateral: 3, model: 'rock_tallA', radius: 1.8, obstacleHeight: 3.2 },
    ],
    jumps: [0.22, 0.46, 0.82],
    launchSpeed: 17,
    layout: {
      radius: 275,
      stretch: [0.85, 1.2],
      harmonics: [
        [2, 0.23, 1.2],
        [5, 0.085, 0.8],
        [7, 0.025, 2.1],
      ],
      elevation: [
        [0, 30, UP],
        [1, 24, 0],
        [2, 8, 1.5],
      ],
      segments: [
        { from: 0.52, to: 0.65, kind: 'tunnel', halfWidth: 6.5 },
        { from: 0.76, to: 0.84, kind: 'bridge', halfWidth: 6.8 },
      ],
    },
  }),
  defineTrack({
    id: 'dune-canyon',
    name: 'Dune Canyon',
    theme: 'desert',
    seed: 204,
    // Dune crests and a pinched canyon with alternating sandstone boulders.
    obstacles: [
      { fraction: 0.17, lateral: -4, model: 'rock_largeC', radius: 2.2, obstacleHeight: 3 },
      { fraction: 0.25, lateral: 3, model: 'rock_largeC', radius: 2, obstacleHeight: 3 },
      { fraction: 0.5, lateral: -3, model: 'rock_largeC', radius: 2.3, obstacleHeight: 3 },
      { fraction: 0.57, lateral: 3.5, model: 'rock_largeC', radius: 2, obstacleHeight: 3 },
      { fraction: 0.72, lateral: 0, model: 'rock_largeC', radius: 2.4, obstacleHeight: 3.4 },
      { fraction: 0.85, lateral: -4, model: 'rock_largeC', radius: 2, obstacleHeight: 2.8 },
    ],
    jumps: [0.2, 0.53, 0.8],
    launchSpeed: 17,
    layout: {
      radius: 295,
      stretch: [1.35, 0.75],
      harmonics: [
        [3, 0.18, 0.6],
        [6, 0.065, 0.2],
        [2, 0.1, 2],
      ],
      elevation: [
        [0, 20, UP],
        [2, 12, 1],
        [5, 6, 0.4],
      ],
      segments: [
        { from: 0.35, to: 0.46, kind: 'tunnel', halfWidth: 6.5 },
      ],
    },
  }),
  defineTrack({
    id: 'maple-glen',
    name: 'Maple Glen',
    theme: 'autumn',
    seed: 205,
    // Four rolling bends with wooded chicanes and a narrow ridge.
    obstacles: [
      { fraction: 0.19, lateral: 3.5, model: 'stump_round', radius: 1.8, obstacleHeight: 1.8 },
      { fraction: 0.25, lateral: -3.5, model: 'stump_round', radius: 1.8, obstacleHeight: 1.8 },
      { fraction: 0.41, lateral: 0, model: 'stump_round', radius: 2, obstacleHeight: 2 },
      { fraction: 0.54, lateral: 4, model: 'stump_round', radius: 2, obstacleHeight: 1.8 },
      { fraction: 0.78, lateral: -3, model: 'stump_round', radius: 2, obstacleHeight: 1.8 },
      { fraction: 0.85, lateral: 3, model: 'stump_round', radius: 1.8, obstacleHeight: 1.8 },
    ],
    jumps: [0.23, 0.5, 0.82],
    launchSpeed: 16,
    layout: {
      radius: 260,
      stretch: [1, 1],
      harmonics: [
        [4, 0.18, 0.9],
        [2, 0.12, 0.1],
        [7, 0.025, 1.3],
      ],
      elevation: [
        [0, 18, UP],
        [3, 12, 0.2],
        [1, 4, 1.8],
      ],
      clockwise: true,
      segments: [
        { from: 0.6, to: 0.73, kind: 'ground', halfWidth: 6.3 },
      ],
    },
  }),
  defineTrack({
    id: 'mushroom-hollow',
    name: 'Mushroom Hollow',
    theme: 'mushroom',
    seed: 206,
    // Short, rippling hills with giant mushrooms splitting the racing line.
    obstacles: [
      { fraction: 0.17, lateral: 0, model: 'mushroom_red', radius: 2.3, obstacleHeight: 3.8 },
      { fraction: 0.29, lateral: -3.5, model: 'mushroom_red', radius: 2.2, obstacleHeight: 3.6 },
      { fraction: 0.37, lateral: 3.5, model: 'mushroom_red', radius: 2.2, obstacleHeight: 3.6 },
      { fraction: 0.59, lateral: 0, model: 'mushroom_red', radius: 2.5, obstacleHeight: 4 },
      { fraction: 0.73, lateral: -3.5, model: 'mushroom_red', radius: 2.1, obstacleHeight: 3.6 },
      { fraction: 0.83, lateral: 3.5, model: 'mushroom_red', radius: 2.1, obstacleHeight: 3.6 },
    ],
    jumps: [0.2, 0.49, 0.77],
    launchSpeed: 18,
    layout: {
      radius: 250,
      stretch: [1.05, 0.95],
      harmonics: [
        [5, 0.12, 0.4],
        [3, 0.12, 2.2],
        [2, 0.08, 0.7],
      ],
      elevation: [
        [0, 19, UP],
        [2, 10, 0.9],
        [4, 7, 0.3],
      ],
      clockwise: true,
      segments: [
        { from: 0.42, to: 0.52, kind: 'ground', halfWidth: 6.5 },
      ],
    },
  }),
  defineTrack({
    id: 'temple-ruins',
    name: 'Temple Ruins',
    theme: 'ruins',
    seed: 207,
    // A stepped ascent, narrow ancient causeway and fallen stone columns.
    obstacles: [
      { fraction: 0.16, lateral: -3, model: 'statue_columnDamaged', radius: 1.8, obstacleHeight: 3 },
      { fraction: 0.23, lateral: 3, model: 'statue_columnDamaged', radius: 1.8, obstacleHeight: 3.4 },
      { fraction: 0.48, lateral: 0, model: 'statue_columnDamaged', radius: 2, obstacleHeight: 3.4 },
      { fraction: 0.58, lateral: 3.5, model: 'statue_columnDamaged', radius: 1.8, obstacleHeight: 3 },
      { fraction: 0.8, lateral: -3.5, model: 'statue_columnDamaged', radius: 2, obstacleHeight: 3.4 },
      { fraction: 0.88, lateral: 3, model: 'statue_columnDamaged', radius: 1.8, obstacleHeight: 3 },
    ],
    jumps: [0.18, 0.46, 0.81],
    launchSpeed: 17,
    layout: {
      radius: 290,
      stretch: [0.8, 1.3],
      harmonics: [
        [3, 0.21, 1.9],
        [5, 0.08, 0.5],
      ],
      elevation: [
        [0, 25, UP],
        [1, 17, 1.2],
        [3, 7, 0.5],
      ],
      segments: [
        { from: 0.28, to: 0.42, kind: 'bridge', halfWidth: 6 },
        { from: 0.65, to: 0.74, kind: 'tunnel', halfWidth: 6.5 },
      ],
    },
  }),
  defineTrack({
    id: 'frost-peak',
    name: 'Frost Peak',
    theme: 'snow',
    seed: 208,
    // The tallest summit, a descending tunnel and narrow exposed ridge.
    obstacles: [
      { fraction: 0.17, lateral: -3.8, model: 'rock_largeD', radius: 2.1, obstacleHeight: 3 },
      { fraction: 0.27, lateral: 3.5, model: 'rock_largeD', radius: 2.1, obstacleHeight: 3 },
      { fraction: 0.49, lateral: -3, model: 'rock_largeD', radius: 2.3, obstacleHeight: 3.2 },
      { fraction: 0.58, lateral: 3, model: 'rock_largeD', radius: 2, obstacleHeight: 3 },
      { fraction: 0.84, lateral: 0, model: 'rock_largeD', radius: 2.1, obstacleHeight: 3.2 },
    ],
    jumps: [0.21, 0.51, 0.84],
    launchSpeed: 18,
    layout: {
      radius: 300,
      stretch: [1, 1.1],
      harmonics: [
        [2, 0.24, 0.4],
        [4, 0.1, 1.9],
        [6, 0.035, 0.2],
      ],
      elevation: [
        [0, 38, UP],
        [1, 30, 2.5],
        [2, 10, 0.2],
        [5, 3, 1],
      ],
      segments: [
        { from: 0.34, to: 0.44, kind: 'bridge', halfWidth: 6.2 },
        { from: 0.66, to: 0.8, kind: 'tunnel', halfWidth: 6.2 },
      ],
    },
  }),
  defineTrack({
    id: 'sunset-coast',
    name: 'Sunset Coast',
    theme: 'sunset',
    seed: 209,
    // Fast cliffside climbs separated by two narrow sea bridges.
    obstacles: [
      { fraction: 0.17, lateral: 3.5, model: 'rock_largeB', radius: 2, obstacleHeight: 2.8 },
      { fraction: 0.42, lateral: -3.5, model: 'rock_largeB', radius: 2, obstacleHeight: 2.8 },
      { fraction: 0.51, lateral: 3.5, model: 'rock_largeB', radius: 2, obstacleHeight: 2.8 },
      { fraction: 0.77, lateral: -3, model: 'rock_largeB', radius: 2.2, obstacleHeight: 3 },
      { fraction: 0.86, lateral: 3, model: 'rock_largeB', radius: 1.8, obstacleHeight: 2.6 },
    ],
    jumps: [0.2, 0.49, 0.79],
    launchSpeed: 17,
    layout: {
      radius: 310,
      stretch: [1.4, 0.75],
      harmonics: [
        [2, 0.17, 0.9],
        [3, 0.17, 0.2],
        [8, 0.02, 1],
      ],
      elevation: [
        [0, 23, UP],
        [2, 17, 0.2],
        [3, 4, 1.4],
      ],
      segments: [
        { from: 0.27, to: 0.36, kind: 'bridge', halfWidth: 6.5 },
        { from: 0.6, to: 0.71, kind: 'bridge', halfWidth: 6.5 },
      ],
    },
  }),
  defineTrack({
    id: 'neon-metro',
    name: 'Neon Metro',
    theme: 'city',
    seed: 210,
    // A compact street circuit with an underpass, flyover and cone slaloms.
    obstacles: [
      { fraction: 0.15, lateral: -3, model: 'pylon', radius: 1.5, obstacleHeight: 2.5 },
      { fraction: 0.2, lateral: 3, model: 'pylon', radius: 1.5, obstacleHeight: 2.5 },
      { fraction: 0.4, lateral: 3, model: 'pylon', radius: 1.6, obstacleHeight: 2.5 },
      { fraction: 0.46, lateral: -3, model: 'pylon', radius: 1.6, obstacleHeight: 2.5 },
      { fraction: 0.76, lateral: 3, model: 'pylon', radius: 1.6, obstacleHeight: 2.5 },
      { fraction: 0.82, lateral: -3, model: 'pylon', radius: 1.6, obstacleHeight: 2.5 },
      { fraction: 0.88, lateral: 3, model: 'pylon', radius: 1.6, obstacleHeight: 2.5 },
    ],
    jumps: [0.17, 0.47, 0.79],
    launchSpeed: 15,
    layout: {
      radius: 265,
      stretch: [1.1, 0.85],
      harmonics: [
        [4, 0.21, 0.785],
        [8, 0.025, 0.4],
      ],
      elevation: [
        [0, 16, UP],
        [2, 11, 0.6],
        [4, 4, 1.8],
      ],
      clockwise: true,
      segments: [
        { from: 0.22, to: 0.34, kind: 'tunnel', halfWidth: 6.5 },
        { from: 0.58, to: 0.7, kind: 'bridge', halfWidth: 6.2 },
      ],
    },
  }),
  defineTrack({
    id: 'volcano-run',
    name: 'Volcano Run',
    theme: 'volcano',
    seed: 211,
    // Steep crater climbs, lava causeways and a dense volcanic rock gauntlet.
    obstacles: [
      { fraction: 0.15, lateral: -3, model: 'rock_tallC', radius: 2.2, obstacleHeight: 3.5 },
      { fraction: 0.22, lateral: 3, model: 'rock_tallC', radius: 2, obstacleHeight: 3.2 },
      { fraction: 0.29, lateral: -3, model: 'rock_tallC', radius: 2, obstacleHeight: 3.2 },
      { fraction: 0.54, lateral: 3, model: 'rock_tallC', radius: 2.2, obstacleHeight: 3.6 },
      { fraction: 0.61, lateral: -3, model: 'rock_tallC', radius: 2.2, obstacleHeight: 3.5 },
      { fraction: 0.83, lateral: 0, model: 'rock_tallC', radius: 2.4, obstacleHeight: 3.6 },
      { fraction: 0.9, lateral: 3.5, model: 'rock_tallC', radius: 1.8, obstacleHeight: 3 },
    ],
    jumps: [0.2, 0.53, 0.82],
    launchSpeed: 19,
    layout: {
      radius: 300,
      stretch: [1.1, 0.95],
      harmonics: [
        [3, 0.2, 1.4],
        [5, 0.09, 0.1],
        [2, 0.08, 2.6],
      ],
      elevation: [
        [0, 34, UP],
        [1, 23, 0.4],
        [3, 10, 1.9],
      ],
      segments: [
        { from: 0.35, to: 0.49, kind: 'bridge', halfWidth: 6 },
        { from: 0.69, to: 0.78, kind: 'bridge', halfWidth: 6.3 },
      ],
    },
  }),
];
