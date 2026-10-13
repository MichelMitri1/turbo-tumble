import { COURT, sideSign } from './court';
import { rightX } from './shots';
import { HIGH, LOW, type MatchSim, type Stroke } from './match';

/**
 * The padel brain: reads the ball's predicted path, picks who on each team takes it and where they
 * meet it (and walks auto-moving humans there too), keeps the pair in formation — both up at the net
 * or both back — and, for bots, chooses and swings the shot.
 */
export type Level = 'beginner' | 'intermediate' | 'advanced' | 'pro';

export const LEVELS: Record<Level, { name: string; reaction: number; speed: number; error: number; power: number; smart: number }> = {
  beginner: { name: 'Beginner', reaction: 0.34, speed: 0.74, error: 1.7, power: 0.6, smart: 0.3 },
  intermediate: { name: 'Intermediate', reaction: 0.24, speed: 0.85, error: 1.15, power: 0.75, smart: 0.55 },
  advanced: { name: 'Advanced', reaction: 0.16, speed: 0.94, error: 0.9, power: 0.88, smart: 0.8 },
  pro: { name: 'Pro', reaction: 0.1, speed: 1, error: 0.68, power: 1, smart: 1 },
};

interface Plan {
  x: number;
  y: number;
  z: number;
  /** Absolute match time of contact. */
  at: number;
}

/** Standing this far from the ball's line puts it on the forehand. */
const SIDE = 0.7;

export class Brain {
  private readonly plans = new Map<number, Plan>();
  /** Per team: playing up at the net (attack) or back (defence). */
  private readonly atNet: [boolean, boolean] = [false, false];
  private lastHitSeen = -1;
  private serveDelay = 1.1;
  private readonly swung = new Set<number>();
  /** Per team: who's taking the ball (kept unless the other gets clearly better). */
  private readonly takerOf: [number, number] = [-1, -1];

  constructor(private readonly m: MatchSim) {}

  private level(i: number) {
    return LEVELS[this.m.players[i]!.def.level ?? 'intermediate'];
  }
  speedOf(i: number): number {
    return this.m.players[i]!.def.human ? 1 : this.level(i).speed;
  }
  errorOf(i: number): number {
    return this.level(i).error;
  }
  /** How far to the side the ball should pass: the forehand at SIDE; a live (camera) racket a little
   *  closer, on whichever hand holds it. */
  private sideOf(i: number): number {
    const a = this.m.players[i]!.arm;
    return a ? (a.side === 2 ? -0.5 : 0.5) : SIDE;
  }
  contactFor(i: number): Plan | null {
    return this.plans.get(i) ?? null;
  }

  /** Every tick: targets for everyone; strokes for the bots that should swing now. */
  update(dt: number): Map<number, Stroke> {
    const m = this.m;
    const out = new Map<number, Stroke>();
    void dt;
    // Serving bot: a beat, then serve.
    if (m.phase === 'serve') {
      this.plans.clear();
      this.swung.clear();
      const srv = m.players[m.server]!;
      if (!srv.def.human && m.phaseT > this.serveDelay) {
        this.serveDelay = 0.8 + m.rand() * 0.8;
        const lv = this.level(m.server);
        out.set(m.server, { dx: (m.rand() - 0.5) * 0.9, dy: -1, power: 0.35 + m.rand() * 0.45 * lv.power, lob: false });
      }
      return out;
    }
    if (m.phase !== 'rally') {
      this.plans.clear();
      return out;
    }
    this.noteShots();
    for (const team of [0, 1] as const) this.planTeam(team, out);
    return out;
  }

  /** After each hit: does the hitting team push up or drop back? */
  private noteShots(): void {
    const m = this.m;
    if (m.lastHitter === this.lastHitSeen) return;
    this.lastHitSeen = m.lastHitter;
    this.swung.clear();
    if (m.lastHitter < 0) return;
    const hitter = m.players[m.lastHitter]!;
    const t = hitter.team;
    const o = (1 - t) as 0 | 1;
    const ev = [...m.events].reverse().find((e) => e.k === 'hit');
    const shot = ev && ev.k === 'hit' ? ev.shot : 'drive';
    const near = Math.abs(hitter.pos[1]) < 5.5;
    const oppDepth = m.players.filter((q) => q.team === o).reduce((a, q, _i, arr) => a + Math.abs(q.pos[1]) / arr.length, 0);
    // Win the net: after a lob, or any good ball while they're back; already up there, stay. Against a
    // pair at the net, a drive from the back keeps you back (only a lob gets you past them).
    this.atNet[t] = shot === 'serve' || shot === 'lob' || near || (oppDepth > 6.2 && shot !== 'chiquita');
    // Facing a lob or an overhead: drop back.
    if (shot === 'lob' || shot === 'smash' || shot === 'vibora' || shot === 'bandeja') this.atNet[o] = false;
  }

