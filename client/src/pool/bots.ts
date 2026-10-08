import { BOUNDS, HEAD_STRING_X, MAX_CUE_SPEED, ON_TABLE, POCKETS, R, Sim, castCue, spotFree, FOOT_SPOT_X, type BallRest, type ShotInput } from './physics';
import { groupOf, type Action, type Player, type PoolEngine } from './engine';

export type BotLevel = 'easy' | 'normal' | 'hard';

/**
 * aim / power: execution noise (degrees, fraction); sims: candidates checked by
 * simulation; variants: power/spin variants per candidate; second: chance of
 * deliberately taking the second-best shot; position: weight of the shot the
 * cue ball leaves for next turn.
 */
const LEVEL: Record<BotLevel, { aim: number; power: number; sims: number; variants: number; second: number; position: number; think: [number, number] }> = {
  easy: { aim: 3.8, power: 0.3, sims: 0, variants: 1, second: 0.2, position: 0, think: [1.8, 3] },
  normal: { aim: 0.7, power: 0.08, sims: 3, variants: 3, second: 0.08, position: 0.4, think: [1.5, 2.6] },
  hard: { aim: 0.2, power: 0.03, sims: 6, variants: 7, second: 0, position: 1, think: [1.3, 2.3] },
};

/** Power / follow / side variants tried on each simulated candidate, in priority order. */
const VARIANTS: Array<[number, number, number]> = [
  [1, 0, 0],
  [0.85, 0.3, 0],
  [1.15, -0.3, 0],
  [1, 0.45, 0],
  [0.9, -0.2, 0],
  [1, 0.15, 0.35],
  [1, 0.15, -0.35],
];
const MAX_CUT = Math.cos((70 * Math.PI) / 180);

interface Candidate {
  kind: 'pot' | 'combo' | 'kick' | 'safety';
  /** The ball meant to drop (pot / combo) or the ball played (safety / kick). */
  target: number;
  pocket: number;
  cue: { x: number; y: number };
  dir: { x: number; y: number };
  power: number;
  /** Heuristic value before any simulation. */
  score: number;
}

const gauss = () => {
  let u = 0;
  while (u === 0) u = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
};

/** Distance from point to segment. */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const ex = bx - ax;
  const ey = by - ay;
  const l2 = ex * ex + ey * ey || 1e-9;
  const t = Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / l2));
  const dx = px - (ax + ex * t);
  const dy = py - (ay + ey * t);
  return Math.sqrt(dx * dx + dy * dy);
}

function clear(balls: BallRest[], ax: number, ay: number, bx: number, by: number, skip: number[], width = 2 * R): boolean {
  for (const b of balls) {
    if (b.pocket !== ON_TABLE || skip.includes(b.id)) continue;
    if (segDist(b.x, b.y, ax, ay, bx, by) < width * 0.98) return false;
  }
  return true;
}

const norm = (x: number, y: number) => {
  const l = Math.sqrt(x * x + y * y) || 1;
  return { x: x / l, y: y / l, l };
};

/** Cue speed to send a ball `d2` to the pocket with pace to spare, from `d1` away at cut cosine `cos`. */
function potPower(d1: number, d2: number, cos: number): number {
  const vObj = Math.sqrt(2 * 0.45 * (d2 + 0.25));
  const vCue = vObj / (0.975 * Math.max(0.3, cos));
  const v0 = Math.sqrt(vCue * vCue + 2 * 0.9 * d1);
  return Math.max(0.1, Math.min(0.95, v0 / MAX_CUE_SPEED));
}

/** Plans shots for a bot seat. */
export class PoolBot {
  constructor(readonly level: BotLevel) {}

