import { USE_RANGE, type Body, type Config, type Event, type Game, type Phase, type TaskState } from './game';
import type { SabotageKind, TaskKind } from './maps';

/**
 * What one player is allowed to know: the same for a game vs bots and an online room.
 * Ghosts stay invisible to the living (and nobody learns who died before a meeting),
 * players in vents are hidden, roles are secret, admin / vitals only at their consoles.
 */

export interface PView {
  id: number;
  name: string;
  color: number;
  x: number;
  y: number;
  left: boolean;
  moving: boolean;
  alive: boolean;
  /** Not drawn (a ghost to the living, someone in a vent). */
  hidden: boolean;
  /** Known impostor (me, my partners, everyone at the end). */
  impostor: boolean;
  /** A visual task being done (the scanner beam). */
  busy: TaskKind | '';
  bot: boolean;
  connected: boolean;
}

export interface MeetingView {
  reason: 'body' | 'button';
  caller: number;
  body: number;
  stage: 'discuss' | 'vote' | 'results';
  t: number;
  /** Who has voted (not for whom). */
  voted: number[];
  /** voter → target, at the results (voter −1 when anonymous). */
  votes: Array<[number, number]>;
  ejected: number;
  chat: Array<{ id: number; text: string; ghost: boolean }>;
}

export interface SfView {
  me: number;
  map: string;
  cfg: Config;
  time: number;
  phase: Phase;
  phaseT: number;
  players: PView[];
  bodies: Body[];
  /** My tasks (an impostor's are fake). */
  tasks: TaskState[];
  /** Total task bar (null while comms are down). */
  progress: number | null;
  killCd: number;
  ventCd: number;
  vent: number;
  emergencies: number;
  emergencyCd: number;
  sabotageCd: number;
  impostors: number;
  partners: number[];
  doors: string[];
  /** Impostors: seconds until each room's doors can be shut again. */
  doorCd: Record<string, number>;
  sabotage: { kind: SabotageKind; t: number; done: boolean[]; switches: boolean[]; code: string } | null;
  holding: number;
  meeting: MeetingView | null;
  lastEject: { id: number; impostor: boolean; text: string } | null;
  winner: 'crew' | 'impostor' | '';
  why: string;
  /** At the admin table: people per room. */
  admin?: Record<string, number>;
  /** At vitals: each player's state. */
  vitals?: Array<'ok' | 'dead' | 'dc'>;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export function viewFor(g: Game, me: number): SfView {
  const p = g.players[me]!;
  const over = g.phase === 'over';
  const inPlay = g.phase === 'play' || g.phase === 'intro';
  const comms = g.sabotage?.kind === 'comms';
  const m = g.meeting;
  const res = m && m.stage === 'results';
  const v: SfView = {
    me,
    map: g.def.id,
    cfg: g.cfg,
    time: r2(g.time),
    phase: g.phase,
    phaseT: r2(g.phaseT),
    players: g.players.map((q) => ({
      id: q.id,
      name: q.name,
      color: q.color,
      x: r2(q.x),
      y: r2(q.y),
      left: q.left,
      moving: q.moving,
      // The living only learn about deaths at a meeting (bodies aside).
      alive: q.alive || (inPlay && p.alive && q.id !== me && !g.bodies.some((b) => b.id === q.id) && !reveals(g, q.id)),
      hidden: q.id !== me && ((q.vent >= 0) || (!q.alive && p.alive)),
      impostor: q.impostor && (over || q.id === me || (p.impostor && q.impostor)),
      busy: g.cfg.visualTasks || q.id === me ? q.busy : '',
      bot: q.bot,
      connected: q.connected,
    })),
    bodies: g.bodies.map((b) => ({ ...b, x: r2(b.x), y: r2(b.y) })),
    tasks: p.tasks,
    progress: comms ? null : r2(g.progress),
    killCd: r2(p.killCd),
    ventCd: r2(p.ventCd),
    vent: p.vent,
    emergencies: p.emergencies,
    emergencyCd: r2(g.emergencyCd),
    sabotageCd: r2(g.sabotageCd),
    impostors: g.players.filter((q) => q.impostor).length,
    partners: p.impostor || over ? g.players.filter((q) => q.impostor && q.id !== me).map((q) => q.id) : [],
    doors: g.closedDoors(),
    doorCd: {},
    sabotage: g.sabotage ? { ...g.sabotage, t: r2(g.sabotage.t), done: [...g.sabotage.done], switches: [...g.sabotage.switches] } : null,
    holding: p.holding,
    meeting: m
      ? {
          reason: m.reason,
          caller: m.caller,
          body: m.body,
          stage: m.stage,
          t: r2(m.t),
          voted: [...m.votes.keys()],
          votes: res ? [...m.votes.entries()].map(([a, b]) => [g.cfg.anonymousVotes ? -1 : a, b] as [number, number]) : [],
          ejected: res ? ((m as typeof m & { ejected?: number }).ejected ?? -1) : -1,
          chat: m.chat.filter((c) => !c.ghost || !p.alive),
        }
      : null,
    lastEject: g.lastEject,
    winner: g.winner,
    why: g.why,
  };
  if (p.impostor) for (const d of g.def.doors) v.doorCd[d.room] = r2(Math.max(0, (g.doorCd.get(d.room) ?? 0) - g.time));
  // Consoles (they go dark while comms are down).
  if (!comms && g.def.admin && Math.hypot(p.x - g.def.admin.x, p.y - g.def.admin.y) < USE_RANGE + 1) {
    const counts: Record<string, number> = {};
    for (const q of g.players) if (q.alive && q.vent < 0) {
      const r = g.roomOf(q);
      if (r) counts[r] = (counts[r] ?? 0) + 1;
    }
    for (const b of g.bodies) {
      const r = g.roomOf(b);
      if (r) counts[r] = (counts[r] ?? 0) + 1;
    }
    v.admin = counts;
  }
  if (!comms && g.def.vitalsAt && Math.hypot(p.x - g.def.vitalsAt.x, p.y - g.def.vitalsAt.y) < USE_RANGE + 1) v.vitals = g.players.map((q) => (!q.connected && !q.bot ? 'dc' : q.alive ? 'ok' : 'dead'));
  return v;
}

/** Deaths already public: ejected players, and anyone dead by the last meeting. */
function reveals(g: Game, id: number): boolean {
  return g.known.has(id);
}

/** Events this player may hear about. */
export function eventsFor(g: Game, me: number, evs: Event[]): Event[] {
  const p = g.players[me]!;
  return evs.filter((e) => {
    switch (e.k) {
      case 'kill':
        return e.killer === me || e.victim === me || (p.alive && g.sees(p, e));
      case 'vent':
        return e.id === me || (p.alive && g.sees(p, e));
      case 'task':
        return e.id === me;
      case 'chat':
        return !e.ghost || !p.alive;
      case 'vote':
        return true;
      default:
        return true;
    }
  });
}
