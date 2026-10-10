import { Room, ServerError, type Client, type RoomException, type RoomMethodName } from '@colyseus/core';
import { VL_MAX, VL_VERSION, VlMsg, type CarState, type Hit, type PlayerState, type RemoteState, type Shot, type VlJoin } from '../../../client/src/velora/net/protocol';
import { claimRoomCode, releaseRoomCode } from '../matchmaking/RoomCodes';
import { LAN_MODE } from '../lan';
import { FastLane } from '../fastlane';

/**
 * A Velora Online session: everyone's character / car state relayed ~20×/s (30 on LAN),
 * hits forwarded to their target after a sanity check, explosions, kill feed, chat, and
 * parked player cars that someone else can take.
 */

interface Member {
  id: string;
  name: string;
  state: PlayerState | null;
  kills: number;
  deaths: number;
  lastChat: number;
  lastHit: Map<string, number>;
}

const clean = (raw: unknown) => String(raw ?? '').replace(/[^\p{L}\p{N} _.\-!?']/gu, '').trim().slice(0, 16) || 'Player';
const num = (v: unknown, lim = 1e5) => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim ? v : 0);
const MODELS = /^[a-z0-9-]{1,24}$/;

function parseCar(raw: unknown): CarState | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.model !== 'string' || !MODELS.test(c.model)) return null;
  return { model: c.model, paint: num(c.paint, 0xffffff) | 0, x: num(c.x), y: num(c.y), z: num(c.z), qx: num(c.qx, 1), qy: num(c.qy, 1), qz: num(c.qz, 1), qw: num(c.qw, 1), v: num(c.v, 200), siren: c.siren === true, hp: num(c.hp, 2000) };
}
function parseState(raw: unknown): PlayerState | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  return {
    x: num(s.x),
    y: num(s.y),
    z: num(s.z),
    h: num(s.h, 100),
    pose: typeof s.pose === 'string' ? s.pose.slice(0, 12) : 'idle',
    gun: typeof s.gun === 'string' ? s.gun.slice(0, 12) : '',
    alive: s.alive !== false,
    wanted: Math.max(0, Math.min(5, num(s.wanted, 5) | 0)),
    car: parseCar(s.car),
    parked: parseCar(s.parked),
    model: typeof s.model === 'string' && MODELS.test(s.model) ? s.model : 'casual',
  };
}
const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

export class VeloraRoom extends Room {
  override maxClients = VL_MAX;
  private members = new Map<string, Member>();
  private t0 = Date.now();
  private hour = 10 + Math.random() * 8;
  private acc = 0;
  private lane!: FastLane;

