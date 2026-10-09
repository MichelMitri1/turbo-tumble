import { Room, ServerError, type Client, type RoomException, type RoomMethodName } from '@colyseus/core';
import { Game, BOT_NAMES, DEFAULT_CONFIG, RADIUS, SPEED, TICK, COLORS, type Action, type Event } from '../../../client/src/starfall/sim/game';
import { Bots } from '../../../client/src/starfall/sim/bots';
import { MAP } from '../../../client/src/starfall/sim/maps';
import { eventsFor, viewFor } from '../../../client/src/starfall/sim/view';
import { SF_MAX, SF_VERSION, SfMsg, type SfConfig, type SfJoin, type SfLobby, type SfMove } from '../../../client/src/starfall/net/protocol';
import { claimRoomCode, releaseRoomCode } from '../matchmaking/RoomCodes';
import { LAN_MODE } from '../lan';

interface Member {
  id: string;
  name: string;
  color: number;
  connected: boolean;
  /** Seat in the running game (−1 = none). */
  seat: number;
  lastMove: number;
  lastChat: number;
  events: Event[];
}

const clean = (raw: unknown) => String(raw ?? '').replace(/[^\p{L}\p{N} _.\-!?']/gu, '').trim().slice(0, 12) || 'Crewmate';
const int = (v: unknown, lo: number, hi: number): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : null);
const SAB = ['reactor', 'o2', 'lights', 'comms', 'seismic', 'doors'];

/** Client messages are untrusted: keep only well-formed actions. */
function parseAction(raw: unknown): Action | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  switch (a.k) {
    case 'kill': {
      const t = int(a.target, 0, SF_MAX);
      return t === null ? null : { k: 'kill', target: t };
    }
    case 'report': {
      const b = int(a.body, 0, SF_MAX);
      return b === null ? null : { k: 'report', body: b };
    }
    case 'emergency':
      return { k: 'emergency' };
    case 'vent':
      if (a.op !== 'enter' && a.op !== 'exit' && a.op !== 'move') return null;
      return { k: 'vent', op: a.op, to: int(a.to, 0, 64) ?? undefined };
    case 'sabotage':
      if (typeof a.kind !== 'string' || !SAB.includes(a.kind)) return null;
      return { k: 'sabotage', kind: a.kind as 'doors', room: typeof a.room === 'string' ? a.room.slice(0, 40) : undefined };
    case 'switch': {
      const i = int(a.i, 0, 4);
      return i === null ? null : { k: 'switch', i };
    }
    case 'o2': {
      const s = int(a.station, 0, 4);
      return s === null || typeof a.code !== 'string' ? null : { k: 'o2', station: s, code: a.code.slice(0, 8) };
    }
    case 'hold': {
      const s = int(a.station, 0, 4);
      return s === null ? null : { k: 'hold', station: s, on: a.on === true };
    }
    case 'comms': {
      const s = int(a.station, 0, 4);
      return s === null ? null : { k: 'comms', station: s };
    }
    case 'task': {
      const t = int(a.task, 0, 32);
      return t === null ? null : { k: 'task', task: t };
    }
    case 'busy':
      return typeof a.kind === 'string' && /^[a-z]{0,16}$/.test(a.kind) ? { k: 'busy', kind: a.kind as '' } : null;
    case 'vote': {
      const t = int(a.target, -1, SF_MAX);
      return t === null ? null : { k: 'vote', target: t };
    }
    case 'chat':
      return typeof a.text === 'string' ? { k: 'chat', text: a.text.slice(0, 140) } : null;
  }
  return null;
}

/**
 * A Starfall crew: up to 15 seats (humans + bots). The server runs the rules and the bots,
 * and sends each player only what they're allowed to see. Clients move themselves; the server
 * checks every step against the walls and the speed limit.
 */
export class StarfallRoom extends Room {
  override maxClients = SF_MAX;
  private members = new Map<string, Member>();
  private hostId = '';
  private config: SfConfig = { ...DEFAULT_CONFIG, bots: 7 };
  private game: Game | null = null;
  private bots: Bots | null = null;
  private phase: SfLobby['phase'] = 'lobby';
  private acc = 0;
  private ticks = 0;
  private overT = 0;

