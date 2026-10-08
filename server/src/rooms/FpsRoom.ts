import { Room, ServerError, type Client } from '@colyseus/core';
import { Game, TICK, type GameEvent, type SoldierSetup } from '../../../client/src/fps/sim/game';
import { BotBrain } from '../../../client/src/fps/sim/bots';
import { MAP } from '../../../client/src/fps/sim/maps';
import { WEAPON, DEFAULT_CLASSES, PERKS, type Loadout } from '../../../client/src/fps/sim/weapons';
import type { Input } from '../../../client/src/fps/sim/player';
import { FP_MAX, FP_VERSION, FpMsg, unpackInput, type FpBegin, type FpConfig, type FpFire, type FpInput, type FpJoin, type FpLobby, type FpSnap } from '../../../client/src/fps/net/protocol';
import { claimRoomCode, releaseRoomCode } from '../matchmaking/RoomCodes';
import { LAN_MODE } from '../lan';

interface Member {
  id: string;
  name: string;
  team: 0 | 1;
  loadout: Loadout;
  camos: Record<string, string>;
  connected: boolean;
  /** Round-trip time the client reports (ms). */
  ping: number;
}

const BOT_NAMES = ['Ghost', 'Soap', 'Price', 'Gaz', 'Roach', 'Nikolai', 'Yuri', 'Farah', 'Alex', 'Kyle', 'Hesh', 'Logan', 'Keegan', 'Merrick', 'Kick', 'Ajax', 'Rook', 'Dutch', 'Ripper', 'Sarge'];
const clean = (raw: unknown) => String(raw ?? '').replace(/[^\p{L}\p{N} _.\-!?']/gu, '').trim().slice(0, 16) || 'Soldier';
const SERVER_EVENTS = new Set<GameEvent['k']>(['shot', 'hit', 'kill', 'medal', 'score', 'explosion', 'streakEarned', 'streakUsed', 'heliShot', 'heliDown', 'flag', 'tag', 'over', 'reload', 'melee', 'grenadeThrow']);

/** Sanitise a loadout from a client (unknown ids fall back to defaults). */
function safeLoadout(l: Loadout | undefined): Loadout {
  const d = DEFAULT_CLASSES[0]!;
  if (!l || typeof l !== 'object') return structuredClone(d);
  const perks = (Array.isArray(l.perks) ? l.perks : d.perks).map((p, i) => (p in PERKS && PERKS[p as keyof typeof PERKS].tier === i + 1 ? p : d.perks[i]!)) as Loadout['perks'];
  const att = l.primaryAtt ?? d.primaryAtt;
  return {
    name: clean(l.name),
    primary: WEAPON[l.primary]?.slot === 'primary' ? l.primary : d.primary,
    secondary: WEAPON[l.secondary]?.slot === 'secondary' ? l.secondary : d.secondary,
    primaryAtt: {
      optic: ['iron', 'reddot', 'holo', 'acog'].includes(att.optic) ? att.optic : 'iron',
      muzzle: att.muzzle === 'suppressor' ? 'suppressor' : 'none',
      under: ['none', 'grip', 'laser'].includes(att.under) ? att.under : 'none',
      ammo: att.ammo === 'extended' ? 'extended' : 'standard',
    },
    perks: perks.length === 3 ? perks : d.perks,
  };
}

/**
 * Zero Hour match server: an authoritative 60 Hz game. Humans send inputs
 * (queued and applied one per tick) and their shots (validated and resolved with
 * lag compensation); bots fill the teams. 30 Hz snapshots + event stream.
 */
export class FpsRoom extends Room {
  override maxClients = FP_MAX;
  private members = new Map<string, Member>();
  private hostId = '';
  private config: FpConfig = { mode: 'tdm', map: 'culdesac', bots: 4, skill: 'regular' };
  private phase: FpLobby['phase'] = 'lobby';
  private game: Game | null = null;
  private brains: BotBrain | null = null;
  private ids: string[] = [];
  private acc = 0;
  private snapAcc = 0;
  private boardAcc = 0;
  private overTimer = 0;
  private readonly botInputs = new Map<string, Input>();

  override onCreate(o: FpJoin): void {
    this.roomId = claimRoomCode();
    void this.setPrivate(o?.visibility !== 'public');
    void this.setMetadata({ code: this.roomId, game: 'zerohour' });
    this.onMessage(FpMsg.Config, (c, cfg: Partial<FpConfig>) => {
      if (c.sessionId !== this.hostId || this.phase !== 'lobby') return;
      if (cfg.mode && ['tdm', 'ffa', 'dom', 'kc'].includes(cfg.mode)) this.config.mode = cfg.mode;
      if (cfg.map && MAP[cfg.map]) this.config.map = cfg.map;
      if (typeof cfg.bots === 'number') this.config.bots = Math.max(0, Math.min(6, Math.round(cfg.bots)));
      if (cfg.skill && ['recruit', 'regular', 'hardened', 'veteran'].includes(cfg.skill)) this.config.skill = cfg.skill;
      this.sendLobby();
    });
    this.onMessage(FpMsg.Team, (c, m: { team?: number }) => {
      const me = this.members.get(c.sessionId);
      if (me && this.phase === 'lobby' && (m.team === 0 || m.team === 1)) me.team = m.team;
      this.sendLobby();
    });
    this.onMessage(FpMsg.Start, (c) => {
      if (c.sessionId !== this.hostId || this.phase !== 'lobby') return;
      this.start();
    });
    this.onMessage(FpMsg.Input, (c, batch: FpInput[]) => {
      const s = this.game?.soldier(c.sessionId);
      if (!s || !Array.isArray(batch)) return;
      for (const raw of batch.slice(0, 30)) if (Array.isArray(raw)) s.queue.push(unpackInput(raw));
      if (s.queue.length > 30) s.queue.splice(0, s.queue.length - 10);
    });
    this.onMessage(FpMsg.Fire, (c, f: FpFire) => {
      const g = this.game;
      const s = g?.soldier(c.sessionId);
      if (!g || !s || !s.alive || g.phase !== 'play' || !f || !Array.isArray(f.d)) return;
      const w = g.weapon(s);
      // Lenient but real checks: ammo, fire rate, not mid-reload / swap / knife.
      if (w.ammo <= 0 || s.reloadT > 0.05 || s.swapT > 0.05 || s.meleeT > 0.05) return;
      if (g.time < s.nextFire - 0.06) return;
      const dirs = f.d.slice(0, 12).filter((d) => Array.isArray(d) && d.length === 3 && d.every(Number.isFinite)).map((d) => {
        const l = Math.hypot(d[0]!, d[1]!, d[2]!) || 1;
        return [d[0]! / l, d[1]! / l, d[2]! / l] as [number, number, number];
      });
      const at = Number.isFinite(f.at) ? Math.max(g.time - 0.6, Math.min(g.time, f.at)) : null;
      const o = Array.isArray(f.o) && f.o.every(Number.isFinite) ? (f.o as [number, number, number]) : undefined;
      g.fire(s, dirs.length ? dirs : null, at, o);
    });
    this.onMessage(FpMsg.Class, (c, l: Loadout) => {
      const m = this.members.get(c.sessionId);
      const lo = safeLoadout(l);
      if (m) m.loadout = lo;
      const s = this.game?.soldier(c.sessionId);
      if (s) s.nextLoadout = lo;
    });
    this.onMessage(FpMsg.Ping, (c, m: { t: number; rtt?: number }) => {
      const mem = this.members.get(c.sessionId);
      if (mem && Number.isFinite(m?.rtt)) mem.ping = Math.max(0, Math.min(9999, Math.round(m.rtt!)));
      c.send(FpMsg.Ping, { t: m?.t ?? 0 });
    });
    this.setSimulationInterval((ms) => this.update(ms / 1000), 1000 / 60);
    console.log(`[zerohour ${this.roomId}] created`);
  }

  override onJoin(client: Client, o: FpJoin): void {
    if (o?.version !== FP_VERSION) throw new ServerError(4000, 'Game version mismatch — refresh the page.');
    if (this.phase === 'playing' && this.game) {
      // Join in progress: drop straight into the smaller team.
      const t0 = this.game.soldiers.filter((s) => s.team === 0 && !s.bot).length;
      const t1 = this.game.soldiers.filter((s) => s.team === 1 && !s.bot).length;
      const team: 0 | 1 = t0 <= t1 ? 0 : 1;
      const m: Member = { id: client.sessionId, name: clean(o?.name), team, loadout: safeLoadout(o?.loadout), camos: o?.camos ?? {}, connected: true, ping: 0 };
      this.members.set(client.sessionId, m);
      // Replace a bot on that team if there is one.
      const bot = this.game.soldiers.find((s) => s.bot && s.team === team);
      if (bot) this.game.remove(bot.id);
      const setup: SoldierSetup = { id: m.id, name: m.name, team, bot: false, loadout: m.loadout, camos: m.camos };
      const s = this.game.add(setup);
      s.remote = true;
      this.ids = this.game.soldiers.map((x) => x.id);
      this.sendLobby();
      // Only the newcomer starts a match; everyone else just mirrors the roster change (same order, so snapshot indices agree).
      client.send(FpMsg.Begin, this.beginMsg());
      this.broadcast(FpMsg.Events, [{ k: 'joined', who: setup, removed: bot?.id ?? '' } satisfies GameEvent], { except: client });
      return;
    }
    if (this.members.size >= FP_MAX) throw new ServerError(4002, 'Lobby full.');
    const t0 = [...this.members.values()].filter((m) => m.team === 0).length;
    const team: 0 | 1 = t0 <= this.members.size - t0 ? 0 : 1;
    this.members.set(client.sessionId, { id: client.sessionId, name: clean(o?.name), team, loadout: safeLoadout(o?.loadout), camos: o?.camos ?? {}, connected: true, ping: 0 });
    if (!this.hostId) this.hostId = client.sessionId;
    this.sendLobby();
  }

  override async onDrop(client: Client): Promise<void> {
    const m = this.members.get(client.sessionId);
    if (m) m.connected = false;
    const s = this.game?.soldier(client.sessionId);
    if (s) s.connected = false;
    this.sendLobby();
    await this.allowReconnection(client, 20);
  }

  override onReconnect(client: Client): void {
    const m = this.members.get(client.sessionId);
    if (m) m.connected = true;
    const s = this.game?.soldier(client.sessionId);
    if (s) s.connected = true;
    this.sendLobby();
    if (this.game) client.send(FpMsg.Begin, this.beginMsg());
  }

  override onLeave(client: Client): void {
    this.members.delete(client.sessionId);
    if (this.game) {
      // A bot takes over the seat.
      const s = this.game.soldier(client.sessionId);
      if (s) {
        s.bot = true;
        s.remote = false;
        s.name = `${s.name} (bot)`;
      }
    }
    if (this.hostId === client.sessionId) this.hostId = this.members.keys().next().value ?? '';
    this.sendLobby();
    if (!this.members.size && this.game) {
      this.game = null;
      this.phase = 'lobby';
    }
  }

  override onDispose(): void {
    releaseRoomCode(this.roomId);
  }

  private beginMsg(): FpBegin {
    const g = this.game!;
    return { map: g.map.id, mode: g.mode, seed: 1, lan: LAN_MODE, roster: g.soldiers.map((s) => ({ id: s.id, name: s.name, team: s.team, bot: s.bot, loadout: s.loadout, camos: s.camos })), time: g.time };
  }

  private start(): void {
    const c = this.config;
    const setups: SoldierSetup[] = [...this.members.values()].map((m) => ({ id: m.id, name: m.name, team: m.team, bot: false, loadout: m.loadout, camos: m.camos }));
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    const camoPool = ['none', 'woodland', 'desert', 'urban', 'digital', 'tiger'];
    let bi = 0;
    const addBot = (team: 0 | 1) => {
      const l = DEFAULT_CLASSES[Math.floor(Math.random() * DEFAULT_CLASSES.length)]!;
      setups.push({ id: `bot${bi++}`, name: names.pop() ?? `Bot${bi}`, team, bot: true, loadout: l, camos: { [l.primary]: camoPool[Math.floor(Math.random() * camoPool.length)]! } });
    };
    if (c.mode === 'ffa') for (let i = setups.length; i < Math.max(2, c.bots * 2); i++) addBot(0);
    else for (const t of [0, 1] as const) for (let i = setups.filter((s) => s.team === t).length; i < c.bots; i++) addBot(t);
    this.game = new Game(c.map, { mode: c.mode }, setups);
    for (const s of this.game.soldiers) s.remote = !s.bot;
    this.brains = new BotBrain(this.game, c.skill);
    this.ids = this.game.soldiers.map((s) => s.id);
    this.phase = 'playing';
    this.acc = this.snapAcc = 0;
    this.sendLobby();
    this.broadcast(FpMsg.Begin, this.beginMsg());
    console.log(`[zerohour ${this.roomId}] match: ${c.mode} on ${c.map}, ${setups.length} soldiers`);
  }

  private update(dt: number): void {
    const g = this.game;
    if (!g) return;
    if (this.phase === 'over') {
      this.overTimer -= dt;
      if (this.overTimer <= 0) {
        this.phase = 'lobby';
        this.game = null;
        this.sendLobby();
      }
      return;
    }
    this.acc = Math.min(this.acc + dt, 0.25);
    const events: GameEvent[] = [];
    while (this.acc >= TICK) {
      this.acc -= TICK;
      this.botInputs.clear();
      this.brains?.update(TICK, this.botInputs);
      g.step(this.botInputs);
      for (const e of g.events.splice(0)) if (SERVER_EVENTS.has(e.k)) events.push(e);
    }
    if (events.length) this.broadcast(FpMsg.Events, events);
    this.snapAcc += dt;
    this.boardAcc += dt;
    if (this.snapAcc >= (LAN_MODE ? 1 / 60 : 1 / 30)) {
      this.snapAcc = 0;
      this.sendSnaps();
    }
    if (g.phase === 'over') {
      this.phase = 'over';
      this.overTimer = 15;
      this.sendSnaps();
      this.sendLobby();
    }
  }

  private sendSnaps(): void {
    const g = this.game!;
    const r = (v: number, k = 100) => Math.round(v * k) / k;
    const rows = g.soldiers.map((s) => {
      const bits = (s.alive ? 1 : 0) | (s.m.crouched ? 2 : 0) | (s.m.sprinting ? 4 : 0) | (s.m.slide > 0 ? 8 : 0) | (s.m.onGround ? 16 : 0) | (s.reloadT > 0 ? 32 : 0);
      return [this.ids.indexOf(s.id), r(s.m.x), r(s.m.y), r(s.m.z), r(s.m.yaw, 1000), r(s.m.pitch, 1000), r(s.m.vx), r(s.m.vy), r(s.m.vz), bits, s.cur, Math.ceil(s.hp), r(s.respawnIn, 10), r(s.adsT)];
    });
    const sendBoard = this.boardAcc >= 1;
    if (sendBoard) this.boardAcc = 0;
    const base = {
      t: g.time,
      tick: g.tickCount,
      s: rows,
      score: [g.score[0], g.score[1]] as [number, number],
      timeLeft: r(g.timeLeft, 10),
      phase: g.phase,
      warmup: g.warmup,
      flags: g.flags.map((f) => [f.owner, r(f.progress), f.capturing] as [number, number, number]),
      tags: g.tags.map((t) => [t.id, t.team, r(t.x), r(t.y), r(t.z)] as [number, number, number, number, number]),
      helis: g.helis.map((h) => [h.id, h.team, r(h.x), r(h.y), r(h.z), r(h.angle)] as [number, number, number, number, number, number]),
      nades: g.grenades.map((n) => [n.id, r(n.x), r(n.y), r(n.z)] as [number, number, number, number]),
      uav: [...g.uav.entries()].filter(([, t]) => t > g.time).map(([k, t]) => [k, r(t - g.time, 10)] as [string, number]),
      barrels: g.barrels.map((b) => (b.alive ? 1 : 0)),
      board: sendBoard ? g.soldiers.map((s) => [this.ids.indexOf(s.id), s.kills, s.deaths, s.assists, s.score, this.members.get(s.id)?.ping ?? 0]) : undefined,
    };
    for (const client of this.clients) {
      const s = g.soldier(client.sessionId);
      if (!s) continue;
      const snap: FpSnap = {
        ...base,
        me: [s.ackSeq, s.weapons[0].ammo, s.weapons[0].reserve, s.weapons[1].ammo, s.weapons[1].reserve, r(s.reloadT), r(s.swapT), s.grenades, s.streak, s.kills, s.deaths, s.score, s.assists, s.m.slide],
        streaks: s.streaks,
      };
      client.send(FpMsg.Snap, snap);
    }
  }

  private sendLobby(): void {
    const l: FpLobby = { code: this.roomId, phase: this.phase, hostId: this.hostId, config: this.config, players: [...this.members.values()].map((m) => ({ id: m.id, name: m.name, team: m.team, connected: m.connected })), lan: LAN_MODE };
    this.broadcast(FpMsg.Lobby, l);
  }
}
