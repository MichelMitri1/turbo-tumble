import { Client, type Room } from '@colyseus/sdk';
import { defaultServerUrl } from '../../net/serverUrl';
import type { Action, GameEvent } from '../engine';
import type { View } from '../view';
import type { Aim, GameLink } from '../link';
import { PL_ROOM, PL_VERSION, PlMsg, type PlConfig, type PlJoin, type PlLobby, type PlState } from './protocol';

/** Pool room connection (lobby + game messages + live aim). */
export class PoolNet {
  readonly url = defaultServerUrl();
  private readonly sdk = new Client(this.url);
  room: Room | null = null;
  lobby: PlLobby | null = null;
  onLobby: ((l: PlLobby) => void) | null = null;
  onState: ((s: PlState) => void) | null = null;
  onAim: ((a: Aim) => void) | null = null;
  onError: ((msg: string) => void) | null = null;
  /** The socket dropped; the SDK is retrying with the reconnection token (the server holds the seat 30 s). */
  onDrop: (() => void) | null = null;
  onReconnect: (() => void) | null = null;
  onClosed: ((reason?: string) => void) | null = null;
  backlog: PlState[] = [];

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

  async create(name: string, avatar: number): Promise<void> {
    const o: PlJoin = { version: PL_VERSION, name, avatar, visibility: 'private' };
    this.attach(await this.sdk.create(PL_ROOM, o));
  }
  async quick(name: string, avatar: number): Promise<void> {
    const o: PlJoin = { version: PL_VERSION, name, avatar, visibility: 'public' };
    this.attach(await this.sdk.joinOrCreate(PL_ROOM, o));
  }
  async join(code: string, name: string, avatar: number): Promise<void> {
    const o: PlJoin = { version: PL_VERSION, name, avatar };
    this.attach(await this.sdk.joinById(code.toUpperCase(), o));
  }

  private attach(room: Room): void {
    this.room = room;
    // Retry for about as long as the server keeps the seat (30 s): 0.2 + 0.4 + 0.8 + 1.6 + 3 s, then every 3 s.
    room.reconnection.maxDelay = 3000;
    room.reconnection.maxRetries = 13;
    room.reconnection.minUptime = 1000;
    room.onDrop(() => this.onDrop?.());
    room.onReconnect(() => this.onReconnect?.());
    room.onMessage(PlMsg.Lobby, (l: PlLobby) => {
      this.lobby = l;
      this.onLobby?.(l);
    });
    room.onMessage(PlMsg.State, (s: PlState) => {
      if (this.onState) this.onState(s);
      else this.backlog.push(s);
    });
    room.onMessage(PlMsg.Aim, (a: Aim) => this.onAim?.(a));
    room.onMessage(PlMsg.Error, (m: { msg: string }) => this.onError?.(m.msg));
    room.onLeave((code: number, reason?: string) => {
      this.room = null;
      this.onClosed?.(reason || (code >= 4000 ? `Disconnected (${code})` : undefined));
    });
  }

  act(a: Action): void {
    this.room?.send(PlMsg.Act, a);
  }
  aim(a: Aim): void {
    this.room?.send(PlMsg.Aim, a);
  }
  config(c: Partial<PlConfig>): void {
    this.room?.send(PlMsg.Config, c);
  }
  start(): void {
    this.room?.send(PlMsg.Start);
  }
  async leave(): Promise<void> {
    const r = this.room;
    this.room = null;
    if (r) await r.leave(true).catch(() => undefined);
  }
}

export class OnlineLink implements GameLink {
  readonly online = true;
  view: View | null = null;
  onUpdate: GameLink['onUpdate'] = null;
  onError: GameLink['onError'] = null;
  onAim: GameLink['onAim'] = null;
  private lastAim = 0;

  constructor(private readonly net: PoolNet) {
    net.onState = (s) => this.receive(s);
    net.onAim = (a) => this.onAim?.(a);
    queueMicrotask(() => {
      for (const s of net.backlog.splice(0)) this.receive(s);
    });
  }

  get me(): string {
    return this.net.sessionId;
  }

  private receive(s: PlState): void {
    this.view = s.view;
    this.onUpdate?.(s.view, s.events as GameEvent[]);
  }

  send(a: Action): void {
    this.net.act(a);
  }
  /** Throttled to ~15 Hz. */
  aim(a: Aim): void {
    const now = performance.now();
    if (now - this.lastAim < 66) return;
    this.lastAim = now;
    this.net.aim(a);
  }
  tick(): void {}
  dispose(): void {
    this.onUpdate = null;
    if (this.net.onState) this.net.onState = null;
    this.net.onAim = null;
  }
}
