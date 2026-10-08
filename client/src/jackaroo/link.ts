import { JackarooEngine, type Action, type GameEvent, type Mode, type PlayerSetup } from './engine';
import { BotDriver, chooseAction, type BotLevel } from './bots';
import { redact, viewFor, type View } from './view';

/** What the table UI talks to: a local game vs bots, or an online room. */
export interface GameLink {
  readonly me: string;
  readonly online: boolean;
  view: View | null;
  /** New state: the latest view, the events since the last update and (when known) my view right after each event. */
  onUpdate: ((view: View, events: GameEvent[], views: View[]) => void) | null;
  onError: ((msg: string) => void) | null;
  send(a: Action): void;
  tick(dt: number): void;
  dispose(): void;
}

export const BOT_NAMES = ['Amira', 'Bassam', 'Dalia', 'Faris', 'Ghada', 'Hadi', 'Jamal', 'Karim', 'Layla', 'Maya', 'Nadim', 'Rania', 'Sami', 'Tala', 'Yara', 'Ziad'];
/** Shuffled once per session so the same bots sit down again for a rematch. */
const SESSION_NAMES = [...BOT_NAMES].sort(() => Math.random() - 0.5);

export class LocalLink implements GameLink {
  readonly me = 'you';
  readonly online = false;
  view: View | null = null;
  onUpdate: GameLink['onUpdate'] = null;
  onError: GameLink['onError'] = null;
  readonly engine: JackarooEngine;
  private readonly bots: BotDriver;
  private refresh = 0;
  private steps: View[] = [];

  constructor(opts: { name: string; avatar: number; players: 2 | 4; level: BotLevel; mode: Mode }) {
    const seats: PlayerSetup[] = [{ id: this.me, name: opts.name, bot: false, avatar: opts.avatar }];
    for (let i = 1; i < opts.players; i++) seats.push({ id: `bot${i}`, name: SESSION_NAMES[i - 1]!, bot: true, avatar: (opts.avatar + i * 3) % 12 });
    this.engine = new JackarooEngine(seats, { mode: opts.mode }, (e) => this.steps.push(viewFor(e, this.me)), { auto: (e, p) => chooseAction(e, p, 'normal') });
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
    this.refresh = 0.5;
    const me = e.idx(this.me);
    const events = e.events.splice(0).map((ev) => redact(ev, me));
    const views = this.steps.splice(0);
    this.view = viewFor(e, this.me);
    this.onUpdate?.(this.view, events, views);
  }

  dispose(): void {
    this.onUpdate = null;
  }
}
