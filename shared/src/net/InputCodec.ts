import { clamp } from '../math/scalar';
import type { PlayerInput } from '../types/input';

/**
 * One seat's input for one tick packed into a single integer:
 * throttle (8 bits) | brake (8) | steer (8, 0..254 ↔ -1..1) | drift, item, reset flags.
 * The client predicts with the *decoded* value so client and server simulate
 * bit-identical inputs.
 */
const DRIFT = 1;
const ITEM = 2;
const RESET = 4;

export function packInput(input: PlayerInput, reset: boolean): number {
  const t = Math.round(clamp(input.throttle, 0, 1) * 255);
  const b = Math.round(clamp(input.brake, 0, 1) * 255);
  const s = Math.round((clamp(input.steer, -1, 1) + 1) * 127);
  const f = (input.drift ? DRIFT : 0) | (input.item ? ITEM : 0) | (reset ? RESET : 0);
  return (t | (b << 8) | (s << 16) | (f << 24)) >>> 0;
}

/** Decode into `out`; returns the reset flag. */
export function unpackInput(packed: number, out: PlayerInput): boolean {
  const n = packed >>> 0;
  out.throttle = (n & 0xff) / 255;
  out.brake = ((n >>> 8) & 0xff) / 255;
  out.steer = ((n >>> 16) & 0xff) / 127 - 1;
  const f = (n >>> 24) & 0xff;
  out.drift = (f & DRIFT) !== 0;
  out.item = (f & ITEM) !== 0;
  return (f & RESET) !== 0;
}
