import * as THREE from 'three';
import { COLORS } from '../sim/game';
import type { BuiltMap, Floor, MapDef, Spot } from '../sim/maps';
import type { PView, SfView } from '../sim/view';
import { floorCanvas } from '../render/art';
import { Bean3D, deadBody, prop3d, type MatFn } from './models';

/**
 * The 3D ship: the same maps, rules and positions as the 2D game, built as real rooms with
 * walls, props and doors; a camera that follows you from above and behind; and the vision fog
 * as a shader (everything outside your sight is dark, other players disappear). Walls between
 * the camera and you turn see-through.
 */

const WALL_H = 2.4;
const PPM = 8; // vision texture pixels per metre

const THEME = {
  space: { wall: '#8a97a6', top: '#2a313b', bg: 0x04050c, ground: null as Floor | null, hemi: [0xdfe9ff, 0x2a2f40] },
  sky: { wall: '#c3ccd6', top: '#3a4452', bg: 0x7ab8ea, ground: null as Floor | null, hemi: [0xffffff, 0x6d8fb0] },
  planet: { wall: '#9a8678', top: '#3b302a', bg: 0x3a4766, ground: 'rock' as Floor | null, hemi: [0xf2f4ff, 0x4a3f3a] },
} as const;

export interface Draw3DOpts {
  eye: { x: number; y: number; r: number } | null;
  ghosts: boolean;
  tasks: Spot[];
  alerts: Spot[];
  target?: number;
  ventGlow?: number;
  useGlow?: Spot | null;
  pos: (p: PView) => [number, number];
  ventsOpen?: Map<number, number>;
  /** First person: where you're looking (yaw 0 = north, + = turning right). */
  fp?: { yaw: number; pitch: number; low: boolean };
}

interface Wall {
  mesh: THREE.Mesh;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export class World3D {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
  private def: MapDef;
  private vis: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture };
  private white: THREE.DataTexture;
  private uniforms: { uVis: { value: THREE.Texture }; uVisB: { value: THREE.Vector4 } };
  private mats = new Map<string, THREE.Material>();
  private walls: Wall[] = [];
  private wallMat: THREE.Material[];
  private wallFade: THREE.Material[];
  private tall: Array<{ obj: THREE.Object3D; x: number; y: number; r: number; mats: THREE.Material[] }> = [];
  private anims: Array<(t: number) => void> = [];
  private doors: Array<{ room: string; mesh: THREE.Mesh; open: number }> = [];
  private lids: THREE.Object3D[] = [];
  private beans = new Map<number, Bean3D>();
  private bodies = new Map<number, THREE.Object3D>();
  private labels = new Map<number, HTMLElement>();
  private labelLayer: HTMLElement;
  private markers: THREE.Mesh[] = [];
  private beam: THREE.Mesh;
  private sun: THREE.DirectionalLight;
  private camAt = new THREE.Vector3();
  private camRenderer: THREE.WebGLRenderer | null = null;
  private zoom = 1;
  private ceilings: THREE.Object3D[] = [];
  private bob = { phase: 0, x: NaN, y: NaN, eye: 1.02 };

