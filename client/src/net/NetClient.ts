import { Client, type Room } from '@colyseus/sdk';
import { defaultServerUrl } from './serverUrl';
import { FastLane } from './fastlane';
import {
  Msg,
  PROTOCOL_VERSION,
  ROOM_NAME,
  normalizeRoomCode,
  type CreateOptions,
  type JoinOptions,
  type LobbyStateView,
  type RoomSettings,
  type SeatChoice,
} from '@shared/net/Protocol';

export type ConnectionStatus = 'connected' | 'reconnecting' | 'closed';
export { defaultServerUrl };

interface LagSettings {
  /** One-way delay (ms) added to every message in each direction. */
  delay: number;
  jitter: number;
}

function lagFromUrl(): LagSettings {
  const q = new URLSearchParams(location.search);
  const rtt = Number(q.get('lag') ?? 0);
  return { delay: Math.max(0, rtt / 2), jitter: Math.max(0, Number(q.get('jitter') ?? 0)) };
}

/**
 * Thin wrapper over the Colyseus SDK: create / join / quick-match rooms, typed
 * send + receive, ping reporting and optional simulated latency (?lag=150&jitter=20,
 * round-trip ms) for testing prediction on localhost.
 */
export class NetClient {
  readonly url: string;
  room: Room | null = null;
  status: ConnectionStatus = 'closed';
  /** Smoothed round-trip time (ms). */
  rtt = 0;
  readonly lag = lagFromUrl();
  onStatus: ((s: ConnectionStatus, reason?: string) => void) | null = null;
  private readonly sdk: Client;
  private pingTimer = 0;
  /** In-order delivery under simulated jitter. */
  private lastInboundAt = 0;
  private lastOutboundAt = 0;

  constructor(url = defaultServerUrl()) {
    this.url = url;
    this.sdk = new Client(url);
  }

  get sessionId(): string {
    return this.room?.sessionId ?? '';
  }

  get code(): string {
    return this.room?.roomId ?? '';
  }

  /** Plain copy of the lobby state. */
  lobby(): LobbyStateView | null {
    const state = this.room?.state as { toJSON?: () => unknown } | undefined;
    const view = state?.toJSON ? (state.toJSON() as Partial<LobbyStateView>) : null;
    // Before the first state patch arrives the schema is still empty.
    if (!view?.code) return null;
    return { ...view, members: view.members ?? {} } as LobbyStateView;
  }

  async create(name: string, seats: SeatChoice[], settings: Partial<RoomSettings>, visibility: CreateOptions['visibility'] = 'private'): Promise<void> {
    const options: CreateOptions = { version: PROTOCOL_VERSION, name, seats, settings, visibility };
    this.attach(await this.sdk.create(ROOM_NAME, options));
  }

  async join(code: string, name: string, seats: SeatChoice[]): Promise<void> {
    const options: JoinOptions = { version: PROTOCOL_VERSION, name, seats };
    this.attach(await this.sdk.joinById(normalizeRoomCode(code), options));
  }

  /** Join any open public room, or open a new public one. */
  async quickMatch(name: string, seats: SeatChoice[], settings: Partial<RoomSettings>): Promise<void> {
    const options: CreateOptions = { version: PROTOCOL_VERSION, name, seats, settings, visibility: 'public' };
    this.attach(await this.sdk.joinOrCreate(ROOM_NAME, options));
  }

  /** Is a server reachable at all? (for a friendly error before trying to join) */
  async probe(): Promise<boolean> {
    const http = this.url.replace(/^ws/, 'http');
    try {
      const res = await fetch(`${http}/health`, { signal: AbortSignal.timeout(2500) });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Unreliable fast lane (WebRTC) next to the WebSocket, for snapshots / inputs. */
  lane: FastLane | null = null;

  private attach(room: Room): void {
    this.room = room;
    this.lane = new FastLane(room);
    this.setStatus('connected');
    room.onDrop(() => this.setStatus('reconnecting'));
    room.onReconnect(() => this.setStatus('connected'));
    room.onLeave((code: number, reason?: string) => {
      this.room = null;
      clearInterval(this.pingTimer);
      this.setStatus('closed', reason || (code >= 4000 ? `Disconnected (${code})` : undefined));
    });
    room.onError((code: number, message?: string) => console.warn('[net] room error', code, message));
    this.pingTimer = window.setInterval(() => this.measurePing(), 2000);
    this.measurePing();
  }

  private setStatus(s: ConnectionStatus, reason?: string): void {
    this.status = s;
    this.onStatus?.(s, reason);
  }

  private measurePing(): void {
    const room = this.room;
    if (!room || this.status !== 'connected') return;
    room.ping((ms: number) => {
      const total = ms + this.lag.delay * 2;
      this.rtt = this.rtt ? this.rtt + (total - this.rtt) * 0.3 : total;
      this.send(Msg.Ping, { rtt: Math.max(1, this.rtt) });
    });
  }

  private delay(lastAt: number): number {
    const { delay, jitter } = this.lag;
    const at = performance.now() + delay + Math.random() * jitter;
    return Math.max(at, lastAt);
  }

  /** `fast`: the unreliable lane when it's up (high-rate, redundant messages only). */
  send(type: string, payload?: unknown, fast = false): void {
    const room = this.room;
    if (!room || this.status !== 'connected') return;
    const go = () => (fast && this.lane ? this.lane.send(type, payload) : this.room?.send(type, payload));
    if (!this.lag.delay && !this.lag.jitter) {
      go();
      return;
    }
    const at = (this.lastOutboundAt = this.delay(this.lastOutboundAt));
    setTimeout(go, at - performance.now());
  }

  /** Subscribe to a message type; returns an unsubscribe function. */
  on<T>(type: string, cb: (payload: T) => void, opts: { fast?: boolean; latestOnly?: boolean } = {}): () => void {
    const room = this.room;
    if (!room) return () => undefined;
    let live = true;
    const sub = (h: (payload: T) => void) => (opts.fast && this.lane ? this.lane.on(type, h, { latestOnly: opts.latestOnly }) : room.onMessage(type, h));
    const off = sub((payload: T) => {
      if (!this.lag.delay && !this.lag.jitter) {
        cb(payload);
        return;
      }
      const at = (this.lastInboundAt = this.delay(this.lastInboundAt));
      setTimeout(() => live && cb(payload), at - performance.now());
    });
    return () => {
      live = false;
      off();
    };
  }

  onStateChange(cb: (view: LobbyStateView) => void): () => void {
    const room = this.room;
    if (!room) return () => undefined;
    const handler = (): void => {
      const view = this.lobby();
      if (view) cb(view);
    };
    room.onStateChange(handler);
    return () => room.onStateChange.remove(handler);
  }

  async leave(): Promise<void> {
    clearInterval(this.pingTimer);
    this.lane?.close();
    this.lane = null;
    const room = this.room;
    this.room = null;
    if (room) await room.leave(true).catch(() => undefined);
    this.setStatus('closed');
  }
}
