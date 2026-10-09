import { buildMap, MAP, type BuiltMap, type MapDef, type SabotageKind, type Spot, type TaskKind } from './maps';

/**
 * Starfall rules (after the original): crewmates do tasks; impostors kill, vent and sabotage.
 * Bodies get reported, the button calls a meeting, everyone talks, votes, and the most-voted
 * player is ejected (ties and skips eject no one). Crew win by finishing every task or
 * ejecting every impostor; impostors win when they match the crew in number or a critical
 * sabotage (reactor / O2 / seismic) runs out. The dead come back as ghosts and keep helping.
 *
 * Shared by the browser (vs bots) and the server (online / LAN).
 */

export const TICK = 1 / 30;
export const RADIUS = 0.32;
export const SPEED = 3.3;
export const USE_RANGE = 1.35;
export const KILL_RANGE = 1.9;
export const REPORT_RANGE = 3.2;

export const COLORS = [
  ['Red', '#c51111', '#7a0838'],
  ['Blue', '#132ed1', '#09158e'],
  ['Green', '#117f2d', '#0a4d2e'],
  ['Pink', '#ed54ba', '#ab2bad'],
  ['Orange', '#ef7d0e', '#b33e15'],
  ['Yellow', '#f6f658', '#c38823'],
  ['Black', '#3f474e', '#1e1f26'],
  ['White', '#d6e0f0', '#8394bf'],
  ['Purple', '#6b2fbb', '#3b177c'],
  ['Brown', '#71491e', '#5e2615'],
  ['Cyan', '#38fedc', '#24a8be'],
  ['Lime', '#50ef39', '#15a742'],
  ['Maroon', '#5f1d2e', '#4b1823'],
  ['Rose', '#ecc0d3', '#de92b2'],
  ['Banana', '#f0e7a8', '#d2bc89'],
  ['Gray', '#758593', '#465565'],
] as const;

export const BOT_NAMES = ['Nova', 'Pixel', 'Comet', 'Juno', 'Rook', 'Mango', 'Echo', 'Biscuit', 'Zap', 'Pebble', 'Orbit', 'Waffle', 'Sprout', 'Dusty', 'Kiwi', 'Blip'];

export interface Config {
  map: string;
  impostors: 1 | 2 | 3;
  /** Vision radius in metres. */
  crewVision: number;
  impostorVision: number;
  killCooldown: number;
  emergencies: number;
  discussion: number;
  voting: number;
  confirmEjects: boolean;
  anonymousVotes: boolean;
  commonTasks: number;
  longTasks: number;
  shortTasks: number;
  visualTasks: boolean;
}
export const DEFAULT_CONFIG: Config = { map: 'vanguard', impostors: 1, crewVision: 5.5, impostorVision: 8.25, killCooldown: 25, emergencies: 1, discussion: 15, voting: 75, confirmEjects: true, anonymousVotes: false, commonTasks: 1, longTasks: 1, shortTasks: 2, visualTasks: true };

export interface TaskState {
  /** Index into the map's task list. */
  def: number;
  name: string;
  /** The chosen spot for each step. */
  spots: Array<Spot & { kind: TaskKind; label: string }>;
  step: number;
  done: boolean;
}

export interface Player {
  id: number;
  name: string;
  color: number;
  bot: boolean;
  x: number;
  y: number;
  /** Facing left (sprite flip). */
  left: boolean;
  moving: boolean;
  alive: boolean;
  impostor: boolean;
  tasks: TaskState[];
  killCd: number;
  /** Vent the player is hiding in (−1 = none). */
  vent: number;
  ventCd: number;
  emergencies: number;
  /** In a task minigame (and which kind: visual tasks show). */
  busy: TaskKind | '';
  /** Holding a reactor / seismic station (index), −1 = no. */
  holding: number;
  connected: boolean;
  /** Last input. */
  ix: number;
  iy: number;
  /** Moved by its client (online): the room writes the position, step() leaves it. */
  external?: boolean;
}

export interface Body {
  id: number;
  x: number;
  y: number;
  color: number;
}

