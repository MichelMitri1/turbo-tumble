import { Room, ServerError, type Client } from '@colyseus/core';
import { World, type PlayerInfo, type WorldEvent } from '../../../client/src/rocket/sim/world';
import { Bots, BOT_NAMES } from '../../../client/src/rocket/sim/bot';
import { NO_CONTROLS, type Controls } from '../../../client/src/rocket/sim/car';
import { CAR_IDS, TICK } from '../../../client/src/rocket/sim/constants';
import { unpackControls, writeSnapshot } from '../../../client/src/rocket/sim/snapshot';
import { RB_MAX_PER_TEAM, RB_VERSION, RbMsg, type RbBegin, type RbConfig, type RbInput, type RbJoin, type RbLobby, type RbLobbyPlayer } from '../../../client/src/rocket/net/protocol';
import { isArenaId, pickArena, type ArenaId } from '../../../client/src/rocket/arenas';
import { claimRoomCode, releaseRoomCode } from '../matchmaking/RoomCodes';
import { LAN_MODE } from '../lan';

interface Member {
  id: string;
  name: string;
  team: 0 | 1;
  body: RbLobbyPlayer['body'];
  connected: boolean;
}

const BODIES = new Set<string>(CAR_IDS);
const clean = (raw: unknown) => String(raw ?? '').replace(/[^\p{L}\p{N} _.\-!?']/gu, '').trim().slice(0, 16) || 'Player';
const SERVER_EVENTS = new Set<WorldEvent['k']>(['goal', 'demo', 'over', 'overtime', 'kickoff']);

/**
 * Boostball match: the server simulates the authoritative world at 120 Hz.
 * Clients send tick-stamped inputs ahead of time (they predict and roll back);
 * the server applies each input on its tick and sends every client a snapshot
 * ~60 times a second, plus how far ahead their inputs are arriving ("lead").
 */
export class RocketRoom extends Room {
  override maxClients = RB_MAX_PER_TEAM * 2;
  private members = new Map<string, Member>();
  private hostId = '';
  private config: RbConfig = { size: 2, botLevel: 'pro', length: 300, bots: true, arena: 'random' };
  private phase: RbLobby['phase'] = 'lobby';
  private world: World | null = null;
  private bots: Bots | null = null;
  private ids = new Map<string, number>();
  private inputBuf = new Map<number, Map<number, Controls>>();
  private lastInput = new Map<number, Controls>();
  private latestTick = new Map<number, number>();
  private acc = 0;
  private overTimer = 0;
  private statsTimer = 0;
  private snapBuf: Float32Array | null = null;
  /** The running match's seed and arena (sent to late joiners / reconnects too). */
  private seed = 0;
  private arena: ArenaId = 'dome';

  override onCreate(options: RbJoin): void {
    this.roomId = claimRoomCode();
    void this.setPrivate(options?.visibility !== 'public');
    void this.setMetadata({ code: this.roomId, game: 'boostball' });
    this.onMessage(RbMsg.Config, (client, c: Partial<RbConfig> | undefined) => {
      if (client.sessionId !== this.hostId || this.phase !== 'lobby' || !c || typeof c !== 'object') return;
      if (c.size === 1 || c.size === 2 || c.size === 3) this.config.size = c.size;
      if (c.botLevel === 'rookie' || c.botLevel === 'pro' || c.botLevel === 'allstar') this.config.botLevel = c.botLevel;
      if (typeof c.length === 'number' && [120, 180, 300, 600].includes(c.length)) this.config.length = c.length;
      if (typeof c.bots === 'boolean') this.config.bots = c.bots;
      if (c.arena === 'random' || isArenaId(c.arena)) this.config.arena = c.arena;
      this.balance();
      this.sendLobby();
    });
    this.onMessage(RbMsg.Team, (client, m: { team?: number } | undefined) => {
      const me = this.members.get(client.sessionId);
      const team = m?.team;
      if (!me || this.phase !== 'lobby' || (team !== 0 && team !== 1)) return;
      const count = [...this.members.values()].filter((x) => x.team === team && x !== me).length;
      if (count >= RB_MAX_PER_TEAM) return client.send(RbMsg.Error, { msg: 'That team is full.' });
      me.team = team;
      this.config.size = Math.max(this.config.size, count + 1) as RbConfig['size'];
      this.sendLobby();
    });
    this.onMessage(RbMsg.Body, (client, m: { body?: unknown } | undefined) => {
      const me = this.members.get(client.sessionId);
      const body = m?.body;
      if (me && typeof body === 'string' && BODIES.has(body)) me.body = body as Member['body'];
      this.sendLobby();
    });
    this.onMessage(RbMsg.Start, (client) => {
      if (client.sessionId !== this.hostId || this.phase !== 'lobby') return;
      const t0 = [...this.members.values()].filter((m) => m.team === 0).length;
      const t1 = this.members.size - t0;
      if (!this.config.bots && (t0 === 0 || t1 === 0)) return client.send(RbMsg.Error, { msg: 'Both teams need a player (or turn bots on).' });
      this.startMatch();
    });
    this.onMessage(RbMsg.Input, (client, m: RbInput) => {
      const id = this.ids.get(client.sessionId);
      if (id == null || !this.world || !Array.isArray(m?.c) || typeof m.t !== 'number') return;
      let buf = this.inputBuf.get(id);
      if (!buf) this.inputBuf.set(id, (buf = new Map()));
      const n = Math.min(60, Math.floor(m.c.length / 6));
      for (let i = 0; i < n; i++) {
        const t = m.t + i;
        if (t <= this.world.tickCount) continue;
        buf.set(t, sanitize(unpackControls(m.c, i * 6)));
      }
      this.latestTick.set(id, Math.max(this.latestTick.get(id) ?? 0, m.t + n - 1));
    });
    this.onMessage(RbMsg.Chat, (client, m: { g?: number; i?: number } | undefined) => {
      const id = this.ids.get(client.sessionId);
      if (id == null || typeof m?.g !== 'number' || typeof m.i !== 'number') return;
      this.broadcast(RbMsg.Chat, { id, g: Math.max(0, Math.min(3, m.g | 0)), i: Math.max(0, Math.min(3, m.i | 0)) });
    });
    this.onMessage(RbMsg.Ping, (client, m: { t?: unknown } | undefined) => client.send(RbMsg.Ping, { t: typeof m?.t === 'number' ? m.t : 0 }));
    this.setSimulationInterval((ms) => this.update(ms), 1000 / 60);
    console.log(`[boostball ${this.roomId}] created`);
  }

  override onJoin(client: Client, o: RbJoin): void {
    if (o?.version !== RB_VERSION) throw new ServerError(4000, 'Game version mismatch — refresh the page.');
    if (this.phase !== 'lobby') throw new ServerError(4001, 'That match already started.');
    const t0 = [...this.members.values()].filter((m) => m.team === 0).length;
    const t1 = this.members.size - t0;
    const team: 0 | 1 = t0 <= t1 ? 0 : 1;
    this.members.set(client.sessionId, { id: client.sessionId, name: clean(o?.name), team, body: o?.body && BODIES.has(o.body) ? o.body : 'octane', connected: true });
    if (!this.hostId) this.hostId = client.sessionId;
    this.balance();
    this.sendLobby();
  }

  override async onDrop(client: Client): Promise<void> {
    const m = this.members.get(client.sessionId);
    if (m) m.connected = false;
    this.setBot(client.sessionId, true);
    this.sendLobby();
    await this.allowReconnection(client, 20);
  }

  override onReconnect(client: Client): void {
    const m = this.members.get(client.sessionId);
    if (m) m.connected = true;
    this.setBot(client.sessionId, false);
    this.sendLobby();
    if (this.world && this.phase === 'playing') client.send(RbMsg.Begin, this.beginMsg());
  }

  override onLeave(client: Client): void {
    this.members.delete(client.sessionId);
    // A bot takes over the car, like the real game.
    this.setBot(client.sessionId, true);
    if (this.hostId === client.sessionId) this.hostId = this.members.keys().next().value ?? '';
    this.sendLobby();
  }

  override onDispose(): void {
    releaseRoomCode(this.roomId);
  }

  private setBot(sessionId: string, bot: boolean): void {
    const id = this.ids.get(sessionId);
    const p = id != null ? this.world?.players.find((x) => x.id === id) : undefined;
    if (p) p.bot = bot;
  }

  /** Grow the team size to fit everyone. */
  private balance(): void {
    const t0 = [...this.members.values()].filter((m) => m.team === 0).length;
    const t1 = this.members.size - t0;
    this.config.size = Math.min(RB_MAX_PER_TEAM, Math.max(this.config.size, t0, t1)) as RbConfig['size'];
  }

  private beginMsg(): RbBegin {
    return { players: this.world!.players.map((p) => ({ ...p })), ids: Object.fromEntries(this.ids), seed: this.seed, length: this.config.length, lan: LAN_MODE, arena: this.arena };
  }

  private startMatch(): void {
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    const players: PlayerInfo[] = [];
    this.ids.clear();
    let id = 1;
    for (const m of this.members.values()) {
      this.ids.set(m.id, id);
      players.push({ id: id++, name: m.name, team: m.team, bot: false, body: m.body });
    }
    if (this.config.bots) {
      for (const team of [0, 1] as const) {
        const have = players.filter((p) => p.team === team).length;
        for (let i = have; i < this.config.size; i++) players.push({ id: id++, name: names.pop()!, team, bot: true, body: CAR_IDS[Math.floor(Math.random() * CAR_IDS.length)]! });
      }
    }
    // Clients build their World from the same seed, so their kickoff matches ours.
    this.seed = (Math.random() * 1e9) | 0;
    this.arena = pickArena(this.config.arena);
    this.world = new World(players, this.config.length, this.seed);
    this.bots = new Bots(this.world, this.config.botLevel);
    this.inputBuf.clear();
    this.lastInput.clear();
    this.latestTick.clear();
    this.acc = 0;
    this.phase = 'playing';
    void this.lock();
    this.sendLobby();
    this.broadcast(RbMsg.Begin, this.beginMsg());
    this.sendSnapshots();
    console.log(`[boostball ${this.roomId}] match: ${players.length} cars (${players.filter((p) => p.bot).length} bots)`);
  }

  private update(ms: number): void {
    const w = this.world;
    if (!w || this.phase === 'lobby') return;
    if (this.phase === 'over') {
      this.overTimer -= ms / 1000;
      if (this.overTimer <= 0) {
        this.phase = 'lobby';
        this.world = null;
        void this.unlock();
        this.sendLobby();
      }
      return;
    }
    this.acc = Math.min(this.acc + ms / 1000, 0.1);
    const events: WorldEvent[] = [];
    const inputs = new Map<number, Controls>();
    let stepped = false;
    while (this.acc >= TICK) {
      this.acc -= TICK;
      const t = w.tickCount + 1;
      inputs.clear();
      this.bots!.update(TICK, inputs);
      for (const p of w.players) {
        if (p.bot) continue;
        const buf = this.inputBuf.get(p.id);
        const c = buf?.get(t) ?? this.lastInput.get(p.id) ?? NO_CONTROLS;
        buf?.delete(t);
        this.lastInput.set(p.id, c);
        inputs.set(p.id, c);
      }
      w.step(inputs);
      stepped = true;
      for (const e of w.events.splice(0)) if (SERVER_EVENTS.has(e.k)) events.push(e);
      // Drop stale buffered inputs.
      for (const buf of this.inputBuf.values()) for (const k of buf.keys()) if (k <= t) buf.delete(k);
    }
    if (events.length) this.broadcast(RbMsg.Events, events);
    if (stepped) this.sendSnapshots();
    this.statsTimer -= ms / 1000;
    if (this.statsTimer <= 0 || events.some((e) => e.k === 'goal' || e.k === 'over')) {
      this.statsTimer = 1;
      this.broadcast(RbMsg.Stats, [...w.stats.entries()]);
    }
    if (w.phase === 'over' && this.phase === 'playing') {
      this.phase = 'over';
      this.overTimer = 12;
      this.sendLobby();
    }
  }

  private sendSnapshots(): void {
    const w = this.world!;
    this.snapBuf = writeSnapshot(w, this.snapBuf ?? undefined);
    const out = new Float32Array(this.snapBuf.length + 1);
    out.set(this.snapBuf, 1);
    for (const client of this.clients) {
      const id = this.ids.get(client.sessionId);
      out[0] = id != null ? (this.latestTick.get(id) ?? w.tickCount) - w.tickCount : 0;
      client.sendBytes(RbMsg.Snap, new Uint8Array(out.buffer.slice(0)));
    }
  }

  private sendLobby(): void {
    const players: RbLobbyPlayer[] = [...this.members.values()].map((m) => ({ id: m.id, name: m.name, team: m.team, body: m.body, bot: false, connected: m.connected }));
    if (this.config.bots) {
      for (const team of [0, 1] as const) {
        const have = players.filter((p) => p.team === team && !p.bot).length;
        for (let i = have; i < this.config.size; i++) players.push({ id: `bot${team}${i}`, name: 'Bot', team, body: 'octane', bot: true, connected: true });
      }
    }
    const l: RbLobby = { code: this.roomId, phase: this.phase, hostId: this.hostId, config: this.config, players, lan: LAN_MODE };
    this.broadcast(RbMsg.Lobby, l);
  }
}

function sanitize(c: Controls): Controls {
  const f = (v: number) => (Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);
  return { throttle: f(c.throttle), steer: f(c.steer), pitch: f(c.pitch), yaw: f(c.yaw), roll: f(c.roll), jump: !!c.jump, boost: !!c.boost, handbrake: !!c.handbrake };
}
