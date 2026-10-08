import * as THREE from 'three';
import { BALL_R, PITCH, loftTime } from '../sim/match';
import type { Club, Kit } from '../sim/data';
import type { Frame } from '../sim/snapshot';
import { Stadium } from './stadium';
import { PlayerView } from './players';

/**
 * The 3D match: stadium, 22 footballers, the ball and the broadcast camera.
 * Draws Frames only (see sim/snapshot.ts).
 */

export const HUMAN_COLORS = ['#2f8bff', '#ff3b4a', '#2fd36b', '#ffc21a', '#c45bff', '#21d4d4', '#ff8a1f', '#f4f4f4'];
export type CameraMode = 'broadcast' | 'tele' | 'end';

/** Classic black-and-white ball: pentagons on the 12 icosahedron vertices, seams between panels. */
function ballTexture(): THREE.CanvasTexture {
  const W = 512;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const img = g.createImageData(W, H);
  const t = (1 + Math.sqrt(5)) / 2;
  const ico: number[][] = [];
  for (const a of [-1, 1]) for (const b of [-t, t]) ico.push([0, a, b], [a, b, 0], [b, 0, a]);
  const pent = ico.map((v) => {
    const l = Math.hypot(v[0]!, v[1]!, v[2]!);
    return v.map((x) => x / l);
  });
  // Hexagon centres: the 20 icosahedron face centres (dodecahedron vertices).
  const hex: number[][] = [];
  for (let i = 0; i < 12; i++)
    for (let j = i + 1; j < 12; j++)
      for (let k = j + 1; k < 12; k++) {
        const [a, b, d] = [pent[i]!, pent[j]!, pent[k]!];
        const dot = (u: number[], v: number[]) => u[0]! * v[0]! + u[1]! * v[1]! + u[2]! * v[2]!;
        if (dot(a, b) > 0.4 && dot(a, d) > 0.4 && dot(b, d) > 0.4) {
          const v = [a[0]! + b[0]! + d[0]!, a[1]! + b[1]! + d[1]!, a[2]! + b[2]! + d[2]!];
          const l = Math.hypot(v[0]!, v[1]!, v[2]!);
          hex.push(v.map((x) => x / l));
        }
      }
  const centres = [...pent.map((v) => ({ v, p: true })), ...hex.map((v) => ({ v, p: false }))];
  for (let y = 0; y < H; y++) {
    const lat = (0.5 - (y + 0.5) / H) * Math.PI;
    for (let x = 0; x < W; x++) {
      const lon = ((x + 0.5) / W) * Math.PI * 2;
      const d = [Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)];
      let b1 = -2;
      let b2 = -2;
      let isP = false;
      for (const c0 of centres) {
        // Pentagons are a touch smaller than hexagons on a real ball: weight them.
        const s = d[0]! * c0.v[0]! + d[1]! * c0.v[1]! + d[2]! * c0.v[2]! - (c0.p ? 0.012 : 0);
        if (s > b1) {
          b2 = b1;
          b1 = s;
          isP = c0.p;
        } else if (s > b2) b2 = s;
      }
      const seam = b1 - b2 < 0.008;
      const o = (y * W + x) * 4;
      const col = seam ? 70 : isP ? 22 : 246;
      img.data[o] = col;
      img.data[o + 1] = col;
      img.data[o + 2] = isP && !seam ? 30 : col;
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class MatchView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.5, 900);
  readonly stadium: Stadium;
  readonly players: PlayerView[] = [];
  private ball: THREE.Mesh;
  private ballShadow: THREE.Mesh;
  private rings: THREE.Mesh[] = [];
  /** Set-piece aim: a dotted flight arc and a landing marker per human. */
  private aims: Array<{ arc: THREE.Points; spot: THREE.Mesh }> = [];
  private sun: THREE.DirectionalLight;
  private camPos = new THREE.Vector3(0, 20, 60);
  private camLook = new THREE.Vector3();
  private lastBall = new THREE.Vector3();
  cameraMode: CameraMode = 'broadcast';
  zoom = 1;
  /** Replay / cinematic camera override. */
  cinematic: { pos: THREE.Vector3; look: THREE.Vector3 } | null = null;
  /** Fixed camera for tests / screenshots. */
  debugCam: { pos: THREE.Vector3; look: THREE.Vector3 } | null = null;

  constructor(
    readonly clubs: [Club, Club],
    kits: [Kit, Kit],
  ) {
    const s = this.scene;
    s.background = new THREE.Color('#0d1424');
    s.fog = new THREE.Fog('#0d1424', 220, 520);
    this.stadium = new Stadium(clubs[0], clubs[1]);
    s.add(this.stadium.group);
    // Floodlit evening: a strong key light with shadows, sky fill and a warm bounce.
    s.add(new THREE.HemisphereLight('#dfe8ff', '#2b4a22', 1.15));
    const sun = new THREE.DirectionalLight('#fff4e2', 2.4);
    sun.position.set(-40, 80, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    // (PCF soft shadows are gone from three r18x: plain PCF at 4K looks fine.)
    const sc = sun.shadow.camera;
    sc.left = -70;
    sc.right = 70;
    sc.top = 50;
    sc.bottom = -50;
    sc.near = 10;
    sc.far = 220;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    s.add(sun);
    s.add(sun.target);
    this.sun = sun;
    const fill = new THREE.DirectionalLight('#cfe0ff', 0.6);
    fill.position.set(40, 50, -40);
    s.add(fill);
    // Players.
    let i = 0;
    for (const team of [0, 1] as const) {
      const club = clubs[team];
      for (const def of club.players.slice(0, 11)) {
        const kit = def.role === 'GK' ? club.gk : kits[team];
        const v = new PlayerView(def, kit);
        s.add(v.root);
        this.players.push(v);
        i++;
      }
    }
    // Ball (drawn slightly larger than life so it reads from the broadcast camera).
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R * 1.35, 24, 16), new THREE.MeshStandardMaterial({ map: ballTexture(), roughness: 0.45 }));
    this.ball.castShadow = true;
    s.add(this.ball);
    this.ballShadow = new THREE.Mesh(new THREE.CircleGeometry(0.16, 16), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.35, depthWrite: false }));
    this.ballShadow.rotation.x = -Math.PI / 2;
    s.add(this.ballShadow);
    // Controller rings under the human-controlled players.
    for (let h = 0; h < 8; h++) {
      const r = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.75, 32), new THREE.MeshBasicMaterial({ color: HUMAN_COLORS[h], transparent: true, opacity: 0.85, depthWrite: false }));
      r.rotation.x = -Math.PI / 2;
      r.position.y = 0.03;
      r.visible = false;
      s.add(r);
      this.rings.push(r);
      const arc = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(40 * 3), 3)), new THREE.PointsMaterial({ color: HUMAN_COLORS[h], size: 0.32, transparent: true, opacity: 0.95, depthWrite: false }));
      arc.frustumCulled = false;
      arc.visible = false;
      const spot = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.95, 40), new THREE.MeshBasicMaterial({ color: HUMAN_COLORS[h], transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
      spot.rotation.x = -Math.PI / 2;
      spot.visible = false;
      const dot = new THREE.Mesh(new THREE.CircleGeometry(0.18, 20), new THREE.MeshBasicMaterial({ color: '#ffffff', depthWrite: false }));
      dot.position.z = 0.001;
      spot.add(dot);
      s.add(arc, spot);
      this.aims.push({ arc, spot });
    }
  }

  setKits(kits: [Kit, Kit]): void {
    this.players.forEach((p, i) => {
      if (p.def.role !== 'GK') p.setKit(kits[i < 11 ? 0 : 1]);
    });
  }

  update(f: Frame, dt: number, time: number, excitement: number): void {
    f.players.forEach((p, i) => this.players[i]?.update(p, dt));
    // Ball: position + roll from its motion.
    const b = f.ball;
    const yOff = BALL_R * 0.35;
    this.ball.position.set(b.x, b.y + yOff, b.z);
    const mv = new THREE.Vector3(b.x - this.lastBall.x, 0, b.z - this.lastBall.z);
    const dist = mv.length();
    if (dist > 0 && dist < 3) {
      const axis = new THREE.Vector3(mv.z, 0, -mv.x).normalize();
      this.ball.rotateOnWorldAxis(axis, dist / (BALL_R * 1.35));
    }
    this.lastBall.set(b.x, b.y, b.z);
    this.ballShadow.position.set(b.x, 0.02, b.z);
    this.ballShadow.visible = b.y > 0.5;
    (this.ballShadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0.08, 0.35 - b.y * 0.05);
    // Controlled-player rings.
    this.rings.forEach((r, h) => {
      const hu = f.humans[h];
      const p = hu ? f.players[hu.p] : undefined;
      r.visible = !!p && p.state !== 'off' && !this.cinematic;
      if (p) r.position.set(p.x, 0.03, p.z);
    });
    // Set-piece aim: the ball's flight to the marker (height from the kick's power) and where it lands.
    this.aims.forEach(({ arc, spot }, h) => {
      const hu = f.humans[h];
      const aim = hu?.aim;
      arc.visible = spot.visible = !!aim && !this.cinematic;
      if (!aim) return;
      spot.position.set(aim.x, 0.04, aim.z);
      spot.scale.setScalar(1 + Math.sin(time * 6) * 0.08);
      const d = Math.hypot(aim.x - b.x, aim.z - b.z);
      const t = loftTime(d, hu!.power >= 0 ? hu!.power : 0.5);
      const apex = (9.81 * t * t) / 8;
      const pos = arc.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < 40; i++) {
        const u = i / 39;
        pos.setXYZ(i, b.x + (aim.x - b.x) * u, b.y + 4 * apex * u * (1 - u) + (0.11 - b.y) * u, b.z + (aim.z - b.z) * u);
      }
      pos.needsUpdate = true;
    });
    this.stadium.update(dt, time, excitement);
    this.updateCamera(f, dt);
  }

  private updateCamera(f: Frame, dt: number): void {
    const b = f.ball;
    const cam = this.camera;
    if (this.debugCam) {
      cam.position.copy(this.debugCam.pos);
      cam.lookAt(this.debugCam.look);
      return;
    }
    if (this.cinematic) {
      this.camPos.lerp(this.cinematic.pos, Math.min(1, dt * 4));
      this.camLook.lerp(this.cinematic.look, Math.min(1, dt * 6));
      cam.position.copy(this.camPos);
      cam.lookAt(this.camLook);
      return;
    }
    // Lead the ball a little in the direction of play.
    const lead = new THREE.Vector3(b.vx * 0.35, 0, b.vz * 0.2).clampLength(0, 6);
    let tx = THREE.MathUtils.clamp(b.x + lead.x, -PITCH.HL + 4, PITCH.HL - 4);
    let tz = THREE.MathUtils.clamp(b.z + lead.z, -PITCH.HW, PITCH.HW);
    // Aiming a set piece: frame the taker and the target marker together.
    const aim = f.humans.find((h) => h.aim)?.aim;
    if (aim) {
      tx = THREE.MathUtils.clamp((b.x + aim.x) / 2, -PITCH.HL + 4, PITCH.HL - 4);
      tz = (b.z + aim.z) / 2;
    }
    let pos: THREE.Vector3;
    let look: THREE.Vector3;
    if (this.cameraMode === 'end') {
      // Behind your attack (team 0's direction), like the "end to end" camera.
      const s = f.dir0;
      pos = new THREE.Vector3(tx - s * 26 * this.zoom, 14 * this.zoom, tz * 0.7);
      look = new THREE.Vector3(tx + s * 8, 0, tz * 0.85);
    } else {
      const tele = this.cameraMode === 'tele';
      const dist = (tele ? 62 : 41) * this.zoom;
      const h = (tele ? 36 : 22) * this.zoom;
      pos = new THREE.Vector3(tele ? tx * 0.6 : tx * 0.9, h, PITCH.HW + dist - 30 + tz * 0.2);
      look = new THREE.Vector3(tx, 0, tz * 0.6 - 3);
    }
    const k = 1 - Math.exp(-dt * 3.2);
    this.camPos.lerp(pos, k);
    this.camLook.lerp(look, 1 - Math.exp(-dt * 4.5));
    cam.position.copy(this.camPos);
    cam.lookAt(this.camLook);
    // Shadows follow the action.
    this.sun.position.set(this.camLook.x - 40, 80, 30);
    this.sun.target.position.set(this.camLook.x, 0, 0);
  }

  /** Screen position (CSS px) of a point above a player's head, or null if off-screen. */
  project(x: number, y: number, z: number, w: number, h: number): [number, number] | null {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    if (v.z > 1) return null;
    return [(v.x * 0.5 + 0.5) * w, (-v.y * 0.5 + 0.5) * h];
  }

  /** Snap the camera (after a cut: kick-off, restarts). */
  snap(): void {
    this.camPos.copy(this.camera.position);
  }

  dispose(): void {
    for (const p of this.players) p.dispose();
    this.scene.traverse((n) => {
      const m = n as THREE.Mesh;
      // Skinned players share the cached model's geometry: leave it.
      if (m.isMesh && !(m as THREE.SkinnedMesh).isSkinnedMesh) {
        m.geometry.dispose();
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
          (mat as THREE.MeshStandardMaterial).map?.dispose();
          mat.dispose();
        }
      }
    });
  }
}
