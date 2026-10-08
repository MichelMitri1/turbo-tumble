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
  private readonly peak: Float32Array;
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
    this.peak = new Float32Array(max).fill(1);
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

  emit(p: THREE.Vector3, v: THREE.Vector3, c0: THREE.Color, c1: THREE.Color, size: number, life: number, opts: { grow?: number; drag?: number; grav?: number; alpha?: number } = {}): void {
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
    this.peak[i] = opts.alpha ?? 1;
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
      this.alpha[i] = l > 0 ? Math.min(1, (1 - t) * 1.6) * this.peak[i]! : 0;
    }
    const g = this.points.geometry;
    for (const n of ['position', 'color', 'size', 'alpha']) g.getAttribute(n).needsUpdate = true;
  }
}

const C = (r: number, g: number, b: number) => new THREE.Color(r, g, b);

/** Falling snow / drifting dust: a box of points that follows the camera and wraps around it. */
export interface WeatherSpec {
  kind: 'snow' | 'dust' | 'ash';
  count: number;
  color: [number, number, number];
  size: number;
  speed: number;
  drift: number;
}
class Weather {
  readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly seed: Float32Array;
  private readonly spec: WeatherSpec;
  private readonly box = new THREE.Vector3(70, 40, 70);
  private t = 0;

