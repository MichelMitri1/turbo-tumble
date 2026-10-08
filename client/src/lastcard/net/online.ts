import { Client, type Room } from '@colyseus/sdk';
import { defaultServerUrl } from '../../net/serverUrl';
import type { Action, GameEvent } from '../engine';
import type { View } from '../view';
import type { GameLink } from '../link';
import { LC_ROOM, LC_VERSION, LcMsg, type LcConfig, type LcJoin, type LcLobby, type LcState } from './protocol';

/** Last Card room connection (lobby + game messages). */
export class LastCardNet {
  readonly url = defaultServerUrl();
  private readonly sdk = new Client(this.url);
  room: Room | null = null;
  lobby: LcLobby | null = null;
  onLobby: ((l: LcLobby) => void) | null = null;
  onState: ((s: LcState) => void) | null = null;
  onError: ((msg: string) => void) | null = null;
  onClosed: ((reason?: string) => void) | null = null;
  /** States that arrived before the table attached. */
  backlog: LcState[] = [];

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
    const o: LcJoin = { version: LC_VERSION, name, avatar, visibility: 'private' };
    this.attach(await this.sdk.create(LC_ROOM, o));
  }
  async quick(name: string, avatar: number): Promise<void> {
    const o: LcJoin = { version: LC_VERSION, name, avatar, visibility: 'public' };
    this.attach(await this.sdk.joinOrCreate(LC_ROOM, o));
  }
  async join(code: string, name: string, avatar: number): Promise<void> {
    const o: LcJoin = { version: LC_VERSION, name, avatar };
    this.attach(await this.sdk.joinById(code.toUpperCase(), o));
  }

  private attach(room: Room): void {
    this.room = room;
    room.onMessage(LcMsg.Lobby, (l: LcLobby) => {
      this.lobby = l;
      this.onLobby?.(l);
    });
    room.onMessage(LcMsg.State, (s: LcState) => {
      if (this.onState) this.onState(s);
      else this.backlog.push(s);
    });
    room.onMessage(LcMsg.Error, (m: { msg: string }) => this.onError?.(m.msg));
    room.onLeave((code: number, reason?: string) => {
      this.room = null;
      this.onClosed?.(reason || (code >= 4000 ? `Disconnected (${code})` : undefined));
    });
  }

  act(a: Action): void {
    this.room?.send(LcMsg.Act, a);
  }
  config(c: Partial<LcConfig>): void {
    this.room?.send(LcMsg.Config, c);
  }
  start(): void {
    this.room?.send(LcMsg.Start);
  }
  rematch(): void {
    this.room?.send(LcMsg.Rematch);
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

  private readonly handler = (s: LcState) => this.receive(s);

  constructor(private readonly net: LastCardNet) {
    net.onState = this.handler;
    queueMicrotask(() => {
      for (const s of net.backlog.splice(0)) this.receive(s);
    });
  }

  get me(): string {
    return this.net.sessionId;
  }

  private receive(s: LcState): void {
    this.view = s.view;
    this.onUpdate?.(s.view, s.events as GameEvent[], s.views ?? []);
  }

  send(a: Action): void {
    this.net.act(a);
  }
  tick(): void {}
  hold(): void {}
  readonly holdLeft = 0;
  dispose(): void {
    this.onUpdate = null;
    // Only detach our own handler (a rematch link may already have replaced it).
    if (this.net.onState === this.handler) this.net.onState = null;
  }
}
