import { writeSnapshot } from './sim/snapshot';
import type { PlayerInfo, World, WorldEvent } from './sim/world';
import type { Rules } from './sim/rules';

/**
 * Match recorder: the whole world ~15×/s (the same packed snapshot the netcode uses), the
 * touches / goals / demos, and — in local games — what each bot was trying to do. Saved as a
 * JSON file from the end / pause screen so a match can be studied afterwards
 * (tools/rocket-matchlog.ts turns it into goal-by-goal top-down replays).
 */
export interface MatchLogFile {
  version: 1;
  date: string;
  online: boolean;
  myId: number;
  level: string;
  arena: string;
  rules: Rules;
  players: PlayerInfo[];
  /** Floats per frame (constant for a match). */
  frameSize: number;
  /** All frames back to back, Float32 little-endian, base64. */
  frames: string;
  /** Per frame: bot id → its plan ("attack/ball/air"…), local games only. */
  plans: Array<Record<number, string>> | null;
  events: Array<{ tick: number; e: WorldEvent }>;
}

const KEEP: ReadonlySet<WorldEvent['k']> = new Set(['goal', 'touch', 'demo', 'kickoff', 'over', 'overtime']);
const EVERY = 8; // ticks (120 Hz → 15 frames/s)

export class MatchLog {
  private readonly frames: Float32Array[] = [];
  private readonly plans: Array<Record<number, string>> = [];
  private readonly events: Array<{ tick: number; e: WorldEvent }> = [];
  private last = -Infinity;

  constructor(
    private readonly world: World,
    private readonly meta: { online: boolean; myId: number; level: string; arena: string },
    private readonly planOf: ((id: number) => string) | null,
  ) {}

  /** Call after every session update with the events it produced. */
  sample(events: readonly WorldEvent[]): void {
    const w = this.world;
    for (const e of events) if (KEEP.has(e.k)) this.events.push({ tick: w.tickCount, e });
    if (w.tickCount < this.last + EVERY) return;
    this.last = w.tickCount;
    this.frames.push(writeSnapshot(w).slice());
    if (this.planOf) {
      const p: Record<number, string> = {};
      for (const pl of w.players) if (pl.bot) p[pl.id] = this.planOf(pl.id);
      this.plans.push(p);
    }
  }

  get length(): number {
    return this.frames.length;
  }

  file(): MatchLogFile {
    const size = this.frames[0]?.length ?? 0;
    const all = new Float32Array(size * this.frames.length);
    this.frames.forEach((f, i) => all.set(f.subarray(0, size), i * size));
    const bytes = new Uint8Array(all.buffer);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return {
      version: 1,
      date: new Date().toISOString(),
      ...this.meta,
      rules: { ...this.world.rules },
      players: this.world.players.map((p) => ({ ...p })),
      frameSize: size,
      frames: btoa(bin),
      plans: this.planOf ? this.plans : null,
      events: this.events,
    };
  }

  /** Download as boostball-match-YYYY-MM-DD-HHMM.json. */
  download(): void {
    const blob = new Blob([JSON.stringify(this.file())], { type: 'application/json' });
    const a = document.createElement('a');
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    a.download = `boostball-match-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
    a.href = URL.createObjectURL(blob);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
}
