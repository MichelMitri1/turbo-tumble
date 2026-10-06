export type Difficulty = 'easy' | 'normal' | 'hard';

export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];

export interface DifficultyProfile {
  label: string;
  /** Multiplier on the CPU kart's top speed. */
  speedMul: number;
  /** 0..1 — how closely CPUs hold the racing line (vs. a wandering personal lane). */
  lineFollow: number;
  /** Amplitude of lane wander (m). */
  laneWander: number;
  /** 0..1 — drift usage (mini-turbo charging, shortcut taking). */
  driftSkill: number;
  /** Only corners tighter than this radius (m) are drifted; wider ones are driven. */
  driftRadius: number;
  /** Multiplier on the racing line's corner speeds (braking later / carrying more speed). */
  cornerPace: number;
  /** 0..1 — item timing and tactics. */
  itemSkill: number;
  /** Extra delay before using a fresh item (s). */
  itemDelay: number;
  /** Steering precision (pursuit gain multiplier). */
  steerGain: number;
  /** Whether CPUs actively steer around karts ahead. */
  overtakes: boolean;
}

export const DIFFICULTY: Record<Difficulty, DifficultyProfile> = {
  easy: { label: 'Easy', speedMul: 0.9, lineFollow: 0.45, laneWander: 2.8, driftSkill: 0.2, driftRadius: 30, cornerPace: 1.05, itemSkill: 0.3, itemDelay: 2, steerGain: 0.9, overtakes: false },
  normal: { label: 'Normal', speedMul: 1.0, lineFollow: 0.85, laneWander: 1.3, driftSkill: 0.75, driftRadius: 34, cornerPace: 1.25, itemSkill: 0.75, itemDelay: 0.7, steerGain: 1.1, overtakes: true },
  hard: { label: 'Hard', speedMul: 1.06, lineFollow: 1, laneWander: 0.4, driftSkill: 1, driftRadius: 34, cornerPace: 1.4, itemSkill: 1, itemDelay: 0.15, steerGain: 1.25, overtakes: true },
};

/**
 * Pack balancing against the best human (gap in metres, + = CPU ahead). CPUs that
 * fall behind get pulled back into the fight — strongly on Hard, so a lead is never
 * safe; CPUs far ahead ease off a little (barely on Hard) so they stay catchable.
 */
export function catchUpMultiplier(gapToBestHuman: number, difficulty: Difficulty = 'normal'): number {
  const g = gapToBestHuman;
  if (difficulty === 'hard') {
    if (g < -200) return 1.14;
    if (g < -100) return 1.09;
    if (g < -30) return 1.04;
    if (g > 200) return 0.98;
    return 1;
  }
  if (difficulty === 'normal') {
    if (g < -220) return 1.08;
    if (g < -110) return 1.04;
    if (g > 160) return 0.95;
    if (g > 90) return 0.98;
    return 1;
  }
  if (g < -260) return 1.06;
  if (g < -160) return 1.03;
  if (g > 120) return 0.93;
  if (g > 60) return 0.97;
  return 1;
}