export type Phase = 'intro' | 'play' | 'meeting' | 'eject' | 'over';
export interface Meeting {
  reason: 'body' | 'button';
  caller: number;
  /** Colour of the body found (−1 for the button). */
  body: number;
  stage: 'discuss' | 'vote' | 'results';
  t: number;
  votes: Map<number, number>; // voter → target id (−1 = skip)
  chat: Array<{ id: number; text: string; ghost: boolean }>;
}
export interface Sabotage {
  kind: SabotageKind;
  /** Seconds left (critical sabotages). */
  t: number;
  /** Per station: fixed (O2 keypads / comms panels / stabilizers each count). */
  done: boolean[];
  /** Lights: five switches (all up = fixed). */
  switches: boolean[];
  /** O2 keypad code. */
  code: string;
}

export type Event =
  | { k: 'kill'; killer: number; victim: number; x: number; y: number }
  | { k: 'meeting'; reason: 'body' | 'button'; caller: number; body: number }
  | { k: 'vote'; voter: number }
  | { k: 'votes'; tally: Array<[number, number]>; ejected: number; tie: boolean }
  | { k: 'eject'; id: number; impostor: boolean; left: number; confirm: boolean; text: string }
  | { k: 'chat'; id: number; text: string; ghost: boolean }
  | { k: 'sabotage'; kind: SabotageKind }
  | { k: 'fixed'; kind: SabotageKind }
  | { k: 'doors'; room: string }
  | { k: 'task'; id: number; done: boolean }
  | { k: 'vent'; id: number; enter: boolean; x: number; y: number }
  | { k: 'over'; winner: 'crew' | 'impostor'; why: string }
  | { k: 'phase'; phase: Phase };

export type Action =
  | { k: 'kill'; target: number }
  | { k: 'report'; body: number }
  | { k: 'emergency' }
  | { k: 'vent'; op: 'enter' | 'exit' | 'move'; to?: number }
  | { k: 'sabotage'; kind: SabotageKind | 'doors'; room?: string }
  | { k: 'switch'; i: number }
  | { k: 'o2'; station: number; code: string }
  | { k: 'hold'; station: number; on: boolean }
  | { k: 'comms'; station: number }
  | { k: 'task'; task: number }
  | { k: 'busy'; kind: TaskKind | '' }
  | { k: 'vote'; target: number }
  | { k: 'chat'; text: string };

export class Game {
  readonly map: BuiltMap;
  readonly def: MapDef;
  readonly cfg: Config;
  readonly players: Player[] = [];
  bodies: Body[] = [];
  phase: Phase = 'intro';
  phaseT = 6;
  time = 0;
  meeting: Meeting | null = null;
  sabotage: Sabotage | null = null;
  sabotageCd = 12;
  /** Room name → time its doors open again. */
  doors = new Map<string, number>();
  doorCd = new Map<string, number>();
  emergencyCd = 15;
  winner: 'crew' | 'impostor' | '' = '';
  why = '';
  events: Event[] = [];
  /** Who ejected last (for the ejection screen). */
  lastEject: { id: number; impostor: boolean; text: string } | null = null;
  /** Deaths everyone knows about (revealed at a meeting / ejected). */
  known = new Set<number>();
  rand: () => number;

