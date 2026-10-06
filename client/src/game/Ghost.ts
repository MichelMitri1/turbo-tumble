import { MeshStandardMaterial, Quaternion, Vector3, type Mesh, type Object3D } from 'three';
import type { KartState } from '@shared/vehicles/KartState';
import { kartQuaternion } from '@shared/vehicles/KartState';

/** A recorded Time Trial run (positions + orientations at 30 Hz from GO). */
export interface GhostRun {
  version: 2;
  trackId: string;
  laps: number;
  time: number;
  lapTimes: number[];
  characterId: string;
  kartId: string;
  /** Flattened [x, y, z, qx, qy, qz, qw] per frame. */
  frames: number[];
}

export const GHOST_HZ = 30;
const STRIDE = 7;
// Longer jump-tour layouts cannot race against ghosts recorded on the old roads.
// Keep the old keys intact so existing recordings are not destroyed.
const key = (trackId: string, laps: number): string => `turbo-tumble.ghost.v2.${trackId}.${laps}`;

export const GhostStore = {
  load(trackId: string, laps: number): GhostRun | null {
    try {
      const raw = localStorage.getItem(key(trackId, laps));
      const run = raw ? (JSON.parse(raw) as GhostRun) : null;
      return run?.version === 2 ? run : null;
    } catch {
      return null;
    }
  },
  save(run: GhostRun): boolean {
    try {
      localStorage.setItem(key(run.trackId, run.laps), JSON.stringify(run));
      return true;
    } catch {
      return false; // storage full / unavailable — the record still shows this session
    }
  },
};

/** Samples the player's kart every other tick while racing. */
export class GhostRecorder {
  private readonly frames: number[] = [];
  private readonly q = new Quaternion();
  private acc = 0;

  record(state: KartState, dt: number): void {
    this.acc += dt;
    if (this.acc < 1 / GHOST_HZ - 1e-6 && this.frames.length > 0) return;
    this.acc = 0;
    kartQuaternion(state, this.q);
    const r = (v: number): number => Math.round(v * 1000) / 1000;
    this.frames.push(r(state.position.x), r(state.position.y), r(state.position.z), r(this.q.x), r(this.q.y), r(this.q.z), r(this.q.w));
  }

  finish(meta: Omit<GhostRun, 'frames' | 'version'>): GhostRun {
    return { version: 2, ...meta, frames: this.frames };
  }
}

/** Drives a translucent kart model from a recorded run. */
export class GhostPlayer {
  private readonly a = new Vector3();
  private readonly b = new Vector3();
  private readonly qa = new Quaternion();
  private readonly qb = new Quaternion();

  constructor(
    readonly run: GhostRun,
    readonly model: Object3D,
  ) {
    model.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      m.castShadow = false;
      const mat = (m.material as MeshStandardMaterial).clone();
      mat.transparent = true;
      mat.opacity = 0.42;
      mat.depthWrite = false;
      mat.emissive.set('#7fd8ff');
      mat.emissiveIntensity = 0.35;
      m.material = mat;
    });
    model.visible = false;
  }

  update(raceTime: number): void {
    const n = this.run.frames.length / STRIDE;
    if (n < 2 || raceTime < 0) {
      this.model.visible = false;
      return;
    }
    const f = Math.min(n - 1.001, raceTime * GHOST_HZ);
    const i = Math.floor(f);
    const t = f - i;
    const fr = this.run.frames;
    const o = i * STRIDE;
    this.a.set(fr[o]!, fr[o + 1]!, fr[o + 2]!);
    this.b.set(fr[o + 7]!, fr[o + 8]!, fr[o + 9]!);
    this.qa.set(fr[o + 3]!, fr[o + 4]!, fr[o + 5]!, fr[o + 6]!);
    this.qb.set(fr[o + 10]!, fr[o + 11]!, fr[o + 12]!, fr[o + 13]!);
    this.model.position.lerpVectors(this.a, this.b, t);
    this.model.quaternion.slerpQuaternions(this.qa, this.qb, t);
    this.model.visible = raceTime * GHOST_HZ < n;
  }
}