  constructor(spec: WeatherSpec, scale: number) {
    this.spec = spec;
    const n = spec.count;
    this.pos = new Float32Array(n * 3);
    this.seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.pos[i * 3] = (Math.random() - 0.5) * this.box.x;
      this.pos[i * 3 + 1] = Math.random() * this.box.y;
      this.pos[i * 3 + 2] = (Math.random() - 0.5) * this.box.z;
      this.seed[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('seed', new THREE.BufferAttribute(this.seed, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { scale: { value: scale }, uColor: { value: new THREE.Color(...spec.color) }, uSize: { value: spec.size }, uSoft: { value: spec.kind === 'snow' ? 0.25 : 0.9 } },
      vertexShader: `attribute float seed; varying float vS; uniform float scale; uniform float uSize;
        void main(){ vS = seed; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = min(uSize * (0.6 + seed * 0.8) * scale / max(0.1, -mv.z), 9.0); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vS; uniform vec3 uColor; uniform float uSoft;
        void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d,d) * 4.0; if (r > 1.0) discard; float a = pow(1.0 - r, 1.0 + uSoft * 2.0); gl_FragColor = vec4(uColor, a * (0.35 + vS * 0.45) * (1.0 - uSoft * 0.7)); }`,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
  }

  setScale(px: number): void {
    (this.points.material as THREE.ShaderMaterial).uniforms.scale!.value = px;
  }

  update(dt: number, cam: THREE.Vector3): void {
    this.t += dt;
    const sp = this.spec;
    const { x: bx, y: by, z: bz } = this.box;
    // Points live in a box centred on the camera; re-centre it as the camera moves.
    const p = this.points.position;
    p.set(cam.x, cam.y - by * 0.35, cam.z);
    const n = sp.count;
    for (let i = 0; i < n; i++) {
      const j = i * 3;
      const s = this.seed[i]!;
      const fall = sp.kind === 'dust' ? -0.1 + Math.sin(this.t * 0.7 + s * 9) * 0.3 : sp.speed * (0.7 + s * 0.6);
      let x = this.pos[j]! + (Math.sin(this.t * (0.8 + s) + s * 20) * sp.drift + sp.drift * 0.6) * dt;
      let y = this.pos[j + 1]! - fall * dt;
      let z = this.pos[j + 2]! + Math.cos(this.t * (0.6 + s * 0.5) + s * 11) * sp.drift * dt;
      // Wrap inside the box.
      if (y < 0) y += by;
      if (y > by) y -= by;
      if (x < -bx / 2) x += bx;
      else if (x > bx / 2) x -= bx;
      if (z < -bz / 2) z += bz;
      else if (z > bz / 2) z -= bz;
      this.pos[j] = x;
      this.pos[j + 1] = y;
      this.pos[j + 2] = z;
    }
    this.points.geometry.getAttribute('position').needsUpdate = true;
  }

  dispose(): void {
    this.points.removeFromParent();
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

/** Tyre marks: a ring buffer of quads laid on the surface that fade out. */
class SkidPool {
  readonly mesh: THREE.Mesh;
  private readonly pos: Float32Array;
  private readonly alpha: Float32Array;
  private readonly age: Float32Array;
  private next = 0;
  private readonly tail = new Map<string, THREE.Vector3>();

  constructor(readonly max: number) {
    this.pos = new Float32Array(max * 4 * 3);
    this.alpha = new Float32Array(max * 4);
    this.age = new Float32Array(max).fill(99);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const idx = new Uint32Array(max * 6);
    for (let i = 0; i < max; i++) idx.set([i * 4, i * 4 + 2, i * 4 + 1, i * 4, i * 4 + 3, i * 4 + 2], i * 6);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying float vA; void main(){ gl_FragColor = vec4(0.03, 0.03, 0.035, vA * 0.55); }',
    });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  /** Extend the mark for `key` to `at` (surface normal `n`), or start a new one. */
  mark(key: string, at: THREE.Vector3, n: THREE.Vector3, width: number): void {
    const prev = this.tail.get(key);
    if (!prev) {
      this.tail.set(key, at.clone());
      return;
    }
    const d = v1.copy(at).sub(prev);
    const len = d.length();
    if (len < 0.25) return;
    if (len > 3) {
      prev.copy(at);
      return;
    }
    const side = v2.crossVectors(d.normalize(), n).normalize().multiplyScalar(width / 2);
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    const o = i * 12;
    const lift = 0.012;
    this.pos.set([prev.x - side.x + n.x * lift, prev.y - side.y + n.y * lift, prev.z - side.z + n.z * lift, prev.x + side.x + n.x * lift, prev.y + side.y + n.y * lift, prev.z + side.z + n.z * lift, at.x + side.x + n.x * lift, at.y + side.y + n.y * lift, at.z + side.z + n.z * lift, at.x - side.x + n.x * lift, at.y - side.y + n.y * lift, at.z - side.z + n.z * lift], o);
    this.age[i] = 0;
    prev.copy(at);
  }

  /** Stop the mark for `key` (lifting off / straightening up). */
  end(key: string): void {
    this.tail.delete(key);
  }

  update(dt: number): void {
    for (let i = 0; i < this.max; i++) {
      const a = (this.age[i]! += dt);
      const k = a < 14 ? Math.min(1, (14 - a) / 6) : 0;
      this.alpha.fill(k, i * 4, i * 4 + 4);
    }
    const g = this.mesh.geometry;
    g.getAttribute('position').needsUpdate = true;
    g.getAttribute('alpha').needsUpdate = true;
  }
}

/** A short ribbon trailing a point (supersonic streaks): a strip through the last N positions. */
class Ribbon {
  readonly mesh: THREE.Mesh;
  private readonly hist: THREE.Vector3[] = [];
  private readonly pos: Float32Array;
  private readonly alpha: Float32Array;
  private readonly side = new THREE.Vector3();
  idle = 0;
  fade = 0;

  constructor(
    readonly n: number,
    color: THREE.Color,
  ) {
    this.pos = new Float32Array(n * 2 * 3);
    this.alpha = new Float32Array(n * 2);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let i = 0; i < n - 1; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    g.setIndex(idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: color } },
      vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying float vA; uniform vec3 uColor; void main(){ gl_FragColor = vec4(uColor, vA); }',
    });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
  }

  /** Push the head position (`up` = car up, the ribbon is a vertical blade). */
  push(at: THREE.Vector3, up: THREE.Vector3, width: number): void {
    this.hist.unshift(at.clone());
    if (this.hist.length > this.n) this.hist.length = this.n;
    this.rebuild(up, width);
  }

  private rebuild(up: THREE.Vector3, width: number): void {
    const h = this.hist;
    this.side.copy(up).multiplyScalar(width / 2);
    for (let i = 0; i < this.n; i++) {
      const p = h[Math.min(i, h.length - 1)] ?? ZERO;
      const t = 1 - i / (this.n - 1);
      const w = this.side.clone().multiplyScalar(0.3 + t * 0.7);
      this.pos.set([p.x - w.x, p.y - w.y, p.z - w.z, p.x + w.x, p.y + w.y, p.z + w.z], i * 6);
      const a = t * t * 0.7 * this.fade;
      this.alpha[i * 2] = a;
      this.alpha[i * 2 + 1] = a;
    }
    const g = this.mesh.geometry;
    g.getAttribute('position').needsUpdate = true;
    g.getAttribute('alpha').needsUpdate = true;
  }

  /** Let the tail catch up when the head stops (keeps pushing the last point). */
  settle(up: THREE.Vector3, width: number): void {
    const last = this.hist[0];
    if (last) this.push(last, up, width);
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
const ZERO = new THREE.Vector3();

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
  private readonly skids = new SkidPool(1500);
  private readonly ribbons = new Map<string, Ribbon>();
  private readonly shocks: Array<{ mesh: THREE.Mesh; t: number; dur: number; size: number }> = [];
  private readonly flash: THREE.PointLight;
  private flashT = 0;
  private weather: Weather | null = null;
  private pointScale = 600;
  /** Delayed bursts (fireworks). */
  private readonly timers: Array<{ t: number; fn: () => void }> = [];
  explosion: ExplosionFx = { ...DEFAULT_EXPLOSION };

  constructor() {
    this.group.add(this.smoke.points, this.glow.points, this.skids.mesh);
    this.flash = new THREE.PointLight(0xffffff, 0, 60, 1.4);
    this.group.add(this.flash);
  }

  resize(heightPx: number, fovY: number): void {
    const s = heightPx / (2 * Math.tan((fovY * Math.PI) / 360));
    this.pointScale = s;
    this.glow.setScale(s);
    this.smoke.setScale(s);
    this.weather?.setScale(s);
  }

  /** Arena weather (null = clear). */
  setWeather(spec: WeatherSpec | null): void {
    this.weather?.dispose();
    this.weather = spec ? new Weather(spec, this.pointScale) : null;
    if (this.weather) this.group.add(this.weather.points);
  }

  /** Tyre mark for a wheel on the surface (`n` = surface normal); call `skidEnd` when it stops. */
  skid(key: string, at: THREE.Vector3, n: THREE.Vector3): void {
    this.skids.mark(key, at, n, 0.14);
  }
  skidEnd(key: string): void {
    this.skids.end(key);
  }

  /** Supersonic ribbon behind a wheel (`up` = car up); fades once `active` goes false. */
  ribbon(key: string, at: THREE.Vector3, up: THREE.Vector3, active: boolean, team: 0 | 1): void {
    let r = this.ribbons.get(key);
    if (!r) {
      if (!active) return;
      r = new Ribbon(14, team === 0 ? C(0.8, 1, 1.8) : C(1.8, 1.1, 0.6));
      this.ribbons.set(key, r);
      this.group.add(r.mesh);
    }
    r.idle = 0;
    r.fade = active ? Math.min(1, r.fade + 0.2) : Math.max(0, r.fade - 0.1);
    if (active) r.push(at, up, 0.16);
    else r.settle(up, 0.16);
  }

  /** Landing after a long air time: a dust ring. */
  land(at: THREE.Vector3, strength: number): void {
    const n = Math.round(10 + strength * 14);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      v1.set(Math.cos(a) * (2 + Math.random() * 2), 0.3 + Math.random() * 0.8, Math.sin(a) * (2 + Math.random() * 2));
      this.smoke.emit(at, v1, C(0.62, 0.6, 0.55), C(0.35, 0.35, 0.33), 0.22 + strength * 0.1, 0.45 + Math.random() * 0.3, { grow: 2.5, drag: 3, alpha: 0.55 });
    }
  }

  /** Grinding sparks (wall driving). */
  sparks(at: THREE.Vector3, vel: THREE.Vector3): void {
    for (let i = 0; i < 3; i++) {
      v1.copy(vel).multiplyScalar(-0.15).add(v2.set(rnd(2.5), 1 + Math.random() * 2.5, rnd(2.5)));
      this.glow.emit(at, v1, C(2.5, 1.8, 0.8), C(1.4, 0.4, 0.05), 0.05 + Math.random() * 0.04, 0.25 + Math.random() * 0.3, { drag: 1.5, grav: 9 });
    }
  }

  /** Flip reset: a quick white ring around the car. */
  flipReset(at: THREE.Vector3): void {
    this.ring(at, C(1.2, 1.6, 2.2), 2.6, 0.35, false);
    for (let i = 0; i < 14; i++) {
      v1.set(rnd(1), rnd(1), rnd(1)).normalize().multiplyScalar(2 + Math.random() * 3);
      this.glow.emit(at, v1, C(1.6, 1.9, 2.4), C(0.5, 0.8, 1.6), 0.1, 0.3, { drag: 3 });
    }
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
      this.smoke.emit(at, v1, C(0.32, 0.33, 0.38), C(0.15, 0.15, 0.17), 0.12, 0.5, { grow: 2.5, drag: 2, alpha: 0.45 });
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
  private ring(at: THREE.Vector3, color: THREE.Color, size: number, dur: number, floor = true): void {
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 8, 64), new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(0.8), transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    mesh.rotation.x = Math.PI / 2;
    mesh.position.copy(at);
    if (floor) mesh.position.y = Math.max(0.3, at.y * 0.3);
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

  update(dt: number, cam: THREE.Vector3): void {
    this.skids.update(dt);
    for (const [k, r] of this.ribbons) {
      r.idle += dt;
      if (r.idle > 1.5) {
        r.dispose();
        this.ribbons.delete(k);
      }
    }
    this.weather?.update(dt, cam);
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
