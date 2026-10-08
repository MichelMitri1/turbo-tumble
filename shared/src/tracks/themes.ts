import type { LandmarkPlacement, LightingDefinition, PropPlacement, ScatterRule, SkyDefinition, TerrainDefinition } from '../types/track';

/** Everything that makes a track look like a place: terrain colours, sky, light, scenery. */
export interface Theme {
  id: string;
  palette: TerrainDefinition['palette'];
  noiseAmplitude: number;
  /** Lakes allowed (infield lagoon, pools under bridges). */
  lakes: boolean;
  liquid?: TerrainDefinition['liquid'];
  lighting: LightingDefinition;
  sky: SkyDefinition;
  /** Mountain ring colours (low → peak) or none. */
  mountains: { low: string; mid: string; peak: string; snow?: boolean } | null;
  music: string;
  halfWidth: number;
  scatter: (seed: number) => ScatterRule[];
  /** Theme set pieces beyond the shared start area / billboards. */
  landmarks?: (lapLength: number) => LandmarkPlacement[];
  props?: (lapLength: number) => PropPlacement[];
  /** No grandstands / balloons (e.g. night city has its own skyline). */
  noCrowd?: boolean;
  /** Asset-manifest models for static road obstacles (cycled); default pylons. */
  hazards?: string[];
}

const rule = (models: string[], count: number, min: number, max: number, scale: [number, number], seed: number, extra: Partial<ScatterRule> = {}): ScatterRule => ({
  models,
  count,
  minWallDistance: min,
  maxWallDistance: max,
  scale,
  seed,
  avoidWater: true,
  ...extra,
});

const DAY_LIGHT: LightingDefinition = {
  sunDirection: [-0.55, 0.78, -0.3],
  sunColor: '#fff3dc',
  sunIntensity: 2.6,
  skyColor: '#cfe9ff',
  groundColor: '#6a8f3a',
  hemiIntensity: 1.25,
  exposure: 1.05,
};

const DAY_SKY: SkyDefinition = {
  top: '#2f86e8',
  horizon: '#bfe6ff',
  bottom: '#e3f3ff',
  sunGlow: '#fff4cf',
  fogColor: '#cbe8fb',
  fogNear: 160,
  fogFar: 1150,
  clouds: 26,
};

const TREES = ['tree_oak', 'tree_default', 'tree_detailed', 'tree_fat', 'tree_tall'];
const PINES = ['tree_pineRoundA', 'tree_pineRoundC', 'tree_pineTallA_detailed', 'tree_cone', 'tree_pineDefaultA', 'tree_pineDefaultB', 'tree_pineTallB_detailed', 'tree_pineTallC_detailed', 'tree_pineTallD_detailed'];
const PALMS = ['tree_palm', 'tree_palmBend', 'tree_palmDetailedShort', 'tree_palmDetailedTall', 'tree_palmShort', 'tree_palmTall'];
const FALL = ['tree_default_fall', 'tree_oak_fall', 'tree_fat_fall', 'tree_tall_fall', 'tree_detailed_fall', 'tree_cone_fall', 'tree_plateau_fall', 'tree_simple_fall'];
const DARK = ['tree_default_dark', 'tree_oak_dark', 'tree_tall_dark', 'tree_plateau_dark', 'tree_cone_dark'];
const ROCKS = ['rock_largeA', 'rock_largeB', 'rock_largeC', 'rock_largeD', 'rock_largeE', 'rock_largeF'];
const TALL_ROCKS = ['rock_tallA', 'rock_tallB', 'rock_tallC', 'rock_tallD', 'rock_tallE', 'rock_tallF', 'rock_tallG', 'rock_tallH'];
const RUINS = ['statue_column', 'statue_columnDamaged', 'statue_obelisk', 'statue_head', 'statue_block', 'statue_ring'];
const BUSHES = ['plant_bushLarge', 'plant_bushDetailed', 'plant_bush'];
const FLOWERS = ['flower_redA', 'flower_yellowA', 'flower_purpleA', 'grass_large'];

