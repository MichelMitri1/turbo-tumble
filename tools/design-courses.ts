/**
 * Course designer: turns each recipe (tools/course-recipes.ts) into a concrete,
 * closed, non-overlapping layout with features, written to
 * shared/src/tracks/layouts.ts (plain data you can hand-edit afterwards).
 *
 *   npx tsx tools/design-courses.ts [trackId…]
 *
 * Layouts are built from pieces (kinks, sweepers, corners, hairpins, esses,
 * chicanes, tightening curves, carousels) with random angles and radii, steered so
 * the heading winds once round the lap; the leftover position error is spread over
 * every straight. Thousands of candidates are tried per course and the best one
 * (closest to the target length, smallest straight adjustments, compact) is kept.
 */
import fs from 'node:fs';
import { SeededRandom } from '../shared/src/math/random';
import { RECIPES, type Piece, type Recipe } from './course-recipes';

type Turn = { t: 'turn'; deg: number; r: number; dir: 1 | -1; tag?: string };
type Straight = { t: 'str'; len: number; tag?: string };
type P = Turn | Straight;

const HW = { easy: 10.5, medium: 9, hard: 7.6 } as const;
const SHOULDER = { easy: 6, medium: 6, hard: 4 } as const;
const HAIRPIN_R = { easy: [21, 26], medium: [19, 24], hard: [15, 20] } as const;
const MIN_R = { easy: 30, medium: 24, hard: 18 } as const;

function pieces(rng: SeededRandom, recipe: Recipe, piece: Piece, dir: 1 | -1): P[] {
  const d = recipe.difficulty;
  const minR = MIN_R[d];
  const r = (a: number, b: number): number => Math.round(rng.range(a, b));
  const turn = (deg: number, rad: number, dd: 1 | -1, tag?: string): Turn => ({ t: 'turn', deg: Math.round(deg), r: rad, dir: dd, ...(tag ? { tag } : {}) });
  const str = (len: number, tag?: string): Straight => ({ t: 'str', len: Math.round(len), ...(tag ? { tag } : {}) });
  switch (piece) {
    case 'kink':
      return [turn(rng.range(12, 30), r(90, 160), dir)];
    case 'sweeper':
      return [turn(rng.range(35, 100), r(55, 120), dir)];
    case 'corner':
      return [turn(rng.range(55, 130), r(minR + 4, minR + 28), dir)];
    case 'tight':
      return [turn(rng.range(80, 140), r(minR, minR + 10), dir)];
    case 'hairpin': {
      const [a, b] = HAIRPIN_R[d];
      return [str(rng.range(45, 90), 'hpIn'), turn(rng.range(165, 195), r(a, b), dir, 'hairpin'), str(rng.range(45, 90), 'hpOut')];
    }
    case 'esses': {
      const a1 = rng.range(35, 85);
      const a2 = a1 * rng.range(0.7, 1.3);
      return [turn(a1, r(minR + 6, 70), dir), ...(rng.next() < 0.5 ? [str(rng.range(8, 25))] : []), turn(a2, r(minR + 6, 70), (-dir) as 1 | -1)];
    }
    case 'chicane': {
      const a = rng.range(28, 42);
      const rr = r(Math.max(15, minR - 4), minR + 6);
      return [turn(a, rr, dir), str(rng.range(5, 12)), turn(a * 2, rr, (-dir) as 1 | -1), str(rng.range(5, 12)), turn(a, rr, dir)];
    }
    case 'compound': {
      const r1 = r(60, 110);
      return [turn(rng.range(30, 60), r1, dir), turn(rng.range(50, 100), r(minR + 2, minR + 20), dir)];
    }
    case 'carousel':
      return [turn(rng.range(220, 260), r(34, 46), dir)];
  }
}

interface Layout {
  ps: P[];
  pts: Array<{ x: number; z: number; s: number; h: number }>;
  length: number;
  adjust: number;
  bbox: { w: number; h: number };
}