  constructor(cfg: Config, people: Array<{ name: string; color: number; bot: boolean }>, seed = Date.now()) {
    this.cfg = { ...cfg };
    this.def = MAP[cfg.map] ?? MAP.vanguard!;
    this.map = buildMap(this.def);
    let s = seed >>> 0 || 1;
    this.rand = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    // Roles.
    const n = people.length;
    const imps = new Set<number>();
    const want = Math.min(cfg.impostors, Math.max(1, Math.floor((n - 1) / 3)));
    while (imps.size < want) imps.add(Math.floor(this.rand() * n));
    // Tasks: common ones are shared by everybody.
    const pick = <T>(arr: T[], k: number) => [...arr].sort(() => this.rand() - 0.5).slice(0, k);
    const defs = this.def.tasks.map((t, i) => ({ t, i }));
    const commons = pick(defs.filter((d) => d.t.type === 'common'), cfg.commonTasks);
    people.forEach((p, id) => {
      const tasks = [...commons, ...pick(defs.filter((d) => d.t.type === 'long'), cfg.longTasks), ...pick(defs.filter((d) => d.t.type === 'short'), cfg.shortTasks)].map((d) => this.makeTask(d.i));
      const a = (id / n) * Math.PI * 2;
      const [sx, sy] = this.map.grid.free(this.def.spawn.x + Math.cos(a) * 1.6, this.def.spawn.y + Math.sin(a) * 1.6, RADIUS);
      this.players.push({
        id,
        name: p.name,
        color: p.color,
        bot: p.bot,
        x: sx,
        y: sy,
        left: false,
        moving: false,
        alive: true,
        impostor: imps.has(id),
        tasks,
        killCd: 10,
        vent: -1,
        ventCd: 0,
        emergencies: cfg.emergencies,
        busy: '',
        holding: -1,
        connected: true,
        ix: 0,
        iy: 0,
      });
    });
  }

  private makeTask(i: number): TaskState {
    const t = this.def.tasks[i]!;
    // Multi-panel tasks (wiring) use different spots for each step.
    const used = new Set<number>();
    const spots = t.steps.map((st) => {
      let k = Math.floor(this.rand() * st.at.length);
      for (let g = 0; g < 10 && used.has(k) && st.at.length > 1; g++) k = Math.floor(this.rand() * st.at.length);
      if (st.kind === 'wires') used.add(k);
      const at = st.at[k]!;
      return { x: at.x, y: at.y, kind: st.kind, label: st.label ?? t.name };
    });
    return { def: i, name: t.name, spots, step: 0, done: false };
  }

  // ---------------------------------------------------------------- queries

  get crewAlive(): number {
    return this.players.filter((p) => p.alive && !p.impostor).length;
  }
  get impostorsAlive(): number {
    return this.players.filter((p) => p.alive && p.impostor).length;
  }
  /** Overall task bar (0–1): every crewmate's task steps, dead ones' too. */
  get progress(): number {
    let all = 0;
    let done = 0;
    for (const p of this.players) {
      if (p.impostor) continue;
      for (const t of p.tasks) {
        all += t.spots.length;
        done += t.done ? t.spots.length : t.step;
      }
    }
    return all ? done / all : 1;
  }
  vision(p: Player): number {
    if (!p.alive) return 30;
    if (p.impostor) return this.cfg.impostorVision;
    return this.sabotage?.kind === 'lights' ? this.cfg.crewVision * 0.25 : this.cfg.crewVision;
  }
  roomOf(p: { x: number; y: number }): string {
    return this.map.roomAt(p.x, p.y);
  }
  near(p: { x: number; y: number }, s: { x: number; y: number }, r: number): boolean {
    return Math.hypot(p.x - s.x, p.y - s.y) <= r;
  }
  /** Can `a` see `b` (within vision, nothing in the way)? */
  sees(a: Player, b: { x: number; y: number }): boolean {
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    return d <= this.vision(a) && this.map.grid.sees(a.x, a.y, b.x, b.y);
  }
  /** Doors closed right now (room names). */
  closedDoors(): string[] {
    return [...this.doors.entries()].filter(([, t]) => t > this.time).map(([r]) => r);
  }
  sabotageSpots(kind: SabotageKind): Spot[] {
    return (this.def.sabotage as Record<string, Spot[] | undefined>)[kind] ?? [];
  }

  // ---------------------------------------------------------------- the tick

