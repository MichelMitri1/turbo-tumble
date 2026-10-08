import { freight } from './maps/freight';
import { culdesac } from './maps/culdesac';
import { outpost } from './maps/outpost';
import { atomic } from './maps/atomic';
import { manor } from './maps/manor';
import { downtown } from './maps/downtown';
import type { MapDef } from './mapkit';

export type { Backdrop, MapDef, MapTheme, PropPlacement, SpawnPoint } from './mapkit';

/** Multiplayer maps (each built from boxes + props, see mapkit.ts). */
export const MAPS: MapDef[] = [atomic(), freight(), culdesac(), downtown(), manor(), outpost()];
export const MAP = Object.fromEntries(MAPS.map((m) => [m.id, m])) as Record<string, MapDef>;
