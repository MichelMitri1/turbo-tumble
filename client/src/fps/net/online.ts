import { Client, type Room } from '@colyseus/sdk';
import { defaultServerUrl } from '../../net/serverUrl';
import { Game, TICK, type GameEvent, type Soldier } from '../sim/game';
import { stepMove, type Input } from '../sim/player';
import type { Loadout } from '../sim/weapons';
import type { Session } from '../match';
import { FP_ROOM, FP_VERSION, FpMsg, packInput, type FpBegin, type FpConfig, type FpFire, type FpInput, type FpJoin, type FpLobby, type FpSnap } from './protocol';

export class FpsNet {
  readonly url = defaultServerUrl();
  private readonly sdk = new Client(this.url);
  room: Room | null = null;
  lobby: FpLobby | null = null;
  rtt = 60;
  onLobby: ((l: FpLobby) => void) | null = null;
  onBegin: ((b: FpBegin) => void) | null = null;
  onSnap: ((s: FpSnap) => void) | null = null;
  onEvents: ((e: GameEvent[]) => void) | null = null;
  onError: ((m: string) => void) | null = null;
  onClosed: ((reason?: string) => void) | null = null;
  private pingTimer = 0;

  get sessionId(): string {
    return this.room?.sessionId ?? '';
  }
  get code(): string {
    return this.room?.roomId ?? '';
  }

  async probe(): Promise<{ ok: boolean; lan: string[] | null }> {
    try {
      const res = await fetch(`${this.url.replace(/^ws/, 'http')}/health`, { signal: AbortSignal.timeout(2500) });
      const info = (await res.json()) as { lan?: string[] };
      return { ok: res.ok, lan: info.lan ?? null };
    } catch {
      return { ok: false, lan: null };
    }
  }

  private opts(name: string, loadout: Loadout, camos: Record<string, string>, visibility?: 'private' | 'public'): FpJoin {
    return { version: FP_VERSION, name, loadout, camos, visibility };
  }
  async create(name: string, l: Loadout, c: Record<string, string>): Promise<void> {
    this.attach(await this.sdk.create(FP_ROOM, this.opts(name, l, c, 'private')));
  }
  async quick(name: string, l: Loadout, c: Record<string, string>): Promise<void> {
    this.attach(await this.sdk.joinOrCreate(FP_ROOM, this.opts(name, l, c, 'public')));
  }
  async join(code: string, name: string, l: Loadout, c: Record<string, string>): Promise<void> {
    this.attach(await this.sdk.joinById(code.toUpperCase(), this.opts(name, l, c)));
  }

  private attach(room: Room): void {
    this.room = room;
    room.onMessage(FpMsg.Lobby, (l: FpLobby) => {
      this.lobby = l;
      this.onLobby?.(l);
    });
    room.onMessage(FpMsg.Begin, (b: FpBegin) => this.onBegin?.(b));
    room.onMessage(FpMsg.Snap, (s: FpSnap) => this.onSnap?.(s));
    room.onMessage(FpMsg.Events, (e: GameEvent[]) => this.onEvents?.(e));
    room.onMessage(FpMsg.Error, (m: { msg: string }) => this.onError?.(m.msg));
    room.onMessage(FpMsg.Ping, (m: { t: number }) => (this.rtt = this.rtt * 0.8 + (performance.now() - m.t) * 0.2));
    room.onLeave((code: number, reason?: string) => {
      this.room = null;
      clearInterval(this.pingTimer);
      this.onClosed?.(reason || (code >= 4000 ? `Disconnected (${code})` : undefined));
    });
    this.pingTimer = window.setInterval(() => this.room?.send(FpMsg.Ping, { t: performance.now() }), 1500);
  }

  input(batch: FpInput[]): void {
    this.room?.send(FpMsg.Input, batch);
  }
  fire(f: FpFire): void {
    this.room?.send(FpMsg.Fire, f);
  }
  cls(l: Loadout): void {
    this.room?.send(FpMsg.Class, l);
  }
  config(c: Partial<FpConfig>): void {
    this.room?.send(FpMsg.Config, c);
  }
  team(t: 0 | 1): void {
    this.room?.send(FpMsg.Team, { team: t });
  }
  start(): void {
    this.room?.send(FpMsg.Start);
  }
  async leave(): Promise<void> {
    const r = this.room;
    this.room = null;
    clearInterval(this.pingTimer);
    if (r) await r.leave(true).catch(() => undefined);
  }
}