  plan(e: PoolEngine): Action {
    const L = LEVEL[this.level];
    const p = e.current;
    if (e.isBreak) return this.breakShot();
    const targets = e.targets(p);
    const cueBall = e.balls.find((b) => b.id === 0)!;
    const cue = e.ballInHand ? null : { x: cueBall.x, y: cueBall.y };
    let cands = this.potCandidates(e, targets, cue);
    if (!cands.length) cands = this.comboCandidates(e, targets, cue);
    if (!cands.length && cue) cands = this.kickCandidates(e, targets, cue);
    cands.sort((a, b) => b.score - a.score);
    let picks: Array<{ c: Candidate; shot: ShotInput; value: number }> = [];
    if (L.sims > 0) {
      // Verify the best few by simulation, with power / spin variants; a miss is
      // scored by what it leaves, so safeties compete on the same scale.
      for (const c of cands.slice(0, L.sims)) {
        let best: { c: Candidate; shot: ShotInput; value: number } | null = null;
        for (const [pm, sy, sx] of VARIANTS.slice(0, L.variants)) {
          const shot: ShotInput = { dx: c.dir.x, dy: c.dir.y, power: Math.min(1, c.power * pm), sx, sy };
          const v = this.evaluate(e, p, c, shot);
          if (!best || v > best.value) best = { c, shot, value: v };
        }
        if (best) picks.push(best);
      }
      const bestPot = picks.length ? Math.max(...picks.map((x) => x.value)) : -Infinity;
      const plain = (c: Candidate) => ({ c, shot: { dx: c.dir.x, dy: c.dir.y, power: c.power, sx: 0, sy: 0 }, value: this.evaluate(e, p, c, { dx: c.dir.x, dy: c.dir.y, power: c.power, sx: 0, sy: 0 }) });
      if (bestPot < 8) for (const s of this.safeties(e, targets, cue)) picks.push(plain(s));
      // Every direct line fouls: try kicks off the cushions too.
      if (cue && Math.max(-Infinity, ...picks.map((x) => x.value)) <= -15 && cands[0]?.kind !== 'kick') for (const k of this.kickCandidates(e, targets, cue).slice(0, 8)) picks.push(plain(k));
    } else {
      picks = cands.slice(0, 3).map((c) => ({ c, shot: { dx: c.dir.x, dy: c.dir.y, power: c.power, sx: 0, sy: 0 }, value: c.score }));
    }
    picks.sort((a, b) => b.value - a.value);
    let pick = picks[0];
    if (picks.length > 1 && Math.random() < L.second) pick = picks[1];
    if (!pick) return this.fallback(e, targets, cueBall);
    const shot = this.noisy(pick.shot);
    const call = e.onEight() ? (pick.c.pocket >= 0 ? pick.c.pocket : this.nearestPocket(e.balls.find((b) => b.id === pick!.c.target)!)) : undefined;
    return { t: 'shoot', shot, cue: e.ballInHand ? pick.c.cue : undefined, call };
  }

  /** Full-ball on the apex from the middle of the head string with a touch of draw: spreads well, almost never scratches. */
  private breakShot(): Action {
    const cue = { x: HEAD_STRING_X - 0.02, y: (Math.random() - 0.5) * 0.04 };
    const d = norm(FOOT_SPOT_X - 2 * R * 0.98 - cue.x, -cue.y);
    return { t: 'shoot', cue, shot: { dx: d.x, dy: d.y, power: 0.9 + Math.random() * 0.07, sx: 0, sy: -0.3 } };
  }

  private noisy(s: ShotInput): ShotInput {
    const L = LEVEL[this.level];
    const a = (gauss() * L.aim * Math.PI) / 180;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    return { ...s, dx: s.dx * c - s.dy * sn, dy: s.dx * sn + s.dy * c, power: Math.max(0.05, Math.min(1, s.power * (1 + gauss() * L.power))) };
  }

  /** How the object ball enters: 1 = straight down the pocket's throat; side pockets need ≥ 0.45. */
  private approach(pi: number, ux: number, uy: number): number {
    const pk = POCKETS[pi]!;
    return ux * pk.mx + uy * pk.my;
  }

