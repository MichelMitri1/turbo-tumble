import { FilesetResolver, HandLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision';

/**
 * The detectors: MediaPipe Pose (body, up to two people) and Hands (21 points per hand — the racket
 * hand's orientation), on the GPU when there is one. The same engine runs in the pose worker (the
 * normal case: detection never blocks the game's rendering) or on the page as a fallback.
 */
export type Model = 'fast' | 'precise';

export interface EngineOptions {
  model: Model;
  poses: 1 | 2;
  hands: boolean;
  /** Racket hand per player (P1 = the person furthest image-left, i.e. on your right in the mirror). */
  racket: Array<'left' | 'right'>;
}

/** Landmarks packed flat: pose 33 × (x, y, z, visibility); hands 21 × (x, y, z). */
export interface PoseOut {
  image: Float32Array;
  world: Float32Array;
}
export interface HandOut {
  image: Float32Array;
  world: Float32Array;
}
export interface EngineResult {
  /** Frame capture time (s, the camera's clock) — for velocities. */
  t: number;
  /** Detection time (ms). */
  ms: number;
  /** Frame width / height. */
  aspect: number;
  poses: PoseOut[];
  hands: HandOut[];
}

const MODELS: Record<Model, string> = {
  fast: '/assets/padel/pose/pose_landmarker_lite.task',
  precise: '/assets/padel/pose/pose_landmarker_full.task',
};
const HAND_MODEL = '/assets/padel/pose/hand_landmarker.task';

type Fileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

export class PoseEngine {
  private fileset: Fileset | null = null;
  private pose: PoseLandmarker | null = null;
  /** One hand tracker per player (each follows its own crop, so their tracking doesn't mix). */
  private handT: HandLandmarker[] = [];
  private crop: OffscreenCanvas | HTMLCanvasElement | null = null;
  private cropCtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;
  private opts: EngineOptions | null = null;
  private lastTs = 0;

  constructor(private readonly inWorker: boolean) {}

  async configure(o: EngineOptions): Promise<void> {
    const prev = this.opts;
    this.opts = { ...o };
    if (!this.fileset) this.fileset = await FilesetResolver.forVisionTasks(`${this.base()}/mediapipe`);
    const fs = this.fileset;
    const canvas = () => (this.inWorker ? { canvas: new OffscreenCanvas(1, 1) } : {});
    const create = async <T>(make: (delegate: 'GPU' | 'CPU') => Promise<T>): Promise<T> => {
      try {
        return await make('GPU');
      } catch {
        return make('CPU');
      }
    };
    if (!this.pose || prev?.model !== o.model) {
      this.pose?.close();
      this.pose = await create((delegate) =>
        PoseLandmarker.createFromOptions(fs, {
          baseOptions: { modelAssetPath: this.base() + MODELS[o.model], delegate },
          runningMode: 'VIDEO',
          numPoses: o.poses,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
          ...canvas(),
        }),
      );
    } else if (prev?.poses !== o.poses) await this.pose.setOptions({ numPoses: o.poses });
    const want = o.hands ? o.poses : 0;
    while (this.handT.length > want) this.handT.pop()!.close();
    while (this.handT.length < want)
      this.handT.push(
        await create((delegate) =>
          HandLandmarker.createFromOptions(fs, {
            baseOptions: { modelAssetPath: this.base() + HAND_MODEL, delegate },
            runningMode: 'VIDEO',
            numHands: 1,
            minHandDetectionConfidence: 0.6,
            minHandPresenceConfidence: 0.6,
            minTrackingConfidence: 0.6,
            ...canvas(),
          }),
        ),
      );
  }

  /** Workers resolve URLs against the worker script; give them the site's origin. */
  private base(): string {
    return self.location.origin;
  }

  detect(src: TexImageSource, t: number, w: number, h: number): EngineResult {
    const t0 = performance.now();
    // MediaPipe wants strictly increasing timestamps.
    const ts = Math.max(this.lastTs + 1, Math.round(t0));
    this.lastTs = ts;
    const out: EngineResult = { t, ms: 0, aspect: w / Math.max(1, h), poses: [], hands: [] };
    if (this.pose) {
      const r = this.pose.detectForVideo(src, ts);
      r.landmarks.forEach((lm, k) => {
        const image = new Float32Array(33 * 4);
        const world = new Float32Array(33 * 4);
        const wl = r.worldLandmarks[k] ?? [];
        for (let i = 0; i < 33; i++) {
          const a = lm[i];
          const b = wl[i];
          if (a) image.set([a.x, a.y, a.z, a.visibility ?? 1], i * 4);
          if (b) world.set([b.x, b.y, b.z, b.visibility ?? a?.visibility ?? 1], i * 4);
        }
        out.poses.push({ image, world });
      });
    }
    // Hands: a zoomed crop round each player's racket wrist (whole-frame hand detection can't find a
    // hand 2–3 m away), mapped back to the frame.
    if (this.handT.length && out.poses.length) {
      const order = out.poses.map((p, k) => ({ k, x: (p.image[23 * 4]! + p.image[24 * 4]!) / 2 })).sort((a, b) => a.x - b.x);
      order.slice(0, this.handT.length).forEach(({ k }, i) => {
        const hand = this.cropHand(src, out.poses[k]!, this.opts!.racket[i] ?? 'right', w, h, this.handT[i]!, ts);
        if (hand) out.hands.push(hand);
      });
    }
    out.ms = performance.now() - t0;
    return out;
  }

  private cropHand(src: TexImageSource, p: PoseOut, side: 'left' | 'right', w: number, h: number, tracker: HandLandmarker, ts: number): HandOut | null {
    const wi = side === 'left' ? 15 : 16;
    const ei = wi - 2;
    if (p.image[wi * 4 + 3]! < 0.2) return null;
    const wx = p.image[wi * 4]! * w;
    const wy = p.image[wi * 4 + 1]! * h;
    const ex = p.image[ei * 4]! * w;
    const ey = p.image[ei * 4 + 1]! * h;
    const fl = Math.hypot(wx - ex, wy - ey);
    // Centre on the hand (a little past the wrist, along the forearm); room for the whole hand.
    const cx = wx + (wx - ex) * 0.35;
    const cy = wy + (wy - ey) * 0.35;
    const size = Math.max(72, Math.min(h * 0.7, fl * 2.3 + 40));
    const sx = cx - size / 2;
    const sy = cy - size / 2;
    const N = 256;
    if (!this.crop) {
      this.crop = this.inWorker ? new OffscreenCanvas(N, N) : Object.assign(document.createElement('canvas'), { width: N, height: N });
      this.cropCtx = this.crop.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
    }
    const g = this.cropCtx!;
    g.fillStyle = '#000';
    g.fillRect(0, 0, N, N);
    g.drawImage(src as CanvasImageSource, sx, sy, size, size, 0, 0, N, N);
    const r = tracker.detectForVideo(this.crop as TexImageSource, ts);
    const lm = r.landmarks[0];
    const wl = r.worldLandmarks[0];
    if (!lm || !wl) return null;
    const image = new Float32Array(21 * 3);
    const world = new Float32Array(21 * 3);
    for (let i = 0; i < 21; i++) {
      image.set([(sx + lm[i]!.x * size) / w, (sy + lm[i]!.y * size) / h, lm[i]!.z], i * 3);
      world.set([wl[i]!.x, wl[i]!.y, wl[i]!.z], i * 3);
    }
    return { image, world };
  }

  close(): void {
    this.pose?.close();
    for (const t of this.handT) t.close();
    this.handT = [];
    this.pose = null;
  }
}
