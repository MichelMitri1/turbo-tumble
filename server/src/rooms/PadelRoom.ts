import { Room, ServerError, type Client } from '@colyseus/core';
import { MatchSim, TICK, type Input, type MatchEvent, type PlayerDef, type Stroke } from '../../../client/src/padel/sim/match';
import { writeFrame } from '../../../client/src/padel/sim/snapshot';
import { LEVELS, type Level } from '../../../client/src/padel/sim/ai';
import { RACKET, RACKETS } from '../../../client/src/padel/sim/rackets';
import { PD_MAX_PER_TEAM, PD_VERSION, PdMsg, type PdBegin, type PdConfig, type PdJoin, type PdLobby } from '../../../client/src/padel/net/protocol';
import { cleanArm, type LiveArm } from '../../../client/src/padel/sim/arm';
import { FastLane } from '../fastlane';
import { claimRoomCode, releaseRoomCode } from '../matchmaking/RoomCodes';
import { LAN_MODE } from '../lan';

interface Member {
  id: string;
  name: string;
  team: 0 | 1;
  racket: string;
  connected: boolean;
}

const clean = (raw: unknown) => String(raw ?? '').replace(/[^\p{L}\p{N} _.\-!?']/gu, '').trim().slice(0, 16) || 'Player';
const COURTS = new Set(['blue', 'red', 'grey', 'green', 'black', 'purple']);
const BOT_NAMES = ['Lebrón', 'Tapia', 'Galán', 'Coello', 'Navarro', 'Stupa', 'Chingotto', 'Yanguas', 'Bela', 'Lima', 'Sanyo', 'Di Nenno'];
const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0);

/**
 * Padel online: the server runs the authoritative match at 120 Hz. Each client is one player; empty
 * places are bots. Movement arrives on the fast lane (queued, one per tick), swings reliably (applied
 * on the next tick), and every client gets a packed frame 30 (LAN 60) times a second plus the events.
 */
export class PadelRoom extends Room {
  override maxClients = PD_MAX_PER_TEAM * 2;
  private members = new Map<string, Member>();
  private hostId = '';
  private config: PdConfig = { mode: 2, level: 'intermediate', games: 4, sets: 1, golden: true, court: 'blue' };
  private phase: PdLobby['phase'] = 'lobby';
  private sim: MatchSim | null = null;
  private begin: PdBegin | null = null;
  private moves = new Map<string, Input>();
  private strokes = new Map<string, Stroke>();
  /** Camera motion play: each player's live racket arm. */
  private arms = new Map<string, LiveArm | null>();
  private lastSeq = new Map<string, number>();
  private acc = 0;
  private lane!: FastLane;
  private snapT = 0;
  private overT = 0;
  private frame: Float32Array | undefined;

  override onCreate(options: PdJoin): void {
    this.roomId = claimRoomCode();
    void this.setPrivate(options?.visibility !== 'public');
    void this.setMetadata({ code: this.roomId, game: 'padel' });
    this.onMessage(PdMsg.Config, (client, c: Partial<PdConfig> | undefined) => {
      if (client.sessionId !== this.hostId || this.phase !== 'lobby' || !c || typeof c !== 'object') return;
      if (c.mode === 1 || c.mode === 2) this.config.mode = c.mode;
      if (typeof c.level === 'string' && c.level in LEVELS) this.config.level = c.level as Level;
      if (c.games === 4 || c.games === 6) this.config.games = c.games;
      if (c.sets === 1 || c.sets === 3) this.config.sets = c.sets;
      if (typeof c.golden === 'boolean') this.config.golden = c.golden;
      if (typeof c.court === 'string' && COURTS.has(c.court)) this.config.court = c.court;
      this.sendLobby();
    });
    this.onMessage(PdMsg.Team, (client, m: { team?: number } | undefined) => {
      const me = this.members.get(client.sessionId);
      const team = m?.team;
      if (!me || this.phase !== 'lobby' || (team !== 0 && team !== 1)) return;
      if ([...this.members.values()].filter((x) => x.team === team && x !== me).length >= PD_MAX_PER_TEAM) return client.send(PdMsg.Error, { msg: 'That side is full.' });
      me.team = team;
      this.sendLobby();
    });
    this.onMessage(PdMsg.Start, (client) => {
      if (client.sessionId !== this.hostId || this.phase !== 'lobby') return;
      const per = this.config.mode;
      for (const t of [0, 1] as const)
        if ([...this.members.values()].filter((m) => m.team === t).length > per) return client.send(PdMsg.Error, { msg: `Too many players on one side for ${per} v ${per}.` });
      this.startMatch();
    });
    this.onMessage(PdMsg.Stroke, (client, s: Partial<Stroke> | undefined) => {
      if (!this.sim || !s) return;
      const st: Stroke = { dx: num(s.dx, -1, 1), dy: num(s.dy, -1, 1), power: num(s.power, 0, 1), lob: !!s.lob };
      // Camera swings carry the timing assist (bounded).
      if (typeof s.hold === 'number') st.hold = num(s.hold, 0, 0.8);
      this.strokes.set(client.sessionId, st);
    });
    this.lane = new FastLane(this);
    this.lane.on(PdMsg.Move, (client, m: { r?: unknown; a?: unknown } | undefined) => {
      if (!this.sim || !m || !Array.isArray(m.r)) return;
      this.arms.set(client.sessionId, cleanArm(m.a));
      let last = this.lastSeq.get(client.sessionId) ?? 0;
      for (const e of m.r.slice(-6)) {
        if (!Array.isArray(e) || e.length < 4 || !(Number(e[0]) > last)) continue;
        last = Number(e[0]);
        this.moves.set(client.sessionId, { mx: num(e[1], -1, 1), mz: num(e[2], -1, 1), stroke: null, auto: !!e[3] });
      }
      this.lastSeq.set(client.sessionId, last);
    });
    this.onMessage(PdMsg.Hello, (client) => {
      client.send(PdMsg.Lobby, this.lobby());
      if (this.begin && this.phase === 'playing') client.send(PdMsg.Begin, this.begin);
    });
    this.lane.on(PdMsg.Ping, (client, m: { t?: unknown } | undefined) => this.lane.send(client, PdMsg.Ping, { t: typeof m?.t === 'number' ? m.t : 0 }));
    this.setSimulationInterval((ms) => this.update(ms), 1000 / 60);
  }

  override onJoin(client: Client, o: PdJoin): void {
    if (o?.version !== PD_VERSION) throw new ServerError(4000, 'Game version mismatch — refresh the page.');
    if (this.phase !== 'lobby') throw new ServerError(4001, 'That match already started.');
    const t0 = [...this.members.values()].filter((m) => m.team === 0).length;
    const team: 0 | 1 = t0 <= this.members.size - t0 ? 0 : 1;
    this.members.set(client.sessionId, { id: client.sessionId, name: clean(o?.name), team, racket: RACKET[o?.racket] ? o.racket : 'tempest', connected: true });
    if (!this.hostId) this.hostId = client.sessionId;
    this.sendLobby();
  }

  override async onDrop(client: Client): Promise<void> {
    const m = this.members.get(client.sessionId);
    if (m) m.connected = false;
    this.sendLobby();
    await this.allowReconnection(client, 20);
  }

  override onReconnect(client: Client): void {
    const m = this.members.get(client.sessionId);
    if (m) m.connected = true;
    this.sendLobby();
    if (this.begin && this.phase === 'playing') client.send(PdMsg.Begin, this.begin);
  }

  override onLeave(client: Client): void {
    this.lane.drop(client.sessionId);
    this.lastSeq.delete(client.sessionId);
    this.members.delete(client.sessionId);
    // A player who leaves mid-match is replaced by a bot.
    const p = this.sim?.players.find((x) => x.def.id === client.sessionId);
    if (p) {
      p.def.human = false;
      p.def.level = this.config.level;
    }
    if (this.hostId === client.sessionId) this.hostId = this.members.keys().next().value ?? '';
    this.sendLobby();
  }

  override onDispose(): void {
    this.lane.dispose();
    releaseRoomCode(this.roomId);
  }

  private startMatch(): void {
    const seed = (Math.random() * 1e9) | 0;
    const per = this.config.mode;
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    const defs: PlayerDef[] = [];
    for (const team of [0, 1] as const) {
      const humans = [...this.members.values()].filter((m) => m.team === team);
      for (let slot = 0; slot < per; slot++) {
        const h = humans[slot];
        if (h) defs.push({ id: h.id, name: h.name, team, slot: slot as 0 | 1, human: true, racket: h.racket });
        else defs.push({ id: `bot${team}${slot}`, name: names.pop()!, team, slot: slot as 0 | 1, human: false, racket: RACKETS[(seed + slot + team * 2) % RACKETS.length]!.id, level: this.config.level });
      }
    }
    this.sim = new MatchSim({ players: defs.map((d) => ({ ...d })), format: { games: this.config.games, sets: this.config.sets, golden: this.config.golden }, seed });
    this.begin = { config: { ...this.config }, seed, defs, lan: LAN_MODE };
    this.moves.clear();
    this.strokes.clear();
    this.arms.clear();
    this.acc = 0;
    this.phase = 'playing';
    void this.lock();
    this.sendLobby();
    this.broadcast(PdMsg.Begin, this.begin);
    console.log(`[padel ${this.roomId}] ${per}v${per}, ${this.members.size} humans`);
  }

  private update(ms: number): void {
    const sim = this.sim;
    if (!sim || this.phase === 'lobby') return;
    if (this.phase === 'over') {
      this.overT -= ms / 1000;
      if (this.overT <= 0) {
        this.phase = 'lobby';
        this.sim = null;
        this.begin = null;
        void this.unlock();
        this.sendLobby();
      }
      return;
    }
    this.acc = Math.min(this.acc + ms / 1000, 0.1);
    const events: MatchEvent[] = [];
    while (this.acc >= TICK) {
      this.acc -= TICK;
      const inputs = new Map<string, Input>();
      for (const p of sim.players) {
        if (!p.def.human) continue;
        const mv = this.moves.get(p.def.id);
        const st = this.strokes.get(p.def.id) ?? null;
        this.strokes.delete(p.def.id);
        inputs.set(p.def.id, { mx: mv?.mx ?? 0, mz: mv?.mz ?? 0, auto: mv?.auto ?? true, stroke: st, arm: this.arms.get(p.def.id) ?? null });
      }
      sim.step(inputs);
      events.push(...sim.events.splice(0));
    }
    if (events.length) this.broadcast(PdMsg.Events, events);
    this.snapT -= ms / 1000;
    if (this.snapT <= 0) {
      this.snapT += LAN_MODE ? 1 / 60 : 1 / 30;
      if (this.snapT < 0) this.snapT = 0;
      this.frame = writeFrame(sim, this.frame);
      const bytes = new Uint8Array(this.frame.buffer.slice(0));
      for (const c of this.clients) this.lane.sendBytes(c, PdMsg.Snap, bytes);
    }
    if (sim.phase === 'over') {
      this.phase = 'over';
      this.overT = 20;
      this.sendLobby();
    }
  }

  private lobby(): PdLobby {
    return { code: this.roomId, phase: this.phase, hostId: this.hostId, config: this.config, players: [...this.members.values()], lan: LAN_MODE };
  }

  private sendLobby(): void {
    this.broadcast(PdMsg.Lobby, this.lobby());
  }
}