  /** Balls (other than `skip`) sitting near the pocket mouth that could knock the pot off. */
  private crowded(balls: BallRest[], pi: number, skip: number[]): number {
    const pk = POCKETS[pi]!;
    let n = 0;
    for (const b of balls) if (b.pocket === ON_TABLE && !skip.includes(b.id) && Math.hypot(b.x - pk.ax, b.y - pk.ay) < 0.11) n++;
    return n;
  }

  /** Direct pots: every target into every pocket (from the cue ball, or from good ball-in-hand spots). */
  private potCandidates(e: PoolEngine, targets: number[], cue: { x: number; y: number } | null): Candidate[] {
    const out: Candidate[] = [];
    for (const tid of targets) {
      const t = e.balls.find((b) => b.id === tid)!;
      POCKETS.forEach((pk, pi) => {
        const u = norm(pk.ax - t.x, pk.ay - t.y);
        const q = this.approach(pi, u.x, u.y);
        if (pk.side ? q < 0.45 : q < 0.25) return;
        if (!clear(e.balls, t.x, t.y, pk.ax, pk.ay, [tid, 0])) return;
        const gx = t.x - u.x * 2 * R;
        const gy = t.y - u.y * 2 * R;
        const spots = cue ? [cue] : this.handSpots(e, gx, gy, u.x, u.y, tid);
        for (const c of spots) {
          const a = norm(gx - c.x, gy - c.y);
          if (a.l < 1e-3) continue;
          const cos = a.x * u.x + a.y * u.y;
          if (cos < MAX_CUT) continue;
          if (!clear(e.balls, c.x, c.y, gx, gy, [tid, 0])) continue;
          const score = 10 - (a.l * 0.8 + u.l * 1.4 + (1 / cos - 1) * 2.2 + (1 - q) * 2 + this.crowded(e.balls, pi, [tid, 0]) * 2);
          out.push({ kind: 'pot', target: tid, pocket: pi, cue: c, dir: { x: a.x, y: a.y }, power: potPower(a.l, u.l, cos), score });
        }
      });
    }
    return out;
  }

  /** Combos: a legal first ball knocks one of ours in when nothing goes directly. */
  private comboCandidates(e: PoolEngine, targets: number[], cue: { x: number; y: number } | null): Candidate[] {
    const out: Candidate[] = [];
    const mine = e.balls.filter((b) => b.pocket === ON_TABLE && targets.includes(b.id));
    for (const t2 of mine) {
      POCKETS.forEach((pk, pi) => {
        const u = norm(pk.ax - t2.x, pk.ay - t2.y);
        const q = this.approach(pi, u.x, u.y);
        if ((pk.side ? q < 0.5 : q < 0.3) || u.l > 0.8) return;
        if (!clear(e.balls, t2.x, t2.y, pk.ax, pk.ay, [t2.id, 0])) return;
        const g2x = t2.x - u.x * 2 * R;
        const g2y = t2.y - u.y * 2 * R;
        for (const t1 of mine) {
          if (t1.id === t2.id) continue;
          const v = norm(g2x - t1.x, g2y - t1.y);
          if (v.l > 0.5 || !clear(e.balls, t1.x, t1.y, g2x, g2y, [t1.id, t2.id, 0])) continue;
          const g1x = t1.x - v.x * 2 * R;
          const g1y = t1.y - v.y * 2 * R;
          const spots = cue ? [cue] : this.handSpots(e, g1x, g1y, v.x, v.y, t1.id);
          for (const c of spots) {
            const a = norm(g1x - c.x, g1y - c.y);
            const cos1 = a.x * v.x + a.y * v.y;
            const cos2 = v.x * u.x + v.y * u.y;
            if (cos1 < 0.5 || cos2 < 0.5 || !clear(e.balls, c.x, c.y, g1x, g1y, [t1.id, 0])) continue;
            const score = 4 - (a.l * 0.8 + v.l * 2 + u.l * 1.4 + (1 / cos1 - 1) * 2.2 + (1 / cos2 - 1) * 3);
            out.push({ kind: 'combo', target: t2.id, pocket: pi, cue: c, dir: { x: a.x, y: a.y }, power: Math.min(0.95, potPower(a.l + v.l, u.l, cos1 * cos2) * 1.15), score });
          }
        }
      });
    }
    return out;
  }

