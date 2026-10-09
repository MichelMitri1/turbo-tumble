import { Client, type Room } from '@colyseus/sdk';
import { defaultServerUrl } from '../../net/serverUrl';
import type { Action } from '../sim/game';
import { SF_ROOM, SF_VERSION, SfMsg, type SfBegin, type SfConfig, type SfJoin, type SfLobby, type SfMove, type SfSnap } from './protocol';

/** Starfall room connection (lobby + game messages). */
export class StarfallNet {
  readonly url = defaultServerUrl();
  private readonly sdk = new Client(this.url);
  room: Room | null = null;
  lobby: SfLobby | null = null;
  onLobby: ((l: SfLobby) => void) | null = null;
  onBegin: ((b: SfBegin) => void) | null = null;
  onSnap: ((s: SfSnap) => void) | null = null;
  onError: ((msg: string) => void) | null = null;
  onClosed: ((reason?: string) => void) | null = null;

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

  async create(name: string, color: number): Promise<void> {
    const o: SfJoin = { version: SF_VERSION, name, color, visibility: 'private' };
    this.attach(await this.sdk.create(SF_ROOM, o));
  }
  async quick(name: string, color: number): Promise<void> {
    const o: SfJoin = { version: SF_VERSION, name, color, visibility: 'public' };
    this.attach(await this.sdk.joinOrCreate(SF_ROOM, o));
  }
  async join(code: string, name: string, color: number): Promise<void> {
    const o: SfJoin = { version: SF_VERSION, name, color };
    this.attach(await this.sdk.joinById(code.trim().toUpperCase(), o));
  }

  private attach(room: Room): void {
    this.room = room;
    room.onMessage(SfMsg.Lobby, (l: SfLobby) => {
      this.lobby = l;
      this.onLobby?.(l);
    });
    room.onMessage(SfMsg.Begin, (b: SfBegin) => this.onBegin?.(b));
    room.onMessage(SfMsg.Snap, (s: SfSnap) => this.onSnap?.(s));
    room.onMessage(SfMsg.Error, (m: { msg: string }) => this.onError?.(m.msg));
    room.onLeave((code: number, reason?: string) => {
      this.room = null;
      this.onClosed?.(reason || (code >= 4000 ? `Disconnected (${code})` : undefined));
    });
  }

  act(a: Action): void {
    this.room?.send(SfMsg.Act, a);
  }
  move(m: SfMove): void {
    this.room?.send(SfMsg.Move, m);
  }
  config(c: Partial<SfConfig>): void {
    this.room?.send(SfMsg.Config, c);
  }
  look(name: string, color: number): void {
    this.room?.send(SfMsg.Look, { name, color });
  }
  start(): void {
    this.room?.send(SfMsg.Start);
  }
  async leave(): Promise<void> {
    const r = this.room;
    this.room = null;
    if (r) await r.leave(true).catch(() => undefined);
  }
}
