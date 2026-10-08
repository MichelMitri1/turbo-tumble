import { Vector3, type PerspectiveCamera } from 'three';
import type { TrackPath } from '@shared/track/TrackPath';

/** One sweeping shot: the camera glides along the track from d0 to d1 (lap metres). */
interface Shot {
  d0: number;
  d1: number;
  height: number;
  side: number;
  duration: number;
}

export const FLYOVER_TIME = 5.6;
const FINAL = 1.5;

/**
 * Pre-race track flyover (≈5.6 s): three gliding shots over different parts of
 * the course, then a swoop down from above the grid to the chase position. The
 * race clock waits until it ends (or is skipped).
 */
export class Flyover {
  time = 0;
  private readonly shots: Shot[];
  private readonly pos = new Vector3();
  private readonly look = new Vector3();
  private readonly a = new Vector3();
  private readonly b = new Vector3();

  constructor(private readonly track: TrackPath) {
    const L = track.length;
    const each = (FLYOVER_TIME - FINAL) / 3;
    this.shots = [
      { d0: L * 0.22, d1: L * 0.22 + 60, height: 16, side: 1, duration: each },
      { d0: L * 0.5, d1: L * 0.5 + 60, height: 11, side: -1, duration: each },
      { d0: L * 0.76, d1: L * 0.76 + 60, height: 20, side: 1, duration: each },
    ];
  }

  get done(): boolean {
    return this.time >= FLYOVER_TIME;
  }

  /** 0..1 progress (for the HUD card). */
  get progress(): number {
    return Math.min(1, this.time / FLYOVER_TIME);
  }

  /**
   * Advance and pose `camera`. `chasePos` / `chaseLook`: where the chase camera will
   * sit at the start, so the final swoop lands exactly there.
   */
  update(dt: number, camera: PerspectiveCamera, chasePos: Vector3, chaseLook: Vector3): void {
    this.time += dt;
    let t = this.time;
    const track = this.track;
    for (const shot of this.shots) {
      if (t < shot.duration) {
        const k = t / shot.duration;
        const d = track.startDistance + shot.d0 + (shot.d1 - shot.d0) * k;
        const f = track.frameAtSplineDistance(d);
        this.pos.copy(f.position).addScaledVector(f.right, shot.side * (f.halfWidth + 10)).addScaledVector(f.up, shot.height);
        const ahead = track.frameAtSplineDistance(d + 28);
        this.look.copy(ahead.position).addScaledVector(ahead.up, 1.5);
        this.apply(camera);
        return;
      }
      t -= shot.duration;
    }
    // Final swoop: from high behind the grid down onto the chase camera.
    const k = Math.min(1, t / FINAL);
    const e = k * k * (3 - 2 * k);
    const grid = track.frameAtSplineDistance(track.startDistance - 10);
    this.a.copy(grid.position).addScaledVector(grid.tangent, -40).addScaledVector(grid.up, 28);
    this.b.copy(track.frameAtSplineDistance(track.startDistance).position);
    this.pos.lerpVectors(this.a, chasePos, e);
    this.look.lerpVectors(this.b, chaseLook, e);
    this.apply(camera);
  }

  private apply(camera: PerspectiveCamera): void {
    camera.position.copy(this.pos);
    camera.up.set(0, 1, 0);
    camera.lookAt(this.look);
  }
}