  step(dt: number): void {
    this.time += dt;
    this.phaseT -= dt;
    switch (this.phase) {
      case 'intro':
        if (this.phaseT <= 0) this.setPhase('play');
        return;
      case 'meeting':
        return this.tickMeeting();
      case 'eject':
        if (this.phaseT <= 0) {
          this.checkWin();
          if (this.phase === 'eject') this.setPhase('play');
        }
        return;
      case 'over':
        return;
    }
    // ---- play
    this.emergencyCd = Math.max(0, this.emergencyCd - dt);
    this.sabotageCd = Math.max(0, this.sabotageCd - dt);
    for (const [room, t] of this.doors) if (t <= this.time) {
      this.doors.delete(room);
      this.applyDoors();
    }
    for (const p of this.players) {
      p.killCd = Math.max(0, p.killCd - dt);
      p.ventCd = Math.max(0, p.ventCd - dt);
      this.move(p, dt);
    }
    // Sabotage clock.
    const sab = this.sabotage;
    if (sab && (sab.kind === 'reactor' || sab.kind === 'seismic')) {
      // Both stations held at once fixes it.
      const held = this.sabotageSpots(sab.kind).map((_, i) => this.players.some((p) => p.alive && p.holding === i));
      if (held.every(Boolean)) this.fix();
    }
    if (this.sabotage && this.sabotage.t > 0) {
      this.sabotage.t -= dt;
      if (this.sabotage.t <= 0) {
        const kind = this.sabotage.kind;
        return this.end('impostor', kind === 'o2' ? 'The crew ran out of oxygen.' : kind === 'seismic' ? 'The seismic stabilizers failed.' : 'The reactor melted down.');
      }
    }
    this.checkWin();
  }

  private move(p: Player, dt: number): void {
    if (p.vent >= 0) {
      p.moving = false;
      return;
    }
    if (p.external) return;
    let dx = p.ix;
    let dy = p.iy;
    const l = Math.hypot(dx, dy);
    if (l > 1) {
      dx /= l;
      dy /= l;
    }
    // Hands busy at a task / station: you stand still.
    if (p.busy || p.holding >= 0) dx = dy = 0;
    p.moving = Math.hypot(dx, dy) > 0.1;
    if (Math.abs(dx) > 0.1) p.left = dx < 0;
    const sp = SPEED * (p.alive ? 1 : 1.25) * dt;
    if (!p.alive) {
      // Ghosts drift through walls (but stay on the map).
      const b = this.def.bounds;
      p.x = Math.max(b[0], Math.min(b[2], p.x + dx * sp));
      p.y = Math.max(b[1], Math.min(b[3], p.y + dy * sp));
      return;
    }
    [p.x, p.y] = this.map.grid.move(p.x, p.y, dx * sp, dy * sp, RADIUS);
  }

  private setPhase(ph: Phase): void {
    this.phase = ph;
    this.events.push({ k: 'phase', phase: ph });
  }

  private checkWin(): void {
    if (this.phase === 'over') return;
    if (this.impostorsAlive === 0) return this.end('crew', 'Every impostor was ejected.');
    if (this.impostorsAlive >= this.crewAlive) return this.end('impostor', 'The impostors outnumbered the crew.');
    if (this.progress >= 1) return this.end('crew', 'The crew finished every task.');
  }

  private end(winner: 'crew' | 'impostor', why: string): void {
    this.winner = winner;
    this.why = why;
    this.sabotage = null;
    this.setPhase('over');
    this.events.push({ k: 'over', winner, why });
  }

  // ---------------------------------------------------------------- actions

