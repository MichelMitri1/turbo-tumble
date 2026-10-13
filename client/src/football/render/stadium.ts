import * as THREE from 'three';
import { GOAL_NET, PITCH } from '../sim/match';
import type { Club } from '../sim/data';
import { deformNet, type NetImpact } from './net';
import { netPockets } from '../sim/net';

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

/** Drawn once per page (it's pixel-by-pixel work): every view gets its own texture over the same picture. */
let pitchTextureCache: THREE.CanvasTexture | null = null;
function pitchTexture(): THREE.CanvasTexture {
  pitchTextureCache ??= drawPitchTexture();
  const t = pitchTextureCache.clone();
  t.needsUpdate = true;
  return t;
}

/** Drawn once per page (it's pixel-by-pixel work): every view gets its own texture over the same picture. */
let grassDetailCache: THREE.CanvasTexture | null = null;
function grassDetail(): THREE.CanvasTexture {
  grassDetailCache ??= drawGrassDetail();
  const t = grassDetailCache.clone();
  t.needsUpdate = true;
  return t;
}

/** Grass with mowing stripes, wear in the goalmouths and the lines painted on. */
function drawPitchTexture(): THREE.CanvasTexture {
  const W = (HL + MARGIN) * 2;
  const H = (HW + MARGIN) * 2;
  const [c, g] = canvas(Math.round(W * PX), Math.round(H * PX));
  const X = (x: number) => (x + HL + MARGIN) * PX;
  const Y = (z: number) => (z + HW + MARGIN) * PX;
  g.fillStyle = '#31612a';
  g.fillRect(0, 0, c.width, c.height);
  // Stripes across the pitch (alternating mower direction), 18 bands.
  const bands = 18;
  for (let i = 0; i < bands; i++) {
    const x0 = -HL + (i * HL * 2) / bands;
    g.fillStyle = i % 2 ? '#3f7732' : '#33652a';
    g.fillRect(X(x0), 0, ((HL * 2) / bands) * PX + 1, c.height);
  }
  // Grain: speckles of lighter and darker blades.
  const img = g.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  let s = 12345;
  const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * 16;
    d[i] = Math.max(0, d[i]! + n * 0.6);
    d[i + 1] = Math.max(0, d[i + 1]! + n);
    d[i + 2] = Math.max(0, d[i + 2]! + n * 0.4);
  }
  g.putImageData(img, 0, 0);
  // Worn goalmouths and centre.
  const wear = (x: number, z: number, r: number, a: number) => {
    const gr = g.createRadialGradient(X(x), Y(z), 0, X(x), Y(z), r * PX);
    gr.addColorStop(0, `rgba(92,98,52,${a * 0.75})`);
    gr.addColorStop(1, 'rgba(92,98,52,0)');
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

/** Close-up grass: blades and clumps in a tileable grey (multiplied over the pitch colour). */
function drawGrassDetail(): THREE.CanvasTexture {
  const S = 256;
  const [c, g] = canvas(S, S);
  g.fillStyle = 'rgb(128,128,128)';
  g.fillRect(0, 0, S, S);
  let s = 777;
  const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
  for (let i = 0; i < 9000; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const v = 90 + rnd() * 80;
    g.strokeStyle = `rgba(${v},${v},${v},0.55)`;
    g.lineWidth = 0.8 + rnd();
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (rnd() - 0.5) * 3, y - 2 - rnd() * 4);
    g.stroke();
    // Tile seamlessly: wrap the strokes that hang off an edge.
    if (x < 4 || y < 6) {
      g.beginPath();
      g.moveTo(x + (x < 4 ? S : 0), y + (y < 6 ? S : 0));
      g.lineTo(x + (x < 4 ? S : 0) + 1, y + (y < 6 ? S : 0) - 4);
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** The pitch: painted texture + blade detail up close + mowing stripes that shine or darken with the view angle. */
function pitchMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ map: pitchTexture(), roughness: 0.92, metalness: 0, envMapIntensity: 0.25 });
  const detail = grassDetail();
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uDetail = { value: detail };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGrassW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGrassW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGrassW;\nuniform sampler2D uDetail;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          float d1 = texture2D(uDetail, vGrassW.xz * 0.55).r;
          float d2 = texture2D(uDetail, vGrassW.xz * 0.11 + 0.37).r;
          diffuseColor.rgb *= 0.8 + 0.42 * (d1 * 0.6 + d2 * 0.4);
          // Mown stripes: grass laid one way catches the light from one end, the other way from the other.
          if (abs(vGrassW.x) < ${HL.toFixed(1)} && abs(vGrassW.z) < ${HW.toFixed(1)}) {
            float band = mod(floor((vGrassW.x + ${HL.toFixed(1)}) / ${((HL * 2) / 18).toFixed(4)}), 2.0) * 2.0 - 1.0;
            vec3 vd = normalize(cameraPosition - vGrassW);
            diffuseColor.rgb *= 1.0 + band * vd.x * 0.16;
          }
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'grass';
  return mat;
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

export class Stadium {
  readonly group = new THREE.Group();
  private boards: THREE.CanvasTexture;
  private crowds: Array<{ mesh: THREE.Mesh; base: number; phase: number }> = [];
  private excitement = 0;
  /** Each goal's net (so a goal can ripple it). */
  readonly nets: THREE.Mesh[] = [];
  private netState: Array<{ base: Float32Array; out: Float32Array; pin: Float32Array; impacts: NetImpact[] }> = [];
  /** Replay impacts replace live detection, allowing exact sampling while seeking backwards. */
  netReplay: Array<{ end: number; impact: NetImpact }> | null = null;
  private flashes: THREE.Points | null = null;
  private ribbonMat: THREE.MeshBasicMaterial | null = null;
  private goalTex: THREE.CanvasTexture | null = null;
  private goalFlashT = 0;
  private pyro = new Pyro();
  /** The main stand behind the broadcast camera (hidden while the camera is in it). */
  readonly nearStand = new THREE.Group();

  constructor(home: Club, away: Club) {
    const g = this.group;
    // Pitch (with its surround).
    const pitch = new THREE.Mesh(new THREE.PlaneGeometry((HL + MARGIN) * 2, (HW + MARGIN) * 2), pitchMaterial());
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
      g.add(m);
    };
    board(HL * 2 + 6, 0, -HW - 4.2, 0, 4);
    board(HL * 2 + 6, 0, HW + 4.2, Math.PI, 4);
    for (const e of [-1, 1]) {
      board(HW - PITCH.GOAL_HW - 4, e * (HL + 5), -(HW + PITCH.GOAL_HW + 4) / 2, (e * -Math.PI) / 2, 1);
      board(HW - PITCH.GOAL_HW - 4, e * (HL + 5), (HW + PITCH.GOAL_HW + 4) / 2, (e * -Math.PI) / 2, 1);
    }
    this.group.add(this.nearStand);
    this.stands(home, away);
    this.lights();
    this.sky();
    this.crowdFlashes();
    this.group.add(this.pyro.points);
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
    const white = new THREE.MeshStandardMaterial({ color: '#f7f7f7', roughness: 0.25, metalness: 0.1 });
    // The cloth surface carries the deformation; only individual cords are rendered.
    const netMat = new THREE.MeshBasicMaterial({ visible: false });
    const cordMat = new THREE.LineBasicMaterial({ color: '#eef2ff', transparent: true, opacity: 0.86, depthWrite: false });
    const R = 0.06;
    const { GOAL_HW: GW, GOAL_H: GH, GOAL_D: GD } = PITCH;
    for (const e of [-1, 1]) {
      const goal = new THREE.Group();
      goal.name = e < 0 ? 'goal-left' : 'goal-right';
      goal.position.x = e * HL;
      for (const z of [-GW, GW]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(R, R, GH + R, 16), white);
        post.name = 'round-post';
        post.position.set(0, (GH + R) / 2, z);
        post.castShadow = true;
        goal.add(post);
      }
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(R, R, GW * 2 + R * 2, 16), white);
      bar.name = 'round-crossbar';
      bar.rotation.x = Math.PI / 2;
      bar.position.y = GH;
      bar.castShadow = true;
      goal.add(bar);
      // Net: four patches (roof, back, two sides) as fine grids so a shot can stretch them.
      const back = e * GD;
      const topBack = back;
      const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
      // [corner00, corner10, corner11, corner01, outward normal, segs u, segs v, texture size u, v]
      const patches: Array<[THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3, number, number, number, number]> = [
        [V(0, GH, -GW), V(0, GH, GW), V(topBack, GH, GW), V(topBack, GH, -GW), V(0, 1, 0), 66, 20, GW * 2, GD],
        [V(back, 0, -GW), V(back, 0, GW), V(topBack, GH, GW), V(topBack, GH, -GW), V(e, 0, 0), 66, 20, GW * 2, GH],
        [V(0, 0, -GW), V(back, 0, -GW), V(topBack, GH, -GW), V(0, GH, -GW), V(0, 0, -1), 20, 20, GD, GH],
        [V(0, 0, GW), V(back, 0, GW), V(topBack, GH, GW), V(0, GH, GW), V(0, 0, 1), 20, 20, GD, GH],
      ];
      const pos: number[] = [];
      const uv: number[] = [];
      const nrm: number[] = [];
      const pin: number[] = [];
      const idx: number[] = [];
      const cords: number[] = [];
      const p = new THREE.Vector3();
      for (const [a, b, c, d, n, nu, nv, su, sv] of patches) {
        const base = pos.length / 3;
        for (let j = 0; j <= nv; j++)
          for (let i = 0; i <= nu; i++) {
            const u = i / nu;
            const v = j / nv;
            p.copy(a).multiplyScalar((1 - u) * (1 - v)).addScaledVector(b, u * (1 - v)).addScaledVector(c, u * v).addScaledVector(d, (1 - u) * v);
            pos.push(p.x, p.y, p.z);
            uv.push(u * su * 6, v * sv * 6);
            nrm.push(n.x, n.y, n.z);
            // Tied to the frame along the edges: only the middle of each patch can stretch.
            pin.push(Math.sqrt(Math.max(0, Math.sin(Math.PI * u) * Math.sin(Math.PI * v))));
            const q = base + j * (nu + 1) + i;
            if (i < nu) cords.push(q, q + 1);
            if (j < nv) cords.push(q, q + nu + 1);
          }
        for (let j = 0; j < nv; j++)
          for (let i = 0; i < nu; i++) {
            const q = base + j * (nu + 1) + i;
            idx.push(q, q + 1, q + nu + 2, q, q + nu + 2, q + nu + 1);
          }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const nm = new THREE.Mesh(geo, netMat);
      nm.name = 'silk-net';
      geo.computeBoundingSphere();
      geo.boundingSphere!.radius += 1.2;
      goal.add(nm);
      this.nets.push(nm);
      const cordGeometry = new THREE.BufferGeometry();
      cordGeometry.setAttribute('position', geo.getAttribute('position'));
      cordGeometry.setIndex(cords);
      cordGeometry.computeBoundingSphere(); cordGeometry.boundingSphere!.radius += 1.2;
      const strands = new THREE.LineSegments(cordGeometry, cordMat);
      strands.name = 'woven-goal-net'; goal.add(strands);
      this.netState.push({ base: Float32Array.from(pos), out: Float32Array.from(nrm), pin: Float32Array.from(pin), impacts: [] });
      // A box frame: vertical rear supports and flat roof rails, all round tubing.
      for (const z of [-GW, GW]) {
        const st = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, GH, 10), white);
        st.position.set(back, GH / 2, z);
        goal.add(st);
        const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, GD, 10), white);
        rail.rotation.z = Math.PI / 2; rail.position.set(back / 2, GH, z); goal.add(rail);
      }
      const rear = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, GW * 2, 10), white);
      rear.rotation.x = Math.PI / 2; rear.position.set(back, GH, 0); goal.add(rear);
      this.group.add(goal);
    }
  }

  private stands(home: Club, away: Club): void {
    const g = this.group;
    const concrete = new THREE.MeshStandardMaterial({ color: '#5b5f68', roughness: 0.9 });
    const roofMat = new THREE.MeshStandardMaterial({ color: '#c9ccd2', roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide });
    // A stand: a sloped tier of crowd from (near) to (far), with a facia band.
    const tier = (len: number, depth: number, rise: number, y0: number, dist: number, rot: number, offset: number, seed: number, parent: THREE.Object3D = g) => {
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
      const facia = new THREE.Mesh(new THREE.BoxGeometry(len, 1.2, 0.3), new THREE.MeshStandardMaterial({ color: '#15171c', roughness: 0.7 }));
      facia.position.set(offset, y0 + 0.2, -dist + 0.1);
      holder.add(facia);
      // 360° LED ribbon along the front of the tier.
      const rg = new THREE.PlaneGeometry(len, 1.0);
      const ruv = rg.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < ruv.count; i++) ruv.setX(i, ruv.getX(i) * (len / 30) + seed * 0.13);
      const ribbon = new THREE.Mesh(rg, this.ribbon());
      ribbon.position.set(offset, y0 + 0.2, -dist + 0.26);
      holder.add(ribbon);
      parent.add(holder);
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
      // The near (camera-side) stand lives in its own group: the broadcast camera sits where it is.
      const parent = i === 1 ? this.nearStand : g;
      tier(len, 16, 9, 0.6, dist, rot, 0, 11 + i, parent);
      tier(len, 16, 11, 12.6, dist + 17, rot, 0, 21 + i, parent);
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
      parent.add(holder);
    });
    // Corners: fill the gaps between stands with dark blocks.
    for (const x of [-1, 1])
      for (const z of [-1, 1]) {
        const c = new THREE.Mesh(new THREE.BoxGeometry(34, 26, 34), new THREE.MeshStandardMaterial({ color: '#191c23', roughness: 0.9 }));
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
    // Corner pylons: HDR-bright panels (they bloom), a glow, an anamorphic streak and a beam of light through the haze.
    const glowTex = radialTexture('rgba(255,246,220,1)', 'rgba(255,240,200,0)');
    const glow = new THREE.SpriteMaterial({ map: glowTex, color: '#fff6d8', transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending });
    const streak = new THREE.SpriteMaterial({ map: glowTex, color: '#bcd6ff', transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending });
    const beamMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color('#fff1d6') } },
      vertexShader: `varying float vAlong; varying vec3 vN; varying vec3 vV;
        void main() {
          vAlong = uv.y;
          vec4 w = modelMatrix * vec4(position, 1.0);
          vN = normalize(mat3(modelMatrix) * normal);
          vV = normalize(cameraPosition - w.xyz);
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: `uniform vec3 uColor; varying float vAlong; varying vec3 vN; varying vec3 vV;
        void main() {
          float edge = pow(clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0), 1.6);
          float a = 0.05 * edge * pow(clamp(vAlong, 0.0, 1.0), 1.5);
          gl_FragColor = vec4(uColor * a, a);
        }`,
    });
    const panelMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#fffbe8').multiplyScalar(7) });
    for (const x of [-1, 1])
      for (const z of [-1, 1]) {
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 46), new THREE.MeshStandardMaterial({ color: '#9aa0aa', roughness: 0.5, metalness: 0.6 }));
        mast.position.set(x * (HL + 32), 23, z * (HW + 32));
        this.group.add(mast);
        const panel = new THREE.Group();
        panel.position.set(x * (HL + 31), 47, z * (HW + 31));
        panel.lookAt(0, 0, 0);
        const frame = new THREE.Mesh(new THREE.BoxGeometry(9, 5.6, 0.8), new THREE.MeshStandardMaterial({ color: '#2a2e36', roughness: 0.6 }));
        panel.add(frame);
        // A grid of lamps on the front face.
        for (let i = 0; i < 5; i++)
          for (let j = 0; j < 3; j++) {
            const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.62, 16), panelMat);
            lamp.position.set(-3.4 + i * 1.7, -1.6 + j * 1.6, 0.42);
            panel.add(lamp);
          }
        this.group.add(panel);
        const s1 = new THREE.Sprite(glow);
        s1.scale.set(30, 30, 1);
        s1.position.copy(panel.position);
        this.group.add(s1);
        const s2 = new THREE.Sprite(streak);
        s2.scale.set(70, 3.5, 1);
        s2.position.copy(panel.position);
        this.group.add(s2);
        // The beam: a long open cone from the lamps to the far side of the pitch.
        const to = new THREE.Vector3(-x * 12, 0, -z * 8);
        const dir = to.clone().sub(panel.position);
        const L = dir.length();
        const cone = new THREE.Mesh(new THREE.CylinderGeometry(30, 3, L, 32, 1, true), beamMat);
        cone.position.copy(panel.position).addScaledVector(dir, 0.5);
        cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().negate().normalize());
        this.group.add(cone);
      }
  }

  /** Night sky: deep blue overhead, a warm glow of the city and the floodlights on the horizon, stars. */
  private sky(): void {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: `varying vec3 vD; void main() { vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying vec3 vD;
        float h(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
        void main() {
          float y = vD.y;
          vec3 top = vec3(0.012, 0.02, 0.055);
          vec3 mid = vec3(0.04, 0.06, 0.12);
          vec3 hor = vec3(0.16, 0.13, 0.16);
          vec3 c = mix(hor, mid, smoothstep(-0.02, 0.18, y));
          c = mix(c, top, smoothstep(0.18, 0.75, y));
          vec3 q = floor(vD * 420.0);
          float st = step(0.9975, h(q)) * smoothstep(0.12, 0.4, y);
          c += st * vec3(0.8, 0.85, 1.0) * (0.4 + 0.6 * h(q + 1.7));
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(650, 48, 24), mat);
    dome.renderOrder = -10;
    this.group.add(dome);
  }

  /** Phone cameras and flashes popping in the stands (more of them when it gets exciting). */
  private crowdFlashes(): void {
    const N = 900;
    const pos = new Float32Array(N * 3);
    const seed = new Float32Array(N);
    let s = 99;
    const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
    for (let i = 0; i < N; i++) {
      const side = i % 4;
      const d = rnd() * 33;
      const y = d < 16 ? 0.9 + d * (9 / 16) : 12.9 + (d - 17) * (11 / 16);
      if (d > 16 && d < 17) continue;
      if (side < 2) {
        const zz = (HW + 9 + d) * (side === 0 ? -1 : 1);
        pos.set([(rnd() - 0.5) * (HL * 2 + 14), y, zz], i * 3);
      } else {
        const xx = (HL + 9 + d) * (side === 2 ? -1 : 1);
        pos.set([xx, y, (rnd() - 0.5) * (HW * 2 + 12)], i * 3);
      }
      seed[i] = rnd() * 1000;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uRate: { value: 0.2 } },
      vertexShader: `attribute float seed; uniform float uTime; uniform float uRate; varying float vA;
        void main() {
          float slot = floor(uTime * 6.0 + seed);
          float r = fract(sin(slot * 12.9898 + seed * 78.233) * 43758.5453);
          vA = step(1.0 - 0.02 * uRate, r) * (1.0 - fract(uTime * 6.0 + seed));
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = vA > 0.0 ? 900.0 / -mv.z : 0.0;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d) * vA;
          gl_FragColor = vec4(vec3(2.6, 2.6, 2.8) * a, a);
        }`,
    });
    this.flashes = new THREE.Points(geo, mat);
    this.flashes.frustumCulled = false;
    this.group.add(this.flashes);
  }

  /** The LED ribbon material (scrolling sponsor boards, or GOAL in the scorer's colours). */
  private ribbon(): THREE.MeshBasicMaterial {
    if (!this.ribbonMat) this.ribbonMat = new THREE.MeshBasicMaterial({ map: this.boards, color: new THREE.Color(1.4, 1.4, 1.4) });
    return this.ribbonMat;
  }

  /** A goal: the ribbons go GOAL in the scorer's colours, pyro over the stand, confetti at that end. */
  celebrate(end: number, c1: string, c2: string): void {
    this.goalTex?.dispose();
    this.goalTex = goalBoardTexture(c1, c2);
    this.goalFlashT = 7;
    if (this.ribbonMat) this.ribbonMat.map = this.goalTex;
    const cols = [new THREE.Color(c1), new THREE.Color(c2), new THREE.Color('#ffffff')];
    for (let k = 0; k < 7; k++) {
      setTimeout(() => this.pyro.burst(new THREE.Vector3(end * (HL + 20) , 34 + Math.random() * 10, (Math.random() - 0.5) * 60), cols[k % 3]!, 160), k * 380);
    }
    // Flame jets along the byline either side of the goal.
    for (const z of [-14, -8, 8, 14]) this.pyro.flame(new THREE.Vector3(end * (HL + 3.2), 0.2, z), 1.8);
    this.pyro.confetti(new THREE.Vector3(end * (HL - 6), 22, 0), cols, 500);
  }

  /** Crowd bounce (more when it's exciting), scrolling LED boards, the nets, flashes, pyro. */
  update(dt: number, time: number, excitement: number, ball?: { x: number; y: number; z: number }, ballInGoal = false): void {
    this.excitement += (excitement - this.excitement) * Math.min(1, dt * 2);
    const ex = this.excitement;
    for (const c of this.crowds) {
      const amp = 0.04 + ex * 0.22;
      c.mesh.position.y = c.base + Math.abs(Math.sin(time * (5 + ex * 4) + c.phase)) * amp;
      (c.mesh.material as THREE.MeshStandardMaterial).map!.offset.y = Math.sin(time * 9 + c.phase) * 0.004 * (0.3 + ex);
    }
    this.boards.offset.x = (time * 0.012) % 1;
    if (this.goalFlashT > 0) {
      this.goalFlashT -= dt;
      if (this.goalTex) this.goalTex.offset.x = (time * 0.25) % 1;
      if (this.ribbonMat) this.ribbonMat.color.setScalar(1.2 + Math.abs(Math.sin(time * 9)) * 1.4);
      if (this.goalFlashT <= 0 && this.ribbonMat) {
        this.ribbonMat.map = this.boards;
        this.ribbonMat.color.setScalar(1.4);
      }
    }
    if (this.flashes) {
      const u = (this.flashes.material as THREE.ShaderMaterial).uniforms;
      u.uTime!.value = time;
      u.uRate!.value = 0.15 + ex * 1.6 + (this.goalFlashT > 0 ? 3 : 0);
    }
    this.stepNets(time, ballInGoal ? ball : undefined);
    this.pyro.update(dt);
  }

  private stepNets(time: number, ball?: { x: number; y: number; z: number }): void {
    this.netState.forEach((n, i) => {
      const geo = this.nets[i]!.geometry;
      const pos = geo.getAttribute('position') as THREE.BufferAttribute;
      n.impacts = n.impacts.filter((hit) => time - hit.time < 5).slice(-6);
      const impacts = this.netReplay ? this.netReplay.filter((hit) => (hit.end < 0 ? 0 : 1) === i).map((hit) => hit.impact) : n.impacts;
      const end = i === 0 ? -1 : 1;
      const pockets = ball ? netPockets({ x: end * ball.x - HL, y: ball.y, z: ball.z }, GOAL_NET)
        .map((p) => ({ ...p, x: p.x * end, nx: p.nx * end })) : [];
      deformNet(n.base, n.out, n.pin, pos.array as Float32Array, impacts, time, pockets);
      pos.needsUpdate = true;
    });
  }

  /** A real cloth contact from the simulation, rather than a goal-line flash. */
  netImpact(hit: { end: number; time: number; x: number; y: number; z: number; strength: number }): void {
    this.netState[hit.end < 0 ? 0 : 1]?.impacts.push({ ...hit, x: hit.x - hit.end * HL });
  }
}