  override onCreate(options: SfJoin): void {
    this.roomId = claimRoomCode();
    void this.setPrivate(options?.visibility !== 'public');
    void this.setMetadata({ code: this.roomId, game: 'starfall' });
    this.onMessage(SfMsg.Config, (client, raw: unknown) => {
      if (client.sessionId !== this.hostId || this.phase !== 'lobby' || !raw || typeof raw !== 'object') return;
      const c = raw as Record<string, unknown>;
      const cfg = this.config;
      const num = (k: keyof SfConfig, lo: number, hi: number, step = 1) => {
        const v = c[k];
        if (typeof v === 'number' && Number.isFinite(v)) (cfg as unknown as Record<string, number>)[k] = Math.max(lo, Math.min(hi, Math.round(v / step) * step));
      };
      if (typeof c.map === 'string' && MAP[c.map]) cfg.map = c.map;
      num('bots', 0, SF_MAX - this.members.size);
      num('impostors', 1, 3);
      num('crewVision', 1.375, 16.5, 0.125);
      num('impostorVision', 1.375, 16.5, 0.125);
      num('killCooldown', 10, 60, 2.5);
      num('emergencies', 0, 9);
      num('discussion', 0, 120, 15);
      num('voting', 15, 300, 15);
      num('commonTasks', 0, 2);
      num('longTasks', 0, 3);
      num('shortTasks', 0, 5);
      for (const k of ['confirmEjects', 'anonymousVotes', 'visualTasks'] as const) if (typeof c[k] === 'boolean') cfg[k] = c[k] as boolean;
      this.sendLobby();
    });
    this.onMessage(SfMsg.Look, (client, raw: unknown) => {
      const m = this.members.get(client.sessionId);
      if (!m || this.phase !== 'lobby' || !raw || typeof raw !== 'object') return;
      const o = raw as { name?: unknown; color?: unknown };
      if (o.name !== undefined) m.name = clean(o.name);
      const col = int(o.color, 0, COLORS.length - 1);
      if (col !== null && ![...this.members.values()].some((x) => x !== m && x.color === col)) m.color = col;
      this.sendLobby();
    });
    this.onMessage(SfMsg.Start, (client) => {
      if (client.sessionId !== this.hostId || this.phase !== 'lobby') return;
      if (this.members.size + this.config.bots < 4) return client.send(SfMsg.Error, { msg: 'You need at least 4 players — add bots.' });
      this.startGame();
    });
    this.onMessage(SfMsg.Move, (client, raw: unknown) => this.move(client, raw));
    this.onMessage(SfMsg.Act, (client, raw: unknown) => {
      const m = this.members.get(client.sessionId);
      const g = this.game;
      if (!g || !m || m.seat < 0) return;
      const a = parseAction(raw);
      if (!a) return client.send(SfMsg.Error, { msg: 'Bad action.' });
      if (a.k === 'chat') {
        const t = Date.now();
        if (t - m.lastChat < 700) return;
        m.lastChat = t;
      }
      const err = g.act(m.seat, a);
      if (err && a.k !== 'busy') client.send(SfMsg.Error, { msg: err });
    });
    this.setSimulationInterval((ms) => this.update(ms / 1000), 1000 / 30);
    console.log(`[starfall ${this.roomId}] created`);
  }

  override onUncaughtException(err: RoomException, method: RoomMethodName): void {
    console.error(`[starfall ${this.roomId}] error in ${method}:`, err);
  }

  override onJoin(client: Client, o: SfJoin): void {
    if (o?.version !== SF_VERSION) throw new ServerError(4000, 'Game version mismatch — refresh the page.');
    if (this.phase !== 'lobby') throw new ServerError(4001, 'That crew is mid-game.');
    if (this.members.size >= SF_MAX) throw new ServerError(4002, 'That lobby is full.');
    const taken = new Set([...this.members.values()].map((m) => m.color));
    let color = int(o?.color, 0, COLORS.length - 1) ?? 0;
    if (taken.has(color)) color = [...Array(COLORS.length).keys()].find((c) => !taken.has(c)) ?? 0;
    this.members.set(client.sessionId, { id: client.sessionId, name: clean(o?.name), color, connected: true, seat: -1, lastMove: 0, lastChat: 0, events: [] });
    if (!this.hostId) this.hostId = client.sessionId;
    this.config.bots = Math.min(this.config.bots, SF_MAX - this.members.size);
    this.sendLobby();
  }

  override async onDrop(client: Client): Promise<void> {
    const m = this.members.get(client.sessionId);
    if (m) m.connected = false;
    const p = m && this.game?.players[m.seat];
    if (p) p.connected = false;
    this.sendLobby();
    await this.allowReconnection(client, 20);
  }

  override onReconnect(client: Client): void {
    const m = this.members.get(client.sessionId);
    if (!m) return;
    m.connected = true;
    const p = this.game?.players[m.seat];
    if (p) p.connected = true;
    this.sendLobby();
    if (this.game && m.seat >= 0) client.send(SfMsg.Begin, { me: m.seat, map: this.game.def.id });
  }

  override onLeave(client: Client): void {
    const m = this.members.get(client.sessionId);
    this.members.delete(client.sessionId);
    // A bot takes over the seat so the game stays fair.
    const p = m && this.game?.players[m.seat];
    if (p && this.bots) {
      p.bot = true;
      p.connected = true;
      p.external = false;
      this.bots.adopt(p.id);
    }
    if (this.hostId === client.sessionId) this.hostId = this.members.keys().next().value ?? '';
    this.sendLobby();
  }

