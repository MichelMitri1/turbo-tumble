import { PoolEngine, type Action, type GameEvent, type Rules } from './engine';
import { BotDriver, type BotLevel } from './bots';
import { viewFor, type View } from './view';

/** Live aim of the player at the table (relayed online so you can watch them line up). */
export interface Aim {
  dx: number;
  dy: number;
  power: number;
  sx: number;
  sy: number;
  cue?: { x: number; y: number };
}

export interface GameLink {
  readonly me: string;
  readonly online: boolean;
  view: View | null;
  onUpdate: ((view: View, events: GameEvent[]) => void) | null;
  onError: ((msg: string) => void) | null;
  onAim: ((aim: Aim) => void) | null;
  send(a: Action): void;
  aim(a: Aim): void;
  tick(dt: number): void;
  dispose(): void;
}

export const BOT_NAMES = ['Shark', 'Minnesota', 'Cue-Bert', 'Bankshot', 'Fats', 'Eddie', 'Lucky Lou', 'Chalky', 'Rack Attack', 'Kiss Shot', 'Dr. Draw', 'English Rose'];

export class LocalLink implements GameLink {
  readonly me = 'you';
  readonly online = false;
  view: View | null = null;
  onUpdate: GameLink['onUpdate'] = null;
  onError: GameLink['onError'] = null;
  onAim: GameLink['onAim'] = null;
  readonly engine: PoolEngine;
  private readonly bots: BotDriver;
  private refresh = 0;

  constructor(opts: { name: string; avatar: number; level: BotLevel; rules?: Partial<Rules> }) {
    const bot = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)]!;
    this.engine = new PoolEngine(
      [
        { id: this.me, name: opts.name, bot: false, avatar: opts.avatar },
        { id: 'bot', name: bot, bot: true, avatar: (opts.avatar + 5) % 12 },
      ],
      opts.rules,
    );
    this.bots = new BotDriver(this.engine, opts.level);
  }

  send(a: Action): void {
    const err = this.engine.act(this.me, a);
    if (err) this.onError?.(err);
    this.flush(true);
  }
  aim(): void {}

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
    const events = e.events.splice(0);
    this.view = viewFor(e, this.me);
    this.onUpdate?.(this.view, events);
  }

  dispose(): void {
    this.onUpdate = null;
  }
}