function walk(ps: P[], step = 3): Layout['pts'] {
  const pts: Layout['pts'] = [{ x: 0, z: 0, s: 0, h: 0 }];
  let x = 0;
  let z = 0;
  let h = 0;
  let s = 0;
  for (const p of ps) {
    const len = p.t === 'str' ? p.len : (p.deg * Math.PI * p.r) / 180;
    const n = Math.max(1, Math.ceil(len / step));
    const dh = p.t === 'turn' ? ((p.dir * p.deg * Math.PI) / 180) / n : 0;
    for (let k = 0; k < n; k++) {
      h += dh / 2;
      x += Math.cos(h) * (len / n);
      z += Math.sin(h) * (len / n);
      h += dh / 2;
      s += len / n;
      pts.push({ x, z, s, h });
    }
  }
  return pts;
}

/** Spread the closing error over the straights (weighted least squares). */
function close(ps: P[]): number | null {
  const pts = walk(ps);
  const end = pts[pts.length - 1]!;
  const strs: Array<{ p: Straight; ux: number; uz: number; w: number }> = [];
  let h = 0;
  for (const p of ps) {
    if (p.t === 'str') strs.push({ p, ux: Math.cos(h), uz: Math.sin(h), w: p === ps[0] ? 0.15 : 1 });
    else h += (p.dir * p.deg * Math.PI) / 180;
  }
  // M = Σ w u uᵀ; Δ_i = −w_i u_iᵀ M⁻¹ E
  let a = 0;
  let b = 0;
  let c = 0;
  for (const s of strs) {
    a += s.w * s.ux * s.ux;
    b += s.w * s.ux * s.uz;
    c += s.w * s.uz * s.uz;
  }
  const det = a * c - b * b;
  if (Math.abs(det) < 1e-6) return null;
  const ix = (c * end.x - b * end.z) / det;
  const iz = (-b * end.x + a * end.z) / det;
  let total = 0;
  for (const s of strs) {
    const delta = -s.w * (s.ux * ix + s.uz * iz);
    s.p.len += delta;
    total += Math.abs(delta);
  }
  for (const s of strs) {
    const min = s.p === ps[0] ? 170 : s.p.tag === 'long' ? 145 : s.p.tag ? 40 : 18;
    if (s.p.len < min || s.p.len > 300) return null;
  }
  return total;
}

/** Close pairs of points far apart along the lap (overlaps / crossings). */
function closePairs(pts: Layout['pts'], clearance: number, length: number): Array<[number, number]> {
  const cell = clearance;
  const grid = new Map<string, number[]>();
  const sub = pts.filter((_, i) => i % 2 === 0);
  sub.forEach((p, i) => {
    const k = `${Math.floor(p.x / cell)},${Math.floor(p.z / cell)}`;
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
  });
  const out: Array<[number, number]> = [];
  const minSep = Math.max(90, clearance * 2.6);
  sub.forEach((p, i) => {
    const cx = Math.floor(p.x / cell);
    const cz = Math.floor(p.z / cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (const j of grid.get(`${cx + dx},${cz + dz}`) ?? []) {
          if (j <= i) continue;
          const q = sub[j]!;
          const sep = Math.min(Math.abs(q.s - p.s), length - Math.abs(q.s - p.s));
          if (sep < minSep) continue;
          if (Math.hypot(q.x - p.x, q.z - p.z) < clearance) out.push([i * 2, j * 2]);
        }
      }
    }
  });
  return out;
}

