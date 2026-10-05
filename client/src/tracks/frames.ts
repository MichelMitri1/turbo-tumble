import { Matrix4, Quaternion, Vector3 } from 'three';
import type { TrackSample } from '@shared/track/TrackPath';

const basis = new Matrix4();
const left = new Vector3();
const up = new Vector3(0, 1, 0);

/**
 * Orientation whose local +Z follows the track tangent and +Y is up
 * (+X then points to the driver's left — a proper right-handed rotation).
 */
export function sampleQuaternion(s: TrackSample, banked: boolean, out = new Quaternion()): Quaternion {
  left.copy(banked ? s.right : s.flatRight).negate();
  const u = banked ? s.up : up;
  const fwd = new Vector3().crossVectors(left, u).normalize();
  basis.makeBasis(left, u, fwd);
  return out.setFromRotationMatrix(basis);
}

/** Yaw (radians) that turns local +Z towards a horizontal direction. */
export function yawTowards(dir: Vector3): number {
  return Math.atan2(dir.x, dir.z);
}
