/**
 * Single source of truth for runtime asset paths. Gameplay code refers to assets by
 * id only; the loader resolves ids through this manifest.
 */

export type ModelPivot = 'source' | 'base-center';

export interface ModelEntry {
  url: string;
  /** 'base-center' recentres the model so its footprint is centred and it rests on y=0. */
  pivot: ModelPivot;
}

const kart = (name: string): ModelEntry => ({ url: `assets/karts/${name}.glb`, pivot: 'source' });
const racing = (name: string): ModelEntry => ({ url: `assets/environment/racing/${name}.glb`, pivot: 'base-center' });
const nature = (name: string): ModelEntry => ({ url: `assets/environment/nature/${name}.glb`, pivot: 'base-center' });
const item = (name: string): ModelEntry => ({ url: `assets/items/${name}.glb`, pivot: 'base-center' });

export const MODELS = {
  // Karts (Kenney Car Kit — each file contains a kart body + driver)
  'kart-oobi': kart('kart-oobi'),
  'kart-oodi': kart('kart-oodi'),
  'kart-ooli': kart('kart-ooli'),
  'kart-oopi': kart('kart-oopi'),
  'kart-oozi': kart('kart-oozi'),

  // Items
  'item-box': item('item-box'),
  'item-cone': item('item-cone'),

  // Racing venue props
  grandStandCovered: racing('grandStandCovered'),
  grandStandAwning: racing('grandStandAwning'),
  grandStandCoveredRound: racing('grandStandCoveredRound'),
  tent: racing('tent'),
  tentLong: racing('tentLong'),
  tentClosedLong: racing('tentClosedLong'),
  bannerTowerRed: racing('bannerTowerRed'),
  bannerTowerGreen: racing('bannerTowerGreen'),
  flagCheckers: racing('flagCheckers'),
  flagRed: racing('flagRed'),
  flagGreen: racing('flagGreen'),
  lightPostModern: racing('lightPostModern'),
  lightPostLarge: racing('lightPostLarge'),
  pitsGarage: racing('pitsGarage'),
  pitsOffice: racing('pitsOffice'),
  overheadLights: racing('overheadLights'),
  pylon: racing('pylon'),
  fenceStraight: racing('fenceStraight'),
  radarEquipment: racing('radarEquipment'),

  // Nature
  tree_oak: nature('tree_oak'),
  tree_default: nature('tree_default'),
  tree_detailed: nature('tree_detailed'),
  tree_fat: nature('tree_fat'),
  tree_tall: nature('tree_tall'),
  tree_pineRoundA: nature('tree_pineRoundA'),
  tree_pineRoundC: nature('tree_pineRoundC'),
  tree_pineTallA_detailed: nature('tree_pineTallA_detailed'),
  tree_cone: nature('tree_cone'),
  plant_bushLarge: nature('plant_bushLarge'),
  plant_bushDetailed: nature('plant_bushDetailed'),
  plant_bush: nature('plant_bush'),
  rock_largeA: nature('rock_largeA'),
  rock_largeB: nature('rock_largeB'),
  rock_largeC: nature('rock_largeC'),
  rock_largeD: nature('rock_largeD'),
  rock_tallA: nature('rock_tallA'),
  rock_tallB: nature('rock_tallB'),
  rock_tallC: nature('rock_tallC'),
  flower_redA: nature('flower_redA'),
  flower_yellowA: nature('flower_yellowA'),
  flower_purpleA: nature('flower_purpleA'),
  grass_large: nature('grass_large'),
  mushroom_red: nature('mushroom_red'),
  stump_round: nature('stump_round'),
  log_large: nature('log_large'),
  fence_simple: nature('fence_simple'),
  // Theme scenery (Kenney Nature Kit, Phase 7)
  cactus_short: nature('cactus_short'),
  cactus_tall: nature('cactus_tall'),
  crop_melon: nature('crop_melon'),
  crop_pumpkin: nature('crop_pumpkin'),
  crops_cornStageD: nature('crops_cornStageD'),
  crops_wheatStageB: nature('crops_wheatStageB'),
  fence_planks: nature('fence_planks'),
  flower_redB: nature('flower_redB'),
  flower_yellowB: nature('flower_yellowB'),
  hanging_moss: nature('hanging_moss'),
  lily_large: nature('lily_large'),
  log_stack: nature('log_stack'),
  log_stackLarge: nature('log_stackLarge'),
  mushroom_redGroup: nature('mushroom_redGroup'),
  mushroom_redTall: nature('mushroom_redTall'),
  mushroom_tan: nature('mushroom_tan'),
  mushroom_tanGroup: nature('mushroom_tanGroup'),
  mushroom_tanTall: nature('mushroom_tanTall'),
  plant_bushLargeTriangle: nature('plant_bushLargeTriangle'),
  plant_flatTall: nature('plant_flatTall'),
  rock_largeE: nature('rock_largeE'),
  rock_largeF: nature('rock_largeF'),
  rock_tallD: nature('rock_tallD'),
  rock_tallE: nature('rock_tallE'),
  rock_tallF: nature('rock_tallF'),
  rock_tallG: nature('rock_tallG'),
  rock_tallH: nature('rock_tallH'),
  statue_block: nature('statue_block'),
  statue_column: nature('statue_column'),
  statue_columnDamaged: nature('statue_columnDamaged'),
  statue_head: nature('statue_head'),
  statue_obelisk: nature('statue_obelisk'),
  statue_ring: nature('statue_ring'),
  stone_largeA: nature('stone_largeA'),
  stone_largeB: nature('stone_largeB'),
  stone_tallA: nature('stone_tallA'),
  stone_tallB: nature('stone_tallB'),
  stone_tallC: nature('stone_tallC'),
  stump_old: nature('stump_old'),
  stump_oldTall: nature('stump_oldTall'),
  tree_blocks: nature('tree_blocks'),
  tree_cone_dark: nature('tree_cone_dark'),
  tree_cone_fall: nature('tree_cone_fall'),
  tree_default_dark: nature('tree_default_dark'),
  tree_default_fall: nature('tree_default_fall'),
  tree_detailed_fall: nature('tree_detailed_fall'),
  tree_fat_fall: nature('tree_fat_fall'),
  tree_oak_dark: nature('tree_oak_dark'),
  tree_oak_fall: nature('tree_oak_fall'),
  tree_palm: nature('tree_palm'),
  tree_palmBend: nature('tree_palmBend'),
  tree_palmDetailedShort: nature('tree_palmDetailedShort'),
  tree_palmDetailedTall: nature('tree_palmDetailedTall'),
  tree_palmShort: nature('tree_palmShort'),
  tree_palmTall: nature('tree_palmTall'),
  tree_pineDefaultA: nature('tree_pineDefaultA'),
  tree_pineDefaultB: nature('tree_pineDefaultB'),
  tree_pineGroundA: nature('tree_pineGroundA'),
  tree_pineSmallA: nature('tree_pineSmallA'),
  tree_pineTallB_detailed: nature('tree_pineTallB_detailed'),
  tree_pineTallC_detailed: nature('tree_pineTallC_detailed'),
  tree_pineTallD_detailed: nature('tree_pineTallD_detailed'),
  tree_plateau_dark: nature('tree_plateau_dark'),
  tree_plateau_fall: nature('tree_plateau_fall'),
  tree_simple_fall: nature('tree_simple_fall'),
  tree_tall_dark: nature('tree_tall_dark'),
  tree_tall_fall: nature('tree_tall_fall'),
  tree_thin: nature('tree_thin'),
  tree_thin_dark: nature('tree_thin_dark'),
} satisfies Record<string, ModelEntry>;

export type ModelId = keyof typeof MODELS;

export function isModelId(id: string): id is ModelId {
  return Object.prototype.hasOwnProperty.call(MODELS, id);
}

/** glTF material names whose texture is third-party branding and gets our own strip instead. */
export const BRANDED_MATERIALS: readonly string[] = ['tankco'];

/**
 * Per-material colour overrides applied at load time so third-party kits match the
 * game's palette (keyed by glTF material name).
 */
export const MATERIAL_TINTS: Record<string, string> = {
  leafsGreen: '#4fbf3a',
  leafsDark: '#2f8f3a',
  grass: '#5cc23f',
  woodBark: '#9a5b35',
  stone: '#a59d92',
};
