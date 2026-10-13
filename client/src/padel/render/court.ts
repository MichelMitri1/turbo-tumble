import * as THREE from 'three';
import { COURT, PANELS, netHeight } from '../sim/court';

/**
 * The court in 3D, to FIP measurements: sand-filled turf in the court's colour, 5 cm white lines,
 * 12 mm glass in 2 m panels on black steel posts, welded mesh above the glass and down the sides,
 * the net, and floodlights. Each court comes with its own setting (indoor club, sunset, night…).
 */
export interface CourtTheme {
  id: string;
  name: string;
  turf: string;
  /** The run-off around the cage. */
  apron: string;
  steel: string;
  sky: [string, string];
  /** Light: sun / floodlights intensity and colour, ambient. */
  sun: number;
  sunColor: string;
  ambient: number;
  indoor: boolean;
  accent: string;
}

export const COURTS: CourtTheme[] = [
  { id: 'blue', name: 'Classic Blue', turf: '#2b64c4', apron: '#1c3f7d', steel: '#15181d', sky: ['#0b1424', '#1f3a66'], sun: 2.4, sunColor: '#ffffff', ambient: 0.55, indoor: true, accent: '#3d8bff' },
  { id: 'red', name: 'Terracotta', turf: '#b9472f', apron: '#7d2f1f', steel: '#1b1714', sky: ['#ff9a5a', '#4a2a5e'], sun: 2.6, sunColor: '#ffd2a8', ambient: 0.5, indoor: false, accent: '#ff7a45' },
  { id: 'grey', name: 'Urban Grey', turf: '#6c737c', apron: '#3c4148', steel: '#0f1114', sky: ['#05070c', '#1d2533'], sun: 2.2, sunColor: '#e9f1ff', ambient: 0.45, indoor: false, accent: '#9fb3c8' },
  { id: 'green', name: 'Club Green', turf: '#2f8c45', apron: '#20602f', steel: '#1a1d1a', sky: ['#8fd3ff', '#e8f6ff'], sun: 2.9, sunColor: '#fff6e0', ambient: 0.65, indoor: false, accent: '#7be08f' },
  { id: 'black', name: 'Black Panoramic', turf: '#1d2025', apron: '#101215', steel: '#0a0a0b', sky: ['#020203', '#121216'], sun: 2.6, sunColor: '#ffffff', ambient: 0.4, indoor: true, accent: '#f2c94c' },
  { id: 'purple', name: 'Neon Violet', turf: '#5a3bc8', apron: '#33207a', steel: '#120c22', sky: ['#120530', '#3a0f5c'], sun: 2.3, sunColor: '#f2e6ff', ambient: 0.5, indoor: true, accent: '#ff3ec8' },
];
export const COURT_BY_ID = Object.fromEntries(COURTS.map((c) => [c.id, c])) as Record<string, CourtTheme>;

