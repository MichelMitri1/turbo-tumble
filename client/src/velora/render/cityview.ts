import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { assets } from '../assets';
import { HALF, RIVER, RIVER_W, SIZE, WATER_Y, coastZ, type RoadType } from '../world/layout';
import { CELL, GRID, VERTS } from '../world/terrain';
import type { City, ShopKind } from '../world/city';
import type { REdge } from '../world/net';

/**
 * The city's look: the land (hills, beach, river banks), roads as ribbons with lane
 * markings, junction plates and crosswalks, raised sidewalks, bridges and the elevated
 * freeway on pillars with barriers, instanced Kenney buildings / trees / lamps split into
 * chunks so whatever's off screen isn't drawn, traffic lights that change, lamps that glow
 * at night, shop signs, the river and the ocean.
 */

const CHUNK = 200;
const PX = 16; // texture px per metre

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function noise(g: CanvasRenderingContext2D, w: number, h: number, base: string, dots: string[], n: number, size = 2): void {
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  let s = 1234;
  for (let i = 0; i < n; i++) {
    s = (s * 16807) % 2147483647;
    const x = s % w;
    s = (s * 16807) % 2147483647;
    const y = s % h;
    g.fillStyle = dots[i % dots.length]!;
    g.fillRect(x, y, size, size);
  }
}

export const SHOP_STYLE: Record<ShopKind, { color: string; icon: string }> = {
  guns: { color: '#e8262f', icon: '🔫' },
  clothes: { color: '#b45cff', icon: '👕' },
  food: { color: '#38c172', icon: '🥤' },
  respray: { color: '#ff9f1c', icon: '🎨' },
  hospital: { color: '#ffffff', icon: '✚' },
  police: { color: '#3f8cff', icon: '★' },
  cars: { color: '#00d1ff', icon: '🚗' },
};

/** A road texture across the full width (u) and 16 m along (v). */
function roadTexture(type: RoadType, width: number, lanes: number, median: number, parking: boolean): THREE.CanvasTexture {
  const W = Math.round(width * PX);
  const L = 16 * PX;
  return canvasTex(W, L, (g) => {
    noise(g, W, L, '#3c3f43', ['#35383c', '#45484c', '#303337'], (W * L) / 40, 2);
    const c = W / 2;
    const m = PX;
    // Centre: double yellow (city) / a solid median (freeway).
    if (type === 'highway') {
      g.fillStyle = '#6d6f72';
      g.fillRect(c - (median / 2) * m, 0, median * m, L);
      g.fillStyle = '#f2c230';
      g.fillRect(c - (median / 2) * m - m * 0.25, 0, m * 0.15, L);
      g.fillRect(c + (median / 2) * m + m * 0.1, 0, m * 0.15, L);
    } else {
      g.fillStyle = '#f2c230';
      g.fillRect(c - m * 0.3, 0, m * 0.13, L);
      g.fillRect(c + m * 0.17, 0, m * 0.13, L);
    }
    g.fillStyle = '#e8e8e8';
    // Lane dividers (dashed).
    for (let side = -1; side <= 1; side += 2)
      for (let k = 1; k < lanes; k++) {
        const x = c + side * (median / 2 + k * 3.5) * m;
        for (let y = 0; y < L; y += m * 8) g.fillRect(x - m * 0.07, y, m * 0.14, m * 3.5);
      }
    // Edge lines (and the parking lane line).
    for (const side of [-1, 1]) {
      const edge = median / 2 + lanes * 3.5;
      g.fillRect(c + side * edge * m - m * 0.08, 0, m * 0.16, L);
      if (parking) for (let y = 0; y < L; y += m * 6.5) g.fillRect(c + side * (edge + 2.4) * m - m * 0.06, y, m * 0.12, m * 0.9);
    }
  });
}

export class CityView {
  readonly root = new THREE.Group();
  private bulbs!: THREE.InstancedMesh;
  private bulbInfo: Array<{ node: number; edge: number }> = [];
  private lampGlow: THREE.InstancedMesh[] = [];
  private water: THREE.Mesh[] = [];
  private lit = -1;

