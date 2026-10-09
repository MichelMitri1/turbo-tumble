/**
 * Ship geometry on a fine grid (0.25 m): what you can walk on, what blocks sight, the wall
 * outlines that get drawn, line of sight, and A* paths for the bots.
 *
 * Walkable = rooms ∪ halls − obstacles (tables, consoles) − closed doors.
 * Vision is blocked only by walls and closed doors (you see across a table).
 */

export const CELL = 0.25;

export type Rect = [number, number, number, number]; // x0, y0, x1, y1
export interface Circle {
  x: number;
  y: number;
  r: number;
}

export interface Segment {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Which side is solid: the wall face is drawn on that side. 'n' = solid above the line. */
  solid: 'n' | 's' | 'w' | 'e';
}

export class Grid {
  readonly w: number;
  readonly h: number;
  readonly ox: number;
  readonly oy: number;
  /** 1 = floor (inside the ship). */
  readonly floor: Uint8Array;
  /** 1 = blocked by furniture. */
  readonly furniture: Uint8Array;
  /** 1 = a closed door. */
  readonly door: Uint8Array;

  constructor(bounds: Rect) {
    this.ox = bounds[0];
    this.oy = bounds[1];
    this.w = Math.ceil((bounds[2] - bounds[0]) / CELL);
    this.h = Math.ceil((bounds[3] - bounds[1]) / CELL);
    this.floor = new Uint8Array(this.w * this.h);
    this.furniture = new Uint8Array(this.w * this.h);
    this.door = new Uint8Array(this.w * this.h);
  }

  ci(x: number): number {
    return Math.floor((x - this.ox) / CELL);
  }
  cj(y: number): number {
    return Math.floor((y - this.oy) / CELL);
  }

