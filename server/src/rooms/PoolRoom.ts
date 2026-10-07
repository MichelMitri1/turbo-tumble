import { Room, ServerError, type Client } from '@colyseus/core';
import { PoolEngine, type Action, type PlayerSetup } from '../../../client/src/pool/engine';
import { BotDriver } from '../../../client/src/pool/bots';
import { viewFor } from '../../../client/src/pool/view';
import { BOT_NAMES, type Aim } from '../../../client/src/pool/link';
import { PL_VERSION, PlMsg, type PlConfig, type PlJoin, type PlLobby } from '../../../client/src/pool/net/protocol';
import { claimRoomCode, releaseRoomCode } from '../matchmaking/RoomCodes';
import { LAN_MODE } from '../lan';

interface Member {
  id: string;
  name: string;
  avatar: number;
  connected: boolean;
}

const clean = (raw: unknown) => String(raw ?? '').replace(/[^\p{L}\p{N} _.\-!?']/gu, '').trim().slice(0, 14) || 'Player';
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * Corner Pocket table (1v1, or 1 vs bot). The server simulates every shot to the
 * end and sends the inputs; every browser replays the identical deterministic shot.
 */
export class PoolRoom extends Room {
  override maxClients = 2;
  private members = new Map<string, Member>();
  private hostId = '';
  private config: PlConfig = { bot: false, botLevel: 'normal', shotTime: 30 };
  private engine: PoolEngine | null = null;
  private bots: BotDriver | null = null;
  private phase: PlLobby['phase'] = 'lobby';
  private refresh = 0;
  private overTimer = 0;

  override onCreate(options: PlJoin): void {
    this.roomId = claimRoomCode();
    void this.setPrivate(options?.visibility !== 'public');
    void this.setMetadata({ code: this.roomId, game: 'pool' });
    this.onMessage(PlMsg.Config, (client, c: Partial<PlConfig>) => {
      if (client.sessionId !== this.hostId || this.phase === 'playing') return;
      if (typeof c.bot === 'boolean') this.config.bot = c.bot && this.members.size < 2;
      if (c.botLevel === 'easy' || c.botLevel === 'normal' || c.botLevel === 'hard') this.config.botLevel = c.botLevel;
      if (c.shotTime === 0 || c.shotTime === 20 || c.shotTime === 30 || c.shotTime === 60) this.config.shotTime = c.shotTime;
      this.sendLobby();
    });
    this.onMessage(PlMsg.Start, (client) => {
      if (client.sessionId !== this.hostId || this.phase === 'playing') return;
      if (this.members.size + (this.config.bot ? 1 : 0) !== 2) return client.send(PlMsg.Error, { msg: 'Wait for a friend, or add a bot.' });
      this.startGame();
    });
    this.onMessage(PlMsg.Act, (client, a: Action) => {
      if (!this.engine || this.phase !== 'playing') return;
      const err = this.engine.act(client.sessionId, a);
      if (err) client.send(PlMsg.Error, { msg: err });
      this.push(true);
    });
    this.onMessage(PlMsg.Aim, (client, a: Aim) => {
      if (!this.engine || this.engine.current.id !== client.sessionId || this.engine.phase !== 'aim') return;
      const aim: Aim = { dx: num(a?.dx), dy: num(a?.dy), power: num(a?.power), sx: num(a?.sx), sy: num(a?.sy), cue: a?.cue ? { x: num(a.cue.x), y: num(a.cue.y) } : undefined };
      for (const c of this.clients) if (c.sessionId !== client.sessionId) c.send(PlMsg.Aim, aim);
    });
    this.setSimulationInterval((ms) => this.update(ms / 1000), 100);
    console.log(`[pool ${this.roomId}] created`);
  }

  override onJoin(client: Client, o: PlJoin): void {
    if (o?.version !== PL_VERSION) throw new ServerError(4000, 'Game version mismatch — refresh the page.');
    if (this.phase === 'playing') throw new ServerError(4001, 'That table is mid-game.');
    if (this.members.size >= 2) throw new ServerError(4002, 'That table is full.');
    this.members.set(client.sessionId, { id: client.sessionId, name: clean(o?.name), avatar: Math.abs(Math.round(Number(o?.avatar) || 0)) % 12, connected: true });
    if (!this.hostId) this.hostId = client.sessionId;
    if (this.members.size >= 2) this.config.bot = false;
    this.sendLobby();
  }

  override async onDrop(client: Client): Promise<void> {
    const m = this.members.get(client.sessionId);
    if (m) m.connected = false;
    const p = this.engine?.player(client.sessionId);
    if (p) p.connected = false;
    this.sendLobby();
    this.push(true);
    await this.allowReconnection(client, 30);
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
    if (this.phase === 'playing') this.engine?.leave(client.sessionId);
    if (this.hostId === client.sessionId) this.hostId = this.members.keys().next().value ?? '';
    this.sendLobby();
    this.push(true);
  }

  override onDispose(): void {
    releaseRoomCode(this.roomId);
  }

  private startGame(): void {
    const seats: PlayerSetup[] = [...this.members.values()].map((m) => ({ id: m.id, name: m.name, bot: false, avatar: m.avatar }));
    if (this.config.bot) seats.push({ id: 'bot', name: BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)]!, bot: true, avatar: 7 });
    this.engine = new PoolEngine(seats, { shotTime: this.config.shotTime });
    this.bots = new BotDriver(this.engine, this.config.botLevel);
    this.phase = 'playing';
    void this.lock();
    this.sendLobby();
    this.push(true);
    console.log(`[pool ${this.roomId}] game: ${seats.map((s) => s.name).join(' vs ')}`);
  }

  private update(dt: number): void {
    const e = this.engine;
    if (!e || this.phase === 'lobby') return;
    if (this.phase === 'playing') {
      e.update(dt);
      this.bots?.update(dt);
      if (e.isOver && e.phase === 'over') {
        // Let the last shot play out on screens before the room returns to the lobby.
        this.phase = 'over';
        this.overTimer = 8 + Math.max(0, e.rollLeft);
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

  private push(force: boolean): void {
    const e = this.engine;
    if (!e || (!e.events.length && !force)) return;
    this.refresh = 0.5;
    const events = e.events.splice(0);
    for (const client of this.clients) client.send(PlMsg.State, { view: viewFor(e, client.sessionId), events });
  }

  private sendLobby(): void {
    const players: PlLobby['players'] = [...this.members.values()].map((m) => ({ id: m.id, name: m.name, avatar: m.avatar, bot: false, connected: m.connected }));
    if (this.config.bot) players.push({ id: 'bot', name: 'Bot', avatar: 7, bot: true, connected: true });
    const l: PlLobby = { code: this.roomId, phase: this.phase, hostId: this.hostId, config: this.config, players, lan: LAN_MODE };
    this.broadcast(PlMsg.Lobby, l);
  }
}