  /** Snookered: play the target off one or two cushions (mirror it across the rails, check the path with the ray cast). */
  private kickCandidates(e: PoolEngine, targets: number[], cue: { x: number; y: number }): Candidate[] {
    const out: Candidate[] = [];
    const xr = BOUNDS.HL - R;
    const yr = BOUNDS.HW - R;
    const mirrors: Array<(x: number, y: number) => [number, number]> = [
      (x, y) => [x, 2 * yr - y],
      (x, y) => [x, -2 * yr - y],
      (x, y) => [2 * xr - x, y],
      (x, y) => [-2 * xr - x, y],
    ];
    for (const tid of targets) {
      const t = e.balls.find((b) => b.id === tid)!;
      const tries: Array<[number, number, number]> = [];
      for (let i = 0; i < 4; i++) {
        const [mx, my] = mirrors[i]!(t.x, t.y);
        tries.push([mx, my, 1]);
        for (let j = 0; j < 4; j++) {
          if (j === i || (j ^ i) === 1) continue;
          const [m2x, m2y] = mirrors[j]!(mx, my);
          tries.push([m2x, m2y, 2]);
        }
      }
      for (const [mx, my, rails] of tries) {
        const d = norm(mx - cue.x, my - cue.y);
        // Walk the cast: it must bounce `rails` times and then reach the target first.
        let x = cue.x;
        let y = cue.y;
        let dx = d.x;
        let dy = d.y;
        let ok = true;
        let len = 0;
        for (let k = 0; k <= rails; k++) {
          const h = castCue(e.balls, x, y, dx, dy);
          len += h.t;
          if (k < rails) {
            if (h.ball >= 0) {
              ok = false;
              break;
            }
            x += dx * h.t;
            y += dy * h.t;
            if (h.nx) dx = -dx;
            if (h.ny) dy = -dy;
          } else if (h.ball !== tid) ok = false;
        }
        if (!ok) continue;
        out.push({ kind: 'kick', target: tid, pocket: -1, cue, dir: { x: d.x, y: d.y }, power: Math.min(0.7, 0.3 + len * 0.18), score: -4 - len - rails * 1.5 });
      }
    }
    return out;
  }

  /** Soft rolls onto our balls at a few cut angles; the simulation scores what they leave. */
  private safeties(e: PoolEngine, targets: number[], cue: { x: number; y: number } | null): Candidate[] {
    const out: Candidate[] = [];
    for (const tid of targets) {
      const t = e.balls.find((b) => b.id === tid)!;
      const spots = cue ? [cue] : this.safetySpots(e, t);
      for (const c of spots) {
        const d = norm(t.x - c.x, t.y - c.y);
        if (!clear(e.balls, c.x, c.y, t.x - d.x * 2 * R, t.y - d.y * 2 * R, [tid, 0])) continue;
        for (const off of [0, -0.6, 0.6, -1.2, 1.2]) {
          // Offset the ghost ball sideways by `off`·R for a thinner hit.
          const gx = t.x - d.x * 2 * R - d.y * off * R;
          const gy = t.y - d.y * 2 * R + d.x * off * R;
          const a = norm(gx - c.x, gy - c.y);
          for (const power of [0.12, 0.2]) out.push({ kind: 'safety', target: tid, pocket: -1, cue: c, dir: { x: a.x, y: a.y }, power, score: -2 - d.l });
        }
      }
    }
    return out.slice(0, 40);
  }

