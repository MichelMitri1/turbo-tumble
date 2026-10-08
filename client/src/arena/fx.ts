import * as THREE from 'three';

/**
 * One-draw-call particle systems (additive glow + normal dust/smoke) with a soft
 * round sprite, plus helpers for bursts, rings and trails.
 */

const VERT = /* glsl */ `
  attribute float size;
  attribute float alpha;
  attribute vec3 tint;
  varying float vAlpha;
  varying vec3 vTint;
  uniform float scale;
  void main() {
    vAlpha = alpha;
    vTint = tint;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * scale / -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;
const FRAG = /* glsl */ `
  varying float vAlpha;
  varying vec3 vTint;
  uniform float softness;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0;
    float a = smoothstep(1.0, softness, d) * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vTint, a);
  }`;

interface P {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; max: number;
  size: number; grow: number;
  r: number; g: number; b: number;
  gravity: number; drag: number;
  alpha: number;
}

export class Particles {
  readonly points: THREE.Points;
  private readonly list: P[] = [];
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly sz: Float32Array;
  private readonly al: Float32Array;
  private readonly geo = new THREE.BufferGeometry();
  private readonly tmp = new THREE.Color();

  constructor(private readonly max: number, additive: boolean, softness = 0.2) {
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.sz = new Float32Array(max);
    this.al = new Float32Array(max);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('tint', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.sz, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.al, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { scale: { value: 400 }, softness: { value: softness } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 20 : 19;
  }

  setScale(px: number): void {
    (this.points.material as THREE.ShaderMaterial).uniforms.scale!.value = px;
  }

  emit(o: { x: number; y: number; z: number; vx?: number; vy?: number; vz?: number; life?: number; size?: number; grow?: number; color: string | THREE.Color; gravity?: number; drag?: number; alpha?: number }): void {
    if (this.list.length >= this.max) this.list.shift();
    const c = typeof o.color === 'string' ? this.tmp.set(o.color) : o.color;
    const life = o.life ?? 0.6;
    this.list.push({ x: o.x, y: o.y, z: o.z, vx: o.vx ?? 0, vy: o.vy ?? 0, vz: o.vz ?? 0, life, max: life, size: o.size ?? 0.4, grow: o.grow ?? 0, r: c.r, g: c.g, b: c.b, gravity: o.gravity ?? 0, drag: o.drag ?? 0, alpha: o.alpha ?? 1 });
  }

  /** Radial burst. */
  burst(x: number, y: number, z: number, n: number, color: string, speed = 3, opts: { life?: number; size?: number; up?: number; gravity?: number; grow?: number; spread?: number } = {}): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      const sp = opts.spread ?? 0.2;
      this.emit({
        x: x + (Math.random() - 0.5) * sp, y, z: z + (Math.random() - 0.5) * sp,
        vx: Math.cos(a) * s, vy: (opts.up ?? 1.5) * (0.5 + Math.random()), vz: Math.sin(a) * s,
        life: (opts.life ?? 0.55) * (0.6 + Math.random() * 0.7), size: (opts.size ?? 0.35) * (0.6 + Math.random() * 0.8),
        color, gravity: opts.gravity ?? 6, drag: 2, grow: opts.grow ?? 0,
      });
    }
  }

  ring(x: number, z: number, radius: number, n: number, color: string, y = 0.15, opts: { life?: number; size?: number; out?: number } = {}): void {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.emit({ x: x + Math.cos(a) * radius, y, z: z + Math.sin(a) * radius, vx: Math.cos(a) * (opts.out ?? 1.5), vy: 0.6, vz: Math.sin(a) * (opts.out ?? 1.5), life: opts.life ?? 0.5, size: opts.size ?? 0.35, color, drag: 3 });
    }
  }

  update(dt: number): void {
    const l = this.list;
    let w = 0;
    for (let i = 0; i < l.length; i++) {
      const p = l[i]!;
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy -= p.gravity * dt;
      const d = Math.max(0, 1 - p.drag * dt);
      p.vx *= d;
      p.vy *= d;
      p.vz *= d;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < 0.02 && p.gravity > 0) {
        p.y = 0.02;
        p.vy *= -0.3;
      }
      p.size += p.grow * dt;
      l[w++] = p;
    }
    l.length = w;
    for (let i = 0; i < w; i++) {
      const p = l[i]!;
      const k = p.life / p.max;
      this.pos[i * 3] = p.x;
      this.pos[i * 3 + 1] = p.y;
      this.pos[i * 3 + 2] = p.z;
      this.col[i * 3] = p.r;
      this.col[i * 3 + 1] = p.g;
      this.col[i * 3 + 2] = p.b;
      this.sz[i] = p.size;
      this.al[i] = Math.min(1, k * 2.2) * p.alpha;
    }
    this.geo.setDrawRange(0, w);
    for (const name of ['position', 'tint', 'size', 'alpha']) (this.geo.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** Jagged lightning between two points (rebuilt each time it's shown). */
export class Bolts {
  readonly group = new THREE.Group();
  private readonly live: Array<{ line: THREE.Line; life: number }> = [];
  private readonly mat = new THREE.LineBasicMaterial({ color: '#dff9ff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  private readonly glow = new THREE.LineBasicMaterial({ color: '#3fd8ff', transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false });

  add(a: THREE.Vector3, b: THREE.Vector3, color?: string, life = 0.18, jag = 0.35): void {
    for (const [mat, off] of [[this.mat, 0], [this.glow, 0.08]] as const) {
      const pts: THREE.Vector3[] = [];
      const n = Math.max(4, Math.round(a.distanceTo(b) * 2.5));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const p = a.clone().lerp(b, t);
        if (i > 0 && i < n) p.add(new THREE.Vector3((Math.random() - 0.5) * jag, (Math.random() - 0.5) * jag, (Math.random() - 0.5) * jag));
        p.y += off;
        pts.push(p);
      }
      const m = (mat as THREE.LineBasicMaterial).clone();
      if (color) m.color.set(color);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), m);
      line.renderOrder = 25;
      this.group.add(line);
      this.live.push({ line, life });
    }
  }

  update(dt: number): void {
    for (const b of this.live) {
      b.life -= dt;
      (b.line.material as THREE.LineBasicMaterial).opacity = Math.max(0, b.life * 6);
    }
    for (const b of this.live.filter((x) => x.life <= 0)) {
      this.group.remove(b.line);
      b.line.geometry.dispose();
      (b.line.material as THREE.Material).dispose();
    }
    for (let i = this.live.length - 1; i >= 0; i--) if (this.live[i]!.life <= 0) this.live.splice(i, 1);
  }

  dispose(): void {
    for (const b of this.live) {
      b.line.geometry.dispose();
      (b.line.material as THREE.Material).dispose();
    }
    this.live.length = 0;
    this.mat.dispose();
    this.glow.dispose();
  }
}

/** Instanced status decorations: ice crystals on frozen units, spinning stars over stunned ones. */
export class StatusFx {
  readonly group = new THREE.Group();
  private readonly ice: THREE.InstancedMesh;
  private readonly stars: THREE.InstancedMesh;
  private nIce = 0;
  private nStar = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();

  constructor(cap = 256) {
    const iceMat = new THREE.MeshStandardMaterial({ color: '#cff6ff', emissive: '#5fc8ff', emissiveIntensity: 0.45, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.85 });
    this.ice = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.3).scale(0.6, 1.9, 0.6), iceMat, cap);
    const star = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 ? 0.14 : 0.34;
      if (i) star.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      else star.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    this.stars = new THREE.InstancedMesh(new THREE.ExtrudeGeometry(star, { depth: 0.05, bevelEnabled: false }), new THREE.MeshBasicMaterial({ color: '#ffe14d' }), cap);
    for (const im of [this.ice, this.stars]) {
      im.frustumCulled = false;
      im.count = 0;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(im);
    }
  }

  begin(): void {
    this.nIce = 0;
    this.nStar = 0;
  }

  /** A ring of crystals hugging a frozen unit (radius r, height h). */
  freeze(x: number, y: number, z: number, r: number, h: number, seed: number): void {
    for (let i = 0; i < 7 && this.nIce < this.ice.instanceMatrix.count; i++) {
      const a = seed * 1.7 + (i / 7) * Math.PI * 2;
      this.p.set(x + Math.cos(a) * r, y + (0.08 + (i % 3) * 0.26) * h, z + Math.sin(a) * r);
      this.e.set(Math.cos(a) * 0.45, a, Math.sin(a) * 0.45);
      const k = 1.2 + ((seed + i) % 3) * 0.3 + h * 0.25;
      this.ice.setMatrixAt(this.nIce++, this.m.compose(this.p, this.q.setFromEuler(this.e), this.s.set(k, k, k)));
    }
  }

  /** Three stars circling above a stunned unit's head. */
  stun(x: number, y: number, z: number, t: number): void {
    for (let i = 0; i < 3 && this.nStar < this.stars.instanceMatrix.count; i++) {
      const a = t * 5 + (i / 3) * Math.PI * 2;
      this.p.set(x + Math.cos(a) * 0.6, y + Math.sin(a * 2) * 0.08, z + Math.sin(a) * 0.6);
      this.e.set(0, -a, t * 3);
      this.stars.setMatrixAt(this.nStar++, this.m.compose(this.p, this.q.setFromEuler(this.e), this.s.set(1, 1, 1)));
    }
  }

  end(): void {
    this.ice.count = this.nIce;
    this.stars.count = this.nStar;
    this.ice.instanceMatrix.needsUpdate = true;
    this.stars.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const im of [this.ice, this.stars]) {
      im.geometry.dispose();
      (im.material as THREE.Material).dispose();
      im.dispose();
    }
  }
}

interface Floater {
  el: HTMLDivElement;
  pos: THREE.Vector3;
  t: number;
  life: number;
  dx: number;
}

/** Pooled floating damage numbers: DOM labels re-projected from world space every frame. */
export class FloatingNumbers {
  private readonly pool: Floater[] = [];
  private readonly live: Floater[] = [];
  private readonly tmp = new THREE.Vector3();

  constructor(
    private readonly container: HTMLElement,
    private readonly project: (p: THREE.Vector3) => { x: number; y: number },
  ) {}

  add(text: string, at: THREE.Vector3, style: 'normal' | 'crit' | 'tower'): void {
    let n = this.pool.pop();
    if (!n && this.live.length >= 48) n = this.live.shift();
    if (!n) {
      const el = document.createElement('div');
      this.container.appendChild(el);
      n = { el, pos: new THREE.Vector3(), t: 0, life: 0, dx: 0 };
    }
    n.el.className = `cf-dmg ${style}`;
    n.el.textContent = text;
    n.el.style.display = '';
    n.pos.copy(at);
    n.t = 0;
    n.life = style === 'normal' ? 0.75 : 1.05;
    n.dx = (Math.random() - 0.5) * 0.5;
    this.live.push(n);
  }

  update(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const n = this.live[i]!;
      n.t += dt;
      if (n.t >= n.life) {
        n.el.style.display = 'none';
        this.live.splice(i, 1);
        this.pool.push(n);
        continue;
      }
      const k = n.t / n.life;
      const s = this.project(this.tmp.set(n.pos.x + n.dx * k, n.pos.y + k * 1.1, n.pos.z));
      const pop = k < 0.15 ? 0.6 + (k / 0.15) * 0.6 : 1.2 - Math.min(0.2, (k - 0.15) * 0.6);
      n.el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -50%) scale(${pop.toFixed(3)})`;
      n.el.style.opacity = String(k > 0.65 ? 1 - (k - 0.65) / 0.35 : 1);
    }
  }

  dispose(): void {
    for (const n of [...this.live, ...this.pool]) n.el.remove();
    this.live.length = 0;
    this.pool.length = 0;
  }
}

