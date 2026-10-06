/**
 * Rocket League physics constants (Unreal units / seconds), from RocketSim's
 * RLConst.h and the RLBot "useful game values" — see tools notes in the README.
 */
export const TICK = 1 / 120;
export const GRAVITY = -650;

export const CAR_MASS = 180;
export const BALL_MASS = 30;
export const BALL_RADIUS = 91.25;
/** World collision radius (Bullet margin) — the ball rests at z = 93.15. */
export const BALL_WORLD_RADIUS = 93.15;
export const BALL_MAX_SPEED = 6000;
export const BALL_MAX_ANG = 6;
export const BALL_DRAG = 0.03;
export const BALL_RESTITUTION = 0.6;
export const BALL_FRICTION = 0.35;

export const CAR_MAX_SPEED = 2300;
export const CAR_MAX_ANG = 5.5;
export const SUPERSONIC_START = 2200;
export const SUPERSONIC_MAINTAIN = 2100;
export const SUPERSONIC_MAINTAIN_TIME = 1;

export const BOOST_MAX = 100;
export const BOOST_PER_SECOND = 100 / 3;
export const BOOST_MIN_TIME = 0.1;
export const BOOST_ACCEL_GROUND = 2975 / 3;
export const BOOST_ACCEL_AIR = 3175 / 3;
export const BOOST_SPAWN = 100 / 3;

export const THROTTLE_ACCEL = 1600;
export const BRAKE_ACCEL = 3500;
export const COAST_BRAKE_FACTOR = 0.15;
export const STOPPING_SPEED = 25;
export const THROTTLE_AIR_ACCEL = 200 / 3;

export const POWERSLIDE_RISE = 5;
export const POWERSLIDE_FALL = 2;

export const JUMP_ACCEL = 4375 / 3;
export const JUMP_IMPULSE = 875 / 3;
export const JUMP_MIN_TIME = 0.025;
export const JUMP_MAX_TIME = 0.2;
export const DOUBLEJUMP_MAX_DELAY = 1.25;
export const DODGE_DEADZONE = 0.5;

export const FLIP_Z_DAMP_120 = 0.35;
export const FLIP_Z_DAMP_START = 0.15;
export const FLIP_Z_DAMP_END = 0.21;
export const FLIP_TORQUE_TIME = 0.65;
export const FLIP_PITCHLOCK_EXTRA = 0.3;
export const FLIP_INITIAL_VEL = 500;
export const FLIP_TORQUE_X = 260; // roll (side flips)
export const FLIP_TORQUE_Y = 224; // pitch (front/back flips)
export const FLIP_FORWARD_SCALE = 1;
export const FLIP_SIDE_SCALE = 1.9;
export const FLIP_BACKWARD_SCALE = 2.5;
export const FLIP_BACKWARD_X = 16 / 15;

/** Air control: torque (pitch, yaw, roll) and damping, times the torque scale. */
export const TORQUE_SCALE = ((2 * Math.PI) / 65536) * 1000;
export const AIR_TORQUE = { pitch: 130, yaw: 95, roll: 400 };
export const AIR_DAMPING = { pitch: 30, yaw: 20, roll: 50 };

export const AUTOFLIP_IMPULSE = 200;
export const AUTOFLIP_TORQUE = 50;
export const AUTOFLIP_TIME = 0.4;
export const AUTOROLL_FORCE = 100;
export const AUTOROLL_TORQUE = 80;

export const BALL_EXTRA_Z_SCALE = 0.35;
export const BALL_EXTRA_FORWARD_SCALE = 0.65;
export const BALL_EXTRA_MAX_DV = 4600;
export const CARBALL_FRICTION = 2;
export const CARWORLD_RESTITUTION = 0.3;
export const CARWORLD_FRICTION = 0.3;
export const CARCAR_RESTITUTION = 0.1;

export const BUMP_COOLDOWN = 0.25;
export const DEMO_RESPAWN = 3;

