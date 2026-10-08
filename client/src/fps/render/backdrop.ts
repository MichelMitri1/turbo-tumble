import type { Box, Material } from '../sim/level';
import type { MapDef, PropPlacement } from '../sim/maps';

/**
 * Scenery outside the playable area (render only): what's beyond the invisible
 * border, so a map sits in a believable place — a suburb, a port, a desert test site,
 * a city, an estate in the woods — with mountains on the horizon.
 */
export interface BackdropData {
  boxes: Box[];
  props: PropPlacement[];
  /** Rounded mounds: [x, z, radius, height, colour]. */
  hills: Array<[number, number, number, number, string]>;
  /** Pointy peaks: [x, z, radius, height, colour]. */
  peaks: Array<[number, number, number, number, string]>;
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Edge = { n: [number, number]; along: 'x' | 'z'; len: number };

/** Every model the scenery can use (preloaded with the match). */
export const BACKDROP_MODELS = ['prop-tree-1', 'prop-tree-2', 'prop-tree-3', 'prop-metalfence', 'prop-container-long', 'prop-barrier-large', 'prop-debris-brokencar', 'prop-tank', 'prop-debris-pile', 'prop-debris-tires', 'prop-watertank-floor', 'prop-streetlight'];

export function backdrop(map: MapDef): BackdropData {
  const [hx, hz] = map.half;
  const R = rng(map.id.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
  const r = (a: number, b: number) => a + R() * (b - a);
  const pick = <T,>(l: T[]) => l[Math.floor(R() * l.length)]!;
  const out: BackdropData = { boxes: [], props: [], hills: [], peaks: [] };
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: Material, tint?: string) =>
    out.boxes.push({ x0: Math.min(x0, x1), y0, z0: Math.min(z0, z1), x1: Math.max(x0, x1), y1, z1: Math.max(z0, z1), mat, tint });
  const prop = (model: string, x: number, z: number, rot: number, s: number | [number, number, number], tint?: string, y = 0) => {
    const [sx, sy, sz] = typeof s === 'number' ? [s, s, s] : s;
    out.props.push({ model, x, y, z, rot, sx, sy, sz, collide: false, tint });
  };
  // The four edges: outward normal, axis we walk along, half-length.
  const edges: Edge[] = [
    { n: [0, -1], along: 'x', len: hx },
    { n: [0, 1], along: 'x', len: hx },
    { n: [-1, 0], along: 'z', len: hz },
    { n: [1, 0], along: 'z', len: hz },
  ];
  /** A point `d` metres outside edge `e`, `t` along it. */
  const at = (e: Edge, t: number, d: number): [number, number] => (e.along === 'x' ? [t, e.n[1] * (hz + d)] : [e.n[0] * (hx + d), t]);
  /** A rectangle outside edge `e`: `t0…t1` along, `d0…d1` out. */
  const rect = (e: Edge, t0: number, t1: number, d0: number, d1: number, y0: number, y1: number, mat: Material, tint?: string) => {
    const [ax, az] = at(e, t0, d0);
    const [bx, bz] = at(e, t1, d1);
    box(ax, y0, az, bx, y1, bz, mat, tint);
  };
  /** Quarter turns so a prop's front (−z by default… +z for most models) faces the map. */
  const faceIn = (e: Edge) => (e.n[1] < 0 ? 0 : e.n[1] > 0 ? 2 : e.n[0] < 0 ? 1 : 3);
  /** Ring strip around the whole map, `d0…d1` out (corners filled). */
  const ring = (d0: number, d1: number, y0: number, y1: number, mat: Material, tint?: string) => {
    for (const e of edges) rect(e, -(e.len + d1), e.len + d1, d0, d1, y0, y1, mat, tint);
  };
  /** Along-edge range for a row `d` deep: x-edges run past the corners, z-edges stop at them (no overlaps). */
  const span = (e: Edge, extra: number): [number, number] => (e.along === 'x' ? [-e.len - extra, e.len + extra] : [-e.len, e.len]);
  const kind = map.backdrop;
  const ext = Math.max(hx, hz);

  if (kind === 'suburb') {
    // Low hedge on the border, a ring road, then houses and trees.
    for (const e of edges) for (let t = -e.len; t < e.len; t += 6) rect(e, t, t + 5.2, 0.2, 1.1, 0, 1.1, 'hedge');
    ring(1.5, 9, 0, 0.02, 'asphalt');
    ring(9, 11, 0, 0.06, 'concrete');
    const pastel = ['#e8d8b0', '#c8dce8', '#e8c8c0', '#d0e0c0', '#f0ece0', '#d8c8e0', '#b8c8b8'];
    for (const e of edges) {
      const [s0, s1] = span(e, 28);
      for (let t = s0; t < s1 - 6; ) {
        const w = r(8, 11);
        const dep = r(8, 10);
        const two = R() < 0.45;
        const h = two ? 5.8 : 3.1;
        const d0 = r(13, 16);
        rect(e, t, t + w, d0, d0 + dep, 0, h, 'paint', pick(pastel));
        // Pitched roof (stepped), front door and windows facing the street.
        const roof = pick(['#5a3a30', '#3a4048', '#6a5040', '#4a3a3a']);
        for (let i = 0; i < 4; i++) {
          const k = (dep / 2) * (i / 4);
          rect(e, t - 0.3, t + w + 0.3, d0 - 0.3 + k, d0 + dep + 0.3 - k, h + i * 0.5, h + (i + 1) * 0.5, 'shingle', roof);
        }
        rect(e, t + w * 0.45, t + w * 0.45 + 1.1, d0 - 0.06, d0, 0, 2.2, 'darkwood');
        for (const f of [0.15, 0.7]) rect(e, t + w * f, t + w * f + 1.4, d0 - 0.05, d0, 1, 2.2, 'glass', '#3a4a58');
        if (two) for (const f of [0.15, 0.45, 0.7]) rect(e, t + w * f, t + w * f + 1.4, d0 - 0.05, d0, 3.7, 4.9, 'glass', '#3a4a58');
        rect(e, t + w * 0.1, t + w * 0.35, 11, d0, 0, 0.04, 'concrete');
        if (R() < 0.7) {
          const [x, z] = at(e, t + w + r(1.5, 3.5), r(14, 26));
          prop(pick(['prop-tree-1', 'prop-tree-2', 'prop-tree-3']), x, z, Math.floor(R() * 4), r(1.8, 2.4));
        }
        t += w + r(4, 7);
      }
      for (let i = 0; i < 10; i++) {
        const [x, z] = at(e, r(-e.len - 30, e.len + 30), r(28, 60));
        prop(pick(['prop-tree-1', 'prop-tree-2', 'prop-tree-3']), x, z, Math.floor(R() * 4), r(2, 2.8));
      }
    }
  }

  if (kind === 'industrial') {
    for (const e of edges) for (let t = -e.len + 1.8; t < e.len; t += 3.55) {
      const [x, z] = at(e, t, 0.5);
      prop('prop-metalfence', x, z, e.along === 'x' ? 0 : 1, 1, '#9aa0a8');
    }
    ring(1.2, 9, 0, 0.02, 'asphalt');
    const metal = ['#7a8590', '#8a7a6a', '#5a6a7a', '#9a9488', '#6a7468'];
    const colours = ['#8a2a22', '#2a4f7a', '#3d6b35', '#a8742a', '#5c5f63', '#6b3a72'];
    for (const e of edges) {
      const [s0, s1] = span(e, 36);
      for (let t = s0; t < s1 - 14; ) {
        if (R() < 0.6) {
          // Warehouse.
          const w = r(18, 30);
          const dep = r(14, 22);
          const h = r(8, 13);
          const d0 = r(11, 14);
          rect(e, t, t + w, d0, d0 + dep, 0, h, 'metal', pick(metal));
          rect(e, t - 0.3, t + w + 0.3, d0 - 0.3, d0 + dep + 0.3, h, h + 0.4, 'concrete');
          rect(e, t + w * 0.2, t + w * 0.2 + 4.5, d0 - 0.06, d0, 0, 4.5, 'metal', '#4a4e54');
          rect(e, t + w * 0.6, t + w * 0.6 + 4.5, d0 - 0.06, d0, 0, 4.5, 'metal', '#4a4e54');
          t += w + r(3, 6);
        } else {
          // Container stacks.
          const n = 2 + Math.floor(R() * 3);
          for (let i = 0; i < n; i++) {
            const [x, z] = at(e, t + 6, 13 + i * 2.6);
            const lv = 1 + Math.floor(R() * 3);
            for (let k = 0; k < lv; k++) prop('prop-container-long', x, z, e.along === 'x' ? 0 : 1, [2.8, 1.22, 1.15], pick(colours), k * 2.62);
          }
          t += 14;
        }
      }
    }
    // Gantry cranes behind the yard.
    for (const e of [edges[0]!, edges[1]!]) {
      for (const t of [-e.len * 0.5, e.len * 0.4]) {
        for (const dd of [40, 58]) {
          rect(e, t - 1, t + 1, dd - 1, dd + 1, 0, 34, 'paint', '#d8a830');
          rect(e, t + 22, t + 24, dd - 1, dd + 1, 0, 34, 'paint', '#d8a830');
        }
        rect(e, t - 1, t + 24, 38, 60, 34, 36.5, 'paint', '#d8a830');
        rect(e, t + 8, t + 14, 44, 52, 30, 34, 'paint', '#4a4a4a');
      }
    }
  }

  if (kind === 'desert') {
    for (const e of edges) for (let t = -e.len + 1.9; t < e.len; t += 3.8) {
      const [x, z] = at(e, t, 0.6);
      prop('prop-barrier-large', x, z, e.along === 'x' ? 0 : 1, 1, '#b8ad96');
    }
    for (const e of edges) {
      for (let i = 0; i < 9; i++) {
        const [x, z] = at(e, r(-e.len - 40, e.len + 40), r(14, 90));
        out.hills.push([x, z, r(8, 22), r(2, 7), '#c9a878']);
      }
      for (let i = 0; i < 3; i++) {
        const [x, z] = at(e, r(-e.len, e.len), r(8, 30));
        prop(pick(['prop-debris-brokencar', 'prop-tank', 'prop-debris-pile', 'prop-debris-tires', 'prop-watertank-floor']), x, z, Math.floor(R() * 4), pick([1, 1.4, 2]), '#9a8a70');
      }
      // Mesas: stacked slabs.
      for (let i = 0; i < 2; i++) {
        const [x, z] = at(e, r(-e.len - 30, e.len + 30), r(60, 110));
        let w = r(18, 30);
        let y = 0;
        for (let k = 0; k < 4; k++) {
          const h = r(4, 8);
          box(x - w / 2, y, z - w / 2.4, x + w / 2, y + h, z + w / 2.4, 'dirt', '#b8906a');
          y += h;
          w *= r(0.65, 0.85);
        }
      }
      // Telephone poles along a dirt track.
      rect(e, -e.len - 40, e.len + 40, 10, 15, 0, 0.02, 'dirt');
      for (let t = -e.len - 30; t < e.len + 30; t += 14) {
        const [x, z] = at(e, t, 17);
        box(x - 0.15, 0, z - 0.15, x + 0.15, 8, z + 0.15, 'darkwood');
        box(x - (e.along === 'x' ? 1.2 : 0.1), 7.2, z - (e.along === 'x' ? 0.1 : 1.2), x + (e.along === 'x' ? 1.2 : 0.1), 7.4, z + (e.along === 'x' ? 0.1 : 1.2), 'darkwood');
      }
    }
  }

  if (kind === 'city') {
    for (const e of edges) for (let t = -e.len; t < e.len; t += 2.2) rect(e, t, t + 2, 0.2, 0.8, 0, 0.85, 'concrete', '#c8c4bc');
    ring(1, 4, 0, 0.12, 'concrete');
    ring(4, 15, 0, 0.02, 'asphalt');
    for (const e of edges) for (let t = -e.len - 15; t < e.len + 15; t += 6) rect(e, t, t + 3, 9.4, 9.6, 0, 0.03, 'paint', '#e8e0c0');
    ring(15, 18, 0, 0.12, 'concrete');
    const tints = ['#c8c4bc', '#9aa4b0', '#b8a898', '#8a9098', '#d0c8b8', '#a89080', '#7a8a9a'];
    for (const row of [0, 1]) {
      for (const e of edges) {
        const [s0, s1] = span(e, row ? 78 : 42);
        for (let t = s0; t < s1 - 12; ) {
          const w = r(14, 24);
          const dep = r(14, 22);
          const h = row ? r(45, 110) : r(14, 48);
          const d0 = row ? r(44, 52) : 18;
          rect(e, t, t + w, d0, d0 + dep, 0, h, 'facade', pick(tints));
          rect(e, t - 0.4, t + w + 0.4, d0 - 0.4, d0 + dep + 0.4, h, h + 0.6, 'concrete');
          if (!row) rect(e, t, t + w, d0 - 0.15, d0 + 0.2, 0, 4.2, 'paint', pick(['#c84a3a', '#3a6ab8', '#d8b048', '#2a2a2e', '#3a8a5a']));
          t += w + (row ? r(4, 10) : r(0.5, 2));
        }
      }
    }
    for (const e of edges) for (let t = -e.len; t < e.len; t += 18) {
      const [x, z] = at(e, t, 2.5);
      prop('prop-streetlight', x, z, faceIn(e) + 1, 1.4);
    }
  }

  if (kind === 'estate') {
    // Stone wall with pillars, a hedge, then deep woods.
    for (const e of edges) {
      rect(e, -e.len - 1, e.len + 1, 0.3, 0.9, 0, 2.4, 'brick', '#9a948a');
      for (let t = -e.len; t <= e.len; t += 8) rect(e, t - 0.5, t + 0.5, 0.15, 1.05, 0, 2.9, 'concrete', '#c8c4bc');
      rect(e, -e.len - 2.5, e.len + 2.5, 1.3, 2.6, 0, 2.2, 'hedge');
      for (let i = 0; i < 26; i++) {
        const [x, z] = at(e, r(-e.len - 40, e.len + 40), r(5, 55));
        prop(pick(['prop-tree-2', 'prop-tree-2', 'prop-tree-1', 'prop-tree-3']), x, z, Math.floor(R() * 4), r(2, 3.2), R() < 0.5 ? '#6a8a5a' : undefined);
      }
      for (let i = 0; i < 6; i++) {
        const [x, z] = at(e, r(-e.len - 60, e.len + 60), r(60, 120));
        out.hills.push([x, z, r(30, 55), r(10, 22), '#4e6a44']);
      }
    }
  }

  // Mountains on the horizon (everyone gets them; fog sells the distance).
  const peakCol = kind === 'desert' ? '#a88a66' : kind === 'city' ? '#7a8692' : '#5e6e62';
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2 + r(-0.08, 0.08);
    const d = ext + r(170, 260);
    out.peaks.push([Math.cos(a) * d, Math.sin(a) * d, r(55, 110), r(35, 120), peakCol]);
  }
  return out;
}