interface Sample {
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

/**
 * Online match: the server's game is mirrored for rendering; my soldier is
 * predicted locally (movement + weapon timing) and reconciled with the server.
 */
export class OnlineSession implements Session {
  readonly online = true;
  readonly game: Game;
  readonly meId: string;
  alpha = 0;
  private readonly pred: Game;
  private readonly me: Soldier;
  private acc = 0;
  private pending: Array<{ seq: number; inp: Input }> = [];
  private batch: FpInput[] = [];
  private snaps: FpSnap[] = [];
  private serverEvents: GameEvent[] = [];
  private buffers = new Map<string, Sample[]>();
  private lastSnapAt = 0;
  private lastSnapT = 0;
  private readonly delay: number;
  private prevMe: [number, number, number] = [0, 0, 0];
  private ids: string[];

  constructor(
    private readonly net: FpsNet,
    begin: FpBegin,
  ) {
    this.meId = net.sessionId;
    this.ids = begin.roster.map((r) => r.id);
    this.game = new Game(begin.map, { mode: begin.mode }, begin.roster.map((r) => ({ ...r })), begin.seed);
    const mine = begin.roster.find((r) => r.id === this.meId)!;
    this.pred = new Game(begin.map, { mode: begin.mode }, [{ ...mine }], begin.seed);
    this.pred.phase = 'play';
    this.me = this.pred.soldiers[0]!;
    const i = this.game.soldiers.findIndex((s) => s.id === this.meId);
    if (i >= 0) {
      this.me.team = this.game.soldiers[i]!.team;
      this.game.soldiers[i] = this.me;
    }
    this.delay = begin.lan ? 0.05 : 0.1;
    net.onSnap = (s) => this.snaps.push(s);
    net.onEvents = (e) => this.serverEvents.push(...e);
  }

  /** Server time we render other players at. */
  private renderTime(): number {
    return this.lastSnapT + (performance.now() - this.lastSnapAt) / 1000 - this.delay;
  }

  update(dt: number, input: () => Input): GameEvent[] {
    const out: GameEvent[] = [];
    for (const s of this.snaps.splice(0)) this.applySnap(s);
    this.game.time = this.renderTime() + this.delay;
    this.acc = Math.min(this.acc + dt, 0.2);
    while (this.acc >= TICK) {
      this.acc -= TICK;
      this.prevMe = [this.me.m.x, this.me.m.y, this.me.m.z];
      const inp = input();
      this.batch.push(packInput(inp));
      this.pending.push({ seq: inp.seq, inp });
      if (this.pending.length > 120) this.pending.shift();
      if (this.me.alive) {
        this.pred.phase = this.game.phase === 'over' ? 'over' : 'play';
        this.pred.step(new Map([[this.meId, inp]]));
        for (const e of this.pred.events.splice(0)) {
          if (e.k === 'shot') {
            // Tell the server exactly where we fired (it re-checks and lag-compensates).
            const dirs = e.hits.map((h) => {
              const dx = h[0] - e.fx;
              const dy = h[1] - e.fy;
              const dz = h[2] - e.fz;
              const l = Math.hypot(dx, dy, dz) || 1;
              return [+(dx / l).toFixed(5), +(dy / l).toFixed(5), +(dz / l).toFixed(5)];
            });
            this.net.fire({ d: dirs, o: [e.fx, e.fy, e.fz], at: this.renderTime() });
            out.push(e);
          } else if (e.k === 'reload' || e.k === 'empty' || e.k === 'melee' || e.k === 'grenadeThrow') out.push(e);
        }
        this.pred.grenades.length = 0;
      } else this.pred.events.length = 0;
    }
    if (this.batch.length) {
      this.net.input(this.batch);
      this.batch = [];
    }
    this.alpha = this.acc / TICK;
    for (const e of this.serverEvents.splice(0)) {
      if (e.k === 'shot') {
        if (e.by === this.meId) continue;
        const s = this.game.soldier(e.by);
        if (s) s.lastFireT = this.game.time;
      }
      if ((e.k === 'reload' || e.k === 'empty' || e.k === 'melee' || e.k === 'grenadeThrow') && 'who' in e && e.who === this.meId) continue;
      out.push(e);
    }
    return out;
  }