export const THEMES: Record<string, Theme> = {
  meadow: {
    id: 'meadow',
    hazards: ['pylon'],
    palette: { grassA: '#5cbf3c', grassB: '#8fd14f', shoulder: '#4fae36', sand: '#e8d38f', rock: '#8d8478' },
    noiseAmplitude: 5,
    lakes: true,
    lighting: DAY_LIGHT,
    sky: DAY_SKY,
    mountains: { low: '#5aa44a', mid: '#8e8fa6', peak: '#f4f7ff', snow: true },
    music: 'music-sunny',
    halfWidth: 9,
    scatter: (s) => [
      rule(TREES, 700, 7, 260, [5.5, 8.5], s + 1, { castShadow: true }),
      rule(PINES, 380, 60, 420, [7, 11], s + 2, { castShadow: true }),
      rule(BUSHES, 480, 1.5, 40, [3.5, 6], s + 3),
      rule(ROCKS, 160, 4, 160, [2.5, 6], s + 4, { avoidWater: false }),
      rule(FLOWERS, 1000, 0.8, 50, [3, 4.5], s + 5),
    ],
    landmarks: () => [{ type: 'balloon', position: [60, 80, 40], params: { color: 0 } }, { type: 'balloon', position: [-140, 95, 110], params: { color: 2 } }],
  },

  tropical: {
    id: 'tropical',
    hazards: ['rock_largeE', 'rock_largeF'],
    palette: { grassA: '#74c94a', grassB: '#a6dc62', shoulder: '#ead79a', sand: '#f4e3a8', rock: '#a69c8c' },
    noiseAmplitude: 4,
    lakes: true,
    liquid: { color: '#25c7d4' },
    lighting: { ...DAY_LIGHT, sunIntensity: 2.8, skyColor: '#d4f6ff', groundColor: '#8ab05a', exposure: 1.08 },
    sky: { ...DAY_SKY, top: '#1b8fe6', horizon: '#c6f2ff', fogColor: '#cdf2ff', clouds: 18 },
    mountains: { low: '#4fa24a', mid: '#6f9a5a', peak: '#9bb59a' },
    music: 'music-sunny',
    halfWidth: 9,
    scatter: (s) => [
      rule(PALMS, 620, 4, 260, [6, 10], s + 1, { castShadow: true }),
      rule(['plant_bushLargeTriangle', 'plant_flatTall', 'plant_bushLarge'], 520, 1.5, 50, [3.5, 6], s + 2),
      rule(['rock_largeE', 'rock_largeF', 'rock_largeA'], 120, 4, 150, [2.5, 6], s + 3, { avoidWater: false }),
      rule(['flower_yellowB', 'flower_redB', 'grass_large'], 900, 0.8, 50, [3, 4.5], s + 4),
    ],
    landmarks: () => [{ type: 'balloon', position: [-90, 85, 60], params: { color: 1 } }],
  },

  sunset: {
    id: 'sunset',
    hazards: ['pylon'],
    palette: { grassA: '#6bb64a', grassB: '#9cc85e', shoulder: '#e3c98f', sand: '#efd7a0', rock: '#9a8a7c' },
    noiseAmplitude: 5,
    lakes: true,
    liquid: { color: '#2f7fb8' },
    lighting: { sunDirection: [0.85, 0.32, 0.2], sunColor: '#ffb27a', sunIntensity: 2.4, skyColor: '#ffc59a', groundColor: '#7a6a4a', hemiIntensity: 1.05, exposure: 1.05 },
    sky: { top: '#3b4296', horizon: '#ff9f62', bottom: '#ffd2a8', sunGlow: '#ffb070', fogColor: '#f3b48c', fogNear: 160, fogFar: 1100, clouds: 22 },
    mountains: { low: '#5a6a5a', mid: '#7a6a8a', peak: '#c79a9a' },
    music: 'music-sunny',
    halfWidth: 9.5,
    scatter: (s) => [
      rule(PALMS, 520, 4, 260, [6, 10.5], s + 1, { castShadow: true }),
      rule(['plant_bushLargeTriangle', 'plant_bushLarge'], 380, 1.5, 50, [3.5, 6], s + 2),
      rule(ROCKS, 140, 4, 180, [2.5, 6], s + 3, { avoidWater: false }),
      rule(['flower_yellowB', 'flower_redB', 'grass_large'], 700, 0.8, 50, [3, 4.5], s + 4),
    ],
  },

  farm: {
    id: 'farm',
    hazards: ['crop_pumpkin'],
    palette: { grassA: '#94c84a', grassB: '#c9d65c', shoulder: '#b49c5a', sand: '#dac47c', rock: '#9a8e7a' },
    noiseAmplitude: 4,
    lakes: true,
    lighting: { ...DAY_LIGHT, sunDirection: [-0.7, 0.55, -0.4], sunColor: '#ffe1b0', sunIntensity: 2.5, groundColor: '#8a8a3a' },
    sky: { ...DAY_SKY, horizon: '#ffe9c4', sunGlow: '#ffe0a0', fogColor: '#f1e6cf', clouds: 30 },
    mountains: { low: '#7aa84a', mid: '#9a9a7a', peak: '#d0d0c0' },
    music: 'music-menu',
    halfWidth: 9,
    scatter: (s) => [
      rule(['crops_cornStageD', 'crops_wheatStageB'], 900, 6, 120, [4, 6], s + 1),
      rule(['crop_pumpkin', 'crop_melon'], 260, 2, 60, [3, 5], s + 2),
      rule(['tree_blocks', 'tree_default', 'tree_oak', 'tree_fat'], 360, 12, 300, [5.5, 8.5], s + 3, { castShadow: true }),
      rule(['log_stack', 'log_stackLarge', 'fence_planks', 'stump_round'], 120, 3, 80, [3, 5], s + 4),
      rule(FLOWERS, 600, 0.8, 50, [3, 4.5], s + 5),
    ],
    landmarks: () => [
      { type: 'windmill', position: [0, 0, 0], yaw: 200, scale: 1.1 },
      { type: 'balloon', position: [120, 90, -80], params: { color: 0 } },
      { type: 'balloon', position: [-160, 80, 140], params: { color: 1 } },
    ],
  },

  alpine: {
    id: 'alpine',
    hazards: ['log_stack'],
    palette: { grassA: '#3f9a45', grassB: '#62b357', shoulder: '#4a8d3e', sand: '#cfc59a', rock: '#8c8c94' },
    noiseAmplitude: 7,
    lakes: true,
    liquid: { color: '#2a8fb0' },
    lighting: { ...DAY_LIGHT, sunColor: '#f4f6ff', sunIntensity: 2.4, skyColor: '#d6ecff', groundColor: '#4a7a3a' },
    sky: { ...DAY_SKY, top: '#2a78d8', horizon: '#d0ecff', fogColor: '#d4ebfb', fogNear: 140, clouds: 30 },
    mountains: { low: '#3f7a45', mid: '#7f8494', peak: '#ffffff', snow: true },
    music: 'music-sunny',
    halfWidth: 8.5,
    scatter: (s) => [
      rule(PINES, 1100, 6, 380, [6.5, 11], s + 1, { castShadow: true }),
      rule(['tree_pineGroundA', 'tree_pineSmallA'], 500, 2, 60, [3.5, 6], s + 2),
      rule(TALL_ROCKS, 140, 6, 200, [3, 7], s + 3, { avoidWater: false }),
      rule(['grass_large', 'flower_purpleA'], 500, 0.8, 40, [3, 4.5], s + 4),
    ],
  },

  desert: {
    id: 'desert',
    hazards: ['cactus_tall', 'cactus_short'],
    palette: { grassA: '#e2c07c', grassB: '#d6aa68', shoulder: '#c99a5b', sand: '#f0d9a0', rock: '#b5734a' },
    noiseAmplitude: 6,
    lakes: false,
    lighting: { ...DAY_LIGHT, sunDirection: [-0.4, 0.85, -0.2], sunColor: '#fff0cc', sunIntensity: 3, skyColor: '#ffe9c4', groundColor: '#b88a5a', exposure: 1.02 },
    sky: { ...DAY_SKY, top: '#3c95e0', horizon: '#ffe2b0', bottom: '#fff0d8', fogColor: '#f6dcb4', fogNear: 180, fogFar: 1200, clouds: 6 },
    mountains: { low: '#c9905a', mid: '#b56a3e', peak: '#e0a070' },
    music: 'music-dunes',
    halfWidth: 9.5,
    scatter: (s) => [
      rule(['cactus_tall', 'cactus_short'], 520, 3, 220, [4, 7], s + 1, { castShadow: true }),
      rule(TALL_ROCKS, 260, 8, 260, [5, 12], s + 2, { castShadow: true, tint: '#c9784a', tintAmount: 0.45 }),
      rule(TALL_ROCKS, 70, 120, 420, [22, 42], s + 3, { tint: '#b86a40', tintAmount: 0.55 }),
      rule(['stump_old', 'stump_oldTall', 'rock_largeE'], 160, 2, 120, [2.5, 5], s + 4, { tint: '#c9a07a', tintAmount: 0.3 }),
    ],
  },

  autumn: {
    id: 'autumn',
    hazards: ['crop_pumpkin', 'stump_round'],
    palette: { grassA: '#9cae45', grassB: '#c8a44a', shoulder: '#8d8a3c', sand: '#d9b77a', rock: '#8c7d6c' },
    noiseAmplitude: 6,
    lakes: true,
    liquid: { color: '#3d8fa8' },
    lighting: { ...DAY_LIGHT, sunDirection: [-0.6, 0.6, -0.5], sunColor: '#ffd8a8', sunIntensity: 2.4, skyColor: '#ffe6c8', groundColor: '#8a6a3a' },
    sky: { ...DAY_SKY, top: '#4a86d0', horizon: '#ffdcb0', sunGlow: '#ffcf90', fogColor: '#f0d8bc', clouds: 28 },
    mountains: { low: '#a8743a', mid: '#8a7a6a', peak: '#d8c8b8' },
    music: 'music-menu',
    halfWidth: 9,
    scatter: (s) => [
      rule(FALL, 900, 6, 300, [5.5, 9], s + 1, { castShadow: true }),
      rule(['crop_pumpkin', 'mushroom_tan', 'mushroom_tanGroup', 'mushroom_red'], 300, 1.5, 60, [3, 5], s + 2),
      rule(['log_stack', 'stump_round', 'log_large', 'stump_oldTall'], 160, 3, 100, [3, 5], s + 3),
      rule(BUSHES, 300, 1.5, 40, [3.5, 6], s + 4, { tint: '#d08a3a', tintAmount: 0.4 }),
    ],
  },

  mushroom: {
    id: 'mushroom',
    hazards: ['mushroom_redTall', 'mushroom_tanTall'],
    palette: { grassA: '#4f8a5a', grassB: '#6aa067', shoulder: '#3e6f4a', sand: '#b9a8c8', rock: '#6f6a80' },
    noiseAmplitude: 6,
    lakes: true,
    liquid: { color: '#6a5fe0', emissive: '#3a2a90', emissiveIntensity: 0.6 },
    lighting: { sunDirection: [-0.5, 0.55, 0.4], sunColor: '#ffb8e8', sunIntensity: 1.7, skyColor: '#b49aff', groundColor: '#3a4a5a', hemiIntensity: 1.2, exposure: 1.1 },
    sky: { top: '#2c1f63', horizon: '#e79bd2', bottom: '#f3c8e6', sunGlow: '#ffb0dc', fogColor: '#b48ac8', fogNear: 120, fogFar: 950, clouds: 12, stars: 0.5 },
    mountains: { low: '#3a5a5a', mid: '#5a4a7a', peak: '#a08ac8' },
    music: 'music-neon',
    halfWidth: 9,
    scatter: (s) => [
      rule(['mushroom_redTall', 'mushroom_tanTall', 'mushroom_redGroup', 'mushroom_tanGroup'], 380, 4, 220, [8, 16], s + 1, { castShadow: true }),
      rule(DARK, 600, 10, 340, [6, 9.5], s + 2, { castShadow: true }),
      rule(['mushroom_red', 'mushroom_tan', 'stump_round', 'stump_old'], 500, 1.2, 60, [3, 5], s + 3),
      rule(['grass_large', 'flower_purpleA'], 600, 0.8, 40, [3, 4.5], s + 4),
    ],
  },

  ruins: {
    id: 'ruins',
    hazards: ['statue_column', 'statue_columnDamaged'],
    palette: { grassA: '#6aae45', grassB: '#93c05a', shoulder: '#c2b48a', sand: '#d8c99a', rock: '#a89c84' },
    noiseAmplitude: 6,
    lakes: true,
    liquid: { color: '#3aa69e' },
    lighting: { ...DAY_LIGHT, sunDirection: [-0.45, 0.8, 0.3], sunColor: '#fff0d0' },
    sky: { ...DAY_SKY, horizon: '#d8f0e0', fogColor: '#d6ecd8', clouds: 22 },
    mountains: { low: '#4a8a4a', mid: '#7a8a6a', peak: '#b0b8a0' },
    music: 'music-dunes',
    halfWidth: 9,
    scatter: (s) => [
      rule(RUINS, 260, 3, 140, [5, 9], s + 1, { castShadow: true, avoidWater: false }),
      rule([...PALMS.slice(0, 3), ...DARK.slice(0, 3)], 640, 8, 320, [6, 10], s + 2, { castShadow: true }),
      rule(['plant_bushLargeTriangle', 'plant_flatTall', 'plant_bushDetailed'], 500, 1.5, 50, [3.5, 6], s + 3),
      rule(['stone_tallA', 'stone_tallB', 'stone_tallC', 'stone_largeA', 'stone_largeB'], 140, 4, 160, [3, 7], s + 4, { avoidWater: false }),
    ],
  },

  snow: {
    id: 'snow',
    hazards: ['rock_largeA'],
    palette: { grassA: '#eef3fa', grassB: '#dde7f2', shoulder: '#cfdbe8', sand: '#e8eef5', rock: '#9aa3b2' },
    noiseAmplitude: 7,
    lakes: true,
    liquid: { color: '#bfe6f7', opacity: 0.96 },
    lighting: { sunDirection: [-0.5, 0.7, -0.4], sunColor: '#f0f6ff', sunIntensity: 2.1, skyColor: '#e4f0ff', groundColor: '#c0cad8', hemiIntensity: 1.3, exposure: 0.98 },
    sky: { top: '#6fa3dc', horizon: '#e9f3ff', bottom: '#f6faff', sunGlow: '#ffffff', fogColor: '#e2ecf6', fogNear: 110, fogFar: 900, clouds: 34 },
    mountains: { low: '#d8e2ee', mid: '#a8b4c4', peak: '#ffffff', snow: true },
    music: 'music-frost',
    halfWidth: 9,
    scatter: (s) => [
      rule(PINES, 900, 6, 380, [6.5, 11], s + 1, { castShadow: true, tint: '#ffffff', tintAmount: 0.55 }),
      rule(['tree_pineGroundA', 'tree_pineSmallA'], 380, 2, 60, [3.5, 6], s + 2, { tint: '#ffffff', tintAmount: 0.6 }),
      rule(ROCKS, 160, 4, 200, [3, 7], s + 3, { tint: '#e8eef8', tintAmount: 0.35, avoidWater: false }),
    ],
  },

  volcano: {
    id: 'volcano',
    hazards: ['rock_tallA', 'rock_tallB'],
    palette: { grassA: '#3d322d', grassB: '#4b3b33', shoulder: '#2e2622', sand: '#5a4538', rock: '#2a2422' },
    noiseAmplitude: 7,
    lakes: true,
    liquid: { color: '#ff6a1a', emissive: '#ff3a00', emissiveIntensity: 1.8, opacity: 1 },
    lighting: { sunDirection: [-0.3, 0.6, -0.6], sunColor: '#ffb08a', sunIntensity: 2, skyColor: '#ff9a7a', groundColor: '#4a2a1e', hemiIntensity: 1.1, exposure: 1.08 },
    sky: { top: '#2a0d12', horizon: '#ff7a3a', bottom: '#ffb070', sunGlow: '#ff8a4a', fogColor: '#6a3426', fogNear: 110, fogFar: 900, clouds: 0, stars: 0.25 },
    mountains: { low: '#2a2020', mid: '#3a2a26', peak: '#5a3a30' },
    music: 'music-volcano',
    halfWidth: 9,
    scatter: (s) => [
      rule(TALL_ROCKS, 380, 5, 300, [4, 11], s + 1, { castShadow: true, tint: '#2a2222', tintAmount: 0.65, avoidWater: false }),
      rule(['tree_thin_dark', 'tree_thin', 'stump_oldTall', 'stump_old'], 360, 4, 220, [4, 7], s + 2, { tint: '#2a201c', tintAmount: 0.6 }),
      rule(['rock_largeA', 'rock_largeC', 'stone_largeA'], 220, 2, 140, [2.5, 6], s + 3, { tint: '#3a2a26', tintAmount: 0.6, avoidWater: false }),
    ],
    landmarks: () => [{ type: 'volcano', params: { distance: 520 } }],
  },

  space: {
    id: 'space',
    palette: { grassA: '#10102a', grassB: '#10102a', shoulder: '#10102a', sand: '#10102a', rock: '#10102a' },
    noiseAmplitude: 0,
    lakes: false,
    lighting: { sunDirection: [0.3, 0.8, 0.4], sunColor: '#d8ccff', sunIntensity: 1.4, skyColor: '#8a7aff', groundColor: '#2a1a4a', hemiIntensity: 1.5, exposure: 1.15 },
    sky: { top: '#03031a', horizon: '#2a1660', bottom: '#120830', sunGlow: '#b07aff', fogColor: '#1a1040', fogNear: 300, fogFar: 1500, clouds: 0, stars: 1 },
    mountains: null,
    music: 'music-neon',
    halfWidth: 9,
    noCrowd: true,
    scatter: () => [],
  },

  sky: {
    id: 'sky',
    palette: { grassA: '#ffffff', grassB: '#ffffff', shoulder: '#ffffff', sand: '#ffffff', rock: '#ffffff' },
    noiseAmplitude: 0,
    lakes: false,
    lighting: { ...DAY_LIGHT, sunIntensity: 2.8, skyColor: '#e0f2ff', groundColor: '#ffffff', hemiIntensity: 1.4, exposure: 1.05 },
    sky: { top: '#3f8fe8', horizon: '#dff3ff', bottom: '#ffffff', sunGlow: '#fff4cf', fogColor: '#e8f4ff', fogNear: 260, fogFar: 1500, clouds: 40 },
    mountains: null,
    music: 'music-sunny',
    halfWidth: 9,
    noCrowd: true,
    scatter: () => [],
  },

  city: {
    id: 'city',
    palette: { grassA: '#2b2f3a', grassB: '#353a4a', shoulder: '#3a3f4f', sand: '#444a5c', rock: '#555b6e' },
    noiseAmplitude: 1.5,
    lakes: false,
    lighting: { sunDirection: [0.4, 0.75, 0.5], sunColor: '#a8b8ff', sunIntensity: 1.1, skyColor: '#6a5ad8', groundColor: '#1a1a2a', hemiIntensity: 1.25, exposure: 1.15 },
    sky: { top: '#05061a', horizon: '#3a2470', bottom: '#5a2a7a', sunGlow: '#8a7aff', fogColor: '#1e1838', fogNear: 120, fogFar: 950, clouds: 0, stars: 1 },
    mountains: null,
    music: 'music-neon',
    halfWidth: 9.5,
    noCrowd: true,
    scatter: (s) => [rule(['tree_cone_dark', 'tree_default_dark'], 160, 3, 18, [4, 6], s + 1)],
    landmarks: () => [{ type: 'skyline', params: { count: 260 } }],
    props: (L) => [{ model: 'lightPostModern', distance: 20, side: 'left', wallOffset: 0.8, scale: 9, repeat: { every: 34, until: L - 20 } }],
  },

  // ---------------------------------------------------------------- course-specific worlds

  /** Coral Cove: white-sand islet in a turquoise lagoon (not Palm Bay's resort jungle). */
  beach: {
    id: 'beach',
    palette: { grassA: '#f2e2b8', grassB: '#e9d6a4', shoulder: '#f4e6c2', sand: '#fbf0d2', rock: '#c8b89a' },
    noiseAmplitude: 2.5,
    lakes: true,
    liquid: { color: '#2fd6d0', opacity: 0.82 },
    lighting: { ...DAY_LIGHT, sunDirection: [-0.35, 0.85, 0.2], sunIntensity: 3, skyColor: '#d8fbff', groundColor: '#f0e0b0', exposure: 1.06 },
    sky: { ...DAY_SKY, top: '#0f9ae8', horizon: '#c8f8ff', bottom: '#e8fcff', fogColor: '#d2f6ff', fogNear: 220, fogFar: 1400, clouds: 14 },
    mountains: { low: '#e8d6a8', mid: '#6fb07a', peak: '#4f9a6a' },
    music: 'music-sunny',
    halfWidth: 9,
    hazards: ['rock_largeE', 'rock_largeF'],
    scatter: (s) => [
      rule(['tree_palmBend', 'tree_palmDetailedTall', 'tree_palmTall', 'tree_palmShort'], 340, 5, 200, [6.5, 10.5], s + 1, { castShadow: true }),
      rule(['grass_large', 'plant_flatTall'], 420, 1, 40, [2.5, 4], s + 2, { tint: '#d8c890', tintAmount: 0.35 }),
      rule(['rock_largeE', 'rock_largeF', 'rock_largeB'], 90, 6, 160, [2, 5], s + 3, { avoidWater: false, tint: '#e8dcc0', tintAmount: 0.4 }),
    ],
  },

  /** River Rapids: lush valley with white water, mossy rocks and mill country. */
  river: {
    id: 'river',
    palette: { grassA: '#4fae4a', grassB: '#7cc35a', shoulder: '#5a9a48', sand: '#c9c2a0', rock: '#7d8a8a' },
    noiseAmplitude: 6,
    lakes: true,
    liquid: { color: '#3fb8e0', opacity: 0.86 },
    lighting: { ...DAY_LIGHT, sunDirection: [-0.6, 0.72, -0.2], sunColor: '#fff6e0', groundColor: '#4a7a3a' },
    sky: { ...DAY_SKY, top: '#3a8ee0', horizon: '#d8f2ff', fogColor: '#d4eef4', fogNear: 150, clouds: 30 },
    mountains: { low: '#3f8a4a', mid: '#6f8f7a', peak: '#c8d8d0' },
    music: 'music-sunny',
    halfWidth: 9,
    hazards: ['log_stack'],
    scatter: (s) => [
      rule(['tree_oak', 'tree_detailed', 'tree_tall', 'tree_pineRoundA', 'tree_pineTallA_detailed'], 760, 6, 320, [6, 10], s + 1, { castShadow: true }),
      rule(BUSHES, 420, 1.5, 45, [3.5, 6], s + 2),
      rule(['rock_largeA', 'rock_largeC', 'rock_largeD'], 220, 3, 160, [2.5, 6], s + 3, { avoidWater: false, tint: '#5a7a5a', tintAmount: 0.25 }),
      rule(['flower_purpleA', 'flower_yellowA', 'grass_large', 'lily_large'], 700, 0.8, 45, [3, 4.5], s + 4),
    ],
  },

  /** Jungle Falls: dense, misty rainforest under cliffs and cascades. */
  jungle: {
    id: 'jungle',
    palette: { grassA: '#2f8a3a', grassB: '#4fa040', shoulder: '#6a5a3a', sand: '#b8a070', rock: '#5f6a52' },
    noiseAmplitude: 7,
    lakes: true,
    liquid: { color: '#2aa898', opacity: 0.88 },
    lighting: { ...DAY_LIGHT, sunDirection: [-0.3, 0.86, 0.35], sunColor: '#fff2c8', sunIntensity: 2.3, skyColor: '#cdeedd', groundColor: '#2f5a2a', hemiIntensity: 1.2 },
    sky: { ...DAY_SKY, top: '#3d9a8a', horizon: '#d8f0d0', bottom: '#eaf6e0', fogColor: '#c4e2c8', fogNear: 90, fogFar: 760, clouds: 24 },
    mountains: { low: '#2a6a3a', mid: '#3f7a4a', peak: '#6a9a6a' },
    music: 'music-dunes',
    halfWidth: 9,
    hazards: ['statue_head', 'statue_block'],
    scatter: (s) => [
      rule([...PALMS, 'tree_tall_dark', 'tree_oak_dark', 'tree_plateau_dark'], 1100, 5, 300, [7, 12], s + 1, { castShadow: true }),
      rule(['plant_bushLargeTriangle', 'plant_flatTall', 'plant_bushDetailed', 'plant_bushLarge'], 900, 1.2, 50, [3.5, 7], s + 2),
      rule(['hanging_moss', 'grass_large'], 400, 1, 40, [3, 5], s + 3),
      rule(['statue_head', 'statue_columnDamaged', 'stone_tallA'], 40, 8, 120, [4, 7], s + 4, { castShadow: true, tint: '#4a6a3a', tintAmount: 0.35 }),
    ],
  },

  /** Moonlit Marsh: a blue night bog — fog, dead trees, lily pads, will-o'-wisps. */
  marsh: {
    id: 'marsh',
    palette: { grassA: '#3a5a46', grassB: '#4a6a4a', shoulder: '#3a4a3a', sand: '#5a5a48', rock: '#4a5058' },
    noiseAmplitude: 3,
    lakes: true,
    liquid: { color: '#2a4a48', emissive: '#18403a', emissiveIntensity: 0.4, opacity: 0.92 },
    lighting: { sunDirection: [0.35, 0.6, -0.5], sunColor: '#bcd4ff', sunIntensity: 1.5, skyColor: '#7a8ad8', groundColor: '#1a2a2a', hemiIntensity: 1.15, exposure: 1.12 },
    sky: { top: '#060a24', horizon: '#3a4a7a', bottom: '#4a5a7a', sunGlow: '#e8f0ff', fogColor: '#2a3654', fogNear: 70, fogFar: 640, clouds: 10, stars: 0.9 },
    mountains: { low: '#1a2a2a', mid: '#2a3446', peak: '#4a5468' },
    music: 'music-neon',
    halfWidth: 9,
    noCrowd: true,
    hazards: ['stump_oldTall', 'stump_old'],
    scatter: (s) => [
      rule(['tree_thin_dark', 'tree_default_dark', 'tree_plateau_dark', 'tree_cone_dark'], 620, 6, 280, [6, 10], s + 1, { castShadow: true, tint: '#2a3a3a', tintAmount: 0.35 }),
      rule(['stump_old', 'stump_oldTall', 'log_large'], 260, 2, 90, [3, 5], s + 2, { tint: '#3a3a30', tintAmount: 0.3 }),
      rule(['lily_large', 'grass_large', 'hanging_moss'], 700, 0.8, 50, [3, 5], s + 3, { avoidWater: false }),
      rule(['mushroom_tan', 'mushroom_tanGroup'], 160, 1, 40, [3, 5], s + 4),
    ],
  },

  /** Clockwork Factory: brick, steel and smog at golden hour. */
  factory: {
    id: 'factory',
    palette: { grassA: '#5a5650', grassB: '#6a645a', shoulder: '#4a4844', sand: '#7a6a58', rock: '#5a4a42' },
    noiseAmplitude: 1.2,
    lakes: false,
    lighting: { sunDirection: [-0.7, 0.5, 0.3], sunColor: '#ffc890', sunIntensity: 2.3, skyColor: '#d8b89a', groundColor: '#4a3a30', hemiIntensity: 1.1, exposure: 1.06 },
    sky: { top: '#5a5a7a', horizon: '#e8a070', bottom: '#d89a7a', sunGlow: '#ffb070', fogColor: '#b08a78', fogNear: 120, fogFar: 900, clouds: 12 },
    mountains: null,
    music: 'music-volcano',
    halfWidth: 9,
    noCrowd: true,
    hazards: ['pylon'],
    scatter: (s) => [rule(['rock_largeA', 'rock_largeC'], 60, 4, 60, [2, 4], s + 1, { tint: '#5a5048', tintAmount: 0.5 })],
  },

  /** Glacier Gauntlet: blue ice and a frozen sea under an aurora. */
  glacier: {
    id: 'glacier',
    palette: { grassA: '#d8ecf8', grassB: '#c4e0f2', shoulder: '#b8d8ee', sand: '#e0f0fa', rock: '#7fa8c8' },
    noiseAmplitude: 8,
    lakes: true,
    liquid: { color: '#7ad0f0', emissive: '#2a80b0', emissiveIntensity: 0.25, opacity: 0.95 },
    lighting: { sunDirection: [0.4, 0.45, -0.6], sunColor: '#d8f0ff', sunIntensity: 1.9, skyColor: '#9ad8ff', groundColor: '#8ab0d0', hemiIntensity: 1.35, exposure: 1.0 },
    sky: { top: '#0a1a40', horizon: '#3ad8b0', bottom: '#a8e8ff', sunGlow: '#9affd8', fogColor: '#7ab8d0', fogNear: 120, fogFar: 900, clouds: 8, stars: 0.6 },
    mountains: { low: '#a8d0e8', mid: '#6aa0c8', peak: '#e8f8ff', snow: true },
    music: 'music-frost',
    halfWidth: 9,
    noCrowd: true,
    hazards: ['rock_largeB'],
    scatter: (s) => [
      rule(TALL_ROCKS, 260, 5, 260, [5, 12], s + 1, { castShadow: true, tint: '#a8dcff', tintAmount: 0.7, avoidWater: false }),
      rule(['tree_pineSmallA', 'tree_pineGroundA'], 200, 4, 120, [3.5, 6], s + 2, { tint: '#ffffff', tintAmount: 0.7 }),
      rule(ROCKS, 160, 3, 160, [2.5, 6], s + 3, { tint: '#c8ecff', tintAmount: 0.6, avoidWater: false }),
    ],
  },

  /** Thunder Ridge: red mesas under a bruised storm sky. */
  mesa: {
    id: 'mesa',
    palette: { grassA: '#a8603a', grassB: '#b8744a', shoulder: '#8a5038', sand: '#c88a5a', rock: '#7a3a2a' },
    noiseAmplitude: 8,
    lakes: false,
    lighting: { sunDirection: [-0.2, 0.7, 0.6], sunColor: '#d8d0ff', sunIntensity: 1.7, skyColor: '#8a8aa8', groundColor: '#5a3020', hemiIntensity: 1.2, exposure: 1.08 },
    sky: { top: '#1a1a30', horizon: '#7a6a80', bottom: '#9a7a7a', sunGlow: '#b8b0ff', fogColor: '#5a4a5a', fogNear: 110, fogFar: 820, clouds: 30 },
    mountains: { low: '#8a4a30', mid: '#a85a38', peak: '#c87a4a' },
    music: 'music-volcano',
    halfWidth: 9,
    noCrowd: true,
    hazards: ['rock_tallC', 'rock_tallD'],
    scatter: (s) => [
      rule(TALL_ROCKS, 300, 6, 300, [6, 16], s + 1, { castShadow: true, tint: '#a8502a', tintAmount: 0.55 }),
      rule(TALL_ROCKS, 60, 140, 420, [26, 48], s + 2, { tint: '#9a4a2a', tintAmount: 0.6 }),
      rule(['cactus_short', 'stump_old', 'rock_largeE'], 200, 2, 120, [2.5, 5], s + 3, { tint: '#8a5a3a', tintAmount: 0.3 }),
    ],
  },

  /** Magma Core: a black basalt caldera under a red-hot sky. */
  magma: {
    id: 'magma',
    palette: { grassA: '#201a1e', grassB: '#2a1e1e', shoulder: '#1e1818', sand: '#3a2420', rock: '#1a1416' },
    noiseAmplitude: 6,
    lakes: true,
    liquid: { color: '#ff4a10', emissive: '#ff2a00', emissiveIntensity: 2.2, opacity: 1 },
    lighting: { sunDirection: [0.2, 0.7, -0.6], sunColor: '#ff8a5a', sunIntensity: 1.7, skyColor: '#ff5a3a', groundColor: '#3a1010', hemiIntensity: 1.15, exposure: 1.12 },
    sky: { top: '#0a0206', horizon: '#c8301a', bottom: '#ff6a2a', sunGlow: '#ff4a1a', fogColor: '#4a1410', fogNear: 90, fogFar: 760, clouds: 0, stars: 0.15 },
    mountains: { low: '#1a1010', mid: '#2a1414', peak: '#ff4a1a' },
    music: 'music-volcano',
    halfWidth: 9,
    noCrowd: true,
    hazards: ['rock_tallE', 'rock_tallF'],
    scatter: (s) => [
      rule(TALL_ROCKS, 420, 5, 300, [5, 13], s + 1, { castShadow: true, tint: '#140e10', tintAmount: 0.8, avoidWater: false }),
      rule(['rock_largeA', 'rock_largeD', 'stone_tallB'], 240, 2, 140, [2.5, 6], s + 2, { tint: '#1a1214', tintAmount: 0.75, avoidWater: false }),
    ],
  },

  /** Space variants: each cosmic course has its own nebula. */
  starlight: {
    id: 'starlight',
    palette: { grassA: '#10102a', grassB: '#10102a', shoulder: '#10102a', sand: '#10102a', rock: '#10102a' },
    noiseAmplitude: 0,
    lakes: false,
    lighting: { sunDirection: [0.3, 0.8, 0.4], sunColor: '#cfe0ff', sunIntensity: 1.5, skyColor: '#6a8aff', groundColor: '#1a2a5a', hemiIntensity: 1.5, exposure: 1.15 },
    sky: { top: '#01041a', horizon: '#14306a', bottom: '#0a1440', sunGlow: '#7ab0ff', fogColor: '#0e1a40', fogNear: 300, fogFar: 1500, clouds: 0, stars: 1 },
    mountains: null,
    music: 'music-neon',
    halfWidth: 9,
    noCrowd: true,
    scatter: () => [],
  },
  comet: {
    id: 'comet',
    palette: { grassA: '#10102a', grassB: '#10102a', shoulder: '#10102a', sand: '#10102a', rock: '#10102a' },
    noiseAmplitude: 0,
    lakes: false,
    lighting: { sunDirection: [-0.4, 0.75, 0.3], sunColor: '#d8fff0', sunIntensity: 1.5, skyColor: '#4adcc8', groundColor: '#0a2a2a', hemiIntensity: 1.45, exposure: 1.15 },
    sky: { top: '#020a10', horizon: '#0a4a4a', bottom: '#06202a', sunGlow: '#5affd8', fogColor: '#08262a', fogNear: 300, fogFar: 1500, clouds: 0, stars: 1 },
    mountains: null,
    music: 'music-neon',
    halfWidth: 9,
    noCrowd: true,
    scatter: () => [],
  },
  prism: {
    id: 'prism',
    palette: { grassA: '#10102a', grassB: '#10102a', shoulder: '#10102a', sand: '#10102a', rock: '#10102a' },
    noiseAmplitude: 0,
    lakes: false,
    lighting: { sunDirection: [0.3, 0.8, 0.4], sunColor: '#ffe0ff', sunIntensity: 1.3, skyColor: '#c88aff', groundColor: '#3a1a4a', hemiIntensity: 1.6, exposure: 1.15 },
    sky: { top: '#05021a', horizon: '#4a1a6a', bottom: '#200a3a', sunGlow: '#ff9aff', fogColor: '#1e0e3a', fogNear: 320, fogFar: 1600, clouds: 0, stars: 1 },
    mountains: null,
    music: 'music-neon',
    halfWidth: 9,
    noCrowd: true,
    scatter: () => [],
  },
};
