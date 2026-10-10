import { Client, type Room } from '@colyseus/sdk';
import { FastLane } from '../../net/fastlane';
import { defaultServerUrl } from '../../net/serverUrl';
import type { CarId } from '../sim/constants';
import { RB_ROOM, RB_VERSION, RbMsg, type RbBegin, type RbChat, type RbConfig, type RbInput, type RbJoin, type RbLobby, type Stats, type WorldEvent } from './protocol';

/** Boostball room connection: lobby, match start, snapshots, events. */
export class RocketNet {
  readonly url = defaultServerUrl();
  private readonly sdk = new Client(this.url);
  room: Room | null = null;
  lobby: RbLobby | null = null;
  rtt = 0;
  onLobby: ((l: RbLobby) => void) | null = null;
  onBegin: ((b: RbBegin) => void) | null = null;
  onSnap: ((s: Float32Array) => void) | null = null;
  onEvents: ((e: WorldEvent[]) => void) | null = null;
  onStats: ((s: Array<[number, Stats]>) => void) | null = null;
  onChat: ((c: RbChat) => void) | null = null;
  onError: ((msg: string) => void) | null = null;
  onClosed: ((reason?: string) => void) | null = null;
  private pingTimer = 0;

  get sessionId(): string {
    return this.room?.sessionId ?? '';
  }
  get code(): string {
    return this.room?.roomId ?? '';
  }

  async probe(): Promise<{ ok: boolean; lan: string[] | null }> {
    try {
      const res = await fetch(`${this.url.replace(/^ws/, 'http')}/health`, { signal: AbortSignal.timeout(2500) });
      const info = (await res.json()) as { lan?: string[] };
      return { ok: res.ok, lan: info.lan ?? null };
    } catch {
      return { ok: false, lan: null };
    }
  }

  async create(name: string, body: CarId): Promise<void> {
    const o: RbJoin = { version: RB_VERSION, name, body, visibility: 'private' };
    this.attach(await this.sdk.create(RB_ROOM, o));
  }
  async quick(name: string, body: CarId): Promise<void> {
    const o: RbJoin = { version: RB_VERSION, name, body, visibility: 'public' };
    this.attach(await this.sdk.joinOrCreate(RB_ROOM, o));
  }
  async join(code: string, name: string, body: CarId): Promise<void> {
    const o: RbJoin = { version: RB_VERSION, name, body };
    this.attach(await this.sdk.joinById(code.toUpperCase(), o));
  }

  /** Unreliable fast lane (WebRTC) for snapshots / inputs / pings. */
  lane: FastLane | null = null;

  private attach(room: Room): void {
    this.room = room;
    const lane = (this.lane = new FastLane(room));
    room.onMessage(RbMsg.Lobby, (l: RbLobby) => {
      this.lobby = l;
      this.onLobby?.(l);
    });
    room.onMessage(RbMsg.Begin, (b: RbBegin) => this.onBegin?.(b));
    lane.on(RbMsg.Snap, (bytes: Uint8Array) => {
      // Copy into an aligned buffer.
      const f = new Float32Array(bytes.byteLength / 4);
      new Uint8Array(f.buffer).set(bytes);
      this.onSnap?.(f);
    }, { latestOnly: true });
    room.onMessage(RbMsg.Events, (e: WorldEvent[]) => this.onEvents?.(e));
    room.onMessage(RbMsg.Stats, (s: Array<[number, Stats]>) => this.onStats?.(s));
    room.onMessage(RbMsg.Chat, (c: RbChat) => this.onChat?.(c));
    lane.on(RbMsg.Ping, (m: { t: number }) => {
      const rtt = performance.now() - m.t;
      this.rtt = this.rtt ? this.rtt * 0.8 + rtt * 0.2 : rtt;
    });
    room.onMessage(RbMsg.Error, (m: { msg: string }) => this.onError?.(m.msg));
    room.onLeave((code: number, reason?: string) => {
      this.room = null;
      clearInterval(this.pingTimer);
      this.onClosed?.(reason || (code >= 4000 ? `Disconnected (${code})` : undefined));
    });
    lane.send(RbMsg.Ping, { t: performance.now() });
    this.pingTimer = window.setInterval(() => this.room && this.lane?.send(RbMsg.Ping, { t: performance.now() }), 1000);
  }

  input(i: RbInput): void {
    if (this.room) this.lane?.send(RbMsg.Input, i);
  }
  config(c: Partial<RbConfig>): void {
    this.room?.send(RbMsg.Config, c);
  }
  team(team: 0 | 1): void {
    this.room?.send(RbMsg.Team, { team });
  }
  body(body: CarId): void {
    this.room?.send(RbMsg.Body, { body });
  }
  chat(g: number, i: number): void {
    this.room?.send(RbMsg.Chat, { g, i });
  }
  start(): void {
    this.room?.send(RbMsg.Start);
  }
  async leave(): Promise<void> {
    const r = this.room;
    this.room = null;
    clearInterval(this.pingTimer);
    this.lane?.close();
    this.lane = null;
    if (r) await r.leave(true).catch(() => undefined);
  }
}
