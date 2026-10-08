import { Vector3 } from 'three';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { TrackPath } from '../track/TrackPath';
import { spawnSlot } from '../track/spawnGrid';
import { SeededRandom } from '../math/random';
import { createEmptyInput, type PlayerInput } from '../types/input';
import { createKartState } from '../vehicles/KartState';
import { KartSimulation } from '../vehicles/KartSimulation';
import type { KartStats } from '../vehicles/KartStats';
import { ItemSystem } from '../items/ItemSystem';
import { AIDriver, personalityFor } from '../ai/AIDriver';
import { DIFFICULTY, catchUpMultiplier, type Difficulty } from '../ai/AIDifficulty';
import { computeRacingLine, type RacingLine } from '../track/RacingLine';
import { LapTracker } from './LapTracker';
import { Pickups } from './Pickups';
import { stepSlipstream } from './Slipstream';
import { speedClassScale } from './SpeedClass';
import { MoverField, type MoverContact } from './Movers';
import { createItemSlot, createProgress, v3, type RaceContext, type RaceEvent, type Racer } from './RaceTypes';

export type RacePhase = 'countdown' | 'racing' | 'complete';

export interface RacerSetup {
  id: string;
  name: string;
  characterId: string;
  kartId: string;
  isAI: boolean;
  stats: KartStats;
}

export interface RaceConfig {
  laps: number;
  checkpoints: number;
  racers: RacerSetup[];
  itemsEnabled: boolean;
  /** CPU difficulty. */
  difficulty: Difficulty;
  /** Gentle pack balancing for CPUs (see catchUpMultiplier). */
  catchUp: boolean;
  seed: number;
  /** Seconds from start until GO (the last three are the 3-2-1 beats). */
  countdown: number;
  /** Engine class (50/100/150/200cc); default 150. */
  speedClass?: number;
}

const KART_RADIUS = 1.1;
/** Giant Gummy size (collision; the view scales the kart to match). */
export const GIANT_SCALE = 1.9;
const BUMP_RESTITUTION = 0.55;

/**
 * Authoritative race: karts, items, pickups, laps and standings for one race.
 * Everything here is deterministic for a given seed + input stream, so the same
 * class runs on the client (offline / prediction) and the server (Phase 5).
 */
export class RaceSimulation implements RaceContext {
  readonly racers: Racer[] = [];
  readonly rng: SeededRandom;
  readonly items: ItemSystem;
  readonly pickups: Pickups;
  readonly laps: LapTracker;
  readonly events: RaceEvent[] = [];
  readonly racingLine: RacingLine;
  readonly movers: MoverField;
  phase: RacePhase = 'countdown';
  /** Seconds since GO (negative during the countdown). */
  time: number;
  private readonly ai: AIDriver[] = [];
  private readonly onPad: boolean[] = [];
  private readonly baseTopSpeed: number[] = [];
  private balanceTimer = 0;
  private sorted: Racer[] = [];
  private readonly n = new Vector3();
  /** Seconds until each racer can be hit by a moving obstacle again. */
  private readonly moverCooldown: number[] = [];
  private readonly contact: MoverContact = { hit: null, nx: 0, nz: 0, depth: 0, launch: 0 };

  constructor(
    readonly config: RaceConfig,
    readonly physics: PhysicsWorld,
    readonly track: TrackPath,
  ) {
    this.rng = new SeededRandom(config.seed);
    this.time = -config.countdown;
    this.items = new ItemSystem(this);
    this.pickups = new Pickups(track, track.def);
    this.laps = new LapTracker(track, config.checkpoints, config.laps);
    this.racingLine = computeRacingLine(track);
    this.movers = new MoverField(track);
    const profile = DIFFICULTY[config.difficulty];
    const cc = speedClassScale(config.speedClass);

    config.racers.forEach((setup, index) => {
      const state = createKartState();
      const stats = { ...setup.stats };
      stats.maxSpeed *= cc.speed;
      stats.accelRate *= cc.accel;
      stats.accelMin *= cc.accel;
      if (setup.isAI) stats.maxSpeed *= profile.speedMul;
      const sim = new KartSimulation(state, stats, physics, track);
      const spawn = spawnSlot(track, index);
      sim.placeAt(spawn.position, spawn.forward);
      const racer: Racer = {
        index,
        id: setup.id,
        name: setup.name,
        characterId: setup.characterId,
        kartId: setup.kartId,
        isAI: setup.isAI,
        state,
        sim,
        progress: createProgress(),
        slot: createItemSlot(),
        input: createEmptyInput(),
        startPress: -1,
      };
      this.racers.push(racer);
      this.laps.init(racer);
      this.onPad.push(false);
      this.baseTopSpeed.push(stats.maxSpeed);
      const r = new SeededRandom(config.seed * 31 + index * 977);
      // Humans get an expert autopilot (used after finishing and during Jet Rocket).
      this.ai.push(new AIDriver(config.seed + index * 13, personalityFor(setup.isAI ? profile : DIFFICULTY.hard, r)));
    });
    this.updateStandings();
  }

