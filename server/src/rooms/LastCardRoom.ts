import { Room, ServerError, type Client } from '@colyseus/core';
import { LastCardEngine, type Action, type PlayerSetup } from '../../../client/src/lastcard/engine';
import { BotDriver } from '../../../client/src/lastcard/bots';
import { redact, viewFor } from '../../../client/src/lastcard/view';
import { BOT_NAMES } from '../../../client/src/lastcard/link';
import { LC_MAX_PLAYERS, LC_VERSION, LcMsg, type LcConfig, type LcJoin, type LcLobby } from '../../../client/src/lastcard/net/protocol';
import { claimRoomCode, releaseRoomCode } from '../matchmaking/RoomCodes';
import { LAN_MODE } from '../lan';

interface Member {
  id: string;
  name: string;
  avatar: number;
  connected: boolean;
}

const clean = (raw: unknown) => String(raw ?? '').replace(/[^\p{L}\p{N} _.\-!?']/gu, '').trim().slice(0, 14) || 'Player';

/**
 * Last Card table: up to 8 seats (humans + bots). The server owns the engine and
 * sends each player only their own hand.
 */
export class LastCardRoom extends Room {
  override maxClients = LC_MAX_PLAYERS;
  private members = new Map<string, Member>();
  private hostId = '';
  private config: LcConfig = { bots: 0, botLevel: 'normal', stacking: false, drawToMatch: false, target: 0 };
  private engine: LastCardEngine | null = null;
  private bots: BotDriver | null = null;
  private phase: LcLobby['phase'] = 'lobby';
  private refresh = 0;
  private overTimer = 0;
  private idle = new Map<string, number>();

  override onCreate(options: LcJoin): void {
    this.roomId = claimRoomCode();
    void this.setPrivate(options?.visibility !== 'public');
    void this.setMetadata({ code: this.roomId, game: 'lastcard' });
    this.onMessage(LcMsg.Config, (client, c: Partial<LcConfig>) => {
      if (client.sessionId !== this.hostId || this.phase === 'playing') return;
      if (typeof c.bots === 'number') this.config.bots = Math.max(0, Math.min(LC_MAX_PLAYERS - this.members.size, Math.round(c.bots)));
      if (c.botLevel === 'easy' || c.botLevel === 'normal' || c.botLevel === 'hard') this.config.botLevel = c.botLevel;
      if (typeof c.stacking === 'boolean') this.config.stacking = c.stacking;
      if (typeof c.drawToMatch === 'boolean') this.config.drawToMatch = c.drawToMatch;
      if (c.target === 0 || c.target === 200 || c.target === 500) this.config.target = c.target;
      this.sendLobby();
    });
    this.onMessage(LcMsg.Start, (client) => {
      if (client.sessionId !== this.hostId || this.phase === 'playing') return;
      if (this.members.size + this.config.bots < 2) return client.send(LcMsg.Error, { msg: 'Add a bot or wait for a friend first.' });
      this.startGame();
    });
    this.onMessage(LcMsg.Act, (client, a: Action) => {
      if (!this.engine || this.phase !== 'playing') return;
      const err = this.engine.act(client.sessionId, a);
      if (err) client.send(LcMsg.Error, { msg: err });
      this.push(true);
    });
    this.setSimulationInterval((ms) => this.update(ms / 1000), 100);
    console.log(`[lastcard ${this.roomId}] created`);
  }

  override onJoin(client: Client, o: LcJoin): void {
    if (o?.version !== LC_VERSION) throw new ServerError(4000, 'Game version mismatch — refresh the page.');
    if (this.phase === 'playing') throw new ServerError(4001, 'That table is mid-game.');
    if (this.members.size + this.config.bots >= LC_MAX_PLAYERS) this.config.bots = Math.max(0, LC_MAX_PLAYERS - this.members.size - 1);
    this.members.set(client.sessionId, { id: client.sessionId, name: clean(o?.name), avatar: Math.abs(Math.round(Number(o?.avatar) || 0)) % 12, connected: true });
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
    const c = this.config;
    this.engine = new LastCardEngine(seats, { stacking: c.stacking, drawToMatch: c.drawToMatch, target: c.target, turnTime: 30 });
    this.bots = new BotDriver(this.engine, c.botLevel);
    this.phase = 'playing';
    this.idle.clear();
    void this.lock();
    this.sendLobby();
    this.push(true);
    console.log(`[lastcard ${this.roomId}] game: ${seats.length} seats (${c.bots} bots)`);
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
    this.push(true);
    this.sendLobby();
  }

  /** Send every connected client their own view + the new events (redacted). */
  private push(force: boolean): void {
    const e = this.engine;
    if (!e || (!e.events.length && !force)) return;
    this.refresh = 0.5;
    const events = e.events.splice(0);
    for (const client of this.clients) client.send(LcMsg.State, { view: viewFor(e, client.sessionId), events: events.map((ev) => redact(ev, client.sessionId)) });
  }

  private sendLobby(): void {
    const players: LcLobby['players'] = [...this.members.values()].map((m) => ({ id: m.id, name: m.name, avatar: m.avatar, bot: false, connected: m.connected }));
    for (let i = 0; i < this.config.bots; i++) players.push({ id: `bot${i}`, name: `Bot ${i + 1}`, avatar: (3 + i * 5) % 12, bot: true, connected: true });
    const l: LcLobby = { code: this.roomId, phase: this.phase, hostId: this.hostId, config: this.config, players, lan: LAN_MODE };
    this.broadcast(LcMsg.Lobby, l);
  }
}
