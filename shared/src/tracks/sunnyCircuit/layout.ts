import type { TrackControlPoint } from '../../types/track';

/**
 * Sunny Circuit centerline (driving order). Start straight runs north (-Z), a long
 * right-hand sweeper climbs to the lake bridge, S-bends fall towards the tunnel
 * under Windmill Hill, then a hairpin and the final corner return to the stands.
 */
export const SUNNY_CIRCUIT_POINTS: TrackControlPoint[] = [
  { pos: [0.0, 0.0, 93.0] },
  { pos: [0.0, 0.0, 0.0] },
  { pos: [0.0, 0.0, -90.0] },
  { pos: [15.0, 0.5, -162.0] },
  { pos: [63.0, 1.5, -210.0], halfWidth: 10 },
  { pos: [138.0, 2.5, -225.0], halfWidth: 10 },
  { pos: [213.0, 10.0, -201.0] },
  { pos: [273.0, 18.0, -150.0] },
  { pos: [309.0, 24.0, -75.0], kind: 'bridge', halfWidth: 7 },
  { pos: [321.0, 27.0, 7.5], kind: 'bridge', halfWidth: 7 },
  { pos: [318.0, 25.0, 90.0], halfWidth: 7 },
  { pos: [291.0, 18.0, 165.0] },
  { pos: [240.0, 10.0, 201.0] },
  { pos: [189.0, 5.0, 198.0] },
  { pos: [144.0, 2.0, 228.0] },
  { pos: [105.0, 1.0, 279.0], kind: 'tunnel', halfWidth: 7 },
  { pos: [48.0, 0.5, 315.0], kind: 'tunnel', halfWidth: 7 },
  { pos: [-15.0, 0.0, 321.0], halfWidth: 9 },
  { pos: [-81.0, 5.0, 306.0], halfWidth: 10.5 },
  { pos: [-135.0, 9.0, 267.0], halfWidth: 8, shoulder: 4 },
  { pos: [-153.0, 10.0, 210.0], halfWidth: 8, shoulder: 4 },
  { pos: [-129.0, 6.0, 159.0], halfWidth: 8 },
  { pos: [-78.0, 0.0, 141.0], halfWidth: 10 },
  { pos: [-27.0, 0.0, 129.0], halfWidth: 9.5 },
];