  constructor(private map: BuiltMap, parent: HTMLElement) {
    this.def = map.def;
    const th = THEME[this.def.theme];
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'scene3d';
    parent.prepend(this.canvas);
    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'labels3d';
    parent.appendChild(this.labelLayer);
    this.scene.background = new THREE.Color(th.bg);

    // Vision texture (white = visible) over the map's bounds.
    const b = this.def.bounds;
    const vc = document.createElement('canvas');
    vc.width = Math.ceil((b[2] - b[0]) * PPM);
    vc.height = Math.ceil((b[3] - b[1]) * PPM);
    const tex = new THREE.CanvasTexture(vc);
    tex.minFilter = tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.flipY = false;
    this.vis = { canvas: vc, ctx: vc.getContext('2d')!, tex };
    this.white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    this.white.needsUpdate = true;
    this.uniforms = { uVis: { value: tex }, uVisB: { value: new THREE.Vector4(b[0], b[1], 1 / (b[2] - b[0]), 1 / (b[3] - b[1])) } };

    // Lights.
    this.scene.add(new THREE.HemisphereLight(th.hemi[0], th.hemi[1], 1.6));
    this.sun = new THREE.DirectionalLight(0xffffff, 1.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -16;
    sc.right = sc.top = 16;
    sc.near = 1;
    sc.far = 60;
    this.sun.shadow.bias = -0.0008;
    this.scene.add(this.sun, this.sun.target);

    this.wallMat = [this.mat(th.wall), this.mat(th.wall), this.mat(th.top), this.mat(th.top), this.mat(th.wall), this.mat(th.wall)];
    this.wallFade = this.wallMat.map((m) => this.mat((m as THREE.MeshLambertMaterial).color.getStyle(), { transparent: true, opacity: 0.18 }));
    this.build();
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 1.8, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0x4cf1a0, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
    this.beam.visible = false;
    this.scene.add(this.beam);
    parent.addEventListener('wheel', this.onWheel, { passive: true });
  }

  private onWheel = (e: WheelEvent) => {
    this.zoom = Math.max(0.6, Math.min(1.6, this.zoom * (e.deltaY > 0 ? 1.08 : 0.93)));
  };

  /** A material that the vision fog darkens. */
  private mat: MatFn = (color, o = {}) => {
    const key = `${color}|${o.emissive ?? ''}|${o.transparent ? o.opacity : ''}|${o.flat ? 1 : 0}`;
    const hit = this.mats.get(key);
    if (hit) return hit;
    const m = new THREE.MeshLambertMaterial({ color, emissive: o.emissive ?? 0x000000, transparent: !!o.transparent, opacity: o.opacity ?? 1, depthWrite: !o.transparent });
    this.fog(m);
    this.mats.set(key, m);
    return m;
  };

  private fog(m: THREE.Material): void {
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uVis = this.uniforms.uVis;
      sh.uniforms.uVisB = this.uniforms.uVisB;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;').replace('#include <project_vertex>', '#include <project_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;\nuniform sampler2D uVis;\nuniform vec4 uVisB;')
        .replace('#include <dithering_fragment>', '#include <dithering_fragment>\nfloat vis = texture2D(uVis, (vWorldPos.xz - uVisB.xy) * uVisB.zw).r;\ngl_FragColor.rgb *= mix(0.26, 1.0, vis);');
    };
  }

  private floorMat(f: Floor): THREE.Material {
    const key = `floor:${f}`;
    const hit = this.mats.get(key);
    if (hit) return hit;
    const t = new THREE.CanvasTexture(floorCanvas(f));
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(0.5, 0.5);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    const m = new THREE.MeshLambertMaterial({ map: t });
    this.fog(m);
    this.mats.set(key, m);
    return m;
  }

  // ---------------------------------------------------------------- building the ship

