import { AdditiveBlending, DoubleSide, FrontSide, Group, IcosahedronGeometry, Mesh, MeshBasicMaterial, NormalBlending, RingGeometry, Vector3, type Blending } from 'three';
import { SurfaceType } from '@shared/types/surface';
import type { KartState } from '@shared/vehicles/KartState';
import type { KartRenderState } from '../vehicles/KartView';
import { ParticleSystem } from './Particles';
import { SkidMarks } from './SkidMarks';

/** Spark colours for mini-turbo stages 1..3 (cyan → orange → magenta). */
export const DRIFT_COLORS = ['#ffffff', '#3fd8ff', '#ff9a1a', '#ff4fd8'] as const;

interface Ring {
  mesh: Mesh;
  age: number;
  life: number;
  radius: number;
  /** Fireball cores grow fast and fade; rings ease out. */
  kind: 'ring' | 'core';
}

/** Shared by every ring / fireball core (meshes and their materials are pooled). */
const RING_GEO = new RingGeometry(0.8, 1, 48);
const CORE_GEO = new IcosahedronGeometry(1, 2);

const RAINBOW = ['#ff4f6a', '#ffb52e', '#ffe14d', '#5ce06a', '#3fd8ff', '#9b6bff'];
const CONFETTI = ['#ff4f9a', '#ffd23f', '#3fd8ff', '#7ddc4a', '#ff8c1a', '#9b6bff', '#ffffff'];

/**
 * All transient visual effects: per-kart emitters and one-shot bursts driven by
 * simulation events. Purely cosmetic — never feeds back into the simulation.
 */
export class Effects {
  readonly root = new Group();
  private readonly glow = new ParticleSystem(4000, AdditiveBlending);
  private readonly puff = new ParticleSystem(2000, NormalBlending);
  private readonly rings: Ring[] = [];
  private readonly freeRings: Ring[] = [];
  readonly skids = new SkidMarks();
  private readonly wheel = new Vector3();
  private readonly emitAcc = new Map<number, number>();
  private readonly v = new Vector3();
  private readonly w = new Vector3();
  /** Scratch for velocity jitter / offsets (avoids a Vector3 per particle). */
  private readonly u = new Vector3();
  private readonly back = new Vector3();
  private readonly fwd = new Vector3();
  private readonly right = new Vector3();
  private readonly up = new Vector3();
  private time = 0;

  constructor() {
    this.root.name = 'effects';
    this.root.add(this.skids.mesh, this.glow.mesh, this.puff.mesh);
  }

