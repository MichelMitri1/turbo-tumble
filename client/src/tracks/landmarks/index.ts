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

export type LandmarkBuilder = (ctx: BuildContext, placement: LandmarkPlacement) => void;

interface LandmarkEntry {
  build: LandmarkBuilder;
  /** Asset-manifest models this landmark needs loaded. */
  models?: readonly string[];
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
};

export function getLandmark(type: string): LandmarkEntry {
  const entry = LANDMARKS[type];
  if (!entry) throw new Error(`Unknown landmark type "${type}"`);
  return entry;
}
