import { Client, type Room } from '@colyseus/sdk';
import { defaultServerUrl } from '../../net/serverUrl';
import { normalizeRoomCode } from '@shared/net/Protocol';
import { CF_ROOM, CF_VERSION, CfMsg, type CfCreateOptions, type CfJoinOptions, type CfLobbyView, type CfStart } from './protocol';
import type { Snapshot } from './codec';

export type NetStatus = 'connected' | 'reconnecting' | 'closed';

/** Crownfall's connection: create / join / quick-match a 1v1 room and talk to it. */
export class CrownfallNet {
  readonly url = defaultServerUrl();
  private readonly sdk = new Client(this.url);
  room: Room | null = null;
  status: NetStatus = 'closed';
  rtt = 0;
  lobby: CfLobbyView | null = null;
  onLobby: ((v: CfLobbyView) => void) | null = null;
  onStart: ((s: CfStart) => void) | null = null;
  onSnap: ((s: Snapshot) => void) | null = null;
  onNope: ((cardId: string) => void) | null = null;
  onStatus: ((s: NetStatus, reason?: string) => void) | null = null;
  private pingTimer = 0;

  get sessionId(): string {
    return this.room?.sessionId ?? '';
  }

  get code(): string {
    return this.room?.roomId ?? '';
  }

  /** Is the game server up, and is it a LAN server (`npm run lan`)? */
  async probe(): Promise<{ ok: boolean; lan: string[] | null }> {
    try {
      const res = await fetch(`${this.url.replace(/^ws/, 'http')}/health`, { signal: AbortSignal.timeout(2500) });
      const info = (await res.json()) as { lan?: string[] };
      return { ok: res.ok, lan: info.lan ?? null };
    } catch {
      return { ok: false, lan: null };
    }
  }

  async create(name: string, deck: string[]): Promise<void> {
    const o: CfCreateOptions = { version: CF_VERSION, name, deck, visibility: 'private' };
    this.attach(await this.sdk.create(CF_ROOM, o));
  }

  async quickMatch(name: string, deck: string[]): Promise<void> {
    const o: CfCreateOptions = { version: CF_VERSION, name, deck, visibility: 'public' };
    this.attach(await this.sdk.joinOrCreate(CF_ROOM, o));
  }

  async join(code: string, name: string, deck: string[]): Promise<void> {
    const o: CfJoinOptions = { version: CF_VERSION, name, deck };
    this.attach(await this.sdk.joinById(normalizeRoomCode(code), o));
  }

  private attach(room: Room): void {
    this.room = room;
    this.setStatus('connected');
    room.onMessage(CfMsg.Lobby, (v: CfLobbyView) => {
      this.lobby = v;
      this.onLobby?.(v);
    });
    room.onMessage(CfMsg.Start, (s: CfStart) => this.onStart?.(s));
    room.onMessage(CfMsg.Snap, (s: Snapshot) => this.onSnap?.(s));
    room.onMessage(CfMsg.Nope, (m: { cardId: string }) => this.onNope?.(m.cardId));
    room.onDrop(() => this.setStatus('reconnecting'));
    room.onReconnect(() => this.setStatus('connected'));
    room.onLeave((code: number, reason?: string) => {
      this.room = null;
      clearInterval(this.pingTimer);
      this.setStatus('closed', reason || (code >= 4000 ? `Disconnected (${code})` : undefined));
    });
    this.pingTimer = window.setInterval(() => {
      if (this.status === 'connected') room.ping((ms: number) => (this.rtt = this.rtt ? this.rtt + (ms - this.rtt) * 0.3 : ms));
    }, 1000);
  }

  private setStatus(s: NetStatus, reason?: string): void {
    this.status = s;
    this.onStatus?.(s, reason);
  }

  play(cardId: string, x: number, y: number): void {
    this.room?.send(CfMsg.Play, { cardId, x, y });
  }

  rematch(deck: string[]): void {
    this.room?.send(CfMsg.Rematch, { deck });
  }

  emote(n: number): void {
    this.room?.send(CfMsg.Emote, { emote: n });
  }

  async leave(): Promise<void> {
    clearInterval(this.pingTimer);
    const r = this.room;
    this.room = null;
    if (r) await r.leave(true).catch(() => undefined);
    this.setStatus('closed');
  }
}