function generate(recipe: Recipe, rng: SeededRandom): Layout | null {
  const dir: 1 | -1 = rng.next() < 0.5 ? 1 : -1;
  const ps: P[] = [{ t: 'str', len: Math.round(rng.range(180, 230)) }];
  const mix = Object.entries(recipe.mix).filter(([, w]) => (w ?? 0) > 0) as Array<[Piece, number]>;
  const total = mix.reduce((a, [, w]) => a + w, 0);
  const pick = (): Piece => {
    let x = rng.next() * total;
    for (const [k, w] of mix) if ((x -= w) <= 0) return k;
    return mix[0]![0];
  };
  const target = (f: number): number => (recipe.figure8 ? (f < 0.5 ? 540 * f : 270 - 540 * (f - 0.5)) : 360 * f) * dir;
  let heading = 0;
  let len = ps[0]!.t === 'str' ? ps[0]!.len : 0;
  const L = recipe.length;
  let lastWasStraight = true;
  let hairpins = 0;
  const f = recipe.features;
  // Long straights for jumps / streams / tunnels and hairpins for shortcuts are guaranteed.
  let longs = (f.gapJumps ?? 0) + (f.jumps ?? 0) + (f.streams?.n ?? 0) + (f.tunnels ?? 0);
  const forced: Piece[] = Array.from({ length: f.shortcuts ?? 0 }, () => 'hairpin' as const);
  while (len < L * 0.88) {
    if (!lastWasStraight && rng.next() < 0.55) {
      const long = longs > 0 && rng.next() < 0.45;
      const s = Math.round(long ? rng.range(150, 190) : rng.range(25, 120));
      if (long) longs--;
      ps.push({ t: 'str', len: s, ...(long ? { tag: 'long' } : {}) });
      len += s;
      lastWasStraight = true;
      continue;
    }
    let piece = forced.length && rng.next() < 0.3 ? forced.pop()! : pick();
    if (piece === 'hairpin' && hairpins >= 3) piece = 'corner';
    // Choose the direction that keeps the heading near the target (mostly).
    const fr = len / L;
    const want = target(Math.min(1, fr + 0.08)) - heading;
    let d: 1 | -1 = want >= 0 ? 1 : -1;
    if (rng.next() < 0.22) d = (-d) as 1 | -1;
    const add = pieces(rng, recipe, piece, d);
    for (const p of add) {
      ps.push(p);
      if (p.t === 'turn') heading += p.dir * p.deg;
      len += p.t === 'str' ? p.len : (p.deg * Math.PI * p.r) / 180;
    }
    if (piece === 'hairpin') hairpins++;
    lastWasStraight = add[add.length - 1]!.t === 'str';
    if (Math.abs(heading - target(len / L)) > 230) return null;
  }
  if (longs > 0 || forced.length) return null;
  // Final corner brings the total turn to ±360 (or 0 for a figure-8).
  const goal = recipe.figure8 ? 0 : 360 * dir;
  const rest = goal - heading;
  if (Math.abs(rest) > 170 || Math.abs(rest) < 15) return null;
  if (!lastWasStraight) ps.push({ t: 'str', len: Math.round(rng.range(30, 80)) });
  ps.push({ t: 'turn', deg: Math.round(Math.abs(rest)), r: Math.round(rng.range(MIN_R[recipe.difficulty] + 10, 75)), dir: rest > 0 ? 1 : -1 });
  // Exact angle sum after rounding.
  const sum = ps.reduce((a, p) => a + (p.t === 'turn' ? p.dir * p.deg : 0), 0);
  const last = ps[ps.length - 1] as Turn;
  last.deg += (goal - sum) * last.dir;
  if (last.deg < 10) return null;

  const adjust = close(ps);
  if (adjust === null) return null;
  for (const p of ps) if (p.t === 'str') p.len = Math.round(p.len);
  const pts = walk(ps);
  const end = pts[pts.length - 1]!;
  const length = end.s;
  if (Math.hypot(end.x, end.z) > 12 || Math.abs(length - L) > L * 0.12) return null;
  const clearance = 2 * (HW[recipe.difficulty] + SHOULDER[recipe.difficulty]) + 6;
  const pairs = closePairs(pts, clearance, length);
  if (recipe.figure8 ? !oneCrossing(pts, pairs) : pairs.length) return null;
  const xs = pts.map((p) => p.x);
  const zs = pts.map((p) => p.z);
  return { ps, pts, length, adjust, bbox: { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...zs) - Math.min(...zs) } };
}