/** Turf: fibre noise, sand speckle and the faint lay of the rows. */
function turfTexture(color: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = color;
  g.fillRect(0, 0, 512, 512);
  const base = new THREE.Color(color);
  for (let i = 0; i < 26000; i++) {
    const k = 0.82 + Math.random() * 0.3;
    g.fillStyle = `rgb(${(base.r * 255 * k) | 0},${(base.g * 255 * k) | 0},${(base.b * 255 * k) | 0})`;
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    g.fillRect(x, y, 1, 2 + Math.random() * 3);
  }
  // Sand.
  for (let i = 0; i < 5000; i++) {
    g.fillStyle = `rgba(230,214,170,${0.08 + Math.random() * 0.12})`;
    g.fillRect(Math.random() * 512, Math.random() * 512, 1.2, 1.2);
  }
  // Rows of the carpet.
  for (let y = 0; y < 512; y += 16) {
    g.fillStyle = 'rgba(0,0,0,0.035)';
    g.fillRect(0, y, 512, 8);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Welded mesh (5 × 5 cm squares) — alpha only. */
function meshTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 64, 64);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, 61, 61);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Net: knotted square mesh, alpha only. */
function netTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  g.strokeStyle = '#ffffff';
  g.lineWidth = 2;
  g.strokeRect(1, 1, 30, 30);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export class CourtView {
  readonly group = new THREE.Group();
  readonly lights: THREE.Light[] = [];
  private readonly netMesh: THREE.Mesh;
  private netShake = 0;
  /** Glass panels by key, for the flash when the ball hits one. */
  private readonly glass: THREE.Mesh[] = [];
  /** The steel and mesh of each back wall (index 0: z < 0), hidden at the camera's end so they don't block the view. */
  private readonly ends: [THREE.Object3D[], THREE.Object3D[]] = [[], []];

  constructor(readonly theme: CourtTheme) {
    const g = this.group;
    const W = COURT.halfW;
    const L = COURT.halfL;
    // Turf (court) and run-off.
    const turf = turfTexture(theme.turf);
    turf.repeat.set(5, 10);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, L * 2), new THREE.MeshStandardMaterial({ map: turf, roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    g.add(floor);
    const apronTex = turfTexture(theme.apron);
    apronTex.repeat.set(16, 20);
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(36, 44), new THREE.MeshStandardMaterial({ map: apronTex, roughness: 1 }));
    apron.rotation.x = -Math.PI / 2;
    apron.position.y = -0.02;
    apron.receiveShadow = true;
    g.add(apron);
    // Lines: the service lines and the centre line (it runs 20 cm past each service line).
    const lineMat = new THREE.MeshBasicMaterial({ color: '#f4f6f8' });
    const line = (w: number, l: number, x: number, z: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), lineMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, 0.003, z);
      g.add(m);
    };
    for (const s of [-1, 1]) line(W * 2, 0.05, 0, s * COURT.serviceLine);
    line(0.05, (COURT.serviceLine + 0.2) * 2, 0, 0);
    // Walls: glass panels, mesh, posts.
    const steel = new THREE.MeshStandardMaterial({ color: theme.steel, roughness: 0.45, metalness: 0.6 });
    const glassMat = new THREE.MeshPhysicalMaterial({ color: '#dfeff2', transparent: true, opacity: 0.1, roughness: 0.04, metalness: 0, clearcoat: 1, side: THREE.DoubleSide, depthWrite: false });
    const meshTex = meshTexture();
    for (const p of PANELS) {
      const len = p.to - p.from;
      const h = p.y1 - p.y0;
      if (p.mat === 'glass') {
        // 2 m panels.
        const n = Math.max(1, Math.round(len / 2));
        for (let k = 0; k < n; k++) {
          const a = p.from + (len / n) * k;
          const m = new THREE.Mesh(new THREE.BoxGeometry(p.axis === 'x' ? 0.012 : len / n - 0.02, h, p.axis === 'x' ? len / n - 0.02 : 0.012), glassMat.clone());
          const mid = a + len / n / 2;
          m.position.set(p.axis === 'x' ? p.at : mid, p.y0 + h / 2, p.axis === 'x' ? mid : p.at);
          m.renderOrder = 2;
          g.add(m);
          this.glass.push(m);
        }
      } else {
        const tex = meshTex.clone();
        tex.needsUpdate = true;
        tex.repeat.set(len / 0.05, h / 0.05);
        const m = new THREE.Mesh(new THREE.PlaneGeometry(len, h), new THREE.MeshStandardMaterial({ color: theme.steel, alphaMap: tex, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.5 }));
        m.position.set(p.axis === 'x' ? p.at : (p.from + p.to) / 2, p.y0 + h / 2, p.axis === 'x' ? (p.from + p.to) / 2 : p.at);
        if (p.axis === 'x') m.rotation.y = Math.PI / 2;
        else this.ends[p.at < 0 ? 0 : 1].push(m);
        g.add(m);
      }
    }
    // Posts every 2 m round the cage (4 m tall at the ends, stepping down the sides), and top rails.
    const post = (x: number, z: number, h: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.08, h, 0.08), steel);
      m.position.set(x, h / 2, z);
      m.castShadow = true;
      g.add(m);
      if (Math.abs(z) > L - 0.01) this.ends[z < 0 ? 0 : 1].push(m);
    };
    for (let x = -W; x <= W + 0.01; x += 2) for (const s of [-1, 1]) post(x, s * L, 4);
    for (const sx of [-1, 1])
      for (let z = -L + 2; z <= L - 2 + 0.01; z += 2) {
        const az = Math.abs(z);
        post(sx * W, z, az > 7.99 ? 4 : az > 5.99 ? 3 : 3);
      }
    const rail = (x0: number, z0: number, x1: number, z1: number, y: number) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, len), steel);
      m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
      m.rotation.y = Math.atan2(x1 - x0, z1 - z0);
      g.add(m);
      if (Math.abs(z0) > L - 0.01 && Math.abs(z1) > L - 0.01) this.ends[z0 < 0 ? 0 : 1].push(m);
    };
    for (const s of [-1, 1]) {
      rail(-W, s * L, W, s * L, 4);
      rail(-W, s * L, W, s * L, 3);
      for (const sx of [-1, 1]) {
        rail(sx * W, s * L, sx * W, s * 8, 4);
        rail(sx * W, s * 8, sx * W, s * 6, 3);
        rail(sx * W, s * 6, sx * W, 0, 3);
      }
    }
    // Net: posts, mesh, white band on top (sagging 4 cm to the middle).
    for (const sx of [-1, 1]) post(sx * (W - 0.02), 0, COURT.netPost + 0.04);
    const netGeo = new THREE.PlaneGeometry(W * 2, 1, 40, 1);
    const pos = netGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const top = pos.getY(i) > 0;
      pos.setY(i, top ? netHeight(x) : 0.0);
    }
    netGeo.computeVertexNormals();
    const nt = netTexture();
    nt.repeat.set((W * 2) / 0.045, 1 / 0.045);
    this.netMesh = new THREE.Mesh(netGeo, new THREE.MeshStandardMaterial({ color: '#1a1a1a', alphaMap: nt, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide }));
    g.add(this.netMesh);
    const bandGeo = new THREE.BufferGeometry();
    const bp: number[] = [];
    for (let k = 0; k <= 40; k++) {
      const x = -W + (W * 2 * k) / 40;
      const y = netHeight(x);
      bp.push(x, y, 0, x, y - 0.05, 0);
    }
    const idx: number[] = [];
    for (let k = 0; k < 40; k++) idx.push(k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 1, k * 2 + 3, k * 2 + 2);
    bandGeo.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3));
    bandGeo.setIndex(idx);
    bandGeo.computeVertexNormals();
    g.add(new THREE.Mesh(bandGeo, new THREE.MeshStandardMaterial({ color: '#f2f2f2', side: THREE.DoubleSide })));
    this.surroundings(theme);
    this.lighting(theme);
  }

  /** Floodlight poles at the corners, and the setting (club hall or outdoors). */
  private surroundings(t: CourtTheme): void {
    const g = this.group;
    const pole = new THREE.MeshStandardMaterial({ color: '#2a2d33', metalness: 0.6, roughness: 0.4 });
    const lamp = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 2 });
    for (const sx of [-1, 1])
      for (const sz of [-1, 0.0001, 1]) {
        const x = sx * (COURT.halfW + 0.6);
        const z = Math.sign(sz) * (Math.abs(sz) > 0.5 ? COURT.halfL - 3 : 0) + (Math.abs(sz) < 0.5 ? 0 : 0);
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 6.5, 8), pole);
        m.position.set(x, 3.25, z);
        g.add(m);
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.8), lamp);
        head.position.set(x - sx * 0.25, 6.4, z);
        head.rotation.z = sx * 0.5;
        g.add(head);
      }
    if (t.indoor) {
      // A club hall: dark walls and a ceiling with light panels.
      const hall = new THREE.Mesh(new THREE.BoxGeometry(30, 12, 40), new THREE.MeshStandardMaterial({ color: new THREE.Color(t.sky[0]).lerp(new THREE.Color('#2a2f38'), 0.5), side: THREE.BackSide, roughness: 0.9 }));
      hall.position.y = 5.9; // floor 10 cm under the court (no z-fighting)
      g.add(hall);
      const strip = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: t.accent, emissiveIntensity: 1.2 });
      for (const sx of [-1, 1]) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 38), strip);
        m.position.set(sx * 14.8, 4, 0);
        g.add(m);
      }
      for (let z = -15; z <= 15; z += 6) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(8, 0.08, 1.2), lamp);
        m.position.set(0, 11.9, z);
        g.add(m);
      }
    } else {
      // Outdoors: a low wall, some trees, the sky.
      const wall = new THREE.Mesh(new THREE.BoxGeometry(34, 1.2, 0.3), new THREE.MeshStandardMaterial({ color: '#d9d2c4', roughness: 0.9 }));
      for (const s of [-1, 1]) {
        const w = wall.clone();
        w.position.set(0, 0.6, s * 21);
        g.add(w);
      }
      const leaf = new THREE.MeshStandardMaterial({ color: t.id === 'red' ? '#5d6b2c' : '#3e7a3a', roughness: 1 });
      const trunk = new THREE.MeshStandardMaterial({ color: '#5a4030', roughness: 1 });
      let seed = 7;
      const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < 22; i++) {
        const side = i % 2 ? 1 : -1;
        const x = side * (11 + r() * 6);
        const z = -18 + r() * 36;
        const h = 3 + r() * 4;
        const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, h, 6), trunk);
        tr.position.set(x, h / 2, z);
        g.add(tr);
        const top = new THREE.Mesh(new THREE.IcosahedronGeometry(1.4 + r() * 1.2, 0), leaf);
        top.position.set(x, h + 0.8, z);
        g.add(top);
      }
    }
  }

  private lighting(t: CourtTheme): void {
    const hemi = new THREE.HemisphereLight(new THREE.Color(t.sky[1]).lerp(new THREE.Color('#ffffff'), 0.5), new THREE.Color(t.apron), t.ambient);
    const sun = new THREE.DirectionalLight(t.sunColor, t.sun);
    sun.position.set(6, 14, -8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const cam = sun.shadow.camera as THREE.OrthographicCamera;
    cam.left = -9;
    cam.right = 9;
    cam.top = 13;
    cam.bottom = -13;
    cam.near = 1;
    cam.far = 40;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    const fill = new THREE.DirectionalLight('#ffffff', 0.6);
    fill.position.set(-6, 10, 10);
    this.lights.push(hemi, sun, fill);
    for (const l of this.lights) this.group.add(l);
  }

  /** Which end the camera is at (team 0 = z < 0): that back wall's frame and fence are hidden. */
  setCameraEnd(team: 0 | 1): void {
    this.ends.forEach((list, i) => list.forEach((o) => (o.visible = i !== team)));
  }

  /** The ball clipped the net: shake it. */
  shakeNet(amount: number): void {
    this.netShake = Math.max(this.netShake, amount);
  }

  /** A glass panel took a hit: a quick glint. */
  flashGlass(x: number, y: number, z: number): void {
    let best: THREE.Mesh | null = null;
    let bd = Infinity;
    for (const m of this.glass) {
      const d = m.position.distanceToSquared(new THREE.Vector3(x, y, z));
      if (d < bd) {
        bd = d;
        best = m;
      }
    }
    if (best) (best.material as THREE.MeshPhysicalMaterial).opacity = 0.45;
  }

  update(dt: number): void {
    if (this.netShake > 0) {
      this.netShake = Math.max(0, this.netShake - dt * 3);
      this.netMesh.position.z = Math.sin(performance.now() / 25) * 0.03 * this.netShake;
    }
    for (const m of this.glass) {
      const mat = m.material as THREE.MeshPhysicalMaterial;
      if (mat.opacity > 0.1) mat.opacity = Math.max(0.1, mat.opacity - dt * 1.5);
    }
  }
}
