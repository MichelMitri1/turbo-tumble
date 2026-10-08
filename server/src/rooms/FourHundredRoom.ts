import { Room, ServerError, type Client, type RoomException, type RoomMethodName } from '@colyseus/core';
import { FourHundredEngine, type Action, type PlayerSetup } from '../../../client/src/arba3meyeh/engine';
import { BotDriver } from '../../../client/src/arba3meyeh/bots';
import { redact, viewFor, type View } from '../../../client/src/arba3meyeh/view';
import { BOT_NAMES } from '../../../client/src/arba3meyeh/link';
import { FH_VERSION, FhMsg, type FhConfig, type FhJoin, type FhLobby } from '../../../client/src/arba3meyeh/net/protocol';
import { claimRoomCode, releaseRoomCode } from '../matchmaking/RoomCodes';
import { LAN_MODE } from '../lan';

interface Member {
  id: string;
  name: string;
  avatar: number;
  connected: boolean;
  chair: number;
}

const clean = (raw: unknown) => String(raw ?? '').replace(/[^\p{L}\p{N} _.\-!?']/gu, '').trim().slice(0, 14) || 'Player';

function parseAction(raw: unknown): Action | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  if (a.t === 'bid' && Number.isInteger(a.n)) return { t: 'bid', n: a.n as number };
  if (a.t === 'play' && Number.isInteger(a.card)) return { t: 'play', card: a.card as number };
  return null;
}

/**
 * A 400 table: four chairs (partners opposite), humans pick a chair, bots fill the rest.
 * The server owns the engine and sends each player only their own hand.
 */
export class FourHundredRoom extends Room {
  override maxClients = 4;
  private members = new Map<string, Member>();
  private hostId = '';
  private config: FhConfig = { target: 41, scoring: 'lebanese', botLevel: 'normal' };
  private engine: FourHundredEngine | null = null;
  private bots: BotDriver | null = null;
  private phase: FhLobby['phase'] = 'lobby';
  private wins: [number, number] = [0, 0];
  private rematch = new Set<string>();
  private refresh = 0;
  private overTimer = 0;
  private snaps = new Map<string, View[]>();

  override onCreate(o: FhJoin): void {
    this.roomId = claimRoomCode();
    void this.setPrivate(o?.visibility !== 'public');
    void this.setMetadata({ code: this.roomId, game: 'fourhundred' });
    this.onMessage(FhMsg.Config, (client, raw: unknown) => {
      if (client.sessionId !== this.hostId || this.phase === 'playing' || !raw || typeof raw !== 'object') return;
      const c = raw as Partial<Record<keyof FhConfig, unknown>>;
      if (c.target === 31 || c.target === 41 || c.target === 61) this.config.target = c.target;
      if (c.scoring === 'lebanese' || c.scoring === 'jawaker') this.config.scoring = c.scoring;
      if (c.botLevel === 'easy' || c.botLevel === 'normal' || c.botLevel === 'hard') this.config.botLevel = c.botLevel;
      this.sendLobby();
    });
    this.onMessage(FhMsg.Seat, (client, raw: { seat?: unknown }) => {
      const m = this.members.get(client.sessionId);
      const seat = Number(raw?.seat);
      if (!m || this.phase === 'playing' || !Number.isInteger(seat) || seat < 0 || seat > 3) return;
      if ([...this.members.values()].some((x) => x !== m && x.chair === seat)) return;
      m.chair = seat;
      this.sendLobby();
    });
    this.onMessage(FhMsg.Start, (client) => {
      if (client.sessionId !== this.hostId || this.phase === 'playing') return;
      this.startGame();
    });
    this.onMessage(FhMsg.Rematch, (client) => {
      if (this.phase === 'playing' || !this.members.has(client.sessionId)) return;
      this.rematch.add(client.sessionId);
      this.sendLobby();
      if ([...this.members.keys()].every((id) => this.rematch.has(id))) this.startGame();
    });
    this.onMessage(FhMsg.Act, (client, raw: unknown) => {
      if (!this.engine || this.phase !== 'playing') return;
      const a = parseAction(raw);
      if (!a) return client.send(FhMsg.Error, { msg: 'Bad action.' });
      const err = this.engine.act(client.sessionId, a);
      if (err) client.send(FhMsg.Error, { msg: err });
      this.push(true);
    });
    this.setSimulationInterval((ms) => this.update(ms / 1000), 100);
    console.log(`[400 ${this.roomId}] created`);
  }

  override onUncaughtException(err: RoomException, method: RoomMethodName): void {
    console.error(`[400 ${this.roomId}] error in ${method}:`, err);
  }

  override onJoin(client: Client, o: FhJoin): void {
    if (o?.version !== FH_VERSION) throw new ServerError(4000, 'Game version mismatch — refresh the page.');
    if (this.phase === 'playing') throw new ServerError(4001, 'That table is mid-game.');
    const taken = new Set([...this.members.values()].map((m) => m.chair));
    // Fill chairs in the order you'd sit: me, my partner opposite, then the two opponents.
    const chair = [0, 2, 1, 3].find((c) => !taken.has(c));
    if (chair === undefined) throw new ServerError(4002, 'The table is full.');
    this.members.set(client.sessionId, { id: client.sessionId, name: clean(o?.name), avatar: Math.abs(Math.round(Number(o?.avatar) || 0)) % 12, connected: true, chair });
    if (!this.hostId) this.hostId = client.sessionId;
    this.sendLobby();
  }

  override async onDrop(client: Client): Promise<void> {
    const m = this.members.get(client.sessionId);
    if (m) m.connected = false;
    const p = this.engine?.player(client.sessionId);
    if (p) p.connected = false;
    this.sendLobby();
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
    this.rematch.delete(client.sessionId);
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
    const seats: PlayerSetup[] = [0, 1, 2, 3].map((chair, i) => {
      const m = [...this.members.values()].find((x) => x.chair === chair);
      return m ? { id: m.id, name: m.name, bot: false, avatar: m.avatar } : { id: `bot${chair}`, name: names[i]!, bot: true, avatar: (chair * 3 + 2) % 12 };
    });
    this.snaps.clear();
    this.engine = null;
    this.engine = new FourHundredEngine(seats, { target: this.config.target, scoring: this.config.scoring, turnTime: 30 }, (e) => {
      // The first deal happens inside the constructor (no engine yet): that push sends the live view instead.
      if (!this.engine) return;
      for (const c of this.clients) {
        const list = this.snaps.get(c.sessionId) ?? [];
        list.push(viewFor(this.engine!, c.sessionId));
        this.snaps.set(c.sessionId, list);
      }
      void e;
    });
    this.bots = new BotDriver(this.engine, this.config.botLevel);
    this.phase = 'playing';
    this.rematch.clear();
    void this.lock();
    this.sendLobby();
    this.push(true);
    console.log(`[400 ${this.roomId}] game: ${this.members.size} humans`);
  }

  private update(dt: number): void {
    const e = this.engine;
    if (!e || this.phase === 'lobby') return;
    if (this.phase === 'playing') {
      e.update(dt);
      this.bots?.update(dt);
      // Disconnected players: the table plays for them after a short grace.
      const cur = e.current;
      if (!cur.bot && !cur.connected && e.clock > 4 && (e.phase === 'bidding' || e.phase === 'playing')) e.clock = Math.min(e.clock, 4);
      if (e.isOver) {
        this.phase = 'over';
        this.overTimer = 6;
        if (e.winner !== null) this.wins[e.winner]++;
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
    for (const client of this.clients) {
      const views = this.snaps.get(client.sessionId);
      client.send(FhMsg.State, { view: viewFor(e, client.sessionId), events: events.map((ev) => redact(ev, client.sessionId, e)), views: views?.length === events.length ? views : undefined });
    }
    this.snaps.clear();
  }

  private sendLobby(): void {
    const chairs: FhLobby['chairs'] = [0, 1, 2, 3].map((c) => {
      const m = [...this.members.values()].find((x) => x.chair === c);
      return m ? { id: m.id, name: m.name, avatar: m.avatar, bot: false, connected: m.connected } : null;
    });
    const l: FhLobby = { code: this.roomId, phase: this.phase, hostId: this.hostId, config: this.config, chairs, wins: this.wins, rematch: [...this.rematch], lan: LAN_MODE };
    this.broadcast(FhMsg.Lobby, l);
  }
}