  /** Do something. Returns an error message (shown to the player) or null. */
  act(id: number, a: Action): string | null {
    const p = this.players[id];
    if (!p) return 'No such player.';
    if (a.k === 'chat') return this.chat(p, a.text);
    if (a.k === 'vote') return this.vote(p, a.target);
    if (this.phase !== 'play') return 'Not now.';
    switch (a.k) {
      case 'kill':
        return this.kill(p, a.target);
      case 'report':
        return this.report(p, a.body);
      case 'emergency':
        return this.emergency(p);
      case 'vent':
        return this.ventAct(p, a.op, a.to);
      case 'sabotage':
        return this.sabotageAct(p, a.kind, a.room);
      case 'switch': {
        const s = this.sabotage;
        if (!s || s.kind !== 'lights' || !p.alive || !this.near(p, this.def.sabotage.lights[0]!, USE_RANGE + 0.6)) return 'Too far.';
        s.switches[a.i] = !s.switches[a.i];
        if (s.switches.every(Boolean)) this.fix();
        return null;
      }
      case 'o2': {
        const s = this.sabotage;
        const st = this.def.sabotage.o2?.[a.station];
        if (!s || s.kind !== 'o2' || !st || !p.alive || !this.near(p, st, USE_RANGE + 0.6)) return 'Too far.';
        if (a.code !== s.code) return 'Wrong code.';
        s.done[a.station] = true;
        if (s.done.every(Boolean)) this.fix();
        return null;
      }
      case 'hold': {
        const s = this.sabotage;
        const st = s ? this.sabotageSpots(s.kind)[a.station] : undefined;
        if (!a.on) {
          p.holding = -1;
          return null;
        }
        if (!s || (s.kind !== 'reactor' && s.kind !== 'seismic') || !st || !p.alive || !this.near(p, st, USE_RANGE + 0.6)) return 'Too far.';
        p.holding = a.station;
        return null;
      }
      case 'comms': {
        const s = this.sabotage;
        const st = this.def.sabotage.comms[a.station];
        if (!s || s.kind !== 'comms' || !st || !this.near(p, st, USE_RANGE + 0.6)) return 'Too far.';
        s.done[a.station] = true;
        if (s.done.every(Boolean)) this.fix();
        return null;
      }
      case 'task':
        return this.taskStep(p, a.task);
      case 'busy':
        p.busy = a.kind;
        return null;
    }
    return null;
  }

  private kill(p: Player, target: number): string | null {
    const t = this.players[target];
    if (!p.impostor || !p.alive || p.vent >= 0) return 'You can’t.';
    if (!t || !t.alive || t.impostor) return 'No target.';
    if (p.killCd > 0) return 'Kill is on cooldown.';
    if (!this.near(p, t, KILL_RANGE) || !this.map.grid.sees(p.x, p.y, t.x, t.y)) return 'Too far.';
    t.alive = false;
    t.busy = '';
    t.holding = -1;
    t.vent = -1;
    this.bodies.push({ id: t.id, x: t.x, y: t.y, color: t.color });
    // The killer lands where the victim stood.
    p.x = t.x;
    p.y = t.y;
    p.killCd = this.cfg.killCooldown;
    this.events.push({ k: 'kill', killer: p.id, victim: t.id, x: t.x, y: t.y });
    this.checkWin();
    return null;
  }

  private report(p: Player, bodyId: number): string | null {
    const b = this.bodies.find((x) => x.id === bodyId);
    if (!p.alive || !b) return 'No body.';
    if (!this.near(p, b, REPORT_RANGE) || !this.map.grid.sees(p.x, p.y, b.x, b.y)) return 'Too far.';
    this.callMeeting(p, 'body', b.color);
    return null;
  }

  private emergency(p: Player): string | null {
    if (!p.alive) return 'Ghosts can’t call meetings.';
    if (!this.near(p, this.def.button, 2.4)) return 'Too far.';
    if (p.emergencies <= 0) return 'You have no emergency meetings left.';
    if (this.emergencyCd > 0) return `Emergency meetings in ${Math.ceil(this.emergencyCd)}s.`;
    if (this.sabotage && (this.sabotage.kind !== 'lights' && this.sabotage.kind !== 'comms')) return 'You can’t call a meeting during a crisis.';
    p.emergencies--;
    this.callMeeting(p, 'button', -1);
    return null;
  }

  private callMeeting(p: Player, reason: 'body' | 'button', body: number): void {
    // Critical sabotages stop for the meeting; lights and comms stay broken.
    if (this.sabotage && this.sabotage.t > 0) {
      this.events.push({ k: 'fixed', kind: this.sabotage.kind });
      this.sabotage = null;
    }
    for (const q of this.players) {
      q.busy = '';
      q.holding = -1;
      if (q.vent >= 0) {
        q.vent = -1;
      }
    }
    for (const q of this.players) if (!q.alive) this.known.add(q.id);
    this.meeting = { reason, caller: p.id, body, stage: 'discuss', t: this.cfg.discussion, votes: new Map(), chat: [] };
    this.setPhase('meeting');
    this.events.push({ k: 'meeting', reason, caller: p.id, body });
  }

