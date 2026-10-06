import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
  type Object3D,
} from 'three';
import { clamp, damp } from '@shared/math/scalar';

/**
 * Procedural driver animation. The Kenney drivers are a single mesh, so all
 * motion is whole-body (lean, look, bounce, squash) plus two add-ons that give
 * every character a readable silhouette from the chase camera:
 *  - a signature helmet topper on a damped spring (wobbles with acceleration)
 *  - a scarf tied at the neck that hangs at rest and streams + flutters at speed
 * All coordinates are driver-model units (the kart model is scaled ×2.2).
 */

export type DriverGesture = 'throw' | 'boost' | 'ouch' | 'rocket' | 'stall' | 'shout';
export type DriverMood = 'race' | 'cheer' | 'sulk';

export interface DriverFrame {
  dt: number;
  /** Lean into the turn (rad, from the kart view). */
  lean: number;
  /** Kart body pitch (rad). */
  pitch: number;
  steer: number;
  speed01: number;
  /** Smoothed longitudinal acceleration (m/s²). */
  accel: number;
  airborne: boolean;
  stunned: boolean;
  countdown: boolean;
}

interface ActiveGesture {
  kind: DriverGesture;
  t: number;
  duration: number;
}

const HELMET_TOP = 1.03;
const GESTURE_TIME: Record<DriverGesture, number> = { throw: 0.4, boost: 0.6, ouch: 0.7, rocket: 0.9, stall: 1.1, shout: 0.6 };
const SCARF_SEGMENTS = 10;
const SCARF_LENGTH = 0.085;
const SCARF_WIDTH = 0.17;
/** One scarf tail, tied at the back of the neck. */
const STREAMERS = [0];
const STREAMER_ANCHOR = { y: 0.3, z: -0.34 };

type TopperBuilder = (mat: MeshStandardMaterial, accent: MeshStandardMaterial) => { root: Group; spin?: Object3D };

