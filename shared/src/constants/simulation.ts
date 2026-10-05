/** Fixed simulation rate shared by client prediction and (later) the authoritative server. */
export const TICK_RATE = 60;
export const FIXED_DT = 1 / TICK_RATE;
/** Max fixed steps per rendered frame before we drop time (prevents spiral of death). */
export const MAX_STEPS_PER_FRAME = 5;

/** Arcade gravity — heavier than real life so jumps feel snappy. */
export const GRAVITY = 32;

/** Below this world Y a kart is considered lost and gets respawned. */
export const KILL_PLANE_Y = -40;

export const MAX_LOCAL_PLAYERS = 4;
export const MAX_RACERS = 12;
