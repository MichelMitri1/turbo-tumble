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
