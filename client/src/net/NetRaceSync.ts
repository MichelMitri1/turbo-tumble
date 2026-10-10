import { Vector3 } from 'three';
import { FIXED_DT, TICK_RATE } from '@shared/constants/simulation';
import type { ItemEntity } from '@shared/items/ItemEntities';
import { packInput, unpackInput } from '@shared/net/InputCodec';
import { Msg, type EventsMessage, type RaceEndMessage, type RaceStartMessage } from '@shared/net/Protocol';
import { decodeSnapshot, type RaceSnapshot } from '@shared/net/Snapshot';
import { PROGRESS_PUBLIC, SLOT_PUBLIC, createBlankEntity } from '@shared/net/StateCodec';
import { MoverField, type MoverContact } from '@shared/race/Movers';
import type { RaceSimulation } from '@shared/race/RaceSimulation';
import type { RaceEvent, Racer } from '@shared/race/RaceTypes';
import { createEmptyInput, type PlayerInput } from '@shared/types/input';
import type { KartEntity } from '../vehicles/KartEntity';
import type { NetClient } from './NetClient';
import { copyEntity, copyKartState, lerpKartState } from './interpolate';
import { stepSlipstream } from '@shared/race/Slipstream';

/**
 * Other karts and items are drawn this far in the past so two snapshots always
 * bracket them: two and a half snapshot gaps plus the measured arrival jitter.
 * Internet (30 Hz, jittery) lands near the old fixed 100 ms; a LAN server sending
 * every tick gets ~45 ms.
 */
const INTERP_MIN_TICKS = 2;
const INTERP_MAX_TICKS = 8;
const SNAPSHOT_BUFFER = 40;
const MAX_HISTORY = TICK_RATE * 10;
const NO_INPUT = createEmptyInput();

interface InputFrame {
  seq: number;
  /** Quantized exactly as the server will decode them. */
  inputs: PlayerInput[];
  resets: boolean[];
}

export interface NetStats {
  rtt: number;
  snapshotsPerSec: number;
  kibPerSec: number;
  /** Mean reconciliation correction over the last second (metres). */
  correction: number;
  /** Inputs sent but not yet acknowledged. */
  unacked: number;
  /** How far in the past other karts are drawn. */
  interpMs: number;
  status: string;
  /** Snapshots / inputs on the fast (UDP-like) lane. */
  lane?: boolean;
}

/**
 * Client side of an online race. Owns nothing visual — it drives the local
 * mirror RaceSimulation so the existing views/HUD work unchanged:
 *  - own karts: predicted every tick with local input; on each snapshot rewound
 *    to the server state and the unacknowledged inputs replayed (reconciliation),
 *    with the visual difference smoothed out by KartEntity
 *  - other karts + items: interpolated ~100 ms in the past between snapshots
 *  - progress, item slots, pickups, phase: latest snapshot
 *  - race events: forwarded to the presenter as they arrive
 */
export class NetRaceSync {
  readonly events: RaceEvent[] = [];
  end: RaceEndMessage | null = null;
  /** Racer index per local seat. */
  readonly seats: number[];
  private readonly seatSet: Set<number>;
  private readonly contact: MoverContact = { hit: null, nx: 0, nz: 0, depth: 0, launch: 0 };
  private seq = 0;
  private history: InputFrame[] = [];
  private snaps: RaceSnapshot[] = [];
  private latestAt = 0;
  private renderTick = -1;
  /** Smoothed ticks between snapshots and arrival jitter (ticks). */
  private snapGap = 2;
  private jitter = 0.5;
  private interpDelay = 6;
  /** Recent input messages (resent together for redundancy). */
  private recent: number[][] = [];
  private readonly wasPredicted: boolean[];
  private readonly offs: Array<() => void> = [];
  private readonly entityPool = new Map<number, ItemEntity>();
  private readonly before = new Vector3();
  private readonly delta = new Vector3();
  private readonly tmp = new Vector3();
  // Stats (rolling one-second windows).
  private statWindow = 0;
  private statSnaps = 0;
  private statBytes = 0;
  private statCorr = 0;
  private statCorrN = 0;
  readonly stats: NetStats = { rtt: 0, snapshotsPerSec: 0, kibPerSec: 0, correction: 0, unacked: 0, interpMs: 100, status: 'connected' };