  private applySnap(s: FpSnap): void {
    const g = this.game;
    this.lastSnapAt = performance.now();
    this.lastSnapT = s.t;
    g.score[0] = s.score[0];
    g.score[1] = s.score[1];
    g.timeLeft = s.timeLeft;
    if (s.phase === 'over' && g.phase !== 'over') g.events.push({ k: 'over', winner: s.score[0] === s.score[1] ? -1 : s.score[0] > s.score[1] ? 0 : 1, top: '' });
    g.phase = s.phase;
    g.warmup = s.warmup;
    s.flags.forEach(([owner, progress, capturing], i) => {
      const f = g.flags[i];
      if (!f) return;
      f.owner = owner as -1 | 0 | 1;
      f.progress = progress;
      f.capturing = capturing as -1 | 0 | 1;
    });
    g.tags = s.tags.map(([id, team, x, y, z]) => ({ id, team: team as 0 | 1, victim: '', killer: '', x, y, z, t: g.time }));
    g.helis = s.helis.map(([id, team, x, y, z, angle]) => ({ id, owner: '', team: team as 0 | 1, until: 0, angle, x, y, z, hp: 1, target: '', burst: 0, nextShot: 0, cooldown: 0 }));
    g.grenades = s.nades.map(([id, x, y, z]) => ({ id, owner: '', team: 0, x, y, z, vx: 0, vy: 0, vz: 0, fuse: 1, kind: 'frag' }));
    g.uav = new Map(s.uav.map(([k, left]) => [k, g.time + left]));
    s.barrels.forEach((alive, i) => {
      const b = g.barrels[i];
      if (b) b.alive = !!alive;
    });
    for (const row of s.s) {
      const [idx, x, y, z, yaw, pitch, vx, vy, vz, bits, cur, hp, respawnIn, adsT] = row as number[];
      const id = this.ids[idx!];
      const sol = id ? g.soldier(id) : undefined;
      if (!sol) continue;
      const alive = !!(bits! & 1);
      if (sol === this.me) {
        this.reconcile(s, x!, y!, z!, vx!, vy!, vz!, bits!, alive, hp!, respawnIn!, yaw!);
        continue;
      }
      sol.alive = alive;
      sol.hp = hp!;
      sol.respawnIn = respawnIn!;
      sol.cur = (cur === 1 ? 1 : 0) as 0 | 1;
      sol.adsT = adsT!;
      sol.m.crouched = !!(bits! & 2);
      sol.m.sprinting = !!(bits! & 4);
      sol.m.slide = bits! & 8 ? 0.5 : 0;
      sol.m.onGround = !!(bits! & 16);
      sol.reloadT = bits! & 32 ? 1 : 0;
      sol.m.vx = vx!;
      sol.m.vy = vy!;
      sol.m.vz = vz!;
      let buf = this.buffers.get(id!);
      if (!buf) this.buffers.set(id!, (buf = []));
      buf.push({ t: s.t, x: x!, y: y!, z: z!, yaw: yaw!, pitch: pitch! });
      if (buf.length > 30) buf.shift();
      // Keep the authoritative position on the mirror too (aim targets, minimap).
      sol.m.x = x!;
      sol.m.y = y!;
      sol.m.z = z!;
      sol.m.yaw = yaw!;
      sol.m.pitch = pitch!;
    }
    if (s.board) {
      for (const [idx, kills, deaths, assists, score] of s.board) {
        const sol = g.soldier(this.ids[idx!] ?? '');
        if (!sol || sol === this.me) continue;
        sol.kills = kills!;
        sol.deaths = deaths!;
        sol.assists = assists!;
        sol.score = score!;
      }
    }
    // Me: weapon / score state.
    const [ack, a0, r0, a1, r1, reloadT, swapT, nades, streak, kills, deaths, score, assists] = s.me;
    void ack;
    const me = this.me;
    if (g.time - me.lastFireT > 0.35 && me.reloadT <= 0) {
      me.weapons[0].ammo = a0!;
      me.weapons[0].reserve = r0!;
      me.weapons[1].ammo = a1!;
      me.weapons[1].reserve = r1!;
    }
    if (reloadT! > 0 && me.reloadT <= 0) me.reloadT = reloadT!;
    void swapT;
    me.grenades = nades!;
    me.streak = streak!;
    me.kills = kills!;
    me.deaths = deaths!;
    me.score = score!;
    me.assists = assists!;
    me.streaks = s.streaks as typeof me.streaks;
  }

