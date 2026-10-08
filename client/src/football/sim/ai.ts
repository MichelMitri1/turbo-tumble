import type { KickType, MatchSim, Pl, Restart } from './match';
import { PITCH } from './match';

/**
 * Team AI: shape, pressing, marking, support runs and the ball carrier's decisions.
 * It only writes intents (tx / tz / tSprint) and calls the sim's actions, so the same
 * brain drives CPU teams, a human's teammates and both sides of a headless test.
 */

const G = 9.81;

export class TeamAI {
  private think = new Map<number, number>();
  private runUntil = new Map<number, number>();
  private gotBallAt = new Map<number, number>();
  private lastOwner = -1;
  /** Predicted ball path (loose ball), refreshed each tick: [t, x, y, z]. */
  private path: Array<[number, number, number, number]> = [];
  /** The loose ball is running out of play (z: touchline, x: goal line). */
  private goingOut = false;

  constructor(
    private m: MatchSim,
    readonly team: 0 | 1,
  ) {}

  private get s(): number {
    return this.m.dir[this.team];
  }
  /** Decision quality 0…1: the CPU difficulty against humans, "pro" for a human's teammates. */
  private get skill(): number {
    return this.m.humans.some((h) => h.team === this.team) ? 0.8 : this.m.diff();
  }
  private rel(x: number): number {
    return x * this.s;
  }

  update(dt: number): void {
    const m = this.m;
    const mine = m.teamPlayers(this.team);
    if (m.phase !== 'play') {
      // Set pieces and kick-offs: hold the spot you were given.
      for (const p of mine) {
        if (p.human >= 0) continue;
        p.tx = p.x;
        p.tz = p.z;
        p.tSprint = false;
        if (m.phase === 'goal' && p.state !== 'celebrate') {
          // Jog back towards your own half.
          const [fx, fz] = m.formationSpot(p, 0, 0, false);
          p.tx = fx;
          p.tz = fz;
        }
      }
      return;
    }
    const b = m.ball;
    const o = m.owner();
    if (b.owner !== this.lastOwner) {
      if (o) this.gotBallAt.set(o.i, m.time);
      this.lastOwner = b.owner;
    }
    this.predict();
    const attacking = o ? o.team === this.team : b.lastTeam === this.team && b.kickType !== null;
    // Loose ball: who gets there first?
    let chaser: Pl | null = null;
    let second: Pl | null = null;
    if (!o) {
      const ranked = mine
        .filter((p) => p.state !== 'down' && p.state !== 'off')
        .map((p) => ({ p, t: this.reachTime(p) }))
        .sort((a, c) => a.t.t - c.t.t);
      chaser = ranked[0]?.p ?? null;
      second = ranked[1]?.p ?? null;
      // Their touch and it's running out: shepherd it out rather than keep it in.
      if (this.goingOut && b.lastTeam !== this.team && chaser && Math.abs(chaser.x - m.ownGoalX(this.team)) > 6) {
        const r = this.reachTime(chaser);
        if (r.t > 0.4) chaser = second = null;
      }
      const lp = m.lastPass;
      const gkFirst = chaser?.role === 'GK' ? chaser : null;
      // Their pass has only just been played: it takes a moment to read it and react
      // (outfielders keep their marking until then; the keeper reacts on his own).
      const react = 0.3 - this.skill * 0.14;
      if (b.lastTeam !== this.team && b.kickType && m.time - b.kickAt < react && chaser?.role !== 'GK') chaser = second = null;
      if (lp && lp.team === this.team && b.kickId === lp.id && lp.to >= 0) {
        // Our pass is travelling: only its receiver goes for it (nobody nicks it off him —
        // and if a human is steering the receiver, it's entirely up to them).
        const r = m.players[lp.to]!;
        chaser = r.state === 'run' ? r : null;
        second = null;
      } else if (m.humans.some((h) => h.team === this.team)) {
        // A human always controls the player nearest the ball: AI team-mates don't race them for it.
        chaser = gkFirst;
        second = null;
      }
    }
    const presser = o && o.team !== this.team ? this.nearestTo(mine, o.x, o.z, true) : null;
    const presser2 = presser && o ? this.nearestTo(mine.filter((p) => p !== presser), o.x, o.z, true) : null;
    const supporters = o && o.team === this.team ? this.supporters(mine, o) : [];

    for (const p of mine) {
      if (p.human >= 0 || p.state === 'off') continue;
      if (p.role === 'GK') {
        this.keeper(p, chaser === p);
        continue;
      }
      if (o === p) {
        this.carrier(p, dt);
        continue;
      }
      let [tx, tz] = m.formationSpot(p, b.x, b.z, attacking);
      let sprint = false;
      if (!o) {
        if (p === chaser || (p === second && this.reachTime(p).t < 1.2)) {
          const r = this.reachTime(p);
          tx = r.x;
          tz = r.z;
          sprint = true;
          this.header(p);
        }
      } else if (o.team === this.team) {
        [tx, tz, sprint] = this.offBall(p, o, tx, tz, supporters.indexOf(p));
      } else {
        [tx, tz, sprint] = this.defend(p, o, tx, tz, p === presser ? 1 : p === presser2 ? 2 : 0);
      }
      p.tx = clamp(tx, -PITCH.HL + 0.5, PITCH.HL - 0.5);
      p.tz = clamp(tz, -PITCH.HW + 0.5, PITCH.HW - 0.5);
      p.tSprint = sprint;
    }
  }

