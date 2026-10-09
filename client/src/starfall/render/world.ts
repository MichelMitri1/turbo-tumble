import { COLORS, RADIUS } from '../sim/game';
import type { BuiltMap, Floor, MapDef, Spot } from '../sim/maps';
import type { PView, SfView } from '../sim/view';
import { bean, deadBody, floorPattern, INK, prop, vent } from './art';

/**
 * The top-down world in the original's style: patterned floors, walls with a visible front
 * face along the top edges, props, vents, doors, crewmates sorted by depth with their names,
 * and the vision fog (walls block it; everything outside your sight is dark and empty).
 */

type Ctx = CanvasRenderingContext2D;
const WALL_H = 1.5;

interface Region {
  pts: Array<[number, number]>;
  floor: Floor;
}

const THEME = {
  space: { face: '#7d8a98', faceDark: '#5b6774', wall: '#262c35', bg: '#04050c' },
  sky: { face: '#b4c0cc', faceDark: '#8d9aa8', wall: '#2c3440', bg: '#77b6e8' },
  planet: { face: '#8b7b70', faceDark: '#6c5d53', wall: '#2c2621', bg: '#45505f' },
} as const;

export interface DrawOpts {
  /** Camera centre (world) and pixels per metre. */
  cx: number;
  cy: number;
  scale: number;
  /** Viewer (for fog); null = no fog (security cameras, the menu). */
  eye: { x: number; y: number; r: number } | null;
  /** Show ghosts (the viewer is dead). */
  ghosts: boolean;
  /** My task spots (yellow) and sabotage stations (red). */
  tasks: Spot[];
  alerts: Spot[];
  /** Highlighted player (kill target) / vent / use target. */
  target?: number;
  ventGlow?: number;
  useGlow?: Spot | null;
  /** Override positions (interpolated / predicted). */
  pos?: (p: PView) => [number, number];
  /** Vents being used right now (index → open amount 0–1). */
  ventsOpen?: Map<number, number>;
  names: boolean;
}

export class WorldRenderer {
  readonly def: MapDef;
  private regions: Region[] = [];
  private stars: Array<[number, number, number]> = [];
  private walk = new Map<number, { phase: number; x: number; y: number }>();
  private fog: HTMLCanvasElement;
  private theme: (typeof THEME)[keyof typeof THEME];

