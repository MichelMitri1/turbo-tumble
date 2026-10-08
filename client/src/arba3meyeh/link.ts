import { FourHundredEngine, type Action, type GameEvent, type PlayerSetup, type Rules } from './engine';
import { BotDriver, type BotLevel } from './bots';
import { redact, viewFor, type View } from './view';

/** What the table UI talks to: a local game vs bots, or an online room. */
export interface GameLink {
  readonly me: string;
  readonly online: boolean;
  view: View | null;
  /** New state: the latest view, the events since the last update and the view right after each event. */
  onUpdate: ((view: View, events: GameEvent[], views: View[]) => void) | null;
  onError: ((msg: string) => void) | null;
  send(a: Action): void;
  tick(dt: number): void;
  dispose(): void;
}

export const BOT_NAMES = ['Abu Karim', 'Rami', 'Nadia', 'Tony', 'Hiba', 'Joe', 'Maya', 'Elie', 'Samir', 'Rita', 'Fadi', 'Layal', 'Georges', 'Zeina', 'Walid'];

export class LocalLink implements GameLink {
  readonly me = 'you';
  readonly online = false;
  view: View | null = null;
  onUpdate: GameLink['onUpdate'] = null;
  onError: GameLink['onError'] = null;
  readonly engine: FourHundredEngine;
  private readonly bots: BotDriver;
  private refresh = 0;
  private steps: View[] = [];

  /** `partners`: names for seats 1–3 (right, partner opposite, left). */
  constructor(opts: { name: string; avatar: number; level: BotLevel; rules: Partial<Rules> }) {
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    const seats: PlayerSetup[] = [
      { id: this.me, name: opts.name, bot: false, avatar: opts.avatar },
      { id: 'bot1', name: names[0]!, bot: true, avatar: (opts.avatar + 3) % 12 },
      { id: 'bot2', name: names[1]!, bot: true, avatar: (opts.avatar + 6) % 12 },
      { id: 'bot3', name: names[2]!, bot: true, avatar: (opts.avatar + 9) % 12 },
    ];
    // The first deal happens inside the constructor, before `this.engine` is set: those views come from `latest`.
    this.engine = new FourHundredEngine(seats, opts.rules, () => this.engine && this.steps.push(viewFor(this.engine, this.me)));
    this.bots = new BotDriver(this.engine, opts.level);
  }

  send(a: Action): void {
    const err = this.engine.act(this.me, a);
    if (err) this.onError?.(err);
    this.flush(true);
  }

  tick(dt: number): void {
    this.engine.update(dt);
    this.bots.update(dt);
    this.refresh -= dt;
    this.flush(this.refresh <= 0);
  }

  private flush(force: boolean): void {
    const e = this.engine;
    if (!e.events.length && !force) return;
    this.refresh = 0.25;
    const events = e.events.splice(0).map((ev) => redact(ev, this.me, e));
    const views = this.steps.splice(0);
    this.view = viewFor(e, this.me);
    this.onUpdate?.(this.view, events, views);
  }

  dispose(): void {
    this.onUpdate = null;
  }
}
