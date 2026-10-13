import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { BALL_R, PITCH, loftTime } from '../sim/match';
import type { Club, Kit, PlayerDef } from '../sim/data';
import type { Frame } from '../sim/snapshot';
import { Stadium } from './stadium';
import { PlayerView, type PoseContext } from './players';
import { Referees, refereeKit } from './referees';

/**
 * The 3D match: stadium, 22 footballers, the ball and the broadcast camera, rendered
 * through a broadcast-style chain (HDR → bloom → grade → filmic tone map).
 * Draws Frames only (see sim/snapshot.ts).
 */

export const HUMAN_COLORS = ['#2f8bff', '#ff3b4a', '#2fd36b', '#ffc21a', '#c45bff', '#21d4d4', '#ff8a1f', '#f4f4f4'];
export type CameraMode = 'broadcast' | 'tele' | 'end';

/** Drawn once per page (it's pixel-by-pixel work): every view gets its own texture over the same picture. */
let ballTextureCache: THREE.CanvasTexture | null = null;
function ballTexture(): THREE.CanvasTexture {
  ballTextureCache ??= drawBallTexture();
  const t = ballTextureCache.clone();
  t.needsUpdate = true;
  return t;
}

/** Match ball: the classic truncated icosahedron, with the pentagons in navy and a teal accent ring. */
function drawBallTexture(): THREE.CanvasTexture {
  const W = 1024;
  const H = 512;
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
        const s = d[0]! * c0.v[0]! + d[1]! * c0.v[1]! + d[2]! * c0.v[2]! - (c0.p ? 0.012 : 0);
        if (s > b1) {
          b2 = b1;
          b1 = s;
          isP = c0.p;
        } else if (s > b2) b2 = s;
      }
      const seam = b1 - b2 < 0.006;
      const ring = isP && b1 - b2 > 0.006 && b1 - b2 < 0.028;
      const o = (y * W + x) * 4;
      const [r, gg, bb] = seam ? [90, 96, 108] : ring ? [24, 214, 186] : isP ? [16, 30, 74] : [248, 248, 246];
      img.data[o] = r;
      img.data[o + 1] = gg;
      img.data[o + 2] = bb;
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Soft elliptical shadow (for the floodlight shadow fan and contact shadows). */
function shadowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d')!;
  const gr = g.createLinearGradient(0, 0, 0, 128);
  gr.addColorStop(0, 'rgba(0,0,0,0.85)');
  gr.addColorStop(0.15, 'rgba(0,0,0,0.6)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.beginPath();
  g.ellipse(32, 64, 30, 64, 0, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  // Darkest at the feet, fading out along the streak.
  t.flipY = false;
  return t;
}

/** Broadcast grade: vignette, a touch of contrast and saturation, the cinematic letterbox and a flash. */
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uVig: { value: 0.32 }, uBars: { value: 0 }, uFlash: { value: 0 }, uSat: { value: 1.1 }, uAspect: { value: 16 / 9 }, uTime: { value: 0 }, uGrain: { value: 0.012 } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uVig; uniform float uBars; uniform float uFlash; uniform float uSat; uniform float uAspect; uniform float uTime; uniform float uGrain; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, uSat);
      vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
      c.rgb *= 1.0 - uVig * smoothstep(0.45, 1.25, length(p));
      float n = fract(sin(dot(vUv * 1000.0 + uTime, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
      c.rgb += n * uGrain * (0.3 + l);
      c.rgb += uFlash;
      float bar = step(vUv.y, uBars) + step(1.0 - uBars, vUv.y);
      c.rgb *= 1.0 - bar;
      gl_FragColor = c;
    }`,
};

export class MatchView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.5, 1500);
  readonly stadium: Stadium;
  readonly players: PlayerView[] = [];
  readonly refs: Referees;
  /** VAR offside / box lines across the pitch (x of the attacker and of the defender / line), or null. */
  varLines: { a: number; d: number; az: number } | null = null;
  private varMesh: THREE.Group;
  private ball: THREE.Mesh;
  private ballShadow: THREE.Mesh;
  private trail: THREE.Points;
  private trailPts: Array<[number, number, number]> = [];
  private rings: THREE.Mesh[] = [];
  /** Set-piece aim: a dotted flight arc and a landing marker per human. */
  private aims: Array<{ arc: THREE.Points; spot: THREE.Mesh }> = [];
  /** The four-way floodlight shadow fan under every player (+ the ball's contact shadow). */
  private fan: THREE.InstancedMesh;
  private sun: THREE.DirectionalLight;
  private camPos = new THREE.Vector3(0, 20, 60);
  private camLook = new THREE.Vector3();
  private lastBall = new THREE.Vector3();
  private composer: EffectComposer | null = null;
  private grade: ShaderPass | null = null;
  private bloom: UnrealBloomPass | null = null;
  private envReady = false;
  private shake = 0;
  private flash = 0;
  /** Letterbox (0…1 of its full height) for cinematics. */
  bars = 0;
  private barsNow = 0;
  cameraMode: CameraMode = 'broadcast';
  zoom = 1;
  /** Replay / cinematic camera override (fov optional: a long lens for close-ups). */
  cinematic: { pos: THREE.Vector3; look: THREE.Vector3; fov?: number; snap?: boolean } | null = null;
  /** Fixed camera for tests / screenshots. */
  debugCam: { pos: THREE.Vector3; look: THREE.Vector3 } | null = null;
  private baseFov = 30;
  /** Graphics level: performance drops the bloom / grade chain and draws straight to the screen. */
  quality: 'high' | 'balanced' | 'performance' = 'high';
  /** Behind-the-taker camera for free kicks and penalties (held a moment after the strike to watch it fly). */
  private spCam: { pos: THREE.Vector3; until: number; fov: number } | null = null;

  constructor(
    readonly clubs: [Club, Club],
    kits: [Kit, Kit],
    /** Who plays in each slot (22; default: each club's first eleven). */
    defs?: PlayerDef[],
  ) {
    const s = this.scene;
    s.fog = new THREE.Fog('#0e1524', 260, 760);
    this.stadium = new Stadium(clubs[0], clubs[1]);
    s.add(this.stadium.group);
    // Night under floodlights: a key light with shadows, three more pylons as cross / rim lights,
    // and a cool sky fill. (Reflections come from a soft studio environment, see render().)
    s.add(new THREE.HemisphereLight('#c9d8ff', '#24401d', 0.38));
    const sun = new THREE.DirectionalLight('#fff3df', 2.35);
    sun.position.set(-40, 80, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
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
    for (const [x, z, k] of [
      [1, 1, 0.55],
      [1, -1, 0.42],
      [-1, -1, 0.42],
    ] as const) {
      const l = new THREE.DirectionalLight('#eaf0ff', k);
      l.position.set(x * (PITCH.HL + 31), 47, z * (PITCH.HW + 31));
      s.add(l);
    }
    // Players.
    for (const team of [0, 1] as const) {
      const club = clubs[team];
      // (Slot 0 is the keeper in every formation: he wears the keeper's kit, whoever he is.)
      for (const [slot, def] of (defs ? defs.slice(team * 11, team * 11 + 11) : club.players.slice(0, 11)).entries()) {
        const kit = slot === 0 ? club.gk : kits[team];
        const v = new PlayerView(def, kit, slot === 0);
        v.teamHint = team;
        s.add(v.root);
        this.players.push(v);
      }
    }
    // Match officials, in whichever colours clash least with both teams.
    this.refs = new Referees(refereeKit([kits[0].shirt, kits[1].shirt, clubs[0].gk.shirt, clubs[1].gk.shirt]));
    s.add(this.refs.group);
    // VAR lines: a glowing stripe across the turf and a faint curtain above it (attacker red, defence blue).
    this.varMesh = new THREE.Group();
    for (const [name, col] of [
      ['a', new THREE.Color(4, 0.4, 0.5)],
      ['d', new THREE.Color(0.3, 1.2, 4)],
    ] as const) {
      const g = new THREE.Group();
      g.name = name;
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.24, PITCH.HW * 2 + 2), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.95, depthWrite: false }));
      strip.rotation.x = -Math.PI / 2;
      strip.position.y = 0.04;
      g.add(strip);
      const curtain = new THREE.Mesh(new THREE.PlaneGeometry(PITCH.HW * 2 + 2, 2.2), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide }));
      curtain.rotation.y = Math.PI / 2;
      curtain.position.y = 1.1;
      g.add(curtain);
      this.varMesh.add(g);
    }
    this.varMesh.visible = false;
    s.add(this.varMesh);
    // Floodlight shadows: four soft streaks fanning out from each player's feet (one per pylon).
    const fanGeo = new THREE.PlaneGeometry(0.62, 2.3);
    fanGeo.translate(0, 1.0, 0);
    fanGeo.rotateX(-Math.PI / 2);
    this.fan = new THREE.InstancedMesh(fanGeo, new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, opacity: 0.32, depthWrite: false, color: '#000' }), 25 * 4);
    this.fan.frustumCulled = false;
    this.fan.renderOrder = 1;
    s.add(this.fan);
    // Ball (drawn slightly larger than life so it reads from the broadcast camera).
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R * 1.35, 32, 24), new THREE.MeshPhysicalMaterial({ map: ballTexture(), roughness: 0.38, clearcoat: 0.8, clearcoatRoughness: 0.18 }));
    this.ball.castShadow = true;
    s.add(this.ball);
    this.ballShadow = new THREE.Mesh(new THREE.CircleGeometry(0.16, 16), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.35, depthWrite: false }));
    this.ballShadow.rotation.x = -Math.PI / 2;
    s.add(this.ballShadow);
    // Shot trail: a short comet tail of light behind a struck ball.
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(24 * 3), 3));
    tg.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(24), 1));
    this.trail = new THREE.Points(
      tg,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: `attribute float alpha; varying float vA; void main() { vA = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = (0.06 + 0.22 * alpha) * 900.0 / -mv.z; gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `varying float vA; void main() { float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d) * vA * 0.55; gl_FragColor = vec4(vec3(0.85, 0.95, 1.4) * a, a); }`,
      }),
    );
    this.trail.frustumCulled = false;
    s.add(this.trail);
    // Controller rings under the human-controlled players.
    for (let h = 0; h < 8; h++) {
      const r = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.72, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(HUMAN_COLORS[h]).multiplyScalar(1.6), transparent: true, opacity: 0.9, depthWrite: false }));
      r.rotation.x = -Math.PI / 2;
      r.position.y = 0.03;
      r.visible = false;
      // A little pointer on the ring: which way he's facing.
      const tip = new THREE.Mesh(new THREE.CircleGeometry(0.16, 3), r.material);
      tip.position.set(0.86, 0, 0);
      tip.rotation.z = 0;
      r.add(tip);
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
      if (!p.keeper) p.setKit(kits[i < 11 ? 0 : 1]);
    });
  }

  /** A jolt of camera shake (posts, thunderbolts, goals). */
  kick(amount: number): void {
    this.shake = Math.max(this.shake, amount);
  }
  /** A white flash over the picture (goal stinger). */
  flashScreen(amount = 0.6): void {
    this.flash = Math.max(this.flash, amount);
  }

  update(f: Frame, dt: number, time: number, excitement: number, cameraDt = dt): void {
    const b = f.ball;
    const celeb = f.players.findIndex((p) => p.state === 'celebrate');
    const ctx: PoseContext = { ball: b, phase: f.phase, celebTeam: celeb < 0 ? -1 : celeb < 11 ? 0 : 1, ownGoalX: 0, time, restart: f.restart, taker: f.taker, phaseT: f.phaseT, self: -1 };
    f.players.forEach((p, i) => {
      const team = i < 11 ? 0 : 1;
      ctx.ownGoalX = -(team === 0 ? f.dir0 : -f.dir0) * PITCH.HL;
      ctx.self = i;
      this.players[i]?.update(p, dt, ctx);
    });
    this.refs.update(f, dt, ctx);
    this.varMesh.visible = !!this.varLines;
    if (this.varLines) {
      this.varMesh.getObjectByName('a')!.position.x = this.varLines.a;
      this.varMesh.getObjectByName('d')!.position.x = this.varLines.d;
    }
    // Ball: position + roll from its motion.
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
    this.updateTrail(f, dt);
    this.updateFan(f);
    // Controlled-player rings.
    this.rings.forEach((r, h) => {
      const hu = f.humans[h];
      const p = hu ? f.players[hu.p] : undefined;
      r.visible = !!p && p.state !== 'off' && !this.cinematic;
      if (p) {
        r.position.set(p.x, 0.03, p.z);
        r.rotation.z = p.face;
        const pulse = 1 + Math.sin(time * 5) * 0.04;
        r.scale.setScalar(pulse);
      }
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
    this.stadium.update(dt, f.time, excitement, b, f.phase === 'goal');
    this.updateCamera(f, cameraDt, time);
    // Post: letterbox in / out, flash decay.
    this.barsNow += (this.bars - this.barsNow) * Math.min(1, cameraDt * 5);
    this.flash *= Math.exp(-cameraDt * 4);
    if (this.grade) {
      const u = this.grade.uniforms;
      u.uBars!.value = this.barsNow * 0.1;
      u.uFlash!.value = this.flash;
      u.uTime!.value = time % 100;
      u.uVig!.value = this.cinematic ? 0.5 : 0.3;
    }
  }

  private updateTrail(f: Frame, dt: number): void {
    const b = f.ball;
    const sp = Math.hypot(b.vx, b.vy, b.vz);
    const live = b.owner < 0 && sp > 21 && b.y > 0.15;
    if (live && dt > 0) this.trailPts.unshift([b.x, b.y + BALL_R * 0.35, b.z]);
    else if (this.trailPts.length) this.trailPts.pop();
    if (this.trailPts.length > 24) this.trailPts.length = 24;
    const pos = this.trail.geometry.getAttribute('position') as THREE.BufferAttribute;
    const al = this.trail.geometry.getAttribute('alpha') as THREE.BufferAttribute;
    for (let i = 0; i < 24; i++) {
      const p = this.trailPts[i];
      if (p) pos.setXYZ(i, p[0], p[1], p[2]);
      al.setX(i, p ? (1 - i / 24) * Math.min(1, (sp - 21) / 6) : 0);
    }
    pos.needsUpdate = true;
    al.needsUpdate = true;
  }

  private updateFan(f: Frame): void {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const sc = new THREE.Vector3(1, 1, 1);
    let k = 0;
    const masts: Array<[number, number]> = [
      [PITCH.HL + 31, PITCH.HW + 31],
      [PITCH.HL + 31, -PITCH.HW - 31],
      [-PITCH.HL - 31, PITCH.HW + 31],
      [-PITCH.HL - 31, -PITCH.HW - 31],
    ];
    const bodies = [...f.players.map((p, i) => ({ x: p.x, z: p.z, on: p.state !== 'off', v: this.players[i] })), ...this.refs.list.map((o) => ({ x: o.x, z: o.z, on: true, v: o.view }))];
    for (const p of bodies) {
      const v = p.v;
      const lift = v ? v.root.children[0]!.position.y : 0;
      const on = p.on;
      for (const [mx, mz] of masts) {
        // Away from the pylon, longer the lower the light comes in.
        const dx = p.x - mx;
        const dz = p.z - mz;
        const a = Math.atan2(-dx, -dz);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a);
        const len = (0.85 + Math.hypot(dx, dz) * 0.006) * (on ? 1 : 0) * (1 - Math.min(0.8, Math.max(0, lift) * 0.8));
        pos.set(p.x, 0.025, p.z);
        sc.set(1, 1, len);
        m.compose(pos, q, sc);
        this.fan.setMatrixAt(k++, m);
      }
    }
    this.fan.instanceMatrix.needsUpdate = true;
  }

  private updateCamera(f: Frame, dt: number, time: number): void {
    const b = f.ball;
    const cam = this.camera;
    if (this.debugCam) {
      cam.position.copy(this.debugCam.pos);
      cam.lookAt(this.debugCam.look);
      return;
    }
    let fov = this.baseFov;
    // Free kick in range / penalty: low behind the ball, looking through it at the goal.
    const att = f.restartTeam === 0 ? f.dir0 : -f.dir0;
    const gx = att * PITCH.HL;
    const sp = !this.cinematic && (f.phase === 'stop' || f.phase === 'kickoff') && (f.restart === 'penalty' || (f.restart === 'free' && Math.hypot(gx - b.x, b.z) < 36));
    if (sp) {
      const aim = f.humans.find((h) => h.aim)?.aim;
      const az = aim && Math.abs(aim.x - gx) < 8 ? aim.z * 0.5 : 0;
      const dx = gx - b.x;
      const dz = az - b.z;
      const dl = Math.hypot(dx, dz) || 1;
      const pen = f.restart === 'penalty';
      const back = pen ? 4.6 : 6.4;
      const pos = new THREE.Vector3(b.x - (dx / dl) * back - (dz / dl) * 0.7, pen ? 1.75 : 2.15, b.z - (dz / dl) * back + (dx / dl) * 0.7);
      this.spCam = { pos, until: time + 1.6, fov: pen ? 34 : 40 };
      this.camPos.lerp(pos, Math.min(1, dt * 6));
      this.camLook.lerp(new THREE.Vector3(gx, pen ? 1.0 : 1.3, az), Math.min(1, dt * 6));
      cam.position.copy(this.camPos);
      cam.lookAt(this.camLook);
      fov = this.spCam.fov;
      if (Math.abs(cam.fov - fov) > 0.01) {
        cam.fov += (fov - cam.fov) * Math.min(1, dt * 6);
        cam.updateProjectionMatrix();
      }
      this.stadium.nearStand.visible = true;
      return;
    }
    if (this.spCam && !this.cinematic && time < this.spCam.until && f.phase === 'play') {
      // Stay behind it and follow the ball's flight.
      this.camPos.lerp(this.spCam.pos, Math.min(1, dt * 3));
      this.camLook.lerp(new THREE.Vector3(b.x, Math.max(0.8, b.y), b.z), Math.min(1, dt * 8));
      cam.position.copy(this.camPos);
      cam.lookAt(this.camLook);
      return;
    }
    if (this.spCam && (time >= this.spCam.until || f.phase !== 'play')) {
      this.spCam = null;
      cam.fov = this.baseFov;
      cam.updateProjectionMatrix();
    }
    if (this.cinematic) {
      if (this.cinematic.snap) {
        this.camPos.copy(this.cinematic.pos);
        this.camLook.copy(this.cinematic.look);
        this.cinematic.snap = false;
      }
      this.camPos.lerp(this.cinematic.pos, Math.min(1, dt * 4));
      this.camLook.lerp(this.cinematic.look, Math.min(1, dt * 6));
      cam.position.copy(this.camPos);
      // Handheld: a gentle drift on the long lens.
      cam.position.x += Math.sin(time * 1.3) * 0.08;
      cam.position.y += Math.sin(time * 1.7 + 1) * 0.06;
      cam.lookAt(this.camLook);
      fov = this.cinematic.fov ?? this.baseFov;
    } else {
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
      // Push in a touch when the play is around a box (the director tightens the shot).
      const nearGoal = Math.max(0, 1 - (PITCH.HL - Math.abs(b.x)) / 30);
      const z = this.zoom * (1 - nearGoal * 0.12);
      let pos: THREE.Vector3;
      let look: THREE.Vector3;
      if (this.cameraMode === 'end') {
        // Behind your attack (team 0's direction), like the "end to end" camera.
        const s = f.dir0;
        pos = new THREE.Vector3(tx - s * 26 * z, 14 * z, tz * 0.7);
        look = new THREE.Vector3(tx + s * 8, 0, tz * 0.85);
      } else {
        // Look across at the play; with the ball on the near side, the near touchline and boards come into shot.
        const tele = this.cameraMode === 'tele';
        const lz = tz * 0.74 + 1.5;
        const dist = (tele ? 60 : 42) * z - Math.max(0, tz) * 0.15;
        const h = (tele ? 36 : 22) * z;
        pos = new THREE.Vector3(tele ? tx * 0.6 : tx * 0.9, h, lz + dist);
        look = new THREE.Vector3(tx, 0, lz);
      }
      const k = 1 - Math.exp(-dt * 3.2);
      this.camPos.lerp(pos, k);
      this.camLook.lerp(look, 1 - Math.exp(-dt * 4.5));
      cam.position.copy(this.camPos);
      cam.lookAt(this.camLook);
    }
    // Shake.
    if (this.shake > 0.001) {
      const s = this.shake;
      cam.position.x += (Math.sin(time * 61) + Math.sin(time * 37)) * 0.18 * s;
      cam.position.y += Math.sin(time * 53) * 0.14 * s;
      cam.rotateZ(Math.sin(time * 47) * 0.006 * s);
      this.shake *= Math.exp(-dt * 5);
    }
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 5);
      cam.updateProjectionMatrix();
    }
    // The camera gantry is in the main stand: don't draw the stand around the lens.
    this.stadium.nearStand.visible = cam.position.z < PITCH.HW + 8 || cam.position.y > 34;
    // Shadows follow the action.
    this.sun.position.set(this.camLook.x - 40, 80, 30);
    this.sun.target.position.set(this.camLook.x, 0, 0);
  }

  /** The broadcast lens for the current window shape. */
  setLens(fov: number): void {
    this.baseFov = fov;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  /** Draw a frame through the post chain (bloom, grade, filmic tone mapping). */
  render(renderer: THREE.WebGLRenderer): void {
    if (!this.envReady) {
      this.envReady = true;
      const pm = new THREE.PMREMGenerator(renderer);
      this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
      this.scene.environmentIntensity = 0.22;
      pm.dispose();
    }
    if (this.quality === 'performance') {
      renderer.render(this.scene, this.camera);
      return;
    }
    const size = renderer.getSize(new THREE.Vector2());
    if (!this.composer) {
      // (2x MSAA on the HDR target: plenty at these pixel densities.)
      const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 2 });
      this.composer = new EffectComposer(renderer, rt);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.42, 0.55, 1.6);
      this.composer.addPass(this.bloom);
      this.grade = new ShaderPass(GradeShader);
      this.composer.addPass(this.grade);
      this.composer.addPass(new OutputPass());
      this.composer.setPixelRatio(renderer.getPixelRatio());
      this.composer.setSize(size.x, size.y);
    }
    this.grade!.uniforms.uAspect!.value = size.x / Math.max(1, size.y);
    this.composer.render();
  }

  /** The window changed size. */
  resize(w: number, h: number, pixelRatio: number): void {
    if (!this.composer) return;
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
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
    this.refs.dispose();
    this.composer?.dispose();
    this.scene.environment?.dispose();
    this.scene.traverse((n) => {
      const m = n as THREE.Mesh;
      // Skinned players share the cached model's geometry: leave it.
      if ((m.isMesh || (n as THREE.LineSegments).isLineSegments) && !(m as THREE.SkinnedMesh).isSkinnedMesh) {
        m.geometry.dispose();
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
          (mat as THREE.MeshStandardMaterial).map?.dispose();
          mat.dispose();
        }
      }
    });
  }
}
