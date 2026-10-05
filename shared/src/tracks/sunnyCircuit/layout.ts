import type { TrackControlPoint } from '../../types/track';

/**
 * Sunny Circuit centerline (driving order). Start straight runs north (-Z), a long
 * right-hand sweeper climbs to the lake bridge, S-bends fall towards the tunnel
 * under Windmill Hill, then a hairpin and the final corner return to the stands.
 */
export const SUNNY_CIRCUIT_POINTS: TrackControlPoint[] = [
  { pos: [0, 0, 62] },
  { pos: [0, 0, 0] },
  { pos: [0, 0, -60] },
  { pos: [10, 0.5, -108] },
  { pos: [42, 1.5, -140], halfWidth: 10 },
  { pos: [92, 2.5, -150], halfWidth: 10 },
  { pos: [142, 10, -134] },
  { pos: [182, 18, -100] },
  { pos: [206, 24, -50], kind: 'bridge', halfWidth: 7 },
  { pos: [214, 27, 5], kind: 'bridge', halfWidth: 7 },
  { pos: [212, 25, 60], halfWidth: 7 },
  { pos: [194, 18, 110] },
  { pos: [160, 10, 134] },
  { pos: [126, 5, 132] },
  { pos: [96, 2, 152] },
  { pos: [70, 1, 186], kind: 'tunnel', halfWidth: 7 },
  { pos: [32, 0.5, 210], kind: 'tunnel', halfWidth: 7 },
  { pos: [-10, 0, 214], halfWidth: 9 },
  { pos: [-54, 5, 204], halfWidth: 10.5 },
  { pos: [-90, 9, 178], halfWidth: 8, shoulder: 4 },
  { pos: [-102, 10, 140], halfWidth: 8, shoulder: 4 },
  { pos: [-86, 6, 106], halfWidth: 8 },
  { pos: [-52, 0, 94], halfWidth: 10 },
  { pos: [-18, 0, 86], halfWidth: 9.5 },
];
