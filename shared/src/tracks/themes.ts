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
};
