/**
 * Rackets: the three real padel shapes at regulation size (≤ 45.5 cm long, ≤ 26 cm wide, ≤ 38 mm
 * thick, a drilled face, ~360–375 g), in original designs.
 *   round     balance low, big centred sweet spot — control
 *   teardrop  balance mid — all-round
 *   diamond   balance high, sweet spot up the face — power
 * In play: power scales pace, control tightens the aim, sweet spot widens the timing window / reach.
 */
export type RacketShape = 'round' | 'teardrop' | 'diamond';

export interface Racket {
  id: string;
  name: string;
  shape: RacketShape;
  /** Face colours: base, accent, trim. */
  colors: [string, string, string];
  weight: number;
  power: number;
  control: number;
  sweet: number;
  blurb: string;
}

export const RACKETS: Racket[] = [
  { id: 'halo', name: 'Halo Control', shape: 'round', colors: ['#f2f4f7', '#1f6fe0', '#0b1b33'], weight: 360, power: 0.62, control: 0.95, sweet: 0.95, blurb: 'Round, low balance, big sweet spot. Placement over pace.' },
  { id: 'lumen', name: 'Lumen Soft', shape: 'round', colors: ['#ffe066', '#ff7a1a', '#2b1600'], weight: 355, power: 0.58, control: 0.9, sweet: 1, blurb: 'Soft foam core: forgiving on every touch.' },
  { id: 'tempest', name: 'Tempest Hybrid', shape: 'teardrop', colors: ['#14171c', '#2fd18a', '#e9f7ef'], weight: 365, power: 0.78, control: 0.8, sweet: 0.8, blurb: 'Teardrop, medium balance. Does everything well.' },
  { id: 'sirocco', name: 'Sirocco', shape: 'teardrop', colors: ['#d7263d', '#f4f4f4', '#1b1b1b'], weight: 368, power: 0.8, control: 0.76, sweet: 0.78, blurb: 'A little head-heavy for extra bite on the overheads.' },
  { id: 'viper', name: 'Viper Power', shape: 'diamond', colors: ['#111111', '#c8ff00', '#5a5a5a'], weight: 372, power: 0.95, control: 0.62, sweet: 0.6, blurb: 'Diamond, high balance, carbon face. Built to finish.' },
  { id: 'blitz', name: 'Blitz Carbon', shape: 'diamond', colors: ['#1d2b5a', '#ff3ea5', '#b9c7ff'], weight: 375, power: 1, control: 0.58, sweet: 0.55, blurb: '18K carbon, stiff and explosive. Punishes a late swing.' },
];

export const RACKET = Object.fromEntries(RACKETS.map((r) => [r.id, r])) as Record<string, Racket>;

/**
 * The frame outline (metres, face plane): centred on the x axis, the throat at y = 0 up to the tip at
 * y = HEAD_L, widest 0.26 m at a height set by the shape. The handle runs below (y < 0).
 */
export const RACKET_LEN = 0.455;
export const HEAD_L = 0.3;
export const HANDLE_L = RACKET_LEN - HEAD_L;
export const RACKET_W = 0.26;
export const RACKET_T = 0.038;

/** Half-width of the head at height y (0 … HEAD_L) for a shape. */
export function headHalfWidth(shape: RacketShape, y: number): number {
  const u = Math.max(0, Math.min(1, y / HEAD_L));
  const widest = shape === 'round' ? 0.5 : shape === 'teardrop' ? 0.6 : 0.68;
  const half = RACKET_W / 2;
  // Throat → widest: a widening curve; widest → tip: closing off (rounder for round, pointier for diamond).
  if (u <= widest) {
    const a = u / widest;
    return half * (0.22 + 0.78 * Math.sin((a * Math.PI) / 2) ** (shape === 'diamond' ? 1.4 : 0.9));
  }
  const b = (u - widest) / (1 - widest);
  const close = shape === 'round' ? 2 : shape === 'teardrop' ? 1.6 : 1.15;
  return half * Math.max(0, Math.cos((b * Math.PI) / 2)) ** (1 / close);
}
