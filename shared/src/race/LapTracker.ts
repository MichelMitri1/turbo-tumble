import type { TrackPath } from '../track/TrackPath';
import type { Racer } from './RaceTypes';

const CROSS_WINDOW = 60;

/**
 * Checkpoint-gated lap counting. A lap only counts after passing every checkpoint
 * in order; reversing over the line or a checkpoint undoes it.
 */
export class LapTracker {
  private readonly checkpoints: number[];

  constructor(
    private readonly track: TrackPath,
    private readonly count: number,
    readonly laps: number,
  ) {
    this.checkpoints = Array.from({ length: count }, (_, k) => (k * track.length) / count);
  }

  /** Lap-distance of every checkpoint (index 0 is the start/finish line). */
  get checkpointDistances(): readonly number[] {
    return this.checkpoints;
  }

  private lapDistanceOf(r: Racer): number {
    const s = this.track.samples[Math.max(0, r.state.trackIndex)]!;
    const loc = this.track.locate(r.state.position, s.index, 4);
    return this.track.lapDistance(loc.splineDistance);
  }

  init(r: Racer): void {
    const p = r.progress;
    p.lap = 0;
    p.nextCheckpoint = this.count; // must cross the line first
    p.lapDistance = this.lapDistanceOf(r);
    p.total = p.lapDistance - this.track.length;
    p.finished = false;
    p.lapTimes = [];
    p.bestLap = 0;
    p.lapStartTime = 0;
  }

  /** Returns 'lap' / 'finish' when this update completed one. */
  update(r: Racer, time: number, dt: number): 'lap' | 'finish' | null {
    const p = r.progress;
    const L = this.track.length;
    const N = this.count;
    const prev = p.lapDistance;
    const d = this.lapDistanceOf(r);
    p.lapDistance = d;
    let result: 'lap' | 'finish' | null = null;

    if (!p.finished) {
      if (prev > L - CROSS_WINDOW && d < CROSS_WINDOW) {
        if (p.nextCheckpoint >= N) {
          if (p.lap >= 1) {
            const lapTime = time - p.lapStartTime;
            p.lapTimes.push(lapTime);
            p.bestLap = p.bestLap === 0 ? lapTime : Math.min(p.bestLap, lapTime);
            p.lapStartTime = time;
          }
          p.lap++;
          p.nextCheckpoint = 1;
          if (p.lap > this.laps) {
            p.finished = true;
            p.finishTime = time;
            result = 'finish';
          } else if (p.lap > 1) {
            result = 'lap';
          }
        }
      } else if (prev < CROSS_WINDOW && d > L - CROSS_WINDOW) {
        if (p.nextCheckpoint === 1 && p.lap >= 1) {
          p.lap--;
          p.nextCheckpoint = N;
        }
      } else if (p.nextCheckpoint < N) {
        const cp = this.checkpoints[p.nextCheckpoint]!;
        if (prev < cp && d >= cp && d - prev < CROSS_WINDOW) p.nextCheckpoint++;
      }
      if (p.nextCheckpoint >= 2 && p.nextCheckpoint <= N) {
        const back = this.checkpoints[p.nextCheckpoint - 1]!;
        if (prev >= back && d < back && prev - d < CROSS_WINDOW) p.nextCheckpoint--;
      }
    }

    // Monotonic progress for standings, gated by the next checkpoint.
    if (p.finished) {
      p.total = this.laps * L + 1e6 - p.finishTime;
    } else if (p.lap === 0) {
      p.total = d > L / 2 ? d - L : d;
    } else {
      const gate = p.nextCheckpoint < N ? this.checkpoints[p.nextCheckpoint]! + 40 : L;
      p.total = (p.lap - 1) * L + Math.min(d, gate);
    }

    // Wrong way: moving against the track direction for a while.
    const s = this.track.samples[Math.max(0, r.state.trackIndex)]!;
    const along = r.state.velocity.dot(s.tangent);
    if (along < -3 && r.state.grounded) p.wrongWayTime = Math.min(3, p.wrongWayTime + dt);
    else p.wrongWayTime = Math.max(0, p.wrongWayTime - dt * 2);
    p.wrongWay = p.wrongWayTime > 1.2;
    return result;
  }
}