  private safetySpots(e: PoolEngine, t: BallRest): Array<{ x: number; y: number }> {
    const out: Array<{ x: number; y: number }> = [];
    for (let a = 0; a < 12 && out.length < 3; a++) {
      const x = t.x - Math.cos((a * Math.PI) / 6) * 0.25;
      const y = t.y - Math.sin((a * Math.PI) / 6) * 0.25;
      if (e.canPlace(x, y) && clear(e.balls, x, y, t.x, t.y, [t.id, 0])) out.push({ x, y });
    }
    return out;
  }

  /** Good ball-in-hand spots: behind the ghost ball, straight or slightly angled. */
  private handSpots(e: PoolEngine, gx: number, gy: number, ux: number, uy: number, tid: number): Array<{ x: number; y: number }> {
    const out: Array<{ x: number; y: number }> = [];
    for (const ang of [0, 0.25, -0.25, 0.5, -0.5]) {
      for (const dist of [0.22, 0.4]) {
        const c = Math.cos(ang);
        const s = Math.sin(ang);
        const vx = ux * c - uy * s;
        const vy = ux * s + uy * c;
        const x = gx - vx * dist;
        const y = gy - vy * dist;
        if (e.canPlace(x, y) && clear(e.balls, x, y, gx, gy, [tid, 0])) out.push({ x, y });
      }
    }
    return out.slice(0, 4);
  }

  /**
   * Simulate a candidate and score it: a pot is 10+ (plus what it leaves us, by
   * level); a legal miss or safety is worth minus the opponent's best reply, so
   * leaving them snookered beats leaving them a hanger.
   */
  private evaluate(e: PoolEngine, p: Player, c: Candidate, shot: ShotInput): number {
    const L = LEVEL[this.level];
    const balls = e.balls.map((b) => (b.id === 0 && e.ballInHand ? { ...b, x: c.cue.x, y: c.cue.y, pocket: ON_TABLE } : { ...b }));
    const sim = new Sim(balls);
    sim.shoot(shot);
    sim.runToRest(12);
    const targets = new Set(e.targets(p));
    const pots = sim.events.filter((x) => x.k === 'pocket') as Array<{ a: number; pocket: number }>;
    const cueIn = pots.some((x) => x.a === 0);
    const eightIn = pots.find((x) => x.a === 8);
    const onEight = e.onEight(p);
    if (eightIn && !(onEight && eightIn.pocket === c.pocket && !cueIn)) return -100;
    if (cueIn || sim.firstHit < 0 || !targets.has(sim.firstHit)) return -20;
    const potted = pots.filter((x) => targets.has(x.a)).length;
    if (onEight && eightIn) return 100;
    const after = sim.rest();
    const cue = after.find((b) => b.id === 0)!;
    const nearPocket = POCKETS.some((pk) => Math.hypot(pk.x - cue.x, pk.y - cue.y) < 0.13) ? 2 : 0;
    if (!potted) {
      if (!sim.railAfterHit) return -15;
      // What's the opponent's best reply?
      const opp = e.other;
      const fake = { ...e, balls: after, ballInHand: false, canPlace: () => false } as unknown as PoolEngine;
      const oppTargets = opp.group ? after.filter((b) => b.pocket === ON_TABLE && groupOf(b.id) === opp.group).map((b) => b.id) : after.filter((b) => b.pocket === ON_TABLE && b.id !== 0 && b.id !== 8).map((b) => b.id);
      const reply = this.potCandidates(fake, oppTargets.length ? oppTargets : [8], { x: cue.x, y: cue.y });
      const best = reply.length ? Math.max(...reply.map((r) => r.score)) : -6;
      return -best - 1 - (c.kind === 'kick' ? 2 : 0);
    }
    if (!L.position) return 10 + potted;
    // Position: how good is the next shot?
    const fake = { ...e, balls: after, ballInHand: false, canPlace: () => false } as unknown as PoolEngine;
    const nextTargets = after.filter((b) => b.pocket === ON_TABLE && targets.has(b.id)).map((b) => b.id);
    const next = nextTargets.length ? this.potCandidates(fake, nextTargets, { x: cue.x, y: cue.y }) : this.potCandidates(fake, [8], { x: cue.x, y: cue.y });
    const pos = next.length ? Math.max(...next.map((n) => n.score)) : -3;
    return 10 + potted * 2 + L.position * (pos - nearPocket);
  }