  private build(): void {
    const def = this.def;
    const g = this.map.grid;
    const isFloor = (x: number, y: number) => {
      const i = g.ci(x);
      const j = g.cj(y);
      return i >= 0 && j >= 0 && i < g.w && j < g.h && g.floor[j * g.w + i] === 1;
    };
    const rect = (r: [number, number, number, number]): Array<[number, number]> => [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];
    const regions: Array<{ pts: Array<[number, number]>; floor: Floor; lift: number; outdoor: boolean }> = [];
    for (const o of def.outdoor ?? []) regions.push({ pts: rect(o.rect), floor: o.floor, lift: 0.001, outdoor: true });
    for (const h of def.halls) regions.push({ pts: rect(h), floor: def.theme === 'planet' ? 'metal' : 'hall', lift: 0.003, outdoor: false });
    for (const r of def.rooms) regions.push({ pts: r.poly ?? rect(r.rect!), floor: r.floor, lift: 0.005, outdoor: false });
    // Ground (the planet) or nothing (space / sky).
    const th = THEME[def.theme];
    const b = def.bounds;
    if (th.ground) {
      const t = new THREE.CanvasTexture(floorCanvas(th.ground));
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set((b[2] - b[0] + 80) / 2, (b[3] - b[1] + 80) / 2);
      t.colorSpace = THREE.SRGBColorSpace;
      const m = new THREE.MeshLambertMaterial({ map: t, color: 0x9aa4b4 });
      this.fog(m);
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(b[2] - b[0] + 80, b[3] - b[1] + 80), m);
      ground.rotation.x = -Math.PI / 2;
      ground.position.set((b[0] + b[2]) / 2, -0.05, (b[1] + b[3]) / 2);
      ground.receiveShadow = true;
      this.scene.add(ground);
    } else this.backdrop();
    for (const r of regions) {
      const shape = new THREE.Shape(r.pts.map(([x, y]) => new THREE.Vector2(x, -y)));
      const geo = new THREE.ShapeGeometry(shape);
      geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, this.floorMat(r.floor));
      m.position.y = r.lift;
      m.receiveShadow = true;
      this.scene.add(m);
      if (!r.outdoor) {
        // The floor's underside (ship hull) so the ship looks solid from the sky.
        const hull = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.6, bevelEnabled: false }), this.mat(def.theme === 'sky' ? '#6c7a8a' : '#2a303a'));
        hull.rotateX(Math.PI / 2);
        hull.position.y = r.lift - 0.01;
        this.scene.add(hull);
        // Ceiling (seen from inside in first person).
        const cg = new THREE.ShapeGeometry(new THREE.Shape(r.pts.map(([x, y]) => new THREE.Vector2(x, y))));
        cg.rotateX(Math.PI / 2);
        const cc = def.theme === 'sky' ? '#9aa7b5' : def.theme === 'planet' ? '#6a5d55' : '#5a6372';
        const ceil = new THREE.Mesh(cg, this.mat(cc, { emissive: def.theme === 'sky' ? '#5d6875' : def.theme === 'planet' ? '#3a312b' : '#323a46' }));
        ceil.position.y = WALL_H - r.lift;
        this.scene.add(ceil);
        this.ceilings.push(ceil);
      }
    }
    // Walls: every region edge, except where the other side is floor (doorways, joins).
    for (const r of regions) {
      const pts = r.pts;
      for (let i = 0; i < pts.length; i++) {
        const [x0, y0] = pts[i]!;
        const [x1, y1] = pts[(i + 1) % pts.length]!;
        const len = Math.hypot(x1 - x0, y1 - y0);
        const dx = (x1 - x0) / len;
        const dy = (y1 - y0) / len;
        const nx = dy;
        const ny = -dx; // outward (clockwise polygons, y down)
        let run = -1;
        const step = 0.125;
        const n = Math.ceil(len / step);
        for (let k = 0; k <= n; k++) {
          const s = Math.min(len, k * step);
          const px = x0 + dx * (s + step / 2);
          const py = y0 + dy * (s + step / 2);
          const solid = k < n && !isFloor(px + nx * 0.2, py + ny * 0.2);
          if (solid && run < 0) run = s;
          if ((!solid || k === n) && run >= 0) {
            const a = run;
            const e = Math.min(len, s);
            if (e - a > 0.05) this.wall(x0 + dx * a, y0 + dy * a, x0 + dx * e, y0 + dy * e, nx, ny, r.outdoor);
            run = -1;
          }
        }
      }
    }
    // Props.
    for (const p of def.props) {
      const { obj, h, anim } = prop3d(p, this.mat);
      if (p.rot) obj.rotation.y = -p.rot;
      this.scene.add(obj);
      if (anim) this.anims.push(anim);
      if (h > 1.3) {
        // Its own materials, so it can fade on its own.
        const mats: THREE.Material[] = [];
        obj.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          const c = (m.material as THREE.Material).clone();
          this.fog(c);
          m.material = c;
          mats.push(c);
        });
        this.tall.push({ obj, x: p.x, y: p.y, r: Math.max(p.w ?? 0, p.h ?? 0, (p.r ?? 0) * 2) / 2, mats });
      }
    }
    // Doors (slide down into the floor when open).
    for (const d of def.doors) {
      const [x0, y0, x1, y1] = d.rect;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, WALL_H, y1 - y0), [this.mat('#9aa6b2'), this.mat('#9aa6b2'), this.mat('#ffd23f'), this.mat('#ffd23f'), this.mat('#b3bdc8'), this.mat('#b3bdc8')]);
      mesh.position.set((x0 + x1) / 2, -WALL_H / 2, (y0 + y1) / 2);
      mesh.castShadow = true;
      this.scene.add(mesh);
      this.doors.push({ room: d.room, mesh, open: 1 });
    }
    // Vents.
    for (const v of def.vents) {
      const base = new THREE.Mesh(new THREE.BoxGeometry(1, 0.06, 0.64), this.mat('#20262c'));
      base.position.set(v.x, 0.03, v.y);
      this.scene.add(base);
      const lid = new THREE.Group();
      lid.position.set(v.x, 0.07, v.y - 0.32);
      const plate = new THREE.Mesh(new THREE.BoxGeometry(1, 0.04, 0.64), this.mat('#7e8994'));
      plate.position.z = 0.32;
      lid.add(plate);
      for (let k = 1; k < 5; k++) {
        const slat = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.02, 0.05), this.mat('#3a434c'));
        slat.position.set(0, 0.03, k * 0.128);
        lid.add(slat);
      }
      this.scene.add(lid);
      this.lids.push(lid);
    }
  }

  private wall(x0: number, y0: number, x1: number, y1: number, nx: number, ny: number, low: boolean): void {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const t = 0.3;
    const h = low ? 0.5 : WALL_H;
    const mats = low ? [this.mat('#f4f8fc'), this.mat('#f4f8fc'), this.mat('#ffffff'), this.mat('#ffffff'), this.mat('#f4f8fc'), this.mat('#f4f8fc')] : this.wallMat;
    const m = new THREE.Mesh(new THREE.BoxGeometry(len + t, h, t), mats);
    m.position.set((x0 + x1) / 2 + nx * t * 0.5, h / 2, (y0 + y1) / 2 + ny * t * 0.5);
    m.rotation.y = -Math.atan2(y1 - y0, x1 - x0);
    m.castShadow = m.receiveShadow = true;
    this.scene.add(m);
    if (!low) this.walls.push({ mesh: m, x0, y0, x1, y1 });
  }

  /** Stars below (space) or clouds below (sky). */
  private backdrop(): void {
    const b = this.def.bounds;
    const cx = (b[0] + b[2]) / 2;
    const cz = (b[1] + b[3]) / 2;
    if (this.def.theme === 'space') {
      const n = 2500;
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        pos[i * 3] = cx + (Math.random() - 0.5) * 400;
        pos[i * 3 + 1] = -20 - Math.random() * 80;
        pos[i * 3 + 2] = cz + (Math.random() - 0.5) * 400;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.scene.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.35, sizeAttenuation: true })));
    } else {
      const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
      for (let i = 0; i < 60; i++) {
        const c = new THREE.Group();
        for (let k = 0; k < 5; k++) {
          const s = new THREE.Mesh(new THREE.SphereGeometry(3 + Math.random() * 3, 10, 8), mat);
          s.position.set(k * 3.5 - 7, Math.random() * 1.5, Math.random() * 3);
          s.scale.y = 0.5;
          c.add(s);
        }
        c.position.set(cx + (Math.random() - 0.5) * 220, -14 - Math.random() * 20, cz + (Math.random() - 0.5) * 220);
        this.scene.add(c);
      }
    }
  }

  // ---------------------------------------------------------------- each frame

  /** Vision polygon (rays stop at walls; furniture doesn't block sight). */
  private drawVision(eye: { x: number; y: number; r: number } | null): void {
    const { ctx, canvas, tex } = this.vis;
    const b = this.def.bounds;
    if (!eye) {
      this.uniforms.uVis.value = this.white;
      return;
    }
    this.uniforms.uVis.value = tex;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const g = this.map.grid;
    const ex = (eye.x - b[0]) * PPM;
    const ey = (eye.y - b[1]) * PPM;
    const grad = ctx.createRadialGradient(ex, ey, eye.r * PPM * 0.6, ex, ey, eye.r * PPM);
    grad.addColorStop(0, '#fff');
    grad.addColorStop(1, '#000');
    ctx.fillStyle = grad;
    ctx.beginPath();
    const n = 240;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      let d = g.ray(eye.x, eye.y, dx, dy, eye.r);
      if (d < eye.r) d += 0.4; // light the wall itself
      const px = (eye.x + dx * d - b[0]) * PPM;
      const py = (eye.y + dy * d - b[1]) * PPM;
      if (k) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    tex.needsUpdate = true;
  }

  visible(eye: { x: number; y: number; r: number }, x: number, y: number): boolean {
    return Math.hypot(x - eye.x, y - eye.y) <= eye.r + 0.2 && this.map.grid.sees(eye.x, eye.y, x, y);
  }

  private placeCamera(x: number, y: number, dt: number): void {
    const aspect = innerWidth / Math.max(1, innerHeight);
    const dist = (aspect < 1 ? 1.5 : 1) * this.zoom;
    const target = new THREE.Vector3(x, 0.6, y);
    if (this.camAt.lengthSq() === 0 || this.camAt.distanceTo(target) > 6) this.camAt.copy(target);
    else this.camAt.lerp(target, Math.min(1, dt * 10));
    this.camera.position.set(this.camAt.x, this.camAt.y + 10.5 * dist, this.camAt.z + 9.5 * dist);
    this.camera.lookAt(this.camAt.x, this.camAt.y, this.camAt.z - 0.6);
    this.sun.position.set(this.camAt.x - 6, 18, this.camAt.z + 8);
    this.sun.target.position.set(this.camAt.x, 0, this.camAt.z);
  }

  /** First person: eyes at visor height, a little bob when walking (low in a vent). */
  private placeEyes(x: number, y: number, fp: { yaw: number; pitch: number; low: boolean }, dt: number): void {
    if (this.camera.fov !== 78) {
      this.camera.fov = 78;
      this.camera.updateProjectionMatrix();
    }
    const b = this.bob;
    const d = Number.isNaN(b.x) ? 0 : Math.hypot(x - b.x, y - b.y);
    b.x = x;
    b.y = y;
    if (d < 1) b.phase += d * 4.2;
    const want = fp.low ? 0.35 : 1.02 + (d > 0.001 ? Math.sin(b.phase * 2) * 0.035 : 0);
    b.eye += (want - b.eye) * Math.min(1, dt * 10);
    this.camera.rotation.order = 'YXZ';
    this.camera.position.set(x, b.eye, y);
    this.camera.rotation.set(fp.pitch, -fp.yaw, 0);
    this.sun.position.set(x - 6, 18, y + 8);
    this.sun.target.position.set(x, 0, y);
    for (const w of this.walls) w.mesh.material = this.wallMat;
  }

  resize(): void {
    const w = innerWidth;
    const h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  /** World point → CSS pixels on screen. */
  project(x: number, y: number, h = 0): [number, number, boolean] {
    const v = new THREE.Vector3(x, h, y).project(this.camera);
    return [((v.x + 1) / 2) * innerWidth, ((1 - v.y) / 2) * innerHeight, v.z < 1];
  }

  /** Bring every object in line with the view (positions, who's visible, doors, markers). */
  private sync(v: SfView, dt: number, t: number, o: Draw3DOpts, cams: boolean): void {
    // Doors.
    const closed = new Set(v.doors);
    for (const d of this.doors) {
      const want = closed.has(d.room) ? 0 : 1;
      d.open += Math.sign(want - d.open) * Math.min(Math.abs(want - d.open), dt * 4);
      d.mesh.position.y = WALL_H / 2 - d.open * (WALL_H - 0.02);
      d.mesh.visible = d.open < 0.99;
    }
    // Vent lids flip open.
    this.lids.forEach((lid, i) => (lid.rotation.x = -(o.ventsOpen?.get(i) ?? 0) * 1.6));
    for (const a of this.anims) a(t);
    // Bodies.
    const eye = cams ? null : o.eye;
    const seenBodies = new Set<number>();
    for (const b of v.bodies) {
      seenBodies.add(b.id);
      let m = this.bodies.get(b.id);
      if (!m) {
        const c = COLORS[b.color]!;
        m = deadBody(c[1], c[2]);
        m.position.set(b.x, 0, b.y);
        this.scene.add(m);
        this.bodies.set(b.id, m);
      }
      m.visible = !eye || this.visible(eye, b.x, b.y);
    }
    for (const [id, m] of this.bodies)
      if (!seenBodies.has(id)) {
        m.removeFromParent();
        this.bodies.delete(id);
      }
    // People.
    let scanning: [number, number] | null = null;
    for (const p of v.players) {
      let bean = this.beans.get(p.id);
      if (!bean) {
        bean = new Bean3D(COLORS[p.color]![1]);
        this.scene.add(bean.root);
        this.beans.set(p.id, bean);
      }
      const [x, y] = o.pos(p);
      const show = !p.hidden && (p.alive || o.ghosts || p.id === v.me) && (!eye || p.id === v.me || !p.alive || this.visible(eye, x, y)) && v.phase !== 'meeting' && !(o.fp && !cams && p.id === v.me);
      bean.root.visible = show;
      bean.setGhost(!p.alive);
      bean.setGlow(o.target === p.id && !cams);
      if (!cams) bean.update(x, y, dt, t, p.moving, p.left);
      if (show && p.busy === 'scan') scanning = [x, y];
      const label = this.label(p);
      label.style.display = show && !cams ? '' : 'none';
    }
    this.beam.visible = !!scanning;
    if (scanning) {
      this.beam.position.set(scanning[0], 0.9, scanning[1]);
      (this.beam.material as THREE.MeshBasicMaterial).opacity = 0.25 + Math.sin(t * 6) * 0.1;
    }
    // Task (yellow) / sabotage (red) / use (white) rings.
    const rings: Array<[Spot, number]> = [...o.tasks.map((s) => [s, 0xffd23f] as [Spot, number]), ...o.alerts.map((s) => [s, 0xff3b3b] as [Spot, number])];
    if (o.useGlow) rings.push([o.useGlow, 0xffffff]);
    if (o.ventGlow !== undefined && o.ventGlow >= 0) rings.push([this.def.vents[o.ventGlow]!, 0xffd23f]);
    while (this.markers.length < rings.length) {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.48, 0.6, 32), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      this.scene.add(m);
      this.markers.push(m);
    }
    this.markers.forEach((m, i) => {
      const r = rings[i];
      m.visible = !!r && !cams;
      if (!r) return;
      m.position.set(r[0].x, 0.05, r[0].y);
      (m.material as THREE.MeshBasicMaterial).color.setHex(r[1]);
      m.scale.setScalar(1 + Math.sin(t * 5) * 0.08);
    });
  }

  private label(p: PView): HTMLElement {
    let el = this.labels.get(p.id);
    if (!el) {
      el = document.createElement('div');
      el.textContent = p.name;
      this.labelLayer.appendChild(el);
      this.labels.set(p.id, el);
    }
    return el;
  }

  /** Walls and tall props between the camera and you go see-through. */
  private fade(x: number, y: number): void {
    for (const w of this.walls) {
      const minY = Math.min(w.y0, w.y1);
      const maxY = Math.max(w.y0, w.y1);
      const minX = Math.min(w.x0, w.x1);
      const maxX = Math.max(w.x0, w.x1);
      const hide = maxY > y - 0.1 && minY < y + 3.2 && maxX > x - 2 && minX < x + 2;
      w.mesh.material = hide ? this.wallFade : this.wallMat;
    }
    for (const p of this.tall) {
      const hide = p.y > y && p.y - p.r < y + 3.5 && Math.abs(p.x - x) < p.r + 1.5;
      for (const m of p.mats) {
        m.transparent = hide || (m as THREE.MeshLambertMaterial).opacity < 1;
        (m as THREE.MeshLambertMaterial).opacity = hide ? 0.3 : 1;
      }
    }
  }

  render(v: SfView, dt: number, t: number, me: [number, number], o: Draw3DOpts): void {
    this.sync(v, dt, t, o, false);
    this.drawVision(o.eye);
    for (const c of this.ceilings) c.visible = !!o.fp;
    if (o.fp) this.placeEyes(me[0], me[1], o.fp, dt);
    else {
      this.placeCamera(me[0], me[1], dt);
      this.fade(me[0], me[1]);
    }
    this.renderer.render(this.scene, this.camera);
    // Name tags over heads.
    const meP = v.players[v.me];
    for (const p of v.players) {
      const el = this.labels.get(p.id);
      if (!el || el.style.display === 'none') continue;
      const [x, y] = o.pos(p);
      const [sx, sy, front] = this.project(x, y, p.alive ? 1.5 : 1.75);
      const dist = Math.hypot(x - me[0], y - me[1]);
      if (!front || (o.fp && dist > 14)) {
        el.style.display = 'none';
        continue;
      }
      const s = o.fp ? Math.max(0.55, Math.min(1.3, 4 / Math.max(1, dist))) : 1;
      el.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -100%) scale(${s.toFixed(2)})`;
      el.className = `${p.impostor && meP?.impostor ? 'imp' : ''} ${p.alive ? '' : 'ghost'}`;
    }
  }

  /** A security camera's picture (no fog: cameras see everything in range). */
  renderCam(ctx: CanvasRenderingContext2D, W: number, H: number, v: SfView, t: number, cam: Spot, o: Draw3DOpts): void {
    if (!this.camRenderer) {
      this.camRenderer = new THREE.WebGLRenderer({ antialias: true });
      this.camRenderer.outputColorSpace = THREE.SRGBColorSpace;
    }
    const r = this.camRenderer;
    if (r.domElement.width !== W || r.domElement.height !== H) r.setSize(W, H, false);
    const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 200);
    camera.position.set(cam.x, 9, cam.y + 5);
    camera.lookAt(cam.x, 0, cam.y - 0.5);
    const saved = this.uniforms.uVis.value;
    this.uniforms.uVis.value = this.white;
    const vis = [...this.beans.values()].map((b) => b.root.visible);
    const bodyVis = [...this.bodies.values()].map((b) => b.visible);
    this.sync(v, 0, t, { ...o, eye: null, ghosts: false }, true);
    for (const w of this.walls) w.mesh.material = this.wallMat;
    const ceil = this.ceilings[0]?.visible ?? false;
    for (const c of this.ceilings) c.visible = false;
    r.render(this.scene, camera);
    for (const c of this.ceilings) c.visible = ceil;
    ctx.drawImage(r.domElement, 0, 0, W, H);
    [...this.beans.values()].forEach((b, i) => (b.root.visible = vis[i]!));
    [...this.bodies.values()].forEach((b, i) => (b.visible = bodyVis[i]!));
    this.uniforms.uVis.value = saved;
  }

  dispose(): void {
    this.canvas.parentElement?.removeEventListener('wheel', this.onWheel);
    this.renderer.dispose();
    this.camRenderer?.dispose();
    this.canvas.remove();
    this.labelLayer.remove();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
  }
}
