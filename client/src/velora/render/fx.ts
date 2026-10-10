import * as THREE from 'three';

/** Particles and quick effects: tracers, muzzle flashes, impacts, blood, smoke, fire, explosions. */

function softDot(inner: string, outer: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, inner);
  gr.addColorStop(1, outer);
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Particle {
  s: THREE.Sprite;
  v: THREE.Vector3;
  life: number;
  max: number;
  grow: number;
  size: number;
  fade: boolean;
  gravity: number;
}

export class Fx {
  readonly root = new THREE.Group();
  private pool: THREE.Sprite[] = [];
  private live: Particle[] = [];
  private tracers: Array<{ l: THREE.Line; t: number }> = [];
  private flashes: Array<{ l: THREE.PointLight; t: number }> = [];
  private tex = {
    fire: softDot('rgba(255,240,180,1)', 'rgba(255,90,0,0)'),
    smoke: softDot('rgba(60,60,60,0.75)', 'rgba(60,60,60,0)'),
    dust: softDot('rgba(190,180,160,0.8)', 'rgba(190,180,160,0)'),
    blood: softDot('rgba(150,0,0,0.95)', 'rgba(120,0,0,0)'),
    spark: softDot('rgba(255,255,220,1)', 'rgba(255,200,80,0)'),
  };
  private mats = new Map<string, THREE.SpriteMaterial>();
  /** Camera shake amount (decays). */
  shake = 0;

  private mat(kind: keyof Fx['tex']): THREE.SpriteMaterial {
    let m = this.mats.get(kind);
    if (!m) {
      m = new THREE.SpriteMaterial({ map: this.tex[kind], transparent: true, depthWrite: false, blending: kind === 'fire' || kind === 'spark' ? THREE.AdditiveBlending : THREE.NormalBlending });
      this.mats.set(kind, m);
    }
    return m;
  }

  private emit(kind: keyof Fx['tex'], p: THREE.Vector3, v: THREE.Vector3, life: number, size: number, grow: number, gravity = 0): void {
    if (this.live.length > 400) return;
    const s = this.pool.pop() ?? new THREE.Sprite();
    s.material = this.mat(kind).clone();
    s.position.copy(p);
    s.scale.setScalar(size);
    this.root.add(s);
    this.live.push({ s, v, life, max: life, grow, size, fade: true, gravity });
  }

  tracer(a: THREE.Vector3, b: THREE.Vector3): void {
    const g = new THREE.BufferGeometry().setFromPoints([a, b]);
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.85 }));
    this.root.add(l);
    this.tracers.push({ l, t: 0.06 });
  }

  muzzle(p: THREE.Vector3): void {
    this.emit('spark', p, new THREE.Vector3(), 0.05, 0.45, 2);
    this.light(p, 0xffc070, 6, 0.05);
  }

  private light(p: THREE.Vector3, color: number, intensity: number, t: number, dist = 10): void {
    if (this.flashes.length > 6) return;
    const l = new THREE.PointLight(color, intensity, dist, 2);
    l.position.copy(p);
    this.root.add(l);
    this.flashes.push({ l, t });
  }

  impact(p: THREE.Vector3, n: THREE.Vector3, metal: boolean): void {
    for (let i = 0; i < 4; i++) this.emit(metal ? 'spark' : 'dust', p, n.clone().multiplyScalar(2).add(new THREE.Vector3(Math.random() - 0.5, Math.random(), Math.random() - 0.5).multiplyScalar(2)), 0.25 + Math.random() * 0.2, metal ? 0.12 : 0.35, metal ? 0 : 1.5, metal ? 9 : 0);
  }

  blood(p: THREE.Vector3): void {
    for (let i = 0; i < 6; i++) this.emit('blood', p, new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).multiplyScalar(2.2), 0.35 + Math.random() * 0.2, 0.25, 1, 6);
  }

  smoke(p: THREE.Vector3, dark = false): void {
    this.emit(dark ? 'smoke' : 'dust', p, new THREE.Vector3((Math.random() - 0.5) * 0.6, 1.4 + Math.random(), (Math.random() - 0.5) * 0.6), 1.6, 0.8, 1.8);
  }

  fire(p: THREE.Vector3): void {
    this.emit('fire', p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.2, 0, (Math.random() - 0.5) * 1.2)), new THREE.Vector3(0, 2 + Math.random() * 2, 0), 0.45, 0.9, 1.2);
    if (Math.random() < 0.3) this.smoke(p.clone().add(new THREE.Vector3(0, 1, 0)), true);
  }

  explosion(p: THREE.Vector3): void {
    for (let i = 0; i < 28; i++) {
      const d = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9, Math.random() - 0.5).normalize();
      this.emit('fire', p, d.multiplyScalar(6 + Math.random() * 8), 0.5 + Math.random() * 0.4, 1.6, 3);
    }
    for (let i = 0; i < 16; i++) this.emit('smoke', p.clone().add(new THREE.Vector3(0, 1, 0)), new THREE.Vector3((Math.random() - 0.5) * 4, 2 + Math.random() * 3, (Math.random() - 0.5) * 4), 2.4, 2, 2.2);
    this.light(p.clone().add(new THREE.Vector3(0, 2, 0)), 0xff8a30, 120, 0.4, 40);
    this.shake = Math.max(this.shake, 1);
  }

  update(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i]!;
      p.life -= dt;
      if (p.life <= 0) {
        p.s.removeFromParent();
        (p.s.material as THREE.SpriteMaterial).dispose();
        this.pool.push(p.s);
        this.live.splice(i, 1);
        continue;
      }
      p.v.y -= p.gravity * dt;
      p.s.position.addScaledVector(p.v, dt);
      const f = 1 - p.life / p.max;
      p.s.scale.setScalar(p.size * (1 + p.grow * f));
      (p.s.material as THREE.SpriteMaterial).opacity = 1 - f;
    }
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i]!;
      t.t -= dt;
      if (t.t <= 0) {
        t.l.removeFromParent();
        t.l.geometry.dispose();
        this.tracers.splice(i, 1);
      }
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i]!;
      f.t -= dt;
      if (f.t <= 0) {
        f.l.removeFromParent();
        f.l.dispose();
        this.flashes.splice(i, 1);
      }
    }
    this.shake = Math.max(0, this.shake - dt * 2);
  }
}
