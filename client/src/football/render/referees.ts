import * as THREE from 'three';
import { PITCH } from '../sim/match';
import type { Kit, PlayerDef } from '../sim/data';
import type { Frame, FramePlayer } from '../sim/snapshot';
import { PlayerView, type PoseContext } from './players';

/**
 * The officials: the referee working the diagonal across the pitch and two assistants
 * running the touchlines level with the offside line, flags in hand. They're only drawn,
 * never simulated: positions come from each Frame (so live, online and replays agree) and
 * signals from the match events (whistle, free kick, cards, penalty, offside, corner, goal).
 */

type Sig = NonNullable<PlayerView['signal']>;
interface Official {
  view: PlayerView;
  x: number;
  z: number;
  vx: number;
  vz: number;
  face: number;
  /** Current signal and how long it's held for. */
  sig: Sig | null;
  sigT: number;
  /** Face this way while signalling (radians, frame convention), or NaN. */
  sigFace: number;
  prop?: THREE.Object3D;
  /** Run over to this spot first (to book a player, to the monitor). */
  goTo?: { x: number; z: number; until: number };
}

const REF_KITS: Kit[] = [
  { shirt: '#141414', trim: '#2a2a2a', shorts: '#111111', socks: '#141414', pattern: 'plain' },
  { shirt: '#e8ff2a', trim: '#111111', shorts: '#111111', socks: '#e8ff2a', pattern: 'plain' },
  { shirt: '#ff3c8e', trim: '#111111', shorts: '#111111', socks: '#ff3c8e', pattern: 'plain' },
  { shirt: '#2cc6f0', trim: '#111111', shorts: '#111111', socks: '#2cc6f0', pattern: 'plain' },
];

/** The officials' colours: whichever of the four clashes least with both teams and both keepers. */
export function refereeKit(shirts: string[]): Kit {
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const dist = (a: string, b: string) => {
    const [x, y] = [rgb(a), rgb(b)];
    return Math.hypot(x[0]! - y[0]!, x[1]! - y[1]!, x[2]! - y[2]!);
  };
  return REF_KITS.reduce((best, k) => (Math.min(...shirts.map((s) => dist(k.shirt, s))) > Math.min(...shirts.map((s) => dist(best.shirt, s))) ? k : best));
}

const def = (name: string, num: number, skin: number): PlayerDef => ({
  name,
  num,
  role: 'CM',
  stats: { pac: 70, sho: 40, pas: 50, dri: 50, def: 50, phy: 66, gk: 20 },
  ovr: 60,
  skin,
  hair: num % 5,
  left: false,
});

export class Referees {
  readonly group = new THREE.Group();
  readonly list: Official[] = [];
  private cardMesh: THREE.Mesh;

