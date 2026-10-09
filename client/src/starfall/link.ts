import { Bots } from './sim/bots';
import { Game, RADIUS, SPEED, TICK, type Action, type Config, type Event } from './sim/game';
import { buildMap, MAP, type BuiltMap } from './sim/maps';
import { eventsFor, viewFor, type PView, type SfView } from './sim/view';
import type { StarfallNet } from './net/online';
import type { SfSnap } from './net/protocol';

/** What the game screen talks to: a local game vs bots, or an online room. */
export interface Link {
  readonly online: boolean;
  readonly me: number;
  readonly map: BuiltMap;
  view: SfView | null;
  onEvents: ((e: Event[]) => void) | null;
  onError: ((msg: string) => void) | null;
  /** Movement direction this frame (length ≤ 1). */
  steer(dx: number, dy: number): void;
  act(a: Action): void;
  tick(dt: number): void;
  /** Where to draw a player (smoothed / predicted). */
  pos(p: PView): [number, number];
  dispose(): void;
}

export { BOT_NAMES } from './sim/game';

export class LocalLink implements Link {
  readonly online = false;
  readonly me = 0;
  readonly map: BuiltMap;
  readonly game: Game;
  private bots: Bots;
  view: SfView | null = null;
  onEvents: Link['onEvents'] = null;
  onError: Link['onError'] = null;
  private acc = 0;
  private prev: Array<[number, number]> = [];
  paused = false;

  constructor(cfg: Config, people: Array<{ name: string; color: number; bot: boolean }>, opts: { role?: 'crew' | 'impostor' | 'random' } = {}) {
    // Re-roll the seed until the human gets the role they asked for (practice).
    let seed = (Math.random() * 2 ** 31) | 0;
    let g = new Game(cfg, people, seed);
    for (let k = 0; k < 200 && opts.role && opts.role !== 'random' && g.players[0]!.impostor !== (opts.role === 'impostor'); k++) g = new Game(cfg, people, (seed = seed + 7919));
    this.game = g;
    this.map = g.map;
    this.bots = new Bots(g);
    this.view = viewFor(g, 0);
    this.prev = g.players.map((p) => [p.x, p.y]);
  }

  steer(dx: number, dy: number): void {
    const p = this.game.players[0]!;
    p.ix = dx;
    p.iy = dy;
  }

  act(a: Action): void {
    const err = this.game.act(0, a);
    if (err) this.onError?.(err);
    this.view = viewFor(this.game, 0);
  }

  tick(dt: number): void {
    if (this.paused) return;
    const g = this.game;
    this.acc += Math.min(dt, 0.25);
    const out: Event[] = [];
    let n = 0;
    while (this.acc >= TICK && n++ < 8) {
      this.acc -= TICK;
      this.prev = g.players.map((p) => [p.x, p.y]);
      this.bots.update(TICK);
      g.step(TICK);
      const evs = g.events.splice(0);
      this.bots.events(evs);
      out.push(...eventsFor(g, 0, evs));
    }
    this.view = viewFor(g, 0);
    if (out.length) this.onEvents?.(out);
  }

  pos(p: PView): [number, number] {
    const a = this.prev[p.id];
    const q = this.game.players[p.id]!;
    if (!a || Math.hypot(a[0] - q.x, a[1] - q.y) > 1.5) return [q.x, q.y];
    const f = Math.min(1, this.acc / TICK);
    return [a[0] + (q.x - a[0]) * f, a[1] + (q.y - a[1]) * f];
  }

  dispose(): void {
    this.onEvents = null;
  }
}

/** An online game: the server sends my view ~15 times a second; I predict my own movement. */
export class OnlineLink implements Link {
  readonly online = true;
  readonly me: number;
  readonly map: BuiltMap;
  view: SfView | null = null;
  onEvents: Link['onEvents'] = null;
  onError: Link['onError'] = null;
  private my: { x: number; y: number; left: boolean; moving: boolean } = { x: 0, y: 0, left: false, moving: false };
  private dir: [number, number] = [0, 0];
  private sendT = 0;
  private interp = new Map<number, { fx: number; fy: number; tx: number; ty: number; t0: number }>();
  private interval = 1 / 15;
  private lastSnap = 0;
  private doorsKey = '';
  /** Busy at a panel (no walking). */
  frozen = false;

