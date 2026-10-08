/** Engine classes: scale every racer's top speed and acceleration (150cc is the tuned baseline). */
export type SpeedClass = 50 | 100 | 150 | 200;

export const SPEED_CLASSES: readonly SpeedClass[] = [50, 100, 150, 200];

export const SPEED_CLASS_SCALE: Record<SpeedClass, { speed: number; accel: number }> = {
  50: { speed: 0.8, accel: 0.86 },
  100: { speed: 0.9, accel: 0.93 },
  150: { speed: 1, accel: 1 },
  200: { speed: 1.16, accel: 1.12 },
};

export function speedClassScale(cc: number | undefined): { speed: number; accel: number } {
  return SPEED_CLASS_SCALE[(cc ?? 150) as SpeedClass] ?? SPEED_CLASS_SCALE[150];
}
