/** Shared by local matches, online matches and every difficulty selector. */
export const CPU_LEVELS = ['beginner', 'amateur', 'pro', 'world', 'legendary'] as const;
export type CpuLevel = (typeof CPU_LEVELS)[number];

export interface CpuProfile {
  label: string;
  detail: string;
  skill: number;
  /** Seconds between outfield reads, with a little per-player variation. */
  decision: number;
  /** Seconds before reading an opponent's new pass. */
  reaction: number;
  tackleCooldown: number;
  tackleRate: number;
  tackleSuccess: number;
  /** Extra space left to the carrier / marked runner, in metres. */
  markingGap: number;
  /** Error in defensive positioning, in metres, held until the next read. */
  positionError: number;
  /** Multiplier on the normal kicking error for the player's rating. */
  kickError: number;
  keeper: number;
}

export const CPU_PROFILE: Record<CpuLevel, CpuProfile> = {
  beginner: { label: 'Beginner', detail: 'Lots of space · slow reactions', skill: 0.25, decision: 0.72, reaction: 0.6, tackleCooldown: 1.6, tackleRate: 0.25, tackleSuccess: 0.45, markingGap: 1.7, positionError: 1.8, kickError: 3.0, keeper: 0.78 },
  amateur: { label: 'Amateur', detail: 'Relaxed pressure · room to dribble', skill: 0.45, decision: 0.46, reaction: 0.36, tackleCooldown: 1.15, tackleRate: 0.5, tackleSuccess: 0.68, markingGap: 0.95, positionError: 1.1, kickError: 2.1, keeper: 0.88 },
  pro: { label: 'Professional', detail: 'Balanced pressure · alert defenders', skill: 0.78, decision: 0.24, reaction: 0.2, tackleCooldown: 0.72, tackleRate: 0.9, tackleSuccess: 1, markingGap: 0.3, positionError: 0.5, kickError: 1, keeper: 1 },
  world: { label: 'World Class', detail: 'Tight marking · quick combinations', skill: 0.9, decision: 0.14, reaction: 0.13, tackleCooldown: 0.55, tackleRate: 1.15, tackleSuccess: 1.04, markingGap: 0.08, positionError: 0.2, kickError: 1.0, keeper: 1.04 },
  legendary: { label: 'Legendary', detail: 'Fast reads · relentless pressure', skill: 1, decision: 0.09, reaction: 0.09, tackleCooldown: 0.42, tackleRate: 1.4, tackleSuccess: 1.08, markingGap: 0, positionError: 0.08, kickError: 0.85, keeper: 1.08 },
};

export function cpuProfile(level: CpuLevel): CpuProfile {
  return CPU_PROFILE[level] ?? CPU_PROFILE.pro;
}