/** Linear piecewise curve. */
export function curve(points: ReadonlyArray<readonly [number, number]>, x: number): number {
  if (x <= points[0]![0]) return points[0]![1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i]!;
    if (x <= x1) {
      const [x0, y0] = points[i - 1]!;
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return points[points.length - 1]![1];
}

export const STEER_ANGLE_CURVE = [[0, 0.53356], [500, 0.3193], [1000, 0.18203], [1500, 0.1057], [1750, 0.08507], [3000, 0.03454]] as const;
export const POWERSLIDE_STEER_CURVE = [[0, 0.39235], [2500, 0.1261]] as const;
export const DRIVE_TORQUE_CURVE = [[0, 1], [1400, 0.1], [1410, 0]] as const;
export const LAT_FRICTION_CURVE = [[0, 1], [1, 0.2]] as const;
export const NON_STICKY_FRICTION_CURVE = [[0, 0.1], [0.7075, 0.5], [1, 1]] as const;
export const HANDBRAKE_LONG_CURVE = [[0, 0.5], [1, 0.9]] as const;
export const BALL_EXTRA_CURVE = [[0, 0.65], [500, 0.65], [2300, 0.55], [4600, 0.3]] as const;
export const BUMP_GROUND_CURVE = [[0, 5 / 6], [1400, 1100], [2200, 1530]] as const;
export const BUMP_AIR_CURVE = [[0, 5 / 6], [1400, 1390], [2200, 1945]] as const;
export const BUMP_UP_CURVE = [[0, 2 / 6], [1400, 278], [2200, 417]] as const;

/** Car bodies: hitbox (size, offset) and wheels, from RocketSim's CarConfig. */
export interface CarBody {
  id: 'octane' | 'dominus' | 'breakout';
  name: string;
  hitbox: [number, number, number];
  offset: [number, number, number];
  front: { radius: number; rest: number; offset: [number, number, number] };
  back: { radius: number; rest: number; offset: [number, number, number] };
  model: string;
}

export const BODIES: Record<CarBody['id'], CarBody> = {
  octane: { id: 'octane', name: 'Octane', hitbox: [120.507, 86.6994, 38.6591], offset: [13.8757, 0, 20.755], front: { radius: 12.5, rest: 38.755, offset: [51.25, 25.9, 20.755] }, back: { radius: 15, rest: 37.055, offset: [-33.75, 29.5, 20.755] }, model: 'hatchback-sports' },
  dominus: { id: 'dominus', name: 'Dominus', hitbox: [130.427, 85.7799, 33.8], offset: [9, 0, 15.75], front: { radius: 12, rest: 33.95, offset: [50.3, 31.1, 15.75] }, back: { radius: 13.5, rest: 33.85, offset: [-34.75, 33, 15.75] }, model: 'sedan-sports' },
  breakout: { id: 'breakout', name: 'Breakout', hitbox: [133.992, 83.021, 32.8], offset: [12.5, 0, 11.75], front: { radius: 13.5, rest: 29.7, offset: [51.5, 26.67, 11.75] }, back: { radius: 15, rest: 29.666, offset: [-35.75, 35, 11.75] }, model: 'race-future' },
};

export const CAR_REST_Z = 17;

export const BOOST_PADS: Array<{ x: number; y: number; big: boolean }> = [
  ...[
    [0, -4240], [-1792, -4184], [1792, -4184], [-940, -3308], [940, -3308], [0, -2816], [-3584, -2484], [3584, -2484], [-1788, -2300], [1788, -2300],
    [-2048, -1036], [0, -1024], [2048, -1036], [-1024, 0], [1024, 0], [-2048, 1036], [0, 1024], [2048, 1036], [-1788, 2300], [1788, 2300],
    [-3584, 2484], [3584, 2484], [0, 2816], [-940, 3308], [940, 3308], [-1792, 4184], [1792, 4184], [0, 4240],
  ].map(([x, y]) => ({ x: x!, y: y!, big: false })),
  ...[[-3584, 0], [3584, 0], [-3072, 4096], [3072, 4096], [-3072, -4096], [3072, -4096]].map(([x, y]) => ({ x: x!, y: y!, big: true })),
];
export const PAD_RADIUS_SMALL = 144;
export const PAD_RADIUS_BIG = 208;
export const PAD_HEIGHT = 165;
export const PAD_COOLDOWN_SMALL = 4;
export const PAD_COOLDOWN_BIG = 10;

/** Kickoff spawns for blue (orange is mirrored): x, y, yaw. */
export const KICKOFF_SPAWNS: Array<[number, number, number]> = [
  [-2048, -2560, Math.PI / 4],
  [2048, -2560, (3 * Math.PI) / 4],
  [-256, -3840, Math.PI / 2],
  [256, -3840, Math.PI / 2],
  [0, -4608, Math.PI / 2],
];
export const RESPAWNS: Array<[number, number, number]> = [
  [-2304, -4608, Math.PI / 2],
  [-2688, -4608, Math.PI / 2],
  [2304, -4608, Math.PI / 2],
  [2688, -4608, Math.PI / 2],
];