  constructor(
    private readonly net: NetClient,
    readonly start: RaceStartMessage,
    private readonly race: RaceSimulation,
    private readonly karts: KartEntity[],
  ) {
    this.seats = start.owners.flatMap((owner, i) => (owner === net.sessionId ? [i] : []));
    this.seatSet = new Set(this.seats);
    this.wasPredicted = race.racers.map(() => false);
    this.offs.push(
      net.on<Uint8Array>(Msg.Snapshot, (bytes) => this.onSnapshot(bytes), { fast: true, latestOnly: true }),
      net.on<EventsMessage>(Msg.Events, (m) => this.events.push(...m.e)),
      net.on<RaceEndMessage>(Msg.RaceEnd, (m) => {
        if (m.raceId === start.raceId) this.end = m;
      }),
    );
  }

  private get latest(): RaceSnapshot | undefined {
    return this.snaps[this.snaps.length - 1];
  }

  /** Is racer `i` simulated locally right now (vs interpolated from the server)? */
  predicts(i: number): boolean {
    if (!this.seatSet.has(i)) return false;
    const snap = this.latest;
    if (!snap || snap.phase === 'countdown') return false;
    const r = this.race.racers[i]!;
    return !r.progress.finished && r.state.rocketTimer <= 0;
  }

  // ---------------------------------------------------------------- per tick

  /** Send this tick's input for every local seat and advance the predicted karts. */
  tick(inputs: readonly PlayerInput[], resets: readonly boolean[]): void {
    const frame: InputFrame = { seq: ++this.seq, inputs: [], resets: [] };
    const msg: number[] = [frame.seq];
    this.seats.forEach((_, k) => {
      const packed = packInput(inputs[k] ?? NO_INPUT, resets[k] ?? false);
      msg.push(packed);
      const q = createEmptyInput();
      frame.resets.push(unpackInput(packed, q));
      frame.inputs.push(q);
    });
    // The last few frames ride along every time (the unreliable lane may drop one; the server
    // takes each seq once).
    this.recent.push(msg);
    if (this.recent.length > 5) this.recent.shift();
    this.net.send(Msg.Input, this.recent, true);
    this.history.push(frame);
    if (this.history.length > MAX_HISTORY) this.history.shift();

    this.seats.forEach((ri, k) => {
      if (!this.predicts(ri)) return;
      const kart = this.karts[ri]!;
      kart.beforeTick();
      this.stepPredicted(this.race.racers[ri]!, frame.inputs[k]!, frame.resets[k]!);
      kart.afterTick();
      if (frame.resets[k]) {
        kart.frameEvents.respawned = true;
        kart.beforeTick();
      }
    });
  }

  /** Mirrors the server's per-racer work for a human kart (kart physics + boost pads). */
  private stepPredicted(r: Racer, input: PlayerInput, reset: boolean): void {
    const s = r.state;
    if (reset) r.sim.respawn(s.trackIndex >= 0 ? s.trackIndex : s.safeTrackIndex);
    r.sim.step(input, FIXED_DT);
    stepSlipstream(r, this.race.racers, this.race.track, FIXED_DT);
    if (s.grounded && this.race.pickups.onPad(s.position)) r.sim.giveBoost(1.0, 9);
    const push = s.grounded && this.race.pickups.streams.length ? this.race.pickups.onStream(s.position) : 0;
    if (push > 0) r.sim.giveBoost(0.12, push);
    // Solid moving obstacles (hits themselves come from the server).
    const movers = this.race.movers;
    if (movers.defs.length) {
      movers.update(this.race.time);
      for (let i = 0; i < movers.defs.length; i++) {
        const c = movers.contact(i, s, this.contact);
        if (c) MoverField.pushOut(s, c);
      }
    }
  }

