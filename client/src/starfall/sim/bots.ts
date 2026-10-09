import { COLORS, KILL_RANGE, REPORT_RANGE, USE_RANGE, type Event, type Game, type Player } from './game';
import type { Spot, TaskKind } from './maps';

/**
 * Bots. Crewmates walk to their tasks and do them, report bodies they come across, rush to
 * fix sabotages and remember what they saw (who was where, who vented, who killed).
 * Impostors fake tasks, stalk lone crewmates, kill when nobody's looking, slip into vents,
 * sabotage, sometimes self-report — and lie in meetings. Everyone talks and votes.
 */

const TASK_TIME: Partial<Record<TaskKind, number>> = { download: 9, upload: 9, sample: 12, scan: 10, reactor: 8, fuel: 4, asteroids: 9, diagnostics: 10, canister: 7, wifi: 9, jug: 5, weather: 6, process: 8 };

interface Sighting {
  id: number;
  room: string;
  t: number;
}

interface Brain {
  path: Array<[number, number]>;
  goal: Spot | null;
  /** What it's doing at the goal. */
  doing: 'task' | 'fake' | 'report' | 'fix' | 'hunt' | 'vent' | 'wander' | 'button' | '';
  task: number;
  wait: number;
  repath: number;
  stuck: number;
  lastX: number;
  lastY: number;
  /** Suspicion per player (100 = saw them kill / vent). */
  sus: Map<number, number>;
  why: Map<number, string>;
  seen: Sighting[];
  /** Body it's heading to report. */
  body: number;
  /** Impostor: who it's stalking, vent plan. */
  prey: number;
  ventT: number;
  ventHops: number;
  /** Where it claims to have been (for the meeting). */
  claim: string;
  look: number;
  voteAt: number;
  saidAt: number;
  said: number;
  fixAt: number;
  /** Reached the end of its path (the goal itself may be inside furniture). */
  arrived: boolean;
}

export class Bots {
  private brains = new Map<number, Brain>();
  private lines: Array<{ at: number; id: number; text: string }> = [];

  constructor(private g: Game) {
    for (const p of g.players) if (p.bot) this.brains.set(p.id, this.fresh());
  }

  private fresh(): Brain {
    return { path: [], goal: null, doing: '', task: -1, wait: 0, repath: 0, stuck: 0, lastX: 0, lastY: 0, sus: new Map(), why: new Map(), seen: [], body: -1, prey: -1, ventT: 0, ventHops: 0, claim: '', look: 0, voteAt: 0, saidAt: 0, said: 0, fixAt: 0, arrived: false };
  }

  /** A player was replaced by a bot (left the game). */
  adopt(id: number): void {
    if (!this.brains.has(id)) this.brains.set(id, this.fresh());
  }

  private name(id: number): string {
    return this.g.players[id]?.name ?? '?';
  }
  private colorName(id: number): string {
    return COLORS[this.g.players[id]?.color ?? 0]?.[0] ?? '';
  }

  /** React to what just happened (kills, vents they saw; meetings). */
  events(evs: Event[]): void {
    const g = this.g;
    for (const e of evs) {
      if (e.k === 'kill') {
        for (const [id, b] of this.brains) {
          const p = g.players[id]!;
          if (!p.alive || p.impostor || id === e.victim) continue;
          if (g.sees(p, { x: e.x, y: e.y })) {
            b.sus.set(e.killer, 100);
            b.why.set(e.killer, `I saw ${this.name(e.killer)} kill ${this.name(e.victim)}!`);
            b.body = e.victim;
            b.doing = 'report';
            b.goal = { x: e.x, y: e.y };
            b.path = [];
          }
        }
      }
      if (e.k === 'vent') {
        for (const [id, b] of this.brains) {
          const p = g.players[id]!;
          if (!p.alive || p.impostor || id === e.id) continue;
          if (g.sees(p, { x: e.x, y: e.y })) {
            b.sus.set(e.id, 100);
            b.why.set(e.id, `${this.name(e.id)} vented in ${g.roomOf(e) || 'the hallway'}!`);
          }
        }
      }
      if (e.k === 'meeting') this.meeting(e.caller, e.body);
      if (e.k === 'chat') this.reply(e.id, e.text);
      if (e.k === 'phase' && e.phase === 'play')
        for (const b of this.brains.values()) {
          b.path = [];
          b.goal = null;
          b.doing = '';
          b.body = -1;
          b.prey = -1;
        }
    }
  }