  private tickMeeting(): void {
    const m = this.meeting!;
    m.t -= TICK;
    const voters = this.players.filter((p) => p.alive && p.connected);
    if (m.stage === 'discuss' && m.t <= 0) {
      m.stage = 'vote';
      m.t = this.cfg.voting;
    } else if (m.stage === 'vote' && (m.t <= 0 || voters.every((p) => m.votes.has(p.id)))) {
      // Tally.
      const tally = new Map<number, number>();
      for (const [, t] of m.votes) tally.set(t, (tally.get(t) ?? 0) + 1);
      const sorted = [...tally.entries()].sort((a, b) => b[1] - a[1]);
      const top = sorted[0];
      const tie = !top || (sorted[1] && sorted[1][1] === top[1]);
      const ejected = !top || tie || top[0] === -1 ? -1 : top[0];
      m.stage = 'results';
      m.t = 5;
      this.events.push({ k: 'votes', tally: sorted, ejected, tie: !!tie });
      (m as Meeting & { ejected: number }).ejected = ejected;
    } else if (m.stage === 'results' && m.t <= 0) {
      const ejected = (m as Meeting & { ejected: number }).ejected;
      this.finishMeeting(ejected, !!(this.events.find((e) => e.k === 'votes') as { tie?: boolean } | undefined)?.tie);
    }
  }

  private finishMeeting(ejected: number, tie: boolean): void {
    this.meeting = null;
    this.bodies = [];
    let text: string;
    const e = this.players[ejected];
    if (e) {
      e.alive = false;
      this.known.add(e.id);
      const left = this.players.filter((p) => p.alive && p.impostor).length;
      text = this.cfg.confirmEjects ? `${e.name} was ${e.impostor ? '' : 'not '}${this.players.filter((p) => p.impostor).length > 1 ? 'An' : 'The'} Impostor.` : `${e.name} was ejected.`;
      this.lastEject = { id: e.id, impostor: e.impostor, text };
      this.events.push({ k: 'eject', id: e.id, impostor: e.impostor, left, confirm: this.cfg.confirmEjects, text });
    } else {
      text = tie ? 'No one was ejected. (Tie)' : 'No one was ejected. (Skipped)';
      this.lastEject = { id: -1, impostor: false, text };
      this.events.push({ k: 'eject', id: -1, impostor: false, left: this.impostorsAlive, confirm: this.cfg.confirmEjects, text });
    }
    // Everyone back round the table, cooldowns reset.
    const alive = this.players.filter((p) => p.alive);
    alive.forEach((p, i) => {
      const a = (i / Math.max(1, alive.length)) * Math.PI * 2;
      [p.x, p.y] = this.map.grid.free(this.def.button.x + Math.cos(a) * 2.8, this.def.button.y + Math.sin(a) * 2.8, RADIUS);
      p.killCd = this.cfg.killCooldown;
    });
    this.emergencyCd = 15;
    this.sabotageCd = Math.max(this.sabotageCd, 10);
    this.phaseT = 7;
    this.setPhase('eject');
  }

  private vote(p: Player, target: number): string | null {
    const m = this.meeting;
    if (!m || m.stage !== 'vote') return 'Not voting yet.';
    if (!p.alive) return 'Ghosts can’t vote.';
    if (m.votes.has(p.id)) return 'Already voted.';
    if (target !== -1 && !this.players[target]?.alive) return 'They’re dead.';
    m.votes.set(p.id, target);
    this.events.push({ k: 'vote', voter: p.id });
    return null;
  }