/** Exactly one clean crossing (two branches meeting at a decent angle). */
function oneCrossing(pts: Layout['pts'], pairs: Array<[number, number]>): boolean {
  if (!pairs.length) return false;
  const a0 = Math.min(...pairs.map((p) => pts[p[0]]!.s));
  const a1 = Math.max(...pairs.map((p) => pts[p[0]]!.s));
  const b0 = Math.min(...pairs.map((p) => pts[p[1]]!.s));
  const b1 = Math.max(...pairs.map((p) => pts[p[1]]!.s));
  if (a1 - a0 > 90 || b1 - b0 > 90) return false;
  // Keep the overpass away from the start straight / grid.
  if (a0 < 300 || pts[pts.length - 1]!.s - b1 < 120) return false;
  const [i, j] = pairs[Math.floor(pairs.length / 2)]!;
  const angle = Math.abs(Math.sin(pts[i]!.h - pts[j]!.h));
  return angle > 0.75;
}

function score(l: Layout, recipe: Recipe): number {
  const aspect = Math.max(l.bbox.w, l.bbox.h) / Math.max(1, Math.min(l.bbox.w, l.bbox.h));
  const turns = l.ps.filter((p) => p.t === 'turn').length;
  return Math.abs(l.length - recipe.length) / 50 + l.adjust / 120 + Math.max(0, aspect - 1.6) * 3 - turns * 0.08;
}

// ------------------------------------------------------------------ features

type Seg = Record<string, unknown>;

