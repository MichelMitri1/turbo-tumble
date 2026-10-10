import { Client, type Room } from '@colyseus/sdk';
import { defaultServerUrl } from '../../net/serverUrl';
import { Game, TICK, NADE_KINDS, UNIT_KINDS, UNIT_HP, type GameEvent, type Soldier, type SoldierSetup } from '../sim/game';
import { stepMove, type Input } from '../sim/player';
import { WEAPON, type Loadout } from '../sim/weapons';
import type { Session } from '../match';
import { FastLane } from '../../net/fastlane';
import { FP_ROOM, FP_ZM_ROOM, FP_VERSION, FpMsg, packInput, type FpBegin, type FpConfig, type FpFire, type FpInput, type FpJoin, type FpLobby, type FpSnap } from './protocol';

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

  /** Zombies lobbies (create / quick match) instead of multiplayer ones. */
  kind: 'mp' | 'zombies' = 'mp';
  private opts(name: string, loadout: Loadout, camos: Record<string, string>, visibility?: 'private' | 'public'): FpJoin {
    return { version: FP_VERSION, name, loadout, camos, visibility, kind: this.kind };
  }
  async create(name: string, l: Loadout, c: Record<string, string>): Promise<void> {
    this.attach(await this.sdk.create(this.kind === 'zombies' ? FP_ZM_ROOM : FP_ROOM, this.opts(name, l, c, 'private')));
  }
  async quick(name: string, l: Loadout, c: Record<string, string>): Promise<void> {
    this.attach(await this.sdk.joinOrCreate(this.kind === 'zombies' ? FP_ZM_ROOM : FP_ROOM, this.opts(name, l, c, 'public')));
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
    this.lane = new FastLane(room);
    this.lane.on(FpMsg.Snap, (s: FpSnap) => this.onSnap?.(s), { latestOnly: true });
    room.onMessage(FpMsg.Events, (e: GameEvent[]) => this.onEvents?.(e));
    room.onMessage(FpMsg.Error, (m: { msg: string }) => this.onError?.(m.msg));
    this.lane.on(FpMsg.Ping, (m: { t: number }) => (this.rtt = this.rtt * 0.8 + (performance.now() - m.t) * 0.2));
    room.onLeave((code: number, reason?: string) => {
      this.room = null;
      clearInterval(this.pingTimer);
      this.onClosed?.(reason || (code >= 4000 ? `Disconnected (${code})` : undefined));
    });
    // Our measured RTT rides along so the server can show everyone's ping on the scoreboard.
    this.pingTimer = window.setInterval(() => this.lane?.send(FpMsg.Ping, { t: performance.now(), rtt: Math.round(this.rtt) }), 1000);
  }

  /** The fast (unreliable) lane next to the WebSocket. */
  lane: FastLane | null = null;
  input(batch: FpInput[]): void {
    if (this.room) this.lane?.send(FpMsg.Input, batch);
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
    this.lane?.close();
    this.lane = null;
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
  /** Snapshots and event batches, in arrival order (a mid-match join renumbers the roster between them). */
  private inbox: Array<{ snap: FpSnap } | { events: GameEvent[] }> = [];
  private serverEvents: GameEvent[] = [];
  private overSeen = false;
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
    this.game = new Game(begin.map, { mode: begin.mode, mirror: true }, begin.roster.map((r) => ({ ...r })), begin.seed);
    const mine = begin.roster.find((r) => r.id === this.meId)!;
    this.pred = new Game(begin.map, { mode: begin.mode, mirror: true }, [{ ...mine }], begin.seed);
    // Zombies: the predictor shares the mirror's horde (doors, prompts, perks), and its level follows door purchases.
    if (this.game.horde && this.pred.horde) {
      for (const b of this.pred.horde.doorBoxes) this.pred.level.remove(b);
      for (const b of this.game.horde.doorBoxes) this.pred.level.add(b);
      this.game.horde.levels.push(this.pred.level);
      this.pred.horde = this.game.horde;
    }
    this.pred.phase = 'play';
    this.me = this.pred.soldiers[0]!;
    const i = this.game.soldiers.findIndex((s) => s.id === this.meId);
    if (i >= 0) {
      this.me.team = this.game.soldiers[i]!.team;
      this.game.soldiers[i] = this.me;
    }
    this.delay = begin.lan ? 0.05 : 0.1;
    net.onSnap = (snap) => this.inbox.push({ snap });
    net.onEvents = (events) => this.inbox.push({ events });
  }

  /** Server time we render other players at. */
  private renderTime(): number {
    return this.lastSnapT + (performance.now() - this.lastSnapAt) / 1000 - this.delay;
  }

  update(dt: number, input: (id: string) => Input): GameEvent[] {
    const out: GameEvent[] = [];
    for (const m of this.inbox.splice(0)) {
      if ('snap' in m) this.applySnap(m.snap);
      else
        for (const e of m.events) {
          if (e.k === 'joined') this.joined(e.who, e.removed);
          else this.serverEvents.push(e);
        }
    }
    this.game.time = this.renderTime() + this.delay;
    // Zombies are drawn (and hit-tested locally) where they were at the render time — the time our shots are stamped with.
    this.game.horde?.interpolate(this.renderTime());
    this.acc = Math.min(this.acc + dt, 0.2);
    while (this.acc >= TICK) {
      this.acc -= TICK;
      this.prevMe = [this.me.m.x, this.me.m.y, this.me.m.z];
      const inp = input(this.meId);
      this.batch.push(packInput(inp));
      this.pending.push({ seq: inp.seq, inp });
      if (this.pending.length > 120) this.pending.shift();
      // Piloting a killstreak: nothing to predict (the server moves the unit; we just render it).
      if (this.me.alive && !this.me.ctrl) {
        this.pred.phase = this.game.phase === 'over' ? 'over' : 'play';
        // Killstreaks are the server's business (it creates the units and their ids).
        this.pred.step(new Map([[this.meId, { ...inp, streak: -1 }]]));
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
      // Resend the last few unacknowledged inputs too: on the unreliable lane a lost packet
      // is covered by the next one (the server takes each seq once).
      this.net.input(this.pending.slice(-8).map((p) => packInput(p.inp)));
      this.batch = [];
    }
    this.alpha = this.acc / TICK;
    // The mirror's own events (spawns of joiners…) aren't used, except a fallback 'over' (below).
    for (const e of this.game.events.splice(0)) if (e.k === 'over' && !this.overSeen && !this.serverEvents.some((x) => x.k === 'over')) this.serverEvents.push(e);
    for (const e of this.serverEvents.splice(0)) {
      if (e.k === 'over') {
        if (this.overSeen) continue;
        this.overSeen = true;
      }
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
    // Normally the server's own 'over' event arrives with the result; this is the fallback if it was missed.
    if (s.phase === 'over' && g.phase !== 'over') {
      const top = [...g.soldiers].sort((a, b) => (g.mode === 'ffa' ? b.kills - a.kills : b.score - a.score))[0]?.id ?? '';
      g.events.push({ k: 'over', winner: g.mode === 'ffa' ? -1 : s.score[0] === s.score[1] ? -1 : s.score[0] > s.score[1] ? 0 : 1, top });
    }
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
    g.grenades = s.nades.map(([id, x, y, z, kind, rest]) => {
      const was = g.grenades.find((n) => n.id === id);
      // Velocity from the last snapshot (knives fly point-first).
      const vx = was ? (x - was.x) * 30 : 0;
      const vy = was ? (y - was.y) * 30 : 0;
      const vz = was ? (z - was.z) * 30 : 0;
      return { id, owner: '', team: 0 as const, x, y, z, vx, vy, vz, fuse: 1, kind: NADE_KINDS[kind] ?? 'frag', rest: !!rest };
    });
    g.units = s.units.map(([id, kind, team, owner, x, y, z, yaw, pitch, hp, left]) => {
      const k = UNIT_KINDS[kind!] ?? 'rcxd';
      const was = g.units.find((u) => u.id === id);
      return { id: id!, kind: k, owner: this.ids[owner!] ?? '', team: (team === 1 ? 1 : 0) as 0 | 1, x: x!, y: y!, z: z!, yaw: yaw!, pitch: pitch!, speed: was ? Math.hypot(x! - was.x, z! - was.z) * 30 : 0, hp: hp! * UNIT_HP[k], until: g.time + left!, nextShot: 0, target: '', path: [], repath: 0, angle: 0, stuckT: 0 };
    });
    g.smokes = s.smokes.map(([id, x, y, z, age, left]) => ({ id: id!, x: x!, y: y!, z: z!, t0: g.time - age!, until: g.time + left! }));
    g.fires = s.fires.map(([id, x, y, z, r, left]) => ({ id: id!, x: x!, y: y!, z: z!, r: r!, until: g.time + left!, owner: '' }));
    g.cuav = new Map(s.cuav.map(([k, left]) => [k, g.time + left]));
    const mk = g.mode === 'ffa' ? this.meId : `t${this.me.team}`;
    g.marks = new Map([[mk, new Map(s.marks.map(([idx, left]) => [this.ids[idx] ?? '', g.time + left]))]]);
    g.uav = new Map(s.uav.map(([k, left]) => [k, g.time + left]));
    s.barrels.forEach((alive, i) => {
      const b = g.barrels[i];
      if (b) b.alive = !!alive;
    });
    // Zombies: the horde, and which guns everyone holds.
    if (s.zm && g.horde) g.horde.apply(s.zm, this.ids, this.meId, s.t);
    if (s.w)
      for (const [idx, a, b] of s.w) {
        const sol = g.soldier(this.ids[idx] ?? '');
        if (!sol) continue;
        [a, b].forEach((id, k) => {
          if (sol.weapons[k]!.def.id !== id && WEAPON[id]) sol.weapons[k] = g.horde ? g.horde.gun(id, true) : g.makeWeapon(id, sol.weapons[k]!.att);
        });
      }
    // Piloting state first: reconciliation below depends on it.
    this.me.ctrl = s.me[17] ?? 0;
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
      for (const [idx, kills, deaths, assists, score, ping] of s.board) {
        const sol = g.soldier(this.ids[idx!] ?? '');
        if (!sol) continue;
        sol.ping = ping ?? 0;
        if (sol === this.me) continue;
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
    me.tacticals = s.me[14] ?? me.tacticals;
    // On the snapshot's clock (the mirror's time runs on from it): `g.time` here may still be the
    // previous frame's extrapolation, and a late snapshot would leave a phantom white-out.
    me.blindT = s.t + (s.me[15] ?? 0);
    me.stunT = s.t + (s.me[16] ?? 0);
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
      me.reloadT = me.swapT = 0;
      this.pending = [];
      return;
    }
    // Piloting: the soldier stands still server-side; just take its position.
    if (me.ctrl) {
      me.m.x = x;
      me.m.y = y;
      me.m.z = z;
      me.m.vx = me.m.vz = 0;
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

  /** Someone joined mid-match: mirror the server's roster change (same order, so snapshot indices still line up). */
  private joined(who: SoldierSetup, removed: string): void {
    const g = this.game;
    if (removed && removed !== this.meId) g.remove(removed);
    if (!g.soldier(who.id)) g.add({ ...who });
    this.ids = g.soldiers.map((s) => s.id);
    g.events.length = 0;
  }

  /** My ping is measured here; everyone else's comes from the server's scoreboard. */
  ping(s: Soldier): number {
    return s === this.me ? this.net.rtt : (s.ping ?? 0);
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
