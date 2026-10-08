/** Points by finishing position (1st first). Fields smaller than 12 use the top of the table. */
export const GP_POINTS = [15, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1] as const;

export interface Cup {
  id: string;
  name: string;
  /** Track ids, raced in order. */
  tracks: string[];
}

export interface GrandPrixEntry {
  id: string;
  points: number;
  /** Points earned in the most recent race. */
  lastAwarded: number;
  lastPosition: number;
}

/** Grand Prix progression and points table (pure data — usable by the server too). */
export class GrandPrixState {
  raceIndex = 0;
  private readonly table = new Map<string, GrandPrixEntry>();
  /** The table as it stood when the current race started (restarts roll back to it). */
  private saved: GrandPrixEntry[] = [];

  constructor(
    readonly cup: Cup,
    racerIds: readonly string[],
  ) {
    for (const id of racerIds) this.table.set(id, { id, points: 0, lastAwarded: 0, lastPosition: 0 });
  }

  get trackId(): string {
    return this.cup.tracks[this.raceIndex]!;
  }

  get raceCount(): number {
    return this.cup.tracks.length;
  }

  get isLastRace(): boolean {
    return this.raceIndex >= this.cup.tracks.length - 1;
  }

  /** Record a finished race (ids in finishing order). */
  award(finishingOrder: readonly string[]): void {
    finishingOrder.forEach((id, i) => {
      const e = this.table.get(id);
      if (!e) return;
      e.lastAwarded = GP_POINTS[i] ?? 0;
      e.lastPosition = i + 1;
      e.points += e.lastAwarded;
    });
  }

  /** Call when a race (re)starts: remembers the points so a restart can undo that race. */
  beginRace(): void {
    this.saved = [...this.table.values()].map((e) => ({ ...e }));
  }

  /** Undo any points awarded since beginRace (restarting the current track). */
  rollback(): void {
    for (const e of this.saved) this.table.set(e.id, { ...e });
  }

  nextRace(): void {
    this.raceIndex = Math.min(this.raceIndex + 1, this.cup.tracks.length - 1);
  }

  /** Overall standings, best first (ties broken by the last race result). */
  standings(): GrandPrixEntry[] {
    return [...this.table.values()].sort((a, b) => b.points - a.points || a.lastPosition - b.lastPosition);
  }
}
