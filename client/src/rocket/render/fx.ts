import * as THREE from 'three';

/** A CPU particle pool drawn as soft round sprites. */
class Pool {
  readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly baseSize: Float32Array;
  private readonly grow: Float32Array;
  private readonly drag: Float32Array;
  private readonly grav: Float32Array;
  private readonly baseCol: Float32Array;
  private readonly endCol: Float32Array;
  private next = 0;

  constructor(
    readonly max: number,
    additive: boolean,
  ) {
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.baseCol = new Float32Array(max * 3);
    this.endCol = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.baseSize = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { scale: { value: 600 } },
      vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; varying vec3 vC; varying float vA; uniform float scale;
        void main(){ vC = color; vA = alpha; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * scale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec3 vC; varying float vA;
        void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d,d) * 4.0; if (r > 1.0) discard; float a = (1.0 - r); a *= a; gl_FragColor = vec4(vC, vA * a); }`,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  setScale(px: number): void {
    (this.points.material as THREE.ShaderMaterial).uniforms.scale!.value = px;
  }

  emit(p: THREE.Vector3, v: THREE.Vector3, c0: THREE.Color, c1: THREE.Color, size: number, life: number, opts: { grow?: number; drag?: number; grav?: number } = {}): void {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.baseCol.set([c0.r, c0.g, c0.b], i * 3);
    this.endCol.set([c1.r, c1.g, c1.b], i * 3);
    this.life[i] = life;
    this.maxLife[i] = life;
    this.baseSize[i] = size;
    this.grow[i] = opts.grow ?? 0;
    this.drag[i] = opts.drag ?? 0;
    this.grav[i] = opts.grav ?? 0;
  }

  update(dt: number): void {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i]! <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      const l = (this.life[i]! -= dt);
      const t = 1 - Math.max(0, l) / this.maxLife[i]!;
      const k = Math.exp(-this.drag[i]! * dt);
      const j = i * 3;
      this.vel[j]! *= k;
      this.vel[j + 1] = this.vel[j + 1]! * k - this.grav[i]! * dt;
      this.vel[j + 2]! *= k;
      this.pos[j]! += this.vel[j]! * dt;
      this.pos[j + 1]! += this.vel[j + 1]! * dt;
      this.pos[j + 2]! += this.vel[j + 2]! * dt;
      for (let c = 0; c < 3; c++) this.col[j + c] = this.baseCol[j + c]! + (this.endCol[j + c]! - this.baseCol[j + c]!) * t;
      this.size[i] = this.baseSize[i]! * (1 + this.grow[i]! * t);
      this.alpha[i] = l > 0 ? Math.min(1, (1 - t) * 1.6) : 0;
    }
    const g = this.points.geometry;
    for (const n of ['position', 'color', 'size', 'alpha']) g.getAttribute(n).needsUpdate = true;
  }
}

const C = (r: number, g: number, b: number) => new THREE.Color(r, g, b);

export type ExplosionStyle = 'classic' | 'fireworks' | 'shockwave' | 'vortex' | 'none';
export type ExplosionColor = 'team' | 'gold' | 'rainbow' | 'white';
/** Visual goal-explosion settings (the knock-back itself lives in the sim rules). */
export interface ExplosionFx {
  style: ExplosionStyle;
  color: ExplosionColor;
  /** Overall scale of the blast. */
  size: number;
  /** Particle count multiplier. */
  density: number;
  /** Camera shake strength (0 = off). */
  shake: number;
}
export const DEFAULT_EXPLOSION: ExplosionFx = { style: 'classic', color: 'team', size: 1, density: 1, shake: 1 };
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const rnd = (s: number) => (Math.random() - 0.5) * 2 * s;

/** All the particle effects: boost, supersonic, hits, demos, goal explosions. */
export class Fx {
  readonly group = new THREE.Group();
  private readonly glow = new Pool(9000, true);
  private readonly smoke = new Pool(2500, false);
  private readonly shocks: Array<{ mesh: THREE.Mesh; t: number; dur: number; size: number }> = [];
  private readonly flash: THREE.PointLight;
  private flashT = 0;
  /** Delayed bursts (fireworks). */
  private readonly timers: Array<{ t: number; fn: () => void }> = [];
  explosion: ExplosionFx = { ...DEFAULT_EXPLOSION };

  constructor() {
    this.group.add(this.smoke.points, this.glow.points);
    this.flash = new THREE.PointLight(0xffffff, 0, 60, 1.4);
    this.group.add(this.flash);
  }

  resize(heightPx: number, fovY: number): void {
    const s = heightPx / (2 * Math.tan((fovY * Math.PI) / 360));
    this.glow.setScale(s);
    this.smoke.setScale(s);
  }

  /** Boost flame particles behind a car (world-space exhaust and backward direction). */
  boost(at: THREE.Vector3, back: THREE.Vector3, carVel: THREE.Vector3, team: 0 | 1): void {
    for (let i = 0; i < 3; i++) {
      v1.copy(back).multiplyScalar(4 + Math.random() * 3).add(carVel).add(v2.set(rnd(0.6), rnd(0.6), rnd(0.6)));
      const hot = team === 0 ? C(0.9, 0.95, 1.6) : C(2, 1.3, 0.5);
      this.glow.emit(at, v1, hot, team === 0 ? C(0.1, 0.25, 1.2) : C(1.2, 0.2, 0.02), 0.2, 0.2 + Math.random() * 0.12, { grow: 1.6, drag: 4 });
    }
    if (Math.random() < 0.3) {
      v1.copy(back).multiplyScalar(2).add(carVel.clone().multiplyScalar(0.5)).add(v2.set(rnd(0.5), rnd(0.5) + 0.3, rnd(0.5)));
      this.smoke.emit(at, v1, C(0.32, 0.33, 0.38), C(0.15, 0.15, 0.17), 0.3, 0.55, { grow: 3, drag: 2 });
    }
  }

  /** Supersonic streaks from the rear wheels. */
  supersonic(at: THREE.Vector3, carVel: THREE.Vector3): void {
    v1.copy(carVel).multiplyScalar(0.9);
    this.glow.emit(at, v1, C(1.6, 1.6, 1.8), C(0.4, 0.5, 0.9), 0.13, 0.35, { drag: 0.5 });
  }

  /** Wheel dust / sparks when powersliding fast. */
  slide(at: THREE.Vector3): void {
    this.smoke.emit(at, v1.set(rnd(0.6), 0.4 + Math.random() * 0.6, rnd(0.6)), C(0.6, 0.65, 0.55), C(0.3, 0.32, 0.3), 0.25, 0.5, { grow: 2.5, drag: 2 });
  }

  hit(at: THREE.Vector3, power: number, team: 0 | 1): void {
    const n = Math.min(40, 6 + power / 80);
    const c = team === 0 ? C(0.8, 1.1, 2.2) : C(2.2, 1.2, 0.4);
    for (let i = 0; i < n; i++) {
      v1.set(rnd(1), rnd(1), rnd(1)).normalize().multiplyScalar(3 + Math.random() * (power / 300));
      this.glow.emit(at, v1, C(2, 2, 2), c, 0.12, 0.25 + Math.random() * 0.2, { drag: 3 });
    }
  }

  padPickup(at: THREE.Vector3, big: boolean): void {
    for (let i = 0; i < (big ? 40 : 12); i++) {
      v1.set(rnd(1.5), 2 + Math.random() * (big ? 6 : 3), rnd(1.5));
      this.glow.emit(at, v1, C(2.2, 1.4, 0.3), C(1, 0.3, 0), big ? 0.25 : 0.15, 0.5, { drag: 2.5 });
    }
  }

  jump(at: THREE.Vector3): void {
    for (let i = 0; i < 8; i++) this.smoke.emit(at, v1.set(rnd(2), Math.random() * 0.6, rnd(2)), C(0.7, 0.72, 0.68), C(0.4, 0.4, 0.4), 0.35, 0.5, { grow: 2, drag: 3 });
  }

  demo(at: THREE.Vector3, team: 0 | 1): void {
    const c = team === 0 ? C(0.6, 0.9, 2.5) : C(2.5, 1.2, 0.3);
    for (let i = 0; i < 160; i++) {
      v1.set(rnd(1), rnd(1) + 0.4, rnd(1)).normalize().multiplyScalar(4 + Math.random() * 12);
      this.glow.emit(at, v1, C(2.5, 2.2, 1.6), c, 0.35, 0.5 + Math.random() * 0.5, { drag: 2.5, grav: 4 });
    }
    for (let i = 0; i < 50; i++) {
      v1.set(rnd(1), Math.random() + 0.2, rnd(1)).normalize().multiplyScalar(2 + Math.random() * 4);
      this.smoke.emit(at, v1, C(0.25, 0.22, 0.2), C(0.08, 0.08, 0.08), 0.9, 1.4 + Math.random(), { grow: 2.5, drag: 1.6 });
    }
    this.shock(at, c, 4, 0.5);
    this.flashAt(at, c, 30);
  }

  /** Explosion colour for a particle (team / gold / rainbow / white). */
  private blastColor(team: 0 | 1, i: number): THREE.Color {
    switch (this.explosion.color) {
      case 'gold':
        return Math.random() < 0.5 ? C(3, 2.2, 0.6) : C(2.6, 1.4, 0.25);
      case 'white':
        return C(2.6, 2.7, 3);
      case 'rainbow':
        return new THREE.Color().setHSL((i * 0.137 + Math.random() * 0.1) % 1, 1, 0.55).multiplyScalar(3);
      default:
        return team === 0 ? C(0.5, 0.9, 3) : C(3, 1.3, 0.3);
    }
  }

  goal(at: THREE.Vector3, team: 0 | 1, speed: number): void {
    const o = this.explosion;
    if (o.style === 'none') return;
    const sz = Math.max(0.2, o.size);
    const dens = Math.max(0.1, o.density);
    const main = this.blastColor(team, 0);
    switch (o.style) {
      case 'fireworks': {
        // A big launch, then shells bursting overhead.
        this.burst(at, team, Math.round(500 * dens), (10 + speed / 400) * sz, 0.35 * sz, 1.2);
        for (let k = 0; k < 6; k++) {
          const p = at.clone().add(v2.set(rnd(12) * sz, (8 + Math.random() * 10) * sz, rnd(12) * sz));
          this.later(0.25 + k * 0.22, () => {
            this.burst(p, team, Math.round(260 * dens), 9 * sz, 0.3 * sz, 1.5, k + 1);
            this.shock(p, this.blastColor(team, k + 1), 6 * sz, 0.4);
            this.flashAt(p, this.blastColor(team, k + 1), 60);
          });
        }
        this.flashAt(at, main, 120);
        break;
      }
      case 'shockwave': {
        // Flat rings racing along the floor plus a bright core.
        this.burst(at, team, Math.round(400 * dens), 8 * sz, 0.4 * sz, 0.9);
        for (let k = 0; k < 3; k++) this.later(k * 0.12, () => this.ring(at, this.blastColor(team, k), 34 * sz, 1.1));
        const ringN = Math.round(600 * dens);
        for (let i = 0; i < ringN; i++) {
          const a = (i / ringN) * Math.PI * 2;
          v1.set(Math.cos(a), 0.05 + Math.random() * 0.15, Math.sin(a)).multiplyScalar((18 + Math.random() * 8) * sz);
          this.glow.emit(at, v1, C(3, 3, 3), this.blastColor(team, i), 0.35 * sz, 0.9 + Math.random() * 0.5, { drag: 1.6 });
        }
        this.shock(at, main, 20 * sz, 0.7);
        this.flashAt(at, main, 180);
        break;
      }
      case 'vortex': {
        // A spinning column of fire rising out of the goal.
        const n = Math.round(1400 * dens);
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2;
          const r = (1 + Math.random() * 4) * sz;
          const up = (6 + Math.random() * 18) * sz;
          v1.set(-Math.sin(a) * r * 3, up, Math.cos(a) * r * 3).add(v2.set(Math.cos(a) * r, 0, Math.sin(a) * r));
          this.glow.emit(at, v1, Math.random() < 0.25 ? C(3, 3, 3) : this.blastColor(team, i), this.blastColor(team, i).multiplyScalar(0.25), (0.35 + Math.random() * 0.35) * sz, 1 + Math.random() * 1.2, { drag: 1.2, grav: -1 });
        }
        this.shock(at, main, 14 * sz, 0.6);
        this.flashAt(at, main, 150);
        break;
      }
      default: {
        const n = (900 + Math.min(1500, speed / 2)) * dens;
        for (let i = 0; i < n; i++) {
          v1.set(rnd(1), rnd(1), rnd(1)).normalize().multiplyScalar((6 + Math.random() * (20 + speed / 200)) * sz);
          const c = this.blastColor(team, i);
          this.glow.emit(at, v1, Math.random() < 0.3 ? C(3, 3, 3) : c, c.clone().multiplyScalar(0.3), (0.45 + Math.random() * 0.4) * sz, 0.8 + Math.random() * 1.2, { drag: 1.8, grav: 3 });
        }
        this.shock(at, main, 26 * sz, 0.9);
        this.shock(at, C(3, 3, 3), 12 * sz, 0.45);
        this.flashAt(at, main, 160);
      }
    }
    const smokeN = Math.round(120 * dens);
    for (let i = 0; i < smokeN; i++) {
      v1.set(rnd(1), rnd(1), rnd(1)).normalize().multiplyScalar((3 + Math.random() * 8) * sz);
      this.smoke.emit(at, v1, C(0.4, 0.4, 0.45), C(0.1, 0.1, 0.12), 2.2 * sz, 2 + Math.random() * 1.5, { grow: 2, drag: 1.4 });
    }
  }

  /** A spherical burst of sparks. */
  private burst(at: THREE.Vector3, team: 0 | 1, n: number, speed: number, size: number, life: number, colorSeed = 0): void {
    for (let i = 0; i < n; i++) {
      v1.set(rnd(1), rnd(1), rnd(1)).normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.6));
      const c = this.blastColor(team, colorSeed * 7 + (colorSeed ? 0 : i));
      this.glow.emit(at, v1, Math.random() < 0.3 ? C(3, 3, 3) : c, c.clone().multiplyScalar(0.25), size * (0.7 + Math.random() * 0.6), life * (0.6 + Math.random() * 0.6), { drag: 1.5, grav: 2.5 });
    }
  }

  /** A flat expanding ring along the floor. */
  private ring(at: THREE.Vector3, color: THREE.Color, size: number, dur: number): void {
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 8, 64), new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(0.8), transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    mesh.rotation.x = Math.PI / 2;
    mesh.position.copy(at).setY(Math.max(0.3, at.y * 0.3));
    this.group.add(mesh);
    this.shocks.push({ mesh, t: 0, dur, size });
  }

  private later(t: number, fn: () => void): void {
    this.timers.push({ t, fn });
  }

  private shock(at: THREE.Vector3, color: THREE.Color, size: number, dur: number): void {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(0.5), transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    mesh.position.copy(at);
    this.group.add(mesh);
    this.shocks.push({ mesh, t: 0, dur, size });
  }

  private flashAt(at: THREE.Vector3, color: THREE.Color, intensity: number): void {
    this.flash.position.copy(at);
    this.flash.color.copy(color).multiplyScalar(1 / Math.max(color.r, color.g, color.b));
    this.flash.intensity = intensity;
    this.flashT = 1;
  }

  update(dt: number): void {
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const tm = this.timers[i]!;
      tm.t -= dt;
      if (tm.t <= 0) {
        this.timers.splice(i, 1);
        tm.fn();
      }
    }
    this.glow.update(dt);
    this.smoke.update(dt);
    for (let i = this.shocks.length - 1; i >= 0; i--) {
      const s = this.shocks[i]!;
      s.t += dt;
      const k = s.t / s.dur;
      if (k >= 1) {
        s.mesh.removeFromParent();
        s.mesh.geometry.dispose();
        (s.mesh.material as THREE.Material).dispose();
        this.shocks.splice(i, 1);
        continue;
      }
      s.mesh.scale.setScalar(s.size * (1 - (1 - k) ** 3));
      (s.mesh.material as THREE.MeshBasicMaterial).opacity = 0.45 * (1 - k) ** 2;
    }
    if (this.flashT > 0) {
      this.flashT = Math.max(0, this.flashT - dt * 1.6);
      this.flash.intensity *= this.flashT > 0 ? 0.9 : 0;
    }
  }
}