  emit(e: RaceEvent): void {
    this.events.push(e);
  }

  standings(): Racer[] {
    return this.sorted;
  }

  get countdownRemaining(): number {
    return Math.max(0, -this.time);
  }

  /**
   * Advance one fixed tick. `inputs[i]` is the input of racer i (ignored for AI and
   * for humans who have finished — they get autopilot).
   */
  step(inputs: ReadonlyArray<PlayerInput | null>, dt: number): void {
    this.events.length = 0;
    if (this.phase === 'countdown') {
      this.stepCountdown(inputs, dt);
      return;
    }
    this.time += dt;
    this.movers.update(this.time);

    for (const r of this.racers) {
      const input = r.input;
      const human = inputs[r.index];
      if (r.isAI || r.progress.finished || !human) {
        this.ai[r.index]!.compute(this, r, input, dt);
        if (r.progress.finished) input.item = false;
      } else {
        Object.assign(input, human);
      }
      // Jet Rocket: autopilot along the road.
      if (r.state.rocketTimer > 0) {
        const item = input.item;
        this.ai[r.index]!.drive(this, r, input, dt, false);
        input.throttle = 1;
        input.item = item;
      }
      // Slots always run (Time Trial hands out Fizz); `itemsEnabled` only governs item boxes.
      this.items.tickSlot(r, input, dt);
      r.state.respawnIndex = this.laps.respawnIndex(r);
      r.sim.step(input, dt);
      if (r.sim.events.jumped) this.emit({ type: 'jump', racer: r.index });
    }

    this.balanceField(dt);
    this.collideKarts();
    this.collideMovers(dt);
    for (const r of this.racers) if (stepSlipstream(r, this.racers, this.track, dt)) this.emit({ type: 'slipstream', racer: r.index });
    this.collectPickups();
    this.items.update(dt);
    this.pickups.tick(dt);
    this.updateProgress(dt);
  }

  private stepCountdown(inputs: ReadonlyArray<PlayerInput | null>, dt: number): void {
    const before = -this.time;
    this.time += dt;
    const after = Math.max(0, -this.time);
    for (const beat of [3, 2, 1]) if (before > beat && after <= beat) this.emit({ type: 'countdown', value: beat });

    // Rocket-start timing: remember when the throttle went down.
    for (const r of this.racers) {
      const throttle = r.isAI ? this.aiStartThrottle(r, after) : (inputs[r.index]?.throttle ?? 0);
      if (throttle > 0.5) {
        if (r.startPress < 0) r.startPress = after;
      } else {
        r.startPress = -1;
      }
    }

    if (after <= 0) {
      this.phase = 'racing';
      this.time = 0;
      this.emit({ type: 'go' });
      for (const r of this.racers) {
        if (r.startPress > 0 && r.startPress <= 0.55) {
          r.sim.giveBoost(1.4, 9);
          this.emit({ type: 'rocketStart', racer: r.index, good: true });
        } else if (r.startPress > 1.6) {
          r.state.spinTimer = 0.8; // revved too early: engine stall
          this.emit({ type: 'rocketStart', racer: r.index, good: false });
        }
      }
    }
  }

