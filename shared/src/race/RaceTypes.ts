import type { Vector3 } from 'three';
import type { ItemId } from '../items/ItemTypes';
import type { PlayerInput } from '../types/input';
import type { KartState, HitKind } from '../vehicles/KartState';
import type { KartSimulation } from '../vehicles/KartSimulation';
import type { TrackPath } from '../track/TrackPath';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { SeededRandom } from '../math/random';

/** A racer's item slot. */
export interface ItemSlot {
  item: ItemId | null;
  uses: number;
  /** Seconds of roulette left; the rolled item is revealed when this reaches 0. */
  roulette: number;
  pending: ItemId | null;
  /** Entity held behind the kart (hold-style items), or -1. */
  heldEntity: number;
  /** Entities orbiting / trailing the kart (deploy-style items). */
  orbit: number[];
  /** Seconds left on an active timed item (Golden Fizz, Ember Blaster, Snapper Pot). */
  timer: number;
  timedItem: ItemId | null;
  /** Remaining Octo Orbit items. */
  octo: ItemId[];
  /** Item button state last tick (edge detection). */
  pressed: boolean;
  cooldown: number;
  /** Second slot (double item slot): moves up when the front item is used up. */
  reserve: ItemId | null;
  /** Roulette for the second slot (a box hit while the front slot is busy). */
  reserveRoulette: number;
  reservePending: ItemId | null;
}

export interface RacerProgress {
  /** 0 = on the grid before the first crossing; laps > total means finished. */
  lap: number;
  /** Next checkpoint index to pass (1..N-1), N = must cross the line. */
  nextCheckpoint: number;
  /** Distance along the lap (0 at the line). */
  lapDistance: number;
  /** Monotonic race progress in metres (lap-gated). */
  total: number;
  position: number;
  finished: boolean;
  finishTime: number;
  lapStartTime: number;
  lapTimes: number[];
  bestLap: number;
  wrongWayTime: number;
  wrongWay: boolean;
}

export interface Racer {
  index: number;
  id: string;
  name: string;
  characterId: string;
  kartId: string;
  isAI: boolean;
  state: KartState;
  sim: KartSimulation;
  progress: RacerProgress;
  slot: ItemSlot;
  /** The input actually applied this tick (after AI / autopilot). */
  input: PlayerInput;
  /** Countdown: seconds before GO when the throttle went down (-1 = not held). */
  startPress: number;
}

type V3 = [number, number, number];

export type RaceEvent =
  | { type: 'countdown'; value: number }
  | { type: 'go' }
  | { type: 'rocketStart'; racer: number; good: boolean }
  | { type: 'itemBox'; racer: number; position: V3 }
  | { type: 'itemReady'; racer: number; item: ItemId }
  | { type: 'itemUse'; racer: number; item: ItemId }
  | { type: 'hit'; racer: number; kind: HitKind; by: number; source: string }
  | { type: 'blocked'; racer: number; position: V3 }
  | { type: 'explosion'; position: V3; radius: number; owner: number }
  | { type: 'shockwave'; racer: number; position: V3; radius: number }
  | { type: 'zap'; racer: number }
  | { type: 'paint'; racer: number; by: number }
  | { type: 'quakePulse'; racer: number; pulse: number }
  | { type: 'coin'; racer: number; total: number; position: V3 }
  | { type: 'boostPad'; racer: number }
  | { type: 'slipstream'; racer: number }
  | { type: 'jump'; racer: number }
  | { type: 'chomp'; racer: number; position: V3 }
  | { type: 'steal'; racer: number; from: number; item: ItemId }
  | { type: 'entityGone'; kind: string; position: V3 }
  | { type: 'bump'; a: number; b: number; impact: number; position: V3 }
  | { type: 'lap'; racer: number; lap: number; lapTime: number }
  | { type: 'finish'; racer: number; position: number; time: number };

/** What item logic needs from the race (implemented by RaceSimulation). */
export interface RaceContext {
  readonly racers: Racer[];
  readonly track: TrackPath;
  readonly physics: PhysicsWorld;
  readonly rng: SeededRandom;
  readonly time: number;
  emit(e: RaceEvent): void;
  /** Racers sorted by current position (index 0 = leader). */
  standings(): Racer[];
}

export function v3(v: Vector3): V3 {
  return [v.x, v.y, v.z];
}

export function createItemSlot(): ItemSlot {
  return { item: null, uses: 0, roulette: 0, pending: null, heldEntity: -1, orbit: [], timer: 0, timedItem: null, octo: [], pressed: false, cooldown: 0, reserve: null, reserveRoulette: 0, reservePending: null };
}

export function createProgress(): RacerProgress {
  return {
    lap: 0,
    nextCheckpoint: Number.MAX_SAFE_INTEGER,
    lapDistance: 0,
    total: 0,
    position: 1,
    finished: false,
    finishTime: 0,
    lapStartTime: 0,
    lapTimes: [],
    bestLap: 0,
    wrongWayTime: 0,
    wrongWay: false,
  };
}
