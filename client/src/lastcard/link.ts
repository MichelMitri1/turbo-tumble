import { LastCardEngine, type Action, type GameEvent, type PlayerSetup, type Rules } from './engine';
import { BotDriver, type BotLevel } from './bots';
import { redact, viewFor, type View } from './view';

/** What the table UI talks to: a local game vs bots, or an online room. */
export interface GameLink {
  readonly me: string;
  readonly online: boolean;
  view: View | null;
  /** New state: the latest view, the events since the last update and (when known) the view right after each event. */
  onUpdate: ((view: View, events: GameEvent[], views: View[]) => void) | null;
  onError: ((msg: string) => void) | null;
  send(a: Action): void;
  tick(dt: number): void;
  /** Pause the local game while a big animation plays (no-op online). */
  hold(seconds: number): void;
  /** Seconds the local game is still held. */
  readonly holdLeft: number;
  dispose(): void;
}

export const BOT_NAMES = ['Ace', 'Blaze', 'Cosmo', 'Dash', 'Echo', 'Fizz', 'Gizmo', 'Hopper', 'Jinx', 'Kiwi', 'Lucky', 'Mango', 'Nova', 'Pixel', 'Ziggy'];
/** Shuffled once per session so the same bots sit down again for a rematch (series scores stay meaningful). */
const SESSION_NAMES = [...BOT_NAMES].sort(() => Math.random() - 0.5);

export class LocalLink implements GameLink {
  readonly me = 'you';
  readonly online = false;
  view: View | null = null;
  onUpdate: GameLink['onUpdate'] = null;
  onError: GameLink['onError'] = null;
  readonly engine: LastCardEngine;
  private readonly bots: BotDriver;
  private held = 0;
  private refresh = 0;
  /** My view after each engine event (so the table can show exactly what each animation shows). */
  private steps: View[] = [];

  constructor(opts: { name: string; avatar: number; bots: number; level: BotLevel; rules: Partial<Rules> }) {
    const seats: PlayerSetup[] = [{ id: this.me, name: opts.name, bot: false, avatar: opts.avatar }];
    for (let i = 0; i < opts.bots; i++) seats.push({ id: `bot${i}`, name: SESSION_NAMES[i]!, bot: true, avatar: (opts.avatar + 1 + i * 2) % 12 });
    this.engine = new LastCardEngine(seats, opts.rules, (e) => this.steps.push(viewFor(e, this.me)));
    this.bots = new BotDriver(this.engine, opts.level);
  }

  send(a: Action): void {
    const err = this.engine.act(this.me, a);
    if (err) this.onError?.(err);
    this.flush(true);
  }

  hold(seconds: number): void {
    this.held = Math.max(this.held, seconds);
  }
  get holdLeft(): number {
    return Math.max(0, this.held);
  }

  tick(dt: number): void {
    if (this.held > 0) this.held -= dt;
    else {
      this.engine.update(dt);
      this.bots.update(dt);
    }
    this.refresh -= dt;
    this.flush(this.refresh <= 0);
  }

  private flush(force: boolean): void {
    const e = this.engine;
    if (!e.events.length && !force) return;
    this.refresh = 0.25;
    const events = e.events.splice(0).map((ev) => redact(ev, this.me));
    const views = this.steps.splice(0);
    this.view = viewFor(e, this.me);
    this.onUpdate?.(this.view, events, views);
  }

  dispose(): void {
    this.onUpdate = null;
  }
}
