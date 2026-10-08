import { Room, ServerError, type Client, type RoomException, type RoomMethodName } from '@colyseus/core';
import { COLORS, type Color } from '../../../client/src/lastcard/cards';
import { LastCardEngine, type Action, type PlayerSetup } from '../../../client/src/lastcard/engine';
import { BotDriver } from '../../../client/src/lastcard/bots';
import { redact, viewFor, type View } from '../../../client/src/lastcard/view';
import { BOT_NAMES } from '../../../client/src/lastcard/link';
import { LC_MAX_PLAYERS, LC_VERSION, LcMsg, type LcConfig, type LcJoin, type LcLobby } from '../../../client/src/lastcard/net/protocol';
import { claimRoomCode, releaseRoomCode } from '../matchmaking/RoomCodes';
import { LAN_MODE } from '../lan';

interface Member {
  id: string;
  name: string;
  avatar: number;
  connected: boolean;
  /** Games won at this table (series scoreboard). */
  wins: number;
}

const clean = (raw: unknown) => String(raw ?? '').replace(/[^\p{L}\p{N} _.\-!?']/gu, '').trim().slice(0, 14) || 'Player';
const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 32;
const isColor = (v: unknown): v is Color => (COLORS as unknown[]).includes(v);

/** Client messages are untrusted: keep only well-formed actions. */
function parseAction(raw: unknown): Action | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  switch (a.t) {
    case 'play':
      if (!Number.isInteger(a.card)) return null;
      if (a.color !== undefined && !isColor(a.color)) return null;
      return { t: 'play', card: a.card as number, color: a.color };
    case 'draw':
    case 'keep':
    case 'call':
      return { t: a.t };
    case 'catch':
      return isId(a.target) ? { t: 'catch', target: a.target } : null;
    case 'challenge':
      return { t: 'challenge', yes: a.yes === true };
    case 'color':
      return isColor(a.color) ? { t: 'color', color: a.color } : null;
    case 'swap':
      return isId(a.target) ? { t: 'swap', target: a.target } : null;
    default:
      return null;
  }
}

/**
 * Last Card table: up to 8 seats (humans + bots). The server owns the engine and
 * sends each player only their own hand.
 */
export class LastCardRoom extends Room {
  override maxClients = LC_MAX_PLAYERS;
  private members = new Map<string, Member>();
  private hostId = '';
  private config: LcConfig = {
    bots: 0,
    botLevel: 'normal',
    stacking: false,
    stackTwoOnFour: false,
    drawToMatch: false,
    challenge: true,
    sevenZero: false,
    jumpIn: false,
    forcePlay: false,
    unoPenalty: 2,
    target: 0,
  };
  private engine: LastCardEngine | null = null;
  private bots: BotDriver | null = null;
  private phase: LcLobby['phase'] = 'lobby';
  private refresh = 0;
  private overTimer = 0;
  private idle = new Map<string, number>();
  private rematch = new Set<string>();
  /** Each client's view right after every event since the last push. */
  private snaps = new Map<string, View[]>();

  override onCreate(options: LcJoin): void {
    this.roomId = claimRoomCode();
    void this.setPrivate(options?.visibility !== 'public');
    void this.setMetadata({ code: this.roomId, game: 'lastcard' });
    this.onMessage(LcMsg.Config, (client, raw: unknown) => {
      if (client.sessionId !== this.hostId || this.phase === 'playing' || !raw || typeof raw !== 'object') return;
      const c = raw as Partial<Record<keyof LcConfig, unknown>>;
      const cfg = this.config;
      if (typeof c.bots === 'number' && Number.isFinite(c.bots)) cfg.bots = Math.max(0, Math.min(LC_MAX_PLAYERS - this.members.size, Math.round(c.bots)));
      if (c.botLevel === 'easy' || c.botLevel === 'normal' || c.botLevel === 'hard') cfg.botLevel = c.botLevel;
      for (const k of ['stacking', 'stackTwoOnFour', 'drawToMatch', 'challenge', 'sevenZero', 'jumpIn', 'forcePlay'] as const) if (typeof c[k] === 'boolean') cfg[k] = c[k] as boolean;
      if (c.unoPenalty === 2 || c.unoPenalty === 4) cfg.unoPenalty = c.unoPenalty;
      if (c.target === 0 || c.target === 200 || c.target === 500) cfg.target = c.target;
      this.sendLobby();
    });
    this.onMessage(LcMsg.Start, (client) => {
      if (client.sessionId !== this.hostId || this.phase === 'playing') return;
      if (this.members.size + this.config.bots < 2) return client.send(LcMsg.Error, { msg: 'Add a bot or wait for a friend first.' });
      this.startGame();
    });
    this.onMessage(LcMsg.Rematch, (client) => {
      if (this.phase === 'playing' || !this.members.has(client.sessionId)) return;
      this.rematch.add(client.sessionId);
      this.sendLobby();
      // Everyone (still here) wants another game: go.
      if (this.members.size + this.config.bots >= 2 && [...this.members.keys()].every((id) => this.rematch.has(id))) this.startGame();
    });
    this.onMessage(LcMsg.Act, (client, raw: unknown) => {
      if (!this.engine || this.phase !== 'playing') return;
      const a = parseAction(raw);
      if (!a) return client.send(LcMsg.Error, { msg: 'Bad action.' });
      const err = this.engine.act(client.sessionId, a);
      if (err) client.send(LcMsg.Error, { msg: err });
      this.push(true);
    });
    this.setSimulationInterval((ms) => this.update(ms / 1000), 100);
    console.log(`[lastcard ${this.roomId}] created`);
  }

  override onUncaughtException(err: RoomException, method: RoomMethodName): void {
    // A bad message must never take the whole table down: log it and keep serving.
    console.error(`[lastcard ${this.roomId}] error in ${method}:`, err);
  }

  override onJoin(client: Client, o: LcJoin): void {
    if (o?.version !== LC_VERSION) throw new ServerError(4000, 'Game version mismatch — refresh the page.');
    if (this.phase === 'playing') throw new ServerError(4001, 'That table is mid-game.');
    if (this.members.size + this.config.bots >= LC_MAX_PLAYERS) this.config.bots = Math.max(0, LC_MAX_PLAYERS - this.members.size - 1);
    this.members.set(client.sessionId, { id: client.sessionId, name: clean(o?.name), avatar: Math.abs(Math.round(Number(o?.avatar) || 0)) % 12, connected: true, wins: 0 });
    if (!this.hostId) this.hostId = client.sessionId;
    this.sendLobby();
  }

  override async onDrop(client: Client): Promise<void> {
    const m = this.members.get(client.sessionId);
    if (m) m.connected = false;
    const p = this.engine?.player(client.sessionId);
    if (p) p.connected = false;
    this.sendLobby();
    await this.allowReconnection(client, 20);
  }

  override onReconnect(client: Client): void {
    const m = this.members.get(client.sessionId);
    if (m) m.connected = true;
    const p = this.engine?.player(client.sessionId);
    if (p) p.connected = true;
    this.sendLobby();
    this.push(true);
  }

  override onLeave(client: Client): void {
    this.members.delete(client.sessionId);
    this.rematch.delete(client.sessionId);
    this.engine?.leave(client.sessionId);
    if (this.engine?.isOver && this.phase === 'playing') this.endGame();
    if (this.hostId === client.sessionId) this.hostId = this.members.keys().next().value ?? '';
    this.sendLobby();
    this.push(true);
  }

  override onDispose(): void {
    releaseRoomCode(this.roomId);
  }

  private startGame(): void {
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    const seats: PlayerSetup[] = [...this.members.values()].map((m) => ({ id: m.id, name: m.name, bot: false, avatar: m.avatar }));
    for (let i = 0; i < this.config.bots && seats.length < LC_MAX_PLAYERS; i++) seats.push({ id: `bot${i}`, name: names[i]!, bot: true, avatar: (3 + i * 5) % 12 });
    const { bots, botLevel, ...rules } = this.config;
    this.snaps.clear();
    this.engine = new LastCardEngine(seats, { ...rules, turnTime: 30 }, (e) => {
      for (const c of this.clients) {
        const list = this.snaps.get(c.sessionId) ?? [];
        list.push(viewFor(e, c.sessionId));
        this.snaps.set(c.sessionId, list);
      }
    });
    this.bots = new BotDriver(this.engine, botLevel);
    this.phase = 'playing';
    this.idle.clear();
    this.rematch.clear();
    void this.lock();
    this.sendLobby();
    this.push(true);
    console.log(`[lastcard ${this.roomId}] game: ${seats.length} seats (${bots} bots)`);
  }

  private update(dt: number): void {
    const e = this.engine;
    if (!e || this.phase === 'lobby') return;
    if (this.phase === 'playing') {
      e.update(dt);
      this.bots?.update(dt);
      if (e.isOver) return this.endGame();
      // Disconnected players: auto-play after a short grace so the table never waits long.
      const cur = e.current;
      if (!cur.bot && !cur.connected) {
        const t = (this.idle.get(cur.id) ?? 0) + dt;
        this.idle.set(cur.id, t);
        if (t > 4) {
          this.idle.set(cur.id, 0);
          e.autoAct(cur.id);
        }
      }
      if (e.isOver) return this.endGame();
    } else if (this.phase === 'over') {
      this.overTimer -= dt;
      if (this.overTimer <= 0) {
        this.phase = 'lobby';
        void this.unlock();
        this.sendLobby();
      }
    }
    this.refresh -= dt;
    this.push(this.refresh <= 0);
  }

  private endGame(): void {
    this.phase = 'over';
    this.overTimer = 4;
    const w = this.engine?.winner && this.members.get(this.engine.winner);
    if (w) w.wins++;
    this.push(true);
    this.sendLobby();
  }

  /** Send every connected client their own view + the new events (redacted). */
  private push(force: boolean): void {
    const e = this.engine;
    if (!e || (!e.events.length && !force)) return;
    this.refresh = 0.5;
    const events = e.events.splice(0);
    for (const client of this.clients) {
      const views = this.snaps.get(client.sessionId);
      client.send(LcMsg.State, { view: viewFor(e, client.sessionId), events: events.map((ev) => redact(ev, client.sessionId)), views: views?.length === events.length ? views : undefined });
    }
    this.snaps.clear();
  }

  private sendLobby(): void {
    const players: LcLobby['players'] = [...this.members.values()].map((m) => ({ id: m.id, name: m.name, avatar: m.avatar, bot: false, connected: m.connected, wins: m.wins }));
    for (let i = 0; i < this.config.bots; i++) players.push({ id: `bot${i}`, name: `Bot ${i + 1}`, avatar: (3 + i * 5) % 12, bot: true, connected: true, wins: 0 });
    const l: LcLobby = { code: this.roomId, phase: this.phase, hostId: this.hostId, config: this.config, players, rematch: [...this.rematch], lan: LAN_MODE };
    this.broadcast(LcMsg.Lobby, l);
  }
}
