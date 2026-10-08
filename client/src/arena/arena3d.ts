import * as THREE from 'three';
import { cardsFor, getCard } from './cards';
import { ARENA_H, ARENA_W, BRIDGES, RIVER_Y, type Area, type BattleEngine, type BattleEvent, type Projectile, type Unit } from './engine';
import { Bolts, FloatingNumbers, Particles, Rings, StatusFx } from './fx';
import { buildCardModel, TEAM_COLORS, type BuiltModel } from './models';
import { instantiate, findClip } from './assets';
import type { CardDefinition, ProjectileKind, Team, Vec2 } from './types';

/** Tile (x, y) → world (x − 9, z = y − 16). One tile = one world unit. */
export const toWorld = (x: number, y: number, h = 0) => new THREE.Vector3(x - ARENA_W / 2, h, y - ARENA_H / 2);

const FLY_HEIGHT = 2.6;
/** Units are drawn bigger than their footprint so they read at arena zoom. */
export const UNIT_SCALE = 1.6;

// ============================================================================ textures

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void, repeat = false): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d')!);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function grassField(): THREE.CanvasTexture {
  const px = 48;
  return canvasTex(ARENA_W * px, ARENA_H * px, (c) => {
    for (let y = 0; y < ARENA_H; y++) {
      for (let x = 0; x < ARENA_W; x++) {
        const light = (x + y) % 2 === 0;
        c.fillStyle = light ? '#7ccf4a' : '#6cc03e';
        c.fillRect(x * px, y * px, px, px);
      }
    }
    // Speckle + blades.
    for (let i = 0; i < 9000; i++) {
      const x = Math.random() * ARENA_W * px;
      const y = Math.random() * ARENA_H * px;
      c.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,200,0.07)' : 'rgba(20,80,20,0.08)';
      c.fillRect(x, y, 2, 4);
    }
    // Dirt pads under towers + the king's courtyard.
    const pad = (x: number, y: number, r: number) => {
      const g = c.createRadialGradient(x * px, y * px, r * px * 0.2, x * px, y * px, r * px);
      g.addColorStop(0, 'rgba(214,170,106,0.95)');
      g.addColorStop(0.75, 'rgba(206,160,96,0.75)');
      g.addColorStop(1, 'rgba(206,160,96,0)');
      c.fillStyle = g;
      c.beginPath();
      c.arc(x * px, y * px, r * px, 0, Math.PI * 2);
      c.fill();
    };
    for (const y of [2.5, 29.5]) pad(9, y, 3.4);
    for (const y of [6.5, 25.5]) for (const x of [3.5, 14.5]) pad(x, y, 2.6);
    // Walking paths from the bridges to the towers.
    c.strokeStyle = 'rgba(214,176,112,0.55)';
    c.lineCap = 'round';
    c.lineWidth = px * 1.3;
    for (const bx of BRIDGES) {
      for (const [y0, y1] of [[RIVER_Y - 1, 6.5], [RIVER_Y + 1, 25.5]]) {
        c.beginPath();
        c.moveTo(bx * px, y0 * px);
        c.lineTo(bx * px, y1 * px);
        c.stroke();
      }
    }
    c.lineWidth = px * 0.9;
    for (const [y0, y1] of [[6.5, 2.5], [25.5, 29.5]]) {
      c.beginPath();
      c.moveTo(3.5 * px, y0 * px);
      c.quadraticCurveTo(9 * px, y0 * px, 9 * px, y1 * px);
      c.quadraticCurveTo(9 * px, y0 * px, 14.5 * px, y0 * px);
      c.stroke();
    }
  });
}

function stoneTex(): THREE.CanvasTexture {
  return canvasTex(256, 256, (c) => {
    c.fillStyle = '#9aa3b5';
    c.fillRect(0, 0, 256, 256);
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 4; col++) {
        const x = col * 64 + (row % 2 ? 32 : 0);
        const shade = 150 + Math.floor(Math.random() * 40);
        c.fillStyle = `rgb(${shade - 6},${shade},${shade + 18})`;
        c.fillRect(x + 2, row * 32 + 2, 60, 28);
      }
    }
  }, true);
}

// ============================================================================ water

const WATER_FRAG = /* glsl */ `
  uniform float time;
  varying vec2 vUv;
  void main() {
    vec2 uv = vUv;
    float w1 = sin(uv.x * 40.0 + time * 2.2 + sin(uv.y * 6.0 + time) * 2.0);
    float w2 = sin(uv.x * 23.0 - time * 1.4 + uv.y * 9.0);
    float stripes = smoothstep(0.75, 1.0, w1 * 0.5 + w2 * 0.5);
    vec3 deep = vec3(0.12, 0.55, 0.92);
    vec3 shallow = vec3(0.32, 0.82, 1.0);
    float edge = smoothstep(0.0, 0.18, uv.y) * smoothstep(1.0, 0.82, uv.y);
    vec3 col = mix(shallow, deep, edge);
    col += stripes * 0.22;
    float foam = (1.0 - smoothstep(0.0, 0.08, uv.y)) + (1.0 - smoothstep(1.0, 0.92, uv.y));
    col = mix(col, vec3(0.95, 1.0, 1.0), foam * (0.7 + 0.3 * sin(uv.x * 60.0 + time * 3.0)));
    gl_FragColor = vec4(col, 1.0);
  }`;
const WATER_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// ============================================================================ unit view

type AnimName = 'idle' | 'move' | 'attack' | 'death' | 'sit';

class UnitView {
  readonly group = new THREE.Group();
  model: BuiltModel | null = null;
  private actions = new Map<string, THREE.AnimationAction>();
  private riderActions = new Map<string, THREE.AnimationAction>();
  private current: AnimName | null = null;
  private attackSeq = 0;
  private attackTimer = 0;
  readonly disc: THREE.Mesh;
  readonly shadow: THREE.Mesh | null = null;
  /** Deploy countdown arc + the card-shaped landing shadow. */
  private arc: THREE.Mesh;
  private landing: THREE.Mesh;
  private readonly r: number;
  hpEl: HTMLDivElement;
  private hpFill: HTMLDivElement;
  private shieldFill: HTMLDivElement | null = null;
  private lastHp = -1;
  private lastShield = -1;
  private spawnT = 0;
  private flash = 0;
  private fxT = Math.random();
  private deployMax = 0;
  private disposed = false;
  facing = 0;
  ready = false;
  readonly height: number;

