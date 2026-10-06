import type { TrackDefinition } from '../types/track';
import { COURSES } from './courses';

/** All playable tracks. New tracks register here and are picked up by menus & the server. */
export const TRACKS: readonly TrackDefinition[] = COURSES;

export function getTrack(id: string): TrackDefinition {
  const t = TRACKS.find((track) => track.id === id);
  if (!t) throw new Error(`Unknown track "${id}"`);
  return t;
}

export function isTrackId(id: string): boolean {
  return TRACKS.some((t) => t.id === id);
}
