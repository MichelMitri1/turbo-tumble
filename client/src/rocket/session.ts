import * as THREE from 'three';
import { World, type PlayerInfo, type WorldEvent } from './sim/world';
import { Bots, BOT_NAMES, type BotLevel } from './sim/bot';
import { NO_CONTROLS, type Controls } from './sim/car';
import { CAR_IDS, TICK } from './sim/constants';
import type { Rules } from './sim/rules';
import { packControls, readSnapshot, snapshotControls } from './sim/snapshot';
import type { Pose } from './render/scene';
import { toThree } from './render/arenaMesh';
import { toThreeQuat } from './render/entities';
import type { RbBegin } from './net/protocol';
import type { RocketNet } from './net/online';
import type { CarView } from './render/entities';
import { ReplayRecorder } from './replay';

/** What the game screen drives: a local match vs bots, or an online match. */
export interface Session {
  readonly world: World;
  readonly myId: number;
  readonly online: boolean;
  readonly prev: Map<number, Pose>;
  readonly prevBall: THREE.Vector3;
  /** Interpolation factor between prev and current tick. */
  alpha: number;
  paused: boolean;
  /** Recent ticks, for goal replays. */
  readonly recorder: ReplayRecorder;
  /** Advance by real time with the local player's controls; returns events to show. */
  update(dt: number, controls: Controls): WorldEvent[];
  dispose(): void;
}

export function savePrev(world: World, prev: Map<number, Pose>, prevBall: THREE.Vector3): void {
  for (const c of world.cars) {
    let p = prev.get(c.id);
    if (!p) prev.set(c.id, (p = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() }));
    p.pos.copy(c.pos);
    p.quat.copy(c.quat);
  }
  prevBall.copy(world.ball.pos);
}


export interface LocalOptions {
  name: string;
  body: PlayerInfo['body'];
  team: 0 | 1;
  size: 1 | 2 | 3;
  level: BotLevel;
  length: number;
  freePlay?: boolean;
  /** No human: bots on both teams (menu background). */
  spectate?: boolean;
  /** Mutators (the object is shared, so edits apply mid-match). */
  rules?: Readonly<Rules>;
}

export class LocalSession implements Session {
  readonly world: World;
  readonly myId: number;
  readonly online = false;
  readonly prev = new Map<number, Pose>();
  readonly prevBall = new THREE.Vector3();
  alpha = 0;
  paused = false;
  readonly recorder = new ReplayRecorder();
  private readonly bots: Bots;
  private acc = 0;
  private readonly inputs = new Map<number, Controls>();

  constructor(o: LocalOptions) {
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    const players: PlayerInfo[] = [];
    let id = 1;
    if (!o.spectate) players.push({ id: id++, name: o.name, team: o.team, bot: false, body: o.body });
    if (!o.freePlay) {
      for (const team of [0, 1] as const) {
        const have = players.filter((p) => p.team === team).length;
        for (let i = have; i < o.size; i++) players.push({ id: id++, name: names.pop()!, team, bot: true, body: CAR_IDS[Math.floor(Math.random() * CAR_IDS.length)]! });
      }
    }
    this.myId = o.spectate ? -1 : 1;
    this.world = new World(players, o.length, (Math.random() * 1e9) | 0, !!o.freePlay, o.rules);
    this.bots = new Bots(this.world, o.level);
    savePrev(this.world, this.prev, this.prevBall);
  }

  update(dt: number, controls: Controls): WorldEvent[] {
    const events: WorldEvent[] = [];
    if (this.paused) return events;
    this.acc = Math.min(this.acc + dt * Math.max(0.1, this.world.rules.gameSpeed), 0.25);
    while (this.acc >= TICK) {
      this.acc -= TICK;
      savePrev(this.world, this.prev, this.prevBall);
      this.inputs.clear();
      this.bots.update(TICK, this.inputs);
      if (this.myId > 0) this.inputs.set(this.myId, controls);
      this.world.step(this.inputs);
      this.recorder.record(this.world, this.world.events);
      events.push(...this.world.events.splice(0));
    }
    this.alpha = this.acc / TICK;
    return events;
  }

  dispose(): void {}
}

// ------------------------------------------------------------------ online

const SERVER_EVENTS = new Set<WorldEvent['k']>(['goal', 'demo', 'over', 'overtime']);
const HISTORY = 360;

/**
 * Online match with client-side prediction + rollback: the whole world is
 * simulated locally a few ticks ahead of the server; each server snapshot
 * rewinds to that tick and replays our inputs (other players repeat their last
 * known inputs). Visual corrections are smoothed out by the renderer.
 */
export class OnlineSession implements Session {
  readonly world: World;
  readonly myId: number;
  readonly online = true;
  readonly prev = new Map<number, Pose>();
  readonly prevBall = new THREE.Vector3();
  alpha = 0;
  paused = false;
  readonly recorder = new ReplayRecorder();
  private acc = 0;
  private readonly history = new Map<number, Controls>();
  private readonly known = new Map<number, Controls>();
  private readonly inputs = new Map<number, Controls>();
  private pendingT = -1;
  private pending: number[] = [];
  private snap: Float32Array | null = null;
  private lead = 0;
  private timeScale = 1;
  private started = false;
  private readonly targetLead: number;
  /** Server events waiting to be shown. */
  private serverEvents: WorldEvent[] = [];
  /** Hook for visual error smoothing. */
  views: (() => Map<number, CarView>) | null = null;
  ballErr: THREE.Vector3 | null = null;