  override onCreate(o: VlJoin): void {
    this.roomId = claimRoomCode();
    void this.setPrivate(o?.visibility !== 'public');
    void this.setMetadata({ code: this.roomId, game: 'velora' });
    this.lane = new FastLane(this);
    this.lane.on(VlMsg.State, (c, raw: unknown) => {
      const m = this.members.get(c.sessionId);
      const s = parseState(raw);
      if (m && s) m.state = s;
    }, { latestOnly: true });
    this.onMessage(VlMsg.Hit, (c, raw: unknown) => {
      const m = this.members.get(c.sessionId);
      const h = raw as Hit;
      if (!m || !h || typeof h.target !== 'string') return;
      const t = this.members.get(h.target);
      if (!t || t === m || !m.state || !t.state || !t.state.alive) return;
      // Sanity: within range of a weapon (or a car), not absurd damage, not a flood.
      const from = m.state.car ?? m.state;
      const to = t.state.car ?? t.state;
      if (dist(from, to) > 480) return;
      const now = Date.now();
      if (now - (m.lastHit.get(t.id) ?? 0) < 40) return;
      m.lastHit.set(t.id, now);
      const dmg = Math.max(0, Math.min(400, num(h.dmg, 1000)));
      this.clientOf(t.id)?.send(VlMsg.Hit, { target: t.id, dmg, what: String(h.what ?? '').slice(0, 24), from: m.id });
    });
    this.onMessage(VlMsg.CarHit, (c, raw: unknown) => {
      const r = raw as { owner?: unknown; dmg?: unknown };
      if (typeof r?.owner !== 'string' || r.owner === c.sessionId) return;
      this.clientOf(r.owner)?.send(VlMsg.CarHit, { dmg: Math.max(0, Math.min(1500, num(r.dmg, 5000))), from: c.sessionId });
    });
    this.onMessage(VlMsg.Shot, (c, raw: unknown) => {
      const s = raw as Shot;
      if (!s) return;
      const shot: Shot & { from: string } = { fx: num(s.fx), fy: num(s.fy), fz: num(s.fz), tx: num(s.tx), ty: num(s.ty), tz: num(s.tz), sfx: typeof s.sfx === 'string' ? s.sfx.slice(0, 16) : '', rate: num(s.rate, 3), from: c.sessionId };
      this.broadcast(VlMsg.Shot, shot, { except: c });
    });
    this.onMessage(VlMsg.Boom, (c, raw: unknown) => {
      const b = raw as { x?: unknown; y?: unknown; z?: unknown };
      this.broadcast(VlMsg.Boom, { x: num(b?.x), y: num(b?.y), z: num(b?.z), from: c.sessionId }, { except: c });
    });
    this.onMessage(VlMsg.Died, (c, raw: unknown) => {
      const m = this.members.get(c.sessionId);
      if (!m) return;
      m.deaths++;
      const by = typeof (raw as { by?: unknown })?.by === 'string' ? this.members.get((raw as { by: string }).by) : undefined;
      if (by && by !== m) {
        by.kills++;
        this.broadcast(VlMsg.Feed, { text: `${by.name} killed ${m.name}`, kind: 'kill' });
      } else this.broadcast(VlMsg.Feed, { text: `${m.name} died`, kind: 'death' });
    });
    this.onMessage(VlMsg.Claim, (c, raw: unknown) => {
      const owner = (raw as { owner?: unknown })?.owner;
      if (typeof owner !== 'string') return;
      const o = this.members.get(owner);
      const me = this.members.get(c.sessionId);
      const car = o?.state?.parked;
      if (!o || !me?.state || !car || dist(car, me.state) > 8) return;
      // First come, first served: the parked car leaves the owner's world now.
      o.state!.parked = null;
      this.clientOf(owner)?.send(VlMsg.Release, {});
      c.send(VlMsg.Granted, { car });
    });
    this.onMessage(VlMsg.Chat, (c, raw: unknown) => {
      const m = this.members.get(c.sessionId);
      const text = String((raw as { text?: unknown })?.text ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 120);
      if (!m || !text || Date.now() - m.lastChat < 600) return;
      m.lastChat = Date.now();
      this.broadcast(VlMsg.Chat, { from: m.id, name: m.name, text });
    });
    this.setSimulationInterval((ms) => this.tick(ms), LAN_MODE ? 1000 / 30 : 50);
    console.log(`[velora ${this.roomId}] created`);
  }

  override onUncaughtException(err: RoomException, method: RoomMethodName): void {
    console.error(`[velora ${this.roomId}] error in ${method}:`, err);
  }

  private clientOf(id: string): Client | undefined {
    return this.clients.find((c) => c.sessionId === id);
  }

  override onJoin(client: Client, o: VlJoin): void {
    if (o?.version !== VL_VERSION) throw new ServerError(4000, 'Game version mismatch — refresh the page.');
    const name = clean(o?.name);
    this.members.set(client.sessionId, { id: client.sessionId, name, state: null, kills: 0, deaths: 0, lastChat: 0, lastHit: new Map() });
    client.send(VlMsg.Welcome, { code: this.roomId, me: client.sessionId, t0: this.t0, hour: this.hour, lan: LAN_MODE });
    this.broadcast(VlMsg.Feed, { text: `${name} joined`, kind: 'join' }, { except: client });
  }

  override async onDrop(client: Client): Promise<void> {
    await this.allowReconnection(client, 15);
  }

  override onLeave(client: Client): void {
    this.lane.drop(client.sessionId);
    const m = this.members.get(client.sessionId);
    this.members.delete(client.sessionId);
    if (m) this.broadcast(VlMsg.Feed, { text: `${m.name} left`, kind: 'leave' });
  }

  override onDispose(): void {
    this.lane.dispose();
    releaseRoomCode(this.roomId);
  }

  private tick(ms: number): void {
    this.acc += ms;
    const players: RemoteState[] = [];
    for (const m of this.members.values()) if (m.state) players.push({ ...m.state, id: m.id, name: m.name, kills: m.kills, deaths: m.deaths });
    if (players.length) this.lane.broadcast(VlMsg.Snap, { t: Date.now(), players });
  }
}
