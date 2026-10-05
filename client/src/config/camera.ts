/**
 * Chase camera tuning. Framing target (from the reference screenshot): camera
 * directly behind and above the kart, looking slightly down the road; kart sits in
 * the lower-centre of the frame and the road ahead fills most of the view.
 */
export interface ChaseCameraTuning {
  /** Horizontal distance behind the kart (m). */
  distance: number;
  /** Extra distance at top speed (pull-back sells speed). */
  speedDistance: number;
  /** Height above the kart contact point (m). */
  height: number;
  /** Look target: metres ahead of the kart... */
  lookAhead: number;
  /** ...and metres above the ground. */
  lookHeight: number;
  /** Vertical FOV at rest (deg). */
  fov: number;
  /** Extra FOV at top speed (deg). */
  speedFov: number;
  /** Extra FOV while boosting (deg). */
  boostFov: number;
  /** Heading follow rate (1/s) — lower = more swing/lag in turns. */
  yawFollow: number;
  /** Positional follow rate (1/s). */
  positionFollow: number;
  /** Vertical follow rate on the ground / in the air (1/s). */
  heightFollowGround: number;
  heightFollowAir: number;
  /** How much road slope tilts the camera (0..1). */
  slopeInfluence: number;
  /** Minimum clearance above terrain / road (m). */
  groundClearance: number;
}

export const CHASE_CAMERA: ChaseCameraTuning = {
  distance: 7.7,
  speedDistance: 0.9,
  height: 4.7,
  lookAhead: 9,
  lookHeight: 2.1,
  fov: 58,
  speedFov: 9,
  boostFov: 10,
  yawFollow: 5.5,
  positionFollow: 16,
  heightFollowGround: 9,
  heightFollowAir: 3.2,
  slopeInfluence: 0.7,
  groundClearance: 1.0,
};

/**
 * Split-screen framing per viewport shape: very wide (2P stacked) narrows the FOV,
 * tall/narrow (2P side by side) widens it and pulls back, quadrants sit in between.
 */
export function tuningForViewport(aspect: number, playerCount: number): ChaseCameraTuning {
  if (playerCount <= 1) return CHASE_CAMERA;
  if (aspect > 2.2) return { ...CHASE_CAMERA, fov: 50, distance: CHASE_CAMERA.distance - 0.4 };
  if (aspect < 1.3) return { ...CHASE_CAMERA, fov: 72, distance: CHASE_CAMERA.distance + 0.8, height: CHASE_CAMERA.height + 0.3 };
  return { ...CHASE_CAMERA, fov: 62, distance: CHASE_CAMERA.distance - 0.4 };
}
