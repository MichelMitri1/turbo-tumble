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
  /** 0..1 — drift usage. */
  driftSkill: number;
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
  easy: { label: 'Easy', speedMul: 0.86, lineFollow: 0.35, laneWander: 3.2, driftSkill: 0.15, itemSkill: 0.2, itemDelay: 2.5, steerGain: 0.8, overtakes: false },
  normal: { label: 'Normal', speedMul: 0.94, lineFollow: 0.7, laneWander: 2.0, driftSkill: 0.6, itemSkill: 0.6, itemDelay: 1.2, steerGain: 1, overtakes: true },
  hard: { label: 'Hard', speedMul: 1.0, lineFollow: 0.92, laneWander: 1.0, driftSkill: 1, itemSkill: 1, itemDelay: 0.4, steerGain: 1.1, overtakes: true },
};

/**
 * Gentle pack balancing (deliberately not "rubber-banding"): CPUs far ahead of every
 * human ease off a few percent; CPUs hopelessly behind get a small lift.
 */
export function catchUpMultiplier(gapToBestHuman: number): number {
  if (gapToBestHuman > 160) return 0.95;
  if (gapToBestHuman > 90) return 0.98;
  if (gapToBestHuman < -260) return 1.06;
  if (gapToBestHuman < -160) return 1.03;
  return 1;
}
