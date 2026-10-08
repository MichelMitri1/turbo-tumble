import { Room, ServerError, type Client, type RoomException, type RoomMethodName } from '@colyseus/core';
import { JackarooEngine, type Action, type Move, type PlayerSetup } from '../../../client/src/jackaroo/engine';
import { BotDriver, chooseAction } from '../../../client/src/jackaroo/bots';
import { redact, viewFor, type View } from '../../../client/src/jackaroo/view';
import { BOT_NAMES } from '../../../client/src/jackaroo/link';
import { JK_SEATS, JK_TURN_TIME, JK_VERSION, JkMsg, type JkConfig, type JkJoin, type JkLobby } from '../../../client/src/jackaroo/net/protocol';
import { claimRoomCode, releaseRoomCode } from '../matchmaking/RoomCodes';
import { LAN_MODE } from '../lan';

interface Member {
  id: string;
  name: string;
  avatar: number;
  connected: boolean;
  seat: number;
}

const clean = (raw: unknown) => String(raw ?? '').replace(/[^\p{L}\p{N} _.\-!?']/gu, '').trim().slice(0, 14) || 'Player';
const int = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

/** Client messages are untrusted: rebuild a well-formed action or reject it (the engine validates the rules). */
function parseAction(raw: unknown): Action | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  if (!int(a.card, 0, 51)) return null;
  if (a.t === 'burn') return { t: 'burn', card: a.card };
  if (a.t !== 'play' || !a.move || typeof a.move !== 'object') return null;
  const m = a.move as Record<string, unknown>;
  let move: Move | null = null;
  switch (m.k) {
    case 'out':
    case 'back':
      if (int(m.m, 0, 15)) move = { k: m.k, m: m.m };
      break;
    case 'fwd':
      if (int(m.m, 0, 15) && int(m.n, 1, 13)) move = { k: 'fwd', m: m.m, n: m.n };
      break;
    case 'swap':
      if (int(m.m, 0, 15) && int(m.t, 0, 15)) move = { k: 'swap', m: m.m, t: m.t };
      break;
    case 'attack':
      move = { k: 'attack' };
      break;
    case 'split': {
      const parts = m.parts;
      if (!Array.isArray(parts) || parts.length < 1 || parts.length > 2) break;
      const clean2: Array<{ m: number; n: number }> = [];
      for (const pt of parts as Array<Record<string, unknown>>) {
        if (!pt || !int(pt.m, 0, 15) || !int(pt.n, 1, 7)) return null;
        clean2.push({ m: pt.m, n: pt.n });
      }
      move = { k: 'split', parts: clean2 };
      break;
    }
  }
  return move ? { t: 'play', card: a.card, move } : null;
}

/**
 * Jackaroo table: 4 seats (2v2, partners opposite) or 2 (1v1). Players pick their
 * seat (= team) in the lobby; bots fill the empty seats when the host starts. The
 * server owns the engine, validates every action and sends each player only their
 * own hand.
 */
export class JackarooRoom extends Room {
  override maxClients = JK_SEATS;
  private members = new Map<string, Member>();
  private hostId = '';
  private config: JkConfig = { mode: 'classic', players: 4, botLevel: 'normal' };
  private engine: JackarooEngine | null = null;
  private bots: BotDriver | null = null;
  private phase: JkLobby['phase'] = 'lobby';
  private refresh = 0;
  private overTimer = 0;
  private idle = new Map<string, number>();
  private rematch = new Set<string>();
  private teamWins: [number, number] = [0, 0];
  private snaps = new Map<string, View[]>();

  override onCreate(options: JkJoin): void {
    this.roomId = claimRoomCode();
    void this.setPrivate(options?.visibility !== 'public');
    void this.setMetadata({ code: this.roomId, game: 'jackaroo' });
    this.onMessage(JkMsg.Config, (client, raw: unknown) => {
      if (client.sessionId !== this.hostId || this.phase === 'playing' || !raw || typeof raw !== 'object') return;
      const c = raw as Partial<Record<keyof JkConfig, unknown>>;
      if (c.mode === 'classic' || c.mode === 'complex') this.config.mode = c.mode;
      if (c.botLevel === 'easy' || c.botLevel === 'normal' || c.botLevel === 'hard') this.config.botLevel = c.botLevel;
      if (c.players === 2 || c.players === 4) {
        if (c.players === 2 && this.members.size > 2) client.send(JkMsg.Error, { msg: 'Too many players at the table for 1v1.' });
        else if (c.players !== this.config.players) {
          this.config.players = c.players;
          this.reseat();
        }
      }
      this.sendLobby();
    });
    this.onMessage(JkMsg.Seat, (client, raw: unknown) => {
      const m = this.members.get(client.sessionId);
      const seat = (raw as { seat?: unknown })?.seat;
      if (!m || this.phase === 'playing' || !int(seat, 0, this.config.players - 1)) return;
      if ([...this.members.values()].some((o) => o.seat === seat)) return client.send(JkMsg.Error, { msg: 'That seat is taken.' });
      m.seat = seat;
      this.sendLobby();
    });
    this.onMessage(JkMsg.Start, (client) => {
      if (client.sessionId !== this.hostId || this.phase === 'playing') return;
      this.startGame();
    });
    this.onMessage(JkMsg.Rematch, (client) => {
      if (this.phase === 'playing' || !this.members.has(client.sessionId)) return;
      this.rematch.add(client.sessionId);
      this.sendLobby();
      if ([...this.members.keys()].every((id) => this.rematch.has(id))) this.startGame();
    });
    this.onMessage(JkMsg.Act, (client, raw: unknown) => {
      if (!this.engine || this.phase !== 'playing') return;
      const a = parseAction(raw);
      if (!a) return client.send(JkMsg.Error, { msg: 'Bad action.' });
      const err = this.engine.act(client.sessionId, a);
      if (err) client.send(JkMsg.Error, { msg: err });
      this.idle.delete(client.sessionId);
      this.push(true);
    });
    this.setSimulationInterval((ms) => this.update(ms / 1000), 100);
    console.log(`[jackaroo ${this.roomId}] created`);
  }

  override onUncaughtException(err: RoomException, method: RoomMethodName): void {
    // A bad message must never take the whole table down: log it and keep serving.
    console.error(`[jackaroo ${this.roomId}] error in ${method}:`, err);
  }

  override onJoin(client: Client, o: JkJoin): void {
    if (o?.version !== JK_VERSION) throw new ServerError(4000, 'Game version mismatch — refresh the page.');
    if (this.phase === 'playing') throw new ServerError(4001, 'That table is mid-game.');
    const seat = this.freeSeat();
    if (seat < 0) throw new ServerError(4002, 'That table is full.');
    this.members.set(client.sessionId, { id: client.sessionId, name: clean(o?.name), avatar: Math.abs(Math.round(Number(o?.avatar) || 0)) % 12, connected: true, seat });
    if (!this.hostId) this.hostId = client.sessionId;
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
    this.idle.delete(client.sessionId);
    this.sendLobby();
    this.push(true);
  }

  override onLeave(client: Client): void {
    this.members.delete(client.sessionId);
    this.rematch.delete(client.sessionId);
    // Mid-game a bot takes the seat over so the team keeps playing.
    this.engine?.leave(client.sessionId);
    if (this.hostId === client.sessionId) this.hostId = this.members.keys().next().value ?? '';
    this.sendLobby();
    this.push(true);
  }

  override onDispose(): void {
    releaseRoomCode(this.roomId);
  }

  private freeSeat(): number {
    const taken = new Set([...this.members.values()].map((m) => m.seat));
    for (let s = 0; s < this.config.players; s++) if (!taken.has(s)) return s;
    return -1;
  }

  /** Seat count changed: keep people where they are when possible, else move them to free seats. */
  private reseat(): void {
    const used = new Set<number>();
    const movers: Member[] = [];
    for (const m of this.members.values()) {
      if (m.seat < this.config.players && !used.has(m.seat)) used.add(m.seat);
      else movers.push(m);
    }
    for (const m of movers) {
      for (let s = 0; s < this.config.players; s++)
        if (!used.has(s)) {
          m.seat = s;
          used.add(s);
          break;
        }
    }
  }

  private startGame(): void {
    const n = this.config.players;
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    const seats: PlayerSetup[] = [];
    for (let s = 0; s < n; s++) {
      const m = [...this.members.values()].find((x) => x.seat === s);
      seats.push(m ? { id: m.id, name: m.name, bot: false, avatar: m.avatar } : { id: `bot${s}`, name: names[s]!, bot: true, avatar: (3 + s * 5) % 12 });
    }
    this.snaps.clear();
    this.engine = new JackarooEngine(
      seats,
      { mode: this.config.mode, turnTime: JK_TURN_TIME },
      (e) => {
        for (const c of this.clients) {
          const list = this.snaps.get(c.sessionId) ?? [];
          list.push(viewFor(e, c.sessionId));
          this.snaps.set(c.sessionId, list);
        }
      },
      { auto: (e, p) => chooseAction(e, p, 'normal') },
    );
    this.bots = new BotDriver(this.engine, this.config.botLevel, () => true, true);
    this.phase = 'playing';
    this.idle.clear();
    this.rematch.clear();
    void this.lock();
    this.sendLobby();
    this.push(true);
    console.log(`[jackaroo ${this.roomId}] game: ${n} seats, ${this.config.mode}`);
  }

  private update(dt: number): void {
    const e = this.engine;
    if (!e || this.phase === 'lobby') return;
    if (this.phase === 'playing') {
      e.update(dt);
      this.bots?.update(dt);
      // Disconnected players: auto-play after a short grace so the table never waits long.
      const cur = e.current;
      if (!e.isOver && !cur.bot && !cur.connected) {
        const t = (this.idle.get(cur.id) ?? 0) + dt;
        this.idle.set(cur.id, t);
        if (t > 6) {
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
    this.overTimer = 6;
    const w = this.engine?.winner ?? -1;
    if (w === 0 || w === 1) this.teamWins[w]++;
    this.push(true);
    this.sendLobby();
  }

  /** Send every connected client their own view + the new events (other hands redacted). */
  private push(force: boolean): void {
    const e = this.engine;
    if (!e || (!e.events.length && !force)) return;
    this.refresh = 0.5;
    const events = e.events.splice(0);
    for (const client of this.clients) {
      const views = this.snaps.get(client.sessionId);
      const me = e.idx(client.sessionId);
      client.send(JkMsg.State, { view: viewFor(e, client.sessionId), events: events.map((ev) => redact(ev, me)), views: views?.length === events.length ? views : undefined });
    }
    this.snaps.clear();
  }

  private sendLobby(): void {
    const seats: JkLobby['seats'] = Array.from({ length: this.config.players }, (_, s) => {
      const m = [...this.members.values()].find((x) => x.seat === s);
      return m ? { id: m.id, name: m.name, avatar: m.avatar, connected: m.connected } : null;
    });
    const l: JkLobby = { code: this.roomId, phase: this.phase, hostId: this.hostId, config: this.config, seats, teamWins: this.teamWins, rematch: [...this.rematch], lan: LAN_MODE };
    this.broadcast(JkMsg.Lobby, l);
  }
}
