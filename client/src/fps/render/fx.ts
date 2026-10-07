import * as THREE from 'three';

/** Bullet tracers, impacts (sparks / dust / blood), decals, explosions. */
class Particles {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private base: Float32Array;
  private alpha: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private max: Float32Array;
  private grow: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private c0: Float32Array;
  private c1: Float32Array;
  private next = 0;
  constructor(
    readonly n: number,
    additive: boolean,
  ) {
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.c0 = new Float32Array(n * 3);
    this.c1 = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.base = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.life = new Float32Array(n);
    this.max = new Float32Array(n);
    this.grow = new Float32Array(n);
    this.grav = new Float32Array(n);
    this.drag = new Float32Array(n);
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
      uniforms: { scale: { value: 800 } },
      vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; varying vec3 vC; varying float vA; uniform float scale;
        void main(){ vC = color; vA = alpha; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * scale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec3 vC; varying float vA; void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d,d) * 4.0; if (r > 1.0) discard; float a = 1.0 - r; gl_FragColor = vec4(vC, vA * a * a); }`,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
  }
  setScale(s: number): void {
    (this.points.material as THREE.ShaderMaterial).uniforms.scale!.value = s;
  }
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, c0: THREE.Color, c1: THREE.Color, size: number, life: number, grow = 0, grav = 0, drag = 0): void {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.c0.set([c0.r, c0.g, c0.b], i * 3);
    this.c1.set([c1.r, c1.g, c1.b], i * 3);
    this.size[i] = size;
    this.base[i] = size;
    this.life[i] = this.max[i] = life;
    this.grow[i] = grow;
    this.grav[i] = grav;
    this.drag[i] = drag;
  }
  update(dt: number): void {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i]! <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      const l = (this.life[i]! -= dt);
      const t = 1 - Math.max(0, l) / this.max[i]!;
      const k = Math.exp(-this.drag[i]! * dt);
      const j = i * 3;
      this.vel[j]! *= k;
      this.vel[j + 1] = this.vel[j + 1]! * k - this.grav[i]! * dt;
      this.vel[j + 2]! *= k;
      this.pos[j]! += this.vel[j]! * dt;
      this.pos[j + 1]! += this.vel[j + 1]! * dt;
      this.pos[j + 2]! += this.vel[j + 2]! * dt;
      for (let c = 0; c < 3; c++) this.col[j + c] = this.c0[j + c]! + (this.c1[j + c]! - this.c0[j + c]!) * t;
      this.alpha[i] = l > 0 ? Math.min(1, (1 - t) * 1.5) : 0;
      this.size[i] = this.base[i]! * (1 + this.grow[i]! * t);
    }
    const g = this.points.geometry;
    for (const n of ['position', 'color', 'size', 'alpha']) g.getAttribute(n).needsUpdate = true;
  }
}

const C = (r: number, g: number, b: number) => new THREE.Color(r, g, b);
const rnd = (s: number) => (Math.random() - 0.5) * 2 * s;

export class Fx {
  readonly group = new THREE.Group();
  private glow = new Particles(3000, true);
  private smoke = new Particles(2000, false);
  private tracers: Array<{ line: THREE.Line; t: number }> = [];
  private tracerMat = new THREE.LineBasicMaterial({ color: new THREE.Color(3, 2.6, 1.6), transparent: true, opacity: 0.9 });
  private decals: THREE.Mesh[] = [];
  private decalMat: THREE.MeshBasicMaterial;
  private scorchMat: THREE.MeshBasicMaterial;
  private flashes: Array<{ light: THREE.PointLight; t: number; max: number; i: number }> = [];
  private sprites: Array<{ s: THREE.Sprite; t: number; max: number; size: number }> = [];
  private boomTex: THREE.Texture;
  private flashMat: THREE.SpriteMaterial;

  constructor() {
    this.group.add(this.smoke.points, this.glow.points);
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(10,10,10,0.95)');
    grd.addColorStop(0.35, 'rgba(25,22,20,0.8)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    this.decalMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    this.scorchMat = this.decalMat.clone();
    this.scorchMat.opacity = 0.75;
    const b = document.createElement('canvas');
    b.width = b.height = 128;
    const bg = b.getContext('2d')!;
    const bgrd = bg.createRadialGradient(64, 64, 0, 64, 64, 64);
    bgrd.addColorStop(0, 'rgba(255,250,220,1)');
    bgrd.addColorStop(0.3, 'rgba(255,170,60,0.95)');
    bgrd.addColorStop(0.7, 'rgba(200,60,10,0.5)');
    bgrd.addColorStop(1, 'rgba(0,0,0,0)');
    bg.fillStyle = bgrd;
    bg.fillRect(0, 0, 128, 128);
    this.boomTex = new THREE.CanvasTexture(b);
    this.flashMat = new THREE.SpriteMaterial({ map: this.boomTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  }

  resize(heightPx: number, fovY: number): void {
    const s = heightPx / (2 * Math.tan((fovY * Math.PI) / 360));
    this.glow.setScale(s);
    this.smoke.setScale(s);
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3, chance = 1): void {
    if (Math.random() > chance) return;
    // A short streak travelling along the path reads better than a full line.
    const d = to.clone().sub(from);
    const len = d.length();
    const a = from.clone().addScaledVector(d, Math.min(0.3, 1.5 / Math.max(1, len)));
    const g = new THREE.BufferGeometry().setFromPoints([a, to]);
    const line = new THREE.Line(g, this.tracerMat);
    this.group.add(line);
    this.tracers.push({ line, t: 0.06 });
  }

  impact(p: THREE.Vector3, n: THREE.Vector3, kind: 'metal' | 'dust' | 'wood' | 'blood'): void {
    if (kind === 'blood') {
      for (let i = 0; i < 14; i++) this.smoke.emit(p.x, p.y, p.z, rnd(1.2) + n.x, rnd(1.2) + 0.5, rnd(1.2) + n.z, C(0.55, 0.02, 0.02), C(0.3, 0, 0), 0.12 + Math.random() * 0.1, 0.35, 2, 3, 3);
      return;
    }
    if (kind === 'metal') for (let i = 0; i < 8; i++) this.glow.emit(p.x, p.y, p.z, n.x * 3 + rnd(3), n.y * 3 + rnd(3), n.z * 3 + rnd(3), C(3, 2.4, 1.2), C(1.5, 0.4, 0), 0.025, 0.25, 0, 9, 1);
    const dc = kind === 'wood' ? [C(0.45, 0.32, 0.2), C(0.3, 0.22, 0.15)] : [C(0.62, 0.58, 0.52), C(0.45, 0.42, 0.38)];
    for (let i = 0; i < 5; i++) this.smoke.emit(p.x + n.x * 0.05, p.y + n.y * 0.05, p.z + n.z * 0.05, n.x * 1.5 + rnd(0.6), n.y * 1.5 + rnd(0.6) + 0.3, n.z * 1.5 + rnd(0.6), dc[0]!, dc[1]!, 0.1, 0.6, 3, 0.5, 2.5);
    // Bullet hole.
    if (Math.abs(n.y) < 0.99 || n.y > 0.5) {
      const dec = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.09), this.decalMat);
      dec.position.copy(p).addScaledVector(n, 0.004);
      dec.lookAt(p.clone().add(n));
      this.group.add(dec);
      this.decals.push(dec);
      if (this.decals.length > 160) this.decals.shift()!.removeFromParent();
    }
  }

  muzzle(p: THREE.Vector3): void {
    this.glow.emit(p.x, p.y, p.z, 0, 0, 0, C(3, 2.2, 1), C(1, 0.4, 0), 0.35, 0.05);
    this.light(p, '#ffb060', 3, 0.05, 6);
  }

  explosion(p: THREE.Vector3, r: number): void {
    for (let i = 0; i < 70; i++) {
      const v = new THREE.Vector3(rnd(1), Math.random() * 0.9 + 0.1, rnd(1)).normalize().multiplyScalar(4 + Math.random() * 10);
      this.glow.emit(p.x, p.y + 0.3, p.z, v.x, v.y, v.z, C(3, 2, 0.8), C(1.2, 0.2, 0), 0.5 + Math.random() * 0.6, 0.45 + Math.random() * 0.4, 1.5, 6, 3);
    }
    for (let i = 0; i < 40; i++) {
      const v = new THREE.Vector3(rnd(1), Math.random() + 0.2, rnd(1)).normalize().multiplyScalar(1.5 + Math.random() * 4);
      this.smoke.emit(p.x + rnd(1), p.y + 0.5, p.z + rnd(1), v.x, v.y, v.z, C(0.25, 0.22, 0.2), C(0.12, 0.12, 0.12), 1.4 + Math.random(), 2.5 + Math.random() * 2, 2.5, -0.3, 1.2);
    }
    for (let i = 0; i < 24; i++) this.smoke.emit(p.x, p.y + 0.2, p.z, rnd(7), 4 + Math.random() * 6, rnd(7), C(0.2, 0.17, 0.12), C(0.1, 0.09, 0.08), 0.12, 1.4, 0, 14, 0.5);
    const s = new THREE.Sprite(this.flashMat);
    s.position.copy(p).add(new THREE.Vector3(0, 0.6, 0));
    this.group.add(s);
    this.sprites.push({ s, t: 0, max: 0.35, size: r * 1.2 });
    this.light(p.clone().add(new THREE.Vector3(0, 1, 0)), '#ff9a40', 60, 0.5, r * 4);
    // Scorch mark.
    const sc = new THREE.Mesh(new THREE.CircleGeometry(r * 0.45, 20), this.scorchMat);
    sc.rotation.x = -Math.PI / 2;
    sc.position.set(p.x, Math.max(0.02, p.y - 0.4 > 0.1 ? p.y - 0.4 : 0.02), p.z);
    this.group.add(sc);
    this.decals.push(sc);
  }

  private light(p: THREE.Vector3, color: string, intensity: number, dur: number, dist: number): void {
    const l = new THREE.PointLight(color, intensity, dist, 2);
    l.position.copy(p);
    this.group.add(l);
    this.flashes.push({ light: l, t: dur, max: dur, i: intensity });
    if (this.flashes.length > 6) {
      const old = this.flashes.shift()!;
      old.light.removeFromParent();
    }
  }

  update(dt: number): void {
    this.glow.update(dt);
    this.smoke.update(dt);
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i]!;
      t.t -= dt;
      if (t.t <= 0) {
        t.line.removeFromParent();
        t.line.geometry.dispose();
        this.tracers.splice(i, 1);
      }
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i]!;
      f.t -= dt;
      f.light.intensity = Math.max(0, f.i * (f.t / f.max));
      if (f.t <= 0) {
        f.light.removeFromParent();
        this.flashes.splice(i, 1);
      }
    }
    for (let i = this.sprites.length - 1; i >= 0; i--) {
      const s = this.sprites[i]!;
      s.t += dt;
      const k = s.t / s.max;
      s.s.scale.setScalar(s.size * (0.4 + k));
      s.s.material.opacity = 1 - k;
      if (k >= 1) {
        s.s.removeFromParent();
        this.sprites.splice(i, 1);
      }
    }
  }
}
