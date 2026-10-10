import { Client, type Room } from '@colyseus/sdk';
import { FastLane } from '../../net/fastlane';
import { defaultServerUrl } from '../../net/serverUrl';
import { FB_VERSION, FB_ROOM, FbMsg, type FbBegin, type FbConfig, type FbInput, type FbJoin, type FbLobby, type FbStats, type MatchEvent } from './protocol';

/** Matchday room connection: lobby, kick-off, frames, events. */
export class FootballNet {
  readonly url = defaultServerUrl();
  private readonly sdk = new Client(this.url);
  room: Room | null = null;
  lobby: FbLobby | null = null;
  rtt = 0;
  onLobby: ((l: FbLobby) => void) | null = null;
  onBegin: ((b: FbBegin) => void) | null = null;
  onFrame: ((f: Float32Array) => void) | null = null;
  onEvents: ((e: MatchEvent[]) => void) | null = null;
  onStats: ((s: FbStats) => void) | null = null;
  onError: ((msg: string) => void) | null = null;
  onClosed: ((reason?: string) => void) | null = null;
  private pingTimer = 0;

  get sessionId(): string {
    return this.room?.sessionId ?? '';
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

  async create(name: string): Promise<void> {
    const o: FbJoin = { version: FB_VERSION, name, visibility: 'private' };
    this.attach(await this.sdk.create(FB_ROOM, o));
  }
  async quick(name: string): Promise<void> {
    const o: FbJoin = { version: FB_VERSION, name, visibility: 'public' };
    this.attach(await this.sdk.joinOrCreate(FB_ROOM, o));
  }
  async join(code: string, name: string): Promise<void> {
    const o: FbJoin = { version: FB_VERSION, name };
    this.attach(await this.sdk.joinById(code.trim().toUpperCase(), o));
  }

  /** Unreliable fast lane (WebRTC) for frames / inputs / pings. */
  lane: FastLane | null = null;
  private seq = 0;
  private recent: Array<[number, number, number, number]> = [];

  private attach(room: Room): void {
    this.room = room;
    const lane = (this.lane = new FastLane(room));
    room.onMessage(FbMsg.Lobby, (l: FbLobby) => {
      this.lobby = l;
      this.onLobby?.(l);
    });
    room.onMessage(FbMsg.Begin, (b: FbBegin) => this.onBegin?.(b));
    lane.on(FbMsg.Snap, (bytes: Uint8Array) => {
      const f = new Float32Array(bytes.byteLength / 4);
      new Uint8Array(f.buffer).set(bytes);
      this.onFrame?.(f);
    }, { latestOnly: true });
    room.onMessage(FbMsg.Events, (e: MatchEvent[]) => this.onEvents?.(e));
    room.onMessage(FbMsg.Stats, (s: FbStats) => this.onStats?.(s));
    lane.on(FbMsg.Ping, (m: { t: number }) => {
      const rtt = performance.now() - m.t;
      this.rtt = this.rtt ? this.rtt * 0.8 + rtt * 0.2 : rtt;
    });
    room.onMessage(FbMsg.Error, (m: { msg: string }) => this.onError?.(m.msg));
    room.onLeave((code: number, reason?: string) => {
      this.room = null;
      clearInterval(this.pingTimer);
      this.onClosed?.(reason || (code >= 4000 ? `Disconnected (${code})` : undefined));
    });
    room.send(FbMsg.Hello);
    this.pingTimer = window.setInterval(() => this.room && this.lane?.send(FbMsg.Ping, { t: performance.now() }), 1000);
  }

  /** Each tick's input, with the last few riding along (the server takes each seq once). */
  input(i: FbInput): void {
    if (!this.room) return;
    this.recent.push([++this.seq, i.x, i.z, i.b]);
    if (this.recent.length > 5) this.recent.shift();
    this.lane?.send(FbMsg.Input, { r: this.recent });
  }
  config(c: Partial<FbConfig>): void {
    this.room?.send(FbMsg.Config, c);
  }
  team(team: 0 | 1): void {
    this.room?.send(FbMsg.Team, { team });
  }
  start(): void {
    this.room?.send(FbMsg.Start);
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
