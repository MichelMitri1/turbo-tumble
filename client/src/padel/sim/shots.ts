import { Ball, BALL_R, type BallEvent } from './ball';
import { COURT, netHeight, sideSign } from './court';

/**
 * Padel shots. A shot is an intent (what kind, where to, how hard) turned into the ball's launch
 * velocity and spin by simulating the real flight (drag, spin, the net) and searching for the launch
 * that lands it on target.
 *   drive     groundstroke from the back, flat-ish with topspin
 *   volley    struck before the bounce, firm and flat
 *   lob       high over players at the net to the back glass
 *   smash     overhead, hit down hard (por tres when it's big enough to bounce out)
 *   bandeja   overhead hit flat with slice: keeps the net, bounces low off the glass
 *   vibora    overhead with sidespin and pace
 *   chiquita  soft, low, dipping at the feet of players at the net
 *   serve     underhand, bounced, cross court into the service box
 */
export type ShotKind = 'serve' | 'drive' | 'volley' | 'lob' | 'smash' | 'bandeja' | 'vibora' | 'chiquita';

export interface ShotIntent {
  kind: ShotKind;
  /** Across the opponents' half: −1 … 1, as the hitter sees it (+1 = to the hitter's right). */
  aim: number;
  /** 0 = just over the net … 1 = at the back glass. */
  depth: number;
  /** 0 … 1. */
  power: number;
}

/** Per shot: launch speed range (m/s), arc (low / high), spin (topspin + / backspin −, sidespin). */
const SHOT: Record<ShotKind, { speed: [number, number]; high: boolean; top: number; side: number }> = {
  serve: { speed: [11, 20], high: false, top: 30, side: 0 },
  drive: { speed: [15, 29], high: false, top: 90, side: 0 },
  volley: { speed: [12, 25], high: false, top: -40, side: 0 },
  lob: { speed: [12, 19], high: true, top: 40, side: 0 },
  smash: { speed: [24, 36], high: false, top: 20, side: 0 },
  bandeja: { speed: [15, 22], high: false, top: -120, side: 0 },
  vibora: { speed: [19, 28], high: false, top: -60, side: 90 },
  chiquita: { speed: [7, 12], high: false, top: 70, side: 0 },
};

/** The world x sign of a team's right hand side (looking at the net). */
export const rightX = (team: 0 | 1): -1 | 1 => (team === 0 ? -1 : 1);

/** Where a shot is aimed on the floor (the opponents' half for `team`'s shot). */
export function shotTarget(team: 0 | 1, i: ShotIntent): [number, number] {
  const s = sideSign((1 - team) as 0 | 1);
  // Team 0 faces +z, so its right is −x; team 1 faces −z, its right is +x.
  const x = Math.max(-1, Math.min(1, i.aim)) * rightX(team) * (COURT.halfW - 0.9);
  const z = s * (1.2 + Math.max(0, Math.min(1, i.depth)) * (COURT.halfL - 2.0));
  return [x, z];
}

const sim = new Ball();
sim.rand = () => 0.5;
const ev: BallEvent[] = [];

/** Fly a launch until it lands (or 3 s): where, and how high it was over the net (−1 = into it / never crossed). */
function fly(px: number, py: number, pz: number, vx: number, vy: number, vz: number, wx: number, wy: number, wz: number): { x: number; z: number; clear: number; wall?: boolean } {
  sim.set({ pos: [px, py, pz], vel: [vx, vy, vz], spin: [wx, wy, wz] });
  let clear = -1;
  const dt = 1 / 120;
  for (let t = 0; t < 3; t += dt) {
    const oz = sim.pos[2];
    const oy = sim.pos[1];
    ev.length = 0;
    sim.step(dt, ev);
    if ((oz < 0) !== (sim.pos[2] < 0) && clear < 0) {
      const f = oz / (oz - sim.pos[2]);
      const y = oy + (sim.pos[1] - oy) * f;
      clear = y - netHeight(sim.pos[0]) - BALL_R;
    }
    for (const e of ev) {
      if (e.k === 'net') return { x: sim.pos[0], z: sim.pos[2], clear: -1 };
      if (e.k === 'floor') return { x: e.x, z: e.z, clear };
      if (e.k === 'wall') return { x: e.x, z: e.z, clear, wall: true };
    }
    if (sim.out) break;
  }
  return { x: sim.pos[0], z: sim.pos[2], clear };
}

export interface Launch {
  vel: [number, number, number];
  spin: [number, number, number];
  /** How much pace the solver had to take off to keep it in (asked speed / launch speed, ≥ 1). */
  excess: number;
}

