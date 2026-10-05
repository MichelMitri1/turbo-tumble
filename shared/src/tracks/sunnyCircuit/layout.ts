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
  { pos: [142, 4.5, -134] },
  { pos: [182, 7.5, -100] },
  { pos: [206, 9.5, -50], kind: 'bridge', halfWidth: 8.5 },
  { pos: [214, 10.5, 5], kind: 'bridge', halfWidth: 8.5 },
  { pos: [212, 10, 60], halfWidth: 8.5 },
  { pos: [194, 8, 110] },
  { pos: [160, 5, 134] },
  { pos: [126, 3.2, 132] },
  { pos: [96, 2, 152] },
  { pos: [70, 1, 186], kind: 'tunnel', halfWidth: 8.5 },
  { pos: [32, 0.5, 210], kind: 'tunnel', halfWidth: 8.5 },
  { pos: [-10, 0, 214], halfWidth: 9 },
  { pos: [-54, 0, 204], halfWidth: 10.5 },
  { pos: [-90, 0, 178], halfWidth: 11.5, shoulder: 9 },
  { pos: [-102, 0, 140], halfWidth: 11.5, shoulder: 9 },
  { pos: [-86, 0, 106], halfWidth: 11 },
  { pos: [-52, 0, 94], halfWidth: 10 },
  { pos: [-18, 0, 86], halfWidth: 9.5 },
];
