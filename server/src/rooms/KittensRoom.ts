import { Room, ServerError, type Client, type RoomException, type RoomMethodName } from '@colyseus/core';
import { KittensEngine, type Action, type PlayerSetup } from '../../../client/src/kittens/engine';
import type { CardType } from '../../../client/src/kittens/cards';
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

/** Untrusted payload → a well-formed Action (or null). The engine re-checks the rules. */
function parseAction(raw: unknown): Action | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const str = (x: unknown) => (typeof x === 'string' && x.length <= 32 ? x : undefined);
  switch (a.t) {
    case 'draw':
    case 'pass':
      return { t: a.t };
    case 'nope': {
      const card = num(a.card);
      const expect = a.expect === undefined ? undefined : num(a.expect);
      return card === null || expect === null ? null : { t: 'nope', card, expect };
    }
    case 'play': {
      if (!Array.isArray(a.cards) || !a.cards.length || a.cards.length > 5) return null;
      const cards = a.cards.map(num);
      if (cards.some((c) => c === null)) return null;
      return { t: 'play', cards: cards as number[], target: str(a.target), as: str(a.as) as CardType | undefined, named: str(a.named) };
    }
    case 'respond': {
      const prompt = num(a.prompt);
      if (prompt === null) return null;
      const c = a.choice;
      if (typeof c === 'number' && Number.isFinite(c)) return { t: 'respond', prompt, choice: c };
      if (typeof c === 'string' && c.length <= 32) return { t: 'respond', prompt, choice: c };
      if (Array.isArray(c) && c.length <= 5 && c.every((x) => num(x) !== null)) return { t: 'respond', prompt, choice: c as number[] };
      if (c && typeof c === 'object' && !Array.isArray(c)) {
        const o = c as Record<string, unknown>;
        if (typeof o.target === 'string' && (o.give === 'godcat' || o.give === 'devilcat')) return { t: 'respond', prompt, choice: { target: o.target, give: o.give } };
      }
      return null;
    }
  }
  return null;
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
  private config: KkConfig = { deck: 'gve', bots: 0, botLevel: 'normal', fullDeck: false, anyPairs: true, imploding: false };
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
      if (!c || typeof c !== 'object') return;
      // Switching decks resets the pairing rule to that deck's own default.
      if ((c.deck === 'gve' || c.deck === 'classic') && c.deck !== this.config.deck) {
        this.config.deck = c.deck;
        this.config.anyPairs = c.deck === 'gve';
      }
      for (const k of ['fullDeck', 'anyPairs', 'imploding'] as const) if (typeof c[k] === 'boolean') this.config[k] = c[k];
      if (typeof c.bots === 'number') this.config.bots = Math.max(0, Math.min(KK_MAX_PLAYERS - this.members.size, Math.round(c.bots)));
      if (c.botLevel === 'easy' || c.botLevel === 'normal' || c.botLevel === 'hard') this.config.botLevel = c.botLevel;
      this.sendLobby();
    });
    this.onMessage(KkMsg.Start, (client) => {
      if (client.sessionId !== this.hostId || this.phase === 'playing') return;
      if (this.members.size + this.config.bots < 2) return client.send(KkMsg.Error, { msg: 'Add a bot or wait for a friend first.' });
      this.startGame();
    });
    this.onMessage(KkMsg.Act, (client, raw: unknown) => {
      if (!this.engine || this.phase !== 'playing') return;
      const a = parseAction(raw);
      if (!a) return client.send(KkMsg.Error, { msg: 'Bad action.' });
      const err = this.engine.act(client.sessionId, a);
      if (err) client.send(KkMsg.Error, { msg: err });
      this.push(true);
    });
    this.setSimulationInterval((ms) => this.update(ms / 1000), 100);
    console.log(`[kittens ${this.roomId}] created`);
  }

  override onUncaughtException(err: RoomException, method: RoomMethodName): void {
    // A bad message must never take the whole table down: log it and keep serving.
    console.error(`[kittens ${this.roomId}] error in ${method}:`, err);
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
    const { deck, fullDeck, anyPairs, imploding } = this.config;
    this.engine = new KittensEngine(seats, { deck, fullDeck, anyPairs, imploding, nopeWindow: 3.5, promptTimeout: 25, turnTimeout: 45 });
    this.bots = new BotDriver(this.engine, this.config.botLevel);
    this.phase = 'playing';
    void this.lock();
    this.sendLobby();
    this.push(true);
    console.log(`[kittens ${this.roomId}] game: ${seats.length} seats (${this.config.bots} bots), ${deck}${imploding ? ' + imploding' : ''}`);
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
