import { Client, type Room } from '@colyseus/sdk';
import { FastLane } from '../../net/fastlane';
import { defaultServerUrl } from '../../net/serverUrl';
import type { Stroke } from '../sim/match';
import { packArm, type LiveArm } from '../sim/arm';
import { PD_ROOM, PD_VERSION, PdMsg, type PdBegin, type PdConfig, type PdJoin, type PdLobby, type MatchEvent } from './protocol';

/** Padel room connection: lobby, start, frames, events; movement on the fast lane, strokes reliable. */
export class PadelNet {
  readonly url = defaultServerUrl();
  private readonly sdk = new Client(this.url);
  room: Room | null = null;
  lobby: PdLobby | null = null;
  lan = false;
  rtt = 0;
  onLobby: ((l: PdLobby) => void) | null = null;
  onBegin: ((b: PdBegin) => void) | null = null;
  onFrame: ((f: Float32Array) => void) | null = null;
  onEvents: ((e: MatchEvent[]) => void) | null = null;
  onError: ((msg: string) => void) | null = null;
  onClosed: ((reason?: string) => void) | null = null;
  private pingTimer = 0;
  lane: FastLane | null = null;
  private seq = 0;
  private recent: Array<[number, number, number, number]> = [];
  private lastSend = 0;

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

  async create(name: string, racket: string): Promise<void> {
    const o: PdJoin = { version: PD_VERSION, name, racket, visibility: 'private' };
    this.attach(await this.sdk.create(PD_ROOM, o));
  }
  async quick(name: string, racket: string): Promise<void> {
    const o: PdJoin = { version: PD_VERSION, name, racket, visibility: 'public' };
    this.attach(await this.sdk.joinOrCreate(PD_ROOM, o));
  }
  async join(code: string, name: string, racket: string): Promise<void> {
    const o: PdJoin = { version: PD_VERSION, name, racket };
    this.attach(await this.sdk.joinById(code.trim().toUpperCase(), o));
  }

  private attach(room: Room): void {
    this.room = room;
    const lane = (this.lane = new FastLane(room));
    room.onMessage(PdMsg.Lobby, (l: PdLobby) => {
      this.lobby = l;
      this.lan = l.lan;
      this.onLobby?.(l);
    });
    room.onMessage(PdMsg.Begin, (b: PdBegin) => this.onBegin?.(b));
    lane.on(
      PdMsg.Snap,
      (bytes: Uint8Array) => {
        const f = new Float32Array(bytes.byteLength / 4);
        new Uint8Array(f.buffer).set(bytes);
        this.onFrame?.(f);
      },
      { latestOnly: true },
    );
    room.onMessage(PdMsg.Events, (e: MatchEvent[]) => this.onEvents?.(e));
    lane.on(PdMsg.Ping, (m: { t: number }) => {
      const rtt = performance.now() - m.t;
      this.rtt = this.rtt ? this.rtt * 0.8 + rtt * 0.2 : rtt;
    });
    room.onMessage(PdMsg.Error, (m: { msg: string }) => this.onError?.(m.msg));
    room.onLeave((code: number, reason?: string) => {
      this.room = null;
      clearInterval(this.pingTimer);
      this.onClosed?.(reason || (code >= 4000 ? `Disconnected (${code})` : undefined));
    });
    room.send(PdMsg.Hello);
    this.pingTimer = window.setInterval(() => this.room && this.lane?.send(PdMsg.Ping, { t: performance.now() }), 1000);
  }

  /** Per render frame: movement (rate-limited to 60 Hz, last few riding along) and any stroke (reliable). */
  input(mv: { mx: number; mz: number; auto: boolean }, stroke: Stroke | null, arm: LiveArm | null = null): void {
    if (!this.room) return;
    if (stroke) this.room.send(PdMsg.Stroke, stroke);
    const now = performance.now();
    if (now - this.lastSend < 15) return;
    this.lastSend = now;
    this.recent.push([++this.seq, mv.mx, mv.mz, mv.auto ? 1 : 0]);
    if (this.recent.length > 4) this.recent.shift();
    this.lane?.send(PdMsg.Move, { r: this.recent, a: arm ? packArm(arm).map((v) => Math.round(v * 1000) / 1000) : null });
  }
  config(c: Partial<PdConfig>): void {
    this.room?.send(PdMsg.Config, c);
  }
  team(team: 0 | 1): void {
    this.room?.send(PdMsg.Team, { team });
  }
  start(): void {
    this.room?.send(PdMsg.Start);
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