  constructor(private map: BuiltMap) {
    this.def = map.def;
    this.theme = THEME[this.def.theme];
    const rect = (r: [number, number, number, number]): Array<[number, number]> => [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];
    for (const o of this.def.outdoor ?? []) this.regions.push({ pts: rect(o.rect), floor: o.floor });
    for (const h of this.def.halls) this.regions.push({ pts: rect(h), floor: this.def.theme === 'planet' ? 'metal' : 'hall' });
    for (const r of this.def.rooms) this.regions.push({ pts: r.poly ?? rect(r.rect!), floor: r.floor });
    let s = 12345;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 500; i++) this.stars.push([rnd(), rnd(), 0.2 + rnd() * 0.8]);
    this.fog = document.createElement('canvas');
  }

  /** Visible polygon from the eye (rays stop at walls; furniture doesn't block sight). */
  visionPoly(x: number, y: number, r: number): Array<[number, number]> {
    const n = 220;
    const out: Array<[number, number]> = [];
    const g = this.map.grid;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      let d = g.ray(x, y, dx, dy, r);
      // Light the wall you're looking at (and the face of a wall to the north).
      if (d < r) d = Math.min(r + 2, d + 0.3 + (dy < -0.2 ? Math.min(3, WALL_H / -dy) : 0));
      out.push([x + dx * d, y + dy * d]);
    }
    return out;
  }

  /** Is a point visible from the eye? */
  visible(eye: { x: number; y: number; r: number }, x: number, y: number): boolean {
    return Math.hypot(x - eye.x, y - eye.y) <= eye.r + 0.2 && this.map.grid.sees(eye.x, eye.y, x, y);
  }

  draw(ctx: Ctx, w: number, h: number, v: SfView, t: number, o: DrawOpts): void {
    const S = o.scale;
    ctx.save();
    this.background(ctx, w, h, o, t);
    ctx.translate(w / 2, h / 2);
    ctx.scale(S, S);
    ctx.translate(-o.cx, -o.cy);
    const vx0 = o.cx - w / 2 / S - 3;
    const vx1 = o.cx + w / 2 / S + 3;
    const vy0 = o.cy - h / 2 / S - 3;
    const vy1 = o.cy + h / 2 / S + 4;
    const inView = (x: number, y: number, m = 2) => x > vx0 - m && x < vx1 + m && y > vy0 - m && y < vy1 + m;
    this.structure(ctx);
    // Props under people (sorted by their front edge).
    for (const p of this.def.props) if (inView(p.x, p.y, (p.w ?? p.r ?? 2) + 2)) prop(ctx, p, t);
    // Vents.
    this.def.vents.forEach((vt, i) => inView(vt.x, vt.y) && vent(ctx, vt.x, vt.y, o.ventsOpen?.get(i) ?? 0));
    if (o.ventGlow !== undefined && o.ventGlow >= 0) {
      const vt = this.def.vents[o.ventGlow]!;
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = 0.09;
      ctx.beginPath();
      ctx.roundRect(vt.x - 0.56, vt.y - 0.38, 1.12, 0.76, 0.1);
      ctx.stroke();
    }
    this.doors(ctx, v);
    // Task / sabotage markers.
    const pulse = 0.5 + Math.sin(t * 5) * 0.5;
    for (const s of o.tasks) if (inView(s.x, s.y)) this.marker(ctx, s.x, s.y, '#ffd23f', pulse);
    for (const s of o.alerts) if (inView(s.x, s.y)) this.marker(ctx, s.x, s.y, '#ff3b3b', pulse);
    if (o.useGlow) this.marker(ctx, o.useGlow.x, o.useGlow.y, '#ffffff', 1);
    // Bodies, then people by depth.
    const eye = o.eye;
    for (const b of v.bodies) {
      if (!inView(b.x, b.y)) continue;
      if (eye && !this.visible(eye, b.x, b.y)) continue;
      const c = COLORS[b.color]!;
      deadBody(ctx, b.x, b.y + 0.2, c[1], c[2]);
    }
    const people = v.players
      .filter((p) => !p.hidden && (p.alive || o.ghosts || p.id === v.me))
      .map((p) => ({ p, at: o.pos ? o.pos(p) : ([p.x, p.y] as [number, number]) }))
      .filter(({ p, at }) => inView(at[0], at[1]) && (!eye || p.id === v.me || !p.alive || this.visible(eye, at[0], at[1])))
      .sort((a, b) => a.at[1] - b.at[1]);
    for (const { p, at } of people) this.person(ctx, p, at[0], at[1], t, o);
    if (o.names)
      for (const { p, at } of people) {
        if (!p.alive && !o.ghosts) continue;
        this.nameTag(ctx, p, at[0], at[1], v, S);
      }
    ctx.restore();
    if (eye) this.drawFog(ctx, w, h, eye, o);
  }

  private background(ctx: Ctx, w: number, h: number, o: DrawOpts, t: number): void {
    const th = this.def.theme;
    if (th === 'space') {
      ctx.fillStyle = this.theme.bg;
      ctx.fillRect(0, 0, w, h);
      // Stars drifting past (parallax with the camera).
      for (const [sx, sy, z] of this.stars) {
        const px = (((sx * 3000 - o.cx * o.scale * z * 0.08 - t * 30 * z) % w) + w) % w;
        const py = (((sy * 2000 - o.cy * o.scale * z * 0.08) % h) + h) % h;
        ctx.fillStyle = `rgba(255,255,255,${0.3 + z * 0.6})`;
        ctx.fillRect(px, py, z * 2.2, z * 2.2);
      }
    } else if (th === 'sky') {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#5aa0de');
      g.addColorStop(1, '#a9d4f5');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      for (let i = 0; i < 14; i++) {
        const [sx, sy, z] = this.stars[i]!;
        const px = (((sx * 4000 - o.cx * o.scale * 0.3 + t * 12 * z) % (w + 400)) + w + 400) % (w + 400) - 200;
        const py = (((sy * 3000 - o.cy * o.scale * 0.3) % (h + 200)) + h + 200) % (h + 200) - 100;
        for (let k = 0; k < 4; k++) {
          ctx.beginPath();
          ctx.ellipse(px + k * 40 * z, py + Math.sin(k) * 10, 70 * z, 34 * z, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else {
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.scale(o.scale, o.scale);
      ctx.translate(-o.cx, -o.cy);
      ctx.fillStyle = floorPattern(ctx, 'rock');
      const x0 = o.cx - w / o.scale;
      const y0 = o.cy - h / o.scale;
      ctx.fillRect(x0, y0, (w / o.scale) * 2, (h / o.scale) * 2);
      ctx.fillStyle = 'rgba(40,46,60,0.45)';
      ctx.fillRect(x0, y0, (w / o.scale) * 2, (h / o.scale) * 2);
      ctx.restore();
    }
  }

  /** Floors and walls (walls first, floors over them: joins between rooms open up by themselves). */
  private structure(ctx: Ctx): void {
    const th = this.theme;
    const path = (pts: Array<[number, number]>) => {
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
    };
    // Wall faces along the top edges (and slanted top edges).
    for (const r of this.regions) {
      if (r.floor === 'snow' || r.floor === 'rock') continue;
      const pts = r.pts;
      for (let i = 0; i < pts.length; i++) {
        const [x0, y0] = pts[i]!;
        const [x1, y1] = pts[(i + 1) % pts.length]!;
        // Clockwise polygons (y down): an edge going right is a top edge.
        if (x1 <= x0 + 1e-6) continue;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.lineTo(x1, y1 - WALL_H);
        ctx.lineTo(x0, y0 - WALL_H);
        ctx.closePath();
        const g = ctx.createLinearGradient(0, y0 - WALL_H, 0, y0);
        g.addColorStop(0, th.faceDark);
        g.addColorStop(0.15, th.face);
        g.addColorStop(0.85, th.face);
        g.addColorStop(1, th.faceDark);
        ctx.fillStyle = g;
        ctx.fill();
        ctx.lineWidth = 0.12;
        ctx.strokeStyle = th.wall;
        ctx.stroke();
        // Panel seams.
        ctx.strokeStyle = 'rgba(0,0,0,0.18)';
        ctx.lineWidth = 0.05;
        for (let x = Math.ceil(x0 / 2) * 2; x < x1; x += 2) {
          const yy = y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
          ctx.beginPath();
          ctx.moveTo(x, yy - WALL_H + 0.2);
          ctx.lineTo(x, yy - 0.15);
          ctx.stroke();
        }
      }
    }
    // Wall outline (half of it disappears under the floor).
    ctx.lineJoin = 'round';
    ctx.strokeStyle = th.wall;
    ctx.lineWidth = 0.6;
    for (const r of this.regions) {
      if (r.floor === 'snow') continue;
      path(r.pts);
      ctx.stroke();
    }
    // Floors.
    for (const r of this.regions) {
      path(r.pts);
      ctx.fillStyle = floorPattern(ctx, r.floor);
      ctx.fill();
    }
    // Snow edges: soft drifts instead of walls.
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 0.15;
    for (const r of this.regions) if (r.floor === 'snow') {
      path(r.pts);
      ctx.stroke();
    }
  }

  private doors(ctx: Ctx, v: SfView): void {
    const closed = new Set(v.doors);
    for (const d of this.def.doors) {
      const [x0, y0, x1, y1] = d.rect;
      const horiz = x1 - x0 > y1 - y0;
      ctx.lineWidth = 0.06;
      ctx.strokeStyle = INK;
      if (closed.has(d.room)) {
        ctx.fillStyle = '#9aa6b2';
        if (horiz) {
          ctx.fillRect(x0, y0 - 1.1, x1 - x0, y1 - y0 + 1.1);
          ctx.strokeRect(x0, y0 - 1.1, x1 - x0, y1 - y0 + 1.1);
        } else {
          ctx.fillRect(x0, y0 - 0.6, x1 - x0, y1 - y0 + 0.6);
          ctx.strokeRect(x0, y0 - 0.6, x1 - x0, y1 - y0 + 0.6);
        }
        // Hazard stripes.
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0, y1 - 0.3, x1 - x0, 0.3);
        ctx.clip();
        ctx.fillStyle = '#ffd23f';
        ctx.fillRect(x0, y1 - 0.3, x1 - x0, 0.3);
        ctx.strokeStyle = INK;
        ctx.lineWidth = 0.1;
        for (let x = x0 - 1; x < x1 + 1; x += 0.35) {
          ctx.beginPath();
          ctx.moveTo(x, y1);
          ctx.lineTo(x + 0.3, y1 - 0.3);
          ctx.stroke();
        }
        ctx.restore();
      } else {
        // Open: just the frame at each side.
        ctx.fillStyle = '#4b5560';
        if (horiz) {
          ctx.fillRect(x0 - 0.15, y0 - 0.2, 0.3, y1 - y0 + 0.3);
          ctx.fillRect(x1 - 0.15, y0 - 0.2, 0.3, y1 - y0 + 0.3);
        } else {
          ctx.fillRect(x0, y0 - 0.15, x1 - x0, 0.3);
          ctx.fillRect(x0, y1 - 0.15, x1 - x0, 0.3);
        }
      }
    }
  }

  private marker(ctx: Ctx, x: number, y: number, col: string, pulse: number): void {
    ctx.save();
    ctx.strokeStyle = col;
    ctx.globalAlpha = 0.55 + pulse * 0.45;
    ctx.lineWidth = 0.09;
    ctx.beginPath();
    ctx.ellipse(x, y, 0.55 + pulse * 0.08, 0.38 + pulse * 0.05, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = col;
    ctx.globalAlpha = 0.18;
    ctx.fill();
    ctx.restore();
  }

  private person(ctx: Ctx, p: PView, x: number, y: number, t: number, o: DrawOpts): void {
    // Walk cycle from distance travelled.
    let w = this.walk.get(p.id);
    if (!w) this.walk.set(p.id, (w = { phase: 0, x, y }));
    const moved = Math.hypot(x - w.x, y - w.y);
    w.phase += moved * 4.2;
    w.x = x;
    w.y = y;
    const moving = p.moving || moved > 0.01;
    const c = COLORS[p.color]!;
    if (p.busy === 'scan') {
      // The medbay scanner beam.
      ctx.save();
      const g = ctx.createLinearGradient(0, y - 1.6, 0, y + 0.2);
      g.addColorStop(0, 'rgba(76,241,160,0)');
      g.addColorStop(1, 'rgba(76,241,160,0.55)');
      ctx.fillStyle = g;
      ctx.fillRect(x - 0.6, y - 1.6, 1.2, 1.8);
      ctx.strokeStyle = '#4cf1a0';
      ctx.lineWidth = 0.05;
      const sy = y - 1.2 + ((t * 1.2) % 1.3);
      ctx.beginPath();
      ctx.moveTo(x - 0.55, sy);
      ctx.lineTo(x + 0.55, sy);
      ctx.stroke();
      ctx.restore();
    }
    bean(ctx, x, y + RADIUS * 0.6, c[1], c[2], {
      left: p.left,
      moving,
      phase: p.alive ? w.phase : t * 3,
      ghost: !p.alive,
      glow: o.target === p.id ? '#ff2a2a' : undefined,
    });
  }

  private nameTag(ctx: Ctx, p: PView, x: number, y: number, v: SfView, S: number): void {
    ctx.save();
    ctx.translate(x, y - 0.95);
    ctx.scale(1 / S, 1 / S);
    const fs = Math.max(11, Math.min(18, S * 0.24));
    ctx.font = `900 ${fs}px Nunito, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(p.name, 0, 0);
    const me = v.players[v.me];
    ctx.fillStyle = p.impostor && me?.impostor ? '#ff3b3b' : '#ffffff';
    if (!p.alive) ctx.globalAlpha = 0.6;
    ctx.fillText(p.name, 0, 0);
    ctx.restore();
  }

  private drawFog(ctx: Ctx, w: number, h: number, eye: { x: number; y: number; r: number }, o: DrawOpts): void {
    const f = this.fog;
    if (f.width !== w || f.height !== h) {
      f.width = w;
      f.height = h;
    }
    const g = f.getContext('2d')!;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(10,12,20,0.86)';
    g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'destination-out';
    const S = o.scale;
    const toS = (x: number, y: number): [number, number] => [(x - o.cx) * S + w / 2, (y - o.cy) * S + h / 2];
    const poly = this.visionPoly(eye.x, eye.y, eye.r);
    const [ex, ey] = toS(eye.x, eye.y);
    const grad = g.createRadialGradient(ex, ey, eye.r * S * 0.6, ex, ey, eye.r * S);
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.beginPath();
    poly.forEach(([x, y], i) => {
      const [sx, sy] = toS(x, y);
      if (i) g.lineTo(sx, sy);
      else g.moveTo(sx, sy);
    });
    g.closePath();
    g.fill();
    ctx.drawImage(f, 0, 0);
  }
}