/** A soft round glow (sprites, flares). */
function radialTexture(inner: string, outer: string): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, inner);
  gr.addColorStop(0.25, inner.replace(/[\d.]+\)$/, '0.45)'));
  gr.addColorStop(1, outer);
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/** The LED ribbons on a goal: GOAL! GOAL! in the scorer's colours. */
function goalBoardTexture(c1: string, c2: string): THREE.CanvasTexture {
  const [c, g] = canvas(2048, 64);
  const n = 8;
  const w = c.width / n;
  for (let i = 0; i < n; i++) {
    g.fillStyle = i % 2 ? c1 : '#0a0a0f';
    g.fillRect(i * w, 0, w, 64);
    g.fillStyle = i % 2 ? (c2.toLowerCase() === c1.toLowerCase() ? '#ffffff' : c2) : c1;
    g.font = 'bold 46px "Russo One", "Arial Black", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('GOAL!', i * w + w / 2, 35);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/** Fireworks, flame jets and confetti: one pool of additive points, simulated on the CPU. */
class Pyro {
  private N = 4000;
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private max: Float32Array;
  private kind: Uint8Array;
  private base: Float32Array;
  private next = 0;
  constructor() {
    const N = this.N;
    this.pos = new Float32Array(N * 3).fill(-9999);
    this.col = new Float32Array(N * 3);
    this.size = new Float32Array(N);
    this.vel = new Float32Array(N * 3);
    this.life = new Float32Array(N);
    this.max = new Float32Array(N).fill(1);
    this.kind = new Uint8Array(N);
    this.base = new Float32Array(N * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      vertexShader: `attribute float size; varying vec3 vC;
        void main() { vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * 600.0 / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec3 vC; void main() { float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.05, d); gl_FragColor = vec4(vC * a, a); }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
  }
  private spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, c: THREE.Color, life: number, size: number, kind: number): void {
    const i = this.next;
    this.next = (this.next + 1) % this.N;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.base.set([c.r, c.g, c.b], i * 3);
    this.life[i] = life;
    this.max[i] = life;
    this.size[i] = size;
    this.kind[i] = kind;
    this.alive++;
  }
  /** A firework shell bursting at `at`. */
  burst(at: THREE.Vector3, c: THREE.Color, n: number): void {
    const hot = c.clone().multiplyScalar(3);
    for (let k = 0; k < n; k++) {
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const sp = 9 + Math.random() * 5;
      this.spawn(at.x, at.y, at.z, Math.cos(a) * r * sp, u * sp, Math.sin(a) * r * sp, hot, 1.6 + Math.random() * 0.8, 0.5, 0);
    }
  }
  /** A gas flame jet roaring straight up for `secs`. */
  flame(at: THREE.Vector3, secs: number): void {
    const c = new THREE.Color(4, 1.6, 0.35);
    const steps = Math.round(secs * 50);
    for (let k = 0; k < steps; k++) {
      setTimeout(() => {
        for (let j = 0; j < 6; j++) this.spawn(at.x + (Math.random() - 0.5) * 0.3, at.y, at.z + (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 1.2, 11 + Math.random() * 5, (Math.random() - 0.5) * 1.2, c, 0.45 + Math.random() * 0.25, 0.9, 1);
      }, k * 20);
    }
  }
  /** Paper confetti fluttering down over an end of the ground. */
  confetti(at: THREE.Vector3, cols: THREE.Color[], n: number): void {
    for (let k = 0; k < n; k++) {
      const c = cols[k % cols.length]!.clone().multiplyScalar(0.9);
      this.spawn(at.x + (Math.random() - 0.5) * 30, at.y + Math.random() * 6, at.z + (Math.random() - 0.5) * 50, (Math.random() - 0.5) * 2, -Math.random() * 1.5, (Math.random() - 0.5) * 2, c, 7 + Math.random() * 4, 0.16, 2);
    }
  }
  private alive = 0;
  update(dt: number): void {
    if (dt <= 0) return;
    if (this.alive <= 0) return;
    const { pos, vel, life, max, col, base, kind } = this;
    let alive = 0;
    let any = false;
    for (let i = 0; i < this.N; i++) {
      if (life[i]! <= 0) continue;
      any = true;
      alive++;
      life[i]! -= dt;
      const o = i * 3;
      const k = kind[i]!;
      if (life[i]! <= 0) {
        pos[o + 1] = -9999;
        col[o] = col[o + 1] = col[o + 2] = 0;
        continue;
      }
      if (k === 0) {
        vel[o + 1]! -= 6 * dt;
        const d = Math.exp(-dt * 1.4);
        vel[o]! *= d;
        vel[o + 1]! *= d;
        vel[o + 2]! *= d;
      } else if (k === 1) {
        vel[o + 1]! -= 4 * dt;
      } else {
        // Flutter: drag-limited fall with a sideways wobble.
        vel[o + 1] = -1.1;
        vel[o]! += Math.sin(life[i]! * 7 + i) * dt * 3;
      }
      pos[o]! += vel[o]! * dt;
      pos[o + 1]! += vel[o + 1]! * dt;
      pos[o + 2]! += vel[o + 2]! * dt;
      const f = life[i]! / max[i]!;
      const a = k === 0 ? f * f : k === 1 ? f : Math.min(1, f * 3) * (0.6 + 0.4 * Math.abs(Math.sin(life[i]! * 9 + i)));
      col[o] = base[o]! * a;
      col[o + 1] = base[o + 1]! * a;
      col[o + 2] = base[o + 2]! * a;
    }
    this.alive = alive;
    if (!any) return;
    const g = this.points.geometry;
    g.getAttribute('position').needsUpdate = true;
    g.getAttribute('color').needsUpdate = true;
    g.getAttribute('size').needsUpdate = true;
  }
}
