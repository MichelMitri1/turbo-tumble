import { KittensEngine, type Action, type GameEvent, type PlayerSetup, type Rules } from './engine';
import { BotDriver, type BotLevel } from './bots';
import { redact, viewFor, type View } from './view';
import type { DeckId } from './cards';

/** What the table UI talks to: a local game vs bots, or an online room. */
export interface GameLink {
  readonly me: string;
  readonly online: boolean;
  view: View | null;
  onUpdate: ((view: View, events: GameEvent[]) => void) | null;
  onError: ((msg: string) => void) | null;
  send(a: Action): void;
  /** `busy`: the table is still animating earlier events (a local game waits for it). */
  tick(dt: number, busy?: boolean): void;
  /** Pause the local game while a big animation plays (no-op online). */
  hold(seconds: number): void;
  dispose(): void;
}

export const BOT_NAMES = ['Whiskers', 'Mittens', 'Biscuit', 'Noodle', 'Pickles', 'Toast', 'Mochi', 'Pepper', 'Ziggy', 'Waffles'];

export class LocalLink implements GameLink {
  readonly me = 'you';
  readonly online = false;
  view: View | null = null;
  onUpdate: GameLink['onUpdate'] = null;
  onError: GameLink['onError'] = null;
  readonly engine: KittensEngine;
  private readonly bots: BotDriver;
  private held = 0;
  private refresh = 0;

  constructor(opts: { name: string; avatar: number; bots: number; level: BotLevel; deck: DeckId } & Rules) {
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    const seats: PlayerSetup[] = [{ id: this.me, name: opts.name, bot: false, avatar: opts.avatar }];
    for (let i = 0; i < opts.bots; i++) seats.push({ id: `bot${i}`, name: names[i]!, bot: true, avatar: (opts.avatar + 1 + i) % 8 });
    this.engine = new KittensEngine(seats, { deck: opts.deck, fullDeck: opts.fullDeck, anyPairs: opts.anyPairs, imploding: opts.imploding, nopeWindow: 2.6 });
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

  tick(dt: number, busy = false): void {
    // Bots (and Nope windows) wait while the table catches up, so plays never outrun what's shown.
    if (this.held > 0 || busy) {
      this.held -= dt;
    } else {
      this.engine.update(dt);
      this.bots.update(dt);
    }
    this.refresh -= dt;
    this.flush(this.refresh <= 0);
  }

  private flush(force: boolean): void {
    const e = this.engine;
    if (!e.events.length && !force) return;
    this.refresh = 0.1;
    const events = e.events.splice(0).map((ev) => redact(ev, this.me));
    this.view = viewFor(e, this.me);
    this.onUpdate?.(this.view, events);
  }

  dispose(): void {
    this.onUpdate = null;
  }
}