  private fillRect(arr: Uint8Array, r: Rect, v: number): void {
    const i0 = Math.max(0, Math.round((r[0] - this.ox) / CELL));
    const j0 = Math.max(0, Math.round((r[1] - this.oy) / CELL));
    const i1 = Math.min(this.w, Math.round((r[2] - this.ox) / CELL));
    const j1 = Math.min(this.h, Math.round((r[3] - this.oy) / CELL));
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) arr[j * this.w + i] = v;
  }
  private fillCircle(arr: Uint8Array, c: Circle, v: number): void {
    for (let j = this.cj(c.y - c.r); j <= this.cj(c.y + c.r); j++)
      for (let i = this.ci(c.x - c.r); i <= this.ci(c.x + c.r); i++) {
        if (i < 0 || j < 0 || i >= this.w || j >= this.h) continue;
        const cx = this.ox + (i + 0.5) * CELL;
        const cy = this.oy + (j + 0.5) * CELL;
        if (Math.hypot(cx - c.x, cy - c.y) <= c.r) arr[j * this.w + i] = v;
      }
  }
  addFloor(r: Rect): void {
    this.fillRect(this.floor, r, 1);
  }
  addPolyFloor(pts: Array<[number, number]>): void {
    for (let j = 0; j < this.h; j++)
      for (let i = 0; i < this.w; i++) if (pointInPoly(this.ox + (i + 0.5) * CELL, this.oy + (j + 0.5) * CELL, pts)) this.floor[j * this.w + i] = 1;
  }
  addFurniture(r: Rect | Circle): void {
    if (Array.isArray(r)) this.fillRect(this.furniture, r, 1);
    else this.fillCircle(this.furniture, r, 1);
  }
  setDoor(r: Rect, closed: boolean): void {
    this.fillRect(this.door, r, closed ? 1 : 0);
    this.clearance = null;
  }
  /** Cells a body fits in (cached; rebuilt when doors change). */
  private clearance: Uint8Array | null = null;
  private clearR = 0;
  private clear(i: number, j: number, r: number): boolean {
    if (!this.clearance || this.clearR !== r) {
      this.clearR = r;
      const c = new Uint8Array(this.w * this.h);
      for (let jj = 0; jj < this.h; jj++) for (let ii = 0; ii < this.w; ii++) if (this.fits(this.ox + (ii + 0.5) * CELL, this.oy + (jj + 0.5) * CELL, r)) c[jj * this.w + ii] = 1;
      this.clearance = c;
    }
    return i >= 0 && j >= 0 && i < this.w && j < this.h && this.clearance[j * this.w + i] === 1;
  }
  /** Nearest point where a body fits (spawns, people pushed out of a closing door). */
  free(x: number, y: number, r: number): [number, number] {
    if (this.fits(x, y, r)) return [x, y];
    for (let d = CELL; d < 6; d += CELL)
      for (let a = 0; a < 16; a++) {
        const px = x + Math.cos((a * Math.PI) / 8) * d;
        const py = y + Math.sin((a * Math.PI) / 8) * d;
        if (this.fits(px, py, r)) return [px, py];
      }
    return [x, y];
  }

  /** Inside the ship (walls block sight; furniture doesn't). */
  open(x: number, y: number): boolean {
    const i = this.ci(x);
    const j = this.cj(y);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return false;
    const k = j * this.w + i;
    return this.floor[k] === 1 && this.door[k] === 0;
  }
  walkCell(i: number, j: number): boolean {
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return false;
    const k = j * this.w + i;
    return this.floor[k] === 1 && this.door[k] === 0 && this.furniture[k] === 0;
  }
  walk(x: number, y: number): boolean {
    return this.walkCell(this.ci(x), this.cj(y));
  }

  /** A body of radius r fits here (every cell it overlaps is walkable). */
  fits(x: number, y: number, r: number): boolean {
    for (let j = this.cj(y - r); j <= this.cj(y + r); j++)
      for (let i = this.ci(x - r); i <= this.ci(x + r); i++) {
        if (this.walkCell(i, j)) continue;
        // Only cells the circle really reaches count (corners are forgiving).
        const nx = Math.max(this.ox + i * CELL, Math.min(x, this.ox + (i + 1) * CELL));
        const ny = Math.max(this.oy + j * CELL, Math.min(y, this.oy + (j + 1) * CELL));
        if ((nx - x) ** 2 + (ny - y) ** 2 < r * r - 1e-6) return false;
      }
    return true;
  }

  /** Move a body, sliding along walls. Never ends up inside anything. */
  move(x: number, y: number, dx: number, dy: number, r: number): [number, number] {
    // Sub-steps so fast moves can't tunnel through thin walls.
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (CELL * 0.5)));
    for (let k = 0; k < n; k++) {
      const sx = dx / n;
      const sy = dy / n;
      if (this.fits(x + sx, y, r)) x += sx;
      if (this.fits(x, y + sy, r)) y += sy;
    }
    return [x, y];
  }

  /** Line of sight (walls and closed doors block). */
  sees(ax: number, ay: number, bx: number, by: number): boolean {
    const d = Math.hypot(bx - ax, by - ay);
    const n = Math.ceil(d / (CELL * 0.5));
    for (let k = 1; k < n; k++) if (!this.open(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n)) return false;
    return true;
  }

  /** Distance a ray travels before hitting a wall (for the vision polygon). */
  ray(x: number, y: number, dx: number, dy: number, max: number): number {
    // DDA over cells.
    let i = this.ci(x);
    let j = this.cj(y);
    const sx = dx > 0 ? 1 : -1;
    const sy = dy > 0 ? 1 : -1;
    const tdx = dx !== 0 ? Math.abs(CELL / dx) : Infinity;
    const tdy = dy !== 0 ? Math.abs(CELL / dy) : Infinity;
    let tx = dx !== 0 ? ((dx > 0 ? this.ox + (i + 1) * CELL : this.ox + i * CELL) - x) / dx : Infinity;
    let ty = dy !== 0 ? ((dy > 0 ? this.oy + (j + 1) * CELL : this.oy + j * CELL) - y) / dy : Infinity;
    let t = 0;
    while (t < max) {
      if (tx < ty) {
        t = tx;
        tx += tdx;
        i += sx;
      } else {
        t = ty;
        ty += tdy;
        j += sy;
      }
      if (i < 0 || j < 0 || i >= this.w || j >= this.h) return Math.min(t, max);
      const k = j * this.w + i;
      if (this.floor[k] === 0 || this.door[k] === 1) return Math.min(t, max);
    }
    return max;
  }

  /** The outline of the ship: boundary edges between floor and outside, merged into long segments. */
  outline(): Segment[] {
    const out: Segment[] = [];
    const f = (i: number, j: number) => i >= 0 && j >= 0 && i < this.w && j < this.h && this.floor[j * this.w + i] === 1;
    // Horizontal edges (between rows j-1 and j).
    for (let j = 0; j <= this.h; j++) {
      let run: { i0: number; solid: 'n' | 's' } | null = null;
      for (let i = 0; i <= this.w; i++) {
        const above = f(i, j - 1);
        const below = f(i, j);
        const kind: 'n' | 's' | null = i < this.w && above !== below ? (below ? 'n' : 's') : null;
        if (run && kind !== run.solid) {
          out.push({ x0: this.ox + run.i0 * CELL, y0: this.oy + j * CELL, x1: this.ox + i * CELL, y1: this.oy + j * CELL, solid: run.solid });
          run = null;
        }
        if (kind && !run) run = { i0: i, solid: kind };
      }
    }
    for (let i = 0; i <= this.w; i++) {
      let run: { j0: number; solid: 'w' | 'e' } | null = null;
      for (let j = 0; j <= this.h; j++) {
        const left = f(i - 1, j);
        const right = f(i, j);
        const kind: 'w' | 'e' | null = j < this.h && left !== right ? (right ? 'w' : 'e') : null;
        if (run && kind !== run.solid) {
          out.push({ x0: this.ox + i * CELL, y0: this.oy + run.j0 * CELL, x1: this.ox + i * CELL, y1: this.oy + j * CELL, solid: run.solid });
          run = null;
        }
        if (kind && !run) run = { j0: j, solid: kind };
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- paths (bots)

  /** A* over walkable cells (8-way, no corner cutting). Returns world waypoints. */
  path(ax: number, ay: number, bx: number, by: number, r = 0.3): Array<[number, number]> {
    const W = this.w;
    const clear = (i: number, j: number) => this.clear(i, j, r);
    let si = this.ci(ax);
    let sj = this.cj(ay);
    let gi = this.ci(bx);
    let gj = this.cj(by);
    // Snap start / goal to the nearest clear cell.
    const snap = (i: number, j: number): [number, number] => {
      if (clear(i, j)) return [i, j];
      for (let rr = 1; rr < 12; rr++)
        for (let dj = -rr; dj <= rr; dj++)
          for (let di = -rr; di <= rr; di++) if (Math.max(Math.abs(di), Math.abs(dj)) === rr && clear(i + di, j + dj)) return [i + di, j + dj];
      return [i, j];
    };
    [si, sj] = snap(si, sj);
    [gi, gj] = snap(gi, gj);
    const start = sj * W + si;
    const goal = gj * W + gi;
    const g = new Map<number, number>([[start, 0]]);
    const came = new Map<number, number>();
    const open: Array<[number, number]> = [[0, start]];
    const closed = new Set<number>();
    const h = (k: number) => Math.hypot((k % W) - gi, Math.floor(k / W) - gj);
    const push = (e: [number, number]) => {
      open.push(e);
      let c = open.length - 1;
      while (c > 0) {
        const p = (c - 1) >> 1;
        if (open[p]![0] <= open[c]![0]) break;
        [open[p], open[c]] = [open[c]!, open[p]!];
        c = p;
      }
    };
    const pop = () => {
      const top = open[0]!;
      const last = open.pop()!;
      if (open.length) {
        open[0] = last;
        let c = 0;
        for (;;) {
          const l = c * 2 + 1;
          const rr = l + 1;
          let m = c;
          if (l < open.length && open[l]![0] < open[m]![0]) m = l;
          if (rr < open.length && open[rr]![0] < open[m]![0]) m = rr;
          if (m === c) break;
          [open[m], open[c]] = [open[c]!, open[m]!];
          c = m;
        }
      }
      return top;
    };
    let found = false;
    for (let it = 0; it < 60000 && open.length; it++) {
      const [, cur] = pop();
      if (cur === goal) {
        found = true;
        break;
      }
      if (closed.has(cur)) continue;
      closed.add(cur);
      const ci = cur % W;
      const cj = Math.floor(cur / W);
      for (const [di, dj] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ] as Array<[number, number]>) {
        const ni = ci + di;
        const nj = cj + dj;
        if (!clear(ni, nj)) continue;
        if (di && dj && (!clear(ci + di, cj) || !clear(ci, cj + dj))) continue;
        const nk = nj * W + ni;
        const ng = g.get(cur)! + (di && dj ? 1.414 : 1);
        if (ng < (g.get(nk) ?? Infinity)) {
          g.set(nk, ng);
          came.set(nk, cur);
          push([ng + h(nk), nk]);
        }
      }
    }
    if (!found) return [];
    const cells: number[] = [goal];
    let c = goal;
    while (came.has(c)) cells.push((c = came.get(c)!));
    cells.reverse();
    // String-pull: keep only the corners (a straight walk between kept points is clear).
    const pts = cells.map((k) => [this.ox + ((k % W) + 0.5) * CELL, this.oy + (Math.floor(k / W) + 0.5) * CELL] as [number, number]);
    const out: Array<[number, number]> = [];
    let a = 0;
    while (a < pts.length - 1) {
      let b = pts.length - 1;
      while (b > a + 1 && !this.straight(pts[a]!, pts[b]!, r)) b--;
      out.push(pts[b]!);
      a = b;
    }
    if (out.length) out[out.length - 1] = [bx, by];
    return out;
  }

  private straight(a: [number, number], b: [number, number], r: number): boolean {
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.ceil(d / (CELL * 0.5));
    for (let k = 0; k <= n; k++) if (!this.fits(a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n, r * 0.95)) return false;
    return true;
  }
}

export function pointInPoly(x: number, y: number, pts: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]!;
    const [xj, yj] = pts[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
