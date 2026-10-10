import { Game, type Soldier } from './game';
import { NavGrid } from './nav';
import { NO_INPUT, eyeHeight, type Input } from './player';

export type BotSkill = 'recruit' | 'regular' | 'hardened' | 'veteran';

const SKILL: Record<BotSkill, { react: number; turn: number; error: number; settle: number; fov: number; burst: number; nade: number; strafe: number; head: number }> = {
  recruit: { react: 0.6, turn: 3.2, error: 0.16, settle: 0.6, fov: 1.6, burst: 0.5, nade: 0.02, strafe: 0.3, head: 0 },
  regular: { react: 0.38, turn: 5, error: 0.1, settle: 0.9, fov: 2, burst: 0.7, nade: 0.05, strafe: 0.6, head: 0.15 },
  hardened: { react: 0.24, turn: 7.5, error: 0.065, settle: 1.3, fov: 2.3, burst: 0.85, nade: 0.08, strafe: 0.85, head: 0.35 },
  veteran: { react: 0.16, turn: 10, error: 0.04, settle: 1.8, fov: 2.6, burst: 1, nade: 0.1, strafe: 1, head: 0.55 },
};

interface Brain {
  yaw: number;
  pitch: number;
  /** Aim error (radians) that shrinks while tracking. */
  ex: number;
  ey: number;
  target: string;
  seenFor: number;
  lastSeen: { x: number; y: number; z: number; t: number } | null;
  path: number[];
  pathGoal: number;
  repath: number;
  /** Earliest re-plan for a moved goal (A* every tick for a chased target is the server's biggest cost). */
  pathCd: number;
  goal: { x: number; y: number; z: number } | null;
  goalWhy: string;
  strafe: number;
  strafeT: number;
  crouchT: number;
  stuckT: number;
  lastPos: [number, number];
  think: number;
  nadeCd: number;
  fireHold: number;
  jump: boolean;
}

/** Drives every bot soldier in a Game. */
export class BotBrain {
  readonly nav: NavGrid;
  private brains = new Map<string, Brain>();

  constructor(
    private readonly g: Game,
    public skill: BotSkill = 'regular',
  ) {
    this.nav = new NavGrid(g.level, g.map.half[0], g.map.half[1]);
  }

  update(dt: number, out: Map<string, Input>): void {
    for (const s of this.g.soldiers) {
      if (!s.bot) continue;
      let b = this.brains.get(s.id);
      if (!b) {
        b = { yaw: s.m.yaw, pitch: 0, ex: 0, ey: 0, target: '', seenFor: 0, lastSeen: null, path: [], pathGoal: -1, repath: 0, pathCd: 0, goal: null, goalWhy: '', strafe: 1, strafeT: 0, crouchT: 0, stuckT: 0, lastPos: [s.m.x, s.m.z], think: Math.random() * 0.2, nadeCd: 5 + Math.random() * 10, fireHold: 0, jump: false };
        this.brains.set(s.id, b);
      }
      if (!s.alive) {
        b.path = [];
        b.target = '';
        b.yaw = s.m.yaw;
        out.set(s.id, { ...NO_INPUT, yaw: s.m.yaw });
        continue;
      }
      out.set(s.id, this.think(s, b, dt));
    }
  }