  update(dt: number): void {
    this.time += dt;
    this.glow.update(dt);
    this.puff.update(dt);
    this.skids.update(dt);
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]!;
      r.age += dt;
      const t = r.age / r.life;
      if (t >= 1) {
        r.mesh.visible = false;
        this.rings.splice(i, 1);
        this.freeRings.push(r);
        continue;
      }
      if (r.kind === 'core') {
        r.mesh.scale.setScalar(r.radius * (0.35 + 0.65 * Math.sqrt(t)));
        (r.mesh.material as MeshBasicMaterial).opacity = Math.pow(1 - t, 1.5);
      } else {
        r.mesh.scale.setScalar(0.2 + r.radius * (1 - (1 - t) * (1 - t)));
        (r.mesh.material as MeshBasicMaterial).opacity = (1 - t) * 0.85;
      }
    }
  }

  private rand(spread: number): number {
    return (Math.random() * 2 - 1) * spread;
  }

  /** Steady emitters for one kart, rate-limited per kart. */
  kart(id: number, rs: KartRenderState, s: KartState, dt: number): void {
    const acc = (this.emitAcc.get(id) ?? 0) + dt;
    const ticks = Math.floor(acc / (1 / 60));
    this.emitAcc.set(id, acc - ticks / 60);
    if (ticks <= 0) return;

    this.fwd.set(0, 0, 1).applyQuaternion(rs.quaternion);
    this.right.set(-1, 0, 0).applyQuaternion(rs.quaternion);
    this.up.set(0, 1, 0).applyQuaternion(rs.quaternion);
    const scale = s.shrinkTimer > 0 ? 0.55 : 1;
    const at = (x: number, y: number, z: number): Vector3 =>
      this.v.copy(rs.position).addScaledVector(this.right, x * scale).addScaledVector(this.up, y * scale).addScaledVector(this.fwd, z * scale);

    // Tyre marks from the rear wheels while sliding on tarmac (drifts, skids, spin-outs).
    const onTarmac = s.grounded && (s.surface === SurfaceType.Road || s.surface === SurfaceType.Curb || s.surface === SurfaceType.Boost);
    const slipping = Math.abs(s.velocity.dot(this.right)) > 4.5;
    const sliding = onTarmac && rs.groundY !== null && rs.position.y - rs.groundY < 0.8 && (s.drifting || slipping || s.spinTimer > 0);
    for (const side of [-1, 1]) {
      this.wheel.copy(rs.position).addScaledVector(this.right, side * 0.72 * scale).addScaledVector(this.fwd, -0.9 * scale);
      if (rs.groundY !== null) this.wheel.y = rs.groundY;
      this.skids.emit(`${id}:${side}`, this.wheel, sliding);
    }

    for (let k = 0; k < ticks; k++) {
      // Pale wind streaks build while sitting in another kart's wake.
      if (s.slipstreamCharge > 0.1 || s.slipstreamTimer > 0) {
        for (const side of [-1, 1]) this.glow.spawn({ position: at(side * 1.2, 0.7 + Math.random(), 0.7), velocity: this.w.copy(this.fwd).multiplyScalar(-14), color: '#b9f5ff', size: [0.22, 0.02], life: 0.25, alpha: 0.6 });
      }
      // Drift sparks from both rear wheels (stage colour) + tyre smoke.
      if (s.drifting && s.grounded) {
        for (const side of [-1, 1]) {
          const p = at(side * 0.75, 0.15, -0.95);
          if (s.driftStage > 0) {
            for (let n = 0; n < 2; n++) {
              this.glow.spawn({
                position: p,
                velocity: this.w.copy(this.fwd).multiplyScalar(-3 - Math.random() * 3).addScaledVector(this.right, side * (1 + Math.random() * 2)).add(this.u.set(0, 2 + Math.random() * 3, 0)),
                color: DRIFT_COLORS[s.driftStage]!,
                size: [0.32, 0.05],
                life: 0.22 + Math.random() * 0.12,
                gravity: 14,
              });
            }
          }
          if (Math.random() < 0.5) this.puff.spawn({ position: p, velocity: this.w.set(this.rand(0.6), 0.8, this.rand(0.6)), color: '#e9e6f2', size: [0.5, 1.6], life: 0.6, alpha: 0.35, drag: 2 });
        }
      }
      // Boost / rocket flames from the exhaust pipes.
      if (s.boostTimer > 0 || s.rocketTimer > 0) {
        const big = s.rocketTimer > 0 ? 2.2 : 1;
        for (const side of [-1, 1]) {
          const p = s.rocketTimer > 0 ? at(0, 1.1, -2.6) : at(side * 0.42, 1.05, -1.25);
          this.glow.spawn({ position: p, velocity: this.w.copy(this.fwd).multiplyScalar(-6 - Math.random() * 4).add(this.u.set(this.rand(0.6), this.rand(0.6), this.rand(0.6))), color: Math.random() < 0.5 ? '#ffb52e' : '#ff5a1a', size: [0.55 * big, 0.1], life: 0.16, drag: 4 });
          if (Math.random() < 0.3) this.glow.spawn({ position: p, velocity: this.w.copy(this.fwd).multiplyScalar(-4), color: '#fff3c0', size: [0.3 * big, 0.05], life: 0.1 });
          if (s.rocketTimer > 0) break;
        }
      }
      // Idle exhaust putts.
      if (s.grounded && Math.abs(s.forwardSpeed) < 6 && s.boostTimer <= 0 && Math.random() < 0.12) {
        const side = Math.random() < 0.5 ? -1 : 1;
        this.puff.spawn({ position: at(side * 0.42, 1.05, -1.2), velocity: this.w.copy(this.fwd).multiplyScalar(-0.8).add(this.u.set(this.rand(0.3), 0.9, this.rand(0.3))), color: '#c9c6d6', size: [0.25, 0.9], life: 0.7, alpha: 0.35, drag: 1.5 });
      }
      // Off-road dust.
      if (s.grounded && s.surface === SurfaceType.Offroad && Math.abs(s.forwardSpeed) > 6 && Math.random() < 0.7) {
        const side = Math.random() < 0.5 ? -1 : 1;
        this.puff.spawn({ position: at(side * 0.7, 0.2, -0.9), velocity: this.w.set(this.rand(1), 1.2 + Math.random(), this.rand(1)), color: '#b59a6a', size: [0.5, 1.8], life: 0.7, alpha: 0.5, drag: 2, gravity: -0.5 });
      }
      // Hyper Prism sparkles.
      if (s.invincibleTimer > 0) {
        this.glow.spawn({ position: at(this.rand(1.2), 0.5 + Math.random() * 1.6, this.rand(1.6)), velocity: this.w.set(this.rand(1), 1.5, this.rand(1)), color: RAINBOW[Math.floor(Math.random() * RAINBOW.length)]!, size: [0.4, 0], life: 0.45 });
      }
      // Dizzy stars while spun out.
      if ((s.spinTimer > 0 || s.tumbleTimer > 0) && Math.random() < 0.35) {
        const a = this.time * 8 + Math.random();
        this.glow.spawn({ position: at(Math.cos(a) * 0.7, 2.7, Math.sin(a) * 0.7), color: '#ffe14d', size: [0.35, 0.1], life: 0.3 });
      }
    }
  }

  // ------------------------------------------------------------------ bursts

  /** Sparks off the nose when scraping a wall. */
  wallSparks(position: Vector3, forward: Vector3, impact: number): void {
    const n = Math.min(26, 6 + Math.round(impact * 1.2));
    const p = this.v.copy(position).addScaledVector(forward, 1.2).setY(position.y + 0.6);
    for (let i = 0; i < n; i++) {
      this.glow.spawn({
        position: p,
        velocity: this.w.copy(forward).multiplyScalar(-2 - Math.random() * 4).add(this.u.set(this.rand(5), 1 + Math.random() * 4, this.rand(5))),
        color: i % 3 === 0 ? '#fff3c0' : '#ffb52e',
        size: [0.26, 0.04],
        life: 0.25 + Math.random() * 0.2,
        gravity: 16,
      });
    }
  }

  /** Dust ring on a hard landing. */
  landingDust(position: Vector3, impact: number, surface: SurfaceType): void {
    const n = Math.min(18, Math.round(impact * 1.3));
    const color = surface === SurfaceType.Offroad || surface === SurfaceType.Dirt ? '#b59a6a' : '#d9d6e2';
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.puff.spawn({ position: this.v.copy(position).add(this.u.set(Math.cos(a) * 1.1, 0.2, Math.sin(a) * 1.1)), velocity: this.w.set(Math.cos(a) * 3.5, 0.8, Math.sin(a) * 3.5), color, size: [0.6, 1.8], life: 0.55, alpha: 0.5, drag: 4 });
    }
  }

  /** Drift spark colour steps up. */
  driftStageFlash(position: Vector3, stage: number): void {
    const color = DRIFT_COLORS[stage] ?? '#ffffff';
    this.ring(position, 2.4, color, 0.35, 0.4);
    this.burst(this.v.copy(position).setY(position.y + 0.4), color, 8 + stage * 4, 3 + stage);
  }

  /** Respawn: a light column with rising rings. */
  respawnBeam(position: Vector3): void {
    for (let y = 0; y < 12; y += 0.5) {
      this.glow.spawn({ position: this.v.copy(position).add(this.u.set(this.rand(0.5), y, this.rand(0.5))), velocity: this.w.set(0, 3, 0), color: y % 1 < 0.5 ? '#bff6ff' : '#3fd8ff', size: [0.9, 0.2], life: 0.5 });
    }
    for (const [y, delay] of [
      [0.2, 0.5],
      [1.2, 0.6],
      [2.4, 0.7],
    ] as const)
      this.ring(position, 2.2, '#3fd8ff', delay, y);
  }

  /** Perfect start: blue flame burst out the back + a dust cloud. */
  rocketStart(position: Vector3, forward: Vector3): void {
    const back = this.back.copy(position).addScaledVector(forward, -1.6).setY(position.y + 0.8);
    for (let i = 0; i < 40; i++) {
      this.glow.spawn({ position: back, velocity: this.w.copy(forward).multiplyScalar(-6 - Math.random() * 8).add(this.u.set(this.rand(2.5), Math.random() * 2.5, this.rand(2.5))), color: i % 3 ? '#3fd8ff' : '#ffffff', size: [0.7, 0.08], life: 0.35, drag: 3 });
    }
    for (let i = 0; i < 12; i++) {
      this.puff.spawn({ position: back, velocity: this.w.set(this.rand(3), 0.8 + Math.random(), this.rand(3)), color: '#d9d6e2', size: [0.8, 2.6], life: 0.9, alpha: 0.45, drag: 2 });
    }
    this.ring(position, 4, '#3fd8ff', 0.4);
  }

  /** Finish-line confetti over a racer (amount 0..1). */
  confetti(position: Vector3, amount = 1): void {
    const n = Math.round(160 * amount);
    for (let i = 0; i < n; i++) {
      this.puff.spawn({
        position: this.v.copy(position).add(this.u.set(this.rand(2), 3 + Math.random() * 2, this.rand(2))),
        velocity: this.w.set(this.rand(7), 5 + Math.random() * 7, this.rand(7)),
        color: CONFETTI[i % CONFETTI.length]!,
        size: [0.32, 0.26],
        life: 2.2 + Math.random(),
        alpha: 1,
        gravity: 5,
        drag: 1.8,
      });
    }
    this.burst(this.v.copy(position).setY(position.y + 2), '#ffd23f', 24, 7);
  }

  /** One trail particle behind a moving item. */
  trail(position: Vector3, color: string, size: number, life: number, additive = true): void {
    (additive ? this.glow : this.puff).spawn({ position, velocity: this.w.set(this.rand(0.4), this.rand(0.4) + 0.3, this.rand(0.4)), color, size: [size, size * 0.2], life, alpha: additive ? 1 : 0.5, drag: 2 });
  }

  ring(position: Vector3, radius: number, color: string, life = 0.55, y = 0.3): void {
    const r = this.takeRing('ring', color, AdditiveBlending, life, radius);
    r.mesh.rotation.set(-Math.PI / 2, 0, 0);
    r.mesh.position.copy(position).setY(position.y + y);
    (r.mesh.material as MeshBasicMaterial).opacity = 0.85;
  }

  /** Expanding ball (explosion core). Solid = cartoon fireball, otherwise additive glow. */
  core(position: Vector3, radius: number, color: string, life = 0.45, solid = false): void {
    const r = this.takeRing('core', color, solid ? NormalBlending : AdditiveBlending, life, radius);
    r.mesh.rotation.set(0, 0, 0);
    r.mesh.position.copy(position);
    (r.mesh.material as MeshBasicMaterial).opacity = 1;
  }

  /** A pooled ring / core mesh (one material each so they can fade independently). */
  private takeRing(kind: Ring['kind'], color: string, blending: Blending, life: number, radius: number): Ring {
    const i = this.freeRings.findIndex((r) => r.kind === kind);
    let r = i >= 0 ? this.freeRings.splice(i, 1)[0]! : null;
    if (!r) {
      const mat = new MeshBasicMaterial({ transparent: true, depthWrite: false, side: kind === 'ring' ? DoubleSide : FrontSide });
      r = { mesh: new Mesh(kind === 'ring' ? RING_GEO : CORE_GEO, mat), age: 0, life, radius, kind };
      this.root.add(r.mesh);
    }
    const mat = r.mesh.material as MeshBasicMaterial;
    mat.color.set(color);
    mat.blending = blending;
    r.mesh.visible = true;
    r.mesh.scale.setScalar(0.01);
    r.age = 0;
    r.life = life;
    r.radius = radius;
    this.rings.push(r);
    return r;
  }

  /** Make one of each pooled mesh so its shader is compiled up front (see Game.warmup). */
  warmup(): void {
    this.ring(this.v.set(0, -1000, 0), 1, '#ffffff', 0.01);
    this.core(this.v.set(0, -1000, 0), 1, '#ffffff', 0.01, true);
  }

  explosion(position: Vector3, radius: number): void {
    const center = this.back.copy(position).setY(position.y + 1.2);
    this.core(center, radius * 0.7, '#ff7a1a', 0.55, true);
    this.core(center, radius * 0.5, '#ffd23f', 0.4, true);
    this.core(center, radius * 0.35, '#fff6d0', 0.3);
    for (let i = 0; i < 70; i++) {
      const dir = this.w.set(this.rand(1), Math.random() * 1.2, this.rand(1)).normalize();
      this.glow.spawn({ position: center, velocity: dir.multiplyScalar(6 + Math.random() * radius * 1.6), color: i % 3 === 0 ? '#fff3c0' : i % 3 === 1 ? '#ffb52e' : '#ff4a1a', size: [2.6, 0.3], life: 0.5 + Math.random() * 0.3, drag: 3 });
    }
    for (let i = 0; i < 26; i++) {
      this.puff.spawn({ position: this.v.copy(position).add(this.u.set(this.rand(1.5), Math.random() * 1.5, this.rand(1.5))), velocity: this.w.set(this.rand(4), 3 + Math.random() * 3, this.rand(4)), color: '#5a5566', size: [1.5, 4.5], life: 1.3, alpha: 0.55, drag: 1.5 });
    }
    this.ring(position, radius, '#ffb52e', 0.5);
  }

  shockwave(position: Vector3, radius: number): void {
    this.ring(position, radius, '#ffe14d', 0.6, 0.5);
    this.ring(position, radius * 0.7, '#ffffff', 0.45, 1.2);
  }

  boxBreak(position: Vector3): void {
    for (let i = 0; i < 26; i++) {
      this.glow.spawn({ position, velocity: this.w.set(this.rand(5), 2 + Math.random() * 5, this.rand(5)), color: RAINBOW[i % RAINBOW.length]!, size: [0.45, 0.05], life: 0.5, gravity: 12, drag: 1 });
    }
  }

  coin(position: Vector3): void {
    for (let i = 0; i < 10; i++) {
      this.glow.spawn({ position: this.v.copy(position).setY(position.y + 1), velocity: this.w.set(this.rand(2), 2 + Math.random() * 3, this.rand(2)), color: '#ffd23f', size: [0.35, 0.05], life: 0.45, gravity: 8 });
    }
  }

  poof(position: Vector3, color = '#ffffff'): void {
    for (let i = 0; i < 12; i++) {
      this.puff.spawn({ position, velocity: this.w.set(this.rand(2.5), 1 + Math.random() * 2, this.rand(2.5)), color, size: [0.6, 1.6], life: 0.45, alpha: 0.7, drag: 3 });
    }
  }

  burst(position: Vector3, color: string, count = 18, speed = 5): void {
    for (let i = 0; i < count; i++) {
      this.glow.spawn({ position, velocity: this.w.set(this.rand(1), Math.random(), this.rand(1)).normalize().multiplyScalar(speed * (0.5 + Math.random())), color, size: [0.6, 0.05], life: 0.4, drag: 2 });
    }
  }

  /** Trick off a lip / ramp: a twinkling star burst around the kart. */
  trickSparkle(position: Vector3): void {
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2;
      this.glow.spawn({
        position: this.v.copy(position).add(this.u.set(Math.cos(a) * 1.2, 1 + Math.random() * 0.8, Math.sin(a) * 1.2)),
        velocity: this.w.set(Math.cos(a) * 3, 1.5 + Math.random() * 2, Math.sin(a) * 3),
        color: i % 3 === 0 ? '#ffffff' : i % 3 === 1 ? '#ffe14d' : '#3fd8ff',
        size: [0.5, 0.02],
        life: 0.45 + Math.random() * 0.2,
        drag: 2,
      });
    }
  }

  miniTurbo(position: Vector3, stage: number): void {
    this.burst(this.v.copy(position).setY(position.y + 0.8), DRIFT_COLORS[stage] ?? '#ffffff', 10 + stage * 8, 4 + stage * 2);
  }

  /** Lightning strike column (Zap Storm). */
  strike(position: Vector3): void {
    for (let y = 0; y < 40; y += 1.2) {
      this.glow.spawn({ position: this.v.copy(position).add(this.u.set(this.rand(0.4), y, this.rand(0.4))), color: y % 2 < 1 ? '#fff9c4' : '#ffe14d', size: [0.9, 0.2], life: 0.25 });
    }
    this.burst(position, '#ffe14d', 14, 6);
  }

  /** Coloured paint flecks around a racer hit by Paint Splat. */
  splat(position: Vector3): void {
    for (let i = 0; i < 16; i++) {
      this.puff.spawn({ position: this.v.copy(position).setY(position.y + 1.5), velocity: this.w.set(this.rand(4), 2 + Math.random() * 3, this.rand(4)), color: i % 2 ? '#9b4dff' : '#ff4fd8', size: [0.5, 0.9], life: 0.6, gravity: 10, alpha: 0.9 });
    }
  }
}