  constructor(kit: Kit) {
    const mk = (name: string, num: number, skin: number, x: number, z: number): Official => {
      const view = new PlayerView(def(name, num, skin), kit);
      this.group.add(view.root);
      return { view, x, z, vx: 0, vz: 0, face: 0, sig: null, sigT: 0, sigFace: NaN };
    };
    // Referee, assistant on the near touchline (left half), assistant on the far touchline (right half).
    this.list.push(mk('Referee', 90, 1, -8, 6), mk('AR1', 91, 2, -20, PITCH.HW + 1.2), mk('AR2', 92, 0, 20, -PITCH.HW - 1.2));
    for (const ar of [this.list[1]!, this.list[2]!]) {
      const flag = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.55), new THREE.MeshStandardMaterial({ color: '#222' }));
      pole.position.y = 0.2;
      flag.add(pole);
      const cloth = new THREE.Mesh(
        new THREE.PlaneGeometry(0.34, 0.26, 1, 1),
        new THREE.MeshStandardMaterial({ color: '#ffd400', emissive: '#ff6a00', emissiveIntensity: 0.25, side: THREE.DoubleSide }),
      );
      cloth.position.set(0.17, 0.35, 0);
      flag.add(cloth);
      ar.view.hold(flag);
      ar.prop = flag;
    }
    // The referee's card (shown in his raised hand).
    this.cardMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.16), new THREE.MeshBasicMaterial({ color: '#ffd400', side: THREE.DoubleSide }));
    this.cardMesh.position.y = 0.12;
    this.cardMesh.visible = false;
    this.list[0]!.view.hold(this.cardMesh);
  }

  // ---------------------------------------------------------------- signals (from match events)

  private signal(o: Official, sig: Sig, secs: number, face = NaN): void {
    o.sig = sig;
    o.sigT = secs;
    o.sigFace = face;
  }
  /** Face from an official to a point (frame convention: forward = (cos f, −sin f)). */
  private faceTo(o: Official, x: number, z: number): number {
    return Math.atan2(-(z - o.z), x - o.x);
  }

  private clock = 0;
  /** Drawing the TV screen (VAR decision) until this time. */
  private tvUntil = -1;
  private warningAt = -9;
  private cardUntil = -1;

  /** Before a kick-off: arm up, ready to blow. */
  kickoffReady(): void {
    const r = this.list[0]!;
    this.signal(r, { upR: 0.85 }, 6, NaN);
  }
  /** End of a half: both arms up, long whistle. */
  endHalf(): void {
    const r = this.list[0]!;
    this.signal(r, { upR: 0.75, upL: 0.75 }, 2.5);
  }
  /** VAR check: finger to the earpiece, waiting on the call. */
  varCheck(secs: number): void {
    const r = this.list[0]!;
    this.signal(r, { fwdR: 0.55, outR: 0.45, elbR: 2.1 }, secs);
  }
  /** VAR decision: draw the TV screen in the air. */
  varDecision(): void {
    this.tvUntil = this.clock + 2.2;
  }
  /** Book a player: jog over to him, then the card goes up. */
  approach(x: number, z: number, secs: number): void {
    const r = this.list[0]!;
    const dx = x - r.x, dz = z - r.z, distance = Math.hypot(dx, dz);
    // A broadcast cut brings a distant official into the incident before the close-up.
    if (distance > 16) { r.x = x - dx / distance * 9; r.z = z - dz / distance * 9; r.vx = r.vz = 0; }
    r.goTo = { x, z, until: this.clock + secs };
  }

  /** A verbal warning: approach, open palm, then point to the offender. */
  warning(x: number, z: number): void {
    this.approach(x, z, 2.8);
    this.warningAt = this.clock;
    this.cardMesh.visible = false;
  }

  /** Reconstruct the same warning/card when a replay seeks into a foul sequence. */
  presentFoul(x: number, z: number, card: 'yellow' | 'red' | null, elapsed: number): void {
    this.approach(x, z, 0.2);
    if (!card) this.warningAt = this.clock - elapsed;
    else if (elapsed >= 1.2) this.card(card, x, z);
  }
  clearFoul(): void {
    const r = this.list[0]!;
    r.goTo = undefined; r.sig = null; this.warningAt = -9; this.cardUntil = -1; this.cardMesh.visible = false;
  }

  whistle(): void {
    const r = this.list[0]!;
    // Whistle to the lips (right hand up to the mouth).
    if (!r.sig || r.sigT < 0.3) this.signal(r, { fwdR: 0.95, elbR: 1.9 }, 0.7);
  }
  /** Free kick: point the way it's going (the direction the fouled team attacks). */
  freeKick(dirX: number): void {
    const r = this.list[0]!;
    this.signal(r, { fwdR: 0.75, upR: 0.25 }, 1.8, dirX > 0 ? 0 : Math.PI);
  }
  card(color: 'yellow' | 'red', x: number, z: number): void {
    const r = this.list[0]!;
    (this.cardMesh.material as THREE.MeshBasicMaterial).color.set(color === 'red' ? '#e3122a' : '#ffd400');
    this.cardMesh.visible = true;
    this.signal(r, { upR: 1 }, 2.6, this.faceTo(r, x, z));
    this.cardUntil = this.clock + 2.6;
  }
  penalty(spotX: number): void {
    const r = this.list[0]!;
    this.signal(r, { fwdR: 0.62 }, 2.4, this.faceTo(r, spotX, 0));
  }
  /** Offside: the assistant on that half raises the flag straight up, then the referee gives it. */
  offside(x: number): void {
    const ar = this.arFor(x);
    this.signal(ar, { upR: 1 }, 1.8);
  }
  corner(x: number, z: number): void {
    const ar = this.arFor(x);
    // Flag pointed down at the corner arc.
    this.signal(ar, { fwdR: 0.45, outR: 0.3 }, 1.6, this.faceTo(ar, x, z));
    const r = this.list[0]!;
    this.signal(r, { fwdR: 0.75, upR: 0.35 }, 1.6, this.faceTo(r, x, z));
  }
  goalKick(x: number): void {
    const r = this.list[0]!;
    this.signal(r, { fwdR: 0.6 }, 1.6, this.faceTo(r, x, 0));
  }
  /** Throw-in: the assistant's flag points the way the team taking it attacks. */
  throwIn(x: number, attackDir: number): void {
    const ar = this.arFor(x);
    this.signal(ar, { fwdR: 0.85 }, 1.6, attackDir > 0 ? 0 : Math.PI);
  }
  goal(): void {
    const r = this.list[0]!;
    // Back to the centre circle: arm pointing to the spot.
    this.signal(r, { fwdR: 0.7 }, 2.5, this.faceTo(r, 0, 0));
    for (const ar of [this.list[1]!, this.list[2]!]) ar.sig = null;
  }
  private arFor(x: number): Official {
    return x < 0 ? this.list[1]! : this.list[2]!;
  }

  // ---------------------------------------------------------------- movement

  update(f: Frame, dt: number, ctx: PoseContext): void {
    const b = f.ball;
    const [ref, ar1, ar2] = this.list as [Official, Official, Official];
    // Who's attacking which way: the team in possession (else last touch isn't in a frame: use the ball's run).
    const owner = b.owner >= 0 ? f.players[b.owner] : undefined;
    const ownerTeam = b.owner >= 0 ? (b.owner < 11 ? 0 : 1) : -1;
    const dir0 = f.dir0;
    const adir = ownerTeam === 0 ? dir0 : ownerTeam === 1 ? -dir0 : Math.sign(b.vx) || 1;
    // Referee: on the diagonal, 12–18 m from the ball, behind the play and wide of it, out of the way.
    let rx: number;
    let rz: number;
    if (f.phase === 'goal' || f.phase === 'halftime' || f.phase === 'fulltime') {
      rx = f.phase === 'goal' ? -Math.sign(b.x || 1) * 6 : 0;
      rz = -4;
    } else if (f.restart === 'kickoff') {
      rx = -dir0 * 3;
      rz = -12;
    } else {
      rx = b.x - adir * 9;
      rz = b.z + (b.z > 4 ? -10 : b.z < -4 ? 10 : 9);
      if (f.restart === 'penalty') {
        rx = b.x - Math.sign(b.x) * 5;
        rz = 8;
      }
      // Step away from players near that spot.
      for (const p of f.players) {
        const d = Math.hypot(p.x - rx, p.z - rz);
        if (d < 3 && d > 0.01) {
          rx += ((rx - p.x) / d) * (3 - d);
          rz += ((rz - p.z) / d) * (3 - d);
        }
      }
    }
    rx = THREE.MathUtils.clamp(rx, -PITCH.HL + 2, PITCH.HL - 2);
    rz = THREE.MathUtils.clamp(rz, -PITCH.HW + 2, PITCH.HW - 2);
    this.clock += Math.max(0, dt);
    if (this.clock >= this.cardUntil) this.cardMesh.visible = false;
    if (ref.goTo && ref.goTo.until > this.clock) {
      // Over to the player (stop a couple of metres short).
      const d = Math.hypot(ref.goTo.x - ref.x, ref.goTo.z - ref.z);
      const k = d > 2.4 ? (d - 2.4) / d : 0;
      rx = ref.x + (ref.goTo.x - ref.x) * k;
      rz = ref.z + (ref.goTo.z - ref.z) * k;
    }
    this.move(ref, rx, rz, dt, Math.atan2(-(b.z - ref.z), b.x - ref.x));
    const warningT = this.clock - this.warningAt;
    if (warningT > 0.65 && warningT < 2.8 && ref.goTo) {
      const point = warningT > 1.45;
      this.signal(ref, point ? { fwdR: 0.8, elbR: 0.2, outL: 0.3, headPitch: 0.1 } : { fwdR: 0.6, upR: 0.35, elbR: 0.35, outL: 0.4 }, 0.12, this.faceTo(ref, ref.goTo.x, ref.goTo.z));
    }
    if (this.tvUntil > this.clock) {
      // Trace a rectangle with both hands (the TV signal).
      const u = (this.clock * 1.1) % 1;
      const corner = Math.floor(u * 4);
      const f = (u * 4) % 1;
      const pts: Array<[number, number]> = [
        [0.08, 0.5],
        [0.5, 0.5],
        [0.5, 0.18],
        [0.08, 0.18],
      ];
      const [a0, a1] = [pts[corner]!, pts[(corner + 1) % 4]!];
      const out = a0[0] + (a1[0] - a0[0]) * f;
      const up = a0[1] + (a1[1] - a0[1]) * f;
      ref.sig = { fwdR: 0.95 - up * 0.4, fwdL: 0.95 - up * 0.4, outR: out, outL: out, upR: up * 0.4, upL: up * 0.4 };
      ref.sigT = 0.1;
      ref.sigFace = Math.atan2(-(0 - ref.z), 0 - ref.x);
    }
    // Assistants: level with the second-last defender (or the ball, if it's further on) in their half.
    for (const [ar, half, z] of [
      [ar1, -1, PITCH.HW + 1.2],
      [ar2, 1, -PITCH.HW - 1.2],
    ] as const) {
      // The team defending this half's goal.
      const defTeam = -dir0 === half ? 0 : 1;
      const xs = f.players
        .map((p, i) => ({ p, i }))
        .filter(({ p, i }) => (i < 11 ? 0 : 1) === defTeam && p.state !== 'off')
        .map(({ p }) => p.x * half)
        .sort((a, c) => c - a);
      let line = Math.max(xs[1] ?? 0, b.x * half);
      line = THREE.MathUtils.clamp(line, 0, PITCH.HL);
      if (f.restart === 'corner' && Math.sign(b.x) === half) line = PITCH.HL;
      this.move(ar, line * half, z, dt, z > 0 ? Math.PI / 2 : -Math.PI / 2, true);
    }
    void owner;
    // Animate.
    for (const o of this.list) {
      o.sigT -= dt;
      if (o.sigT <= 0) o.sig = null;
      o.view.signal = o.sig;
      if (o.sig && !Number.isNaN(o.sigFace)) o.face = turnTo(o.face, o.sigFace, dt * 8);
      const fp: FramePlayer = { x: o.x, z: o.z, face: o.face, speed: Math.hypot(o.vx, o.vz), state: 'run', t: 0, leftFoot: false, human: -1, kick: null, diveZ: 0, diveY: 0, sprint: Math.hypot(o.vx, o.vz) > 6, yellow: 0, trick: 0 };
      o.view.update(fp, dt, { ...ctx, celebTeam: -1, phase: 'play' });
    }
  }

  /** Run towards a spot (top speed like a fit official), turning to watch the play; assistants side-step along the line. */
  private move(o: Official, tx: number, tz: number, dt: number, watch: number, sideStep = false): void {
    if (dt <= 0) return;
    const dx = tx - o.x;
    const dz = tz - o.z;
    const d = Math.hypot(dx, dz);
    const top = d > 8 ? 7.4 : d > 2 ? 5 : 2.4;
    const want = Math.min(top, d * 1.6);
    const wx = d > 0.05 ? (dx / d) * want : 0;
    const wz = d > 0.05 ? (dz / d) * want : 0;
    const k = 1 - Math.exp(-dt * 4);
    o.vx += (wx - o.vx) * k;
    o.vz += (wz - o.vz) * k;
    o.x += o.vx * dt;
    o.z += o.vz * dt;
    const sp = Math.hypot(o.vx, o.vz);
    if (o.sig && !Number.isNaN(o.sigFace)) return;
    // Assistants face the pitch and shuffle sideways (turning to run only when they have to sprint).
    if (sideStep) o.face = turnTo(o.face, sp > 6 ? Math.atan2(-o.vz, o.vx) : watch, dt * 6);
    else o.face = turnTo(o.face, sp > 4.5 ? Math.atan2(-o.vz, o.vx) : watch, dt * 6);
  }

  dispose(): void {
    for (const o of this.list) o.view.dispose();
  }
}

function turnTo(from: number, to: number, max: number): number {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return from + Math.max(-max, Math.min(max, d));
}