  constructor(
    private readonly net: RocketNet,
    begin: RbBegin,
  ) {
    this.world = new World(begin.players, begin.length, begin.seed);
    this.myId = begin.ids[net.sessionId] ?? -1;
    this.targetLead = begin.lan ? 2 : 3;
    net.onSnap = (s) => {
      if (!this.snap || s[1]! >= this.snap[1]!) this.snap = s;
    };
    net.onEvents = (evs) => this.serverEvents.push(...evs);
    savePrev(this.world, this.prev, this.prevBall);
  }

  update(dt: number, controls: Controls): WorldEvent[] {
    const out: WorldEvent[] = [];
    this.applySnapshot();
    if (!this.started) return out;
    // Keep our input lead at the server close to the target by running slightly fast / slow.
    const err = this.lead - this.targetLead;
    this.timeScale = err < -1 ? 1.06 : err > 3 ? 0.95 : err > 1 ? 0.985 : 1;
    this.acc = Math.min(this.acc + dt * this.timeScale, 0.25);
    while (this.acc >= TICK) {
      this.acc -= TICK;
      const t = this.world.tickCount + 1;
      const c = { ...controls };
      this.history.set(t, c);
      this.history.delete(t - HISTORY);
      if (this.pendingT < 0) this.pendingT = t;
      this.pending.push(...packControls(c));
      this.stepWith(c);
      for (const e of this.world.events.splice(0)) if (!SERVER_EVENTS.has(e.k)) out.push(e);
    }
    if (this.pending.length) {
      this.net.input({ t: this.pendingT, c: this.pending });
      this.pending = [];
      this.pendingT = -1;
    }
    this.alpha = this.acc / TICK;
    out.push(...this.serverEvents.splice(0));
    return out;
  }

  private stepWith(mine: Controls): void {
    this.inputs.clear();
    for (const car of this.world.cars) this.inputs.set(car.id, this.known.get(car.id) ?? NO_CONTROLS);
    if (this.myId > 0) this.inputs.set(this.myId, mine);
    savePrev(this.world, this.prev, this.prevBall);
    const n0 = this.world.events.length;
    this.world.step(this.inputs);
    this.recorder.record(this.world, this.world.events.slice(n0));
  }

  private applySnapshot(): void {
    const s = this.snap;
    if (!s) return;
    this.snap = null;
    this.lead = s[0]!;
    const body = s.subarray(1);
    const S = body[0]!;
    const now = this.world.tickCount;
    // Remember rendered poses to smooth the correction.
    const before = this.world.cars.map((c) => ({ id: c.id, pos: c.pos.clone(), quat: c.quat.clone(), dead: c.demolished }));
    const ballBefore = this.world.ball.pos.clone();
    readSnapshot(this.world, body);
    snapshotControls(this.world, body, this.known);
    this.world.events.length = 0;
    let target = now;
    const rttTicks = Math.ceil(this.net.rtt / 1000 / 2 / TICK);
    if (!this.started || S >= now || now - S > HISTORY - 10) {
      // First snapshot or we fell behind: jump ahead of the server.
      target = S + rttTicks + this.targetLead + 2;
      this.started = true;
      this.acc = 0;
    } else if (this.lead < -8) target = now + this.targetLead - this.lead;
    else if (this.lead > 40) target = Math.max(S + 1, now - (this.lead - this.targetLead));
    for (let t = S + 1; t <= target; t++) this.stepWith(this.history.get(t) ?? this.history.get(t - 1) ?? NO_CONTROLS);
    this.world.events.length = 0;
    // Visual smoothing of the correction (small errors only; big ones snap).
    const views = this.views?.();
    if (views) {
      for (const b of before) {
        const car = this.world.car(b.id);
        const v = views.get(b.id);
        if (!car || !v || b.dead || car.demolished) continue;
        const d = b.pos.distanceTo(car.pos);
        if (d > 400) {
          v.errPos.set(0, 0, 0);
          v.errQuat.identity();
          continue;
        }
        v.errPos.add(toThree(b.pos.x - car.pos.x, b.pos.y - car.pos.y, b.pos.z - car.pos.z));
        const qb = toThreeQuat(b.quat);
        const qa = toThreeQuat(car.quat);
        v.errQuat.multiply(qb.multiply(qa.invert()));
      }
    }
    if (this.ballErr) {
      const d = ballBefore.distanceTo(this.world.ball.pos);
      if (d < 500) this.ballErr.add(toThree(ballBefore.x - this.world.ball.pos.x, ballBefore.y - this.world.ball.pos.y, ballBefore.z - this.world.ball.pos.z));
      else this.ballErr.set(0, 0, 0);
    }
  }

  dispose(): void {
    this.net.onSnap = null;
    this.net.onEvents = null;
  }
}
