import { HEAD_STRING_X, MAX_CUE_SPEED, POCKETS, R, Sim, spotFree, FOOT_SPOT_X, type BallRest, type ShotInput } from './physics';
import { groupOf, type Action, type Player, type PoolEngine } from './engine';

export type BotLevel = 'easy' | 'normal' | 'hard';

const LEVEL: Record<BotLevel, { aim: number; power: number; sims: number; think: [number, number] }> = {
  easy: { aim: 1.6, power: 0.18, sims: 0, think: [1.8, 3] },
  normal: { aim: 0.55, power: 0.07, sims: 2, think: [1.5, 2.6] },
  hard: { aim: 0.18, power: 0.03, sims: 7, think: [1.3, 2.3] },
};

interface Candidate {
  target: number;
  pocket: number;
  cue: { x: number; y: number };
  dir: { x: number; y: number };
  power: number;
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
    if (b.pocket >= 0 || skip.includes(b.id)) continue;
    if (segDist(b.x, b.y, ax, ay, bx, by) < width * 0.98) return false;
  }
  return true;
}

/** Plans shots for a bot seat. */
export class PoolBot {
  constructor(readonly level: BotLevel) {}

  plan(e: PoolEngine): Action {
    const L = LEVEL[this.level];
    const p = e.current;
    const cueBall = e.balls.find((b) => b.id === 0)!;
    // The break.
    if (e.isBreak) {
      const y = (Math.random() - 0.5) * 0.3;
      const cue = { x: HEAD_STRING_X - 0.02, y };
      const tx = FOOT_SPOT_X - 2 * R * 0.98;
      const dx = tx - cue.x;
      const dy = (Math.random() - 0.5) * 0.01 - y;
      const l = Math.sqrt(dx * dx + dy * dy);
      return { t: 'shoot', cue, shot: { dx: dx / l, dy: dy / l, power: 0.92 + Math.random() * 0.08, sx: 0, sy: -0.15 } };
    }
    const targets = e.targets(p);
    let cands = this.candidates(e, targets, p);
    // Verify the best few by simulating them (with power / spin variations).
    let best: { c: Candidate; shot: ShotInput; value: number } | null = null;
    if (cands.length) {
      cands.sort((a, b) => b.score - a.score);
      if (L.sims > 0) {
        cands = cands.slice(0, L.sims);
        for (const c of cands) {
          const variants: Array<[number, number]> = this.level === 'hard' ? [[1, 0], [0.85, 0.3], [1.15, -0.3], [1, 0.45], [0.9, -0.15]] : [[1, 0]];
          for (const [pm, sy] of variants) {
            const shot: ShotInput = { dx: c.dir.x, dy: c.dir.y, power: Math.min(1, c.power * pm), sx: 0, sy };
            const v = this.evaluate(e, p, c, shot);
            if (!best || v > best.value) best = { c, shot, value: v };
          }
        }
        if (best && best.value < 0 && Math.random() < 0.6) best = null; // everything looked bad → play safe
      } else {
        const c = cands[Math.floor(Math.random() * Math.min(3, cands.length))]!;
        best = { c, shot: { dx: c.dir.x, dy: c.dir.y, power: c.power, sx: 0, sy: 0 }, value: 0 };
      }
    }
    if (best) {
      const shot = this.noisy(best.shot);
      return { t: 'shoot', shot, cue: e.ballInHand ? best.c.cue : undefined, call: best.c.pocket };
    }
    return this.safety(e, targets, cueBall);
  }

  private noisy(s: ShotInput): ShotInput {
    const L = LEVEL[this.level];
    const a = (gauss() * L.aim * Math.PI) / 180;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    return { ...s, dx: s.dx * c - s.dy * sn, dy: s.dx * sn + s.dy * c, power: Math.max(0.05, Math.min(1, s.power * (1 + gauss() * L.power))) };
  }

