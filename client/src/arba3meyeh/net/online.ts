import { Client, type Room } from '@colyseus/sdk';
import { defaultServerUrl } from '../../net/serverUrl';
import type { Action, GameEvent } from '../engine';
import type { GameLink } from '../link';
import type { View } from '../view';
import { FH_ROOM, FH_VERSION, FhMsg, type FhConfig, type FhJoin, type FhLobby, type FhState } from './protocol';

/** 400 room connection (lobby + game messages). */
export class FourHundredNet {
  readonly url = defaultServerUrl();
  private readonly sdk = new Client(this.url);
  room: Room | null = null;
  lobby: FhLobby | null = null;
  onLobby: ((l: FhLobby) => void) | null = null;
  onState: ((s: FhState) => void) | null = null;
  onError: ((msg: string) => void) | null = null;
  onClosed: ((reason?: string) => void) | null = null;
  backlog: FhState[] = [];

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
    this.attach(await this.sdk.create(FH_ROOM, { version: FH_VERSION, name, avatar, visibility: 'private' } satisfies FhJoin));
  }
  async quick(name: string, avatar: number): Promise<void> {
    this.attach(await this.sdk.joinOrCreate(FH_ROOM, { version: FH_VERSION, name, avatar, visibility: 'public' } satisfies FhJoin));
  }
  async join(code: string, name: string, avatar: number): Promise<void> {
    this.attach(await this.sdk.joinById(code.toUpperCase(), { version: FH_VERSION, name, avatar } satisfies FhJoin));
  }

  private attach(room: Room): void {
    this.room = room;
    room.onMessage(FhMsg.Lobby, (l: FhLobby) => {
      this.lobby = l;
      this.onLobby?.(l);
    });
    room.onMessage(FhMsg.State, (s: FhState) => {
      if (this.onState) this.onState(s);
      else this.backlog.push(s);
    });
    room.onMessage(FhMsg.Error, (m: { msg: string }) => this.onError?.(m.msg));
    room.onLeave((code: number, reason?: string) => {
      this.room = null;
      this.onClosed?.(reason || (code >= 4000 ? `Disconnected (${code})` : undefined));
    });
  }

  act(a: Action): void {
    this.room?.send(FhMsg.Act, a);
  }
  config(c: Partial<FhConfig>): void {
    this.room?.send(FhMsg.Config, c);
  }
  seat(seat: number): void {
    this.room?.send(FhMsg.Seat, { seat });
  }
  start(): void {
    this.room?.send(FhMsg.Start);
  }
  rematch(): void {
    this.room?.send(FhMsg.Rematch);
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
  private readonly handler = (s: FhState) => this.receive(s);

  constructor(private readonly net: FourHundredNet) {
    net.onState = this.handler;
    queueMicrotask(() => {
      for (const s of net.backlog.splice(0)) this.receive(s);
    });
  }
  get me(): string {
    return this.net.sessionId;
  }
  private receive(s: FhState): void {
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