  // ---------------------------------------------------------------- snapshots

  private onSnapshot(bytes: Uint8Array): void {
    const race = this.race;
    const snap = decodeSnapshot(bytes, race.pickups.boxes.length, race.pickups.coins.length);
    const prev = this.latest;
    if (prev && snap.tick <= prev.tick) return;
    const now = performance.now();
    if (prev) {
      const gap = snap.tick - prev.tick;
      const late = Math.abs((now - this.latestAt) / 1000 * TICK_RATE - gap);
      this.snapGap += (Math.min(gap, 6) - this.snapGap) * 0.1;
      this.jitter += (Math.min(late, 6) - this.jitter) * 0.05;
      this.interpDelay = Math.min(INTERP_MAX_TICKS, Math.max(INTERP_MIN_TICKS, this.snapGap * 2.5 + this.jitter * 1.5));
    }
    this.snaps.push(snap);
    if (this.snaps.length > SNAPSHOT_BUFFER) this.snaps.shift();
    this.latestAt = now;
    this.statSnaps++;
    this.statBytes += bytes.length;

    // Latest-state data: phase, standings, item slots, pickups.
    race.phase = snap.phase;
    snap.racers.forEach((rs, i) => {
      const r = race.racers[i];
      if (!r) return;
      for (const key in PROGRESS_PUBLIC) (r.progress as unknown as Record<string, unknown>)[key] = (rs.progress as unknown as Record<string, unknown>)[key];
      if (!this.seatSet.has(i)) for (const key in SLOT_PUBLIC) (r.slot as unknown as Record<string, unknown>)[key] = (rs.slot as unknown as Record<string, unknown>)[key];
    });
    for (const own of snap.own) {
      const r = race.racers[own.index];
      if (!r) continue;
      Object.assign(r.progress, own.progress);
      Object.assign(r.slot, own.slot);
    }
    race.pickups.boxes.forEach((b, i) => (b.respawn = snap.boxes[i] ? 0 : 1));
    race.pickups.coins.forEach((c, i) => (c.respawn = snap.coins[i] ? 0 : 1));
    race.syncStandings();

    this.reconcile(snap);
  }

  /** Rewind own karts to the server's state and replay the inputs it hasn't seen yet. */
  private reconcile(snap: RaceSnapshot): void {
    for (const own of snap.own) {
      const r = this.race.racers[own.index];
      const seat = this.seats.indexOf(own.index);
      if (!r || seat < 0) continue;
      if (snap.phase === 'countdown' || own.progress.finished || own.kart.rocketTimer > 0) continue; // interpolated instead
      this.before.copy(r.state.position);
      copyKartState(own.kart, r.state);
      for (const f of this.history) if (f.seq > snap.ack) this.stepPredicted(r, f.inputs[seat]!, f.resets[seat]!);
      const d = this.delta.copy(r.state.position).sub(this.before);
      this.karts[own.index]!.applyCorrection(d);
      this.statCorr += d.length();
      this.statCorrN++;
    }
    let drop = 0;
    while (drop < this.history.length && this.history[drop]!.seq <= snap.ack) drop++;
    if (drop) this.history.splice(0, drop);
  }

  // ---------------------------------------------------------------- per frame

