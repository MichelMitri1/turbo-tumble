import { Room, ServerError, type Client } from '@colyseus/core';
import { CARDS } from '../../../client/src/arena/cards';
import { BattleEngine, type BattleEvent } from '../../../client/src/arena/engine';
import { encodeSnapshot } from '../../../client/src/arena/net/codec';
import { CF_RECONNECT_SECONDS, CF_VERSION, CfMsg, type CfCreateOptions, type CfJoinOptions, type CfLobbyView, type CfStart } from '../../../client/src/arena/net/protocol';
import { claimRoomCode, releaseRoomCode } from '../matchmaking/RoomCodes';
import { LAN_MODE } from '../lan';

const TICK = 1 / 30;
/** Snapshot rate: 30 Hz on a LAN, 15 Hz over the internet. */
const SNAP_EVERY = LAN_MODE ? 1 : 2;
const PLAYABLE = new Set(CARDS.map((c) => c.id));

interface Player {
  sessionId: string;
  name: string;
  seat: 'blue' | 'red';
  deck: string[];
  connected: boolean;
  rematch: boolean;
}

function cleanName(raw: unknown): string {
  return String(raw ?? '').replace(/[^\p{L}\p{N} _.\-!?']/gu, '').trim().slice(0, 16) || 'Challenger';
}

function cleanDeck(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const deck = [...new Set(raw.map(String))].filter((id) => PLAYABLE.has(id));
  return deck.length === 8 ? deck : null;
}

/**
 * Crownfall 1v1 room: two players, server-authoritative battle. Clients only send
 * card plays; the server steps the real BattleEngine at 30 Hz and streams snapshots.
 */
export class CrownfallRoom extends Room {
  override maxClients = 2;
  private players = new Map<string, Player>();
  private engine: BattleEngine | null = null;
  private events: BattleEvent[] = [];
  private accumulator = 0;
  private tick = 0;
  private battleId = 0;
  private phase: CfLobbyView['phase'] = 'lobby';
  private startTimer = 0;
  private lastEmote = new Map<string, number>();

  override onCreate(options: CfCreateOptions): void {
    this.roomId = claimRoomCode();
    void this.setPrivate(options?.visibility !== 'public');
    void this.setMetadata({ code: this.roomId, game: 'crownfall' });
    this.onMessage(CfMsg.Play, (client, msg: { cardId?: string; x?: number; y?: number }) => {
      const p = this.players.get(client.sessionId);
      const e = this.engine;
      if (!p || !e || this.phase !== 'battle') return;
      const x = Number(msg?.x);
      const y = Number(msg?.y);
      const ok = Number.isFinite(x) && Number.isFinite(y) && e.play({ team: p.seat, cardId: String(msg?.cardId ?? ''), x, y });
      if (!ok) client.send(CfMsg.Nope, { cardId: msg?.cardId });
    });
    this.onMessage(CfMsg.Emote, (client, msg: { emote?: number }) => {
      const p = this.players.get(client.sessionId);
      const n = Number(msg?.emote);
      if (!p || !this.engine || this.phase !== 'battle' || !Number.isInteger(n) || n < 0 || n > 3) return;
      // One taunt every 2.5 s per player.
      const now = Date.now();
      if (now - (this.lastEmote.get(client.sessionId) ?? 0) < 2500) return;
      this.lastEmote.set(client.sessionId, now);
      this.engine.emote(p.seat, n);
    });
    this.onMessage(CfMsg.Rematch, (client, msg: { deck?: string[] }) => {
      const p = this.players.get(client.sessionId);
      if (!p || this.phase !== 'ended') return;
      p.rematch = true;
      p.deck = cleanDeck(msg?.deck) ?? p.deck;
      this.sendLobby();
      if (this.players.size === 2 && [...this.players.values()].every((x) => x.rematch)) this.startTimer = 1;
    });
    this.setSimulationInterval((ms) => this.update(ms / 1000), 1000 / 30);
    console.log(`[crownfall ${this.roomId}] created (${options?.visibility ?? 'private'})`);
  }

  override onJoin(client: Client, options: CfJoinOptions): void {
    if (options?.version !== CF_VERSION) throw new ServerError(4000, 'Game version mismatch — refresh the page.');
    if (this.phase !== 'lobby') throw new ServerError(4001, 'That battle has already started.');
    const deck = cleanDeck(options?.deck);
    if (!deck) throw new ServerError(4002, 'Your deck needs 8 different cards.');
    const taken = new Set([...this.players.values()].map((p) => p.seat));
    const seat = taken.has('blue') ? 'red' : 'blue';
    this.players.set(client.sessionId, { sessionId: client.sessionId, name: cleanName(options?.name), seat, deck, connected: true, rematch: false });
    console.log(`[crownfall ${this.roomId}] ${cleanName(options?.name)} joined as ${seat}`);
    this.sendLobby();
    if (this.players.size === 2) this.startTimer = 1.2;
  }

  override async onDrop(client: Client): Promise<void> {
    const p = this.players.get(client.sessionId);
    if (p) p.connected = false;
    this.sendLobby();
    await this.allowReconnection(client, CF_RECONNECT_SECONDS);
  }

  override onReconnect(client: Client): void {
    const p = this.players.get(client.sessionId);
    if (!p) return;
    p.connected = true;
    this.sendLobby();
    // Re-send the battle so the rejoining client rebuilds its view.
    if (this.engine && this.phase !== 'lobby') client.send(CfMsg.Start, this.startMessage(p));
  }

  override onLeave(client: Client): void {
    const p = this.players.get(client.sessionId);
    this.players.delete(client.sessionId);
    if (!p) return;
    console.log(`[crownfall ${this.roomId}] ${p.name} left`);
    if (this.engine && this.phase === 'battle') {
      this.engine.forfeit(p.seat);
      this.phase = 'ended';
      this.flush();
    }
    this.startTimer = 0;
    if (this.phase === 'ended' || this.players.size < 2) {
      this.phase = 'lobby';
      this.engine = null;
      for (const other of this.players.values()) {
        other.rematch = false;
        other.seat = 'blue';
      }
      void this.unlock();
    }
    this.sendLobby();
  }

  override onDispose(): void {
    releaseRoomCode(this.roomId);
    console.log(`[crownfall ${this.roomId}] disposed`);
  }

  // ---------------------------------------------------------------- battle

  private startMessage(p: Player): CfStart {
    const blue = [...this.players.values()].find((x) => x.seat === 'blue')!;
    const red = [...this.players.values()].find((x) => x.seat === 'red')!;
    return { battleId: this.battleId, seat: p.seat, names: { blue: blue.name, red: red.name }, decks: { blue: blue.deck, red: red.deck } };
  }

  private startBattle(): void {
    const list = [...this.players.values()];
    if (list.length < 2) return;
    // Alternate sides on rematches.
    if (this.battleId > 0) for (const p of list) p.seat = p.seat === 'blue' ? 'red' : 'blue';
    const blue = list.find((p) => p.seat === 'blue')!;
    const red = list.find((p) => p.seat === 'red')!;
    this.battleId++;
    this.engine = new BattleEngine(blue.deck, red.deck, (Math.random() * 2 ** 31) | 0);
    this.engine.countdown = 4.2; // a beat longer online so both clients have loaded
    this.events = [];
    this.accumulator = 0;
    this.tick = 0;
    this.phase = 'battle';
    for (const p of list) p.rematch = false;
    void this.lock();
    for (const client of this.clients) {
      const p = this.players.get(client.sessionId);
      if (p) client.send(CfMsg.Start, this.startMessage(p));
    }
    this.flush();
    this.sendLobby();
    console.log(`[crownfall ${this.roomId}] battle ${this.battleId}: ${blue.name} vs ${red.name}`);
  }

  private update(dt: number): void {
    if (this.startTimer > 0) {
      this.startTimer -= dt;
      if (this.startTimer <= 0) this.startBattle();
    }
    const e = this.engine;
    if (!e || this.phase === 'lobby') return;
    this.accumulator = Math.min(this.accumulator + dt, TICK * 5);
    while (this.accumulator >= TICK) {
      this.accumulator -= TICK;
      e.step(TICK);
      this.events.push(...e.events);
      e.events.length = 0;
      if (++this.tick % SNAP_EVERY === 0) this.flush();
    }
    if (e.phase === 'ended' && this.phase === 'battle') {
      this.phase = 'ended';
      this.flush();
      this.sendLobby();
    }
  }

  private flush(): void {
    if (!this.engine) return;
    this.broadcast(CfMsg.Snap, encodeSnapshot(this.engine, this.events));
    this.events = [];
  }

  private sendLobby(): void {
    const view: CfLobbyView = {
      code: this.roomId,
      phase: this.phase,
      players: [...this.players.values()].map((p) => ({ sessionId: p.sessionId, name: p.name, seat: p.seat, connected: p.connected, rematch: p.rematch })),
    };
    this.broadcast(CfMsg.Lobby, view);
  }
}