function toSegs(l: Layout, recipe: Recipe, rng: SeededRandom): { segs: Seg[]; shortcuts: Seg[]; log: string[] } {
  const log: string[] = [];
  const segs: Seg[] = l.ps.map((p) => (p.t === 'str' ? { s: p.len } : p.dir > 0 ? { R: p.deg, r: p.r } : { L: p.deg, r: p.r }));
  const used = new Set<number>([0, segs.length - 1]);
  const lenOf = (i: number): number => {
    const p = l.ps[i]!;
    return p.t === 'str' ? p.len : (p.deg * Math.PI * p.r) / 180;
  };
  const isStr = (i: number): boolean => l.ps[i]!.t === 'str';
  const free = (i: number): boolean => !used.has(i) && !used.has(i - 1) && !used.has(i + 1);
  const moverAt = new Set<number>();
  const choose = (ok: (i: number) => boolean, n: number, what: string, apply: (i: number, k: number) => void, spread = true, mover = false): void => {
    // Movers may neighbour other movers (an obstacle gauntlet), never jumps / shortcuts.
    const avail = (i: number): boolean => (mover ? !used.has(i) && [i - 1, i + 1].every((j) => !used.has(j) || moverAt.has(j)) : free(i));
    let cands = segs.map((_, i) => i).filter((i) => avail(i) && ok(i));
    for (let k = 0; k < n; k++) {
      cands = cands.filter((i) => avail(i));
      if (!cands.length) {
        log.push(`${recipe.id}: only ${k}/${n} ${what}`);
        return;
      }
      const i = spread ? cands[Math.floor(rng.next() * cands.length)]! : cands[0]!;
      used.add(i);
      if (mover) moverAt.add(i);
      apply(i, k);
    }
  };
  const f = recipe.features;
  const hw = HW[recipe.difficulty];
  const gentle = (i: number): boolean => {
    const p = l.ps[i]!;
    return p.t === 'turn' && p.r >= 45 && p.deg <= 80;
  };

  // Shortcuts first (they need specific hairpin shapes).
  const shortcuts: Seg[] = [];
  if (f.shortcuts && !recipe.space) {
    let n = 0;
    for (let i = 1; i + 2 < l.ps.length && n < f.shortcuts; i++) {
      const p = l.ps[i]!;
      if (p.t !== 'turn' || p.tag !== 'hairpin') continue;
      if (!(l.ps[i - 1]!.t === 'str' && l.ps[i + 1]!.t === 'str') || used.has(i - 1) || used.has(i + 1) || used.has(i + 2)) continue;
      const from = `cut${n}In`;
      const to = `cut${n}Out`;
      segs[i - 1]!.mark = from;
      segs[i + 2]!.mark = to;
      [i - 1, i, i + 1, i + 2].forEach((k) => used.add(k));
      shortcuts.push({ from, to, side: p.dir > 0 ? 'right' : 'left', halfWidth: 4 });
      n++;
    }
    if (n < f.shortcuts) log.push(`${recipe.id}: only ${n}/${f.shortcuts} shortcuts`);
  }
  choose((i) => isStr(i) && lenOf(i) >= 140, f.gapJumps ?? 0, 'gap jumps', (i) => {
    segs[i]!.jump = { gap: recipe.difficulty === 'hard' ? 18 : 15 };
    segs[i]!.kind = 'void';
  });
  choose((i) => isStr(i) && lenOf(i) >= 100, f.jumps ?? 0, 'jumps', (i) => (segs[i]!.jump = {}));
  choose((i) => isStr(i) && lenOf(i) >= 90, f.tunnels ?? 0, 'tunnels', (i) => (segs[i]!.kind = 'tunnel'));
  choose((i) => (isStr(i) && lenOf(i) >= 50 && lenOf(i) < 145) || gentle(i), f.void ?? 0, 'void', (i) => {
    segs[i]!.kind = 'void';
    segs[i]!.w = Math.round((hw - 0.6) * 10) / 10;
    // Restore the width after the void stretch.
    if (i + 1 < segs.length && segs[i + 1]!.w === undefined) segs[i + 1]!.w = hw;
  });
  if (f.streams) {
    const style = f.streams.style;
    choose((i) => isStr(i) && lenOf(i) >= 80, f.streams.n, 'streams', (_i, k) => {
      const i = _i;
      const lateral = [0, -0.35, 0.35][k % 3]! * hw;
      segs[i]!.stream = { lateral: Math.round(lateral * 10) / 10, width: recipe.difficulty === 'easy' ? 7 : 6, strength: 7, style };
    });
  }
  for (const [kind, n] of Object.entries(f.movers ?? {})) {
    const ok = (i: number): boolean => {
      const L = lenOf(i);
      const p = l.ps[i]!;
      const roomy = p.t === 'turn' && p.r >= 38 && L >= 40;
      if (kind === 'stomper' || kind === 'pendulum') return (isStr(i) && L >= 38 && L <= 190) || roomy;
      if (kind === 'roller' || kind === 'sweeper') return (isStr(i) && L >= 38) || roomy;
      return (isStr(i) && L >= 35) || (p.t === 'turn' && p.r >= 25 && L >= 30);
    };
    choose(ok, n ?? 0, `${kind} sets`, (i) => (segs[i]!.movers = kind), true, true);
  }
  choose((i) => isStr(i) && lenOf(i) >= 50, f.hazards ?? 0, 'hazard sets', (i) => (segs[i]!.hazards = 2));
  choose((i) => isStr(i) && lenOf(i) >= 70, f.boosts ?? 0, 'boosts', (i) => (segs[i]!.boost = true));

  // Hills: smooth periodic altitude profile, grade-limited per segment.
  const total = l.length;
  const ph = [rng.range(0, 6.28), rng.range(0, 6.28), rng.range(0, 6.28)];
  const alt = (s: number): number => {
    const u = (s / total) * Math.PI * 2;
    return recipe.hills * (0.6 * Math.sin(u + ph[0]!) + 0.3 * Math.sin(2 * u + ph[1]!) + 0.25 * Math.sin(3 * u + ph[2]!));
  };
  let s = 0;
  segs.forEach((seg, i) => {
    const L = lenOf(i);
    if (i > 0 && !seg.jump && seg.kind !== 'tunnel') {
      let up = alt(s + L) - alt(s);
      up = Math.max(-L * 0.09, Math.min(L * 0.09, up));
      if (Math.abs(up) >= 0.5) seg.up = Math.round(up * 10) / 10;
    }
    s += L;
  });
  if (recipe.figure8) figure8Bridge(l, segs, lenOf);
  return { segs, shortcuts, log };
}

