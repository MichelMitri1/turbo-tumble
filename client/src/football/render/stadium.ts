import * as THREE from 'three';
import { PITCH } from '../sim/match';
import type { Club } from '../sim/data';

/**
 * The ground: a mowed pitch with its markings, goals with nets, LED ad boards, two-tier
 * stands full of (animated) crowd, a roof and floodlights. All procedural.
 */

const { HL, HW } = PITCH;
const MARGIN = 7;
const PX = 18; // canvas pixels per metre

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

/** Grass with mowing stripes, wear in the goalmouths and the lines painted on. */
function pitchTexture(): THREE.CanvasTexture {
  const W = (HL + MARGIN) * 2;
  const H = (HW + MARGIN) * 2;
  const [c, g] = canvas(Math.round(W * PX), Math.round(H * PX));
  const X = (x: number) => (x + HL + MARGIN) * PX;
  const Y = (z: number) => (z + HW + MARGIN) * PX;
  g.fillStyle = '#2f7a2c';
  g.fillRect(0, 0, c.width, c.height);
  // Stripes across the pitch (alternating mower direction), 18 bands.
  const bands = 18;
  for (let i = 0; i < bands; i++) {
    const x0 = -HL + (i * HL * 2) / bands;
    g.fillStyle = i % 2 ? '#3a8c34' : '#2f7a2c';
    g.fillRect(X(x0), 0, ((HL * 2) / bands) * PX + 1, c.height);
  }
  // Grain: speckles of lighter and darker blades.
  const img = g.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  let s = 12345;
  const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * 22;
    d[i] = Math.max(0, d[i]! + n * 0.6);
    d[i + 1] = Math.max(0, d[i + 1]! + n);
    d[i + 2] = Math.max(0, d[i + 2]! + n * 0.4);
  }
  g.putImageData(img, 0, 0);
  // Worn goalmouths and centre.
  const wear = (x: number, z: number, r: number, a: number) => {
    const gr = g.createRadialGradient(X(x), Y(z), 0, X(x), Y(z), r * PX);
    gr.addColorStop(0, `rgba(120,105,60,${a})`);
    gr.addColorStop(1, 'rgba(120,105,60,0)');
    g.fillStyle = gr;
    g.fillRect(X(x) - r * PX, Y(z) - r * PX, r * PX * 2, r * PX * 2);
  };
  wear(-HL + 2.5, 0, 4, 0.35);
  wear(HL - 2.5, 0, 4, 0.35);
  wear(-HL + 11, 0, 1.5, 0.3);
  wear(HL - 11, 0, 1.5, 0.3);
  wear(0, 0, 1.6, 0.25);
  // Markings (12 cm).
  g.strokeStyle = 'rgba(245,248,240,0.92)';
  g.fillStyle = 'rgba(245,248,240,0.92)';
  g.lineWidth = 0.12 * PX;
  g.strokeRect(X(-HL), Y(-HW), HL * 2 * PX, HW * 2 * PX);
  g.beginPath();
  g.moveTo(X(0), Y(-HW));
  g.lineTo(X(0), Y(HW));
  g.stroke();
  g.beginPath();
  g.arc(X(0), Y(0), PITCH.CIRCLE * PX, 0, Math.PI * 2);
  g.stroke();
  const spot = (x: number, z: number, r = 0.12) => {
    g.beginPath();
    g.arc(X(x), Y(z), r * PX, 0, Math.PI * 2);
    g.fill();
  };
  spot(0, 0, 0.15);
  for (const e of [-1, 1]) {
    const gx = e * HL;
    // Penalty area, goal area, spot, arc.
    g.strokeRect(Math.min(X(gx), X(gx - e * PITCH.BOX_D)), Y(-PITCH.BOX_HW), PITCH.BOX_D * PX, PITCH.BOX_HW * 2 * PX);
    g.strokeRect(Math.min(X(gx), X(gx - e * PITCH.SIX_D)), Y(-PITCH.SIX_HW), PITCH.SIX_D * PX, PITCH.SIX_HW * 2 * PX);
    spot(gx - e * PITCH.SPOT, 0);
    const a = Math.acos((PITCH.BOX_D - PITCH.SPOT) / PITCH.CIRCLE);
    g.beginPath();
    if (e > 0) g.arc(X(gx - PITCH.SPOT), Y(0), PITCH.CIRCLE * PX, Math.PI - a, Math.PI + a);
    else g.arc(X(gx + PITCH.SPOT), Y(0), PITCH.CIRCLE * PX, -a, a);
    g.stroke();
    // Corner arcs.
    for (const zs of [-1, 1]) {
      g.beginPath();
      const cx = X(gx);
      const cy = Y(zs * HW);
      const start = e > 0 ? (zs > 0 ? Math.PI : Math.PI / 2) : zs > 0 ? -Math.PI / 2 : 0;
      g.arc(cx, cy, 1 * PX, start, start + Math.PI / 2);
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Spectators: rows of little people in mixed colours (with the home colours dominant). */
function crowdTexture(home: string, away: string, rows: number, seed: number): THREE.CanvasTexture {
  const cols = 64;
  const cw = 16;
  const rh = 22;
  const [c, g] = canvas(cols * cw, rows * rh);
  let s = seed;
  const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
  g.fillStyle = '#1b1e26';
  g.fillRect(0, 0, c.width, c.height);
  const misc = ['#d8d8d8', '#2a2a2a', '#3b5a8a', '#8a3b3b', '#c9b48a', '#5b6b4b', '#efefef', '#1d3d6d'];
  const skins = ['#f1c9a5', '#e0ac85', '#c68a5f', '#8d5a3b', '#5e3a24'];
  for (let r = 0; r < rows; r++) {
    // Seat row.
    g.fillStyle = '#2b303b';
    g.fillRect(0, r * rh + rh - 6, c.width, 6);
    for (let k = 0; k < cols; k++) {
      if (rnd() < 0.06) continue; // empty seat
      const x = k * cw + 3 + rnd() * 2;
      const y = r * rh + 4 + rnd() * 2;
      const pick = rnd();
      const shirt = pick < 0.55 ? home : pick < 0.68 ? away : misc[(rnd() * misc.length) | 0]!;
      g.fillStyle = shirt;
      g.fillRect(x - 1, y + 6, 12, 12);
      g.fillStyle = skins[(rnd() * skins.length) | 0]!;
      g.beginPath();
      g.arc(x + 5, y + 3.5, 3.6, 0, Math.PI * 2);
      g.fill();
      if (rnd() < 0.12) {
        // A scarf / flag held up.
        g.fillStyle = rnd() < 0.7 ? home : '#ffffff';
        g.fillRect(x - 3, y - 3, 16, 3);
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

const BRANDS = ['VOLTA', 'NORDKAP', 'Aurelia Air', 'KICKSTER', 'PRIMO COLA', 'Helix Bank', 'ZENTRO', 'Matchday 27', 'Orbit Mobile', 'LUMEN', 'STRIDE', 'Pampa Grill'];
function boardTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(4096, 64);
  const colors = [
    ['#0b2a6b', '#ffffff'],
    ['#d21f2b', '#ffffff'],
    ['#111111', '#f4c400'],
    ['#00845a', '#ffffff'],
    ['#ffffff', '#1a1a1a'],
    ['#5a1a8a', '#ffd84a'],
  ];
  const n = 16;
  const w = c.width / n;
  for (let i = 0; i < n; i++) {
    const [bg, fg] = colors[i % colors.length]!;
    g.fillStyle = bg!;
    g.fillRect(i * w, 0, w, 64);
    g.fillStyle = fg!;
    g.font = `bold 40px "Russo One", "Arial Black", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(BRANDS[i % BRANDS.length]!, i * w + w / 2, 34);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/** Net: a fine white mesh (alpha-tested grid). */
function netTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(64, 64);
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(64, 64);
  g.moveTo(64, 0);
  g.lineTo(0, 64);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export class Stadium {
  readonly group = new THREE.Group();
  private boards: THREE.CanvasTexture;
  private crowds: Array<{ mesh: THREE.Mesh; base: number; phase: number }> = [];
  private excitement = 0;
  /** Each goal's net (so a goal can ripple it). */
  readonly nets: THREE.Mesh[] = [];
  private netKick = [0, 0];

  constructor(home: Club, away: Club) {
    const g = this.group;
    // Pitch (with its surround).
    const pitch = new THREE.Mesh(new THREE.PlaneGeometry((HL + MARGIN) * 2, (HW + MARGIN) * 2), new THREE.MeshStandardMaterial({ map: pitchTexture(), roughness: 0.95, metalness: 0 }));
    pitch.rotation.x = -Math.PI / 2;
    pitch.receiveShadow = true;
    g.add(pitch);
    // Track around it (darker), out to the stands.
    const ring = new THREE.Mesh(new THREE.PlaneGeometry((HL + 30) * 2, (HW + 30) * 2), new THREE.MeshStandardMaterial({ color: '#28552a', roughness: 1 }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.02;
    ring.receiveShadow = true;
    g.add(ring);
    this.goals();
    // LED boards.
    this.boards = boardTexture();
    const boardMat = new THREE.MeshBasicMaterial({ map: this.boards, toneMapped: false });
    const board = (len: number, x: number, z: number, ry: number, rep: number) => {
      const tex = this.boards;
      const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.95, 0.15), [new THREE.MeshStandardMaterial({ color: '#111' }), new THREE.MeshStandardMaterial({ color: '#111' }), new THREE.MeshStandardMaterial({ color: '#111' }), new THREE.MeshStandardMaterial({ color: '#111' }), boardMat, new THREE.MeshStandardMaterial({ color: '#111' })]);
      void tex;
      void rep;
      m.position.set(x, 0.48, z);
      m.rotation.y = ry;
      m.castShadow = true;
      g.add(m);
    };
    board(HL * 2 + 6, 0, -HW - 4.2, 0, 4);
    board(HL * 2 + 6, 0, HW + 4.2, Math.PI, 4);
    for (const e of [-1, 1]) {
      board(HW - PITCH.GOAL_HW - 4, e * (HL + 5), -(HW + PITCH.GOAL_HW + 4) / 2, (e * -Math.PI) / 2, 1);
      board(HW - PITCH.GOAL_HW - 4, e * (HL + 5), (HW + PITCH.GOAL_HW + 4) / 2, (e * -Math.PI) / 2, 1);
    }
    this.stands(home, away);
    this.lights();
    // Dugouts and benches on the near side (the camera side, +z).
    for (const e of [-1, 1]) {
      const dug = new THREE.Mesh(new THREE.BoxGeometry(9, 2.2, 2.4), new THREE.MeshStandardMaterial({ color: '#c7ccd6', transparent: true, opacity: 0.35, roughness: 0.1 }));
      dug.position.set(e * 12, 1.1, HW + 5.6);
      g.add(dug);
      const seat = new THREE.Mesh(new THREE.BoxGeometry(8.6, 0.6, 1), new THREE.MeshStandardMaterial({ color: e < 0 ? home.home.shirt : away.home.shirt }));
      seat.position.set(e * 12, 0.4, HW + 6.2);
      g.add(seat);
    }
    // Corner flags.
    for (const x of [-HL, HL])
      for (const z of [-HW, HW]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.5), new THREE.MeshStandardMaterial({ color: '#f2f2f2' }));
        pole.position.set(x, 0.75, z);
        g.add(pole);
        const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.32), new THREE.MeshStandardMaterial({ color: '#f5d22a', side: THREE.DoubleSide }));
        flag.position.set(x + 0.23 * -Math.sign(x), 1.35, z);
        g.add(flag);
      }
  }

  private goals(): void {
    const white = new THREE.MeshStandardMaterial({ color: '#f4f4f4', roughness: 0.35 });
    const net = new THREE.MeshStandardMaterial({ map: netTexture(), alphaTest: 0.4, side: THREE.DoubleSide, color: '#ffffff', roughness: 1, transparent: false });
    const R = 0.06;
    const { GOAL_HW: GW, GOAL_H: GH, GOAL_D: GD } = PITCH;
    for (const e of [-1, 1]) {
      const goal = new THREE.Group();
      goal.position.x = e * HL;
      for (const z of [-GW, GW]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(R, R, GH + R, 12), white);
        post.position.set(0, (GH + R) / 2, z);
        post.castShadow = true;
        goal.add(post);
      }
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(R, R, GW * 2 + R * 2, 12), white);
      bar.rotation.x = Math.PI / 2;
      bar.position.y = GH;
      bar.castShadow = true;
      goal.add(bar);
      // Net: a box-ish shape sloping back (top at 1 m deep, bottom at the full depth).
      const geo = new THREE.BufferGeometry();
      const back = e * GD;
      const topBack = e * 1.0;
      const v = [
        // roof
        0, GH, -GW, topBack, GH - 0.2, -GW, topBack, GH - 0.2, GW, 0, GH, GW,
        // back
        topBack, GH - 0.2, -GW, back, 0, -GW, back, 0, GW, topBack, GH - 0.2, GW,
        // left side
        0, 0, -GW, back, 0, -GW, topBack, GH - 0.2, -GW, 0, GH, -GW,
        // right side
        0, 0, GW, back, 0, GW, topBack, GH - 0.2, GW, 0, GH, GW,
      ];
      const uv: number[] = [];
      const idx: number[] = [];
      for (let q = 0; q < 4; q++) {
        const sx = q < 2 ? GW * 2 * 5 : GD * 5;
        const sy = q === 0 ? 1.2 * 5 : GH * 5;
        uv.push(0, 0, sx, 0, sx, sy, 0, sy);
        idx.push(q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3);
      }
      geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const nm = new THREE.Mesh(geo, net);
      goal.add(nm);
      this.nets.push(nm);
      // Back stanchions.
      for (const z of [-GW, GW]) {
        const s = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.6), white);
        s.position.set(back * 0.75, 1.1, z);
        s.rotation.z = e * 0.45;
        goal.add(s);
      }
      this.group.add(goal);
    }
  }

  private stands(home: Club, away: Club): void {
    const g = this.group;
    const concrete = new THREE.MeshStandardMaterial({ color: '#5b5f68', roughness: 0.9 });
    const roofMat = new THREE.MeshStandardMaterial({ color: '#c9ccd2', roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide });
    // A stand: a sloped tier of crowd from (near) to (far), with a facia band.
    const tier = (len: number, depth: number, rise: number, y0: number, dist: number, rot: number, offset: number, seed: number) => {
      const rows = Math.round(depth / 0.8);
      const tex = crowdTexture(home.home.shirt, away.home.shirt, rows, seed);
      tex.repeat.set(len / 12, 1);
      const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1 });
      const slope = Math.hypot(depth, rise);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(len, slope), mat);
      const holder = new THREE.Group();
      holder.rotation.y = rot;
      m.rotation.x = -Math.atan2(rise, depth);
      m.position.set(offset, y0 + rise / 2, -(dist + depth / 2));
      holder.add(m);
      // Underneath (so it doesn't look hollow) and a facia.
      const under = new THREE.Mesh(new THREE.BoxGeometry(len, 0.4, slope), concrete);
      under.rotation.x = m.rotation.x;
      under.position.set(offset, y0 + rise / 2 - 0.35, -(dist + depth / 2) - 0.1);
      holder.add(under);
      const facia = new THREE.Mesh(new THREE.BoxGeometry(len, 1.2, 0.3), new THREE.MeshStandardMaterial({ color: home.badge.c1, roughness: 0.7 }));
      facia.position.set(offset, y0 + 0.2, -dist + 0.1);
      holder.add(facia);
      g.add(holder);
      this.crowds.push({ mesh: m, base: m.position.y, phase: seed * 0.37 });
    };
    // Sides (long stands) and ends: lower and upper tier, then a roof.
    const sides: Array<[number, number, number]> = [
      [HL * 2 + 16, HW + 9, 0], // far side (−z): stand faces +z → rot 0
      [HL * 2 + 16, HW + 9, Math.PI], // near side
      [HW * 2 + 14, HL + 9, Math.PI / 2],
      [HW * 2 + 14, HL + 9, -Math.PI / 2],
    ];
    sides.forEach(([len, dist, rot], i) => {
      tier(len, 16, 9, 0.6, dist, rot, 0, 11 + i);
      tier(len, 16, 11, 12.6, dist + 17, rot, 0, 21 + i);
      // Back wall and roof.
      const holder = new THREE.Group();
      holder.rotation.y = rot;
      // Executive boxes between the tiers: a band of lit glass.
      const boxes = new THREE.Mesh(new THREE.BoxGeometry(len, 3.4, 1.2), [concrete, concrete, concrete, concrete, new THREE.MeshStandardMaterial({ map: this.boxTexture(), emissive: '#ffffff', emissiveMap: this.boxTexture(), emissiveIntensity: 0.55, roughness: 0.3 }), concrete]);
      boxes.position.set(0, 11.2, -(dist + 16.6));
      holder.add(boxes);
      const wall = new THREE.Mesh(new THREE.BoxGeometry(len + 4, 26, 1), concrete);
      wall.position.set(0, 13, -(dist + 35));
      holder.add(wall);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(len + 4, 0.6, 30), roofMat);
      roof.position.set(0, 30, -(dist + 22));
      roof.rotation.x = -0.08;
      holder.add(roof);
      // A strip of floodlights along the roof edge.
      const strip = new THREE.Mesh(new THREE.BoxGeometry(len * 0.9, 0.5, 0.6), new THREE.MeshBasicMaterial({ color: '#fffbe8' }));
      strip.position.set(0, 29.2, -(dist + 7.4));
      holder.add(strip);
      this.group.add(holder);
    });
    // Corners: fill the gaps between stands with dark blocks.
    for (const x of [-1, 1])
      for (const z of [-1, 1]) {
        const c = new THREE.Mesh(new THREE.BoxGeometry(34, 26, 34), concrete);
        c.position.set(x * (HL + 26), 13, z * (HW + 26));
        g.add(c);
      }
  }

  private boxTex: THREE.CanvasTexture | null = null;
  /** Hospitality boxes: lit windows with mullions. */
  private boxTexture(): THREE.CanvasTexture {
    if (this.boxTex) return this.boxTex;
    const [c, g] = canvas(1024, 32);
    g.fillStyle = '#1a2230';
    g.fillRect(0, 0, 1024, 32);
    for (let x = 0; x < 1024; x += 16) {
      const warm = Math.random();
      g.fillStyle = warm < 0.7 ? '#ffe2a8' : warm < 0.9 ? '#cfe3ff' : '#4a5468';
      g.fillRect(x + 2, 6, 12, 20);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.repeat.set(6, 1);
    this.boxTex = t;
    return t;
  }

  private lights(): void {
    // Corner pylons (glow sprites); the lighting itself comes from the scene's lights.
    const glow = new THREE.SpriteMaterial({ color: '#fff6d8', transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
    for (const x of [-1, 1])
      for (const z of [-1, 1]) {
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 46), new THREE.MeshStandardMaterial({ color: '#9aa0aa' }));
        mast.position.set(x * (HL + 32), 23, z * (HW + 32));
        this.group.add(mast);
        const panel = new THREE.Mesh(new THREE.BoxGeometry(8, 5, 0.6), new THREE.MeshBasicMaterial({ color: '#fffbe8' }));
        panel.position.set(x * (HL + 31), 47, z * (HW + 31));
        panel.lookAt(0, 0, 0);
        this.group.add(panel);
        const s = new THREE.Sprite(glow);
        s.scale.set(22, 22, 1);
        s.position.copy(panel.position);
        this.group.add(s);
      }
  }

  /** Crowd bounce (more when it's exciting), scrolling LED boards, net ripple. */
  update(dt: number, time: number, excitement: number): void {
    this.excitement += (excitement - this.excitement) * Math.min(1, dt * 2);
    const ex = this.excitement;
    for (const c of this.crowds) {
      const amp = 0.04 + ex * 0.22;
      c.mesh.position.y = c.base + Math.abs(Math.sin(time * (5 + ex * 4) + c.phase)) * amp;
      (c.mesh.material as THREE.MeshStandardMaterial).map!.offset.y = Math.sin(time * 9 + c.phase) * 0.004 * (0.3 + ex);
    }
    this.boards.offset.x = (time * 0.012) % 1;
    for (let i = 0; i < 2; i++) {
      this.netKick[i]! *= Math.exp(-dt * 3);
      const n = this.nets[i]!;
      n.scale.x = 1 + this.netKick[i]! * 0.25 * Math.sin(time * 30);
    }
  }

  /** The ball hit the back of the net at this end (−1 / 1). */
  bulge(end: number): void {
    this.netKick[end < 0 ? 0 : 1] = 1;
  }
}
