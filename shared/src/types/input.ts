/**
 * One player's normalized input for a single simulation tick.
 * Devices (keyboard / gamepad / network) all reduce to this shape so the
 * simulation never knows where input came from.
 */
export interface PlayerInput {
  /** 0..1 */
  throttle: number;
  /** 0..1 — brake while moving forward, reverse when (nearly) stopped */
  brake: number;
  /** -1 (left) .. 1 (right) */
  steer: number;
  /** Hop / drift button held */
  drift: boolean;
  /** Use item held */
  item: boolean;
}

export function createEmptyInput(): PlayerInput {
  return { throttle: 0, brake: 0, steer: 0, drift: false, item: false };
}

export function copyInput(src: PlayerInput, dst: PlayerInput): PlayerInput {
  dst.throttle = src.throttle;
  dst.brake = src.brake;
  dst.steer = src.steer;
  dst.drift = src.drift;
  dst.item = src.item;
  return dst;
}