/** Signature toppers (original designs), keyed by character id. */
const TOPPERS: Record<string, TopperBuilder> = {
  // Bix — cosmic courier: antenna with a glowing tip.
  bix: (mat, accent) => {
    const root = new Group();
    const stalk = new Mesh(new CylinderGeometry(0.018, 0.026, 0.34, 6), accent);
    stalk.position.y = 0.17;
    const ball = new Mesh(new SphereGeometry(0.075, 12, 8), mat);
    ball.position.y = 0.37;
    mat.emissive = new Color(mat.color).multiplyScalar(0.6);
    root.add(stalk, ball);
    return { root };
  },
  // Pip — prankster: twin pom-poms on springy stalks.
  pip: (mat, accent) => {
    const root = new Group();
    for (const side of [-1, 1]) {
      const arm = new Group();
      arm.rotation.z = side * -0.45;
      const stalk = new Mesh(new CylinderGeometry(0.016, 0.02, 0.22, 6), accent);
      stalk.position.y = 0.11;
      const pom = new Mesh(new SphereGeometry(0.085, 10, 8), mat);
      pom.position.y = 0.25;
      arm.add(stalk, pom);
      root.add(arm);
    }
    return { root };
  },
  // Zuzu — sunny speedster: a three-spike fin crest, front to back.
  zuzu: (mat) => {
    const root = new Group();
    [0.2, 0.0, -0.2].forEach((z, i) => {
      const spike = new Mesh(new ConeGeometry(0.07, 0.26 - i * 0.04, 4), mat);
      spike.scale.x = 0.35;
      spike.position.set(0, 0.12 - i * 0.02, z);
      spike.rotation.x = -0.25 - i * 0.12;
      root.add(spike);
    });
    return { root };
  },
  // Tuko — chill drifter: propeller beanie (spins with speed).
  tuko: (mat, accent) => {
    const root = new Group();
    const cap = new Mesh(new SphereGeometry(0.16, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat);
    cap.scale.y = 0.45;
    const pin = new Mesh(new CylinderGeometry(0.015, 0.015, 0.1, 6), accent);
    pin.position.y = 0.11;
    const spin = new Group();
    spin.position.y = 0.16;
    for (const side of [-1, 1]) {
      const blade = new Mesh(new SphereGeometry(0.05, 8, 4), accent);
      blade.scale.set(2.6, 0.18, 0.7);
      blade.position.x = side * 0.12;
      blade.rotation.x = side * 0.3;
      spin.add(blade);
    }
    root.add(cap, pin, spin);
    return { root, spin };
  },
  // Nova — star surfer: a five-point star on a short stalk.
  nova: (mat, accent) => {
    const root = new Group();
    const stalk = new Mesh(new CylinderGeometry(0.016, 0.022, 0.24, 6), accent);
    stalk.position.y = 0.12;
    const star = new Group();
    star.position.y = 0.32;
    for (let i = 0; i < 5; i++) {
      const ray = new Mesh(new ConeGeometry(0.045, 0.13, 4), mat);
      const a = (i / 5) * Math.PI * 2;
      ray.position.set(Math.sin(a) * 0.06, Math.cos(a) * 0.06, 0);
      ray.rotation.z = -a;
      star.add(ray);
    }
    star.add(new Mesh(new SphereGeometry(0.05, 8, 6), mat));
    mat.emissive = new Color(mat.color).multiplyScalar(0.5);
    root.add(stalk, star);
    return { root, spin: star };
  },
  // Rumble — volcano brute: a tall spiky mohawk.
  rumble: (mat) => {
    const root = new Group();
    for (let i = 0; i < 5; i++) {
      const spike = new Mesh(new ConeGeometry(0.06, 0.3 - Math.abs(i - 2) * 0.05, 4), mat);
      spike.scale.x = 0.4;
      spike.position.set(0, 0.11, 0.24 - i * 0.12);
      spike.rotation.x = -0.15 - i * 0.08;
      root.add(spike);
    }
    return { root };
  },
  // Kiki — glitter racer: a big bow.
  kiki: (mat) => {
    const root = new Group();
    for (const side of [-1, 1]) {
      const loop = new Mesh(new ConeGeometry(0.1, 0.2, 4), mat);
      loop.rotation.z = side * (Math.PI / 2);
      loop.position.set(side * 0.1, 0.05, 0);
      root.add(loop);
    }
    const knot = new Mesh(new SphereGeometry(0.055, 8, 6), mat);
    knot.position.y = 0.05;
    root.add(knot);
    return { root };
  },
  // Juno — night rider: headphones over the helmet.
  juno: (mat, accent) => {
    const root = new Group();
    const band = new Mesh(new TorusGeometry(0.47, 0.03, 6, 20, Math.PI), accent);
    band.position.y = -0.5;
    root.add(band);
    for (const side of [-1, 1]) {
      const cup = new Mesh(new CylinderGeometry(0.13, 0.13, 0.08, 12), mat);
      cup.rotation.z = Math.PI / 2;
      cup.position.set(side * 0.47, -0.5, 0);
      root.add(cup);
    }
    return { root };
  },
  // Sprig — forest sprinter: a leafy sprout.
  sprig: (mat, accent) => {
    const root = new Group();
    const stem = new Mesh(new CylinderGeometry(0.014, 0.02, 0.16, 6), accent);
    stem.position.y = 0.08;
    root.add(stem);
    for (const side of [-1, 1]) {
      const leaf = new Mesh(new SphereGeometry(0.08, 8, 6), mat);
      leaf.scale.set(1.6, 0.35, 0.8);
      leaf.position.set(side * 0.1, 0.17, 0);
      leaf.rotation.z = side * -0.5;
      root.add(leaf);
    }
    return { root };
  },
  // Blaze — drift demon: a flickering flame crest.
  blaze: (mat) => {
    const root = new Group();
    const hot = new MeshStandardMaterial({ color: '#ffd23f', emissive: new Color('#ff8a1a'), emissiveIntensity: 0.8, flatShading: true });
    mat.emissive = new Color('#ff3a00').multiplyScalar(0.5);
    [
      [0, 0.3, 0.09, mat],
      [0.07, 0.2, 0.06, mat],
      [-0.07, 0.22, 0.06, mat],
      [0, 0.16, 0.05, hot],
    ].forEach(([x, h, r, m]) => {
      const flame = new Mesh(new ConeGeometry(r as number, h as number, 6), m as MeshStandardMaterial);
      flame.position.set(x as number, (h as number) / 2, 0);
      root.add(flame);
    });
    return { root };
  },
  // Pearl — cool captain: a tiny top hat.
  pearl: (mat, accent) => {
    const root = new Group();
    const brim = new Mesh(new CylinderGeometry(0.2, 0.2, 0.025, 16), accent);
    const crown = new Mesh(new CylinderGeometry(0.12, 0.13, 0.22, 16), mat);
    crown.position.y = 0.12;
    const band = new Mesh(new BoxGeometry(0.27, 0.04, 0.27), accent);
    band.position.y = 0.04;
    band.visible = false;
    root.add(brim, crown, band);
    root.rotation.z = 0.12;
    return { root };
  },
  // Mox — heavy hitter: two stubby horns.
  mox: (_mat, accent) => {
    const root = new Group();
    for (const side of [-1, 1]) {
      const horn = new Mesh(new ConeGeometry(0.06, 0.22, 8), accent);
      horn.position.set(side * 0.2, 0.02, 0.05);
      horn.rotation.z = side * -0.7;
      root.add(horn);
    }
    return { root };
  },
};

/** Damped spring on one angle. */
class Spring {
  value = 0;
  private vel = 0;
  constructor(
    private readonly stiffness: number,
    private readonly damping: number,
  ) {}
  step(target: number, dt: number): number {
    const h = Math.min(dt, 1 / 30);
    this.vel += (this.stiffness * (target - this.value) - this.damping * this.vel) * h;
    this.value += this.vel * h;
    return this.value;
  }
  kick(v: number): void {
    this.vel += v;
  }
}

export class DriverRig {
  private readonly basePos: { x: number; y: number; z: number };
  private readonly gestures: ActiveGesture[] = [];
  private mood: DriverMood = 'race';
  private moodTime = 0;
  private threat = 0;
  private threatSide = 1;
  private time = Math.random() * 10;
  private readonly topper: Group | null = null;
  private readonly spin: Object3D | null = null;
  private readonly tiltX = new Spring(140, 7);
  private readonly tiltZ = new Spring(140, 7);
  private readonly scarf: Mesh | null = null;
  private readonly scarfPos: Float32Array | null = null;
  private airStretch = 0;
  private propeller = 0;

  constructor(
    private readonly driver: Object3D | null,
    characterId: string,
    color: string,
  ) {
    this.basePos = driver ? { x: driver.position.x, y: driver.position.y, z: driver.position.z } : { x: 0, y: 0, z: 0 };
    if (!driver) return;
    const mat = new MeshStandardMaterial({ color, roughness: 0.55, metalness: 0, flatShading: true });
    const accent = new MeshStandardMaterial({ color: new Color(color).lerp(new Color('#ffffff'), 0.55), roughness: 0.6, flatShading: true });
    const build = TOPPERS[characterId];
    if (build) {
      const { root, spin } = build(mat, accent);
      const pivot = new Group();
      pivot.name = 'driver-topper';
      pivot.position.y = HELMET_TOP;
      pivot.add(root);
      root.traverse((o) => (o.castShadow = true));
      driver.add(pivot);
      this.topper = pivot;
      this.spin = spin ?? null;
    }
    // Streamers: strips of quads re-shaped every frame (one geometry for both).
    const perStrip = (SCARF_SEGMENTS + 1) * 2;
    this.scarfPos = new Float32Array(perStrip * STREAMERS.length * 3);
    const index: number[] = [];
    STREAMERS.forEach((_, sIdx) => {
      for (let i = 0; i < SCARF_SEGMENTS; i++) {
        const a = sIdx * perStrip + i * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    });
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.scarfPos, 3));
    geo.setIndex(index);
    const scarfMat = new MeshStandardMaterial({ color, roughness: 0.8, side: DoubleSide });
    this.scarf = new Mesh(geo, scarfMat);
    this.scarf.name = 'driver-scarf';
    this.scarf.frustumCulled = false;
    driver.add(this.scarf);
  }

  gesture(kind: DriverGesture): void {
    // Replace a running gesture of the same kind instead of stacking it.
    const existing = this.gestures.find((g) => g.kind === kind);
    if (existing) existing.t = 0;
    else this.gestures.push({ kind, t: 0, duration: GESTURE_TIME[kind] });
    if (kind === 'ouch' || kind === 'rocket') this.tiltX.kick(kind === 'rocket' ? -4 : 3);
  }

  setMood(mood: DriverMood): void {
    if (mood !== this.mood) this.moodTime = 0;
    this.mood = mood;
  }

  /** Something nasty is closing in from behind (side: which way to look). */
  setThreat(active: boolean, side = 1): void {
    if (active) this.threatSide = side;
    this.threat = active ? 1 : 0;
  }

  /** Landing / bump: toppers and scarf bounce. */
  jolt(strength: number): void {
    this.tiltX.kick(strength * 1.5);
  }

  update(f: DriverFrame): void {
    const d = this.driver;
    if (!d) return;
    const dt = f.dt;
    this.time += dt;
    this.moodTime += dt;
    const t = this.time;

    // ---- base riding pose
    let rx = -f.pitch * 1.5 + Math.sin(t * 9) * 0.015 * clamp(f.speed01, 0, 1);
    let ry = -f.steer * 0.12;
    let rz = f.lean;
    let py = 0;
    let sx = 1;
    let sy = 1;

    if (f.countdown) py += Math.abs(Math.sin(t * Math.PI * 2)) * 0.035; // revving anticipation
    if (f.stunned) ry += Math.sin(t * 18) * 0.4;

    // Airborne stretch, eased.
    this.airStretch = damp(this.airStretch, f.airborne ? 1 : 0, f.airborne ? 6 : 12, dt);
    sy += this.airStretch * 0.08;
    sx -= this.airStretch * 0.04;
    rx += this.airStretch * 0.12;

    // Glance back at incoming trouble.
    const look = (this.lookAmount = damp(this.lookAmount, this.threat, this.threat ? 8 : 4, dt));
    ry += look * 1.15 * this.threatSide;
    rz -= look * 0.12 * this.threatSide;

    // ---- gestures
    for (let i = this.gestures.length - 1; i >= 0; i--) {
      const g = this.gestures[i]!;
      g.t += dt;
      const k = g.t / g.duration;
      if (k >= 1) {
        this.gestures.splice(i, 1);
        continue;
      }
      const env = Math.sin(Math.PI * Math.min(1, k * 1.4)) * (1 - k * 0.3);
      switch (g.kind) {
        case 'throw':
          rx += env * 0.45;
          py += env * 0.03;
          break;
        case 'boost':
          rx -= env * 0.3;
          sy += env * 0.06;
          break;
        case 'rocket':
          rx -= env * 0.45;
          sy += env * 0.1;
          break;
        case 'shout':
          rx -= env * 0.2;
          sy += env * 0.12;
          sx += env * 0.05;
          break;
        case 'ouch':
          rz += Math.sin(g.t * 40) * 0.3 * (1 - k);
          sy -= env * 0.08;
          break;
        case 'stall':
          rx += env * 0.35;
          ry += Math.sin(g.t * 22) * 0.15 * (1 - k);
          break;
      }
    }

    // ---- finish moods
    if (this.mood === 'cheer') {
      const hop = Math.abs(Math.sin(this.moodTime * 7.5));
      py += hop * 0.16;
      sy += hop * 0.06;
      rz += Math.sin(this.moodTime * 3.7) * 0.25;
      // A celebratory pirouette every few seconds.
      const cycle = this.moodTime % 3.2;
      if (cycle < 0.6) ry += (cycle / 0.6) * Math.PI * 2;
    } else if (this.mood === 'sulk') {
      const ease = Math.min(1, this.moodTime * 1.5);
      rx += 0.32 * ease;
      ry += Math.sin(this.moodTime * 1.6) * 0.3 * ease;
      py -= 0.05 * ease;
      sy -= 0.05 * ease;
    }

    d.position.set(this.basePos.x, this.basePos.y + py, this.basePos.z);
    d.rotation.set(rx, ry, rz);
    d.scale.set(sx, sy, sx);

    // ---- topper spring: lags behind acceleration and turns
    if (this.topper) {
      const ax = this.tiltX.step(clamp(f.accel * 0.025, -0.6, 0.6) + (this.mood === 'cheer' ? Math.sin(this.moodTime * 7.5) * 0.4 : 0), dt);
      const az = this.tiltZ.step(clamp(-f.lean * 2.2, -0.7, 0.7), dt);
      this.topper.rotation.set(ax, 0, az);
    }
    if (this.spin) {
      this.propeller += dt * (4 + f.speed01 * 40);
      this.spin.rotation.y = this.propeller;
    }
    this.updateScarf(f, t);
  }

  private lookAmount = 0;

  private updateScarf(f: DriverFrame, t: number): void {
    const p = this.scarfPos;
    if (!p || !this.scarf) return;
    // From the top-back of the helmet: droop back at rest, stream out flat at speed.
    const speed = clamp(f.speed01 * 1.3, 0, 1);
    const flutterAmp = 0.012 + speed * 0.04;
    const flutterHz = 6 + speed * 14;
    const perStrip = (SCARF_SEGMENTS + 1) * 2;
    STREAMERS.forEach((x0, sIdx) => {
      const phase = sIdx * 1.7;
      let x = x0;
      let y = STREAMER_ANCHOR.y;
      let z = STREAMER_ANCHOR.z;
      for (let i = 0; i <= SCARF_SEGMENTS; i++) {
        const k = i / SCARF_SEGMENTS;
        if (i > 0) {
          // Rest: hang down behind the seat; speed: stream back over the engine, lifting slightly.
          const dirY = -(1 - speed) * (0.9 + k * 0.5) + speed * (0.12 + k * 0.1) + f.accel * 0.002;
          const dirZ = -(0.35 + speed * 0.9);
          const len = Math.hypot(dirY, dirZ);
          y += (dirY / len) * SCARF_LENGTH;
          z += (dirZ / len) * SCARF_LENGTH;
          x += Math.sin(t * flutterHz - i * 0.9 + phase) * flutterAmp * k - f.lean * 0.03;
        }
        const flutterY = Math.sin(t * flutterHz * 0.8 - i * 1.1 + phase) * flutterAmp * 0.7 * k;
        const w = SCARF_WIDTH * (1 - k * 0.45) * 0.5;
        const o = (sIdx * perStrip + i * 2) * 3;
        p[o] = x - w;
        p[o + 1] = y + flutterY;
        p[o + 2] = z;
        p[o + 3] = x + w;
        p[o + 4] = y + flutterY;
        p[o + 5] = z;
      }
    });
    const geo = this.scarf.geometry;
    geo.attributes.position!.needsUpdate = true;
    geo.computeVertexNormals();
  }
}