  constructor(private net: StarfallNet, me: number, map: string) {
    this.me = me;
    this.map = buildMap(MAP[map] ?? MAP.vanguard!);
    net.onSnap = (s) => this.receive(s);
    net.onError = (m) => this.onError?.(m);
  }

  private receive(s: SfSnap): void {
    const nowT = performance.now() / 1000;
    if (this.lastSnap) this.interval = this.interval * 0.8 + Math.min(0.3, nowT - this.lastSnap) * 0.2;
    this.lastSnap = nowT;
    const first = !this.view;
    this.view = s.v;
    for (const p of s.v.players) {
      const cur = this.interp.get(p.id);
      if (!cur || Math.hypot(cur.tx - p.x, cur.ty - p.y) > 3) this.interp.set(p.id, { fx: p.x, fy: p.y, tx: p.x, ty: p.y, t0: nowT });
      else {
        const [x, y] = this.lerp(cur, nowT);
        this.interp.set(p.id, { fx: x, fy: y, tx: p.x, ty: p.y, t0: nowT });
      }
    }
    // My position: the server's when I can't move or it moved me (kill, meeting, vent).
    const me = s.v.players[this.me]!;
    if (first || s.v.phase !== 'play' || s.v.vent >= 0 || Math.hypot(me.x - this.my.x, me.y - this.my.y) > 2.2) {
      this.my.x = me.x;
      this.my.y = me.y;
    }
    const key = s.v.doors.join(',');
    if (key !== this.doorsKey) {
      this.doorsKey = key;
      const closed = new Set(s.v.doors);
      for (const d of this.map.def.doors) this.map.grid.setDoor(d.rect, closed.has(d.room));
    }
    if (s.e.length) this.onEvents?.(s.e);
  }

  private lerp(c: { fx: number; fy: number; tx: number; ty: number; t0: number }, nowT: number): [number, number] {
    const f = Math.min(1, (nowT - c.t0) / Math.max(0.03, this.interval));
    return [c.fx + (c.tx - c.fx) * f, c.fy + (c.ty - c.fy) * f];
  }

  steer(dx: number, dy: number): void {
    this.dir = [dx, dy];
  }

  act(a: Action): void {
    this.net.act(a);
  }

  tick(dt: number): void {
    const v = this.view;
    if (!v) return;
    const me = v.players[this.me]!;
    let [dx, dy] = this.dir;
    const l = Math.hypot(dx, dy);
    if (l > 1) {
      dx /= l;
      dy /= l;
    }
    const can = v.phase === 'play' && v.vent < 0 && v.holding < 0 && !this.frozen;
    if (!can) dx = dy = 0;
    this.my.moving = Math.hypot(dx, dy) > 0.1;
    if (Math.abs(dx) > 0.1) this.my.left = dx < 0;
    const sp = SPEED * (me.alive ? 1 : 1.25) * dt;
    if (!me.alive) {
      const b = this.map.def.bounds;
      this.my.x = Math.max(b[0], Math.min(b[2], this.my.x + dx * sp));
      this.my.y = Math.max(b[1], Math.min(b[3], this.my.y + dy * sp));
    } else if (this.my.moving) [this.my.x, this.my.y] = this.map.grid.move(this.my.x, this.my.y, dx * sp, dy * sp, RADIUS);
    this.sendT -= dt;
    if (this.sendT <= 0 && v.phase === 'play') {
      this.sendT = 0.05;
      this.net.move({ x: Math.round(this.my.x * 100) / 100, y: Math.round(this.my.y * 100) / 100, left: this.my.left, moving: this.my.moving });
    }
  }

  pos(p: PView): [number, number] {
    if (p.id === this.me) return [this.my.x, this.my.y];
    const c = this.interp.get(p.id);
    return c ? this.lerp(c, performance.now() / 1000) : [p.x, p.y];
  }

  /** My facing / walking (prediction) for drawing myself. */
  self(): { left: boolean; moving: boolean } {
    return this.my;
  }

  dispose(): void {
    this.onEvents = null;
    this.net.onSnap = null;
  }
}
