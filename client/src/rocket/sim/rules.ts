/**
 * Match rules ("mutators"): game, ball, boost and goal-explosion physics.
 * Multipliers are 1 at the standard values. Offline matches use the player's
 * rules; online matches always use DEFAULT_RULES (the server is authoritative).
 */
export type BoostMode = 'default' | 'unlimited' | 'none';
export type DemoMode = 'default' | 'disabled' | 'friendly' | 'contact';

export interface Rules {
  /** Simulation speed (offline only). */
  gameSpeed: number;
  gravity: number;
  ballSize: number;
  ballWeight: number;
  /** Ball ↔ world restitution (0..1). */
  ballBounce: number;
  /** uu/s. */
  ballMaxSpeed: number;
  ballDrag: number;
  /** Car → ball hit strength. */
  hitPower: number;
  boostMode: BoostMode;
  boostStrength: number;
  padSize: number;
  jumpHeight: number;
  /** Air pitch / yaw / roll torque. */
  airControl: number;
  bumpStrength: number;
  demolish: DemoMode;
  /** Seconds. */
  respawnTime: number;
  /** Seconds between a goal and the next kickoff. */
  goalDelay: number;
  /** Goal explosion knock-back (0 = none). */
  explosionForce: number;
  /** uu. */
  explosionRadius: number;
  /** Cars close to the ball are demolished by the explosion. */
  explosionDemos: boolean;
  /** Seconds of play shown in the goal replay (0 = no replays). */
  replayTime: number;
}

/** Extra goal-phase time a replay needs beyond `replayTime` (slow motion + the explosion). */
export const REPLAY_EXTRA = 2.4;

export const DEFAULT_RULES: Readonly<Rules> = Object.freeze({
  gameSpeed: 1,
  gravity: 1,
  ballSize: 1,
  ballWeight: 1,
  ballBounce: 0.6,
  ballMaxSpeed: 6000,
  ballDrag: 1,
  hitPower: 1,
  boostMode: 'default',
  boostStrength: 1,
  padSize: 1,
  jumpHeight: 1,
  airControl: 1,
  bumpStrength: 1,
  demolish: 'default',
  respawnTime: 3,
  goalDelay: 3,
  explosionForce: 1,
  explosionRadius: 1300,
  explosionDemos: true,
  replayTime: 5,
});

/** Fill in missing / invalid fields (old saves). */
export function sanitizeRules(r: Partial<Rules> | undefined): Rules {
  const out: Rules = { ...DEFAULT_RULES };
  if (!r) return out;
  for (const k of Object.keys(out) as Array<keyof Rules>) {
    const v = r[k];
    if (typeof v === typeof out[k] && (typeof v !== 'number' || Number.isFinite(v))) (out as unknown as Record<string, unknown>)[k] = v;
  }
  return out;
}