  private candidates(e: PoolEngine, targets: number[], p: Player): Candidate[] {
    const out: Candidate[] = [];
    const cueBall = e.balls.find((b) => b.id === 0)!;
    for (const tid of targets) {
      const t = e.balls.find((b) => b.id === tid)!;
      POCKETS.forEach((pk, pi) => {
        const dx = pk.ax - t.x;
        const dy = pk.ay - t.y;
        const d2 = Math.sqrt(dx * dx + dy * dy);
        const ux = dx / d2;
        const uy = dy / d2;
        // Side pockets can't be reached at a steep angle.
        if (pi === 1 || pi === 4) {
          const ny = pi === 1 ? 1 : -1;
          if (uy * ny < 0.45) return;
        }
        if (!clear(e.balls, t.x, t.y, pk.ax, pk.ay, [tid, 0])) return;
        const gx = t.x - ux * 2 * R;
        const gy = t.y - uy * 2 * R;
        const spots = e.ballInHand ? this.handSpots(e, gx, gy, ux, uy, tid) : [{ x: cueBall.x, y: cueBall.y }];
        for (const c of spots) {
          const ax = gx - c.x;
          const ay = gy - c.y;
          const d1 = Math.sqrt(ax * ax + ay * ay);
          if (d1 < 1e-3) continue;
          const cx = ax / d1;
          const cy = ay / d1;
          const cos = cx * ux + cy * uy;
          if (cos < 0.2) continue;
          if (!clear(e.balls, c.x, c.y, gx, gy, [tid, 0])) continue;
          // Power: enough to drop the ball with some pace to spare.
          const vObj = Math.sqrt(2 * 0.45 * (d2 + 0.25));
          const vCue = vObj / (0.975 * cos);
          const v0 = Math.sqrt(vCue * vCue + 2 * 0.9 * d1);
          const power = Math.max(0.1, Math.min(0.95, v0 / MAX_CUE_SPEED));
          const score = -(d1 * 0.8 + d2 * 1.4 + (1 / cos - 1) * 2.2) + (p.group && groupOf(tid) === p.group ? 0 : 0);
          out.push({ target: tid, pocket: pi, cue: c, dir: { x: cx, y: cy }, power, score });
        }
      });
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

  /** Simulate a candidate and score it: pot + no foul + where the cue ball ends up. */
  private evaluate(e: PoolEngine, p: Player, c: Candidate, shot: ShotInput): number {
    const balls = e.balls.map((b) => (b.id === 0 && e.ballInHand ? { ...b, x: c.cue.x, y: c.cue.y, pocket: -1 } : { ...b }));
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
    if (!potted) return sim.railAfterHit ? -3 : -15;
    // Position: how many easy shots does the next turn have?
    if (this.level !== 'hard') return 10 + potted;
    const after = sim.rest();
    const fake = { ...e, balls: after, ballInHand: false, canPlace: () => false } as unknown as PoolEngine;
    const nextTargets = after.filter((b) => b.pocket < 0 && targets.has(b.id)).map((b) => b.id);
    const next = nextTargets.length ? this.candidates(fake, nextTargets, p) : [];
    const pos = next.length ? Math.max(...next.map((n) => n.score)) : -3;
    return 10 + potted * 2 + pos;
  }

  /** No good pot: roll softly onto one of ours so something reaches a cushion. */
  private safety(e: PoolEngine, targets: number[], cueBall: BallRest): Action {
    let cue = { x: cueBall.x, y: cueBall.y };
    let target = targets[0]!;
    let bestD = Infinity;
    for (const tid of targets) {
      const t = e.balls.find((b) => b.id === tid)!;
      if (e.ballInHand) {
        // Place the cue ball a little way from the target with a clear line.
        for (let a = 0; a < 12; a++) {
          const x = t.x - Math.cos((a * Math.PI) / 6) * 0.25;
          const y = t.y - Math.sin((a * Math.PI) / 6) * 0.25;
          if (e.canPlace(x, y) && clear(e.balls, x, y, t.x, t.y, [tid, 0])) {
            cue = { x, y };
            target = tid;
            bestD = 0;
            break;
          }
        }
        if (bestD === 0) break;
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
    const dx = t.x - cue.x;
    const dy = t.y - cue.y;
    const l = Math.sqrt(dx * dx + dy * dy) || 1;
    const shot = this.noisy({ dx: dx / l, dy: dy / l, power: 0.35 + Math.random() * 0.15, sx: 0, sy: 0 });
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
