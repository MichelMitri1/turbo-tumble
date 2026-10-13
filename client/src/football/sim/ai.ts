import type { KickType, MatchSim, Pl, Restart } from './match';
import { BOUNCE_KEEP, PITCH, ROLL_A, ROLL_B } from './match';

/**
 * Team AI: shape, pressing, marking, support runs and the ball carrier's decisions.
 * It only writes intents (tx / tz / tSprint) and calls the sim's actions, so the same
 * brain drives CPU teams, a human's teammates and both sides of a headless test.
 */

const G = 9.81;

export class TeamAI {
  private think = new Map<number, number>();
  private nextRead = new Map<number, number>();
  private nextTackle = new Map<number, number>();
  private styles = new Map<number, { carry: number; forward: number; side: number; spacing: number }>();
  private approach: 'balanced' | 'wide' | 'direct' = 'balanced';
  private approachUntil = 0;
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
  private get profile() {
    return this.m.botProfile(this.team);
  }
  /** Decision quality 0…1, independent of the footballer's physical rating. */
  private get skill(): number {
    return this.profile.skill;
  }
  private style(p: Pl) {
    let style = this.styles.get(p.i);
    if (!style) {
      style = { carry: (this.m.rand() - 0.5) * 4, forward: 0.26 + this.m.rand() * 0.18, side: this.m.rand() < 0.5 ? -1 : 1, spacing: this.m.rand() * 0.5 };
      this.styles.set(p.i, style);
    }
    return style;
  }
  private rel(x: number): number {
    return x * this.s;
  }

