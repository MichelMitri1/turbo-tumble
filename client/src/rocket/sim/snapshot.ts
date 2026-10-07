import type { Car, Controls } from './car';
import type { World, Phase } from './world';

/**
 * Full world state packed into a Float32Array (≈1 KB for 6 cars), so a client
 * can rewind to a server tick and re-simulate (rollback netcode, like the real game).
 */
const PHASES: Phase[] = ['countdown', 'play', 'goal', 'over'];
const CAR_FLOATS = 38;
const HEAD = 12;
const BALL = 13;

const BOOLS = ['isJumping', 'hasJumped', 'hasDoubleJumped', 'hasFlipped', 'isFlipping', 'isAutoFlipping', 'isBoosting', 'supersonic', 'demolished', 'lastJump', 'worldContact'] as const;
const NUMS = ['boost', 'jumpTime', 'flipTime', 'airTime', 'airTimeSinceJump', 'autoFlipTimer', 'autoFlipDir', 'boostingTime', 'handbrakeVal', 'supersonicTime', 'respawnTimer', 'bumpCooldown'] as const;

export function packControls(c: Controls): number[] {
  return [c.throttle, c.steer, c.pitch, c.yaw, c.roll, (c.jump ? 1 : 0) | (c.boost ? 2 : 0) | (c.handbrake ? 4 : 0)];
}
export function unpackControls(a: ArrayLike<number>, o = 0, out?: Controls): Controls {
  const f = a[o + 5]!;
  const c = out ?? ({} as Controls);
  c.throttle = a[o]!;
  c.steer = a[o + 1]!;
  c.pitch = a[o + 2]!;
  c.yaw = a[o + 3]!;
  c.roll = a[o + 4]!;
  c.jump = (f & 1) !== 0;
  c.boost = (f & 2) !== 0;
  c.handbrake = (f & 4) !== 0;
  return c;
}

function writeCar(car: Car, a: Float32Array, o: number): void {
  a[o++] = car.id;
  for (const v of [car.pos, car.vel, car.angVel]) {
    a[o++] = v.x;
    a[o++] = v.y;
    a[o++] = v.z;
  }
  a[o++] = car.quat.x;
  a[o++] = car.quat.y;
  a[o++] = car.quat.z;
  a[o++] = car.quat.w;
  let bits = 0;
  BOOLS.forEach((k, i) => (bits |= car[k] ? 1 << i : 0));
  a[o++] = bits;
  for (const k of NUMS) a[o++] = car[k];
  a[o++] = car.dodge.x;
  a[o++] = car.dodge.y;
  const n = car.worldContactNormal;
  a[o++] = n.x;
  a[o++] = n.y;
  a[o++] = n.z;
  for (const v of packControls(car.controls)) a[o++] = v;
}

function readCar(car: Car, a: Float32Array, o: number): void {
  o++;
  car.pos.set(a[o]!, a[o + 1]!, a[o + 2]!);
  car.vel.set(a[o + 3]!, a[o + 4]!, a[o + 5]!);
  car.angVel.set(a[o + 6]!, a[o + 7]!, a[o + 8]!);
  car.quat.set(a[o + 9]!, a[o + 10]!, a[o + 11]!, a[o + 12]!).normalize();
  o += 13;
  const bits = a[o++]!;
  BOOLS.forEach((k, i) => ((car as unknown as Record<string, boolean>)[k] = (bits & (1 << i)) !== 0));
  for (const k of NUMS) (car as unknown as Record<string, number>)[k] = a[o++]!;
  car.dodge.x = a[o++]!;
  car.dodge.y = a[o++]!;
  car.worldContactNormal.set(a[o]!, a[o + 1]!, a[o + 2]!);
  o += 3;
  unpackControls(a, o, car.controls);
  car.updateBasis();
}

export function snapshotSize(world: World): number {
  return HEAD + BALL + world.pads.length + world.cars.length * CAR_FLOATS;
}

/** Serialize the world at its current tick. */
export function writeSnapshot(w: World, out?: Float32Array): Float32Array {
  const a = out && out.length === snapshotSize(w) ? out : new Float32Array(snapshotSize(w));
  let o = 0;
  a[o++] = w.tickCount;
  a[o++] = w.score[0];
  a[o++] = w.score[1];
  a[o++] = PHASES.indexOf(w.phase);
  a[o++] = w.phaseTimer;
  a[o++] = w.clock;
  a[o++] = w.overtime ? 1 : 0;
  a[o++] = w.winner;
  a[o++] = w.cars.length;
  a[o++] = w.ball.lastTouchTeam;
  a[o++] = w.lastCountdownN;
  a[o++] = w.rng & 0xffff;
  const b = w.ball;
  for (const v of [b.pos, b.vel, b.angVel]) {
    a[o++] = v.x;
    a[o++] = v.y;
    a[o++] = v.z;
  }
  a[o++] = b.lastTouch;
  a[o++] = w.rng >>> 16;
  a[o++] = 0;
  a[o++] = 0;
  for (const p of w.pads) a[o++] = p.timer;
  for (const c of w.cars) {
    writeCar(c, a, o);
    o += CAR_FLOATS;
  }
  return a;
}

/** Restore a world from a snapshot (same players). */
export function readSnapshot(w: World, a: Float32Array): void {
  let o = 0;
  w.tickCount = a[o++]!;
  w.score = [a[o++]!, a[o++]!];
  w.phase = PHASES[a[o++]!] ?? 'play';
  w.phaseTimer = a[o++]!;
  w.clock = a[o++]!;
  w.overtime = a[o++] === 1;
  w.winner = a[o++] as 0 | 1 | -1;
  const n = a[o++]!;
  w.ball.lastTouchTeam = a[o++] as 0 | 1 | -1;
  w.lastCountdownN = a[o++]!;
  const rngLo = a[o++]!;
  const b = w.ball;
  b.pos.set(a[o]!, a[o + 1]!, a[o + 2]!);
  b.vel.set(a[o + 3]!, a[o + 4]!, a[o + 5]!);
  b.angVel.set(a[o + 6]!, a[o + 7]!, a[o + 8]!);
  o += 9;
  b.lastTouch = a[o]!;
  w.rng = ((a[o + 1]! << 16) | rngLo) >>> 0;
  o += 4;
  for (const p of w.pads) p.timer = a[o++]!;
  for (let i = 0; i < n; i++) {
    const id = a[o]!;
    const car = w.car(id);
    if (car) readCar(car, a, o);
    o += CAR_FLOATS;
  }
}

/** Tick number stored in a snapshot. */
export const snapshotTick = (a: Float32Array): number => a[0]!;
/** The last controls a car used, from a snapshot (for predicting other players). */
export function snapshotControls(w: World, a: Float32Array, out: Map<number, Controls>): void {
  let o = HEAD + BALL + w.pads.length;
  const n = a[8]!;
  for (let i = 0; i < n; i++) {
    out.set(a[o]!, unpackControls(a, o + CAR_FLOATS - 6));
    o += CAR_FLOATS;
  }
}