  // ---------------------------------------------------------------- ball path

  /** Coarse flight of a loose ball for the next ~3 s (gravity, drag, bounces, grass). */
  private predict(): void {
    const b = this.m.ball;
    this.path.length = 0;
    let { x, y, z, vx, vy, vz } = b;
    const h = 0.05;
    this.goingOut = false;
    for (let t = 0; t <= 3.2; t += h) {
      if (Math.abs(z) > PITCH.HW + 0.1 || (Math.abs(x) > PITCH.HL + 0.1 && Math.abs(z) > PITCH.GOAL_HW)) {
        this.goingOut = true;
        break;
      }
      this.path.push([t, x, y, z]);
      const v = Math.hypot(vx, vy, vz);
      if (y <= 0.12 && Math.abs(vy) < 0.4) {
        vy = 0;
        y = 0.11;
        const hv = Math.hypot(vx, vz);
        if (hv > 0.05) {
          const k = Math.max(0, hv - (0.9 + 0.06 * hv + 0.0133 * hv * hv) * h) / hv;
          vx *= k;
          vz *= k;
        } else vx = vz = 0;
      } else {
        vx -= 0.0133 * v * vx * h;
        vz -= 0.0133 * v * vz * h;
        vy -= (G + 0.0133 * v * vy) * h;
      }
      x += vx * h;
      y += vy * h;
      z += vz * h;
      if (y < 0.11) {
        y = 0.11;
        vy = vy < -0.6 ? -vy * 0.55 : 0;
        vx *= 0.82;
        vz *= 0.82;
      }
    }
  }

  /** Where a player should go to meet the loose ball (used for a human's pass receiver). */
  intercept(p: Pl): { t: number; x: number; z: number } {
    if (!this.path.length) this.predict();
    return this.reachTime(p);
  }

  /** Earliest point on the ball's path this player can get to (and when). */
  private reachTime(p: Pl): { t: number; x: number; z: number } {
    const top = 7.6 + p.def.stats.pac * 0.028;
    for (const [t, x, y, z] of this.path) {
      if (y > 1.85 && p.role !== 'GK') continue;
      const d = Math.max(0, Math.hypot(x - p.x, z - p.z) - 0.6);
      if (d / top + 0.15 <= t) return { t, x, z };
    }
    const last = this.path[this.path.length - 1] ?? [0, this.m.ball.x, 0, this.m.ball.z];
    return { t: 3.2 + Math.hypot(last[1] - p.x, last[3] - p.z) / top, x: last[1], z: last[3] };
  }

