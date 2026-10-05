import { FIXED_DT, TICK_RATE } from '../../../shared/src/constants/simulation';
import { ByteWriter } from '../../../shared/src/net/ByteBuffer';
import { unpackInput } from '../../../shared/src/net/InputCodec';
import { FINISH_GRACE_SECONDS, type RaceStartMessage } from '../../../shared/src/net/Protocol';
import { encodeSnapshotCommon, encodeSnapshotOwn } from '../../../shared/src/net/Snapshot';
import { RaceSimulation } from '../../../shared/src/race/RaceSimulation';
import type { RaceEvent } from '../../../shared/src/race/RaceTypes';
import { createEmptyInput, type PlayerInput } from '../../../shared/src/types/input';
import { createTrackWorld, type TrackWorld } from '../simulation/TrackWorld';

/** One tick of input from one client: an entry per seat. */
interface InputFrame {
  seq: number;
  inputs: PlayerInput[];
  resets: boolean[];
}

interface ClientInputs {
  /** Racer index per seat. */
  seats: number[];
  queue: InputFrame[];
  last: InputFrame | null;
  /** Last applied (or dropped) sequence number — acked in snapshots. */
  ack: number;
  /** Consecutive ticks without fresh input. */
  starved: number;
  connected: boolean;
}

/** Inputs queued beyond this are stale (client clock ran ahead / burst): trim to TRIM_TO. */
const MAX_QUEUE = 8;
const TRIM_TO = 3;
/** Hold the last input this many ticks when a client goes quiet, then coast. */
const HOLD_TICKS = 12;
const COAST: PlayerInput = createEmptyInput();

/**
 * The authoritative race on the server: steps the shared RaceSimulation at 60 Hz
 * with one input per client per tick, and produces snapshots / events.
 * Disconnected players' karts are driven by the autopilot (null input).
 */
export class ServerRace {
  readonly sim: RaceSimulation;
  readonly world: TrackWorld;
  tick = 0;
  /** Events since the last flush. */
  readonly events: RaceEvent[] = [];
  private readonly clients = new Map<string, ClientInputs>();
  private readonly inputs: Array<PlayerInput | null>;
  private readonly common = new ByteWriter(8192);
  private readonly packet = new ByteWriter(8192);
  private firstHumanFinish = -1;

  constructor(readonly start: RaceStartMessage) {
    this.world = createTrackWorld(start.settings.trackId);
    this.sim = new RaceSimulation(
      {
        laps: start.settings.laps,
        checkpoints: start.checkpoints,
        racers: start.racers,
        itemsEnabled: start.settings.items,
        difficulty: start.settings.difficulty,
        catchUp: start.catchUp,
        seed: start.seed,
        countdown: start.countdown,
      },
      this.world.physics,
      this.world.path,
    );
    this.inputs = this.sim.racers.map(() => null);
    start.owners.forEach((owner, index) => {
      if (!owner) return;
      let c = this.clients.get(owner);
      if (!c) this.clients.set(owner, (c = { seats: [], queue: [], last: null, ack: 0, starved: 0, connected: true }));
      c.seats.push(index);
    });
  }

  /** Racer indices owned by a session (seat order). */
  seatsOf(sessionId: string): number[] {
    return this.clients.get(sessionId)?.seats ?? [];
  }

  ackOf(sessionId: string): number {
    return this.clients.get(sessionId)?.ack ?? 0;
  }

  setConnected(sessionId: string, connected: boolean): void {
    const c = this.clients.get(sessionId);
    if (!c) return;
    c.connected = connected;
    if (!connected) {
      c.queue.length = 0;
      c.last = null;
    }
  }

  /** Queue an input message: [seq, packed seat 0, packed seat 1, …]. */
  receiveInput(sessionId: string, msg: unknown): void {
    const c = this.clients.get(sessionId);
    if (!c || !c.connected || !Array.isArray(msg) || msg.length < 1 + c.seats.length) return;
    const seq = Number(msg[0]);
    if (!Number.isFinite(seq) || seq <= c.ack || (c.queue.length && seq <= c.queue[c.queue.length - 1]!.seq)) return;
    const frame: InputFrame = { seq, inputs: [], resets: [] };
    for (let k = 0; k < c.seats.length; k++) {
      const input = createEmptyInput();
      frame.resets.push(unpackInput(Number(msg[1 + k]) || 0, input));
      frame.inputs.push(input);
    }
    c.queue.push(frame);
  }

  step(): void {
    for (const c of this.clients.values()) {
      if (c.queue.length > MAX_QUEUE) {
        // Drop stale frames; their seqs count as consumed.
        while (c.queue.length > TRIM_TO) c.ack = c.queue.shift()!.seq;
      }
      const frame = c.queue.shift() ?? null;
      if (frame) {
        c.last = frame;
        c.ack = frame.seq;
        c.starved = 0;
      } else {
        c.starved++;
      }
      const use = frame ?? (c.starved <= HOLD_TICKS ? c.last : null);
      c.seats.forEach((racerIndex, k) => {
        if (!c.connected) {
          this.inputs[racerIndex] = null; // autopilot
          return;
        }
        this.inputs[racerIndex] = use ? use.inputs[k]! : COAST;
        if (frame?.resets[k] && this.sim.phase !== 'countdown') {
          const s = this.sim.racers[racerIndex]!.state;
          this.sim.racers[racerIndex]!.sim.respawn(s.trackIndex >= 0 ? s.trackIndex : s.safeTrackIndex);
        }
      });
    }
    this.sim.step(this.inputs, FIXED_DT);
    this.tick++;
    for (const e of this.sim.events) {
      this.events.push(e);
      if (e.type === 'finish' && !this.sim.racers[e.racer]!.isAI && this.firstHumanFinish < 0) this.firstHumanFinish = this.tick;
    }
  }

  /** True once every human finished, or the grace period after the first finisher ran out. */
  get over(): boolean {
    if (this.sim.phase === 'complete') return true;
    return this.firstHumanFinish >= 0 && this.tick - this.firstHumanFinish > FINISH_GRACE_SECONDS * TICK_RATE;
  }

  /** Encode the shared part of a snapshot; call once per snapshot tick before packetFor. */
  encodeCommon(): void {
    this.common.reset();
    encodeSnapshotCommon(this.common, this.sim, this.tick);
  }

  /** Full snapshot for one client (common part + their own karts), as a fresh copy (sockets may queue it). */
  packetFor(sessionId: string): Uint8Array {
    this.packet.reset();
    this.packet.bytes(this.common.view8());
    encodeSnapshotOwn(this.packet, this.sim, this.ackOf(sessionId), this.seatsOf(sessionId));
    return this.packet.toBytes();
  }

  dispose(): void {
    this.sim.dispose();
    this.world.physics.dispose();
  }
}