/** Raise the segment over the crossing (a level overpass with ramps either side). */
function figure8Bridge(l: Layout, segs: Seg[], lenOf: (i: number) => number): void {
  const pairs = closePairs(l.pts, 30, l.length);
  const [i] = pairs[Math.floor(pairs.length / 2)]!;
  const sx = l.pts[i]!.s;
  const starts: number[] = [];
  let acc = 0;
  segs.forEach((_, k) => {
    starts.push(acc);
    acc += lenOf(k);
  });
  const k = starts.findIndex((st, j) => sx >= st && sx < st + lenOf(j));
  const top0 = starts[k]!;
  const top1 = top0 + lenOf(k);
  const H = 13;
  const ramp = 190;
  const alt = (s: number): number => {
    if (s >= top0 && s <= top1) return H;
    const cyc = (x: number): number => ((x % l.length) + l.length) % l.length;
    const d = Math.min(cyc(top0 - s), cyc(s - top1));
    return d >= ramp ? 0 : (H * (1 + Math.cos((Math.PI * d) / ramp))) / 2;
  };
  // The raised segment is a bridge: the terrain drops away under it for the road below.
  segs[k]!.kind = 'bridge';
  segs.forEach((seg, j) => {
    const up = alt(starts[j]! + lenOf(j)) - alt(starts[j]!);
    if (Math.abs(up) >= 0.3) seg.up = Math.round(up * 10) / 10;
    else delete seg.up;
  });
}

// ------------------------------------------------------------------ output

function fmt(v: unknown): string {
  if (typeof v === 'string') return `'${v}'`;
  if (typeof v === 'number') return String(Math.round(v * 10) / 10);
  if (typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return `[${v.map(fmt).join(', ')}]`;
  const o = v as Record<string, unknown>;
  return `{ ${Object.entries(o).map(([k, x]) => `${k}: ${fmt(x)}`).join(', ')} }`;
}

const only = process.argv.slice(2);
const outPath = 'shared/src/tracks/layouts.ts';
const existing = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : '';
const blocks = new Map<string, string>();
for (const m of existing.matchAll(/\n  '([a-z0-9-]+)': \{\n[\s\S]*?\n  \},/g)) blocks.set(m[1]!, m[0]);

for (const recipe of RECIPES) {
  if (only.length && !only.includes(recipe.id)) continue;
  const t0 = Date.now();
  const rng = new SeededRandom(recipe.seed * 7919);
  let best: Layout | null = null;
  let bestScore = Infinity;
  let found = 0;
  for (let tries = 0; tries < 60000 && found < 40; tries++) {
    const l = generate(recipe, rng);
    if (!l) continue;
    found++;
    const sc = score(l, recipe);
    if (sc < bestScore) {
      best = l;
      bestScore = sc;
    }
  }
  if (!best) {
    console.log(`✗ ${recipe.id}: no layout found`);
    continue;
  }
  const { segs, shortcuts, log } = toSegs(best, recipe, new SeededRandom(recipe.seed));
  const turns = best.ps.filter((p) => p.t === 'turn').length;
  console.log(`✓ ${recipe.id.padEnd(18)} ${best.length.toFixed(0)} m  ${turns} turns  ${segs.length} segs  bbox ${best.bbox.w.toFixed(0)}×${best.bbox.h.toFixed(0)}  (${found} candidates, ${Date.now() - t0} ms)`);
  for (const line of log) console.log(`   ${line}`);
  const body = segs.map((s) => `      ${fmt(s)},`).join('\n');
  blocks.set(
    recipe.id,
    `\n  '${recipe.id}': {\n    segs: [\n${body}\n    ],\n    shortcuts: ${fmt(shortcuts)},\n  },`,
  );
}

const header = `import type { Seg } from './course';

/**
 * Generated by tools/design-courses.ts from tools/course-recipes.ts — safe to
 * hand-edit (re-running the designer for a track overwrites its entry).
 */
export interface CourseLayout {
  segs: Seg[];
  shortcuts: Array<{ from: string; to: string; side: 'left' | 'right'; halfWidth?: number }>;
}

export const LAYOUTS: Record<string, CourseLayout> = {`;
const order = RECIPES.map((r) => r.id).filter((id) => blocks.has(id));
fs.writeFileSync(outPath, `${header}${order.map((id) => blocks.get(id)).join('')}\n};\n`);
console.log(`wrote ${outPath}`);