  private think(s: Soldier, b: Brain, dt: number): Input {
    const g = this.g;
    const K = SKILL[this.skill];
    const inp: Input = { ...NO_INPUT, yaw: b.yaw, pitch: b.pitch, slot: -1 };
    const eye = g.eye(s);
    const w = g.weapon(s);
    b.think -= dt;
    b.nadeCd -= dt;
    // Flashed: can't see a thing; stunned: everything is slow.
    const blind = g.time < s.blindT;
    const stunned = g.time < s.stunT;
    // ---------------- perception (every ~0.12 s)
    if (b.think <= 0 && blind) {
      b.think = 0.12;
      b.target = '';
    } else if (b.think <= 0) {
      b.think = 0.12;
      let best: Soldier | null = null;
      let bestD = Infinity;
      for (const e of g.soldiers) {
        if (!e.alive || !g.enemies(s, e)) continue;
        const dx = e.m.x - s.m.x;
        const dz = e.m.z - s.m.z;
        const d = Math.hypot(dx, dz);
        if (d > 90) continue;
        // Field of view (wider up close; anyone shooting nearby gets noticed).
        const ang = Math.abs(wrap(Math.atan2(-dx, -dz) - b.yaw));
        const loud = g.time - e.lastFireT < 0.5 && !e.suppressed && d < 40;
        if (ang > K.fov / 2 + (d < 6 ? 1 : 0) && !loud && b.target !== e.id) continue;
        if (!g.sees(eye[0], eye[1], eye[2], e.m.x, e.m.y + eyeHeight(e.m) - 0.3, e.m.z)) continue;
        const score = d - (e.id === b.target ? 8 : 0);
        if (score < bestD) {
          bestD = score;
          best = e;
        }
      }
      if (best) {
        if (best.id !== b.target) {
          b.target = best.id;
          b.seenFor = 0;
          // Initial aim error grows with distance (a far target is a smaller, harder flick).
          const far = 1 + Math.min(1.5, bestD / 40);
          b.ex = (Math.random() - 0.5) * K.error * 4 * far;
          b.ey = (Math.random() - 0.5) * K.error * 2 * far;
        }
        b.lastSeen = { x: best.m.x, y: best.m.y, z: best.m.z, t: g.time };
      } else if (b.target) {
        b.target = '';
      }
    }
    const target = b.target ? g.soldier(b.target) : undefined;
    // ---------------- combat
    let moveGoal: { x: number; y: number; z: number } | null = null;
    if (target && target.alive) {
      b.seenFor += dt;
      const tx = target.m.x;
      const tz = target.m.z;
      const aimHead = Math.random() < K.head * dt * 4 ? 0 : 0.35;
      const ty = target.m.y + eyeHeight(target.m) - aimHead;
      const dx = tx - eye[0];
      const dy = ty - eye[1];
      const dz = tz - eye[2];
      const dist = Math.hypot(dx, dz);
      // Lead slightly for moving targets.
      const lead = Math.min(0.15, dist / 400);
      const wantYaw = Math.atan2(-(dx + target.m.vx * lead), -(dz + target.m.vz * lead)) + b.ex;
      const wantPitch = Math.atan2(dy, dist) + b.ey;
      // Error shrinks while tracking.
      const k = Math.exp(-dt * K.settle);
      b.ex *= k;
      b.ey *= k;
      if (Math.random() < dt * 2) {
        b.ex += (Math.random() - 0.5) * K.error * 0.6;
        b.ey += (Math.random() - 0.5) * K.error * 0.3;
      }
      const tr = K.turn * dt * (stunned ? 0.3 : 1);
      b.yaw = turn(b.yaw, wantYaw, tr);
      b.pitch += Math.max(-tr, Math.min(tr, wantPitch - b.pitch));
      const err = Math.abs(wrap(b.yaw - wantYaw + b.ex)) + Math.abs(b.pitch - wantPitch + b.ey);
      const spread = g.spread(s);
      const tol = Math.max(0.03, Math.atan2(0.45, dist)) + spread * 0.5;
      const range = w.def.cls === 'shotgun' ? 14 : w.def.cls === 'smg' || w.def.cls === 'pistol' ? 35 : 90;
      inp.ads = dist > 9 || w.def.cls === 'sniper' || w.def.cls === 'marksman';
      // Far targets take longer to pick up and are harder to land (like a human).
      const react = K.react + Math.max(0, dist - 20) * 0.012 + (target.m.sprinting ? 0.1 : 0);
      if (b.seenFor > react && err < tol * 1.6 && dist < range && w.ammo > 0) {
        b.fireHold += dt;
        // Burst control.
        const burstLen = w.def.mode === 'auto' ? 0.25 + K.burst * 0.6 : 0.05;
        if (b.fireHold < burstLen) inp.fire = w.def.mode === 'auto' ? true : Math.random() < 0.5;
        else if (b.fireHold > burstLen + 0.12 * (1.2 - K.burst)) b.fireHold = 0;
      } else b.fireHold = 0;
      if (w.ammo === 0 && w.reserve === 0 && s.cur === 0) inp.slot = 1;
      // Knife up close.
      if (dist < 1.8) inp.melee = Math.random() < 0.3;
      // Combat movement: strafe, sometimes crouch; close in with SMGs/shotguns, hold with snipers.
      b.strafeT -= dt;
      if (b.strafeT <= 0) {
        b.strafeT = 0.4 + Math.random() * 1.1;
        b.strafe = Math.random() < 0.5 ? -1 : 1;
        if (Math.random() < 0.2 * K.strafe) b.crouchT = 0.6 + Math.random();
      }
      inp.mx = b.strafe * K.strafe;
      const ideal = w.def.cls === 'shotgun' || w.def.cls === 'smg' ? 6 : w.def.cls === 'sniper' ? 30 : 15;
      if (dist > ideal + 6) moveGoal = { x: tx, y: target.m.y, z: tz };
      else inp.mz = dist < ideal - 4 ? -0.6 : 0;
    } else {
      b.seenFor = 0;
      b.fireHold = 0;
      // Reload between fights.
      if (w.ammo < w.def.mag * 0.4 && w.reserve > 0) inp.reload = true;
      if (s.cur === 1 && s.weapons[0].ammo + s.weapons[0].reserve > 0) inp.slot = 0;
      // Lethal or tactical at the last place we saw someone (smoke: when hurt, to cover a retreat).
      const tacOk = s.tacticals > 0 && (s.loadout.tactical !== 'smoke' || s.hp < 60);
      if (b.lastSeen && g.time - b.lastSeen.t < 3 && b.nadeCd <= 0 && (s.grenades > 0 || tacOk) && Math.random() < K.nade) {
        const d = Math.hypot(b.lastSeen.x - s.m.x, b.lastSeen.z - s.m.z);
        if (d > (s.loadout.lethal === 'tknife' ? 4 : 8) && d < (s.loadout.lethal === 'tknife' ? 18 : 28)) {
          b.yaw = Math.atan2(-(b.lastSeen.x - s.m.x), -(b.lastSeen.z - s.m.z));
          const useTac = tacOk && (s.grenades === 0 || Math.random() < 0.4);
          b.pitch = useTac || s.loadout.lethal !== 'tknife' ? 0.15 + d * 0.012 : 0.02 + d * 0.004;
          if (useTac) inp.tactical = true;
          else inp.grenade = true;
          b.nadeCd = 10 + Math.random() * 10;
        }
      }
    }
    if (s.cookStart >= 0) inp.grenade = g.time - s.cookStart < 0.8;
    if (s.streaks.length && Math.random() < dt) inp.streak = 3;
    if (blind) {
      inp.fire = false;
      inp.ads = false;
    }
    // ---------------- navigation
    if (!moveGoal) moveGoal = this.objective(s, b);
    if (moveGoal) {
      b.repath -= dt;
      b.pathCd -= dt;
      const goalNode = b.pathCd <= 0 || b.repath <= 0 ? this.nav.nearest(moveGoal.x, moveGoal.y, moveGoal.z) : b.pathGoal;
      if (b.repath <= 0 || (b.pathCd <= 0 && (goalNode !== b.pathGoal || !b.path.length))) {
        b.repath = 1.2 + Math.random();
        b.pathCd = 0.3;
        b.pathGoal = goalNode;
        b.path = this.nav.path(this.nav.nearest(s.m.x, s.m.y, s.m.z), goalNode);
      }
      // Drop reached waypoints, look ahead for smoothing.
      while (b.path.length > 1) {
        const n = this.nav.nodes[b.path[0]!]!;
        if (Math.hypot(n.x - s.m.x, n.z - s.m.z) < 0.9 && Math.abs(n.y - s.m.y) < 0.8) b.path.shift();
        else break;
      }
      let wp = b.path.length ? this.nav.nodes[b.path[Math.min(2, b.path.length - 1)]!]! : null;
      if (wp && b.path.length > 2 && !g.level.visible(s.m.x, s.m.y + 0.9, s.m.z, wp.x, wp.y + 0.9, wp.z)) wp = this.nav.nodes[b.path[0]!]!;
      if (wp) {
        const dx = wp.x - s.m.x;
        const dz = wp.z - s.m.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.2) {
          // World direction → local move relative to where we're looking.
          const wx = dx / d;
          const wz = dz / d;
          const sy = Math.sin(b.yaw);
          const cy = Math.cos(b.yaw);
          const fwd = -sy * wx - cy * wz;
          const right = cy * wx - sy * wz;
          if (!target) {
            // Not fighting: face where we're going and sprint.
            b.yaw = turn(b.yaw, Math.atan2(-wx, -wz), SKILL[this.skill].turn * 0.8 * dt);
            b.pitch *= 0.9;
            inp.mz = 1;
            inp.mx = 0;
            inp.sprint = d > 2 && Math.abs(wrap(Math.atan2(-wx, -wz) - b.yaw)) < 0.6;
            if (inp.sprint && Math.random() < dt * 0.15) inp.crouch = true; // slide
          } else {
            inp.mz = Math.max(-1, Math.min(1, fwd + inp.mz));
            inp.mx = Math.max(-1, Math.min(1, right + inp.mx * 0.6));
          }
        }
      }
    }
    // Unstuck: jump / repath when not moving.
    const moved = Math.hypot(s.m.x - b.lastPos[0], s.m.z - b.lastPos[1]);
    b.lastPos = [s.m.x, s.m.z];
    if ((Math.abs(inp.mz) > 0.5 || Math.abs(inp.mx) > 0.5) && moved < 0.5 * dt) b.stuckT += dt;
    else b.stuckT = Math.max(0, b.stuckT - dt);
    if (b.stuckT > 0.8) {
      inp.jump = true;
      b.repath = 0;
      if (b.stuckT > 2) {
        b.path = [];
        b.goal = null;
        b.stuckT = 0;
      }
    }
    // Crouch is a toggle in the sim: turn "want crouched" / "slide now" into button edges.
    const slideWanted = inp.crouch && s.m.sprinting;
    if (b.crouchT > 0) b.crouchT -= dt;
    inp.crouch = this.toggle(s, b.crouchT > 0, slideWanted);
    inp.yaw = b.yaw;
    inp.pitch = b.pitch;
    return inp;
  }

  /** Turn "want crouched" into crouch button edges for the toggle-crouch sim. */
  private toggle(s: Soldier, wantCrouch: boolean, slide: boolean): boolean {
    if (slide) return !s.m.lastCrouch;
    if (wantCrouch !== s.m.crouched) return !s.m.lastCrouch;
    return false;
  }

  /** Where to go when nobody is in sight. */
  private objective(s: Soldier, b: Brain): { x: number; y: number; z: number } {
    const g = this.g;
    const at = (p: { x: number; z: number }) => Math.hypot(p.x - s.m.x, p.z - s.m.z);
    if (b.goal && at(b.goal) > 2.5 && b.goalWhy !== 'roam') return b.goal;
    if (g.mode === 'dom') {
      const flags = g.flags.filter((f) => f.owner !== s.team);
      const pick = flags.length ? flags.reduce((a, c) => (at(a) < at(c) ? a : c)) : g.flags[Math.floor(Math.random() * g.flags.length)]!;
      b.goal = { x: pick.x + (Math.random() - 0.5) * 2, y: pick.y, z: pick.z + (Math.random() - 0.5) * 2 };
      b.goalWhy = 'flag';
      if (at(pick) < 2.5) return { x: s.m.x, y: s.m.y, z: s.m.z };
      return b.goal;
    }
    if (g.mode === 'kc' && g.tags.length) {
      const near = g.tags.reduce((a, c) => (at(a) < at(c) ? a : c));
      if (at(near) < 25) {
        b.goal = { x: near.x, y: near.y - 0.8, z: near.z };
        b.goalWhy = 'tag';
        return b.goal;
      }
    }
    // Hunt: head towards where enemies were last seen / heard, else a random spot.
    if (b.lastSeen && g.time - b.lastSeen.t < 8 && at(b.lastSeen) > 3) {
      b.goal = { ...b.lastSeen };
      b.goalWhy = 'hunt';
      return b.goal;
    }
    if (!b.goal || at(b.goal) < 2.5 || Math.random() < 0.002) {
      const enemies = g.soldiers.filter((o) => o.alive && g.enemies(s, o));
      if (enemies.length && Math.random() < 0.55) {
        const e = enemies[Math.floor(Math.random() * enemies.length)]!;
        b.goal = { x: e.m.x + (Math.random() - 0.5) * 8, y: e.m.y, z: e.m.z + (Math.random() - 0.5) * 8 };
      } else {
        const here = this.nav.component(this.nav.nearest(s.m.x, s.m.y, s.m.z));
        let k = this.nav.random(Math.random);
        for (let tries = 0; tries < 20 && this.nav.component(k) !== here; tries++) k = this.nav.random(Math.random);
        const n = this.nav.nodes[k]!;
        b.goal = { x: n.x, y: n.y, z: n.z };
      }
      b.goalWhy = 'roam';
    }
    return b.goal;
  }
}

function wrap(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function turn(from: number, to: number, max: number): number {
  const d = wrap(to - from);
  return from + Math.max(-max, Math.min(max, d));
}

export { Game };
