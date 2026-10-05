import type { TrackDefinition } from '../../types/track';
import { SUNNY_CIRCUIT_POINTS } from './layout';

const TREES = ['tree_oak', 'tree_default', 'tree_detailed', 'tree_fat', 'tree_tall'];
const PINES = ['tree_pineRoundA', 'tree_pineRoundC', 'tree_pineTallA_detailed', 'tree_cone'];
const BUSHES = ['plant_bushLarge', 'plant_bushDetailed', 'plant_bush'];
const ROCKS = ['rock_largeA', 'rock_largeB', 'rock_largeC', 'rock_largeD', 'rock_tallA', 'rock_tallB'];
const FLOWERS = ['flower_redA', 'flower_yellowA', 'flower_purpleA', 'grass_large'];

export const SUNNY_CIRCUIT: TrackDefinition = {
  id: 'sunny-circuit',
  name: 'Sunny Circuit',
  theme: 'meadow',
  laps: 3,
  path: {
    points: SUNNY_CIRCUIT_POINTS,
    defaultHalfWidth: 9,
    defaultShoulder: 7,
    sampleSpacing: 2,
    autoBankDeg: 6,
    curbWidth: 1.4,
  },
  startDistance: 62,
  spawnGrid: { firstRowOffset: 7, rowSpacing: 7.5, columns: [-3.6, 3.6], stagger: 3.2 },
  checkpointCount: 16,
  terrain: {
    seed: 1337,
    size: 1000,
    resolution: 300,
    baseHeight: 0.5,
    noiseAmplitude: 5,
    noiseScale: 1 / 140,
    blendDistance: 34,
    hills: [
      { x: 40, z: 236, radius: 70, height: 22 }, // Tunnel hill
      { x: 105, z: 0, radius: 60, height: 13 }, // Windmill hill (infield)
      { x: -170, z: -40, radius: 110, height: 26 },
      { x: 120, z: -280, radius: 120, height: 30 },
      { x: 330, z: 220, radius: 120, height: 24 },
      { x: -200, z: 260, radius: 120, height: 20 },
    ],
    lakes: [{ x: 238, z: 8, radiusX: 62, radiusZ: 92, depth: 7 }],
    waterLevel: -0.6,
    palette: {
      grassA: '#5cbf3c',
      grassB: '#8fd14f',
      shoulder: '#4fae36',
      sand: '#e8d38f',
      rock: '#8d8478',
    },
  },
  lighting: {
    sunDirection: [-0.55, 0.78, -0.3],
    sunColor: '#fff3dc',
    sunIntensity: 2.6,
    skyColor: '#cfe9ff',
    groundColor: '#6a8f3a',
    hemiIntensity: 1.25,
    exposure: 1.05,
  },
  sky: {
    top: '#2f86e8',
    horizon: '#bfe6ff',
    bottom: '#e3f3ff',
    sunGlow: '#fff4cf',
    fogColor: '#cbe8fb',
    fogNear: 160,
    fogFar: 1150,
    clouds: 26,
  },
  decor: {
    landmarks: [
      { type: 'startGantry', anchor: { distance: 0 } },
      { type: 'grandstand', anchor: { distance: -6, side: 'left', wallOffset: 2.5, length: 92 }, params: { roof: true, tiers: 7 } },
      { type: 'grandstand', anchor: { distance: -2, side: 'right', wallOffset: 2.5, length: 44 }, params: { roof: false, tiers: 5 } },
      { type: 'pitRow', anchor: { distance: 48, side: 'right', wallOffset: 4, length: 46 } },
      { type: 'billboard', anchor: { distance: 120, side: 'left', wallOffset: 3 }, params: { brand: 0 } },
      { type: 'billboard', anchor: { distance: 262, side: 'left', wallOffset: 3 }, params: { brand: 1 } },
      { type: 'billboard', anchor: { distance: 360, side: 'right', wallOffset: 3 }, params: { brand: 2 } },
      { type: 'billboard', anchor: { distance: 560, side: 'left', wallOffset: 3 }, params: { brand: 3 } },
      { type: 'billboard', anchor: { distance: 640, side: 'right', wallOffset: 3 }, params: { brand: 0 } },
      { type: 'billboard', anchor: { distance: 860, side: 'left', wallOffset: 3 }, params: { brand: 4 } },
      { type: 'billboard', anchor: { distance: 960, side: 'right', wallOffset: 3 }, params: { brand: 2 } },
      { type: 'windmill', position: [104, 0, 2], yaw: 220, scale: 1 },
      { type: 'balloon', position: [60, 70, 40], params: { color: 0 } },
      { type: 'balloon', position: [-120, 85, 110], params: { color: 1 } },
      { type: 'balloon', position: [300, 95, -120], params: { color: 2 } },
      { type: 'mountains', params: { radius: 760, count: 34 } },
      { type: 'clouds' },
    ],
    props: [
      { model: 'lightPostLarge', distance: -40, side: 'left', wallOffset: 1, scale: 9, repeat: { every: 26, until: 40 } },
      { model: 'flagCheckers', distance: -8, side: 'right', wallOffset: 1, scale: 8, yaw: 90 },
      { model: 'flagCheckers', distance: 8, side: 'right', wallOffset: 1, scale: 8, yaw: 90 },
      { model: 'bannerTowerRed', distance: 150, side: 'right', wallOffset: 2, scale: 8, repeat: { every: 60, until: 330 } },
      { model: 'bannerTowerGreen', distance: 180, side: 'left', wallOffset: 2, scale: 8, repeat: { every: 60, until: 330 } },
      { model: 'bannerTowerRed', distance: 610, side: 'left', wallOffset: 2, scale: 8, repeat: { every: 45, until: 740 } },
      { model: 'bannerTowerGreen', distance: 900, side: 'left', wallOffset: 2, scale: 8, repeat: { every: 50, until: 1040 } },
      { model: 'tentLong', distance: 100, side: 'right', wallOffset: 6, scale: 7, yaw: 0 },
      { model: 'tent', distance: 85, side: 'left', wallOffset: 5, scale: 7, yaw: 0 },
      { model: 'tent', distance: 1000, side: 'right', wallOffset: 8, scale: 7, yaw: 20 },
      { model: 'radarEquipment', distance: 70, side: 'right', wallOffset: 6, scale: 6, yaw: 0 },
    ],
    scatter: [
      { models: TREES, count: 760, minWallDistance: 7, maxWallDistance: 260, scale: [5.5, 8.5], avoidWater: true, castShadow: true, seed: 11 },
      { models: PINES, count: 420, minWallDistance: 60, maxWallDistance: 420, scale: [7, 11], avoidWater: true, castShadow: true, seed: 12 },
      { models: BUSHES, count: 520, minWallDistance: 1.5, maxWallDistance: 40, scale: [3.5, 6], avoidWater: true, seed: 13 },
      { models: ROCKS, count: 170, minWallDistance: 4, maxWallDistance: 160, scale: [2.5, 6], seed: 14 },
      { models: FLOWERS, count: 1100, minWallDistance: 0.8, maxWallDistance: 50, scale: [3, 4.5], avoidWater: true, seed: 15 },
    ],
  },
  minimap: { rotation: 0 },
  music: 'music-sunny',
  boostPads: [
    { distance: 395, lateral: 0, length: 7, width: 5 },
    { distance: 822, lateral: -2.5, length: 7, width: 5 },
    { distance: 1046, lateral: 3, length: 7, width: 5 },
  ],
  itemBoxes: [
    { distance: 150, lateral: 0, count: 5, spacing: 3.6 },
    { distance: 470, lateral: 0, count: 4, spacing: 3.4 },
    { distance: 845, lateral: 0, count: 5, spacing: 3.6 },
  ],
  coins: [
    { distance: 215, lateral: 3.5, count: 6, spacing: 4 },
    { distance: 540, lateral: -3, count: 6, spacing: 4 },
    { distance: 905, lateral: 4.5, count: 6, spacing: 4 },
    { distance: 985, lateral: -4, count: 5, spacing: 4 },
  ],
  hazards: [],
  shortcuts: [],
};
