import { Client, type Room } from '@colyseus/sdk';
import { defaultServerUrl } from '../../net/serverUrl';
import type { Action, GameEvent } from '../engine';
import type { View } from '../view';
import type { GameLink } from '../link';
import { JK_ROOM, JK_VERSION, JkMsg, type JkConfig, type JkJoin, type JkLobby, type JkState } from './protocol';

/** Jackaroo room connection (lobby + game messages, automatic reconnection). */
export class JackarooNet {
  readonly url = defaultServerUrl();
  private readonly sdk = new Client(this.url);
  room: Room | null = null;
  lobby: JkLobby | null = null;
  onLobby: ((l: JkLobby) => void) | null = null;
  onState: ((s: JkState) => void) | null = null;
  onError: ((msg: string) => void) | null = null;
  /** The socket dropped; the SDK retries with the reconnection token (the server holds the seat 30 s). */
  onDrop: (() => void) | null = null;
  onReconnect: (() => void) | null = null;
  onClosed: ((reason?: string) => void) | null = null;
  backlog: JkState[] = [];

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
    const o: JkJoin = { version: JK_VERSION, name, avatar, visibility: 'private' };
    this.attach(await this.sdk.create(JK_ROOM, o));
  }
  async quick(name: string, avatar: number): Promise<void> {
    const o: JkJoin = { version: JK_VERSION, name, avatar, visibility: 'public' };
    this.attach(await this.sdk.joinOrCreate(JK_ROOM, o));
  }
  async join(code: string, name: string, avatar: number): Promise<void> {
    const o: JkJoin = { version: JK_VERSION, name, avatar };
    this.attach(await this.sdk.joinById(code.toUpperCase(), o));
  }

  private attach(room: Room): void {
    this.room = room;
    // Retry for about as long as the server keeps the seat (30 s).
    room.reconnection.maxDelay = 3000;
    room.reconnection.maxRetries = 13;
    room.reconnection.minUptime = 1000;
    room.onDrop(() => this.onDrop?.());
    room.onReconnect(() => this.onReconnect?.());
    room.onMessage(JkMsg.Lobby, (l: JkLobby) => {
      this.lobby = l;
      this.onLobby?.(l);
    });
    room.onMessage(JkMsg.State, (s: JkState) => {
      if (this.onState) this.onState(s);
      else this.backlog.push(s);
    });
    room.onMessage(JkMsg.Error, (m: { msg: string }) => this.onError?.(m.msg));
    room.onLeave((code: number, reason?: string) => {
      this.room = null;
      this.onClosed?.(reason || (code >= 4000 ? `Disconnected (${code})` : undefined));
    });
  }

  act(a: Action): void {
    this.room?.send(JkMsg.Act, a);
  }
  seat(seat: number): void {
    this.room?.send(JkMsg.Seat, { seat });
  }
  config(c: Partial<JkConfig>): void {
    this.room?.send(JkMsg.Config, c);
  }
  start(): void {
    this.room?.send(JkMsg.Start);
  }
  rematch(): void {
    this.room?.send(JkMsg.Rematch);
  }
  async leave(): Promise<void> {
    const r = this.room;
    this.room = null;
    if (r) await r.leave(true).catch(() => undefined);
  }
}

/** The table's view of an online game: the server sends views + events. */
export class OnlineLink implements GameLink {
  readonly online = true;
  view: View | null = null;
  onUpdate: GameLink['onUpdate'] = null;
  onError: GameLink['onError'] = null;
  private readonly handler = (s: JkState) => this.receive(s);

  constructor(private readonly net: JackarooNet) {
    net.onState = this.handler;
    queueMicrotask(() => {
      for (const s of net.backlog.splice(0)) this.receive(s);
    });
  }

  get me(): string {
    return this.net.sessionId;
  }

  private receive(s: JkState): void {
    this.view = s.view;
    this.onUpdate?.(s.view, s.events as GameEvent[], s.views ?? []);
  }

  send(a: Action): void {
    this.net.act(a);
  }
  tick(): void {}
  dispose(): void {
    this.onUpdate = null;
    if (this.net.onState === this.handler) this.net.onState = null;
  }
}
