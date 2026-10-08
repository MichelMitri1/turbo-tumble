import { Room, ServerError, type Client } from '@colyseus/core';
import { MatchSim, NO_INPUT, type Input, type MatchEvent } from '../../../client/src/football/sim/match';
import { CLUB } from '../../../client/src/football/sim/data';
import { writeFrame } from '../../../client/src/football/sim/snapshot';
import { FB_MAX_PER_TEAM, FB_VERSION, FbMsg, INPUT_BITS, type FbBegin, type FbConfig, type FbInput, type FbJoin, type FbLobby } from '../../../client/src/football/net/protocol';
import { claimRoomCode, releaseRoomCode } from '../matchmaking/RoomCodes';
import { LAN_MODE } from '../lan';

interface Member {
  id: string;
  name: string;
  team: 0 | 1;
  connected: boolean;
}

const clean = (raw: unknown) => String(raw ?? '').replace(/[^\p{L}\p{N} _.\-!?']/gu, '').trim().slice(0, 16) || 'Player';
const HALVES = [60, 120, 180, 240, 300, 360, 600];
const DIFFS = new Set(['amateur', 'pro', 'world', 'legendary']);

/**
 * Matchday online: the server runs the authoritative match at 60 Hz. Each client steers
 * one player on its side (the rest of the XI is AI); inputs are queued and applied one per
 * tick, and every client gets a packed frame 30 times a second plus the match events.
 */
export class FootballRoom extends Room {
  override maxClients = FB_MAX_PER_TEAM * 2;
  private members = new Map<string, Member>();
  private hostId = '';
  private config: FbConfig = { home: 'nbu', away: 'val', half: 180, difficulty: 'pro' };
  private phase: FbLobby['phase'] = 'lobby';
  private sim: MatchSim | null = null;
  private begin: FbBegin | null = null;
  private queues = new Map<string, Input[]>();
  private last = new Map<string, Input>();
  private acc = 0;
  private snapT = 0;
  private statsT = 0;
  private overT = 0;
  private frame: Float32Array | undefined;

  override onCreate(options: FbJoin): void {
    this.roomId = claimRoomCode();
    void this.setPrivate(options?.visibility !== 'public');
    void this.setMetadata({ code: this.roomId, game: 'matchday' });
    this.onMessage(FbMsg.Config, (client, c: Partial<FbConfig> | undefined) => {
      if (client.sessionId !== this.hostId || this.phase !== 'lobby' || !c || typeof c !== 'object') return;
      if (typeof c.home === 'string' && CLUB[c.home]) this.config.home = c.home;
      if (typeof c.away === 'string' && CLUB[c.away]) this.config.away = c.away;
      if (typeof c.half === 'number' && HALVES.includes(c.half)) this.config.half = c.half;
      if (typeof c.difficulty === 'string' && DIFFS.has(c.difficulty)) this.config.difficulty = c.difficulty as FbConfig['difficulty'];
      if (this.config.home === this.config.away) this.config.away = Object.keys(CLUB).find((k) => k !== this.config.home)!;
      this.sendLobby();
    });
    this.onMessage(FbMsg.Team, (client, m: { team?: number } | undefined) => {
      const me = this.members.get(client.sessionId);
      const team = m?.team;
      if (!me || this.phase !== 'lobby' || (team !== 0 && team !== 1)) return;
      if ([...this.members.values()].filter((x) => x.team === team && x !== me).length >= FB_MAX_PER_TEAM) return client.send(FbMsg.Error, { msg: 'That side is full.' });
      me.team = team;
      this.sendLobby();
    });
    this.onMessage(FbMsg.Start, (client) => {
      if (client.sessionId !== this.hostId || this.phase !== 'lobby') return;
      this.startMatch();
    });
    this.onMessage(FbMsg.Input, (client, m: FbInput | undefined) => {
      if (!this.sim || !m || typeof m.x !== 'number' || typeof m.z !== 'number' || typeof m.b !== 'number') return;
      const f = (v: number) => (Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);
      const b = m.b | 0;
      const inp: Input = { mx: f(m.x), mz: f(m.z), sprint: !!(b & INPUT_BITS.sprint), pass: !!(b & INPUT_BITS.pass), shoot: !!(b & INPUT_BITS.shoot), through: !!(b & INPUT_BITS.through), lob: !!(b & INPUT_BITS.lob), finesse: !!(b & INPUT_BITS.finesse), chip: !!(b & INPUT_BITS.chip), switch: !!(b & INPUT_BITS.switch), skill: !!(b & INPUT_BITS.skill) };
      let q = this.queues.get(client.sessionId);
      if (!q) this.queues.set(client.sessionId, (q = []));
      q.push(inp);
      if (q.length > 6) q.splice(0, q.length - 3);
    });
    this.onMessage(FbMsg.Hello, (client) => {
      client.send(FbMsg.Lobby, this.lobby());
      if (this.begin && this.phase === 'playing') client.send(FbMsg.Begin, this.begin);
    });
    this.onMessage(FbMsg.Ping, (client, m: { t?: unknown } | undefined) => client.send(FbMsg.Ping, { t: typeof m?.t === 'number' ? m.t : 0 }));
    this.setSimulationInterval((ms) => this.update(ms), 1000 / 60);
  }

  override onJoin(client: Client, o: FbJoin): void {
    if (o?.version !== FB_VERSION) throw new ServerError(4000, 'Game version mismatch — refresh the page.');
    if (this.phase !== 'lobby') throw new ServerError(4001, 'That match already started.');
    const t0 = [...this.members.values()].filter((m) => m.team === 0).length;
    const team: 0 | 1 = t0 <= this.members.size - t0 ? 0 : 1;
    this.members.set(client.sessionId, { id: client.sessionId, name: clean(o?.name), team, connected: true });
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
    if (this.begin && this.phase === 'playing') client.send(FbMsg.Begin, this.begin);
  }

  override onLeave(client: Client): void {
    this.members.delete(client.sessionId);
    this.sim?.removeHuman(client.sessionId);
    if (this.hostId === client.sessionId) this.hostId = this.members.keys().next().value ?? '';
    this.sendLobby();
  }

  override onDispose(): void {
    releaseRoomCode(this.roomId);
  }

  private startMatch(): void {
    const seed = (Math.random() * 1e9) | 0;
    const sim = new MatchSim({ home: this.config.home, away: this.config.away, halfSeconds: this.config.half, difficulty: this.config.difficulty, seed });
    const humans: FbBegin['humans'] = [];
    for (const m of this.members.values()) {
      sim.addHuman(m.id, m.team);
      humans.push({ id: m.id, name: m.name, team: m.team });
    }
    this.sim = sim;
    this.begin = { config: { ...this.config }, seed, humans, lan: LAN_MODE };
    this.queues.clear();
    this.last.clear();
    this.acc = 0;
    this.phase = 'playing';
    void this.lock();
    this.sendLobby();
    this.broadcast(FbMsg.Begin, this.begin);
    console.log(`[matchday ${this.roomId}] ${this.config.home} v ${this.config.away}, ${humans.length} humans`);
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
    const inputs = new Map<string, Input>();
    const events: MatchEvent[] = [];
    while (this.acc >= 1 / 60) {
      this.acc -= 1 / 60;
      for (const h of sim.humans) {
        const q = this.queues.get(h.id);
        const inp = q?.shift() ?? this.last.get(h.id) ?? NO_INPUT;
        this.last.set(h.id, inp);
        inputs.set(h.id, inp);
      }
      sim.step(inputs);
      events.push(...sim.events.splice(0));
    }
    if (events.length) this.broadcast(FbMsg.Events, events);
    this.snapT -= ms / 1000;
    if (this.snapT <= 0) {
      this.snapT = 1 / 30;
      this.frame = writeFrame(sim, this.frame);
      const bytes = new Uint8Array(this.frame.buffer.slice(0));
      for (const c of this.clients) c.sendBytes(FbMsg.Snap, bytes);
    }
    this.statsT -= ms / 1000;
    if (this.statsT <= 0 || events.some((e) => e.k === 'goal' || e.k === 'full' || e.k === 'half')) {
      this.statsT = 2;
      this.broadcast(FbMsg.Stats, { stats: sim.stats, goals: sim.goals });
    }
    if (sim.phase === 'fulltime') {
      this.phase = 'over';
      this.overT = 20;
      this.broadcast(FbMsg.Stats, { stats: sim.stats, goals: sim.goals });
      this.sendLobby();
    }
  }

  private lobby(): FbLobby {
    return { code: this.roomId, phase: this.phase, hostId: this.hostId, config: this.config, players: [...this.members.values()], lan: LAN_MODE };
  }

  private sendLobby(): void {
    this.broadcast(FbMsg.Lobby, this.lobby());
  }
}