  constructor(private city: City) {
    this.terrain();
    this.waterways();
    this.roads();
    this.decks();
    this.instanced();
    this.trafficLights();
    this.shopSigns();
  }

  // ---------------------------------------------------------------- land

  private terrain(): void {
    const t = this.city.terrain;
    const detail = canvasTex(256, 256, (g) => noise(g, 256, 256, '#ffffff', ['#e8e8e8', '#f6f6f6', '#dddddd'], 14000, 2));
    detail.repeat.set(1, 1);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: detail });
    const per = CHUNK / CELL; // cells per chunk
    const col = new THREE.Color();
    for (let cj = 0; cj < GRID / per; cj++)
      for (let ci = 0; ci < GRID / per; ci++) {
        const n = per + 1;
        const pos = new Float32Array(n * n * 3);
        const colors = new Float32Array(n * n * 3);
        const uv = new Float32Array(n * n * 2);
        for (let j = 0; j < n; j++)
          for (let i = 0; i < n; i++) {
            const gi = ci * per + i;
            const gj = cj * per + j;
            const x = gi * CELL - HALF;
            const z = gj * CELL - HALF;
            const h = t.h[gj * VERTS + gi]!;
            const k = j * n + i;
            pos[k * 3] = x;
            pos[k * 3 + 1] = h;
            pos[k * 3 + 2] = z;
            uv[k * 2] = x / 24;
            uv[k * 2 + 1] = z / 24;
            // Colour: seabed, sand, grass (lusher low, drier high), rocky slopes.
            const sl = Math.abs(t.h[gj * VERTS + Math.min(VERTS - 1, gi + 1)]! - h) + Math.abs(t.h[Math.min(VERTS - 1, gj + 1) * VERTS + gi]! - h);
            if (h < WATER_Y - 0.3) col.setRGB(0.42, 0.4, 0.33);
            else if (z > coastZ(x) - 75 || h < WATER_Y + 0.6) col.setRGB(0.86, 0.79, 0.58);
            else if (sl > 3.2) col.setRGB(0.47, 0.42, 0.36);
            else if (h > 18) col.setRGB(0.36 + h * 0.002, 0.48, 0.27);
            else col.setRGB(0.33, 0.5 + Math.sin(x * 0.01) * 0.03, 0.24);
            colors[k * 3] = col.r;
            colors[k * 3 + 1] = col.g;
            colors[k * 3 + 2] = col.b;
          }
        const idx: number[] = [];
        for (let j = 0; j < per; j++)
          for (let i = 0; i < per; i++) {
            const a = j * n + i;
            idx.push(a, a + n, a + 1, a + 1, a + n, a + n + 1);
          }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        geo.setIndex(idx);
        geo.computeVertexNormals();
        const m = new THREE.Mesh(geo, mat);
        m.receiveShadow = true;
        this.root.add(m);
      }
  }

  private waterways(): void {
    const tex = canvasTex(256, 256, (g) => noise(g, 256, 256, '#2a7aa8', ['#3388b8', '#22688f', '#4a9cc8'], 6000, 4));
    tex.repeat.set(SIZE / 40, SIZE / 40);
    const mat = new THREE.MeshPhongMaterial({ map: tex, color: 0x9fd6ff, shininess: 110, specular: 0x88aacc, transparent: true, opacity: 0.88, depthWrite: false });
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(SIZE * 3, SIZE * 3), mat);
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(0, WATER_Y, 0);
    sea.renderOrder = 1;
    this.root.add(sea);
    this.water.push(sea);
    void RIVER;
    void RIVER_W;
  }

  // ---------------------------------------------------------------- roads

  /** A ribbon along an edge between arc lengths s0…s1 at lateral offsets l0…l1 (+ = right of a→b). */
  private ribbon(e: REdge, s0: number, s1: number, l0: number, l1: number, lift: number, vScale: number, out: { pos: number[]; uv: number[]; idx: number[] }): void {
    const net = this.city.net;
    const p = { x: 0, y: 0, z: 0 };
    const step = 2;
    const n = Math.max(1, Math.ceil((s1 - s0) / step));
    const base = out.pos.length / 3;
    for (let k = 0; k <= n; k++) {
      const s = s0 + ((s1 - s0) * k) / n;
      net.point(e, s, p);
      const [tx, tz] = net.tangent(e, s);
      const rx = -tz;
      const rz = tx;
      out.pos.push(p.x + rx * l0, p.y + lift, p.z + rz * l0, p.x + rx * l1, p.y + lift, p.z + rz * l1);
      out.uv.push(0, s / vScale, 1, s / vScale);
      if (k > 0) {
        const a = base + (k - 1) * 2;
        out.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
  }

  private roads(): void {
    const net = this.city.net;
    const byType = new Map<string, { pos: number[]; uv: number[]; idx: number[]; tex: THREE.Texture }>();
    const walk = { pos: [] as number[], uv: [] as number[], idx: [] as number[] };
    const curb = { pos: [] as number[], uv: [] as number[], idx: [] as number[] };
    const zebra = { pos: [] as number[], uv: [] as number[], idx: [] as number[] };
    for (const e of net.edges) {
      const sp = e.spec;
      const key = e.type;
      if (!byType.has(key)) byType.set(key, { pos: [], uv: [], idx: [], tex: roadTexture(e.type, sp.width, sp.lanes, sp.median, sp.parking) });
      const a = net.nodes[e.a]!;
      const b = net.nodes[e.b]!;
      const s0 = a.r > 0 ? Math.min(a.r, e.len / 2) : 0;
      const s1 = b.r > 0 ? Math.max(e.len - b.r, e.len / 2) : e.len;
      this.ribbon(e, s0, s1, -sp.width / 2, sp.width / 2, 0.06, 16, byType.get(key)!);
      if (sp.sidewalk) {
        for (const side of [1, -1]) {
          const l0 = side * (sp.width / 2);
          const l1 = side * (sp.width / 2 + 4);
          this.ribbon(e, Math.max(0, s0 - 4), Math.min(e.len, s1 + 4), side > 0 ? l0 : l1, side > 0 ? l1 : l0, 0.18, 4, walk);
          // Curb face.
          this.ribbon(e, Math.max(0, s0 - 4), Math.min(e.len, s1 + 4), l0, l0 + side * 0.01, 0.12, 4, curb);
        }
        // Crosswalks at junction approaches.
        if (a.r > 0) this.ribbon(e, s0, s0 + 3.2, -sp.width / 2, sp.width / 2, 0.08, 3.2, zebra);
        if (b.r > 0) this.ribbon(e, s1 - 3.2, s1, -sp.width / 2, sp.width / 2, 0.08, 3.2, zebra);
      }
    }
    for (const [, b] of byType) this.root.add(this.mesh(b, new THREE.MeshLambertMaterial({ map: b.tex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), false));
    const walkTex = canvasTex(64, 64, (g) => {
      noise(g, 64, 64, '#b8b5ac', ['#aeaba2', '#c4c1b8'], 900, 2);
      g.fillStyle = 'rgba(0,0,0,0.15)';
      g.fillRect(0, 0, 64, 2);
      g.fillRect(0, 0, 2, 64);
    });
    this.root.add(this.mesh(walk, new THREE.MeshLambertMaterial({ map: walkTex, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), false));
    const zt = canvasTex(256, 64, (g) => {
      g.clearRect(0, 0, 256, 64);
      g.fillStyle = 'rgba(235,235,235,0.9)';
      for (let x = 8; x < 256; x += 20) g.fillRect(x, 6, 10, 52);
    }, false);
    zt.wrapS = THREE.RepeatWrapping;
    zt.repeat.set(4, 1);
    this.root.add(this.mesh(zebra, new THREE.MeshLambertMaterial({ map: zt, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), false));
    // Junction plates.
    const plate: THREE.BufferGeometry[] = [];
    for (const n of net.nodes) {
      if (n.r <= 0) continue;
      const g = new THREE.CircleGeometry(n.r + 0.5, 20);
      g.rotateX(-Math.PI / 2);
      g.translate(n.x, n.y + 0.065, n.z);
      plate.push(g);
    }
    if (plate.length) {
      const asphalt = canvasTex(128, 128, (g) => noise(g, 128, 128, '#3c3f43', ['#35383c', '#45484c', '#303337'], 3000, 2));
      const pm = new THREE.Mesh(mergeGeometries(plate), new THREE.MeshLambertMaterial({ map: asphalt, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
      pm.receiveShadow = true;
      this.root.add(pm);
    }
    void curb;
  }

  private mesh(b: { pos: number[]; uv: number[]; idx: number[] }, mat: THREE.Material, cast: boolean): THREE.Mesh {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    geo.setIndex(b.idx);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    m.castShadow = cast;
    return m;
  }

  /** Bridges and the freeway: deck undersides, pillars, barriers. */
  private decks(): void {
    const net = this.city.net;
    const ter = this.city.terrain;
    const under: THREE.BufferGeometry[] = [];
    const pillars: THREE.Matrix4[] = [];
    const rails: THREE.Matrix4[] = [];
    const q = new THREE.Quaternion();
    const Y = new THREE.Vector3(0, 1, 0);
    for (const e of net.edges) {
      if (!e.raised) continue;
      const half = e.spec.width / 2 + 0.5;
      const n = e.px.length;
      for (let k = 0; k < n - 1; k++) {
        if (!e.up[k] && !e.up[k + 1]) continue;
        const x0 = e.px[k]!;
        const z0 = e.pz[k]!;
        const x1 = e.px[k + 1]!;
        const z1 = e.pz[k + 1]!;
        const y = (e.py[k]! + e.py[k + 1]!) / 2;
        const len = Math.hypot(x1 - x0, z1 - z0);
        const yaw = Math.atan2(x1 - x0, z1 - z0);
        q.setFromAxisAngle(Y, yaw);
        // Deck slab (the part under the road surface).
        const slab = new THREE.BoxGeometry(half * 2, 0.9, len + 0.05);
        slab.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3((x0 + x1) / 2, y - 0.42, (z0 + z1) / 2), q, new THREE.Vector3(1, 1, 1)));
        under.push(slab);
        // Barriers both sides.
        for (const side of [1, -1]) {
          const ox = (x0 + x1) / 2 + Math.cos(yaw) * side * (half + 0.1);
          const oz = (z0 + z1) / 2 - Math.sin(yaw) * side * (half + 0.1);
          rails.push(new THREE.Matrix4().compose(new THREE.Vector3(ox, y + 0.5, oz), q, new THREE.Vector3(1, 1, len + 0.05)));
        }
        // Pillars every ~24 m.
        if (k % 12 === 0) {
          const gy = ter.height((x0 + x1) / 2, (z0 + z1) / 2);
          const h = y - 0.9 - Math.min(gy, WATER_Y - 3);
          if (h > 1)
            for (const side of e.spec.width > 16 ? [-0.3, 0.3] : [0]) {
              const ox = (x0 + x1) / 2 + Math.cos(yaw) * side * half;
              const oz = (z0 + z1) / 2 - Math.sin(yaw) * side * half;
              pillars.push(new THREE.Matrix4().compose(new THREE.Vector3(ox, y - 0.9 - h / 2, oz), q, new THREE.Vector3(1, h, 1)));
            }
        }
      }
    }
    const concrete = new THREE.MeshLambertMaterial({ color: 0xa9a49a });
    if (under.length) {
      const m = new THREE.Mesh(mergeGeometries(under), concrete);
      m.castShadow = m.receiveShadow = true;
      this.root.add(m);
    }
    const pg = new THREE.BoxGeometry(1.8, 1, 1.8);
    const pm = new THREE.InstancedMesh(pg, concrete, pillars.length);
    pillars.forEach((m, i) => pm.setMatrixAt(i, m));
    pm.castShadow = true;
    pm.computeBoundingSphere();
    this.root.add(pm);
    const rg = new THREE.BoxGeometry(0.3, 1.0, 1);
    const rm = new THREE.InstancedMesh(rg, new THREE.MeshLambertMaterial({ color: 0xc8c4bb }), rails.length);
    rails.forEach((m, i) => rm.setMatrixAt(i, m));
    rm.castShadow = true;
    rm.computeBoundingSphere();
    this.root.add(rm);
  }

  // ---------------------------------------------------------------- buildings, trees, lamps

  private instanced(): void {
    const city = this.city;
    type Part = { geo: THREE.BufferGeometry; mat: THREE.Material | THREE.Material[]; rel: THREE.Matrix4 };
    const parts = new Map<string, { parts: Part[]; minY: number }>();
    const partsOf = (kit: string, model: string) => {
      const key = `${kit}/${model}`;
      let p = parts.get(key);
      if (p) return p;
      const src = assets.model(kit, model);
      if (!src) return null;
      src.updateMatrixWorld(true);
      const inv = src.matrixWorld.clone().invert();
      const list: Part[] = [];
      src.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) list.push({ geo: m.geometry, mat: m.material, rel: inv.clone().multiply(m.matrixWorld) });
      });
      p = { parts: list, minY: 0 };
      parts.set(key, p);
      return p;
    };
    // Bucket placements by chunk and model.
    const buckets = new Map<string, THREE.Matrix4[]>();
    const add = (kit: string, model: string, m: THREE.Matrix4, x: number, z: number) => {
      const key = `${Math.floor((x + HALF) / CHUNK)},${Math.floor((z + HALF) / CHUNK)}|${kit}/${model}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(m);
    };
    const q = new THREE.Quaternion();
    const Y = new THREE.Vector3(0, 1, 0);
    for (const p of city.placements) add(p.kit, p.model, new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), q.setFromAxisAngle(Y, p.yaw), new THREE.Vector3(p.scale, p.scale * (p.sy ?? 1), p.scale)), p.x, p.z);
    const lampHeads: THREE.Vector3[] = [];
    for (const l of city.lamps) {
      add('street', 'light-curved', new THREE.Matrix4().compose(new THREE.Vector3(l.x, l.y, l.z), q.setFromAxisAngle(Y, l.yaw + Math.PI), new THREE.Vector3(9, 9, 9)), l.x, l.z);
      lampHeads.push(new THREE.Vector3(0, 0.62, -0.17).multiplyScalar(9).applyQuaternion(q).add(new THREE.Vector3(l.x, l.y, l.z)));
    }
    for (const [key, mats] of buckets) {
      const [, km] = key.split('|');
      const [kit, model] = km!.split('/') as [string, string];
      const p = partsOf(kit, model);
      if (!p) continue;
      const cast = kit !== 'street';
      for (const part of p.parts) {
        const im = new THREE.InstancedMesh(part.geo, part.mat, mats.length);
        mats.forEach((m, k) => im.setMatrixAt(k, m.clone().multiply(part.rel)));
        im.castShadow = cast;
        im.receiveShadow = true;
        im.computeBoundingSphere();
        this.root.add(im);
      }
    }
    // Lamp glow (per chunk so it culls too).
    const byChunk = new Map<string, THREE.Vector3[]>();
    for (const h of lampHeads) {
      const k = `${Math.floor((h.x + HALF) / CHUNK)},${Math.floor((h.z + HALF) / CHUNK)}`;
      if (!byChunk.has(k)) byChunk.set(k, []);
      byChunk.get(k)!.push(h);
    }
    const lg = new THREE.SphereGeometry(0.35, 8, 6);
    const lm = new THREE.MeshBasicMaterial({ color: 0x9a9488 });
    for (const list of byChunk.values()) {
      const im = new THREE.InstancedMesh(lg, lm, list.length);
      list.forEach((h, k) => im.setMatrixAt(k, new THREE.Matrix4().makeTranslation(h.x, h.y - 0.1, h.z)));
      im.computeBoundingSphere();
      this.root.add(im);
      this.lampGlow.push(im);
    }
  }

  private trafficLights(): void {
    const city = this.city;
    const pole = assets.model('street', 'traffic-light');
    const q = new THREE.Quaternion();
    const Y = new THREE.Vector3(0, 1, 0);
    const mats: THREE.Matrix4[] = [];
    const bulbAt: THREE.Vector3[] = [];
    for (const l of city.lights) {
      mats.push(new THREE.Matrix4().compose(new THREE.Vector3(l.x, l.y, l.z), q.setFromAxisAngle(Y, l.yaw), new THREE.Vector3(9, 9, 9)));
      bulbAt.push(new THREE.Vector3(l.x - Math.sin(l.yaw) * 0.3, l.y + 4.2, l.z - Math.cos(l.yaw) * 0.3));
      this.bulbInfo.push({ node: l.node, edge: l.edge });
    }
    if (pole && mats.length) {
      pole.updateMatrixWorld(true);
      const inv = pole.matrixWorld.clone().invert();
      pole.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const rel = inv.clone().multiply(m.matrixWorld);
        const im = new THREE.InstancedMesh(m.geometry, m.material, mats.length);
        mats.forEach((p, k) => im.setMatrixAt(k, p.clone().multiply(rel)));
        im.computeBoundingSphere();
        this.root.add(im);
      });
    }
    this.bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.28, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }), Math.max(1, bulbAt.length));
    bulbAt.forEach((p, k) => this.bulbs.setMatrixAt(k, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z)));
    this.bulbs.computeBoundingSphere();
    this.root.add(this.bulbs);
  }

  private shopSigns(): void {
    for (const s of this.city.shops) {
      const st = SHOP_STYLE[s.kind];
      const tex = canvasTex(512, 128, (g) => {
        g.fillStyle = '#111';
        g.fillRect(0, 0, 512, 128);
        g.fillStyle = st.color;
        g.fillRect(6, 6, 500, 116);
        g.fillStyle = s.kind === 'hospital' ? '#c0161f' : '#fff';
        g.font = '900 60px Bebas Neue, Impact, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(`${st.icon} ${s.name.toUpperCase()}`, 256, 68);
      }, false);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(8, 2), new THREE.MeshBasicMaterial({ map: tex }));
      sign.position.set(s.x - s.fx * 1.7, s.y + 5.2, s.z - s.fz * 1.7);
      sign.rotation.y = Math.atan2(s.fx, s.fz);
      this.root.add(sign);
      const mk = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 1.2, 24, 1, true), new THREE.MeshBasicMaterial({ color: st.color, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
      mk.position.set(s.x, s.y + 0.6, s.z);
      this.root.add(mk);
    }
  }

  /** Traffic lights change; lamps glow at night; the water moves. */
  update(time: number, night: number, light: (node: number, edge: number) => 'green' | 'yellow' | 'red'): void {
    const c = new THREE.Color();
    this.bulbInfo.forEach((b, k) => {
      const l = light(b.node, b.edge);
      this.bulbs.setColorAt(k, c.set(l === 'green' ? 0x22ff55 : l === 'yellow' ? 0xffc21a : 0xff2a2a));
    });
    if (this.bulbs.instanceColor) this.bulbs.instanceColor.needsUpdate = true;
    const lit = night > 0.5 ? 1 : 0;
    if (lit !== this.lit) {
      this.lit = lit;
      for (const g of this.lampGlow) (g.material as THREE.MeshBasicMaterial).color.set(lit ? 0xfff1c4 : 0x9a9488);
    }
    for (const w of this.water) {
      const map = (w.material as THREE.MeshPhongMaterial).map!;
      map.offset.set(Math.sin(time * 0.05) * 0.02, time * 0.004);
    }
  }
}