  private chat(p: Player, raw: string): string | null {
    const text = raw.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 140);
    if (!text) return null;
    // Living players talk in meetings; ghosts talk among ghosts any time.
    if (p.alive && this.phase !== 'meeting') return 'You can only talk in meetings.';
    const ghost = !p.alive;
    this.meeting?.chat.push({ id: p.id, text, ghost });
    this.events.push({ k: 'chat', id: p.id, text, ghost });
    return null;
  }

  private ventAct(p: Player, op: 'enter' | 'exit' | 'move', to?: number): string | null {
    if (!p.impostor || !p.alive) return 'Only impostors can vent.';
    const vents = this.def.vents;
    if (op === 'enter') {
      if (p.vent >= 0 || p.ventCd > 0) return null;
      const v = vents.findIndex((v) => this.near(p, v, USE_RANGE));
      if (v < 0) return 'No vent here.';
      p.vent = v;
      p.x = vents[v]!.x;
      p.y = vents[v]!.y;
      this.events.push({ k: 'vent', id: p.id, enter: true, x: p.x, y: p.y });
      return null;
    }
    if (p.vent < 0) return null;
    if (op === 'move') {
      if (to === undefined || !vents[p.vent]!.links.includes(to)) return null;
      p.vent = to;
      p.x = vents[to]!.x;
      p.y = vents[to]!.y;
      return null;
    }
    this.events.push({ k: 'vent', id: p.id, enter: false, x: p.x, y: p.y });
    p.vent = -1;
    p.ventCd = 1;
    return null;
  }

  private sabotageAct(p: Player, kind: SabotageKind | 'doors', room?: string): string | null {
    if (!p.impostor) return 'Only impostors can sabotage.';
    if (kind === 'doors') {
      if (!room || !this.def.doors.some((d) => d.room === room)) return 'No doors there.';
      if ((this.doorCd.get(room) ?? 0) > this.time) return 'Doors are on cooldown.';
      this.doors.set(room, this.time + 10);
      this.doorCd.set(room, this.time + 30);
      this.applyDoors();
      this.events.push({ k: 'doors', room });
      return null;
    }
    if (this.sabotage) return 'Already sabotaged.';
    if (this.sabotageCd > 0) return `Sabotage in ${Math.ceil(this.sabotageCd)}s.`;
    const spots = this.sabotageSpots(kind);
    if (!spots.length) return 'Not on this map.';
    const crit = (this.def.critical as Record<string, number | undefined>)[kind] ?? 0;
    this.sabotage = {
      kind,
      t: crit,
      done: spots.map(() => false),
      switches: Array.from({ length: 5 }, () => this.rand() < 0.5),
      code: String(Math.floor(10000 + this.rand() * 90000)),
    };
    if (kind === 'lights' && this.sabotage.switches.every(Boolean)) this.sabotage.switches[Math.floor(this.rand() * 5)] = false;
    this.sabotageCd = 30;
    this.events.push({ k: 'sabotage', kind });
    return null;
  }

  private fix(): void {
    const s = this.sabotage;
    if (!s) return;
    this.sabotage = null;
    for (const p of this.players) p.holding = -1;
    this.events.push({ k: 'fixed', kind: s.kind });
  }

  private applyDoors(): void {
    const closed = new Set(this.closedDoors());
    for (const d of this.def.doors) this.map.grid.setDoor(d.rect, closed.has(d.room));
    // Nobody gets stuck inside a door.
    for (const p of this.players) {
      if (!p.alive || this.map.grid.fits(p.x, p.y, RADIUS)) continue;
      for (let r = 0.25; r < 2; r += 0.25)
        for (let a = 0; a < 8; a++) {
          const x = p.x + Math.cos((a * Math.PI) / 4) * r;
          const y = p.y + Math.sin((a * Math.PI) / 4) * r;
          if (this.map.grid.fits(x, y, RADIUS)) {
            p.x = x;
            p.y = y;
            r = 9;
            break;
          }
        }
    }
  }

  private taskStep(p: Player, i: number): string | null {
    const t = p.tasks[i];
    if (!t || t.done) return 'Done already.';
    if (p.impostor) return 'Impostors fake their tasks.';
    const spot = t.spots[t.step]!;
    // Allow the use range plus a little slack for latency.
    if (!this.near(p, spot, USE_RANGE + 0.8)) return 'Too far.';
    t.step++;
    if (t.step >= t.spots.length) t.done = true;
    p.busy = '';
    this.events.push({ k: 'task', id: p.id, done: t.done });
    this.checkWin();
    return null;
  }
}

export { MAP };