  constructor(
    readonly unit: Unit,
    private readonly scene: ArenaScene,
  ) {
    const tc = TEAM_COLORS[unit.team];
    const r = (this.r = unit.radius * 1.15);
    this.disc = new THREE.Mesh(scene.res(`disc-${r.toFixed(2)}`, () => new THREE.RingGeometry(r * 0.72, r, 32)), scene.res(`disc-${unit.team}`, () => new THREE.MeshBasicMaterial({ color: tc.main, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide })));
    this.disc.rotation.x = -Math.PI / 2;
    this.disc.position.y = 0.04;
    this.disc.renderOrder = 5;
    this.group.add(this.disc);
    if (unit.flying) {
      this.shadow = new THREE.Mesh(scene.res('circle-1', () => new THREE.CircleGeometry(1, 20)), scene.res('fly-shadow', () => new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.25, depthWrite: false })));
      this.shadow.rotation.x = -Math.PI / 2;
      this.shadow.position.y = 0.03;
      this.shadow.scale.setScalar(r * 0.8);
      this.group.add(this.shadow);
    }
    this.arc = new THREE.Mesh(scene.arcGeo(1), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
    this.arc.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
    this.arc.position.y = 0.06;
    this.arc.scale.setScalar(r * 1.3 + 0.12);
    this.arc.renderOrder = 7;
    this.group.add(this.arc);
    this.landing = new THREE.Mesh(scene.res('card-plane', () => new THREE.PlaneGeometry(1, 1.2)), new THREE.MeshBasicMaterial({ color: '#000000', alphaMap: scene.cardShadowTex(), transparent: true, opacity: 0, depthWrite: false }));
    this.landing.rotation.x = -Math.PI / 2;
    this.landing.position.y = 0.035;
    this.landing.renderOrder = 4;
    this.group.add(this.landing);
    this.height = unit.card.visual.mount ? unit.card.visual.mount.seat + unit.card.visual.height * 0.75 : unit.card.visual.height;
    this.hpEl = document.createElement('div');
    this.hpEl.className = `cf-hp ${unit.team}${unit.kind === 'tower' ? ' tower' : ''}`;
    this.hpFill = document.createElement('div');
    this.hpFill.className = 'cf-hp__fill';
    this.hpEl.appendChild(this.hpFill);
    if (unit.maxShield > 0) {
      this.shieldFill = document.createElement('div');
      this.shieldFill.className = 'cf-hp__shield';
      this.hpEl.appendChild(this.shieldFill);
    }
    scene.hud.appendChild(this.hpEl);
    this.facing = unit.team === 'blue' ? Math.PI : 0;
    this.group.position.copy(toWorld(unit.x, unit.y));
    if (unit.kind === 'tower') return;
    // Pre-built models (warmup / recycled corpses) attach instantly; otherwise build one.
    const pooled = scene.takeModel(unit.card, unit.team);
    if (pooled) this.attach(pooled);
    else void this.load();
  }

  private async load(): Promise<void> {
    let m: BuiltModel;
    try {
      m = await buildCardModel(this.unit.card, this.unit.team);
    } catch (e) {
      console.warn('[arena] model failed', this.unit.card.id, e);
      return;
    }
    if (this.disposed) this.scene.giveModel(this.unit.card, this.unit.team, m);
    else this.attach(m);
  }

  private attach(m: BuiltModel): void {
    this.model = m;
    const scaler = new THREE.Group();
    scaler.scale.setScalar(this.unit.kind === 'building' ? 1.2 : UNIT_SCALE);
    scaler.add(m.root);
    this.group.add(scaler);
    const c = this.unit.card;
    const ranged = c.range > 1.6;
    const fast = c.speed === 'fast' || c.speed === 'veryFast';
    const bind = (clips: THREE.AnimationClip[], mixer: THREE.AnimationMixer | null, into: Map<string, THREE.AnimationAction>, rider = false) => {
      if (!mixer || !clips.length) return;
      const pick = (...re: RegExp[]) => findClip(clips, ...re);
      const idle = pick(/^Idle_Weapon$/, /^Flying_Idle$/, /^Idle$/i, /^idle$/, /idle/i);
      const move = fast
        ? pick(/^Run_Weapon$/, /^Fast_Flying$/, /^Gallop$/, /^Run$/, /^sprint$/, /^Walk$/i, /^walk$/)
        : pick(/^Walk$/, /^Fast_Flying$/, /^walk$/, /^Run$/, /^Flying_Idle$/);
      const attack = ranged
        ? pick(/^Bow_Shoot$/, /^Spell1$/, /^Shoot_OneHanded$/, /^holding-right-shoot$/, /^Weapon$/, /^Staff_Attack$/, /^Punch$/, /^Headbutt$/, /^Bite_Front$/, /^Attack_Headbutt$/)
        : pick(/^Sword_Attack$/, /^SwordSlash$/, /^Dagger_Attack$/, /^Attack$/, /^Staff_Attack$/, /^attack-melee-right$/, /^Weapon$/, /^Punch$/, /^Headbutt$/, /^Bite_Front$/, /^Attack_Headbutt$/, /^Attack_Kick$/);
      const death = pick(/^Death$/, /^die$/);
      const sit = rider ? pick(/^SitDown$/, /^sit$/, /^drive$/) : undefined;
      const set = (name: AnimName, clip: THREE.AnimationClip | undefined, once = false) => {
        if (!clip) return;
        const a = mixer.clipAction(clip);
        a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
        a.clampWhenFinished = once;
        a.timeScale = 1;
        into.set(name, a);
      };
      set('idle', idle);
      set('move', move ?? idle);
      set('attack', attack, true);
      set('death', death, true);
      set('sit', sit, true);
    };
    if (m.riderMixer) {
      bind(m.mountClips, m.mountMixer, this.actions);
      bind(m.riderClips, m.riderMixer, this.riderActions, true);
      const sit = this.riderActions.get('sit');
      if (sit) {
        sit.reset().play();
        sit.time = sit.getClip().duration;
        sit.paused = true;
      }
    } else {
      bind(m.clips, m.mixers[0] ?? null, this.actions);
    }
    this.play('idle');
    this.ready = true;
    for (const mx of m.mixers) mx.update(Math.random() * 2);
  }

  private play(name: AnimName, fade = 0.15): void {
    if (this.current === name && name !== 'attack') return;
    const next = this.actions.get(name) ?? (name === 'move' ? this.actions.get('idle') : undefined);
    const prev = this.current ? this.actions.get(this.current) : undefined;
    this.current = name;
    if (!next) return;
    if (name === 'attack' || name === 'death') next.reset();
    next.enabled = true;
    next.setEffectiveWeight(1);
    if (prev && prev !== next) next.crossFadeFrom(prev, fade, false);
    next.play();
    // Rider swings with the mount's attack.
    if (name === 'attack') {
      const ra = this.riderActions.get('attack');
      if (ra) {
        ra.reset().play();
        const sit = this.riderActions.get('sit');
        ra.crossFadeFrom(sit ?? ra, 0.05, false);
        setTimeout(() => {
          if (sit && !this.disposed) {
            sit.enabled = true;
            sit.setEffectiveWeight(1);
            sit.crossFadeFrom(ra, 0.15, false);
          }
        }, 450);
      }
    }
  }

  onAttack(): void {
    this.attackTimer = Math.min(0.9, this.unit.hitSpeed * 0.85);
    const a = this.actions.get('attack');
    if (a) {
      a.timeScale = Math.max(1, a.getClip().duration / Math.max(0.25, this.unit.hitSpeed * 0.9));
      this.play('attack', 0.08);
    } else if (this.model) {
      // No attack clip: a lunge.
      this.model.root.position.z = 0.25;
    }
  }

  update(dt: number, t: number): void {
    const u = this.unit;
    const p = toWorld(u.x, u.y);
    const g = this.group;
    const s = this.scene;
    // Smooth position (sim runs at 30 Hz).
    const px = g.position.x;
    const pz = g.position.z;
    g.position.x += (p.x - g.position.x) * Math.min(1, dt * 18);
    g.position.z += (p.z - g.position.z) * Math.min(1, dt * 18);
    const fly = u.flying ? (FLY_HEIGHT + Math.sin(t * 2.2 + u.id) * 0.12) / UNIT_SCALE : 0;
    const model = this.model?.root;
    if (u.dash?.jump) {
      const k = u.dash.t / u.dash.dur;
      if (model) model.position.y = (Math.sin(k * Math.PI) * 2.2) / UNIT_SCALE;
    } else if (u.burrow) {
      if (model) model.position.y = -3;
    } else if (model) model.position.y += (fly - model.position.y) * Math.min(1, dt * 10);
    if (this.shadow) this.shadow.scale.setScalar(this.r * 0.8 * (0.85 + Math.sin(t * 2.2 + u.id) * 0.05));
    // Facing.
    const want = Math.atan2(u.dirX, u.dirY);
    let d = want - this.facing;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.facing += d * Math.min(1, dt * 12);
    if (model) model.rotation.y = this.facing;

    // Deploy: a countdown arc for the deploy time and a card-shaped shadow the unit lands on.
    this.spawnT += dt;
    const deploying = u.deploy > 0 && !u.burrow && !u.dead;
    this.deployMax = Math.max(this.deployMax, u.deploy);
    const total = Math.max(this.deployMax, 0.2);
    this.arc.visible = deploying;
    if (deploying) {
      const k = Math.max(0, Math.min(1, u.deploy / total));
      this.arc.geometry = s.arcGeo(k);
      (this.arc.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.4 * k;
    }
    const land = deploying ? 1 : Math.max(0, 1 - (this.spawnT - Math.max(0.3, this.deployMax)) / 0.35);
    this.landing.visible = land > 0.01 && u.kind === 'troop' && !u.flying;
    if (this.landing.visible) {
      (this.landing.material as THREE.MeshBasicMaterial).opacity = 0.42 * land;
      const sc = Math.max(0.9, this.r * 2.1) * (1 + (1 - Math.min(1, this.spawnT / 0.3)) * 0.5);
      this.landing.scale.set(sc, sc, 1);
    }
    if (model) {
      const pop = Math.min(1, this.spawnT / 0.28);
      const squash = pop < 1 ? 0.6 + pop * 0.4 + Math.sin(pop * Math.PI) * 0.25 : 1;
      const dropY = pop < 1 && !u.flying ? (1 - pop) * 2.5 : 0;
      if (!u.dead || this.actions.get('death')) model.scale.set(squash, squash * (pop < 1 ? 1.1 - pop * 0.1 : 1), squash);
      if (dropY) model.position.y = dropY;
      if (model.position.z > 0) model.position.z = Math.max(0, model.position.z - dt * 1.5);
    }
    this.disc.visible = !u.burrow && !u.dead;
    if (model) {
      // Invisible units ghost out; corpses fade smoothly over their linger time (2.5 s).
      const fade = u.dead ? 1 - THREE.MathUtils.smoothstep(u.deadFor, 0.7, 2.35) : u.invisible ? 0.25 : 1;
      for (const m of this.model!.materials) {
        if (fade < 0.999) {
          m.transparent = true;
          m.opacity = fade;
          m.depthWrite = fade > 0.5;
        } else if (m.transparent) {
          m.transparent = false;
          m.opacity = 1;
          m.depthWrite = true;
        }
      }
      if (u.hidden) model.position.y = Math.max(model.position.y - dt * 6, -1.6);
    }
    // Hit flash + freeze/rage tint.
    if (u.hitFlash > 0.1) this.flash = 1;
    this.flash = Math.max(0, this.flash - dt * 7);
    if (this.model) {
      for (const m of this.model.materials) {
        if (!m.emissive) continue;
        const base = m.userData.baseEmissive as THREE.Color;
        if (u.freeze > 0) {
          m.emissive.setRGB(0.35, 0.7, 1);
          m.emissiveIntensity = 0.9;
        } else if (this.flash > 0) {
          m.emissive.setRGB(1, 1, 1);
          m.emissiveIntensity = this.flash * 0.7;
        } else if (u.rage > 0) {
          m.emissive.setRGB(0.55, 0.1, 0.7);
          m.emissiveIntensity = 0.35;
        } else {
          m.emissive.copy(base);
          m.emissiveIntensity = m.userData.baseEmissiveIntensity as number;
        }
      }
    }
    // Status effects.
    if (!u.dead && !u.burrow && !(u.hidden && u.kind === 'building')) {
      const gy = u.flying ? FLY_HEIGHT : 0;
      const head = gy + this.height * UNIT_SCALE + 0.35;
      const gp = g.position;
      if (u.freeze > 0) s.status.freeze(gp.x, gy, gp.z, Math.max(0.42, this.r * 0.95), this.height * UNIT_SCALE, u.id);
      if (u.stun > 0 && u.freeze <= 0) s.status.stun(gp.x, head, gp.z, t + u.id);
      this.fxT += dt;
      if (this.fxT > 0.05) {
        this.fxT = 0;
        const mvx = gp.x - px;
        const mvz = gp.z - pz;
        if (u.rage > 0 && Math.hypot(mvx, mvz) > 1e-3) {
          // Purple speed lines streaming off the back.
          const l = Math.hypot(mvx, mvz);
          const side = (Math.random() - 0.5) * this.r * 1.6;
          s.glow.emit({ x: gp.x - (mvx / l) * this.r + (-mvz / l) * side, y: gy + 0.3 + Math.random() * this.height, z: gp.z - (mvz / l) * this.r + (mvx / l) * side, vx: (-mvx / l) * 6, vz: (-mvz / l) * 6, life: 0.22, size: 0.22, color: '#c86bff', drag: 4 });
        } else if (u.rage > 0 && Math.random() < 0.4) s.glow.emit({ x: gp.x + (Math.random() - 0.5) * this.r, y: gy + 0.2, z: gp.z + (Math.random() - 0.5) * this.r, vy: 1.6, life: 0.5, size: 0.25, color: '#c86bff', alpha: 0.8 });
        if (u.freeze > 0 && Math.random() < 0.5) s.glow.emit({ x: gp.x + (Math.random() - 0.5) * this.r * 2, y: gy + Math.random() * this.height * UNIT_SCALE, z: gp.z + (Math.random() - 0.5) * this.r * 2, vy: 0.3, life: 0.6, size: 0.22, color: '#e8fbff' });
        if (u.stun > 0 && u.freeze <= 0 && Math.random() < 0.3) s.glow.emit({ x: gp.x, y: head, z: gp.z, vx: (Math.random() - 0.5) * 2, vy: 0.6, vz: (Math.random() - 0.5) * 2, life: 0.35, size: 0.2, color: '#ffe14d' });
        if (u.slow > 0 && u.freeze <= 0 && Math.random() < 0.7) s.glow.emit({ x: gp.x + (Math.random() - 0.5) * this.r * 1.4, y: gy + this.height * UNIT_SCALE * (0.4 + Math.random() * 0.5), z: gp.z + (Math.random() - 0.5) * this.r * 1.4, vy: -0.4, gravity: 5, life: 0.55, size: 0.16, color: '#5fb8ff' });
      }
    }
    // Animation state.
    if (this.ready && this.model) {
      if (u.dead) {
        if (this.current !== 'death') this.play('death', 0.1);
      } else if (u.attackSeq !== this.attackSeq) {
        this.attackSeq = u.attackSeq;
        this.onAttack();
      } else if (this.attackTimer > 0) {
        this.attackTimer -= dt;
      } else {
        this.play(u.moving ? 'move' : 'idle');
      }
      const speedScale = u.freeze > 0 || u.stun > 0 ? 0 : u.rage > 0 ? 1.35 : u.slow > 0 ? 0.65 : 1;
      for (const mx of this.model.mixers) mx.update(dt * speedScale);
      const move = this.actions.get('move');
      if (move && this.current === 'move') move.timeScale = Math.max(0.6, (u.speed * (u.charging ? 2 : 1)) / 1.2);
      // Procedural extras.
      const charge = this.model.root.getObjectByName('charge');
      if (charge) charge.scale.setScalar(1 + Math.sin(t * 6) * 0.08 + (u.card.id === 'volt-cannon' ? Math.max(0, 1 - u.attackCd / u.hitSpeed) * 0.4 : 0));
      const spin = this.model.root.getObjectByName('spin');
      if (spin) spin.rotation.y += dt * 12;
      if (u.dead && !this.actions.get('death') && model) {
        model.rotation.z += dt * 6;
        model.scale.multiplyScalar(Math.max(0, 1 - dt * 3));
      }
    }
    this.updateBar(u);
  }

  private updateBar(u: Unit): void {
    const show = !u.dead && !u.burrow && (u.kind === 'tower' || u.hp < u.maxHp || u.shield < u.maxShield) && !(u.invisible && u.team === 'red');
    this.hpEl.style.display = show ? '' : 'none';
    if (!show) return;
    if (u.hp !== this.lastHp) {
      this.lastHp = u.hp;
      this.hpFill.style.width = `${Math.max(0, (u.hp / u.maxHp) * 100)}%`;
      if (u.kind === 'tower') this.hpEl.dataset.hp = String(Math.ceil(Math.max(0, u.hp)));
    }
    if (this.shieldFill && u.shield !== this.lastShield) {
      this.lastShield = u.shield;
      this.shieldFill.style.width = `${(u.shield / Math.max(1, u.maxShield)) * 100}%`;
    }
    const head = u.kind === 'tower' ? (u.role === 'king' ? 4.9 : 4.1) : (u.flying ? FLY_HEIGHT : 0) + this.height * UNIT_SCALE + 0.3;
    const s = this.scene.project(toWorld(u.x, u.y, head));
    this.hpEl.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`;
  }

  /** Remove from the scene; the model goes back to the pool for the next unit of this card. */
  dispose(): void {
    this.disposed = true;
    this.hpEl.remove();
    this.group.removeFromParent();
    (this.arc.material as THREE.Material).dispose();
    (this.landing.material as THREE.Material).dispose();
    if (this.model) this.scene.giveModel(this.unit.card, this.unit.team, this.model);
    this.model = null;
  }
}

// ============================================================================ tower view

class TowerView {
  readonly group = new THREE.Group();
  private defender: { root: THREE.Group; mixer: THREE.AnimationMixer | null; idle?: THREE.AnimationAction; shoot?: THREE.AnimationAction; mats: THREE.MeshStandardMaterial[]; baseY: number } | null = null;
  private body = new THREE.Group();
  private cannon: THREE.Object3D | null = null;
  private attackSeq = 0;
  private down = false;
  /** Collapse: time since the tower fell, the falling rubble and the tilt direction. */
  private fallT = 0;
  private rocks: Array<{ m: THREE.Mesh; v: THREE.Vector3; w: THREE.Vector3; r: number }> = [];
  private tilt = 0;
  /** King: 0 asleep (sunk + dark) → 1 awake; animates on activation. */
  private wake = 0;
  private wasActive = true;
  readonly bar: UnitView;
  readonly built: Promise<void>;

  constructor(
    readonly unit: Unit,
    private readonly scene: ArenaScene,
  ) {
    const p = toWorld(unit.x, unit.y);
    this.group.position.copy(p);
    this.group.add(this.body);
    this.bar = new UnitView(unit, scene);
    this.bar.group.visible = false;
    this.wasActive = unit.active;
    this.wake = unit.active ? 1 : 0;
    this.built = this.build();
  }

  private async build(): Promise<void> {
    const king = this.unit.role === 'king';
    const team = this.unit.team;
    const tc = TEAM_COLORS[team];
    const w = king ? 3.9 : 3.0;
    const stack = king ? ['p-castle-tower-hexagon-base', 'p-castle-tower-hexagon-mid', 'p-castle-tower-hexagon-top'] : ['p-castle-tower-square-base', 'p-castle-tower-square-mid-windows', 'p-castle-tower-square-top'];
    let y = 0;
    for (const [i, name] of stack.entries()) {
      try {
        const piece = await instantiate(name, 1);
        const box = new THREE.Box3().setFromObject(piece.root);
        const size = box.getSize(new THREE.Vector3());
        const k = w / Math.max(size.x, size.z);
        const yScale = king ? 0.82 : 0.78;
        piece.root.scale.set(k, k * yScale, k);
        piece.root.position.y = y;
        y += size.y * k * yScale * (i === stack.length - 1 ? 1 : 0.98);
        this.body.add(piece.root);
      } catch {
        /* missing piece */
      }
    }
    // Team roof banner band + flags.
    const band = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.56, w * 0.56, 0.35, king ? 6 : 4, 1, true), new THREE.MeshStandardMaterial({ color: tc.main, roughness: 0.6, side: THREE.DoubleSide }));
    band.rotation.y = king ? 0 : Math.PI / 4;
    band.position.y = y * 0.55;
    band.castShadow = true;
    this.body.add(band);
    for (const sx of [-1, 1]) {
      const pole = new THREE.Mesh(this.scene.res('flag-pole', () => new THREE.CylinderGeometry(0.04, 0.05, 1.6, 6)), this.scene.res('gold', () => new THREE.MeshStandardMaterial({ color: '#ffcf3f', metalness: 0.5, roughness: 0.35 })));
      pole.position.set(sx * w * 0.42, y + 0.6, w * 0.3);
      this.body.add(pole);
      const flag = new THREE.Mesh(this.scene.res('flag', () => new THREE.PlaneGeometry(0.8, 0.5)), this.scene.res(`flag-${team}`, () => new THREE.MeshStandardMaterial({ color: tc.main, side: THREE.DoubleSide, roughness: 0.7 })));
      flag.position.set(sx * w * 0.42 + 0.4, y + 1.15, w * 0.3);
      flag.name = 'flag';
      this.body.add(flag);
    }
    // Defender on top (own materials: the king dims while asleep).
    try {
      const card = king ? { model: 'c-knight-golden-male', h: 2.1 } : { model: 'c-elf', h: 1.8 };
      const inst = await instantiate(card.model, card.h, team === 'red' && !king ? { color: '#ffc8c8' } : undefined);
      inst.root.position.y = y - 0.15;
      inst.root.rotation.y = team === 'blue' ? Math.PI : 0;
      this.body.add(inst.root);
      const mats: THREE.MeshStandardMaterial[] = [];
      inst.root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const own = (src: THREE.Material) => {
          const c = src.clone() as THREE.MeshStandardMaterial;
          c.userData.base = c.color?.clone();
          mats.push(c);
          return c;
        };
        m.material = Array.isArray(m.material) ? m.material.map(own) : own(m.material);
      });
      const idle = inst.mixer ? findClip(inst.clips, /^Idle$/) : undefined;
      const shoot = inst.mixer ? findClip(inst.clips, /^Shoot_OneHanded$/, /^Punch$/) : undefined;
      this.defender = { root: inst.root, mixer: inst.mixer, mats, baseY: y - 0.15 };
      if (inst.mixer && idle) {
        this.defender.idle = inst.mixer.clipAction(idle);
        this.defender.idle.play();
      }
      if (inst.mixer && shoot) {
        this.defender.shoot = inst.mixer.clipAction(shoot);
        this.defender.shoot.setLoop(THREE.LoopOnce, 1);
      }
      if (king) {
        const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.24, 0.22, 8, 1, true), new THREE.MeshStandardMaterial({ color: '#ffcf3f', metalness: 0.6, roughness: 0.3, side: THREE.DoubleSide }));
        crown.position.y = 2.25;
        inst.root.add(crown);
        const cannon = await instantiate('p-tower-weapon-cannon', 1.3);
        cannon.root.position.set(0, y - 0.1, team === 'blue' ? -1.25 : 1.25);
        cannon.root.rotation.y = team === 'blue' ? Math.PI : 0;
        this.cannon = cannon.root;
        this.body.add(cannon.root);
      }
      this.applyWake();
    } catch {
      /* no defender */
    }
  }

  /** King asleep: sunk into the battlements and dimmed; awake: standing tall. */
  private applyWake(): void {
    const d = this.defender;
    if (!d || this.unit.role !== 'king') return;
    const k = this.wake;
    const rise = k < 1 ? 1 - Math.pow(1 - k, 3) + Math.sin(k * Math.PI) * 0.12 : 1;
    d.root.position.y = d.baseY - 0.45 * (1 - rise);
    const dim = 0.5 + 0.5 * k;
    for (const m of d.mats) if (m.color && m.userData.base) m.color.copy(m.userData.base as THREE.Color).multiplyScalar(dim);
  }

  update(dt: number, t: number): void {
    const u = this.unit;
    for (const f of this.body.children) if (f.name === 'flag') f.rotation.y = Math.sin(t * 3 + f.position.x) * 0.25;
    if (this.defender?.mixer) this.defender.mixer.update(u.role === 'king' && !u.active ? dt * 0.3 : dt);
    // Defender faces its target.
    const target = u.targetId >= 0 ? this.scene.engine.unit(u.targetId) : undefined;
    if (target && this.defender) {
      const a = Math.atan2(target.x - u.x, target.y - u.y);
      this.defender.root.rotation.y += (a - this.defender.root.rotation.y) * Math.min(1, dt * 8);
      if (this.cannon) this.cannon.rotation.y = a;
    }
    if (u.attackSeq !== this.attackSeq) {
      this.attackSeq = u.attackSeq;
      if (this.defender?.shoot) {
        this.defender.shoot.reset().play();
        this.defender.shoot.crossFadeFrom(this.defender.idle ?? this.defender.shoot, 0.05, false);
        setTimeout(() => this.defender?.idle && this.defender.idle.crossFadeFrom(this.defender.shoot!, 0.2, false).play(), 500);
      }
    }
    // King wakes up: gold burst + a bolt from the sky, and he rises.
    if (u.role === 'king') {
      if (u.active && !this.wasActive) this.activate();
      this.wasActive = u.active;
      if (u.active && this.wake < 1) {
        this.wake = Math.min(1, this.wake + dt / 0.7);
        this.applyWake();
      }
    }
    if (u.dead && !this.down) this.collapse();
    if (this.down) this.updateCollapse(dt);
    this.bar.update(dt, t);
  }

  private activate(): void {
    const s = this.scene;
    const p = this.group.position;
    s.rings.add(p.x, p.z, 0.5, 4.5, '#ffd23f', 0.7, 0.2);
    s.rings.add(p.x, p.z, 0.3, 3, '#fff3b0', 0.5, 3.6);
    s.glow.ring(p.x, p.z, 2.2, 28, '#ffd23f', 3.4, { life: 0.8, size: 0.55, out: 3 });
    s.glow.burst(p.x, 4.4, p.z, 26, '#ffe066', 3, { life: 0.8, size: 0.5, up: 3, gravity: 1 });
    s.bolts.add(new THREE.Vector3(p.x + 0.6, 22, p.z), new THREE.Vector3(p.x, 4, p.z), '#fff6c0', 0.45, 1.4);
    s.addShake(0.35, 0.4);
  }

  private collapse(): void {
    this.down = true;
    this.fallT = 0;
    this.tilt = (Math.random() < 0.5 ? -1 : 1) * (0.18 + Math.random() * 0.1);
    const s = this.scene;
    const rock = s.res('rubble', () => new THREE.MeshStandardMaterial({ color: '#8f97a8', roughness: 0.9 }));
    const rubble = new THREE.Group();
    for (let i = 0; i < 20; i++) {
      const r = 0.18 + Math.random() * 0.32;
      const m = new THREE.Mesh(s.res('dodeca', () => new THREE.DodecahedronGeometry(1)), rock);
      m.scale.setScalar(r);
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * 1.1;
      m.position.set(Math.cos(a) * d, 1 + Math.random() * 3, Math.sin(a) * d);
      m.castShadow = true;
      rubble.add(m);
      const out = 1.5 + Math.random() * 3;
      this.rocks.push({ m, r, v: new THREE.Vector3(Math.cos(a) * out, 2 + Math.random() * 4, Math.sin(a) * out), w: new THREE.Vector3(Math.random() * 8 - 4, Math.random() * 8 - 4, Math.random() * 8 - 4) });
    }
    const scorch = new THREE.Mesh(s.res('scorch-geo', () => new THREE.CircleGeometry(2.6, 32)), s.res('scorch', () => new THREE.MeshBasicMaterial({ color: '#2a1d12', alphaMap: s.scorchTex(), transparent: true, opacity: 0.8, depthWrite: false })));
    scorch.rotation.x = -Math.PI / 2;
    scorch.position.y = 0.03;
    scorch.renderOrder = 3;
    rubble.add(scorch);
    const banner = new THREE.Mesh(s.res('flag', () => new THREE.PlaneGeometry(0.8, 0.5)), s.res(`flag-${this.unit.team}`, () => new THREE.MeshStandardMaterial({ color: TEAM_COLORS[this.unit.team].main, side: THREE.DoubleSide })));
    banner.position.set(0.5, 0.25, 0.6);
    banner.rotation.set(-1.2, 0.4, 0.2);
    rubble.add(banner);
    this.group.add(rubble);
  }

  private updateCollapse(dt: number): void {
    this.fallT += dt;
    // The body crumples (squash + tilt) over 0.6 s, the defender topples with it.
    const k = Math.min(1, this.fallT / 0.6);
    const e = k * k * (3 - 2 * k);
    this.body.scale.set(1 + e * 0.12, 1 - 0.7 * e, 1 + e * 0.12);
    this.body.rotation.z = this.tilt * e;
    this.body.position.y = -0.15 * e;
    if (this.defender) this.defender.root.visible = k < 0.5;
    if (this.cannon) this.cannon.visible = k < 0.5;
    for (const f of this.body.children) if (f.name === 'flag') f.visible = k < 0.4;
    if (this.fallT > 4) return;
    for (const r of this.rocks) {
      const { m, v, w } = r;
      v.y -= 18 * dt;
      m.position.addScaledVector(v, dt);
      m.rotation.x += w.x * dt;
      m.rotation.y += w.y * dt;
      m.rotation.z += w.z * dt;
      if (m.position.y < r.r * 0.8) {
        m.position.y = r.r * 0.8;
        v.y = Math.abs(v.y) > 1.2 ? -v.y * 0.35 : 0;
        v.x *= 0.6;
        v.z *= 0.6;
        w.multiplyScalar(0.6);
      }
    }
  }
}

// ============================================================================ projectile + area views

const glowMat = (color: string) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });

class ProjectileView {
  readonly obj: THREE.Object3D;
  private last = new THREE.Vector3();
  private spin: THREE.Object3D | null = null;
  private age = 0;
  constructor(
    readonly p: Projectile,
    private readonly scene: ArenaScene,
  ) {
    this.obj = new THREE.Group();
    const s = scene;
    const k = p.kind;
    const add = (o: THREE.Object3D) => this.obj.add(o);
    const std = (color: string, metal = 0) => s.res(`std-${color}-${metal}`, () => new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: 0.5 }));
    const glow = (color: string) => s.res(`glow-${color}`, () => glowMat(color));
    if (k === 'arrow' || k === 'bolt' || k === 'spear' || k === 'dart') {
      const len = k === 'spear' ? 0.9 : k === 'dart' ? 0.35 : 0.6;
      const shaft = new THREE.Mesh(s.res(`shaft-${len}`, () => new THREE.CylinderGeometry(0.03, 0.03, len, 5)), std(k === 'bolt' ? '#5a5a6a' : '#8a5a2a'));
      shaft.rotation.x = Math.PI / 2;
      add(shaft);
      const tip = new THREE.Mesh(s.res('tip', () => new THREE.ConeGeometry(0.06, 0.16, 5)), std('#dfe8f0', 0.6));
      tip.rotation.x = Math.PI / 2;
      tip.position.z = len / 2;
      add(tip);
      if (p.card?.id === 'princess' || p.spellCard) {
        const fire = new THREE.Mesh(s.res('sphere-0.12', () => new THREE.SphereGeometry(0.12, 8, 6)), glow('#ff8c1a'));
        fire.position.z = len / 2;
        add(fire);
      }
    } else if (k === 'cannonball' || k === 'bomb' || k === 'boulder') {
      const r = k === 'boulder' ? 0.42 : k === 'bomb' ? 0.22 : 0.18;
      const ball = new THREE.Group();
      ball.add(new THREE.Mesh(s.res(`ball-${r}`, () => new THREE.SphereGeometry(r, 12, 10)), std(k === 'boulder' ? '#8a8f9c' : '#2a2638', k === 'boulder' ? 0 : 0.4)));
      if (k === 'bomb') {
        const fuse = new THREE.Mesh(s.res('fuse', () => new THREE.SphereGeometry(0.07, 6, 4)), glow('#ffcf3f'));
        fuse.position.y = 0.24;
        ball.add(fuse);
      } else {
        // A highlight band so the spin reads.
        const band = new THREE.Mesh(s.res(`band-${r}`, () => new THREE.TorusGeometry(r * 0.98, r * 0.12, 4, 14)), std(k === 'boulder' ? '#6f7480' : '#4a4660', 0.5));
        ball.add(band);
      }
      this.spin = ball;
      add(ball);
      // Muzzle puff at launch.
      if (!p.spellCard && p.id >= 0) {
        const o = toWorld(p.fromX, p.fromY, p.z);
        s.dust.burst(o.x, o.y, o.z, k === 'boulder' ? 5 : 7, '#d8d4cc', 1.2, { life: 0.6, size: 0.55, up: 0.6, gravity: -0.4, grow: 1.1, spread: 0.3 });
      }
    } else if (k === 'axe') {
      add(new THREE.Mesh(s.res('axe', () => new THREE.BoxGeometry(0.08, 0.6, 0.7)), std('#c8d4e0', 0.7)));
    } else if (k === 'rocket') {
      const body = new THREE.Mesh(s.res('rocket-body', () => new THREE.CylinderGeometry(0.18, 0.22, 1.1, 10)), std('#e8eef5'));
      body.rotation.x = Math.PI / 2;
      add(body);
      const nose = new THREE.Mesh(s.res('rocket-nose', () => new THREE.ConeGeometry(0.18, 0.35, 10)), std('#ff3b5c'));
      nose.rotation.x = Math.PI / 2;
      nose.position.z = 0.7;
      add(nose);
      if (!p.spellCard) this.obj.scale.setScalar(0.55);
    } else {
      const color = { fireball: '#ff8c1a', iceball: '#9fe8ff', magic: '#d36bff', zap: '#7fe3ff', flame: '#ff6a1a', shot: '#ffe14d', firework: '#ff4fd8', hook: '#c8d4e0', heal: '#ffe48a' }[k as string] ?? '#ffffff';
      const size = k === 'fireball' && p.spellCard ? 0.75 : k === 'shot' ? 0.1 : 0.22;
      add(new THREE.Mesh(s.res(`orb-${size}`, () => new THREE.SphereGeometry(size, 12, 10)), glow(color)));
      add(new THREE.Mesh(s.res(`halo-${size}`, () => new THREE.SphereGeometry(size * 1.8, 12, 10)), s.res(`halo-${color}`, () => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false }))));
    }
    if (p.spellCard?.id === 'goblin-keg' || p.spellCard?.id === 'giant-snowball') {
      this.obj.clear();
      const snow = p.spellCard.id === 'giant-snowball';
      add(new THREE.Mesh(s.res(`keg-${snow}`, () => new THREE.SphereGeometry(snow ? 0.8 : 0.5, 14, 12)), std(snow ? '#f4fbff' : '#9a6237')));
    }
    if (p.spellCard?.id === 'arrows') {
      this.obj.clear();
      for (let i = 0; i < 9; i++) {
        const shaft = new THREE.Mesh(s.res('shaft-0.6', () => new THREE.CylinderGeometry(0.03, 0.03, 0.6, 5)), std('#8a5a2a'));
        shaft.rotation.x = Math.PI / 2;
        shaft.position.set((Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 1.6);
        add(shaft);
      }
    }
    const w = toWorld(p.x, p.y, p.z);
    this.obj.position.copy(w);
    this.last.copy(w);
  }

  update(dt: number): void {
    const p = this.p;
    const w = toWorld(p.x, p.y, p.z);
    const dir = w.clone().sub(this.last);
    const moved = dir.length();
    if (moved > 1e-3) this.obj.lookAt(w.clone().add(dir));
    this.obj.position.copy(w);
    this.age += dt;
    if (p.kind === 'axe' || p.kind === 'boulder') this.obj.rotateX(dt * (p.kind === 'axe' ? 18 : 8));
    if (this.spin && p.kind !== 'boulder') this.spin.rotation.x += dt * (p.kind === 'bomb' ? 9 : 14);
    const fx = this.scene;
    const k = p.kind;
    if (k === 'fireball' || k === 'flame') fx.glow.emit({ x: w.x, y: w.y, z: w.z, life: 0.3, size: p.spellCard ? 1.1 : 0.45, color: Math.random() < 0.5 ? '#ff8c1a' : '#ffcf3f', vy: 0.4, grow: -0.6 });
    else if (k === 'magic') fx.glow.emit({ x: w.x, y: w.y, z: w.z, life: 0.25, size: 0.35, color: '#d36bff', grow: -0.6 });
    else if (k === 'iceball') fx.glow.emit({ x: w.x, y: w.y, z: w.z, life: 0.25, size: 0.35, color: '#9fe8ff', grow: -0.6 });
    else if (k === 'rocket') fx.dust.emit({ x: w.x, y: w.y, z: w.z, life: 0.8, size: 0.7, color: '#e8e8f0', grow: 1.2, vy: 0.3 });
    else if (k === 'firework') fx.glow.emit({ x: w.x, y: w.y, z: w.z, life: 0.3, size: 0.3, color: '#ff4fd8' });
    else if ((k === 'arrow' || k === 'bolt' || k === 'dart' || k === 'spear') && moved > 1e-3 && !p.spellCard) {
      // Short streak behind the arrow.
      for (let i = 1; i <= 2; i++) {
        const b = this.last.clone().lerp(w, i / 2);
        fx.dust.emit({ x: b.x, y: b.y, z: b.z, life: 0.16, size: 0.14, color: p.card?.id === 'princess' ? '#ffb347' : '#f4f0e6', alpha: 0.55, grow: -0.3 });
      }
    } else if ((k === 'cannonball' || k === 'bomb') && Math.random() < 0.35) fx.dust.emit({ x: w.x, y: w.y, z: w.z, life: 0.35, size: 0.25, color: '#b8b4ac', alpha: 0.45, grow: 0.5 });
    this.last.copy(w);
  }
}

class AreaView {
  readonly obj = new THREE.Group();
  private disc: THREE.Mesh | null = null;
  private log: THREE.Object3D | null = null;
  private crate: THREE.Object3D | null = null;
  constructor(
    readonly area: Area,
    private readonly scene: ArenaScene,
  ) {
    const fx = area.card.spell?.fx;
    const colors: Record<string, string> = { poison: '#7be36b', freeze: '#bff2ff', rage: '#c86bff', tornado: '#c8e8f0', quake: '#c9a070', graveyard: '#6a5a8a', void: '#2a1a4a', vines: '#3fbf4a', curse: '#9bf06b', crate: '#ffcf3f' };
    const color = colors[fx ?? ''] ?? '#ffffff';
    if (fx === 'log' || (fx === 'barrel' && area.roll)) {
      const roll = new THREE.Group();
      const geo = fx === 'log' ? new THREE.CylinderGeometry(0.35, 0.35, area.radius * 2, 14) : new THREE.CylinderGeometry(0.4, 0.4, 0.8, 12);
      const l = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#9a6237', roughness: 0.8 }));
      l.rotation.z = Math.PI / 2;
      l.castShadow = true;
      roll.add(l);
      roll.position.y = 0.38;
      this.log = roll;
      this.obj.add(roll);
    } else if (fx === 'crate') {
      const c = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), new THREE.MeshStandardMaterial({ color: TEAM_COLORS[area.team].main }));
      c.castShadow = true;
      this.crate = c;
      this.obj.add(c);
    }
    if (area.card.id !== 'lightning' && !area.roll) {
      this.disc = new THREE.Mesh(new THREE.CircleGeometry(area.radius, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: fx === 'void' ? 0.55 : 0.32, depthWrite: false }));
      this.disc.rotation.x = -Math.PI / 2;
      this.disc.position.y = 0.06;
      this.disc.renderOrder = 6;
      this.obj.add(this.disc);
    }
    this.obj.position.copy(toWorld(area.x, area.y));
  }

  update(dt: number, t: number): void {
    const a = this.area;
    const w = toWorld(a.x, a.y);
    this.obj.position.copy(w);
    const fx = a.card.spell?.fx;
    const s = this.scene;
    const r = a.radius;
    const rnd = () => {
      const ang = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * r;
      return { x: w.x + Math.cos(ang) * d, z: w.z + Math.sin(ang) * d };
    };
    if (this.log) {
      this.log.rotation.x -= dt * 10;
      if (Math.random() < 0.6) s.dust.emit({ x: w.x + (Math.random() - 0.5) * r * 2, y: 0.1, z: w.z, vy: 0.8, life: 0.5, size: 0.6, color: '#c9a070', grow: 1 });
    }
    if (this.crate) {
      const k = Math.min(1, a.t / a.duration);
      this.crate.position.y = (1 - k * k) * 14 + 0.6;
      this.crate.rotation.y += dt * 2;
    }
    if (this.disc) {
      const life = a.duration > 0 ? 1 - a.t / a.duration : 1;
      (this.disc.material as THREE.MeshBasicMaterial).opacity = Math.min(0.4, life * 2) * (fx === 'void' ? 1.4 : 1);
      this.disc.scale.setScalar(1 + Math.sin(t * 5) * 0.02);
    }
    const n = Math.random();
    if (fx === 'poison' && n < 0.7) s.glow.emit({ ...rnd(), y: 0.2, vy: 0.8, life: 0.9, size: 0.5, color: '#7be36b', alpha: 0.6 });
    if (fx === 'freeze' && n < 0.5) s.glow.emit({ ...rnd(), y: 0.3, vy: 0.6, life: 0.8, size: 0.35, color: '#e8fbff' });
    if (fx === 'rage' && n < 0.6) s.glow.emit({ ...rnd(), y: 0.2, vy: 1.4, life: 0.7, size: 0.45, color: '#c86bff', alpha: 0.7 });
    if (fx === 'tornado') {
      for (let i = 0; i < 3; i++) {
        const ang = t * 6 + i * 2.1 + Math.random();
        const d = (0.3 + Math.random()) * r * 0.6;
        s.dust.emit({ x: w.x + Math.cos(ang) * d, y: Math.random() * 3, z: w.z + Math.sin(ang) * d, vx: -Math.sin(ang) * 6, vz: Math.cos(ang) * 6, vy: 1.5, life: 0.5, size: 0.6, color: '#d8eef4', alpha: 0.7 });
      }
    }
    if (fx === 'quake' && n < 0.8) s.dust.emit({ ...rnd(), y: 0.1, vy: 2, life: 0.6, size: 0.6, color: '#c9a070', gravity: 5 });
    if (fx === 'graveyard' && n < 0.4) s.dust.emit({ ...rnd(), y: 0.2, vy: 0.3, life: 1.4, size: 1.2, color: '#5a4a7a', alpha: 0.5, grow: 0.5 });
    if (fx === 'void' && n < 0.8) s.glow.emit({ ...rnd(), y: 0.3, vy: 1.2, life: 0.6, size: 0.5, color: '#7b2fc0' });
    if (fx === 'vines' && n < 0.5) s.glow.emit({ ...rnd(), y: 0.4, vy: 1, life: 0.6, size: 0.35, color: '#5fdf5a' });
    if (fx === 'curse' && n < 0.5) s.glow.emit({ ...rnd(), y: 0.3, vy: 0.9, life: 0.7, size: 0.4, color: '#9bf06b', alpha: 0.7 });
    if (s.engine.areas.includes(a) === false) this.obj.visible = false;
  }

  dispose(): void {
    this.obj.removeFromParent();
    this.obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    });
  }
}

// ============================================================================ scene

export class ArenaScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(36, 1, 0.5, 300);
  readonly hud: HTMLDivElement;
  readonly glow = new Particles(1400, true, 0.15);
  readonly dust = new Particles(900, false, 0.35);
  readonly bolts = new Bolts();
  readonly rings = new Rings();
  readonly status = new StatusFx();
  readonly numbers: FloatingNumbers;
  private units = new Map<number, UnitView>();
  private towers = new Map<number, TowerView>();
  private projectiles = new Map<number, ProjectileView>();
  private areaViews = new Map<number, AreaView>();
  private water!: THREE.ShaderMaterial;
  private zone!: THREE.Mesh;
  private zoneTex!: THREE.CanvasTexture;
  private zoneKey = '';
  private ghost: { id: string; obj: THREE.Group; ring: THREE.Mesh; hatch: THREE.Mesh } | null = null;
  /** Built ghost models per card, so re-selecting a card doesn't rebuild it. */
  private ghostModels = new Map<string, THREE.Object3D>();
  private shake = 0;
  private shakeT = 0;
  private shakeDur = 0.3;
  private punchT = 0;
  private punchDur = 0.5;
  private punchAmt = 0;
  private readonly timer = new THREE.Timer();
  private camBase = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private readonly v = new THREE.Vector3();
  private size = { w: 1, h: 1 };
  /** Screen pixels reserved at the bottom (card hand), top (HUD) and right (docked hand). */
  private reserve = { top: 70, bottom: 0, right: 0 };
  /** Shared geometries / materials / textures (disposed with the scene). */
  private shared = new Map<string, { dispose(): void }>();
  /** Card models ready for reuse, keyed by card + team. */
  private pool = new Map<string, BuiltModel[]>();
  private decorReady: Promise<unknown> = Promise.resolve();
  private readonly onResize = () => this.resize();
  /** Called for battle events (audio, UI). */
  onEvent: ((e: BattleEvent) => void) | null = null;

  constructor(
    readonly engine: BattleEngine,
    container: HTMLElement,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'cf-canvas';
    container.appendChild(this.canvas);
    this.hud = document.createElement('div');
    this.hud.className = 'cf-world-hud';
    container.appendChild(this.hud);
    this.numbers = new FloatingNumbers(this.hud, (p) => this.project(p));
    this.scene.add(this.glow.points, this.dust.points, this.bolts.group, this.rings.group, this.status.group);
    this.buildSky();
    this.buildLights();
    this.buildArena();
    this.buildDecor();
    this.resize();
    addEventListener('resize', this.onResize);
  }

  // ---------------------------------------------------------------- resources

  /** A geometry / material shared by every view in this scene. */
  res<T extends { dispose(): void }>(key: string, make: () => T): T {
    let r = this.shared.get(key);
    if (!r) {
      r = make();
      this.shared.set(key, r);
    }
    return r as T;
  }

  /** Deploy countdown ring, quantised so the geometries are shared. */
  arcGeo(k: number): THREE.RingGeometry {
    const step = Math.max(1, Math.round(k * 36));
    return this.res(`arc-${step}`, () => new THREE.RingGeometry(0.8, 1, 48, 1, 0, (step / 36) * Math.PI * 2));
  }

  private canvasRes(key: string, w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
    return this.res(key, () => {
      const t = canvasTex(w, h, draw);
      t.colorSpace = THREE.NoColorSpace;
      return t;
    });
  }

  /** Soft rounded card silhouette (alpha) for landing shadows. */
  cardShadowTex(): THREE.CanvasTexture {
    return this.canvasRes('card-shadow', 64, 76, (c) => {
      c.filter = 'blur(4px)';
      c.fillStyle = '#fff';
      c.beginPath();
      c.roundRect(10, 10, 44, 56, 9);
      c.fill();
    });
  }

  scorchTex(): THREE.CanvasTexture {
    return this.canvasRes('scorch-tex', 128, 128, (c) => {
      const g = c.createRadialGradient(64, 64, 6, 64, 64, 62);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.55, 'rgba(255,255,255,0.75)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        c.beginPath();
        c.ellipse(64 + Math.cos(a) * 30, 64 + Math.sin(a) * 30, 34, 14, a, 0, Math.PI * 2);
        c.fill();
      }
    });
  }

  /** Red cross-hatch for spell reticles over targets the spell can't touch. */
  private hatchTex(): THREE.CanvasTexture {
    return this.res('hatch', () =>
      canvasTex(128, 128, (c) => {
        c.strokeStyle = '#ff3b4f';
        c.lineWidth = 6;
        for (let i = -128; i < 256; i += 22) {
          c.beginPath();
          c.moveTo(i, 0);
          c.lineTo(i + 128, 128);
          c.moveTo(i + 128, 0);
          c.lineTo(i, 128);
          c.stroke();
        }
      }),
    );
  }

  takeModel(card: CardDefinition, team: Team): BuiltModel | null {
    return this.pool.get(`${card.id}|${team}`)?.pop() ?? null;
  }

  /** Back to the pool, reset to its freshly-built state. */
  giveModel(card: CardDefinition, team: Team, m: BuiltModel): void {
    m.root.removeFromParent();
    m.root.position.set(0, 0, 0);
    m.root.rotation.set(0, 0, 0);
    m.root.scale.set(1, 1, 1);
    const main = m.riderMixer ? [m.mountMixer, m.riderMixer] : m.clips.length ? [m.mixers[0]] : [];
    for (const mx of main) mx?.stopAllAction();
    for (const mat of m.materials) {
      mat.transparent = false;
      mat.opacity = 1;
      mat.depthWrite = true;
      if (mat.emissive) {
        mat.emissive.copy(mat.userData.baseEmissive as THREE.Color);
        mat.emissiveIntensity = mat.userData.baseEmissiveIntensity as number;
      }
    }
    const key = `${card.id}|${team}`;
    const list = this.pool.get(key) ?? [];
    if (list.length < 16) list.push(m);
    this.pool.set(key, list);
  }

  /**
   * Hitch-free first spawns: during the loading screen, build the models every card
   * in both decks can put on the field (tokens and death spawns included), add them
   * with a sample of every projectile to the scene, compile all shaders, render once
   * so textures and buffers upload, then park the models in the pool.
   */
  async warmup(decks: Record<Team, string[]>, onProgress?: (k: number) => void): Promise<void> {
    this.syncViews(0, 0);
    const builds: Array<Promise<void>> = [];
    const holder = new THREE.Group();
    const parked: Array<{ card: CardDefinition; team: Team; m: BuiltModel }> = [];
    let done = 0;
    let total = 0;
    for (const team of ['blue', 'red'] as Team[]) {
      for (const id of cardsFor(decks[team])) {
        const card = getCard(id);
        if (card.type === 'spell') continue;
        // Enough copies for the whole squad to land at once (capped).
        const copies = Math.min(8, card.count + (decks[team].some((d) => getCard(d).squad?.some((s) => s.card === id)) ? 3 : 0) + (card.cost === 0 ? 1 : 0));
        for (let i = 0; i < copies; i++) {
          total++;
          builds.push(
            buildCardModel(card, team).then((m) => {
              m.root.position.set((parked.length % 9) - 4, card.flying ? FLY_HEIGHT : 0, Math.floor(parked.length / 9) - 4);
              holder.add(m.root);
              for (const mx of m.mixers) mx.update(0.01);
              parked.push({ card, team, m });
              onProgress?.(++done / total);
            }),
          );
        }
      }
    }
    for (const t of this.towers.values()) builds.push(t.built);
    builds.push(this.decorReady.then(() => undefined));
    await Promise.all(builds.map((b) => b.catch((e) => console.warn('[arena] warmup', e))));
    // One of every projectile look + the ghost of each card in our hand.
    const kinds: ProjectileKind[] = ['arrow', 'bolt', 'spear', 'dart', 'cannonball', 'bomb', 'boulder', 'fireball', 'iceball', 'magic', 'zap', 'axe', 'rocket', 'flame', 'shot', 'firework', 'hook', 'heal'];
    for (const kind of kinds) {
      const fake: Projectile = {
        id: -1, kind, team: 'blue', sourceId: -1, card: null, x: 9, y: 16, z: 1, fromX: 9, fromY: 16, tx: 9, ty: 16, targetId: -1, speed: 0, damage: 0, splash: 0,
        arc: 0, t: 0, dur: 1, homing: false, pierce: null, airOnly: false, groundOnly: false, spellCard: null, towerMul: 1, done: false,
      };
      holder.add(new ProjectileView(fake, this).obj);
    }
    for (const id of decks.blue) if (getCard(id).type !== 'spell') holder.add(await this.ghostModel(id));
    this.scene.add(holder);
    try {
      await this.renderer.compileAsync(this.scene, this.camera);
    } catch {
      /* not supported: the render below still compiles */
    }
    this.renderer.render(this.scene, this.camera);
    this.scene.remove(holder);
    for (const g of this.ghostModels.values()) g.removeFromParent();
    for (const p of parked) this.giveModel(p.card, p.team, p.m);
  }

  // ---------------------------------------------------------------- build


  private buildSky(): void {
    const sky = canvasTex(4, 256, (c) => {
      const g = c.createLinearGradient(0, 0, 0, 256);
      g.addColorStop(0, '#5ec8ff');
      g.addColorStop(0.55, '#a8e4ff');
      g.addColorStop(1, '#e8f8ff');
      c.fillStyle = g;
      c.fillRect(0, 0, 4, 256);
    });
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog('#bfeaff', 60, 140);
  }

  private buildLights(): void {
    this.scene.add(new THREE.HemisphereLight('#eef8ff', '#7aa85a', 2.2));
    const sun = new THREE.DirectionalLight('#fff4dc', 2.6);
    sun.position.set(-14, 30, 18);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const cam = sun.shadow.camera;
    cam.left = -16;
    cam.right = 16;
    cam.top = 22;
    cam.bottom = -22;
    cam.near = 1;
    cam.far = 80;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight('#c8e0ff', 0.9);
    fill.position.set(12, 10, -16);
    this.scene.add(fill);
  }

  private buildArena(): void {
    // Outer meadow.
    const meadow = new THREE.Mesh(new THREE.PlaneGeometry(220, 220), new THREE.MeshStandardMaterial({ color: '#5fae3a', roughness: 1 }));
    meadow.rotation.x = -Math.PI / 2;
    meadow.position.y = -0.62;
    meadow.receiveShadow = true;
    this.scene.add(meadow);
    // Raised field.
    const base = new THREE.Mesh(new THREE.BoxGeometry(ARENA_W + 1.4, 0.6, ARENA_H + 1.4), new THREE.MeshStandardMaterial({ map: stoneTex(), color: '#c8ccd8', roughness: 0.85 }));
    base.position.y = -0.31;
    base.receiveShadow = true;
    base.castShadow = true;
    this.scene.add(base);
    const field = new THREE.Mesh(new THREE.PlaneGeometry(ARENA_W, ARENA_H), new THREE.MeshStandardMaterial({ map: grassField(), roughness: 0.95 }));
    field.rotation.x = -Math.PI / 2;
    field.position.y = 0.001;
    field.receiveShadow = true;
    this.scene.add(field);
    // Stone border walls.
    const wallMat = new THREE.MeshStandardMaterial({ map: stoneTex(), color: '#e4e6ee', roughness: 0.8 });
    for (const sx of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.55, ARENA_H + 1.4), wallMat);
      wall.position.set(sx * (ARENA_W / 2 + 0.35), 0.27, 0);
      wall.castShadow = wall.receiveShadow = true;
      this.scene.add(wall);
    }
    for (const sz of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(ARENA_W + 1.4, 0.55, 0.7), wallMat);
      wall.position.set(0, 0.27, sz * (ARENA_H / 2 + 0.35));
      wall.castShadow = wall.receiveShadow = true;
      this.scene.add(wall);
    }
    // River.
    this.water = new THREE.ShaderMaterial({ uniforms: { time: { value: 0 } }, vertexShader: WATER_VERT, fragmentShader: WATER_FRAG });
    const river = new THREE.Mesh(new THREE.PlaneGeometry(ARENA_W + 1.4, 2.2), this.water);
    river.rotation.x = -Math.PI / 2;
    river.position.set(0, -0.12, 0);
    this.scene.add(river);
    const bankMat = new THREE.MeshStandardMaterial({ color: '#d8b878', roughness: 1 });
    for (const sz of [-1, 1]) {
      const bank = new THREE.Mesh(new THREE.BoxGeometry(ARENA_W, 0.25, 0.25), bankMat);
      bank.position.set(0, -0.06, sz * 1.12);
      bank.receiveShadow = true;
      this.scene.add(bank);
    }
    for (const bx of BRIDGES) this.buildBridge(bx - ARENA_W / 2);
    // Deploy-zone overlay (shown while dragging a card).
    this.zoneTex = canvasTex(ARENA_W * 8, ARENA_H * 8, () => undefined);
    this.zone = new THREE.Mesh(new THREE.PlaneGeometry(ARENA_W, ARENA_H), new THREE.MeshBasicMaterial({ map: this.zoneTex, transparent: true, depthWrite: false }));
    this.zone.rotation.x = -Math.PI / 2;
    this.zone.position.y = 0.03;
    this.zone.renderOrder = 4;
    this.zone.visible = false;
    this.scene.add(this.zone);
    // The river runs across the field.
    const riverMask = new THREE.Mesh(new THREE.PlaneGeometry(ARENA_W, 2), this.water);
    riverMask.rotation.x = -Math.PI / 2;
    riverMask.position.set(0, 0.004, 0);
    this.scene.add(riverMask);
  }

  private buildBridge(x: number): void {
    const plank = new THREE.MeshStandardMaterial({ color: '#b07a45', roughness: 0.85 });
    const plank2 = new THREE.MeshStandardMaterial({ color: '#9a6237', roughness: 0.85 });
    const rail = new THREE.MeshStandardMaterial({ color: '#7a4a25', roughness: 0.8 });
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.18, 0.36), i % 2 ? plank : plank2);
      m.position.set(x, 0.07, -1.25 + i * 0.36);
      m.rotation.y = (i % 3 - 1) * 0.02;
      m.castShadow = m.receiveShadow = true;
      this.scene.add(m);
    }
    for (const sx of [-1.18, 1.18]) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 2.9), rail);
      r.position.set(x + sx, 0.5, 0);
      r.castShadow = true;
      this.scene.add(r);
      for (const z of [-1.3, 0, 1.3]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.6, 6), rail);
        post.position.set(x + sx, 0.25, z);
        post.castShadow = true;
        this.scene.add(post);
      }
    }
  }

  private buildDecor(): void {
    const pending: Array<Promise<void>> = [];
    const place = (name: string, x: number, z: number, h: number, rot = Math.random() * Math.PI * 2) => void pending.push(placeOne(name, x, z, h, rot));
    const placeOne = async (name: string, x: number, z: number, h: number, rot: number) => {
      try {
        const leafy = /tree|bush|plant/.test(name);
        const inst = await instantiate(name, h, leafy ? { color: '#c4ff86', sat: 0.05 } : undefined);
        inst.root.position.set(x, x > -10.2 && x < 10.2 && Math.abs(z) < 17 ? 0 : -0.6, z);
        inst.root.rotation.y = rot;
        this.scene.add(inst.root);
      } catch {
        /* optional */
      }
    };
    const trees = ['nature:tree_oak', 'nature:tree_default', 'nature:tree_fat', 'nature:tree_detailed', 'nature:tree_pineRoundA', 'nature:tree_cone'];
    const bushes = ['nature:plant_bush', 'nature:plant_bushLarge', 'nature:plant_bushDetailed'];
    const flowers = ['nature:flower_redA', 'nature:flower_yellowA', 'nature:flower_purpleA', 'nature:flower_yellowB'];
    const rocks = ['nature:rock_largeA', 'nature:rock_largeC', 'nature:stone_largeA'];
    let seed = 7;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const sx of [-1, 1]) {
      for (let z = -18; z <= 18; z += 2.6) {
        place(trees[Math.floor(r() * trees.length)]!, sx * (12.5 + r() * 3), z + r(), 3 + r() * 2.2);
        if (r() < 0.6) place(bushes[Math.floor(r() * bushes.length)]!, sx * (10.6 + r() * 1.2), z + r() * 2, 0.8 + r() * 0.5);
        if (r() < 0.7) place(flowers[Math.floor(r() * flowers.length)]!, sx * (10.4 + r() * 1.6), z + r() * 2, 0.5);
        if (r() < 0.25) place(rocks[Math.floor(r() * rocks.length)]!, sx * (11 + r() * 2), z, 0.9 + r() * 0.6);
      }
    }
    for (const sz of [-1, 1]) {
      for (let x = -14; x <= 14; x += 3) {
        place(trees[Math.floor(r() * trees.length)]!, x + r() * 1.5, sz * (19 + r() * 3), 3.2 + r() * 2);
      }
    }
    // Team banners along the walls.
    for (const team of ['blue', 'red'] as Team[]) {
      const z = team === 'blue' ? 10 : -10;
      for (const sx of [-1, 1]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 3, 6), new THREE.MeshStandardMaterial({ color: '#ffcf3f', metalness: 0.5, roughness: 0.4 }));
        pole.position.set(sx * 10.1, 1.5, z);
        this.scene.add(pole);
        const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.6), new THREE.MeshStandardMaterial({ color: TEAM_COLORS[team].main, side: THREE.DoubleSide }));
        flag.position.set(sx * 10.1, 2.2, z + 0.58);
        flag.rotation.y = Math.PI / 2;
        flag.name = 'flag';
        this.scene.add(flag);
      }
    }
    this.decorReady = Promise.all(pending);
  }

  // ---------------------------------------------------------------- frame

  resize(): void {
    const w = this.canvas.parentElement?.clientWidth || innerWidth;
    const h = this.canvas.parentElement?.clientHeight || innerHeight;
    this.size = { w, h };
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);
    this.fitCamera();
    this.glow.setScale(h * 0.9);
    this.dust.setScale(h * 0.9);
  }

  /** Keep pixels free for the HUD (top), the card hand (bottom) and a docked hand (right). */
  setReserve(top: number, bottom: number, right = 0): void {
    const r = this.reserve;
    if (Math.abs(top - r.top) < 2 && Math.abs(bottom - r.bottom) < 2 && Math.abs(right - r.right) < 2) return;
    this.reserve = { top, bottom, right };
    this.fitCamera();
  }

  /**
   * Closest camera at which the whole arena fits the free screen area. Landscape uses a
   * lower pitch and widens the lens until the near edge spans ~85% of the free width.
   */
  private fitCamera(): void {
    const { w, h } = this.size;
    const cam = this.camera;
    const aspect = w / h;
    const portrait = aspect < 0.8;
    const landscape = aspect >= 1.2;
    const padY = this.reserve.bottom - this.reserve.top;
    const padX = Math.max(0, this.reserve.right);
    const fullW = w + padX;
    const fullH = h + Math.abs(padY);
    cam.aspect = fullW / fullH;
    cam.setViewOffset(fullW, fullH, padX, padY > 0 ? padY : 0, w, h);
    const pitch = THREE.MathUtils.degToRad(portrait ? 62 : landscape ? 50 : 56);
    this.camLook.set(0, 0, landscape ? 1.2 : 0.6);
    const free = { l: 6, r: w - padX - 6, t: this.reserve.top, b: h - Math.max(0, this.reserve.bottom) - 4 };
    const pts = [new THREE.Vector3(0, landscape ? 6.8 : 4.6, -ARENA_H / 2 - 0.5), new THREE.Vector3(0, 0, ARENA_H / 2 + 0.8), new THREE.Vector3(-ARENA_W / 2 - 0.7, 0, ARENA_H / 2), new THREE.Vector3(ARENA_W / 2 + 0.7, 0, -ARENA_H / 2)];
    const place = (d: number) => {
      cam.position.set(0, Math.sin(pitch) * d, this.camLook.z + Math.cos(pitch) * d);
      cam.lookAt(this.camLook);
      cam.updateMatrixWorld(true);
    };
    const fits = (d: number) => {
      place(d);
      return pts.every((p) => {
        const s = this.project(p);
        return s.y >= free.t && s.y <= free.b && s.x >= free.l && s.x <= free.r;
      });
    };
    const fitDist = () => {
      cam.updateProjectionMatrix();
      let lo = 5;
      let hi = 160;
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        if (fits(mid)) hi = mid;
        else lo = mid;
      }
      return hi;
    };
    /** Width of the arena at depth z on screen, as a fraction of the free width. */
    const span = (d: number, z: number) => {
      place(d);
      const a = this.project(new THREE.Vector3(-ARENA_W / 2 - 0.7, 0, z));
      const b = this.project(new THREE.Vector3(ARENA_W / 2 + 0.7, 0, z));
      return (b.x - a.x) / Math.max(1, free.r - free.l);
    };
    /** Fit with the bottom of the view at depth z (landscape may crop the strip behind our king). */
    const fitTo = (z: number) => {
      pts[1]!.z = z;
      pts[2]!.z = z;
      return fitDist();
    };
    cam.fov = portrait ? 44 : landscape ? 46 : 38;
    let dist = fitDist();
    if (landscape && span(dist, pts[1]!.z) < 0.85) {
      // Bring the camera in until the near edge spans ~85% of the free width.
      let lo = 13.2;
      let hi = pts[1]!.z;
      for (let i = 0; i < 14; i++) {
        const mid = (lo + hi) / 2;
        if (span(fitTo(mid), mid) >= 0.85) lo = mid;
        else hi = mid;
      }
      dist = fitTo(lo);
    }
    this.camBase.set(0, Math.sin(pitch) * dist, this.camLook.z + Math.cos(pitch) * dist);
    place(dist);
    const fog = this.scene.fog as THREE.Fog;
    fog.near = dist * 1.3;
    fog.far = dist * 3.2;
  }

  project(p: THREE.Vector3): { x: number; y: number } {
    this.v.copy(p).project(this.camera);
    return { x: (this.v.x * 0.5 + 0.5) * this.size.w, y: (-this.v.y * 0.5 + 0.5) * this.size.h };
  }

  /** Screen point → arena tile (on the ground plane). */
  screenToTile(cx: number, cy: number): Vec2 | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit)) return null;
    return { x: hit.x + ARENA_W / 2, y: hit.z + ARENA_H / 2 };
  }

  /** Camera shake of `s` (world units) lasting `dur` seconds. */
  addShake(s: number, dur = 0.3): void {
    if (s >= this.shake * (this.shakeT / this.shakeDur)) {
      this.shake = s;
      this.shakeDur = dur;
      this.shakeT = dur;
    }
  }

  /** Brief dolly towards the arena centre (crowns). */
  punch(amount = 0.08, dur = 0.5): void {
    this.punchAmt = amount;
    this.punchDur = dur;
    this.punchT = dur;
  }

  render(): void {
    this.timer.update();
    const dt = Math.min(0.05, this.timer.getDelta());
    const t = this.timer.getElapsed();
    this.water.uniforms.time!.value = t;
    this.status.begin();
    this.syncViews(dt, t);
    this.status.end();
    this.consumeEvents();
    this.glow.update(dt);
    this.dust.update(dt);
    this.bolts.update(dt);
    this.rings.update(dt);
    for (const o of this.scene.children) if (o.name === 'flag') o.rotation.z = Math.sin(t * 2.5 + o.position.z) * 0.08;
    const cam = this.camera;
    // Subtle 2° yaw sway around the arena, plus the crown punch-in.
    const yaw = THREE.MathUtils.degToRad(2) * Math.sin(t * 0.21);
    const rel = this.v.copy(this.camBase).sub(this.camLook);
    rel.applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
    if (this.punchT > 0) {
      this.punchT = Math.max(0, this.punchT - dt);
      const k = 1 - this.punchT / this.punchDur;
      rel.multiplyScalar(1 - this.punchAmt * Math.sin(k * Math.PI));
    }
    cam.position.copy(this.camLook).add(rel);
    if (this.shakeT > 0) {
      this.shakeT = Math.max(0, this.shakeT - dt);
      const a = this.shake * (this.shakeT / this.shakeDur);
      cam.position.x += (Math.random() - 0.5) * a;
      cam.position.y += (Math.random() - 0.5) * a * 0.6;
    }
    cam.lookAt(this.camLook);
    this.renderer.render(this.scene, cam);
    this.numbers.update(dt);
  }

  private syncViews(dt: number, t: number): void {
    const e = this.engine;
    const live = new Set<number>();
    for (const u of e.units) {
      live.add(u.id);
      if (u.kind === 'tower') {
        let tv = this.towers.get(u.id);
        if (!tv) {
          tv = new TowerView(u, this);
          this.towers.set(u.id, tv);
          this.scene.add(tv.group);
        }
        tv.update(dt, t);
        continue;
      }
      let v = this.units.get(u.id);
      if (!v) {
        v = new UnitView(u, this);
        v.group.position.copy(toWorld(u.x, u.y));
        this.units.set(u.id, v);
        this.scene.add(v.group);
      }
      v.update(dt, t);
    }
    for (const [id, v] of this.units) {
      if (live.has(id)) continue;
      v.dispose();
      this.units.delete(id);
    }
    const liveP = new Set<number>();
    for (const p of e.projectiles) {
      liveP.add(p.id);
      let v = this.projectiles.get(p.id);
      if (!v) {
        v = new ProjectileView(p, this);
        this.projectiles.set(p.id, v);
        this.scene.add(v.obj);
      }
      v.update(dt);
    }
    for (const [id, v] of this.projectiles) {
      if (liveP.has(id)) continue;
      this.scene.remove(v.obj);
      this.projectiles.delete(id);
    }
    const liveA = new Set<number>();
    for (const a of e.areas) {
      liveA.add(a.id);
      let v = this.areaViews.get(a.id);
      if (!v) {
        v = new AreaView(a, this);
        this.areaViews.set(a.id, v);
        this.scene.add(v.obj);
      }
      v.update(dt, t);
    }
    for (const [id, v] of this.areaViews) {
      if (liveA.has(id)) continue;
      v.dispose();
      this.areaViews.delete(id);
    }
  }

  private consumeEvents(): void {
    const e = this.engine;
    for (const ev of e.events) {
      this.onEvent?.(ev);
      switch (ev.type) {
        case 'deploy': {
          const w = toWorld(ev.x, ev.y);
          const card = getCard(ev.card);
          const tc = TEAM_COLORS[ev.team];
          this.rings.add(w.x, w.z, 0.2, card.radius * 2.6 + 0.6, tc.light, 0.5);
          this.dust.burst(w.x, 0.15, w.z, 8, '#e8dcc0', 2.2, { life: 0.6, size: 0.55, up: 0.6, gravity: 0, grow: 0.6 });
          if (card.cost >= 6) this.addShake(0.15);
          break;
        }
        case 'emerge': {
          const w = toWorld(ev.x, ev.y);
          this.dust.burst(w.x, 0.1, w.z, 16, '#9a6237', 3, { size: 0.4, up: 3 });
          break;
        }
        case 'hit': {
          const w = toWorld(ev.x, ev.y, 0.9);
          const color = ev.kind === 'zap' ? '#bff2ff' : ev.kind === 'fireball' || ev.kind === 'flame' ? '#ffb347' : '#fff3b0';
          this.glow.burst(w.x, w.y, w.z, ev.kind === 'melee' ? 5 : 4, color, 2.5, { life: 0.25, size: 0.3, up: 1.2, gravity: 3 });
          break;
        }
        case 'dmg': {
          const u = e.units.find((x) => x.id === ev.unitId);
          const head = u ? (u.kind === 'tower' ? (u.role === 'king' ? 4.4 : 3.6) : (u.flying ? FLY_HEIGHT : 0) + u.card.visual.height * UNIT_SCALE * 0.8) : 1.5;
          const style = ev.crit ? 'crit' : ev.tower && ev.amount >= 300 ? 'tower' : 'normal';
          if (ev.amount >= 20 || style !== 'normal') this.numbers.add(String(ev.amount), toWorld(ev.x, ev.y, head), style);
          break;
        }
        case 'splash': {
          const w = toWorld(ev.x, ev.y);
          const kind = ev.kind;
          if (kind === 'fireball' || kind === 'bomb' || kind === 'rocket' || kind === 'firework') {
            this.glow.burst(w.x, 0.6, w.z, Math.round(12 + ev.radius * 10), kind === 'firework' ? '#ff4fd8' : '#ff9a2a', 3 + ev.radius * 1.4, { life: 0.5, size: 0.7, up: 3 });
            this.dust.burst(w.x, 0.4, w.z, Math.round(6 + ev.radius * 6), '#5a5560', 1.5 + ev.radius, { life: 1, size: 1, up: 1.6, gravity: -0.5, grow: 1.2 });
            this.rings.add(w.x, w.z, 0.2, ev.radius, '#ffcf3f', 0.4);
            this.addShake(kind === 'rocket' && ev.radius >= 1.5 ? 0.5 : ev.radius >= 1.5 ? 0.18 : 0.08);
          } else if (kind === 'zap' || kind === 'lightning') {
            this.glow.burst(w.x, 0.6, w.z, 14, '#bff2ff', 3.5, { life: 0.3, size: 0.4 });
            this.rings.add(w.x, w.z, 0.2, ev.radius, '#7fe3ff', 0.3);
            if (kind === 'lightning') {
              this.bolts.add(toWorld(ev.x, ev.y, 16), toWorld(ev.x, ev.y, 0.2), '#ffffff', 0.3, 1.2);
              this.addShake(0.25);
            }
          } else if (kind === 'iceball' || kind === 'freeze' || kind === 'snowball') {
            this.glow.burst(w.x, 0.5, w.z, 16, '#e8fbff', 2.6, { life: 0.5, size: 0.45 });
            this.rings.add(w.x, w.z, 0.2, ev.radius, '#bff2ff', 0.5);
          } else if (kind === 'land') {
            this.dust.burst(w.x, 0.2, w.z, 22, '#c9a070', 4, { life: 0.7, size: 0.8, up: 1.5, gravity: 1, grow: 0.8 });
            this.rings.add(w.x, w.z, 0.3, ev.radius + 0.5, '#ffffff', 0.45);
            this.addShake(0.3);
          } else if (kind === 'heal') {
            this.glow.burst(w.x, 0.5, w.z, 18, '#ffe48a', 2, { life: 0.8, size: 0.4, up: 2, gravity: -1 });
          } else if (kind === 'arrows') {
            this.dust.burst(w.x, 0.2, w.z, 10, '#c9a070', 2.4, { life: 0.4, size: 0.4 });
          } else {
            this.glow.burst(w.x, 0.5, w.z, 8, '#ffffff', 2.2, { life: 0.3, size: 0.35 });
            this.rings.add(w.x, w.z, 0.2, ev.radius, '#ffffff', 0.3);
          }
          break;
        }
        case 'zap': {
          this.bolts.add(toWorld(ev.fromX, ev.fromY, 1), toWorld(ev.toX, ev.toY, 0.9), ev.team === 'blue' ? '#bff2ff' : '#ffd0ff');
          break;
        }
        case 'death': {
          const w = toWorld(ev.x, ev.y, 0.6);
          if (ev.kind === 'tower') {
            // Fireball, a huge dust wall rolling out, gold shockwave, long shake.
            this.glow.burst(w.x, 2, w.z, 60, '#ffb347', 6, { life: 0.9, size: 1, up: 5 });
            this.dust.burst(w.x, 1, w.z, 30, '#8f97a8', 4, { life: 1.6, size: 1.6, up: 3, gravity: -0.3, grow: 1.5 });
            this.dust.ring(w.x, w.z, 1.6, 40, '#b9b2a6', 0.4, { life: 1.4, size: 1.4, out: 5.5 });
            this.rings.add(w.x, w.z, 0.5, 6, '#ffcf3f', 0.8);
            this.rings.add(w.x, w.z, 0.3, 4, '#ffffff', 0.5, 0.12);
            this.addShake(0.9, 0.9);
          } else {
            // A team-coloured soul drifting up.
            const tc = TEAM_COLORS[ev.team];
            this.dust.burst(w.x, w.y, w.z, 6, '#ffffff', 1.4, { life: 0.5, size: 0.5, up: 1, gravity: -0.5, grow: 0.7 });
            for (let i = 0; i < 7; i++) this.glow.emit({ x: w.x + (Math.random() - 0.5) * 0.5, y: w.y + Math.random() * 0.4, z: w.z + (Math.random() - 0.5) * 0.5, vx: (Math.random() - 0.5) * 0.6, vy: 1.4 + Math.random() * 1.2, vz: (Math.random() - 0.5) * 0.6, life: 0.9 + Math.random() * 0.4, size: 0.35 + Math.random() * 0.25, color: i % 3 ? tc.light : tc.main, drag: 1, grow: -0.2 });
          }
          break;
        }
        case 'tower':
          this.punch(0.08, 0.5);
          break;
        case 'heal': {
          const w = toWorld(ev.x, ev.y, 1);
          this.glow.burst(w.x, w.y, w.z, 4, '#9ff5a0', 0.8, { life: 0.7, size: 0.3, up: 1.6, gravity: -1 });
          break;
        }
        case 'elixir': {
          const w = toWorld(ev.x, ev.y, 1.5);
          this.glow.burst(w.x, w.y, w.z, 12, '#ff6ad5', 1.5, { life: 0.9, size: 0.45, up: 2.5, gravity: 1 });
          break;
        }
        case 'charge': {
          const u = e.unit(ev.unitId);
          if (u) {
            const w = toWorld(u.x, u.y);
            this.dust.burst(w.x, 0.2, w.z, 10, '#e8dcc0', 2, { life: 0.5, size: 0.5 });
          }
          break;
        }
        case 'ability': {
          const u = e.unit(ev.unitId);
          if (u) {
            const w = toWorld(u.x, u.y, 1);
            this.glow.burst(w.x, w.y, w.z, 26, '#ffe066', 3, { life: 0.7, size: 0.5, up: 2.5, gravity: 0 });
            this.rings.add(w.x, w.z, 0.3, 2.5, '#ffe066', 0.5);
          }
          break;
        }
        case 'emote':
          this.showEmote(ev.team, ev.emote);
          break;
        case 'spell': {
          const w = toWorld(ev.x, ev.y);
          if (ev.card === 'zap') {
            for (let i = 0; i < 4; i++) {
              const a = Math.random() * Math.PI * 2;
              this.bolts.add(toWorld(ev.x, ev.y, 7), new THREE.Vector3(w.x + Math.cos(a) * ev.radius * 0.6, 0.2, w.z + Math.sin(a) * ev.radius * 0.6), '#dff9ff', 0.25, 0.9);
            }
            this.addShake(0.12);
          }
          if (ev.card === 'freeze') this.glow.burst(w.x, 0.4, w.z, 40, '#e8fbff', ev.radius * 1.4, { life: 0.8, size: 0.5, up: 2 });
          if (ev.card === 'clone') this.glow.burst(w.x, 0.5, w.z, 30, '#7fe3ff', ev.radius, { life: 0.8, size: 0.5, up: 2 });
          break;
        }
        default:
          break;
      }
    }
    e.events.length = 0;
  }

  // ---------------------------------------------------------------- emotes

  private emotes: Array<{ sprite: THREE.Sprite; t: number; base: number }> = [];

  /** A taunt bubble above that side's king for 2.5 s. */
  showEmote(team: Team, n: number): void {
    const king = this.engine.units.find((u) => u.kind === 'tower' && u.role === 'king' && u.team === team);
    if (!king) return;
    for (const old of this.emotes.filter((x) => x.sprite.userData.team === team)) old.t = 2.5;
    const mat = new THREE.SpriteMaterial({ map: this.emoteTex(n), depthTest: false, transparent: true });
    const sprite = new THREE.Sprite(mat);
    sprite.userData.team = team;
    sprite.renderOrder = 40;
    const p = toWorld(king.x, king.y, 6.6);
    sprite.position.copy(p);
    this.scene.add(sprite);
    this.emotes.push({ sprite, t: 0, base: 3.2 });
    if (this.emotes.length === 1) this.tickEmotes();
  }

  private tickEmotes(): void {
    let last = performance.now();
    const step = () => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      for (const e of this.emotes) {
        e.t += dt;
        const pop = e.t < 0.25 ? Math.sin((e.t / 0.25) * Math.PI * 0.75) / Math.sin(Math.PI * 0.75) : 1;
        const fade = e.t > 2.2 ? Math.max(0, 1 - (e.t - 2.2) / 0.3) : 1;
        e.sprite.scale.set(e.base * pop, e.base * 0.75 * pop, 1);
        e.sprite.material.opacity = fade;
        e.sprite.position.y = 6.6 + Math.sin(e.t * 3) * 0.08;
      }
      for (const e of this.emotes.filter((x) => x.t >= 2.5)) {
        e.sprite.removeFromParent();
        e.sprite.material.dispose();
      }
      this.emotes = this.emotes.filter((x) => x.t < 2.5);
      if (this.emotes.length && !this.disposed) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  private emoteTex(n: number): THREE.CanvasTexture {
    const EMOTES = [
      { text: 'GG!', face: '#ffd23f' },
      { text: 'HA HA!', face: '#ffd23f' },
      { text: 'GRR!', face: '#ff6a5c' },
      { text: 'WOW!', face: '#8fd0ff' },
    ];
    const em = EMOTES[n % EMOTES.length]!;
    return this.res(`emote-${n}`, () =>
      canvasTex(256, 192, (c) => {
        // Speech bubble with a little face and the taunt.
        c.fillStyle = '#fffaf0';
        c.strokeStyle = '#1b1446';
        c.lineWidth = 10;
        c.beginPath();
        c.roundRect(10, 10, 236, 140, 36);
        c.moveTo(110, 148);
        c.lineTo(128, 182);
        c.lineTo(150, 148);
        c.fill();
        c.stroke();
        c.fillStyle = '#fffaf0';
        c.fillRect(112, 140, 36, 12);
        c.fillStyle = em.face;
        c.beginPath();
        c.arc(62, 80, 38, 0, Math.PI * 2);
        c.fill();
        c.lineWidth = 6;
        c.stroke();
        c.fillStyle = '#1b1446';
        const eyes = n === 2 ? [[48, 72], [76, 72]] : [[50, 70], [74, 70]];
        for (const [x, y] of eyes) {
          c.beginPath();
          c.arc(x!, y!, 5, 0, Math.PI * 2);
          c.fill();
        }
        c.beginPath();
        if (n === 2) {
          c.moveTo(46, 100);
          c.lineTo(78, 100);
          c.moveTo(42, 60);
          c.lineTo(56, 66);
          c.moveTo(82, 60);
          c.lineTo(68, 66);
        } else if (n === 3) c.ellipse(62, 96, 8, 12, 0, 0, Math.PI * 2);
        else c.arc(62, 86, 18, 0.15 * Math.PI, 0.85 * Math.PI);
        c.lineWidth = 5;
        c.stroke();
        c.font = '900 46px "Lilita One", "Arial Black", sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillStyle = '#1b1446';
        c.fillText(em.text, 170, 82, 150);
      }),
    );
  }

  // ---------------------------------------------------------------- placement

  /** A ghost copy of a card's model (built once per card). */
  private async ghostModel(cardId: string): Promise<THREE.Object3D> {
    let g = this.ghostModels.get(cardId);
    if (g) return g;
    const card = getCard(cardId);
    const m = await buildCardModel(card, 'blue');
    for (const mat of m.materials) {
      mat.transparent = true;
      mat.opacity = 0.55;
      mat.depthWrite = false;
    }
    for (const mx of m.mixers) mx.update(0.01);
    m.root.position.y = card.flying ? FLY_HEIGHT : 0;
    m.root.rotation.y = Math.PI;
    m.root.scale.setScalar(card.type === 'building' ? 1.2 : UNIT_SCALE);
    g = this.ghostModels.get(cardId) ?? m.root;
    this.ghostModels.set(cardId, g);
    return g;
  }

  /** Can this spell do anything to what's under the reticle? (null: nothing there) */
  private spellUseful(card: CardDefinition, tile: Vec2): boolean | null {
    const s = card.spell!;
    if (s.spawn || s.mirror || card.id === 'sky-drop') return null;
    const inside = this.engine.units.filter((u) => !u.dead && !u.burrow && Math.hypot(u.x - tile.x, u.y - tile.y) <= s.radius + u.radius * 0.5);
    if (!inside.length) return null;
    const own = Boolean(s.rage || s.clone);
    const groundOnly = s.travel === 'roll' || card.id === 'earthquake';
    return inside.some((u) => {
      if (own) return u.team === 'blue' && (s.clone ? u.kind === 'troop' : true);
      if (u.team === 'blue' || u.hidden) return false;
      if (groundOnly && u.flying) return false;
      if ((s.pull || card.id === 'vines') && u.kind !== 'troop') return false;
      return true;
    });
  }

  /** Ghost of the dragged card + the allowed deploy area. */
  setPlacement(cardId: string | null, tile: Vec2 | null, valid: boolean): void {
    this.zone.visible = Boolean(cardId);
    if (cardId) this.refreshZone(getCard(cardId));
    if (!cardId || !tile) {
      if (this.ghost) this.ghost.obj.visible = false;
      return;
    }
    const card = getCard(cardId);
    if (!this.ghost || this.ghost.id !== cardId) {
      if (this.ghost) this.scene.remove(this.ghost.obj);
      const obj = new THREE.Group();
      const r = card.type === 'spell' ? card.spell!.radius : Math.max(0.6, card.radius * (card.count > 1 ? 2.2 : 1.4));
      const ring = new THREE.Mesh(new THREE.RingGeometry(r * 0.94, r, 48), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.08;
      obj.add(ring);
      const fill = new THREE.Mesh(new THREE.CircleGeometry(r, 48), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.15, depthWrite: false }));
      fill.rotation.x = -Math.PI / 2;
      fill.position.y = 0.07;
      obj.add(fill);
      const hatch = new THREE.Mesh(new THREE.CircleGeometry(r * 0.94, 48), new THREE.MeshBasicMaterial({ map: this.hatchTex(), transparent: true, opacity: 0.6, depthWrite: false }));
      hatch.rotation.x = -Math.PI / 2;
      hatch.position.y = 0.075;
      hatch.visible = false;
      obj.add(hatch);
      if (card.type !== 'spell') {
        void this.ghostModel(cardId).then((g) => {
          if (this.ghost?.id === cardId) obj.add(g);
        });
      }
      this.scene.add(obj);
      this.ghost = { id: cardId, obj, ring, hatch };
    }
    this.ghost.obj.visible = true;
    this.ghost.obj.position.copy(toWorld(tile.x, tile.y));
    const useless = card.type === 'spell' && this.spellUseful(card, tile) === false;
    this.ghost.hatch.visible = useless;
    (this.ghost.ring.material as THREE.MeshBasicMaterial).color.set(valid && !useless ? '#ffffff' : '#ff4b5c');
  }

  private refreshZone(card: CardDefinition): void {
    const anywhere = card.type === 'spell' ? card.id !== 'sky-drop' : Boolean(card.abilities.burrow);
    const key = `${anywhere}-${this.engine.towers('red').map((t) => t.role).join()}`;
    if (key === this.zoneKey) return;
    this.zoneKey = key;
    const cv = this.zoneTex.image as HTMLCanvasElement;
    const c = cv.getContext('2d')!;
    const px = 8;
    c.clearRect(0, 0, cv.width, cv.height);
    if (anywhere) {
      this.zoneTex.needsUpdate = true;
      return;
    }
    for (let y = 0; y < ARENA_H; y++) {
      for (let x = 0; x < ARENA_W; x++) {
        const ok = this.engine.inDeployZone('blue', x + 0.5, y + 0.5);
        if (ok) continue;
        c.fillStyle = (x + y) % 2 ? 'rgba(255,60,80,0.28)' : 'rgba(255,60,80,0.2)';
        c.fillRect(x * px, y * px, px, px);
      }
    }
    this.zoneTex.needsUpdate = true;
  }

  private disposed = false;

  /** Tear down: views, listeners, every GPU resource and the WebGL context itself. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    removeEventListener('resize', this.onResize);
    for (const v of this.units.values()) v.dispose();
    for (const v of this.towers.values()) v.bar.dispose();
    for (const v of this.areaViews.values()) v.dispose();
    this.units.clear();
    this.numbers.dispose();
    this.status.dispose();
    this.rings.dispose();
    this.bolts.dispose();
    const seen = new Set<object>();
    const free = (o: { dispose(): void } | null | undefined) => {
      if (!o || seen.has(o)) return;
      seen.add(o);
      o.dispose();
    };
    const freeMat = (m: THREE.Material) => {
      for (const v of Object.values(m)) if (v instanceof THREE.Texture) free(v);
      free(m);
    };
    const freeTree = (root: THREE.Object3D) =>
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) free(m.geometry);
        if (m.material) for (const mat of Array.isArray(m.material) ? m.material : [m.material]) freeMat(mat);
      });
    freeTree(this.scene);
    for (const list of this.pool.values()) for (const m of list) freeTree(m.root);
    for (const g of this.ghostModels.values()) freeTree(g);
    for (const r of this.shared.values()) free(r);
    if (this.scene.background instanceof THREE.Texture) free(this.scene.background);
    this.pool.clear();
    this.shared.clear();
    this.scene.clear();
    this.hud.remove();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}
