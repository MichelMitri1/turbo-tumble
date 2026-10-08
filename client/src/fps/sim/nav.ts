import type { Level } from './level';

/**
 * Bot navigation: a 1 m grid of walkable cells, layered by height (ground,
 * stairs, upper floors, crate tops), linked to neighbours you can walk / step to.
 * Paths come from A*.
 */
export interface NavNode {
  x: number;
  y: number;
  z: number;
  links: number[];
}

const CELL = 1;
const CLEAR = 1.7;
const R = 0.3;

export class NavGrid {
  readonly nodes: NavNode[] = [];
  private cells = new Map<number, number[]>();
  private readonly ox: number;
  private readonly oz: number;

  constructor(
    level: Level,
    halfX: number,
    halfZ: number,
  ) {
    this.ox = -halfX;
    this.oz = -halfZ;
    const nx = Math.floor((2 * halfX) / CELL);
    const nz = Math.floor((2 * halfZ) / CELL);
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < nz; j++) {
        const x = this.ox + (i + 0.5) * CELL;
        const z = this.oz + (j + 0.5) * CELL;
        const heights = new Set<number>([0]);
        for (const b of level.query(x - R, z - R, x + R, z + R)) {
          if (b.mat === 'invisible') continue;
          if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) heights.add(+b.y1.toFixed(3));
        }
        const ids: number[] = [];
        for (const y of heights) {
          if (level.blocked(x - R, y + 0.5, z - R, x + R, y + CLEAR, z + R)) continue;
          // Need ground under the whole cell centre.
          if (y > 0 && level.floorAt(x, z, y + 0.01) < y - 0.01) continue;
          ids.push(this.nodes.length);
          this.nodes.push({ x, y, z, links: [] });
        }
        if (ids.length) this.cells.set(i * 10000 + j, ids);
      }
    // Links.
    for (const [key, ids] of this.cells) {
      const i = Math.floor(key / 10000);
      const j = key % 10000;
      for (const a of ids) {
        const na = this.nodes[a]!;
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
          const other = this.cells.get((i + di) * 10000 + (j + dj));
          if (!other) continue;
          for (const b of other) {
            const nb = this.nodes[b]!;
            if (Math.abs(nb.y - na.y) > 1.0) continue;
            // Diagonals must not cut corners.
            if (di && dj && (!this.walk(i + di, j, na.y) || !this.walk(i, j + dj, na.y))) continue;
            const mx = (na.x + nb.x) / 2;
            const mz = (na.z + nb.z) / 2;
            const y = Math.max(na.y, nb.y);
            if (level.blocked(mx - R, y + 0.55, mz - R, mx + R, y + CLEAR, mz + R)) continue;
            na.links.push(b);
          }
        }
      }
    }
  }

  private walk(i: number, j: number, y: number): boolean {
    return (this.cells.get(i * 10000 + j) ?? []).some((n) => Math.abs(this.nodes[n]!.y - y) <= 1.0);
  }

  /** Nearest node to a position (same floor preferred). */
  nearest(x: number, y: number, z: number): number {
    const i = Math.floor((x - this.ox) / CELL);
    const j = Math.floor((z - this.oz) / CELL);
    let best = -1;
    let bd = Infinity;
    for (let r = 0; r < 4 && best < 0; r++)
      for (let di = -r; di <= r; di++)
        for (let dj = -r; dj <= r; dj++) {
          for (const n of this.cells.get((i + di) * 10000 + (j + dj)) ?? []) {
            const nd = this.nodes[n]!;
            const d = (nd.x - x) ** 2 + (nd.z - z) ** 2 + (nd.y - y) ** 2 * 4;
            if (d < bd) {
              bd = d;
              best = n;
            }
          }
        }
    return best;
  }

  /** Connected-component id per node (so unreachable goals are rejected instantly). */
  private comp: Int32Array | null = null;
  component(n: number): number {
    if (!this.comp) {
      const c = new Int32Array(this.nodes.length).fill(-1);
      let id = 0;
      for (let i = 0; i < this.nodes.length; i++) {
        if (c[i]! >= 0) continue;
        const st = [i];
        c[i] = id;
        while (st.length) {
          const x = st.pop()!;
          for (const l of this.nodes[x]!.links) if (c[l]! < 0) {
            c[l] = id;
            st.push(l);
          }
        }
        id++;
      }
      this.comp = c;
    }
    return n < 0 ? -1 : this.comp[n]!;
  }

  /** A* path (node ids), or [] if unreachable. Binary heap open list. */
  path(from: number, to: number, maxIter = 4000): number[] {
    if (from < 0 || to < 0 || this.component(from) !== this.component(to)) return [];
    if (from === to) return [to];
    const N = this.nodes;
    const g = new Map<number, number>([[from, 0]]);
    const came = new Map<number, number>();
    const heap: Array<[number, number]> = [[0, from]];
    const push = (e: [number, number]) => {
      heap.push(e);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p]![0] <= heap[i]![0]) break;
        [heap[p], heap[i]] = [heap[i]!, heap[p]!];
        i = p;
      }
    };
    const pop = (): [number, number] => {
      const top = heap[0]!;
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1;
          const r = l + 1;
          let m = i;
          if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l;
          if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i]!, heap[m]!];
          i = m;
        }
      }
      return top;
    };
    const T = N[to]!;
    const h = (a: number) => {
      const n = N[a]!;
      return Math.hypot(n.x - T.x, n.z - T.z) + Math.abs(n.y - T.y) * 2;
    };
    const closed = new Set<number>();
    for (let it = 0; it < maxIter && heap.length; it++) {
      const [, cur] = pop();
      if (cur === to) {
        const out = [cur];
        let c = cur;
        while (came.has(c)) out.push((c = came.get(c)!));
        return out.reverse();
      }
      if (closed.has(cur)) continue;
      closed.add(cur);
      const gc = g.get(cur)!;
      const nc = N[cur]!;
      for (const nb of nc.links) {
        if (closed.has(nb)) continue;
        const nn = N[nb]!;
        const ng = gc + (nn.x !== nc.x && nn.z !== nc.z ? 1.414 : 1) + Math.abs(nn.y - nc.y);
        if (ng < (g.get(nb) ?? Infinity)) {
          g.set(nb, ng);
          came.set(nb, cur);
          push([ng + h(nb), nb]);
        }
      }
    }
    return [];
  }

  /** A random walkable node. */
  random(rand: () => number): number {
    return Math.floor(rand() * this.nodes.length);
  }
}
