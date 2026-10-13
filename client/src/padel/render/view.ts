import * as THREE from 'three';
import { BALL_R } from '../sim/ball';
import { COURT } from '../sim/court';
import type { Frame } from '../sim/snapshot';
import type { Racket } from '../sim/rackets';
import { CourtView, type CourtTheme } from './court';
import { PlayerView, type Look } from './players';

/**
 * The match view: court, players, ball (a touch bigger than life so it reads on screen, with its shadow
 * and a trail on fast shots), bounce marks, and the camera — the classic padel broadcast angle from
 * behind your team, high enough to see over the glass, easing along with the play.
 */
const BALL_SCALE = 1.7;

export interface ViewPlayer {
  look: Look;
  racket: Racket;
  human: boolean;
  team: 0 | 1;
}

export class MatchView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(52, 16 / 9, 0.3, 120);
  readonly court: CourtView;
  readonly players: PlayerView[] = [];
  private readonly ball: THREE.Mesh;
  private readonly shadow: THREE.Mesh;
  private readonly trail: THREE.Mesh;
  private readonly trailPts: THREE.Vector3[] = [];
  private readonly marks: Array<{ m: THREE.Mesh; t: number }> = [];
  /** The team the camera sits behind. */
  side: 0 | 1 = 0;
  private readonly camPos = new THREE.Vector3(0, 5.5, -15);
  private readonly camLook = new THREE.Vector3(0, 0.8, 2);
  private shake = 0;
  /** Over-the-shoulder camera (motion play: you need to see your racket). */
  close = false;
  /** Live racket trails (motion play), per player. */
  private readonly trails = new Map<number, { pts: Array<[THREE.Vector3, THREE.Vector3]>; mesh: THREE.Mesh }>();

  constructor(theme: CourtTheme, players: ViewPlayer[]) {
    this.court = new CourtView(theme);
    this.scene.add(this.court.group);
    const sky = new THREE.Color(theme.sky[0]);
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(sky, 40, 90);
    if (!theme.indoor) this.scene.background = this.skyTexture(theme.sky);
    for (const p of players) {
      const v = new PlayerView(p.look, p.racket, p.human, p.team === 0 ? '#3d8bff' : '#ff6a3d');
      this.players.push(v);
      this.scene.add(v.root, v.racket);
    }
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R * BALL_SCALE, 20, 14), new THREE.MeshStandardMaterial({ color: '#e7f53a', emissive: '#4a5200', roughness: 0.55 }));
    this.ball.castShadow = true;
    this.scene.add(this.ball);
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(BALL_R * BALL_SCALE * 1.1, 16), new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.35, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.scene.add(this.shadow);
    this.trail = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: '#f3ff8a', transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }));
    this.scene.add(this.trail);
  }

  private skyTexture([top, bottom]: [string, string]): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 256;
    const g = c.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, bottom);
    grad.addColorStop(1, top);
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 256);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    // Narrow screens (phones held upright) need a wider view to fit the court.
    this.camera.fov = aspect < 1 ? 70 : 52;
    this.camera.updateProjectionMatrix();
  }

  /** A bounce / wall hit: a fading ring where it happened. */
  mark(x: number, y: number, z: number, wall: 'x' | 'z' | null): void {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.11, 24), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
    m.position.set(x, wall ? y : 0.012, z);
    if (!wall) m.rotation.x = -Math.PI / 2;
    else if (wall === 'x') m.rotation.y = Math.PI / 2;
    this.scene.add(m);
    this.marks.push({ m, t: 0 });
  }

  shakeCamera(amount: number): void {
    this.shake = Math.max(this.shake, amount);
  }

  update(f: Frame, dt: number, focusX: number, focusZ = 0): void {
    const b = new THREE.Vector3(f.ball[0], f.ball[1], f.ball[2]);
    f.players.forEach((p, i) => this.players[i]?.update(p, dt, b));
    f.players.forEach((p, i) => this.trail1(i, !!p.arm));
    // Ball, its shadow, the trail.
    this.ball.visible = !f.ballOut || f.phase === 'dead';
    this.ball.position.copy(b);
    this.shadow.position.set(b.x, 0.006, b.z);
    const sh = Math.max(0.25, 1 - b.y / 6);
    this.shadow.scale.setScalar(sh);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.35 * sh;
    const speed = Math.hypot(...f.ballVel);
    this.trailPts.push(b.clone());
    if (this.trailPts.length > 9) this.trailPts.shift();
    if (speed > 14 && this.trailPts.length > 2) {
      const pts: number[] = [];
      const n = this.trailPts.length;
      for (let i = 0; i < n; i++) {
        const w = BALL_R * BALL_SCALE * (i / n) * 0.9;
        const p = this.trailPts[i]!;
        pts.push(p.x, p.y + w, p.z, p.x, p.y - w, p.z);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const idx: number[] = [];
      for (let i = 0; i < n - 1; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
      geo.setIndex(idx);
      this.trail.geometry.dispose();
      this.trail.geometry = geo;
      this.trail.visible = true;
    } else this.trail.visible = false;
    for (let i = this.marks.length - 1; i >= 0; i--) {
      const mk = this.marks[i]!;
      mk.t += dt;
      (mk.m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.8 * (1 - mk.t / 1.2));
      mk.m.scale.setScalar(1 + mk.t * 1.5);
      if (mk.t > 1.2) {
        this.scene.remove(mk.m);
        mk.m.geometry.dispose();
        this.marks.splice(i, 1);
      }
    }
    this.court.update(dt);
    // Camera: behind our end, raised, shading towards the action across and down the court — or, in
    // motion play, low over your shoulder so you can see your racket move.
    const s = this.side === 0 ? -1 : 1;
    const wantPos = this.close ? new THREE.Vector3(focusX * 0.85, 2.6, focusZ + s * 4.4) : new THREE.Vector3(focusX * 0.35 + b.x * 0.1, 5.4, s * (COURT.halfL + 5.2));
    const wantLook = this.close ? new THREE.Vector3(focusX * 0.55 + b.x * 0.15, 1.05, focusZ - s * 5) : new THREE.Vector3(focusX * 0.2 + b.x * 0.25, 0.6, -s * 1.5 + b.z * 0.15);
    const k = Math.min(1, dt * (this.close ? 5 : 3));
    this.camPos.lerp(wantPos, k);
    this.camLook.lerp(wantLook, k);
    this.camera.position.copy(this.camPos);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.5);
      this.camera.position.x += (Math.random() - 0.5) * this.shake * 0.12;
      this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.12;
    }
    this.camera.lookAt(this.camLook);
  }

  snapCamera(): void {
    this.court.setCameraEnd(this.side);
    const s = this.side === 0 ? -1 : 1;
    if (this.close) {
      this.camPos.set(0, 2.6, s * (COURT.halfL - 2 + 4.4));
      this.camLook.set(0, 1.05, s * 3);
      return;
    }
    this.camPos.set(0, 5.4, s * (COURT.halfL + 5.2));
    this.camLook.set(0, 0.6, -s * 1.5);
  }

  /** A live racket leaves a fading ribbon (head → tip) so you can see exactly how you moved it. */
  private trail1(i: number, live: boolean): void {
    let t = this.trails.get(i);
    if (!live) {
      if (t) t.mesh.visible = false;
      if (t) t.pts.length = 0;
      return;
    }
    if (!t) {
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.trails.set(i, (t = { pts: [], mesh }));
    }
    const pv = this.players[i]!;
    t.pts.push([pv.racketHead(new THREE.Vector3()), pv.racketTip(new THREE.Vector3())]);
    if (t.pts.length > 22) t.pts.shift();
    const n = t.pts.length;
    if (n < 2) return;
    const pos: number[] = [];
    const col: number[] = [];
    const c = new THREE.Color(this.players[i]!.trailColor);
    for (let k = 0; k < n; k++) {
      const [h, tip] = t.pts[k]!;
      const a = (k / (n - 1)) ** 1.6 * 0.85;
      pos.push(h.x, h.y, h.z, tip.x, tip.y, tip.z);
      col.push(c.r * a, c.g * a, c.b * a, c.r * a, c.g * a, c.b * a);
    }
    const idx: number[] = [];
    for (let k = 0; k < n - 1; k++) idx.push(k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 1, k * 2 + 3, k * 2 + 2);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    t.mesh.geometry.dispose();
    t.mesh.geometry = geo;
    t.mesh.visible = true;
  }

  dispose(): void {
    this.scene.traverse((n) => {
      const m = n as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    for (const p of this.players) p.dispose();
  }
}
