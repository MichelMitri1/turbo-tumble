import { Room, ServerError, type Client } from '@colyseus/core';
import { KittensEngine, type Action, type PlayerSetup } from '../../../client/src/kittens/engine';
import { BotDriver } from '../../../client/src/kittens/bots';
import { redact, viewFor } from '../../../client/src/kittens/view';
import { BOT_NAMES } from '../../../client/src/kittens/link';
import { KK_MAX_PLAYERS, KK_VERSION, KkMsg, type KkConfig, type KkJoin, type KkLobby } from '../../../client/src/kittens/net/protocol';
import { claimRoomCode, releaseRoomCode } from '../matchmaking/RoomCodes';

interface Member {
  id: string;
  name: string;
  avatar: number;
  connected: boolean;
}

const clean = (raw: unknown) => String(raw ?? '').replace(/[^\p{L}\p{N} _.\-!?']/gu, '').trim().slice(0, 14) || 'Kitty';

/**
 * Kitten Kaboom table: up to 5 seats (humans + bots). The server owns the engine
 * and sends each player only what they may see.
 */
export class KittensRoom extends Room {
  override maxClients = KK_MAX_PLAYERS;
  private members = new Map<string, Member>();
  private hostId = '';
  private config: KkConfig = { deck: 'gve', bots: 0, botLevel: 'normal' };
  private engine: KittensEngine | null = null;
  private bots: BotDriver | null = null;
  private phase: KkLobby['phase'] = 'lobby';
  private refresh = 0;
  private overTimer = 0;

  override onCreate(options: KkJoin): void {
    this.roomId = claimRoomCode();
    void this.setPrivate(options?.visibility !== 'public');
    void this.setMetadata({ code: this.roomId, game: 'kittens' });
    this.onMessage(KkMsg.Config, (client, c: Partial<KkConfig>) => {
      if (client.sessionId !== this.hostId || this.phase === 'playing') return;
      if (c.deck === 'gve' || c.deck === 'classic') this.config.deck = c.deck;
      if (typeof c.bots === 'number') this.config.bots = Math.max(0, Math.min(KK_MAX_PLAYERS - this.members.size, Math.round(c.bots)));
      if (c.botLevel === 'easy' || c.botLevel === 'normal' || c.botLevel === 'hard') this.config.botLevel = c.botLevel;
      this.sendLobby();
    });
    this.onMessage(KkMsg.Start, (client) => {
      if (client.sessionId !== this.hostId || this.phase === 'playing') return;
      if (this.members.size + this.config.bots < 2) return client.send(KkMsg.Error, { msg: 'Add a bot or wait for a friend first.' });
      this.startGame();
    });
    this.onMessage(KkMsg.Act, (client, a: Action) => {
      if (!this.engine || this.phase !== 'playing') return;
      const err = this.engine.act(client.sessionId, a);
      if (err) client.send(KkMsg.Error, { msg: err });
      this.push(true);
    });
    this.setSimulationInterval((ms) => this.update(ms / 1000), 100);
    console.log(`[kittens ${this.roomId}] created`);
  }

  override onJoin(client: Client, o: KkJoin): void {
    if (o?.version !== KK_VERSION) throw new ServerError(4000, 'Game version mismatch — refresh the page.');
    if (this.phase === 'playing') throw new ServerError(4001, 'That table is mid-game.');
    if (this.members.size + this.config.bots >= KK_MAX_PLAYERS) this.config.bots = Math.max(0, KK_MAX_PLAYERS - this.members.size - 1);
    this.members.set(client.sessionId, { id: client.sessionId, name: clean(o?.name), avatar: Math.abs(Math.round(Number(o?.avatar) || 0)) % 8, connected: true });
    if (!this.hostId) this.hostId = client.sessionId;
    this.sendLobby();
  }

  override async onDrop(client: Client): Promise<void> {
    const m = this.members.get(client.sessionId);
    if (m) m.connected = false;
    const p = this.engine?.players.find((x) => x.id === client.sessionId);
    if (p) p.connected = false;
    this.sendLobby();
    await this.allowReconnection(client, 20);
  }

  override onReconnect(client: Client): void {
    const m = this.members.get(client.sessionId);
    if (m) m.connected = true;
    const p = this.engine?.players.find((x) => x.id === client.sessionId);
    if (p) p.connected = true;
    this.sendLobby();
    this.push(true);
  }

  override onLeave(client: Client): void {
    this.members.delete(client.sessionId);
    this.engine?.leave(client.sessionId);
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
    for (let i = 0; i < this.config.bots && seats.length < KK_MAX_PLAYERS; i++) seats.push({ id: `bot${i}`, name: names[i]!, bot: true, avatar: (3 + i * 3) % 8 });
    this.engine = new KittensEngine(seats, { deck: this.config.deck, nopeWindow: 3.5, promptTimeout: 25, turnTimeout: 45 });
    this.bots = new BotDriver(this.engine, this.config.botLevel);
    this.phase = 'playing';
    void this.lock();
    this.sendLobby();
    this.push(true);
    console.log(`[kittens ${this.roomId}] game: ${seats.length} seats (${this.config.bots} bots), ${this.config.deck}`);
  }

  private update(dt: number): void {
    const e = this.engine;
    if (!e || this.phase === 'lobby') return;
    if (this.phase === 'playing') {
      e.update(dt);
      this.bots?.update(dt);
      if (e.isOver) {
        this.phase = 'over';
        this.overTimer = 3;
        this.push(true);
        this.sendLobby();
        return;
      }
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

  /** Send every connected client their own view + the new events (redacted). */
  private push(force: boolean): void {
    const e = this.engine;
    if (!e || (!e.events.length && !force)) return;
    this.refresh = 0.5;
    const events = e.events.splice(0);
    for (const client of this.clients) client.send(KkMsg.State, { view: viewFor(e, client.sessionId), events: events.map((ev) => redact(ev, client.sessionId)) });
  }

  private sendLobby(): void {
    const players: KkLobby['players'] = [...this.members.values()].map((m) => ({ id: m.id, name: m.name, avatar: m.avatar, bot: false, connected: m.connected }));
    for (let i = 0; i < this.config.bots; i++) players.push({ id: `bot${i}`, name: `Bot ${i + 1}`, avatar: (3 + i * 3) % 8, bot: true, connected: true });
    const l: KkLobby = { code: this.roomId, phase: this.phase, hostId: this.hostId, config: this.config, players };
    this.broadcast(KkMsg.Lobby, l);
  }
}
