/**
 * Tunable handling numbers. Karts and characters each contribute modifiers
 * (later phases) on top of BASE_KART_STATS.
 */
export interface KartStats {
  /** Top speed on road, m/s. */
  maxSpeed: number;
  /** Exponential approach rate towards top speed (1/s). Higher = punchier. */
  accelRate: number;
  /** Floor on acceleration near top speed (m/s²). */
  accelMin: number;
  brakeDecel: number;
  reverseMaxSpeed: number;
  reverseAccel: number;
  /** Rolling deceleration with no input (m/s²). */
  coastDecel: number;
  /** Peak yaw rate at medium speed (rad/s). */
  turnRate: number;
  /** Fraction of turnRate kept at top speed. */
  highSpeedTurn: number;
  /** Speed at which steering reaches full authority (m/s). */
  fullSteerSpeed: number;
  /** Lateral velocity damping on road (1/s). */
  grip: number;
  /** Steering authority while airborne (0..1). */
  airControl: number;
  /** Vertical velocity of a hop (m/s). */
  hopSpeed: number;
  /** How strongly slopes accelerate the kart (0..1 of gravity). */
  slopeFactor: number;
  /** Wall bounce restitution. */
  wallBounce: number;
  /** Mass-like value used for kart-to-kart pushes (later phase). */
  weight: number;
}

export const BASE_KART_STATS: Readonly<KartStats> = {
  maxSpeed: 31,
  accelRate: 1.1,
  accelMin: 2.6,
  brakeDecel: 38,
  reverseMaxSpeed: 9,
  reverseAccel: 16,
  coastDecel: 4.5,
  turnRate: 1.85,
  highSpeedTurn: 0.78,
  fullSteerSpeed: 9,
  grip: 10,
  airControl: 0.35,
  hopSpeed: 6.2,
  slopeFactor: 0.5,
  wallBounce: 0.35,
  weight: 1,
};

/** Stat modifiers are additive deltas on top of the base stats (e.g. { maxSpeed: +0.5 }). */
export function withModifiers(base: Readonly<KartStats>, ...mods: Array<Partial<KartStats>>): KartStats {
  const out: KartStats = { ...base };
  for (const m of mods) {
    for (const [k, v] of Object.entries(m) as Array<[keyof KartStats, number]>) out[k] += v;
  }
  return out;
}