  /** Nothing playable at all: roll onto the nearest target so something reaches a cushion. */
  private fallback(e: PoolEngine, targets: number[], cueBall: BallRest): Action {
    let cue = { x: cueBall.x, y: cueBall.y };
    let target = targets[0]!;
    let bestD = Infinity;
    for (const tid of targets) {
      const t = e.balls.find((b) => b.id === tid)!;
      if (e.ballInHand) {
        const spot = this.safetySpots(e, t)[0];
        if (spot) {
          cue = spot;
          target = tid;
          bestD = 0;
          break;
        }
        continue;
      }
      const d = Math.hypot(t.x - cue.x, t.y - cue.y);
      const ok = clear(e.balls, cue.x, cue.y, t.x, t.y, [tid, 0]);
      const score = d + (ok ? 0 : 10);
      if (score < bestD) {
        bestD = score;
        target = tid;
      }
    }
    if (e.ballInHand && bestD !== 0) {
      for (let k = 0; k < 200; k++) {
        const x = (Math.random() - 0.5) * 2;
        const y = (Math.random() - 0.5) * 1;
        if (e.canPlace(x, y)) {
          cue = { x, y };
          break;
        }
      }
    }
    const t = e.balls.find((b) => b.id === target)!;
    const d = norm(t.x - cue.x, t.y - cue.y);
    const shot = this.noisy({ dx: d.x, dy: d.y, power: 0.35 + Math.random() * 0.15, sx: 0, sy: 0 });
    const call = e.onEight() ? this.nearestPocket(t) : undefined;
    return { t: 'shoot', shot, cue: e.ballInHand ? cue : undefined, call };
  }

  private nearestPocket(b: BallRest): number {
    let best = 0;
    let bd = Infinity;
    POCKETS.forEach((p, i) => {
      const d = (p.x - b.x) ** 2 + (p.y - b.y) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }
}

/** Runs bot turns with a human-like pause. */
export class BotDriver {
  private wait = -1;
  private bot: PoolBot;
  constructor(
    private readonly e: PoolEngine,
    level: BotLevel,
  ) {
    this.bot = new PoolBot(level);
  }

  update(dt: number): void {
    const e = this.e;
    if (e.phase !== 'aim' || !e.current.bot) {
      this.wait = -1;
      return;
    }
    if (this.wait < 0) {
      const [a, b] = LEVEL[this.bot.level].think;
      this.wait = a + Math.random() * (b - a);
    }
    this.wait -= dt;
    if (this.wait > 0) return;
    this.wait = -1;
    const action = this.bot.plan(e);
    const err = e.act(e.current.id, action);
    if (err) {
      // Fall back to something always legal: tap the nearest target.
      const cue = e.balls.find((b) => b.id === 0)!;
      const t = e.balls.find((b) => b.id === e.targets()[0])!;
      const dx = t.x - cue.x;
      const dy = t.y - cue.y;
      const l = Math.sqrt(dx * dx + dy * dy) || 1;
      let spot: { x: number; y: number } | undefined;
      if (e.ballInHand && !e.canPlace(cue.x, cue.y)) for (let k = 0; k < 300 && !spot; k++) {
        const x = -0.9 + Math.random() * 0.4;
        const y = (Math.random() - 0.5) * 0.9;
        if (e.canPlace(x, y)) spot = { x, y };
      }
      e.act(e.current.id, { t: 'shoot', shot: { dx: dx / l, dy: dy / l, power: 0.4, sx: 0, sy: 0 }, cue: spot, call: 0 });
    }
  }
}

export { spotFree };