  update(dt: number): void {
    const g = this.g;
    if (g.phase === 'meeting') return this.meetingTick();
    if (g.phase !== 'play') {
      for (const id of this.brains.keys()) {
        const p = g.players[id]!;
        p.ix = p.iy = 0;
      }
      return;
    }
    for (const [id, b] of this.brains) {
      const p = g.players[id]!;
      if (!p.connected && !p.bot) continue;
      b.look -= dt;
      if (b.look <= 0) {
        b.look = 0.25;
        this.perceive(p, b);
      }
      if (p.impostor && p.alive) this.impostor(p, b, dt);
      else this.crew(p, b, dt);
      this.walk(p, b, dt);
    }
  }

  // ---------------------------------------------------------------- senses

  private perceive(p: Player, b: Brain): void {
    const g = this.g;
    if (!p.alive) return;
    for (const q of g.players) {
      if (q === p || !q.alive || q.vent >= 0) continue;
      if (!g.sees(p, q)) continue;
      b.seen.push({ id: q.id, room: g.roomOf(q), t: g.time });
      // Doing a visual task in front of you: that's a crewmate.
      if (q.busy === 'scan' && g.cfg.visualTasks) b.sus.set(q.id, -100);
    }
    if (b.seen.length > 200) b.seen.splice(0, b.seen.length - 200);
    // A body! (crew report it; impostors usually walk away)
    if (!p.impostor && b.doing !== 'report')
      for (const body of g.bodies)
        if (g.sees(p, body)) {
          b.doing = 'report';
          b.body = body.id;
          b.goal = { x: body.x, y: body.y };
          b.path = [];
          // Whoever's standing over it is suspicious.
          for (const q of g.players)
            if (q !== p && q.alive && Math.hypot(q.x - body.x, q.y - body.y) < 3 && g.sees(p, q)) {
              b.sus.set(q.id, Math.max(b.sus.get(q.id) ?? 0, 45));
              b.why.set(q.id, `${this.name(q.id)} was right next to the body.`);
            }
          break;
        }
  }

  // ---------------------------------------------------------------- crewmates (and ghosts)

