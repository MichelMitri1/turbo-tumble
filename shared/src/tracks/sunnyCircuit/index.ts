import type { TrackDefinition } from '../../types/track';
import { SUNNY_CIRCUIT_POINTS } from './layout';
import { addCourseJumps } from '../jumps';

const TREES = ['tree_oak', 'tree_default', 'tree_detailed', 'tree_fat', 'tree_tall'];
const PINES = ['tree_pineRoundA', 'tree_pineRoundC', 'tree_pineTallA_detailed', 'tree_cone'];
const BUSHES = ['plant_bushLarge', 'plant_bushDetailed', 'plant_bush'];
const ROCKS = ['rock_largeA', 'rock_largeB', 'rock_largeC', 'rock_largeD', 'rock_tallA', 'rock_tallB'];
const FLOWERS = ['flower_redA', 'flower_yellowA', 'flower_purpleA', 'grass_large'];

export const SUNNY_CIRCUIT: TrackDefinition = addCourseJumps({
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
  startDistance: 93,
  spawnGrid: { firstRowOffset: 7, rowSpacing: 7.5, columns: [-3.6, 3.6], stagger: 3.2 },
  checkpointCount: 16,
  terrain: {
    seed: 1337,
    size: 1450,
    resolution: 380,
    baseHeight: 0.5,
    noiseAmplitude: 5,
    noiseScale: 1 / 140,
    blendDistance: 34,
    hills: [
      { x: 60, z: 354, radius: 70, height: 22 }, // Tunnel hill
      { x: 157.5, z: 0, radius: 60, height: 13 }, // Windmill hill (infield)
      { x: -255, z: -60, radius: 110, height: 26 },
      { x: 180, z: -420, radius: 120, height: 30 },
      { x: 495, z: 330, radius: 120, height: 24 },
      { x: -300, z: 390, radius: 120, height: 20 },
    ],
    lakes: [{ x: 357, z: 12, radiusX: 93, radiusZ: 138, depth: 7 }],
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
      { type: 'grandstand', anchor: { distance: -9, side: 'left', wallOffset: 2.5, length: 92 }, params: { roof: true, tiers: 7 } },
      { type: 'grandstand', anchor: { distance: -3, side: 'right', wallOffset: 2.5, length: 44 }, params: { roof: false, tiers: 5 } },
      { type: 'pitRow', anchor: { distance: 72, side: 'right', wallOffset: 4, length: 46 } },
      { type: 'billboard', anchor: { distance: 180, side: 'left', wallOffset: 3 }, params: { brand: 0 } },
      { type: 'billboard', anchor: { distance: 393, side: 'left', wallOffset: 3 }, params: { brand: 1 } },
      { type: 'billboard', anchor: { distance: 540, side: 'right', wallOffset: 3 }, params: { brand: 2 } },
      { type: 'billboard', anchor: { distance: 840, side: 'left', wallOffset: 3 }, params: { brand: 3 } },
      { type: 'billboard', anchor: { distance: 960, side: 'right', wallOffset: 3 }, params: { brand: 0 } },
      { type: 'billboard', anchor: { distance: 1290, side: 'left', wallOffset: 3 }, params: { brand: 4 } },
      { type: 'billboard', anchor: { distance: 1440, side: 'right', wallOffset: 3 }, params: { brand: 2 } },
      { type: 'windmill', position: [156, 0, 3], yaw: 220, scale: 1 },
      { type: 'balloon', position: [90, 70, 60], params: { color: 0 } },
      { type: 'balloon', position: [-180, 85, 165], params: { color: 1 } },
      { type: 'balloon', position: [450, 95, -180], params: { color: 2 } },
      { type: 'mountains', params: { radius: 760, count: 34 } },
      { type: 'clouds' },
    ],
    props: [
      { model: 'lightPostLarge', distance: -60, side: 'left', wallOffset: 1, scale: 9, repeat: { every: 26, until: 60 } },
      { model: 'flagCheckers', distance: -12, side: 'right', wallOffset: 1, scale: 8, yaw: 90 },
      { model: 'flagCheckers', distance: 12, side: 'right', wallOffset: 1, scale: 8, yaw: 90 },
      { model: 'bannerTowerRed', distance: 225, side: 'right', wallOffset: 2, scale: 8, repeat: { every: 60, until: 495 } },
      { model: 'bannerTowerGreen', distance: 270, side: 'left', wallOffset: 2, scale: 8, repeat: { every: 60, until: 495 } },
      { model: 'bannerTowerRed', distance: 915, side: 'left', wallOffset: 2, scale: 8, repeat: { every: 45, until: 1110 } },
      { model: 'bannerTowerGreen', distance: 1350, side: 'left', wallOffset: 2, scale: 8, repeat: { every: 50, until: 1560 } },
      { model: 'tentLong', distance: 150, side: 'right', wallOffset: 6, scale: 7, yaw: 0 },
      { model: 'tent', distance: 127.5, side: 'left', wallOffset: 5, scale: 7, yaw: 0 },
      { model: 'tent', distance: 1500, side: 'right', wallOffset: 8, scale: 7, yaw: 20 },
      { model: 'radarEquipment', distance: 105, side: 'right', wallOffset: 6, scale: 6, yaw: 0 },
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
    { distance: 592.5, lateral: 0, length: 7, width: 5 },
    { distance: 1233, lateral: -2.5, length: 7, width: 5 },
    { distance: 1569, lateral: 3, length: 7, width: 5 },
  ],
  jumps: [],
  itemBoxes: [
    { distance: 225, lateral: 0, count: 5, spacing: 3.6 },
    { distance: 705, lateral: 0, count: 4, spacing: 3.4 },
    { distance: 1267.5, lateral: 0, count: 5, spacing: 3.6 },
  ],
  coins: [
    { distance: 322.5, lateral: 3.5, count: 6, spacing: 4 },
    { distance: 810, lateral: -3, count: 6, spacing: 4 },
    { distance: 1357.5, lateral: 4.5, count: 6, spacing: 4 },
    { distance: 1477.5, lateral: -4, count: 5, spacing: 4 },
  ],
  hazards: [
    { type: 'obstacle', distance: 352.5, lateral: -3.5, model: 'stump_round', radius: 1.8, obstacleHeight: 1.8 },
    { type: 'obstacle', distance: 450, lateral: 3.5, model: 'stump_round', radius: 1.8, obstacleHeight: 1.8 },
    { type: 'obstacle', distance: 915, lateral: -3, model: 'rock_largeA', radius: 2, obstacleHeight: 2.8 },
    { type: 'obstacle', distance: 1027.5, lateral: 3, model: 'rock_largeB', radius: 1.8, obstacleHeight: 2.6 },
    { type: 'obstacle', distance: 1447.5, lateral: 0, model: 'stump_round', radius: 2, obstacleHeight: 2 },
  ],
  shortcuts: [],
}, [0.22, 0.46, 0.82], 15);