  /** Mild pack balancing for CPUs relative to the best human (never for humans). */
  private balanceField(dt: number): void {
    this.balanceTimer -= dt;
    if (this.balanceTimer > 0) return;
    this.balanceTimer = 0.5;
    const humans = this.racers.filter((r) => !r.isAI && !r.progress.finished);
    const best = humans.length ? Math.max(...humans.map((r) => r.progress.total)) : null;
    for (const r of this.racers) {
      if (!r.isAI) continue;
      const mul = this.config.catchUp && best !== null ? catchUpMultiplier(r.progress.total - best, this.config.difficulty) : 1;
      r.sim.stats.maxSpeed = this.baseTopSpeed[r.index]! * mul;
    }
  }

  /** CPU racers attempt a rocket start with varying timing. */
  private aiStartThrottle(r: Racer, remaining: number): number {
    const press = 0.15 + ((r.index * 0.37 + this.config.seed * 0.13) % 1) * 0.9;
    return remaining <= press ? 1 : 0;
  }

  /** Kart-to-kart bumps: weight-based push, invincible karts bowl others over, shrunk karts get flattened. */
  private collideKarts(): void {
    const rs = this.racers;
    for (let i = 0; i < rs.length; i++) {
      for (let j = i + 1; j < rs.length; j++) {
        const a = rs[i]!;
        const b = rs[j]!;
        const sa = a.state;
        const sb = b.state;
        if (Math.abs(sa.position.y - sb.position.y) > 1.8) continue;
        // Phantoms drift straight through other karts.
        if (sa.ghostTimer > 0 || sb.ghostTimer > 0) continue;
        const ra = KART_RADIUS * (sa.shrinkTimer > 0 ? 0.6 : sa.megaTimer > 0 ? GIANT_SCALE : 1);
        const rb = KART_RADIUS * (sb.shrinkTimer > 0 ? 0.6 : sb.megaTimer > 0 ? GIANT_SCALE : 1);
        const n = this.n.set(sa.position.x - sb.position.x, 0, sa.position.z - sb.position.z);
        const dist = n.length();
        if (dist >= ra + rb || dist < 1e-4) continue;
        n.divideScalar(dist);

        const powerA = sa.invincibleTimer > 0 || sa.rocketTimer > 0;
        const powerB = sb.invincibleTimer > 0 || sb.rocketTimer > 0;
        const giantA = sa.megaTimer > 0;
        const giantB = sb.megaTimer > 0;
        if (powerA && !powerB && !giantB) this.items.entities.hitRacer(b, 'tumble', a.index, 'ram');
        if (powerB && !powerA && !giantA) this.items.entities.hitRacer(a, 'tumble', b.index, 'ram');
        // Giants flatten whoever they touch.
        if (giantA && !giantB && sb.squishTimer <= 0) this.items.entities.hitRacer(b, 'squish', a.index, 'giant');
        if (giantB && !giantA && sa.squishTimer <= 0) this.items.entities.hitRacer(a, 'squish', b.index, 'giant');
        if (sa.shrinkTimer > 0 && sb.shrinkTimer <= 0 && sa.squishTimer <= 0) this.items.entities.hitRacer(a, 'squish', b.index, 'squish');
        if (sb.shrinkTimer > 0 && sa.shrinkTimer <= 0 && sb.squishTimer <= 0) this.items.entities.hitRacer(b, 'squish', a.index, 'squish');

        const wa = a.sim.stats.weight * (sa.shrinkTimer > 0 ? 0.3 : 1) * (powerA || giantA ? 50 : 1);
        const wb = b.sim.stats.weight * (sb.shrinkTimer > 0 ? 0.3 : 1) * (powerB || giantB ? 50 : 1);
        const overlap = ra + rb - dist;
        sa.position.addScaledVector(n, (overlap * wb) / (wa + wb));
        sb.position.addScaledVector(n, (-overlap * wa) / (wa + wb));
        const rel = sa.velocity.dot(n) - sb.velocity.dot(n);
        if (rel < 0) {
          const impulse = (-(1 + BUMP_RESTITUTION) * rel) / (1 / wa + 1 / wb);
          sa.velocity.addScaledVector(n, impulse / wa);
          sb.velocity.addScaledVector(n, -impulse / wb);
          // A little extra sideways shove keeps bumps lively.
          sa.velocity.addScaledVector(n, (2 * wb) / (wa + wb));
          sb.velocity.addScaledVector(n, (-2 * wa) / (wa + wb));
          if (-rel > 2) this.emit({ type: 'bump', a: a.index, b: b.index, impact: -rel, position: v3(sa.position.clone().lerp(sb.position, 0.5)) });
        }
      }
    }
  }