  private planTeam(team: 0 | 1, out: Map<number, Stroke>): void {
    const m = this.m;
    const idx = m.players.map((_, i) => i).filter((i) => m.players[i]!.team === team);
    const s = sideSign(team);
    const incoming = m.lastTeam !== team && m.lastTeam >= 0;
    let taker = -1;
    let best: (Plan & { cost: number }) | null = null;
    if (incoming) {
      for (const i of idx) {
        const c = this.bestContact(i);
        if (!c) continue;
        // Whoever has it already keeps it unless the partner is clearly better placed; the zone breaks ties.
        const bias = (i === this.takerOf[team] ? 0.3 : 0) + (this.inZone(i, c.x) ? 0.15 : 0);
        if (!best || c.cost - bias < best.cost) {
          best = { ...c, cost: c.cost - bias };
          taker = i;
        }
      }
    }
    this.takerOf[team] = taker;
    for (const i of idx) {
      const p = m.players[i]!;
      if (i === taker && best) {
        this.plans.set(i, best);
        // Stand so the ball comes through the forehand (backhand if the wall is in the way).
        let fx = best.x - rightX(team) * this.sideOf(i);
        if (Math.abs(fx) > COURT.halfW - 0.35) fx = best.x + rightX(team) * this.sideOf(i);
        p.target[0] = fx;
        p.target[1] = best.z + s * 0.15;
        // Bots swing as it arrives (or straight away if it's about to come through them first).
        if (!p.def.human && !this.swung.has(i) && this.reflex(i, out)) continue;
        if (!p.def.human && !this.swung.has(i)) {
          const lv = this.level(i);
          const toGo = best.at - m.time;
          const near = Math.hypot(p.pos[0] - p.target[0], p.pos[1] - p.target[1]) < 0.7;
          if (toGo < 0.2 + (m.rand() - 0.5) * 0.08 * (2 - lv.smart) && near) {
            this.swung.add(i);
            out.set(i, this.chooseShot(i, best));
          }
        }
      } else {
        this.plans.delete(i);
        this.formation(i, team);
        // A ball coming right at a bot that isn't taking it: a reflex volley rather than wearing it.
        if (!p.def.human && !this.swung.has(i) && incoming) this.reflex(i, out);
      }
    }
  }

  /** The ball will come within reach in the next moment: swing now (true if it did). */
  private reflex(i: number, out: Map<number, Stroke>): boolean {
    const m = this.m;
    const p = m.players[i]!;
    if (!m.canHit(p.team)) return false;
    const b = m.ball.pos;
    const v = m.ball.vel;
    const t = 0.16;
    const fx = b[0] + v[0] * t, fz = b[2] + v[2] * t, fy = b[1] + v[1] * t;
    if (Math.hypot(fx - p.pos[0], fz - p.pos[1]) > 0.75 || fy < LOW || fy > HIGH) return false;
    this.swung.add(i);
    out.set(i, this.chooseShot(i, { x: fx, y: fy, z: fz, at: m.time + t }));
    return true;
  }

  /** The ball's in this player's half of the court (right-side player: their right). */
  private inZone(i: number, x: number): boolean {
    const p = this.m.players[i]!;
    const solo = this.m.players.filter((q) => q.team === p.team).length === 1;
    if (solo) return true;
    const r = rightX(p.team) * x;
    return p.def.slot === 0 ? r >= -0.3 : r <= 0.3;
  }

