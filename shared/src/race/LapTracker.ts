import { Vector3 } from 'three';
import type { TrackPath } from '../track/TrackPath';
import type { Racer } from './RaceTypes';

const CROSS_WINDOW = 60;

/**
 * Checkpoint-gated lap counting. A lap only counts after passing every checkpoint
 * in order; reversing over the line or a checkpoint undoes it.
 */
export class LapTracker {
  private readonly checkpoints: number[];
  private readonly tmp = new Vector3();

  constructor(
    private readonly track: TrackPath,
    private readonly count: number,
    readonly laps: number,
  ) {
    // Evenly spaced, but never inside a jump run-up / gap (respawning there means
    // no speed for the ramp) or a shortcut span (the shortcut would skip it).
    const L = track.length;
    const def = track.def;
    const zones: Array<[number, number]> = [
      ...def.jumps.map((j): [number, number] => [j.distance - 90, j.distance + j.length + 10]),
      ...(def.gaps ?? []).map((g): [number, number] => [g.distance - 100, g.distance + g.length + 15]),
      ...def.shortcuts.map((sc): [number, number] => [sc.from - 10, sc.to + 10]),
    ];
    const inZone = (d: number): [number, number] | undefined => zones.find(([a, b]) => ((d - a + L) % L) < ((b - a + L) % L));
    this.checkpoints = Array.from({ length: count }, (_, k) => {
      let d = (k * L) / count;
      if (k === 0) return 0;
      for (let guard = 0; guard < 6; guard++) {
        const z = inZone(d);
        if (!z) break;
        d = (z[1] + 4) % L;
      }
      return d;
    });
    // Keep them in order (a shift can't overtake the next one).
    for (let k = 1; k < count; k++) if (this.checkpoints[k]! <= this.checkpoints[k - 1]!) this.checkpoints[k] = this.checkpoints[k - 1]! + 1;
  }

  /** Sample index of the last checkpoint passed (respawn point after a fall), or -1. */
  respawnIndex(r: Racer): number {
    const p = r.progress;
    if (p.lap < 1 || p.nextCheckpoint < 1) return -1;
    const cp = this.checkpoints[Math.min(this.count, p.nextCheckpoint) - 1]!;
    return this.track.wrapIndex(Math.round((this.track.startDistance + cp) / this.track.spacing) + 2);
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
    const off = Math.abs(this.tmp.copy(r.state.position).sub(s.position).dot(s.flatRight)) > s.wallOffset + 1;
    if (along < -3 && r.state.grounded && !off) p.wrongWayTime = Math.min(3, p.wrongWayTime + dt);
    else p.wrongWayTime = Math.max(0, p.wrongWayTime - dt * 2);
    p.wrongWay = p.wrongWayTime > 1.2;
    return result;
  }
}