  /** Moving obstacles: push karts out of solid ones, hit them (with a short grace period). */
  private collideMovers(dt: number): void {
    if (!this.movers.defs.length) return;
    for (const r of this.racers) {
      const s = r.state;
      const cd = Math.max(0, (this.moverCooldown[r.index] ?? 0) - dt);
      this.moverCooldown[r.index] = cd;
      if (s.respawnTimer > 0) continue;
      for (let i = 0; i < this.movers.defs.length; i++) {
        const c = this.movers.contact(i, s, this.contact);
        if (!c) continue;
        MoverField.pushOut(s, c);
        if (c.hit && cd <= 0 && this.items.entities.hitRacer(r, c.hit, -1, this.movers.defs[i]!.kind)) {
          this.moverCooldown[r.index] = 1.6;
          s.velocity.x += c.nx * 6;
          s.velocity.z += c.nz * 6;
          if (c.launch) s.velocity.y = c.launch;
        }
      }
    }
  }

  private collectPickups(): void {
    this.racers.forEach((r, i) => {
      const s = r.state;
      if (this.config.itemsEnabled && this.pickups.boxes.length) {
        const box = this.pickups.takeBox(s.position);
        if (box >= 0) {
          this.emit({ type: 'itemBox', racer: r.index, position: v3(this.pickups.boxes[box]!.position) });
          this.items.grantRoll(r);
        }
      }
      if (this.pickups.takeCoin(s.position) >= 0) {
        s.coins = Math.min(10, s.coins + 1);
        r.sim.giveBoost(0.25, 2);
        this.emit({ type: 'coin', racer: r.index, total: s.coins, position: v3(s.position) });
      }
      // Streams (water currents, conveyors…) push you along while you ride them.
      const push = s.grounded && this.pickups.streams.length ? this.pickups.onStream(s.position) : 0;
      if (push > 0) r.sim.giveBoost(0.12, push);
      const pad = s.grounded && this.pickups.onPad(s.position);
      if (pad) {
        r.sim.giveBoost(1.0, 9);
        if (!this.onPad[i]) this.emit({ type: 'boostPad', racer: r.index });
      }
      this.onPad[i] = pad;
    });
  }

  private updateProgress(dt: number): void {
    for (const r of this.racers) {
      const result = this.laps.update(r, this.time, dt);
      if (result === 'lap') this.emit({ type: 'lap', racer: r.index, lap: r.progress.lap, lapTime: r.progress.lapTimes[r.progress.lapTimes.length - 1] ?? 0 });
      if (result === 'finish') {
        this.updateStandings();
        this.emit({ type: 'finish', racer: r.index, position: r.progress.position, time: r.progress.finishTime });
      }
    }
    this.updateStandings();
    // Complete when every human has finished (or every racer, if nobody is human).
    const humans = this.racers.filter((r) => !r.isAI);
    const done = (humans.length ? humans : this.racers).every((r) => r.progress.finished);
    if (this.phase === 'racing' && done) this.phase = 'complete';
  }

  /** Online clients mirror the server: re-sort standings from the replicated positions. */
  syncStandings(): void {
    this.sorted = [...this.racers].sort((a, b) => a.progress.position - b.progress.position);
  }

  private updateStandings(): void {
    this.sorted = [...this.racers].sort((a, b) => {
      const pa = a.progress;
      const pb = b.progress;
      if (pa.finished !== pb.finished) return pa.finished ? -1 : 1;
      if (pa.finished) return pa.finishTime - pb.finishTime;
      return pb.total - pa.total;
    });
    this.sorted.forEach((r, i) => (r.progress.position = i + 1));
  }

  dispose(): void {
    for (const r of this.racers) r.sim.dispose();
    this.items.dispose();
  }
}
