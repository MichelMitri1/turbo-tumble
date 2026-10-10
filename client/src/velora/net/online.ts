import { Client, type Room } from '@colyseus/sdk';
import { defaultServerUrl } from '../../net/serverUrl';
import { FastLane } from '../../net/fastlane';
import { VL_ROOM, VL_VERSION, VlMsg, type CarState, type Hit, type PlayerState, type RemoteState, type Shot, type VlJoin, type Welcome } from './protocol';

/** The connection to a Velora Online session. */
export class VeloraNet {
  readonly url = defaultServerUrl();
  private readonly sdk = new Client(this.url);
  room: Room | null = null;
  welcome: Welcome | null = null;
  onSnap: ((players: RemoteState[], t: number) => void) | null = null;
  onHit: ((h: Hit & { from: string }) => void) | null = null;
  onCarHit: ((dmg: number, from: string) => void) | null = null;
  onShot: ((s: Shot & { from: string }) => void) | null = null;
  onBoom: ((b: { x: number; y: number; z: number; from: string }) => void) | null = null;
  onFeed: ((f: { text: string; kind: string }) => void) | null = null;
  onGranted: ((car: CarState) => void) | null = null;
  onRelease: (() => void) | null = null;
  onChat: ((c: { from: string; name: string; text: string }) => void) | null = null;
  onClosed: ((reason?: string) => void) | null = null;

  get me(): string {
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

  private async attach(p: Promise<Room>): Promise<Welcome> {
    const room = await p;
    this.room = room;
    const welcome = new Promise<Welcome>((res) => room.onMessage(VlMsg.Welcome, (w: Welcome) => res((this.welcome = w))));
    this.lane = new FastLane(room);
    this.lane.on(VlMsg.Snap, (s: { t: number; players: RemoteState[] }) => this.onSnap?.(s.players, s.t), { latestOnly: true });
    room.onMessage(VlMsg.Hit, (h: Hit & { from: string }) => this.onHit?.(h));
    room.onMessage(VlMsg.CarHit, (h: { dmg: number; from: string }) => this.onCarHit?.(h.dmg, h.from));
    room.onMessage(VlMsg.Shot, (s: Shot & { from: string }) => this.onShot?.(s));
    room.onMessage(VlMsg.Boom, (b: { x: number; y: number; z: number; from: string }) => this.onBoom?.(b));
    room.onMessage(VlMsg.Feed, (f: { text: string; kind: string }) => this.onFeed?.(f));
    room.onMessage(VlMsg.Granted, (g: { car: CarState }) => this.onGranted?.(g.car));
    room.onMessage(VlMsg.Release, () => this.onRelease?.());
    room.onMessage(VlMsg.Chat, (c: { from: string; name: string; text: string }) => this.onChat?.(c));
    room.onMessage(VlMsg.Error, () => undefined);
    room.onLeave((code: number, reason?: string) => {
      this.room = null;
      this.onClosed?.(reason || (code >= 4000 ? `Disconnected (${code})` : undefined));
    });
    return welcome;
  }

  create(name: string, model: string): Promise<Welcome> {
    const o: VlJoin = { version: VL_VERSION, name, model, visibility: 'private' };
    return this.attach(this.sdk.create(VL_ROOM, o));
  }
  quick(name: string, model: string): Promise<Welcome> {
    const o: VlJoin = { version: VL_VERSION, name, model, visibility: 'public' };
    return this.attach(this.sdk.joinOrCreate(VL_ROOM, o));
  }
  join(code: string, name: string, model: string): Promise<Welcome> {
    const o: VlJoin = { version: VL_VERSION, name, model };
    return this.attach(this.sdk.joinById(code.trim().toUpperCase(), o));
  }

  lane: FastLane | null = null;
  state(s: PlayerState): void {
    if (this.room) this.lane?.send(VlMsg.State, s);
  }
  hit(target: string, dmg: number, what: string): void {
    this.room?.send(VlMsg.Hit, { target, dmg, what });
  }
  carHit(owner: string, dmg: number): void {
    this.room?.send(VlMsg.CarHit, { owner, dmg });
  }
  shot(s: Shot): void {
    this.room?.send(VlMsg.Shot, s);
  }
  boom(x: number, y: number, z: number): void {
    this.room?.send(VlMsg.Boom, { x, y, z });
  }
  died(by: string | null): void {
    this.room?.send(VlMsg.Died, { by });
  }
  claim(owner: string): void {
    this.room?.send(VlMsg.Claim, { owner });
  }
  chat(text: string): void {
    this.room?.send(VlMsg.Chat, { text });
  }
  async leave(): Promise<void> {
    const r = this.room;
    this.room = null;
    this.lane?.close();
    this.lane = null;
    if (r) await r.leave(true).catch(() => undefined);
  }
}