  /** Best place to meet the ball on its predicted path: reachable in time, legal, at a good height. */
  private bestContact(i: number): (Plan & { cost: number }) | null {
    const m = this.m;
    const p = m.players[i]!;
    const team = p.team;
    const lv = this.level(i);
    const react = p.def.human ? 0.05 : lv.reaction;
    const speed = p.maxSpeed * this.speedOf(i);
    const back = Math.abs(p.pos[1]) > 6;
    let best: (Plan & { cost: number }) | null = null;
    const ourF = (smp: { f0: number; f1: number }) => (team === 0 ? smp.f0 : smp.f1);
    for (const smp of m.path) {
      if (smp.out) break;
      if ((smp.z < 0 ? 0 : 1) !== team || Math.abs(smp.z) < COURT.netGap + 0.1) continue;
      const bounces = m.bounces + ourF(smp);
      if (bounces >= 2) break;
      if (m.serving && bounces === 0) continue;
      const top = HIGH + 0.4;
      if (smp.y < LOW + 0.05 || smp.y > top) continue;
      let fx = smp.x - rightX(team) * this.sideOf(i);
      if (Math.abs(fx) > COURT.halfW - 0.35) fx = smp.x + rightX(team) * this.sideOf(i);
      const d = Math.hypot(fx - p.pos[0], smp.z - p.pos[1]);
      if (react + d / speed > smp.t + 0.04) continue;
      // Prefer waist height after the bounce from the back; up at the net take it early (volley / smash).
      // Don't dig it out of the turf from the back: let it rise (or come off the glass).
      const comfy = smp.y >= 0.55 && smp.y <= 1.45 ? 0 : smp.y > 1.85 ? (back ? 0.35 : 0.05) : smp.y < 0.4 ? (back ? 0.9 : 0.4) : 0.25;
      const cost = smp.t + comfy * 0.6 + (bounces === 0 && back ? 0.2 : 0);
      if (!best || cost < best.cost) best = { x: smp.x, y: smp.y, z: smp.z, at: m.time + smp.t, cost };
    }
    return best;
  }

  /** Where a player waits: side by side, up at the net or back, shading towards the ball. */
  private formation(i: number, team: 0 | 1): void {
    const m = this.m;
    const p = m.players[i]!;
    const s = sideSign(team);
    const solo = m.players.filter((q) => q.team === team).length === 1;
    const net = this.atNet[team];
    const z = s * (net ? 3.1 : 8.0);
    const bx = m.ball.pos[0];
    const x = solo ? bx * 0.45 : rightX(team) * (p.def.slot === 0 ? 1 : -1) * 2.3 + bx * 0.3;
    p.target[0] = Math.max(-COURT.halfW + 0.6, Math.min(COURT.halfW - 0.6, x));
    p.target[1] = z;
  }

  /** A bot's shot: the kind, where to, how hard — as a stroke. */
  private chooseShot(i: number, c: Plan): Stroke {
    const m = this.m;
    const p = m.players[i]!;
    const team = p.team;
    const lv = this.level(i);
    const opp = m.players.filter((q) => q.team !== team);
    const oppAtNet = opp.length > 0 && opp.every((q) => Math.abs(q.pos[1]) < 5);
    const depth = Math.abs(c.z);
    const r = m.rand();
    // Aim at the gap: the side further from the opponents (+1 = our right).
    const ox = opp.reduce((a, q) => a + q.pos[0], 0) / Math.max(1, opp.length);
    const gap = ox * rightX(team) > 0 ? -1 : 1;
    // Better players go closer to the lines (more winners, more misses).
    const smartAim = gap * (0.5 + 0.25 * m.rand() + 0.25 * lv.smart);
    const aim = lv.smart > m.rand() ? smartAim : (m.rand() - 0.5) * 1.6;
    const stroke = (a: number, power: number, lob = false): Stroke => ({ dx: Math.tan(Math.max(-1, Math.min(1, a)) * ((40 * Math.PI) / 180)), dy: -1, power: Math.min(power * (0.85 + 0.25 * lv.smart), lv.power), lob });
    if (c.y > 1.9) {
      if (depth < 6 && r < 0.45 + 0.4 * lv.smart) return stroke(aim * 0.7, 0.85 + 0.15 * m.rand());
      return m.rand() < 0.5 ? stroke(aim * 0.3, 0.55 + 0.15 * m.rand()) : stroke(aim > 0 ? 0.7 : -0.7, 0.6 + 0.15 * m.rand());
    }
    if (oppAtNet && depth > 6) {
      if (r < 0.5) return stroke(aim * 0.6, 0.45 + 0.3 * m.rand(), true);
      if (r < 0.72) return stroke(aim * 0.5, 0.12 + 0.12 * m.rand());
      return stroke(aim, 0.55 + 0.2 * m.rand());
    }
    if (depth < 4.5) {
      if (r < 0.15) return stroke(aim, 0.15 + 0.1 * m.rand());
      return stroke(aim, 0.55 + 0.4 * m.rand());
    }
    if (r < 0.15 && !oppAtNet) return stroke(aim * 0.6, 0.5 + 0.3 * m.rand(), true);
    return stroke(aim, 0.5 + 0.4 * m.rand());
  }
}