  private nearestTo(ps: Pl[], x: number, z: number, outfield: boolean): Pl | null {
    let best: Pl | null = null;
    let bd = Infinity;
    for (const p of ps) {
      if ((outfield && p.role === 'GK') || p.state === 'down' || p.state === 'off') continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  /** Head it if it's dropping on you. */
  private header(p: Pl): void {
    const b = this.m.ball;
    if (p.state !== 'run' || this.m.time < p.noTouch) return;
    if (b.y < 1.1 || b.y > 2.5 || Math.hypot(b.x - p.x, b.z - p.z) > 1.1) return;
    const s = this.s;
    const att = this.rel(p.x) > PITCH.HL - 18 && Math.abs(p.z) < 12;
    this.m.startKick(p, att ? 'header' : 'header', 0.6, att ? s : s * 0.8, att ? -p.z * 0.05 : p.z > 0 ? 0.5 : -0.5, true);
  }

  // ---------------------------------------------------------------- keeper

  private keeper(gk: Pl, chase: boolean): void {
    const m = this.m;
    const b = m.ball;
    const gx = m.ownGoalX(this.team);
    if (gk.state === 'hold') {
      // Walk to the edge of the six-yard box while looking for a pass.
      gk.tx = gx - Math.sign(gx) * 6;
      gk.tz = gk.z * 0.9;
      gk.tSprint = false;
      return;
    }
    const inBox = (x: number, z: number) => Math.abs(x - gx) < PITCH.BOX_D - 0.5 && Math.abs(z) < PITCH.BOX_HW - 0.5;
    const o = m.owner();
    if (!o && chase) {
      const r = this.reachTime(gk);
      if (inBox(r.x, r.z)) {
        gk.tx = r.x;
        gk.tz = r.z;
        gk.tSprint = true;
        return;
      }
    }
    // One-on-one: come off the line to narrow the angle.
    if (o && o.team !== this.team && inBox(o.x, o.z) && Math.hypot(o.x - gx, o.z) < 14) {
      const k = 0.55;
      gk.tx = gx + (o.x - gx) * k;
      gk.tz = o.z * k;
      gk.tSprint = Math.hypot(o.x - gx, o.z) < 9;
      return;
    }
    // On the line between ball and goal centre, a few metres out.
    const dx = b.x - gx;
    const dz = b.z;
    const d = Math.hypot(dx, dz) || 1;
    const out = clamp(0.6 + d * 0.06, 0.6, 4.5);
    gk.tx = gx + (dx / d) * out;
    gk.tz = clamp((dz / d) * out * 1.6, -PITCH.GOAL_HW + 0.4, PITCH.GOAL_HW - 0.4);
    gk.tSprint = false;
  }

  /** Keeper with the ball in his hands: roll it to a free defender or launch it. */
  distribute(gk: Pl): void {
    const m = this.m;
    const s = this.s;
    const mates = m.teamPlayers(this.team).filter((p) => p !== gk && p.state === 'run');
    let best: Pl | null = null;
    let bs = -Infinity;
    for (const p of mates) {
      const d = Math.hypot(p.x - gk.x, p.z - gk.z);
      if (d < 8 || d > 38) continue;
      const free = this.openness(p);
      const lane = this.laneBlocked(gk.x, gk.z, p.x, p.z);
      const score = free * 2 - lane * 8 - d * 0.08 + (m.rand() - 0.5) * 2;
      if (score > bs) {
        bs = score;
        best = p;
      }
    }
    if (best && bs > 4) {
      m.startKick(gk, 'gkThrow', 0.4, best.x - gk.x, best.z - gk.z);
      return;
    }
    const tgt = mates.filter((p) => ['ST', 'LW', 'RW', 'CAM'].includes(p.role)).sort((a, c) => this.openness(c) - this.openness(a))[0];
    if (tgt) m.startKick(gk, 'lob', 0.85, tgt.x - gk.x, tgt.z - gk.z);
    else m.startKick(gk, 'clear', 1, s, 0);
  }

  // ---------------------------------------------------------------- with the ball

  /** How much room a player has (distance to the nearest opponent, capped). */
  private openness(p: Pl): number {
    let d = 12;
    for (const q of this.m.players) {
      if (q.team === p.team || q.state === 'off') continue;
      d = Math.min(d, Math.hypot(q.x - p.x, q.z - p.z));
    }
    return d;
  }

  /** Opponents who could cut out a ball along a segment (weighted by how close they are to it). */
  private laneBlocked(x0: number, z0: number, x1: number, z1: number, lofted = false): number {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const L2 = dx * dx + dz * dz || 1;
    const L = Math.sqrt(L2);
    let n = 0;
    for (const q of this.m.players) {
      if (q.team === this.team || q.state === 'off' || q.state === 'down') continue;
      const t = ((q.x - x0) * dx + (q.z - z0) * dz) / L2;
      if (t < -0.03 || t > 1.02) continue;
      if (lofted && t > 0.12 && t < 0.88) continue; // over his head
      const px = x0 + dx * t;
      const pz = z0 + dz * t;
      const d = Math.hypot(q.x - px, q.z - pz);
      // A defender further along has more time to get across.
      const reach = 1.1 + Math.max(0, t) * L * 0.14;
      if (d < reach) n += 1 - d / reach + 0.3;
    }
    return n;
  }

  private carrier(p: Pl, dt: number): void {
    const m = this.m;
    const s = this.s;
    const gx = s * PITCH.HL;
    const sk = this.skill;
    const relX = this.rel(p.x);
    const distGoal = Math.hypot(gx - p.x, p.z);
    const opp = m.teamPlayers((1 - this.team) as 0 | 1);
    // Nearest opponent in front (the one that matters for dribbling).
    let press = 99;
    let ahead: Pl | null = null;
    let aheadD = 99;
    for (const q of opp) {
      if (q.role === 'GK' && distGoal > 20) continue;
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      press = Math.min(press, d);
      if (this.rel(q.x - p.x) > -1 && d < aheadD) {
        aheadD = d;
        ahead = q;
      }
    }
    // Dribble: at goal, bending away from whoever is in front.
    let dx = gx - p.x;
    let dz = (Math.abs(p.z) > 12 && relX > PITCH.HL - 20 ? -p.z * 0.4 : -p.z * 0.25) + 0;
    if (relX < PITCH.HL - 25) dz = (p.z * 0.1);
    if (ahead && aheadD < 7) {
      const side = Math.sign(p.z - ahead.z) || (m.rand() < 0.5 ? 1 : -1);
      dz += side * (8 - aheadD) * 2.2;
      dx *= aheadD < 3 ? 0.4 : 1;
    }
    const dl = Math.hypot(dx, dz) || 1;
    p.tx = p.x + (dx / dl) * 6;
    p.tz = clamp(p.z + (dz / dl) * 6, -PITCH.HW + 2, PITCH.HW - 2);
    p.tSprint = aheadD > 5 || relX > 0;
    if (p.state !== 'run') return;
    const held = m.time - (this.gotBallAt.get(p.i) ?? m.time);
    let t = (this.think.get(p.i) ?? 0) - dt;
    if (held < 0.2 + (1 - sk) * 0.3 && press > 1.5) t = Math.max(t, 0.01);
    this.think.set(p.i, t);
    if (t > 0) return;
    this.think.set(p.i, 0.12 + (1 - sk) * 0.25 + m.rand() * 0.12);

    // ---- Shoot?
    const gk = m.gkOf((1 - this.team) as 0 | 1);
    const angleOk = Math.abs(p.z) < (PITCH.HL - relX) * 1.4 + 3;
    const range = 13 + p.def.stats.sho * 0.15;
    if (relX > 0 && distGoal < range && angleOk) {
      const aimZ = gk.z > p.z * 0.15 ? -2.7 : 2.7;
      const blocked = this.laneBlocked(p.x, p.z, gx, aimZ * 0.8);
      const want = (distGoal < 12 ? 0.9 : distGoal < 18 ? 0.55 : 0.25) * (blocked > 1 ? 0.3 : 1) + (press < 2 ? 0.15 : 0);
      if (m.rand() < want) {
        const finesse = distGoal > 13 && distGoal < 24 && m.rand() < 0.45;
        const chip = gk.state === 'run' && Math.abs(this.rel(gk.x)) < PITCH.HL - 6 && distGoal < 16 && m.rand() < 0.4;
        const power = clamp(0.45 + distGoal * 0.016 + (m.rand() - 0.5) * 0.12 * (1.2 - sk), 0.4, 0.9);
        const z = (aimZ / 3.6) * (0.65 + m.rand() * 0.3 * sk);
        this.kick(p, chip ? 'chip' : finesse ? 'finesse' : 'shot', power, s * 0.3, z);
        return;
      }
    }

    // ---- Cross from wide in the final third.
    if (relX > PITCH.HL - 24 && Math.abs(p.z) > 17) {
      const inBox = m.teamPlayers(this.team).filter((q) => q !== p && this.rel(q.x) > PITCH.HL - 18 && Math.abs(q.z) < 14).length;
      if (inBox >= 1 && (m.rand() < 0.45 || aheadD < 4 || relX > PITCH.HL - 8)) {
        this.kick(p, 'cross', 0.7, s, -Math.sign(p.z));
        return;
      }
    }

    // ---- Pass?
    const mates = m.teamPlayers(this.team).filter((q) => q !== p && q.state === 'run');
    let best: { q: Pl; type: KickType; score: number } | null = null;
    for (const q of mates) {
      if (q.role === 'GK' && press > 3) continue;
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d < 5 || d > 50) continue;
      const gain = this.rel(q.x - p.x);
      const free = this.openness(q);
      const offsideRisk = this.offsideLine() < this.rel(q.x) - 0.3 && this.rel(q.x) > 0;
      if (offsideRisk) continue;
      const lane = this.laneBlocked(p.x, p.z, q.x, q.z);
      let type: KickType = 'pass';
      let score = gain * 0.35 + Math.min(free, 8) * 1.1 - lane * 7 - d * 0.06;
      // Lofted for long switches when the ground is blocked.
      if (lane > 0.6 && d > 22) {
        const l2 = this.laneBlocked(p.x, p.z, q.x, q.z, true);
        if (l2 < lane) {
          type = 'lob';
          score = gain * 0.35 + Math.min(free, 8) * 1.1 - l2 * 6 - d * 0.1 - 1.5;
        }
      }
      // Through ball for a runner with space behind the line.
      const qv = this.rel(q.vx);
      if (qv > 3 && this.rel(q.x) > relX && this.rel(q.x) > this.offsideLine() - 6 && ['ST', 'LW', 'RW', 'CAM', 'LM', 'RM'].includes(q.role)) {
        const tl = this.laneBlocked(p.x, p.z, q.x + q.vx * 1.2, q.z + q.vz * 1.2);
        const ts = 9 + qv * 0.8 - tl * 6 + Math.max(0, this.rel(q.x) - relX) * 0.15;
        if (ts > score) {
          type = 'through';
          score = ts;
        }
      }
      // Don't pass back into our own box.
      if (this.rel(q.x) < -PITCH.HL + 18 && q.role !== 'GK') score -= 6;
      score += (m.rand() - 0.5) * (1.6 - sk) * 4;
      if (!best || score > best.score) best = { q, type, score };
    }
    // The value of carrying on: room ahead and being near goal.
    const keep = Math.min(aheadD, 10) * 0.9 + (relX > PITCH.HL - 30 ? 2 : 0) + (p.def.stats.dri - 75) * 0.05 - (press < 1.6 ? 6 : 0);
    if (best && best.score > keep + 1.5) {
      const q = best.q;
      this.kick(p, best.type, best.type === 'through' ? 0.45 : clamp(Math.hypot(q.x - p.x, q.z - p.z) / 45, 0.2, 0.8), q.x - p.x, q.z - p.z);
      return;
    }
    // ---- Under pressure deep in our own half with no outlet: clear it.
    if (relX < -PITCH.HL + 22 && press < 2.2 && (!best || best.score < 0)) {
      this.kick(p, 'clear', 1, s, -p.z * 0.02);
    }
  }

  private kick(p: Pl, type: KickType, power: number, ax: number, az: number): void {
    this.m.startKick(p, type, power, ax, az);
  }

  /** The opponents' offside line (second-last defender) in our attacking coordinates. */
  private offsideLine(): number {
    const xs = this.m.teamPlayers((1 - this.team) as 0 | 1).map((q) => this.rel(q.x)).sort((a, c) => c - a);
    return Math.max(xs[1] ?? 0, this.rel(this.m.ball.x), 0);
  }

  // ---------------------------------------------------------------- without the ball

  /** Two nearest teammates come short to give the carrier options. */
  private supporters(mine: Pl[], o: Pl): Pl[] {
    return mine
      .filter((p) => p !== o && p.role !== 'GK' && p.human < 0)
      .sort((a, c) => Math.hypot(a.x - o.x, a.z - o.z) - Math.hypot(c.x - o.x, c.z - o.z))
      .slice(0, 2);
  }

  private offBall(p: Pl, o: Pl, tx: number, tz: number, support: number): [number, number, boolean] {
    const m = this.m;
    const s = this.s;
    const line = this.offsideLine();
    let sprint = false;
    const fwd = ['ST', 'LW', 'RW', 'CAM', 'LM', 'RM'].includes(p.role);
    // Show for it: an angle off the carrier, away from the nearest marker.
    if (support >= 0) {
      const side = support === 0 ? 1 : -1;
      const sx = o.x + s * (support === 0 ? 7 : -2);
      const sz = o.z + side * (Math.abs(o.z) > 20 ? -Math.sign(o.z) * side * 11 : 11);
      tx = tx * 0.4 + sx * 0.6;
      tz = tz * 0.4 + sz * 0.6;
    }
    // Forwards: run in behind when the carrier can see the pass, else hold the line.
    if (fwd) {
      const until = this.runUntil.get(p.i) ?? 0;
      const carrierLooking = this.rel(Math.cos(o.face)) > 0.2 && this.rel(o.x) > -20;
      if (m.time > until && carrierLooking && this.rel(p.x) < line - 0.3 && m.rand() < 0.012) this.runUntil.set(p.i, m.time + 2.2);
      if (m.time < (this.runUntil.get(p.i) ?? 0)) {
        tx = (line + 14) * s;
        tz = p.z * 0.7 + (p.role === 'ST' ? 0 : Math.sign(p.z) * 8) * 0.3;
        sprint = true;
      } else if (this.rel(tx) > line - 0.6) tx = (line - 0.8) * s;
    } else if (this.rel(tx) > line - 0.6) tx = (line - 0.8) * s;
    // Spread out from teammates a little.
    for (const q of m.teamPlayers(this.team)) {
      if (q === p) continue;
      const d = Math.hypot(q.x - tx, q.z - tz);
      if (d < 6 && d > 0.01) {
        tx += ((tx - q.x) / d) * (6 - d) * 0.4;
        tz += ((tz - q.z) / d) * (6 - d) * 0.4;
      }
    }
    if (Math.hypot(tx - p.x, tz - p.z) > 10) sprint = true;
    return [tx, tz, sprint];
  }

  private defend(p: Pl, o: Pl, tx: number, tz: number, role: number): [number, number, boolean] {
    const m = this.m;
    const gx = m.ownGoalX(this.team);
    const sk = this.skill;
    const d = Math.hypot(o.x - p.x, o.z - p.z);
    if (role === 1) {
      // Press: goal-side of the carrier, then tackle.
      const gd = Math.hypot(gx - o.x, o.z) || 1;
      const off = d > 3 ? 1.8 : 1.25;
      tx = o.x + ((gx - o.x) / gd) * off + o.vx * 0.25;
      tz = o.z + ((0 - o.z) / gd) * off + o.vz * 0.25;
      if (p.state === 'run' && d < 1.45) {
        const facing = Math.cos(p.face) * (o.x - p.x) - Math.sin(p.face) * (o.z - p.z);
        if (facing > 0.2 && m.rand() < (0.9 + sk * 2.4) * TICK_S) m.standingTackle(p);
      }
      // A last-ditch slide when he's getting away near our box.
      if (p.state === 'run' && d > 1.5 && d < 3 && Math.abs(o.x - gx) < 30 && this.rel(o.x - p.x) < 0.5 && Math.hypot(o.vx, o.vz) > 5 && m.rand() < 0.3 * TICK_S * sk) {
        p.face = Math.atan2(-(o.z + o.vz * 0.3 - p.z), o.x + o.vx * 0.3 - p.x);
        m.slideTackle(p);
      }
      return [tx, tz, d > 2.5];
    }
    if (role === 2) {
      // Cut the nearest passing lane.
      const opts = m.teamPlayers(o.team).filter((q) => q !== o && q.role !== 'GK');
      const tgt = opts.sort((a, c) => Math.hypot(a.x - o.x, a.z - o.z) - Math.hypot(c.x - o.x, c.z - o.z))[0];
      if (tgt) {
        tx = (o.x + tgt.x) / 2;
        tz = (o.z + tgt.z) / 2;
        return [tx, tz, Math.hypot(tx - p.x, tz - p.z) > 5];
      }
    }
    // Mark: the nearest attacker in your zone, goal-side.
    if (['CB', 'LB', 'RB', 'CDM', 'CM'].includes(p.role)) {
      let mark: Pl | null = null;
      let md = 11;
      for (const q of m.teamPlayers(o.team)) {
        if (q === o || q.role === 'GK') continue;
        const dd = Math.hypot(q.x - tx, q.z - tz);
        if (dd < md) {
          md = dd;
          mark = q;
        }
      }
      if (mark) {
        const gd = Math.hypot(gx - mark.x, mark.z) || 1;
        const mx = mark.x + ((gx - mark.x) / gd) * 1.8;
        const mz = mark.z + ((0 - mark.z) / gd) * 1.8;
        const w = Math.abs(mark.x - gx) < 30 ? 0.75 : 0.45;
        tx = tx * (1 - w) + mx * w;
        tz = tz * (1 - w) + mz * w;
      }
    }
    // Never deeper than needed, never behind the keeper.
    if (Math.abs(tx - gx) < 3) tx = gx + Math.sign(-gx) * 3;
    return [tx, tz, Math.hypot(tx - p.x, tz - p.z) > 6];
  }

  // ---------------------------------------------------------------- set pieces

  takeRestart(taker: Pl, r: Restart): void {
    const m = this.m;
    const s = this.s;
    const gx = s * PITCH.HL;
    const mates = m.teamPlayers(this.team).filter((q) => q !== taker && q.role !== 'GK');
    const nearestOpen = (maxD: number) => {
      let best: Pl | null = null;
      let bs = -Infinity;
      for (const q of mates) {
        const d = Math.hypot(q.x - r.x, q.z - r.z);
        if (d > maxD || d < 3) continue;
        const sc = this.openness(q) * 1.5 - this.laneBlocked(r.x, r.z, q.x, q.z) * 6 - d * 0.1 + this.rel(q.x - r.x) * 0.1 + m.rand();
        if (sc > bs) {
          bs = sc;
          best = q;
        }
      }
      return best;
    };
    switch (r.kind) {
      case 'kickoff': {
        const q = mates.filter((p) => this.rel(p.x) < 0).sort((a, c) => Math.hypot(a.x, a.z) - Math.hypot(c.x, c.z))[0]!;
        m.startKick(taker, 'pass', 0.25, q.x - taker.x, q.z - taker.z);
        return;
      }
      case 'throw': {
        const q = nearestOpen(20) ?? mates[0]!;
        m.startKick(taker, 'throw', 0.4, q.x - taker.x, q.z - taker.z);
        return;
      }
      case 'corner': {
        if (m.rand() < 0.15) {
          const q = nearestOpen(16);
          if (q) return m.startKick(taker, 'pass', 0.3, q.x - taker.x, q.z - taker.z);
        }
        m.startKick(taker, 'cross', 0.7, -s, -Math.sign(r.z));
        return;
      }
      case 'goalkick': {
        const q = nearestOpen(30);
        if (q && m.rand() < 0.6) m.startKick(taker, 'pass', 0.45, q.x - taker.x, q.z - taker.z);
        else {
          const t = mates.filter((p) => ['ST', 'LW', 'RW', 'CAM', 'LM', 'RM'].includes(p.role))[(m.rand() * 3) | 0] ?? mates[0]!;
          m.startKick(taker, 'lob', 0.85, t.x - taker.x, t.z - taker.z);
        }
        return;
      }
      case 'penalty': {
        const side = m.rand() < 0.5 ? -1 : 1;
        m.startKick(taker, 'penalty', 0.55 + m.rand() * 0.3, s, side * (0.6 + m.rand() * 0.3));
        return;
      }
      case 'free': {
        const dist = Math.hypot(gx - r.x, r.z);
        if (dist < 30 && Math.abs(r.z) < 22 && m.rand() < 0.75) {
          const side = m.gkOf((1 - this.team) as 0 | 1).z > 0 ? -1 : 1;
          m.startKick(taker, 'finesse', clamp(0.5 + dist * 0.01, 0.5, 0.8), s * 0.3, side * 0.8);
          return;
        }
        if (dist < 40 && Math.abs(r.z) > 18) {
          m.startKick(taker, 'cross', 0.7, s, -Math.sign(r.z));
          return;
        }
        const q = nearestOpen(35) ?? mates[0]!;
        m.startKick(taker, 'pass', 0.45, q.x - taker.x, q.z - taker.z);
      }
    }
  }
}

const TICK_S = 1 / 60;
function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}