  /** Interpolate remote karts and items for this frame; update the race clock and stats. */
  frame(dt: number): void {
    this.updateStats(dt);
    const latest = this.latest;
    if (!latest) return;
    const now = performance.now();
    const sinceLatest = (now - this.latestAt) / 1000;

    // Render clock: chase (latest tick − delay), easing out jitter; resync if far off.
    const target = latest.tick + sinceLatest * TICK_RATE - this.interpDelay;
    if (this.renderTick < 0 || Math.abs(target - this.renderTick) > 30) this.renderTick = target;
    else this.renderTick += dt * TICK_RATE + (target - this.renderTick) * Math.min(1, dt * 2);

    const { a, b, t } = this.bracket(this.renderTick);
    const race = this.race;
    race.racers.forEach((r, i) => {
      const predicted = this.predicts(i);
      if (!predicted) {
        const kart = this.karts[i]!;
        const sa = a.racers[i];
        const sb = b.racers[i];
        if (sa && sb) {
          this.before.copy(r.state.position);
          lerpKartState(sa.kart, sb.kart, t, r.state);
          // Leaving prediction (finished / rocket): glide back to the interpolated pose.
          if (this.wasPredicted[i]) kart.applyCorrection(this.delta.copy(r.state.position).sub(this.before));
          kart.beforeTick();
        }
      }
      this.wasPredicted[i] = predicted;
    });

    this.interpolateEntities(a, b, t, latest);

    race.time = latest.phase === 'countdown' ? Math.min(0, latest.time + sinceLatest) : latest.time + Math.min(0.25, sinceLatest);
  }

  private bracket(tick: number): { a: RaceSnapshot; b: RaceSnapshot; t: number } {
    const snaps = this.snaps;
    const newest = snaps[snaps.length - 1]!;
    if (tick >= newest.tick) return { a: newest, b: newest, t: 0 };
    for (let i = snaps.length - 2; i >= 0; i--) {
      const a = snaps[i]!;
      if (a.tick <= tick) {
        const b = snaps[i + 1]!;
        return { a, b, t: (tick - a.tick) / Math.max(1, b.tick - a.tick) };
      }
    }
    return { a: snaps[0]!, b: snaps[0]!, t: 0 };
  }

  private interpolateEntities(a: RaceSnapshot, b: RaceSnapshot, t: number, latest: RaceSnapshot): void {
    const list = this.race.items.entities.list;
    list.length = 0;
    const seen = new Set<number>();
    for (const eb of b.entities) {
      const out = this.entityPool.get(eb.id) ?? createBlankEntity();
      this.entityPool.set(eb.id, out);
      copyEntity(eb, out);
      const ea = a === b ? undefined : a.entities.find((e) => e.id === eb.id);
      if (ea && ea.position.distanceToSquared(eb.position) < 400) out.position.lerpVectors(ea.position, eb.position, t);
      // Held / orbiting items on a predicted kart ride on the predicted kart, not 100 ms behind it.
      if (out.attach !== 'none' && this.predicts(out.owner)) {
        const le = latest.entities.find((e) => e.id === eb.id);
        const ownerAtLatest = latest.racers[out.owner]?.kart.position;
        if (le && ownerAtLatest) out.position.copy(this.race.racers[out.owner]!.state.position).add(this.tmp.copy(le.position).sub(ownerAtLatest));
      }
      list.push(out);
      seen.add(eb.id);
    }
    for (const id of this.entityPool.keys()) if (!seen.has(id)) this.entityPool.delete(id);
  }

  private updateStats(dt: number): void {
    this.statWindow += dt;
    const s = this.stats;
    s.rtt = this.net.rtt;
    s.interpMs = (this.interpDelay / TICK_RATE) * 1000;
    s.unacked = this.history.length;
    s.status = this.net.status;
    s.lane = !!this.net.lane?.open;
    if (this.statWindow < 1) return;
    s.snapshotsPerSec = this.statSnaps / this.statWindow;
    s.kibPerSec = this.statBytes / this.statWindow / 1024;
    s.correction = this.statCorrN ? this.statCorr / this.statCorrN : 0;
    this.statWindow = this.statSnaps = this.statBytes = this.statCorr = this.statCorrN = 0;
  }

  /** Events received since the last call. */
  drainEvents(out: RaceEvent[]): void {
    if (!this.events.length) return;
    out.push(...this.events);
    this.events.length = 0;
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
  }
}