/**
 * Launch velocity + spin that sends a ball struck at `from` by `team` onto `target` as `kind`.
 * Low shots: fixed speed, search the elevation (net clearance kept); lobs: fixed high elevation,
 * search the speed; then one correction of the heading for any sideways drift.
 */
export function solveShot(from: [number, number, number], team: 0 | 1, kind: ShotKind, target: [number, number], power: number): Launch {
  // Too soft to get there (a chiquita from the back): add pace until it clears the net and carries.
  let L = solveOnce(from, team, kind, target, power, 1);
  for (let boost = 1.15; boost < 2.6; boost *= 1.15) {
    const r = fly(from[0], from[1], from[2], L.vel[0], L.vel[1], L.vel[2], L.spin[0], L.spin[1], L.spin[2]);
    const dir = sideSign((1 - team) as 0 | 1);
    if (r.clear >= 0 && (r.z - target[1]) * dir > -1.2) break;
    L = solveOnce(from, team, kind, target, power, boost);
  }
  return L;
}

function solveOnce(from: [number, number, number], team: 0 | 1, kind: ShotKind, target: [number, number], power: number, pace: number): Launch {
  const S = SHOT[kind];
  const [px, py, pz] = from;
  let [tx, tz] = target;
  const dir = sideSign((1 - team) as 0 | 1);
  // Never aim behind ourselves.
  if ((tz - pz) * dir < 1) tz = pz + dir;
  let heading = Math.atan2(tx - px, tz - pz);
  const range = Math.hypot(tx - px, tz - pz);
  const p = Math.max(0, Math.min(1, power));
  let speed = (S.speed[0] + (S.speed[1] - S.speed[0]) * p) * pace;
  const asked = speed;
  const spinOf = (h: number): [number, number, number] => {
    // Topspin axis = up × d (d = horizontal direction of travel); sidespin about y.
    const dx = Math.sin(h), dz = Math.cos(h);
    return [dz * S.top, S.side * Math.sign(-dx || 1), -dx * S.top];
  };
  const launch = (h: number, sp: number, el: number) => {
    const c = Math.cos(el);
    return [Math.sin(h) * c * sp, Math.sin(el) * sp, Math.cos(h) * c * sp] as const;
  };
  const along = (r: { x: number; z: number }, h: number) => (r.x - px) * Math.sin(h) + (r.z - pz) * Math.cos(h);
  let el = 0;
  for (let pass = 0; pass < 2; pass++) {
    const w = spinOf(heading);
    if (S.high) {
      // Lob: elevation 52–62° by power, search the speed.
      el = ((62 - 10 * p) * Math.PI) / 180;
      let lo = 6, hi = 26;
      for (let i = 0; i < 18; i++) {
        speed = (lo + hi) / 2;
        const v = launch(heading, speed, el);
        const r = fly(px, py, pz, v[0], v[1], v[2], w[0], w[1], w[2]);
        if (along(r, heading) < range) lo = speed;
        else hi = speed;
      }
    } else {
      // Low: search the elevation for the range at this speed (the low branch). If even the flattest
      // ball over the tape carries into the glass, it's too fast to keep in: take pace off and retry.
      for (let tries = 0; tries < 10; tries++) {
        let lo = (-40 * Math.PI) / 180, hi = (38 * Math.PI) / 180;
        for (let i = 0; i < 18; i++) {
          el = (lo + hi) / 2;
          const v = launch(heading, speed, el);
          const r = fly(px, py, pz, v[0], v[1], v[2], w[0], w[1], w[2]);
          if (along(r, heading) < range || r.clear < 0) lo = el;
          else hi = el;
        }
        const v = launch(heading, speed, el);
        const r = fly(px, py, pz, v[0], v[1], v[2], w[0], w[1], w[2]);
        if (r.clear >= 0 && r.clear < 0.05 && kind !== 'smash') {
          el += (3 * Math.PI) / 180; // keep a little over the tape
          const v2 = launch(heading, speed, el);
          const r2 = fly(px, py, pz, v2[0], v2[1], v2[2], w[0], w[1], w[2]);
          if (!r2.wall && along(r2, heading) < range + 1.2) break;
        } else if (r.clear >= 0 && !r.wall && along(r, heading) < range + 1.2) break;
        if (kind === 'smash' && tries > 2) break;
        speed *= 0.88;
      }
    }
    // Correct the heading for sideways drift (spin, the walls of the search).
    const v = launch(heading, speed, el);
    const r = fly(px, py, pz, v[0], v[1], v[2], ...spinOf(heading));
    const miss = Math.atan2(r.x - px, r.z - pz) - Math.atan2(tx - px, tz - pz);
    heading -= miss;
  }
  const v = launch(heading, speed, el);
  return { vel: [v[0], v[1], v[2]], spin: spinOf(heading), excess: S.high ? 1 : asked / speed };
}