  update(dt: number): void {
    const m = this.m;
    const mine = m.teamPlayers(this.team);
    if (m.phase !== 'play') {
      this.nextRead.clear();
      for (const p of mine) {
        p.look = false;
        if (m.phase === 'goal' || m.phase === 'var') {
          this.celebrate(p);
          continue;
        }
        // Set pieces and kick-offs: hold the spot you were given.
        if (p.human >= 0) continue;
        p.tx = p.x;
        p.tz = p.z;
        p.tSprint = false;
      }
      return;
    }
    const b = m.ball;
    const o = m.owner();
    if (m.time >= this.approachUntil) {
      const r = m.rand();
      this.approach = r < 0.34 ? 'balanced' : r < 0.67 ? 'wide' : 'direct';
      this.approachUntil = m.time + 10 + m.rand() * 12;
    }
    if (b.owner !== this.lastOwner) {
      if (o) this.gotBallAt.set(o.i, m.time);
      this.lastOwner = b.owner;
    }
    this.predict();
    const attacking = o ? o.team === this.team : b.lastTeam === this.team && b.kickType !== null;
    // Loose ball: who gets there first?
    let chaser: Pl | null = null;
    let second: Pl | null = null;
    /** Their pass on its way: the man it's meant for (we defend him as if he had it) and who of ours can cut it out. */
    let target: Pl | null = null;
    const cutters: Pl[] = [];
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
      const react = this.profile.reaction;
      if (b.lastTeam !== this.team && b.kickType && m.time - b.kickAt < react && chaser?.role !== 'GK') chaser = second = null;
      if (b.lastTeam !== this.team && b.kickType && lp && lp.team !== this.team && b.kickId === lp.id && lp.to >= 0) {
        target = m.players[lp.to]!;
        if (target.state === 'off') target = null;
      }
      if (b.lastTeam !== this.team && b.kickType && m.time - b.kickAt >= react) {
        // Reading their ball: anyone of ours who gets to its path before their man does steps in and takes it.
        let theirT = Infinity;
        for (const q of m.teamPlayers((1 - this.team) as 0 | 1)) if (q.state === 'run' || q.state === 'hold') theirT = Math.min(theirT, this.reachTime(q).t);
        for (const { p, t } of ranked) {
          if (cutters.length >= 2) break;
          if (p.role === 'GK' || p.human >= 0 || p.state !== 'run') continue;
          if (t.t < theirT + 0.05 + this.skill * 0.1) cutters.push(p);
        }
      }
      if (lp && lp.team === this.team && b.kickId === lp.id && lp.to >= 0) {
        // Our pass is travelling: only its receiver goes for it (nobody nicks it off him —
        // and if a human is steering the receiver, it's entirely up to them).
        const r = m.players[lp.to]!;
        chaser = r.state === 'run' ? r : null;
        second = null;
      } else if (m.humans.some((h) => h.team === this.team)) {
        // A human controls the player nearest the ball: AI team-mates don't race them for it —
        // unless one of them is clearly going to get there first (a second ball, a loose touch).
        const humanT = Math.min(...mine.filter((p) => p.human >= 0).map((p) => this.reachTime(p).t));
        const ai = chaser && chaser.human < 0 && chaser.role !== 'GK' ? chaser : null;
        // (Their pass coming through our zone: the man in its path steps in and cuts it out.)
        const cutOut = ai && (cutters.includes(ai) || (b.lastTeam !== this.team && b.kickType !== null && this.reachTime(ai).t < 0.9));
        chaser = gkFirst ?? (ai && (cutOut || this.reachTime(ai).t < humanT - 0.4) ? ai : null);
        second = null;
      }
    }
    // Who we're defending against: their carrier, or the man their pass is going to.
    const threat = o && o.team !== this.team ? o : target;
    const free = mine.filter((p) => !cutters.includes(p) && p !== chaser);
    // Engaging him: the nearest man who is (or can get) goal-side — an AI team-mate steps up if the human's player is out of it.
    let presser = threat ? this.engager(free, threat) : null;
    if (presser && presser.human >= 0 && threat && Math.hypot(presser.x - threat.x, presser.z - threat.z) > 7) presser = this.engager(free.filter((p) => p.human < 0), threat);
    const presser2 = presser && threat ? this.engager(free.filter((p) => p !== presser && p.human < 0), threat) : null;
    if (threat) this.assignMarks(free, threat, new Set([presser, presser2].filter((p): p is Pl => !!p)));
    // He's beaten our first man near the box: the cover steps up to engage too (no standing off).
    let lastDitch = false;
    if (threat && presser && presser2) {
      const gx = m.ownGoalX(this.team);
      const gd = Math.hypot(gx - threat.x, threat.z) || 1;
      const goalSide = ((presser.x - threat.x) * (gx - threat.x) + (presser.z - threat.z) * -threat.z) / gd;
      lastDitch = gd < 30 && goalSide < -0.4 && Math.hypot(presser.x - threat.x, presser.z - threat.z) > 1.3;
    }
    // R1 held: the second man goes and presses the carrier too.
    const doublePress = m.teamPress[this.team] > m.time;
    const supporters = o && o.team === this.team ? this.supporters(mine, o) : [];