  private crew(p: Player, b: Brain, dt: number): void {
    const g = this.g;
    // Report the body when close enough.
    if (b.doing === 'report' && p.alive) {
      const body = g.bodies.find((x) => x.id === b.body);
      if (!body) b.doing = '';
      else if (Math.hypot(p.x - body.x, p.y - body.y) < REPORT_RANGE - 0.4) {
        b.claim = `I found ${this.name(b.body)} in ${g.roomOf(body) || 'the hallway'}.`;
        g.act(p.id, { k: 'report', body: body.id });
        return;
      }
      return;
    }
    // Sabotages: go fix (critical ones first, everybody nearby helps).
    const sab = g.sabotage;
    if (sab && p.alive) {
      const spots = g.sabotageSpots(sab.kind);
      // Which station is mine? Nearest unfixed one where nobody closer is headed.
      const station = this.myStation(p, spots, sab.kind);
      if (station >= 0) {
        const st = spots[station]!;
        if (Math.hypot(p.x - st.x, p.y - st.y) < USE_RANGE + 0.5) {
          p.ix = p.iy = 0;
          b.fixAt -= dt;
          if (b.fixAt > 0) return;
          b.fixAt = 0.5;
          if (sab.kind === 'lights') {
            const i = sab.switches.findIndex((s) => !s);
            if (i >= 0) g.act(p.id, { k: 'switch', i });
          } else if (sab.kind === 'o2') g.act(p.id, { k: 'o2', station, code: sab.code });
          else if (sab.kind === 'comms') g.act(p.id, { k: 'comms', station });
          else g.act(p.id, { k: 'hold', station, on: true });
          return;
        }
        if (b.doing !== 'fix' || b.goal?.x !== st.x) {
          if (b.doing === 'task') g.act(p.id, { k: 'busy', kind: '' });
          b.doing = 'fix';
          b.goal = { x: st.x, y: st.y };
          b.path = [];
          b.arrived = false;
        }
        return;
      }
    } else if (b.doing === 'fix') {
      b.doing = '';
      g.act(p.id, { k: 'hold', station: -1, on: false });
    }
    // Doing a task: stand there for its time, then complete it.
    if (b.doing === 'task' && b.goal && Math.hypot(p.x - b.goal.x, p.y - b.goal.y) < USE_RANGE + 0.6) {
      b.wait -= dt;
      if (b.wait <= 0) {
        g.act(p.id, { k: 'task', task: b.task });
        b.doing = '';
        b.goal = null;
      }
      return;
    }
    if (b.doing === 'task' || b.doing === 'wander') return;
    // Next task: the nearest step left.
    let best = -1;
    let bd = Infinity;
    p.tasks.forEach((t, i) => {
      if (t.done) return;
      const s = t.spots[t.step]!;
      const d = Math.hypot(s.x - p.x, s.y - p.y) + g.rand() * 6;
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    if (best >= 0) {
      const t = p.tasks[best]!;
      const s = t.spots[t.step]!;
      b.doing = 'task';
      b.task = best;
      b.goal = { x: s.x, y: s.y };
      b.wait = (TASK_TIME[s.kind] ?? 3.5) * (0.8 + g.rand() * 0.5);
      b.path = [];
      b.claim = `I was in ${g.map.roomAt(s.x, s.y) || 'the hallway'} doing ${t.name}.`;
      return;
    }
    // Nothing left: wander between rooms.
    this.wander(p, b);
  }

  /** Station assignment for the current sabotage: each open station gets its own nearest bot (two for critical ones). */
  private assignT = -1;
  private assigned = new Map<number, number>();
  private myStation(p: Player, spots: Spot[], kind: string): number {
    const g = this.g;
    if (this.assignT !== g.time) {
      this.assignT = g.time;
      this.assigned.clear();
      const open = spots.map((s, i) => ({ s, i })).filter(({ i }) => !g.sabotage?.done[i]);
      const crew = g.players.filter((q) => q.alive && !q.impostor && q.bot);
      const per = kind === 'reactor' || kind === 'seismic' ? 2 : 1;
      const pairs = open.flatMap(({ s, i }) => crew.map((q) => ({ i, q: q.id, d: Math.hypot(q.x - s.x, q.y - s.y) }))).sort((a, c) => a.d - c.d);
      const count = new Map<number, number>();
      // First pass: one bot per station; second pass: a backup each.
      for (let pass = 0; pass < per; pass++)
        for (const pr of pairs) {
          if (this.assigned.has(pr.q) || (count.get(pr.i) ?? 0) > pass) continue;
          this.assigned.set(pr.q, pr.i);
          count.set(pr.i, (count.get(pr.i) ?? 0) + 1);
        }
    }
    return this.assigned.get(p.id) ?? -1;
  }

  private wander(_p: Player, b: Brain): void {
    const g = this.g;
    const rooms = g.def.rooms;
    const r = rooms[Math.floor(g.rand() * rooms.length)]!;
    const c = r.rect ? { x: (r.rect[0] + r.rect[2]) / 2, y: (r.rect[1] + r.rect[3]) / 2 } : { x: r.poly!.reduce((a, q) => a + q[0], 0) / r.poly!.length, y: r.poly!.reduce((a, q) => a + q[1], 0) / r.poly!.length };
    b.doing = 'wander';
    b.goal = c;
    b.path = [];
    b.wait = 2 + g.rand() * 4;
  }

  // ---------------------------------------------------------------- impostors

  private impostor(p: Player, b: Brain, dt: number): void {
    const g = this.g;
    const crew = g.players.filter((q) => q.alive && !q.impostor);
    // In a vent: hop once or twice, pop out when nobody can see.
    if (p.vent >= 0) {
      b.ventT -= dt;
      if (b.ventT > 0) return;
      const v = g.def.vents[p.vent]!;
      if (b.ventHops > 0 && v.links.length) {
        b.ventHops--;
        g.act(p.id, { k: 'vent', op: 'move', to: v.links[Math.floor(g.rand() * v.links.length)] });
        b.ventT = 0.8;
        return;
      }
      if (crew.some((q) => g.sees(q, v))) {
        b.ventT = 0.5;
        return;
      }
      g.act(p.id, { k: 'vent', op: 'exit' });
      b.doing = '';
      return;
    }
    // Sabotage now and then (lights help the hunt).
    if (g.sabotageCd <= 0 && !g.sabotage && g.rand() < dt * 0.03) {
      const opts: Array<'lights' | 'comms' | 'reactor' | 'o2' | 'seismic'> = ['lights', 'lights', 'comms', 'reactor', 'o2', 'seismic'];
      for (const k of opts.sort(() => g.rand() - 0.5)) if (g.sabotageSpots(k).length && !g.act(p.id, { k: 'sabotage', kind: k })) break;
    }
    if (g.def.doors.length && g.rand() < dt * 0.01) {
      const d = g.def.doors[Math.floor(g.rand() * g.def.doors.length)]!;
      g.act(p.id, { k: 'sabotage', kind: 'doors', room: d.room });
    }
    // Hunting: a lone crewmate nobody else can see.
    if (p.killCd <= 0.5) {
      const witnessed = (x: number, y: number, prey: Player) => crew.some((q) => q !== prey && g.sees(q, { x, y }));
      let prey = g.players[b.prey];
      if (!prey || !prey.alive || prey.impostor || !g.sees(p, prey)) {
        prey = crew.filter((q) => g.sees(p, q) && Math.hypot(q.x - p.x, q.y - p.y) < 8).sort((a, c) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(c.x - p.x, c.y - p.y))[0];
        b.prey = prey?.id ?? -1;
      }
      if (prey) {
        const d = Math.hypot(prey.x - p.x, prey.y - p.y);
        const safe = !witnessed(p.x, p.y, prey) && !witnessed(prey.x, prey.y, prey);
        if (d < KILL_RANGE - 0.2 && safe && p.killCd <= 0) {
          if (!g.act(p.id, { k: 'kill', target: prey.id })) {
            b.prey = -1;
            b.claim = `I was in ${g.roomOf(p) === g.roomOf(prey) ? this.otherRoom(g.roomOf(prey)) : g.roomOf(p) || 'the hallway'} doing tasks.`;
            this.escape(p, b);
          }
          return;
        }
        if (safe || d > 3) {
          b.doing = 'hunt';
          b.goal = { x: prey.x, y: prey.y };
          if (b.repath <= 0) b.path = [];
          b.repath -= dt;
          if (b.repath <= 0) b.repath = 0.6;
          return;
        }
      }
    }
    if (b.doing === 'hunt') b.doing = '';
    // Faking a task: stand at a task spot for a while.
    if (b.doing === 'fake' && b.goal && Math.hypot(p.x - b.goal.x, p.y - b.goal.y) < USE_RANGE + 0.6) {
      b.wait -= dt;
      if (b.wait <= 0) b.doing = '';
      return;
    }
    if (b.doing === 'fake' || b.doing === 'vent' || b.doing === 'wander') return;
    const all = g.def.tasks.flatMap((t) => t.steps.flatMap((s) => s.at.map((a) => ({ a, name: t.name }))));
    const f = all[Math.floor(g.rand() * all.length)]!;
    b.doing = 'fake';
    b.goal = { x: f.a.x, y: f.a.y };
    b.wait = 3 + g.rand() * 5;
    b.path = [];
    b.claim = `I was in ${g.map.roomAt(f.a.x, f.a.y) || 'the hallway'} doing ${f.name}.`;
  }

  private otherRoom(r: string): string {
    const rooms = this.g.def.rooms.map((x) => x.name).filter((x) => x !== r);
    return rooms[Math.floor(this.g.rand() * rooms.length)] ?? 'the hallway';
  }

  /** After a kill: into a vent if one's close, else walk off (and maybe self-report). */
  private escape(p: Player, b: Brain): void {
    const g = this.g;
    if (g.rand() < 0.12) {
      // Self-report.
      const body = g.bodies[g.bodies.length - 1];
      if (body) {
        b.claim = `I just walked into ${g.roomOf(body) || 'the hallway'} and found ${this.name(body.id)}.`;
        g.act(p.id, { k: 'report', body: body.id });
        return;
      }
    }
    const v = g.def.vents.map((v, i) => ({ v, i })).sort((a, c) => Math.hypot(a.v.x - p.x, a.v.y - p.y) - Math.hypot(c.v.x - p.x, c.v.y - p.y))[0];
    if (v && Math.hypot(v.v.x - p.x, v.v.y - p.y) < 9) {
      b.doing = 'vent';
      b.goal = { x: v.v.x, y: v.v.y };
      b.path = [];
      b.ventHops = 1 + Math.floor(g.rand() * 2);
      b.ventT = 0.6;
      return;
    }
    this.wander(p, b);
  }

  // ---------------------------------------------------------------- walking

  private walk(p: Player, b: Brain, dt: number): void {
    const g = this.g;
    if (!b.goal || p.vent >= 0) {
      p.ix = p.iy = 0;
      return;
    }
    const dx0 = b.goal.x - p.x;
    const dy0 = b.goal.y - p.y;
    const near = b.doing === 'report' ? REPORT_RANGE - 0.6 : b.doing === 'hunt' ? KILL_RANGE - 0.4 : 0.5;
    if (Math.hypot(dx0, dy0) < near || (b.arrived && b.doing !== 'hunt' && b.doing !== 'report')) {
      p.ix = p.iy = 0;
      if (b.doing === 'vent' && !g.act(p.id, { k: 'vent', op: 'enter' })) return;
      if (b.doing === 'wander') {
        b.wait -= dt;
        if (b.wait <= 0) b.doing = '';
      }
      // Arrived at a task: hands busy (visual tasks show).
      if (b.doing === 'task' && !p.busy) g.act(p.id, { k: 'busy', kind: p.tasks[b.task]?.spots[p.tasks[b.task]!.step]?.kind ?? '' });
      return;
    }
    // Ghosts float straight there.
    if (!p.alive) {
      const l = Math.hypot(dx0, dy0);
      p.ix = dx0 / l;
      p.iy = dy0 / l;
      return;
    }
    if (!b.path.length) {
      b.arrived = false;
      b.path = g.map.grid.path(p.x, p.y, b.goal.x, b.goal.y);
      if (!b.path.length) {
        b.doing = '';
        b.goal = null;
        return;
      }
      // The last waypoint is where a body fits nearest the goal (it may be inside a table).
      const last = b.path[b.path.length - 1]!;
      const [fx, fy] = g.map.grid.free(last[0], last[1], 0.3);
      b.path[b.path.length - 1] = [fx, fy];
    }
    const [wx, wy] = b.path[0]!;
    const dx = wx - p.x;
    const dy = wy - p.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.35) {
      b.path.shift();
      if (!b.path.length) b.arrived = true;
      return;
    }
    p.ix = dx / d;
    p.iy = dy / d;
    // Stuck (pushed by a door closing…): replan.
    if (Math.hypot(p.x - b.lastX, p.y - b.lastY) < 0.02) b.stuck += dt;
    else b.stuck = 0;
    b.lastX = p.x;
    b.lastY = p.y;
    if (b.stuck > 1) {
      b.stuck = 0;
      b.path = [];
    }
  }

  // ---------------------------------------------------------------- meetings

  private meeting(caller: number, body: number): void {
    const g = this.g;
    this.lines = [];
    let at = g.time + 1.5;
    const say = (id: number, text: string) => {
      this.lines.push({ at, id, text });
      at += 1.2 + g.rand() * 2.2;
    };
    const callerBrain = this.brains.get(caller);
    const cp = g.players[caller]!;
    if (callerBrain && cp.bot) {
      if (body >= 0) {
        const dead = g.players.find((q) => q.color === body);
        say(caller, callerBrain.claim || `Dead body in ${dead ? g.roomOf(dead) || 'the hallway' : 'the hallway'}!`);
      } else say(caller, 'Emergency meeting! Where is everyone?');
    }
    // Who was seen in the body's room shortly before (that's how real players reason).
    const corpse = body >= 0 ? g.bodies.find((x) => x.color === body) : undefined;
    if (corpse) {
      const room = g.roomOf(corpse);
      for (const [id, b] of this.brains) {
        if (g.players[id]!.impostor) continue;
        const near = new Set(b.seen.filter((s) => s.t > g.time - 30 && room && s.room === room).map((s) => s.id));
        for (const q of near)
          if (q !== id && q !== corpse.id) {
            b.sus.set(q, Math.max(b.sus.get(q) ?? 0, 38));
            if (!b.why.has(q)) b.why.set(q, `${this.name(q)} was in ${room} just before.`);
          }
      }
    }
    // Accusations first (most certain first), then alibis.
    const ordered = [...this.brains.entries()].filter(([id]) => g.players[id]!.alive && id !== caller).sort(() => g.rand() - 0.5);
    for (const [id, b] of ordered) {
      const p = g.players[id]!;
      const top = [...b.sus.entries()].filter(([t]) => g.players[t]?.alive).sort((a, c) => c[1] - a[1])[0];
      if (!p.impostor && top && top[1] >= 35) say(id, b.why.get(top[0]) ?? `I think it's ${this.name(top[0])}.`);
    }
    for (const [id, b] of ordered) {
      const p = g.players[id]!;
      if (g.rand() < 0.65) say(id, b.claim || 'I was doing my tasks.');
      // Impostors throw suspicion around.
      if (p.impostor && g.rand() < 0.35) {
        const t = g.players.filter((q) => q.alive && !q.impostor && q.id !== id)[Math.floor(g.rand() * 3)];
        if (t) say(id, `${this.name(t.id)} has been acting kinda sus...`);
      }
    }
    for (const b of this.brains.values()) {
      b.voteAt = g.time + g.cfg.discussion + 3 + g.rand() * Math.min(25, g.cfg.voting * 0.5);
      b.said = 0;
    }
  }

  /** Someone said something: bots named in it answer (where were you?). */
  private reply(from: number, text: string): void {
    const g = this.g;
    if (!g.meeting) return;
    const t = text.toLowerCase();
    for (const [id, b] of this.brains) {
      const p = g.players[id]!;
      if (!p.alive || id === from) continue;
      const named = t.includes(p.name.toLowerCase()) || t.includes(this.colorName(id).toLowerCase());
      if (!named) continue;
      const accused = /sus|kill|vent|impostor|imposter|vote|it.?s/.test(t);
      const line = accused ? (p.impostor ? `Me?? No way, ${b.claim.charAt(0).toLowerCase() + b.claim.slice(1)}` : `It wasn't me! ${b.claim}`) : /where|what|doing/.test(t) ? b.claim || 'Doing my tasks.' : 'What?';
      this.lines.push({ at: g.time + 1 + g.rand() * 2, id, text: line });
      // Being accused makes the accuser a little suspicious to the accused.
      if (accused) b.sus.set(from, (b.sus.get(from) ?? 0) + 15);
    }
    // Others weigh accusations: "X is sus" nudges everybody's suspicion of X.
    for (const q of g.players)
      if (t.includes(q.name.toLowerCase()) || t.includes((COLORS[q.color]?.[0] ?? '#').toLowerCase()))
        for (const [id, b] of this.brains) if (id !== q.id && /sus|kill|vent|impostor|imposter|vote/.test(t)) b.sus.set(q.id, (b.sus.get(q.id) ?? 0) + 12);
  }

  private meetingTick(): void {
    const g = this.g;
    const m = g.meeting!;
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const l = this.lines[i]!;
      if (g.time >= l.at && g.players[l.id]?.alive) {
        this.lines.splice(i, 1);
        g.act(l.id, { k: 'chat', text: l.text });
      }
    }
    if (m.stage !== 'vote') return;
    for (const [id, b] of this.brains) {
      const p = g.players[id]!;
      if (!p.alive || m.votes.has(id) || g.time < b.voteAt) continue;
      // Crew: the most suspicious (if suspicious enough); otherwise skip. Impostors ride the wave.
      const tally = new Map<number, number>();
      for (const [, t] of m.votes) if (t >= 0) tally.set(t, (tally.get(t) ?? 0) + 1);
      let target = -1;
      if (p.impostor) {
        const wave = [...tally.entries()].filter(([t]) => !g.players[t]!.impostor).sort((a, c) => c[1] - a[1])[0];
        target = wave && g.rand() < 0.8 ? wave[0] : -1;
      } else {
        const ranked = [...b.sus.entries()].filter(([t]) => g.players[t]?.alive && t !== id).map(([t, s]) => [t, s + (tally.get(t) ?? 0) * 18] as [number, number]).sort((a, c) => c[1] - a[1]);
        if (ranked[0] && ranked[0][1] >= 36) target = ranked[0][0];
      }
      g.act(id, { k: 'vote', target });
    }
  }
}