  private reconcile(s: FpSnap, x: number, y: number, z: number, vx: number, vy: number, vz: number, bits: number, alive: boolean, hp: number, respawnIn: number, yaw: number): void {
    const me = this.me;
    const ack = s.me[0]!;
    me.hp = hp;
    me.respawnIn = respawnIn;
    if (!alive) {
      if (me.alive) me.killedBy = '';
      me.alive = false;
      me.m.x = x;
      me.m.y = y;
      me.m.z = z;
      return;
    }
    if (!me.alive) {
      // Respawned.
      me.alive = true;
      me.m.x = x;
      me.m.y = y;
      me.m.z = z;
      me.m.yaw = yaw;
      me.m.vx = me.m.vy = me.m.vz = 0;
      me.spawnT = this.game.time;
      for (const w of me.weapons) {
        w.ammo = w.def.mag;
        w.reserve = w.def.reserve;
      }
      me.grenades = 2;
      me.reloadT = me.swapT = 0;
      this.pending = [];
      return;
    }
    // Replay our unacknowledged inputs on top of the server state.
    this.pending = this.pending.filter((p) => p.seq > ack);
    const m = { ...me.m, x, y, z, vx, vy, vz, crouched: !!(bits & 2), slide: bits & 8 ? me.m.slide : 0, onGround: !!(bits & 16) };
    const w = me.weapons[me.cur].def;
    const lw = me.loadout.perks.includes('lightweight') ? 1.07 : 1;
    for (const p of this.pending) stepMove(this.pred.level, m, p.inp, TICK, w.move * lw, me.adsT < 0.3, me.adsT);
    const err = Math.hypot(m.x - me.m.x, m.y - me.m.y, m.z - me.m.z);
    if (err > 0.03) {
      // Small errors blend in; big ones snap.
      const k = err > 1.5 ? 1 : 0.35;
      me.m.x += (m.x - me.m.x) * k;
      me.m.y += (m.y - me.m.y) * k;
      me.m.z += (m.z - me.m.z) * k;
      me.m.vx = m.vx;
      me.m.vy = m.vy;
      me.m.vz = m.vz;
    }
  }

  pose(s: Soldier) {
    if (s === this.me) {
      const p = this.prevMe;
      const a = this.alpha;
      if (Math.hypot(p[0] - s.m.x, p[2] - s.m.z) > 2) return { x: s.m.x, y: s.m.y, z: s.m.z, yaw: s.m.yaw, pitch: s.m.pitch, vx: s.m.vx, vz: s.m.vz };
      return { x: p[0] + (s.m.x - p[0]) * a, y: p[1] + (s.m.y - p[1]) * a, z: p[2] + (s.m.z - p[2]) * a, yaw: s.m.yaw, pitch: s.m.pitch, vx: s.m.vx, vz: s.m.vz };
    }
    const buf = this.buffers.get(s.id);
    const t = this.renderTime();
    if (buf && buf.length) {
      let a = buf[0]!;
      let b = buf[buf.length - 1]!;
      for (let i = 0; i < buf.length - 1; i++) {
        if (buf[i]!.t <= t && buf[i + 1]!.t >= t) {
          a = buf[i]!;
          b = buf[i + 1]!;
          break;
        }
      }
      const k = b.t > a.t ? Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t))) : 1;
      let dy = b.yaw - a.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      if (Math.hypot(b.x - a.x, b.z - a.z) > 3) return { x: b.x, y: b.y, z: b.z, yaw: b.yaw, pitch: b.pitch, vx: s.m.vx, vz: s.m.vz };
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k, yaw: a.yaw + dy * k, pitch: a.pitch + (b.pitch - a.pitch) * k, vx: s.m.vx, vz: s.m.vz };
    }
    return { x: s.m.x, y: s.m.y, z: s.m.z, yaw: s.m.yaw, pitch: s.m.pitch, vx: s.m.vx, vz: s.m.vz };
  }

  /** Class change applies on the next spawn (server side too). */
  setClass(l: Loadout): void {
    this.net.cls(l);
  }

  dispose(): void {
    this.net.onSnap = null;
    this.net.onEvents = null;
  }
}