/** Expanding ground ring (shockwaves, spell outlines). */
export class Rings {
  readonly group = new THREE.Group();
  private readonly live: Array<{ m: THREE.Mesh; life: number; max: number; r0: number; r1: number }> = [];
  private readonly geo = new THREE.RingGeometry(0.82, 1, 48);

  add(x: number, z: number, r0: number, r1: number, color: string, life = 0.45, y = 0.08): void {
    const m = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    m.renderOrder = 18;
    this.group.add(m);
    this.live.push({ m, life, max: life, r0, r1 });
  }

  update(dt: number): void {
    for (const r of this.live) {
      r.life -= dt;
      const k = 1 - Math.max(0, r.life) / r.max;
      const s = r.r0 + (r.r1 - r.r0) * (1 - (1 - k) * (1 - k));
      r.m.scale.set(s, s, s);
      (r.m.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - k);
    }
    for (let i = this.live.length - 1; i >= 0; i--) {
      if (this.live[i]!.life > 0) continue;
      this.group.remove(this.live[i]!.m);
      (this.live[i]!.m.material as THREE.Material).dispose();
      this.live.splice(i, 1);
    }
  }

  dispose(): void {
    for (const r of this.live) (r.m.material as THREE.Material).dispose();
    this.live.length = 0;
    this.geo.dispose();
  }
}