    for (const p of mine) {
      if (p.human >= 0 || p.state === 'off') continue;
      if (p.role === 'GK') {
        p.look = false;
        this.keeper(p, chaser === p);
        continue;
      }
      if (o === p) {
        p.look = false;
        this.carrier(p, dt);
        continue;
      }
      // Hold the last read between decisions. A change of direction can wrong-foot
      // an easier defender instead of every CPU matching the stick every frame.
      const receiver = !o && m.lastPass?.team === this.team && m.lastPass.to === p.i && b.kickId === m.lastPass.id;
      if (!receiver && m.time < (this.nextRead.get(p.i) ?? 0)) continue;
      this.nextRead.set(p.i, m.time + this.profile.decision * (0.8 + m.rand() * 0.4));
      p.look = false;
      let [tx, tz] = m.formationSpot(p, b.x, b.z, attacking);
      let sprint = false;
      const role = p === presser || (p === presser2 && (doublePress || lastDitch)) ? 1 : p === presser2 ? 2 : 0;
      if (!o) {
        if (p === chaser || cutters.includes(p) || (p === second && this.reachTime(p).t < 1.2)) {
          const r = this.reachTime(p);
          tx = r.x;
          tz = r.z;
          sprint = true;
          this.header(p);
        } else if (threat) [tx, tz, sprint] = this.defend(p, threat, tx, tz, role);
      } else if (o.team === this.team) {
        [tx, tz, sprint] = this.offBall(p, o, tx, tz, supporters.indexOf(p));
      } else {
        [tx, tz, sprint] = this.defend(p, o, tx, tz, role);
      }
      if (threat) {
        tx += (m.rand() - 0.5) * this.profile.positionError * 2;
        tz += (m.rand() - 0.5) * this.profile.positionError * 2;
      }
      p.tx = clamp(tx, -PITCH.HL + 0.5, PITCH.HL - 0.5);
      p.tz = clamp(tz, -PITCH.HW + 0.5, PITCH.HW - 0.5);
      p.tSprint = sprint;
    }
  }

  // ---------------------------------------------------------------- goal celebrations

  /** After a goal: the scorer wheels away, his team-mates mob him, the other side trudge back. */
  private celebrate(p: Pl): void {
    const m = this.m;
    const last = m.goals[m.goals.length - 1];
    const scorer = m.players.find((q) => q.state === 'celebrate') ?? null;
    p.tSprint = false;
    if (p === scorer) {
      // Off towards the corner flag and the fans on that side.
      const end = Math.sign(m.ball.x) || 1;
      p.tx = end * (PITCH.HL - 4);
      p.tz = (Math.sign(p.z) || 1) * (PITCH.HW - 2.5);
      p.tSprint = true;
      return;
    }
    if (last && p.team === last.team && scorer && p.role !== 'GK' && Math.hypot(scorer.x - p.x, scorer.z - p.z) < 48) {
      // Pile on: everyone races to the scorer (they arrive as he finishes the slide).
      const a = p.slot * 2.3;
      p.tx = scorer.x + Math.cos(a) * 1.1;
      p.tz = scorer.z + Math.sin(a) * 1.1;
      p.tSprint = Math.hypot(p.tx - p.x, p.tz - p.z) > 3;
      return;
    }
    if (p.role === 'GK') {
      p.tx = p.x;
      p.tz = p.z;
      return;
    }
    // Walk back for the restart.
    const [fx, fz] = m.formationSpot(p, 0, 0, false);
    p.tx = p.x + (fx - p.x) * 0.5;
    p.tz = p.z + (fz - p.z) * 0.5;
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
          const k = Math.max(0, hv - (ROLL_A + ROLL_B * hv + 0.0133 * hv * hv) * h) / hv;
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
        vx *= BOUNCE_KEEP;
        vz *= BOUNCE_KEEP;
      }
    }
  }

  /** Re-read the ball's flight now (right after a kick, before this tick's update). */
  refreshPath(): void {
    this.predict();
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

  /** The man to engage a carrier: near him, and preferably already between him and our goal. */
  private engager(ps: Pl[], o: Pl): Pl | null {
    const gx = this.m.ownGoalX(this.team);
    const gd = Math.hypot(gx - o.x, o.z) || 1;
    let best: Pl | null = null;
    let bs = Infinity;
    for (const p of ps) {
      if (p.role === 'GK' || p.state === 'down' || p.state === 'off') continue;
      const d = Math.hypot(p.x - o.x, p.z - o.z);
      const goalSide = ((p.x - o.x) * (gx - o.x) + (p.z - o.z) * -o.z) / gd;
      const sc = d + (goalSide < -1 ? Math.min(6, -goalSide * 0.8) : 0);
      if (sc < bs) {
        bs = sc;
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
    // Back to goal with it dropping at chest height in the box: the overhead kick.
    const backToGoal = this.rel(Math.cos(p.face)) < -0.3;
    const bike = att && backToGoal && b.y > 1.2 && b.y < 2.1 && p.def.stats.sho > 72 && this.m.rand() < 0.35;
    this.m.startKick(p, bike ? 'bicycle' : 'header', 0.6, att ? s : s * 0.8, att ? -p.z * 0.05 : p.z > 0 ? 0.5 : -0.5, true);
  }

  // ---------------------------------------------------------------- keeper

  private keeper(gk: Pl, chase: boolean): void {
    const m = this.m;
    const b = m.ball;
    const gx = m.ownGoalX(this.team);
    const s = Math.sign(gx);
    gk.look = false;
    if (gk.state === 'hold') {
      // Walk to the edge of the six-yard box while looking for a pass.
      gk.tx = gx - s * 6;
      gk.tz = gk.z * 0.9;
      gk.tSprint = false;
      return;
    }
    const o = m.owner();
    const theirs = o && o.team !== this.team;
    // From the ball to the middle of the goal.
    const bd = Math.hypot(gx - b.x, b.z) || 1;
    const ux = (gx - b.x) / bd;
    const uz = -b.z / bd;
    // △ held: come off the line straight at the ball, along its line to goal (always goal-side of it).
    if (m.gkRush[this.team] > m.time && (theirs || (!o && b.lastTeam !== this.team))) {
      const r = o ? null : this.reachTime(gk);
      const px = r ? r.x : b.x + (o?.vx ?? 0) * 0.2;
      const pz = r ? r.z : b.z + (o?.vz ?? 0) * 0.2;
      gk.tx = px + ux * 0.9;
      gk.tz = pz + uz * 0.9;
      gk.tSprint = true;
      gk.look = true;
      return;
    }
    // Reading a shot comes first: set, and shuffle across into its line (small quick steps) —
    // never chase a shot as if it were a loose ball.
    const tr0 = m.gkTrack[this.team];
    if (tr0 && tr0.until > m.time) {
      gk.look = true;
      gk.tx = gk.x;
      gk.tz = clamp(tr0.z, -PITCH.GOAL_HW - 0.4, PITCH.GOAL_HW + 0.4);
      gk.tSprint = Math.abs(tr0.z - gk.z) > 1.5;
      return;
    }
    const inBox = (x: number, z: number, m0 = 0) => Math.abs(x - gx) < PITCH.BOX_D - m0 && Math.abs(z) < PITCH.BOX_HW - m0;
    // A loose ball he's first to: claim it — but only where a keeper should (his area; crosses into the six-yard zone).
    if (!o && chase) {
      const r = this.reachTime(gk);
      const high = this.path.some(([t, , y]) => t <= r.t && y > 1.9);
      // A cross: only come if he gets there before any of them can head it (else stay and set).
      let first = true;
      if (high) {
        const headT = m.teamPlayers((1 - this.team) as 0 | 1).reduce((best, q) => {
          const top = 7.6 + q.def.stats.pac * 0.028;
          for (const [t, x, y, z] of this.path) {
            if (y < 1.1 || y > 2.6) continue;
            if (Math.max(0, Math.hypot(x - q.x, z - q.z) - 0.8) / top + 0.2 <= t) return Math.min(best, t);
          }
          return best;
        }, Infinity);
        first = r.t + 0.25 < headT;
      }
      const claim = high ? first && Math.abs(r.x - gx) < 8 && Math.abs(r.z) < PITCH.SIX_HW : inBox(r.x, r.z, 1.5);
      if (claim) {
        gk.tx = r.x;
        gk.tz = r.z;
        gk.tSprint = true;
        return;
      }
    }
    // Sweeper: a ball through for their runner that he'll clearly win, just outside the box at most.
    if (!o && b.lastTeam !== this.team && this.rel(b.vx) < -4) {
      const r = this.reachTime(gk);
      if (Math.abs(r.x - gx) < PITCH.BOX_D + 3 && Math.abs(r.z) < PITCH.BOX_HW) {
        const theirT = m.teamPlayers((1 - this.team) as 0 | 1).reduce((t, q) => Math.min(t, this.reachTime(q).t), Infinity);
        if (r.t + 0.6 < theirT) {
          gk.tx = r.x;
          gk.tz = r.z;
          gk.tSprint = true;
          return;
        }
      }
    }
    gk.look = true;
    // Reading a shot: shuffle across into its line (set, small quick steps).
    const tr = m.gkTrack[this.team];
    if (tr && tr.until > m.time) {
      gk.tx = gk.x;
      gk.tz = clamp(tr.z, -PITCH.GOAL_HW - 0.4, PITCH.GOAL_HW + 0.4);
      gk.tSprint = Math.abs(tr.z - gk.z) > 1.5;
      return;
    }
    const bx = o ? b.x + o.vx * 0.15 : b.x;
    const bz = o ? b.z + o.vz * 0.15 : b.z;
    const dist = Math.hypot(bx - gx, bz);
    // Clean through on goal (nobody of ours between him and the goal): come out to narrow the angle.
    if (theirs && dist < 18 && Math.abs(o!.z) < 14 && this.rel(o!.vx) < 1) {
      const covered = m.teamPlayers(this.team).some((q) => {
        if (q === gk) return false;
        const along = (q.x - o!.x) * ux + (q.z - o!.z) * uz;
        const across = Math.abs((q.x - o!.x) * -uz + (q.z - o!.z) * ux);
        return along > -0.5 && along < dist && across < 3.5;
      });
      if (!covered) {
        const out = clamp(dist - Math.max(2.4, dist * 0.55), 1.2, 7);
        gk.tx = gx - ux * out;
        gk.tz = clamp(-uz * out, -PITCH.GOAL_HW, PITCH.GOAL_HW);
        gk.tSprint = Math.hypot(gk.tx - gk.x, gk.tz - gk.z) > 2;
        return;
      }
    }
    // Angle play: on the bisector of the posts as seen from the ball, a little further off the
    // line the further away the ball is (never wandering: a few metres at most).
    const ax = gx - bx;
    const l1 = Math.hypot(ax, -PITCH.GOAL_HW - bz) || 1;
    const l2 = Math.hypot(ax, PITCH.GOAL_HW - bz) || 1;
    let vx = ax / l1 + ax / l2;
    let vz = (-PITCH.GOAL_HW - bz) / l1 + (PITCH.GOAL_HW - bz) / l2;
    const vl = Math.hypot(vx, vz) || 1;
    vx /= vl;
    vz /= vl;
    const qz = Math.abs(vx) > 1e-3 ? bz + (vz / vx) * ax : 0;
    const frontal = Math.abs(ax) / (dist || 1);
    let out = (dist < 12 ? 1.0 : dist < 40 ? 1.0 + (dist - 12) * 0.1 : Math.min(6, 3.8 + (dist - 40) * 0.07)) * (0.45 + 0.55 * frontal);
    let tz = qz - vz * out;
    // Wide, near the byline: a cross is coming — hold the middle of the goal, slightly to the near post.
    if (Math.abs(bz) > PITCH.GOAL_HW + 5 && Math.abs(ax) < 20) {
      tz = Math.sign(bz) * 1.0;
      out = 1.2;
    }
    gk.tx = gx - s * Math.max(0.5, Math.abs(vx) * out);
    gk.tz = clamp(tz, -PITCH.GOAL_HW + 0.3, PITCH.GOAL_HW - 0.3);
    gk.tSprint = Math.hypot(gk.tx - gk.x, gk.tz - gk.z) > 5;
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
      m.startKick(gk, gk.state === 'hold' ? 'gkThrow' : 'pass', 0.4, best.x - gk.x, best.z - gk.z);
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
    if (p.role === 'GK') {
      // Ball at the keeper's feet: no dribbling, get it away (to a free man or long).
      p.tx = p.x;
      p.tz = p.z;
      p.tSprint = false;
      if (p.state === 'run' && m.time - (this.gotBallAt.get(p.i) ?? m.time) > 0.35 + m.rand() * 0.3) this.distribute(p);
      return;
    }
    const s = this.s;
    const gx = s * PITCH.HL;
    const sk = this.skill;
    const style = this.style(p);
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
    if (relX < PITCH.HL - 25) dz = p.z * 0.1;
    if (this.approach === 'wide' && relX < PITCH.HL - 16) dz += (Math.sign(p.z) || style.side) * 8;
    if (this.approach === 'direct') dz -= p.z * 0.25;
    if (ahead && aheadD < 7) {
      const side = Math.sign(p.z - ahead.z) || style.side;
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
    if (held < this.profile.reaction && press > 1.5) t = Math.max(t, 0.01);
    this.think.set(p.i, t);
    if (t > 0) return;
    this.think.set(p.i, this.profile.decision * (0.8 + m.rand() * 0.4));

    // ---- A skill move to beat the man right in front of him (good dribblers only).
    if (ahead && aheadD < 2.8 && aheadD > 1.2 && p.def.stats.dri > 76 && m.rand() < 0.1 * sk) {
      const r = m.rand();
      m.doTrick(p, r < 0.45 ? 3 : r < 0.75 ? 6 : r < 0.9 ? 7 : 4, 0, Math.sign(p.z - ahead.z) || 1);
      return;
    }

    // ---- Shoot?
    const gk = m.gkOf((1 - this.team) as 0 | 1);
    const angleOk = Math.abs(p.z) < (PITCH.HL - relX) * 1.4 + 3;
    const range = 13 + p.def.stats.sho * 0.15;
    if (relX > 0 && distGoal < range && angleOk) {
      // Far side of the keeper, towards a corner (better finishers go closer to the post).
      // Close in, under pressure, it's snatched at more often than placed.
      const aimZ = (gk.z > p.z * 0.15 ? -1 : 1) * (distGoal < 11 ? 1.2 + m.rand() * 1.8 : 2.2 + m.rand() * 0.6 + sk * 0.35);
      const blocked = this.laneBlocked(p.x, p.z, gx, aimZ * 0.8);
      const want = (distGoal < 12 ? 0.9 : distGoal < 18 ? 0.55 : 0.25) * (blocked > 1 ? 0.3 : 1) + (press < 2 ? 0.15 : 0);
      if (m.rand() < want) {
        const finesse = distGoal > 13 && distGoal < 24 && m.rand() < 0.45;
        const chip = gk.state === 'run' && Math.abs(this.rel(gk.x)) < PITCH.HL - 6 && distGoal < 16 && m.rand() < 0.4;
        // A big hitter with a yard of space from range: lace it.
        if (!chip && distGoal > 16 && distGoal < 28 && press > 2.5 && p.def.stats.sho > 74 && m.rand() < 0.3) {
          this.kick(p, 'power', clamp(0.7 + m.rand() * 0.25, 0, 1), s * 0.3, aimZ / 3.6);
          return;
        }
        const power = clamp(0.45 + distGoal * 0.016 + (m.rand() - 0.5) * 0.12 * (1.2 - sk), 0.4, 0.9);
        const z = aimZ / 3.6;
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
      const progress = style.forward + (this.approach === 'direct' ? 0.12 : 0);
      const width = this.approach === 'wide' ? Math.abs(q.z) * 0.13 : 0;
      let score = gain * progress + Math.min(free, 8) * 1.1 - lane * 7 - d * 0.06 + width;
      // Lofted for long switches when the ground is blocked.
      if (lane > 0.6 && d > 22) {
        const l2 = this.laneBlocked(p.x, p.z, q.x, q.z, true);
        if (l2 < lane) {
          type = 'lob';
          score = gain * progress + Math.min(free, 8) * 1.1 - l2 * 6 - d * 0.1 - 1.5 + width;
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
    const keep = Math.min(aheadD, 10) * 0.9 + (relX > PITCH.HL - 30 ? 2 : 0) + (p.def.stats.dri - 75) * 0.05 - (press < 1.6 ? 6 : 0) + style.carry;
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
      const runRate = (this.approach === 'direct' ? 1.2 : 0.65) * (0.45 + this.skill * 0.55);
      if (m.time > until && carrierLooking && this.rel(p.x) < line - 0.3 && m.rand() < 1 - Math.exp(-runRate * this.profile.decision)) this.runUntil.set(p.i, m.time + 1.5 + m.rand() * 1.4);
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

  /**
   * Out of possession. role 1: engage the carrier (close down, jockey goal-side, time the tackle);
   * role 2: cover behind the engaging man / block the shooting lane; 0: mark your man or hold the line.
   */
  private defend(p: Pl, o: Pl, tx: number, tz: number, role: number): [number, number, boolean] {
    const m = this.m;
    const b = m.ball;
    const gx = m.ownGoalX(this.team);
    const sk = this.skill;
    const profile = this.profile;
    const style = this.style(p);
    const d = Math.hypot(o.x - p.x, o.z - p.z);
    // From the carrier to the middle of our goal.
    const gd = Math.hypot(gx - o.x, o.z) || 1;
    const ux = (gx - o.x) / gd;
    const uz = -o.z / gd;
    // Am I goal-side of him (between him and our goal)?
    const goalSide = (p.x - o.x) * ux + (p.z - o.z) * uz;
    if (role === 1) {
      if (goalSide < -0.4 && d > 1.3) {
        // Beaten: recovery run, back on the line between him and the goal, ahead of him.
        const towardsGoal = o.vx * ux + o.vz * uz;
        const lead = Math.min(4, 1.6 + Math.max(0, towardsGoal) * 0.25);
        return [o.x + ux * lead + (o.vx - ux * towardsGoal) * 0.2,
          o.z + uz * lead + (o.vz - uz * towardsGoal) * 0.2, true];
      }
      // Close down quickly, then hold a jockeying distance goal-side of the ball and match his moves.
      const stand = (d > 5 ? 0.6 : gd < 22 ? 0.7 : 0.85) + profile.markingGap + style.spacing;
      const anticipate = 0.06 + sk * 0.14;
      // Read lateral cuts, but meet a forward dribble instead of continually
      // moving the target further towards our own goal as the attacker speeds up.
      const towardsGoal = o.vx * ux + o.vz * uz;
      const lead = Math.min(0.25, Math.max(0, towardsGoal) * anticipate * 0.2);
      tx = b.x + ux * (stand + lead) + (o.vx - ux * towardsGoal) * anticipate;
      tz = b.z + uz * (stand + lead) + (o.vz - uz * towardsGoal) * anticipate;
      p.look = d < 5;
      if (p.state === 'run' && b.owner === o.i && m.time >= (this.nextTackle.get(p.i) ?? 0)) {
        const fx = Math.cos(p.face);
        const fz = -Math.sin(p.face);
        const dBall = Math.hypot(b.x - (p.x + fx * 0.6), b.z - (p.z + fz * 0.6));
        // The ball's away from his feet (a heavy touch, a sprint) and in front of me: go in now.
        const exposed = Math.hypot(b.x - o.x, b.z - o.z) > 0.62;
        // Chasing from behind in and around our box: stay on your feet and don't dive in (that's a penalty).
        const behind = goalSide < 0.2 && gd < 26;
        // Probability over this decision interval, rather than a fresh attempt every frame.
        const rate = (exposed ? 8 : 1.4) * profile.tackleRate * (behind ? 0.15 : 1);
        const chance = dBall < 1.25 ? 1 - Math.exp(-rate * profile.decision) : 0;
        if (m.rand() < chance) {
          m.standingTackle(p);
          this.nextTackle.set(p.i, m.time + profile.tackleCooldown * (0.85 + m.rand() * 0.3));
        }
        // A last-ditch slide when he's getting away — outside the box, from the side or in front.
        else if (!behind && d > 1.6 && d < 3 && gd < 30 && gd > 19 && Math.hypot(o.vx, o.vz) > 5 && m.rand() < 1 - Math.exp(-0.35 * profile.tackleRate * profile.decision)) {
          p.face = Math.atan2(-(b.z + o.vz * 0.25 - p.z), b.x + o.vx * 0.25 - p.x);
          m.slideTackle(p);
          this.nextTackle.set(p.i, m.time + profile.tackleCooldown);
        }
      }
      return [tx, tz, d > 2.2 + profile.markingGap];
    }
    if (role === 2) {
      // Cover: a few metres behind the man engaging, on the line to goal — right in the shooting lane near our box.
      const back = (gd < 28 ? 2.8 : 4.5) + profile.markingGap;
      const towardsGoal = o.vx * ux + o.vz * uz;
      tx = o.x + ux * back + (o.vx - ux * towardsGoal) * 0.2;
      tz = o.z + uz * back + (o.vz - uz * towardsGoal) * 0.2;
      p.look = gd < 28;
      return [tx, tz, Math.hypot(tx - p.x, tz - p.z) > 3];
    }
    // Your man: stay goal-side and touch-tight around our box, looser further out.
    const mark = this.marks.get(p.i);
    if (mark) {
      const md = Math.hypot(gx - mark.x, mark.z) || 1;
      const close = (md < 30 ? 1.2 : 2.2) + profile.markingGap;
      // Goal-side, and a step towards the ball to sit in the passing lane.
      const bd = Math.hypot(b.x - mark.x, b.z - mark.z) || 1;
      const lane = Math.min(1.4, bd * 0.08);
      const mx = mark.x + ((gx - mark.x) / md) * close + ((b.x - mark.x) / bd) * lane + mark.vx * 0.25;
      const mz = mark.z + (-mark.z / md) * close + ((b.z - mark.z) / bd) * lane + mark.vz * 0.25;
      const w = (md < 34 ? 0.9 : md < 50 ? 0.65 : 0.4) * (0.45 + sk * 0.55);
      tx = tx * (1 - w) + mx * w;
      tz = tz * (1 - w) + mz * w;
      p.look = Math.hypot(mx - p.x, mz - p.z) < 3;
      // A stationary striker beyond the line does not drag the entire defence
      // backwards. A runner heading towards our goal, or a live penalty-area
      // attack, does need to be covered behind that line.
      const runner = this.rel(mark.vx) < -2.5;
      const nearBox = this.rel(b.x) < -PITCH.HL + PITCH.BOX_D + 5;
      if (!runner && !nearBox && ['CB', 'LB', 'RB'].includes(p.role)) {
        tx = Math.max(this.rel(tx), m.defensiveLine(this.team, b.x) - 2) * this.s;
      }
      // Losing his runner: get back at full speed.
      if (Math.hypot(mx - p.x, mz - p.z) > 2.5 && this.rel(mark.vx) < -3) return [tx, tz, true];
    }
    // Never deeper than needed, never behind the keeper.
    if (Math.abs(tx - gx) < 3) tx = gx + Math.sign(-gx) * 3;
    return [tx, tz, Math.hypot(tx - p.x, tz - p.z) > 4];
  }

  /** Who marks whom: the most dangerous attackers first, each to the nearest free defender. */
  private marks = new Map<number, Pl>();
  private assignMarks(mine: Pl[], o: Pl, skip: Set<Pl>): void {
    this.marks.clear();
    const m = this.m;
    const gx = m.ownGoalX(this.team);
    const attackers = m
      .teamPlayers(o.team)
      .filter((q) => q !== o && q.role !== 'GK' && Math.abs(q.x - gx) < 60)
      .sort((a, c) => Math.hypot(a.x - gx, a.z) - Math.hypot(c.x - gx, c.z));
    const free = mine.filter((p) => p.role !== 'GK' && p.human < 0 && !skip.has(p) && p.state !== 'off');
    for (const q of attackers) {
      let best: Pl | null = null;
      let bd = 18;
      for (const p of free) {
        // Defenders prefer men in their own zone (their formation spot), not miles away.
        const [fx, fz] = m.formationSpot(p, m.ball.x, m.ball.z, false);
        const dd = Math.hypot(q.x - fx, q.z - fz) * 0.6 + Math.hypot(q.x - p.x, q.z - p.z) * 0.4;
        if (dd < bd) {
          bd = dd;
          best = p;
        }
      }
      if (!best) continue;
      this.marks.set(best.i, q);
      free.splice(free.indexOf(best), 1);
    }
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

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}