  override onDispose(): void {
    releaseRoomCode(this.roomId);
  }

  private sendLobby(): void {
    const l: SfLobby = {
      code: this.roomId,
      phase: this.phase,
      hostId: this.hostId,
      config: { ...this.config },
      players: [...this.members.values()].map((m) => ({ id: m.id, name: m.name, color: m.color, connected: m.connected })),
      lan: LAN_MODE,
    };
    this.broadcast(SfMsg.Lobby, l);
  }

  private startGame(): void {
    const humans = [...this.members.values()];
    const used = new Set(humans.map((m) => m.color));
    const free = [...Array(COLORS.length).keys()].filter((c) => !used.has(c));
    const names = BOT_NAMES.filter((n) => !humans.some((m) => m.name === n)).sort(() => Math.random() - 0.5);
    const bots = Math.min(this.config.bots, SF_MAX - humans.length);
    const people = [...humans.map((m) => ({ name: m.name, color: m.color, bot: false })), ...Array.from({ length: bots }, (_, i) => ({ name: names[i] ?? `Bot ${i + 1}`, color: free[i] ?? i, bot: true }))];
    const g = new Game(this.config, people, (Math.random() * 2 ** 31) | 0);
    humans.forEach((m, i) => {
      m.seat = i;
      m.events = [];
      g.players[i]!.external = true;
      g.players[i]!.connected = m.connected;
    });
    this.game = g;
    this.bots = new Bots(g);
    this.phase = 'playing';
    this.overT = 0;
    for (const c of this.clients) {
      const m = this.members.get(c.sessionId);
      if (m) c.send(SfMsg.Begin, { me: m.seat, map: g.def.id });
    }
    this.sendLobby();
  }

  private move(client: Client, raw: unknown): void {
    const m = this.members.get(client.sessionId);
    const g = this.game;
    if (!g || !m || m.seat < 0 || !raw || typeof raw !== 'object') return;
    const p = g.players[m.seat]!;
    const mv = raw as SfMove;
    if (!Number.isFinite(mv.x) || !Number.isFinite(mv.y)) return;
    if (g.phase !== 'play' || p.vent >= 0 || p.busy || p.holding >= 0) {
      p.moving = false;
      return;
    }
    const t = Date.now() / 1000;
    const since = Math.min(0.5, t - (m.lastMove || t - 0.05));
    m.lastMove = t;
    let dx = mv.x - p.x;
    let dy = mv.y - p.y;
    const max = SPEED * (p.alive ? 1 : 1.25) * since * 1.5 + 0.2;
    const d = Math.hypot(dx, dy);
    if (d > max) {
      dx *= max / d;
      dy *= max / d;
    }
    if (p.alive) [p.x, p.y] = g.map.grid.move(p.x, p.y, dx, dy, RADIUS);
    else {
      const b = g.def.bounds;
      p.x = Math.max(b[0], Math.min(b[2], p.x + dx));
      p.y = Math.max(b[1], Math.min(b[3], p.y + dy));
    }
    p.left = !!mv.left;
    p.moving = !!mv.moving;
  }

  private update(dt: number): void {
    const g = this.game;
    if (!g || !this.bots) return;
    this.acc += Math.min(dt, 0.25);
    while (this.acc >= TICK) {
      this.acc -= TICK;
      this.bots.update(TICK);
      g.step(TICK);
      const evs = g.events.splice(0);
      this.bots.events(evs);
      for (const m of this.members.values()) if (m.seat >= 0) m.events.push(...eventsFor(g, m.seat, evs));
      // Humans who stopped sending moves stop walking.
      for (const m of this.members.values()) {
        const p = g.players[m.seat];
        if (p && Date.now() / 1000 - m.lastMove > 0.25) p.moving = false;
      }
      this.ticks++;
    }
    if (this.ticks % 2 === 0) for (const c of this.clients) {
      const m = this.members.get(c.sessionId);
      if (!m || m.seat < 0) continue;
      c.send(SfMsg.Snap, { v: viewFor(g, m.seat), e: m.events.splice(0) });
    }
    // Back to the lobby a little after the end (clients keep the results screen up).
    if (g.phase === 'over') {
      this.overT += dt;
      if (this.overT > 3) {
        for (const c of this.clients) {
          const m = this.members.get(c.sessionId);
          if (m && m.seat >= 0) c.send(SfMsg.Snap, { v: viewFor(g, m.seat), e: m.events.splice(0) });
        }
        this.game = null;
        this.bots = null;
        this.phase = 'lobby';
        for (const m of this.members.values()) m.seat = -1;
        this.sendLobby();
      }
    }
  }
}
