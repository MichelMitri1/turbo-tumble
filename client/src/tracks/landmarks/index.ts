import type { LandmarkPlacement } from '@shared/types/track';
import type { BuildContext } from '../BuildContext';
import { buildStartGantry } from './StartGantry';
import { buildGrandstand } from './Grandstand';
import { buildBillboard } from './Billboard';
import { buildPitRow, PIT_ROW_MODELS } from './PitRow';
import { buildWindmill } from './Windmill';
import { buildBalloon } from './Balloon';
import { buildClouds, buildMountains } from './Scenery';
import { buildSkyline } from './Skyline';
import { buildVolcano } from './Volcano';
import { buildArch } from './Arch';
import { buildSkyIslands } from './SkyIslands';
import { buildPrism } from './Prism';
import { buildComet } from './Comet';
import { buildSpaceStation } from './SpaceStation';
import { buildFactoryYard } from './Factory';
import { buildBoardwalk, buildCove, buildLighthouse, buildResort } from './Coast';
import { buildWaterfall } from './Waterfall';
import { buildSawmill } from './Sawmill';
import { buildCastle } from './Castle';
import { buildBarn } from './Farm';
import { buildGiantTree } from './GiantTree';
import { buildPyramids } from './Pyramids';
import { buildGiantMushrooms } from './Mushrooms';
import { buildIdol, buildStepPyramid } from './Temple';
import { buildSkiLift } from './SkiLift';
import { buildNeonTower } from './NeonTower';
import { buildMarshGraves } from './Marsh';
import { buildIceSpires } from './Glacier';
import { buildStormTower } from './Storm';
import { buildMagmaCore } from './Magma';
import type { KitId } from '../kits';

export type LandmarkBuilder = (ctx: BuildContext, placement: LandmarkPlacement) => void;

interface LandmarkEntry {
  build: LandmarkBuilder;
  /** Asset-manifest models this landmark needs loaded. */
  models?: readonly string[];
  /** Kenney kits (environment/kits/*.glb) this landmark pulls models from. */
  kits?: readonly KitId[];
}

/** Registry of procedural set pieces usable from any TrackDefinition. */
export const LANDMARKS: Record<string, LandmarkEntry> = {
  startGantry: { build: buildStartGantry },
  grandstand: { build: buildGrandstand },
  billboard: { build: buildBillboard },
  pitRow: { build: buildPitRow, models: PIT_ROW_MODELS },
  windmill: { build: buildWindmill },
  balloon: { build: buildBalloon },
  mountains: { build: buildMountains },
  clouds: { build: (ctx, p) => buildClouds(ctx, p) },
  skyline: { build: buildSkyline },
  volcano: { build: buildVolcano },
  // Course signatures and themed scenery.
  arch: { build: buildArch },
  skyIslands: { build: buildSkyIslands },
  prism: { build: buildPrism },
  comet: { build: buildComet },
  spaceStation: { build: buildSpaceStation, kits: ['space'] },
  factoryYard: { build: buildFactoryYard, kits: ['factory', 'industrial'] },
  lighthouse: { build: buildLighthouse },
  resort: { build: buildResort, kits: ['pirate', 'town'] },
  cove: { build: buildCove, kits: ['pirate'] },
  boardwalk: { build: buildBoardwalk, kits: ['town', 'pirate'] },
  waterfall: { build: buildWaterfall },
  sawmill: { build: buildSawmill, kits: ['town', 'survival'] },
  castle: { build: buildCastle, kits: ['castle'] },
  barn: { build: buildBarn, kits: ['suburban', 'graveyard'] },
  giantTree: { build: buildGiantTree, kits: ['survival'] },
  pyramids: { build: buildPyramids },
  giantMushrooms: { build: buildGiantMushrooms },
  stepPyramid: { build: buildStepPyramid },
  idol: { build: buildIdol },
  skiLift: { build: buildSkiLift, kits: ['holiday'] },
  neonTower: { build: buildNeonTower },
  marshGraves: { build: buildMarshGraves, kits: ['graveyard'] },
  iceSpires: { build: buildIceSpires },
  stormTower: { build: buildStormTower },
  magmaCore: { build: buildMagmaCore },
};

export function getLandmark(type: string): LandmarkEntry {
  const entry = LANDMARKS[type];
  if (!entry) throw new Error(`Unknown landmark type "${type}"`);
  return entry;
}
