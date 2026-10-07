import * as THREE from 'three';
import { World, type WorldEvent } from './sim/world';
import { TICK } from './sim/constants';
import { readSnapshot, writeSnapshot } from './sim/snapshot';
import { ARENA } from './sim/arena';
import { savePrev } from './session';
import type { Pose } from './render/scene';

/** Snapshot phase codes (see snapshot.ts). */
const PHASE_PLAY = 1;
const PHASE_GOAL = 2;
const KEEP_TICKS = 16 / TICK;
/** Events worth re-showing in a replay. */
const REPLAY_EVENTS = new Set<WorldEvent['k']>(['touch', 'bounce', 'goal', 'demo', 'jump', 'dodge', 'pad']);

interface Frame {
  snap: Float32Array;
  events: WorldEvent[];
}

/**
 * Keeps the last ~16 s of the match, one full snapshot per tick. Re-simulated
 * ticks (online rollback) simply overwrite their earlier version.
 */
export class ReplayRecorder {
  readonly frames = new Map<number, Frame>();
  latest = 0;

  record(world: World, events: WorldEvent[]): void {
    const t = world.tickCount;
    this.frames.set(t, { snap: writeSnapshot(world), events: events.filter((e) => REPLAY_EVENTS.has(e.k)) });
    if (t > this.latest) this.latest = t;
    // Ticks past `t` belong to a rolled-back future.
    for (let k = t + 1; k <= this.latest; k++) this.frames.delete(k);
    this.latest = t;
    if (t % 120 === 0) for (const k of this.frames.keys()) if (k < t - KEEP_TICKS) this.frames.delete(k);
  }

  clear(): void {
    this.frames.clear();
    this.latest = 0;
  }

  /** First tick of the most recent goal phase, or -1. */
  goalTick(): number {
    let t = this.latest;
    while (t > 0 && this.frames.get(t)?.snap[3] !== PHASE_GOAL) t--;
    if (t <= 0) return -1;
    while (this.frames.get(t - 1)?.snap[3] === PHASE_GOAL) t--;
    return t;
  }
}

export type Shot = { kind: 'chase'; car: number } | { kind: 'fixed'; pos: THREE.Vector3 };

/**
 * Plays a goal back from a recorder: its own World is driven from the recorded
 * snapshots (interpolated, with slow motion around the goal), and a director
 * picks the camera: chase the scorer, then a stadium shot of the finish.
 */
export class GoalReplay {
  readonly world: World;
  readonly prev = new Map<number, Pose>();
  readonly prevBall = new THREE.Vector3();
  alpha = 0;
  done = false;
  private t = 0;
  private lastTick: number;
  private readonly startTick: number;
  /** Seconds of play before the goal. */
  private readonly preGoal: number;
  private readonly finishShot: THREE.Vector3;

  constructor(
    private readonly rec: ReplayRecorder,
    source: World,
    goalTick: number,
    seconds: number,
    readonly scorer: number,
  ) {
    this.world = new World(
      source.players.map((p) => ({ ...p })),
      source.matchLength,
      1,
      false,
      source.rules,
    );
    this.world.events.length = 0;
    // Start `seconds` before the goal, but never before this play's kickoff.
    let start = goalTick - 1;
    const want = goalTick - Math.round(seconds / TICK);
    while (start > want && rec.frames.get(start - 1)?.snap[3] === PHASE_PLAY) start--;
    this.startTick = start;
    this.lastTick = start;
    this.preGoal = (goalTick - start) * TICK;
    // Finish shot: from beside the post, low in the net, or high above the box.
    const goal = rec.frames.get(goalTick)!.snap;
    const g = Math.sign(goal[13]!) || 1;
    const side = Math.random() < 0.5 ? -1 : 1;
    const options = [new THREE.Vector3(side * 1900, g * 4300, 420), new THREE.Vector3(side * 500, g * (ARENA.halfY + 700), 260), new THREE.Vector3(side * 2600, g * 2600, 1500)];
    this.finishShot = options[Math.floor(Math.random() * options.length)]!;
    this.seek();
  }

  /** Playback rate: slow motion just before and after the ball crosses the line. */
  private rate(): number {
    const d = this.t - this.preGoal;
    return d > -0.55 && d < 0.35 ? 0.4 : 1;
  }

  /** Advance by real time; returns events crossed (touches, bounces, the goal…). */
  update(dt: number): WorldEvent[] {
    if (this.done) return [];
    this.t += dt * this.rate();
    if (this.t >= this.preGoal + 1.6) this.done = true;
    return this.seek();
  }

  private frame(tick: number): Frame | undefined {
    for (let k = tick; k >= this.startTick; k--) {
      const f = this.rec.frames.get(k);
      if (f) return f;
    }
    return this.rec.frames.get(this.startTick);
  }

  private seek(): WorldEvent[] {
    const f = this.startTick + this.t / TICK;
    const i = Math.floor(f);
    const a = this.frame(i);
    const b = this.frame(i + 1) ?? a;
    if (!a || !b) {
      this.done = true;
      return [];
    }
    readSnapshot(this.world, a.snap);
    savePrev(this.world, this.prev, this.prevBall);
    readSnapshot(this.world, b.snap);
    // Wheel contacts aren't in snapshots: re-cast them so the suspension renders.
    for (const c of this.world.cars) if (!c.demolished) c.updateWheels();
    this.alpha = f - i;
    const out: WorldEvent[] = [];
    for (let k = this.lastTick + 1; k <= i + 1; k++) out.push(...(this.rec.frames.get(k)?.events ?? []));
    this.lastTick = Math.max(this.lastTick, i + 1);
    return out;
  }

  /** Which camera to use now. */
  shot(): Shot {
    const car = this.world.car(this.scorer);
    if (car && !car.demolished && this.t < this.preGoal - 1.4) return { kind: 'chase', car: this.scorer };
    return { kind: 'fixed', pos: this.finishShot };
  }

  /** Seconds left (real time, roughly). */
  get remaining(): number {
    return Math.max(0, this.preGoal + 1.6 - this.t);
  }
}
