import { SwingDetector, P, type CameraStroke, type Lm } from './swing';
import { ArmTracker, type Smoothing } from './armtrack';
import type { EngineOptions, EngineResult, Model, PoseEngine } from './engine';
import type { WorkerOut } from './pose.worker';
import type { LiveArm } from '../sim/arm';

/**
 * Camera play: the webcam, MediaPipe Pose + Hands (up to two people), and per person a swing
 * detector (gesture play) and a live arm tracker (1:1 motion play).
 *
 * Detection runs in a worker so it never competes with the game's rendering. On Chrome / Edge the
 * worker reads frames straight off the camera track (MediaStreamTrackProcessor, a buffer of one: it
 * always works on the newest frame, with the camera's own timestamps); elsewhere the page hands it a
 * bitmap of each new video frame. If workers can't run the models, detection runs on the page.
 *
 * Player 1 is whoever stands on the right as you see yourself in the (mirrored) preview — the
 * right-hand (drive) side of the court, where player 1 plays — and player 2 on the left; each keeps
 * their slot frame to frame by staying closest to where they were.
 */
export type Accuracy = 'auto' | Model;

const BONES: Array<[number, number]> = [
  [P.lShoulder, P.rShoulder],
  [P.lShoulder, P.lElbow],
  [P.lElbow, P.lWrist],
  [P.rShoulder, P.rElbow],
  [P.rElbow, P.rWrist],
  [P.lShoulder, P.lHip],
  [P.rShoulder, P.rHip],
  [P.lHip, P.rHip],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
];
const HAND_BONES: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];
export const CAM_COLORS = ['#3d8bff', '#14b8a6'];

interface Track {
  /** Hip centre, image x (0 … 1, unmirrored). */
  x: number;
  seenAt: number;
  image: Float32Array | null;
  hand: Float32Array | null;
}

type TrackProcessor = new (o: { track: MediaStreamTrack; maxBufferSize?: number }) => { readable: ReadableStream<VideoFrame> };

export class CameraInput {
  readonly video = document.createElement('video');
  readonly detectors = [new SwingDetector(), new SwingDetector()];
  /** Motion play: each player's live racket arm. */
  readonly arms = [new ArmTracker(), new ArmTracker()];
  players: 1 | 2 = 1;
  running = false;
  /** Pose updates per second (what the camera + model actually manage). */
  fps = 0;
  /** Milliseconds per detection (smoothed). */
  ms = 0;
  /** Where detection runs, and from what. */
  mode = '';
  /** The pose model in use. */
  model: Model = 'precise';
  error = '';
  private accuracy: Accuracy = 'auto';
  private hands = true;
  private worker: Worker | null = null;
  private workerOk: Promise<boolean> | null = null;
  private engine: PoseEngine | null = null;
  private stream: MediaStream | null = null;
  /** The track clone feeding the worker directly. */
  private procTrack: MediaStreamTrack | null = null;
  private direct = false;
  private inFlight = false;
  private readonly tracks: Track[] = [
    { x: 0.3, seenAt: 0, image: null, hand: null },
    { x: 0.7, seenAt: 0, image: null, hand: null },
  ];
  private readonly pending: Array<CameraStroke | null> = [null, null];
  private frames = 0;
  private fpsT = 0;
  private results = 0;
  private lastT = 0;
  private frameDt = 1 / 30;

  constructor() {
    this.video.playsInline = true;
    this.video.muted = true;
    // Kept in the page (invisibly): browsers throttle frames of detached videos.
    this.video.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none;';
    document.body.appendChild(this.video);
  }

  /** The racket hands changed: the hand crops follow the right wrist. */
  handsChanged(): void {
    if (this.worker) this.worker.postMessage({ k: 'opts', o: this.opts() });
    else void this.engine?.configure(this.opts());
  }

  set smoothing(s: Smoothing) {
    for (const a of this.arms) a.smoothing = s;
  }

  private opts(): EngineOptions {
    return { model: this.model, poses: this.players, hands: this.hands, racket: this.detectors.map((d) => (d.hand === 'left' ? 'left' : 'right')) };
  }

  /** Open the camera and load the models (first time: ~6–9 MB pose + 8 MB hands). */
  async start(players: 1 | 2, accuracy: Accuracy, hands = true): Promise<void> {
    const changed = players !== this.players || accuracy !== this.accuracy || hands !== this.hands;
    this.players = players;
    this.accuracy = accuracy;
    this.hands = hands;
    this.error = '';
    if (accuracy !== 'auto') this.model = accuracy;
    else if (changed) this.model = 'precise';
    if (!this.stream) {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser has no camera access (it needs https or localhost).');
      // 60 fps if the camera can: fast swings blur less and the lag halves.
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 60, min: 24 }, facingMode: 'user' }, audio: false });
      this.video.srcObject = this.stream;
      await this.video.play();
      this.direct = false;
    }
    if (changed || !this.workerOk) await this.configure();
    if (!this.running) {
      this.running = true;
      this.results = 0;
      this.loop();
    }
    // Straight off the camera track into the worker, where the browser can.
    const TP = (window as unknown as { MediaStreamTrackProcessor?: TrackProcessor }).MediaStreamTrackProcessor;
    if (this.worker && TP && !this.direct) {
      const track = this.stream.getVideoTracks()[0];
      if (track) {
        try {
          this.procTrack = track.clone();
          const proc = new TP({ track: this.procTrack, maxBufferSize: 1 });
          this.worker.postMessage({ k: 'stream', readable: proc.readable }, [proc.readable as unknown as Transferable]);
          this.direct = true;
        } catch {
          this.direct = false;
        }
      }
    }
    this.mode = this.worker ? (this.direct ? 'worker · direct' : 'worker') : 'page';
  }

  /** Load / reconfigure the models: in the worker if it works, else on the page. */
  private async configure(): Promise<void> {
    if (!this.workerOk) {
      this.workerOk = new Promise<boolean>((resolve) => {
        try {
          const w = new Worker(new URL('./pose.worker.ts', import.meta.url), { type: 'module' });
          const fail = (msg: string) => {
            this.error = '';
            console.warn('[padel] pose worker unavailable, tracking on the page:', msg);
            w.terminate();
            this.worker = null;
            resolve(false);
          };
          const timer = setTimeout(() => fail('timed out'), 45000);
          w.onmessage = (e: MessageEvent<WorkerOut>) => {
            const m = e.data;
            if (m.k === 'ready') {
              clearTimeout(timer);
              this.worker = w;
              w.onmessage = (ev: MessageEvent<WorkerOut>) => this.fromWorker(ev.data);
              resolve(true);
            } else if (m.k === 'error') {
              clearTimeout(timer);
              fail(m.msg);
            }
          };
          w.onerror = (ev) => {
            clearTimeout(timer);
            fail(ev.message || 'worker failed');
          };
          w.postMessage({ k: 'init', o: this.opts() });
        } catch (e) {
          console.warn('[padel] no pose worker:', (e as Error).message);
          resolve(false);
        }
      });
      if (await this.workerOk) return;
    }
    if (this.worker) {
      this.worker.postMessage({ k: 'opts', o: this.opts() });
      return;
    }
    // Fallback: on the page.
    if (!this.engine) {
      const { PoseEngine } = await import('./engine');
      this.engine = new PoseEngine(false);
    }
    await this.engine.configure(this.opts());
  }

  private fromWorker(m: WorkerOut): void {
    if (m.k === 'result') this.onResult(m.r);
    else if (m.k === 'idle') this.inFlight = false;
    else if (m.k === 'error') this.error = m.msg;
  }

  /** Bitmap / page modes: hand over each new video frame (one at a time — never a queue). */
  private loop(): void {
    if (!this.running) return;
    const v = this.video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number, md: { mediaTime: number }) => void) => number };
    const onFrame = (_now: number, md?: { mediaTime: number }) => {
      if (!this.running) return;
      const t = md?.mediaTime ?? performance.now() / 1000;
      if (this.worker && !this.direct && !this.inFlight && v.readyState >= 2) {
        this.inFlight = true;
        createImageBitmap(v)
          .then((bitmap) => this.worker?.postMessage({ k: 'frame', bitmap, t }, [bitmap]))
          .catch(() => (this.inFlight = false));
      } else if (!this.worker && this.engine && v.readyState >= 2) {
        try {
          this.onResult(this.engine.detect(v, t, v.videoWidth, v.videoHeight));
        } catch (e) {
          this.error = (e as Error).message;
        }
      }
      this.loop();
    };
    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(onFrame);
    else requestAnimationFrame(() => onFrame(0));
  }

  private onResult(r: EngineResult): void {
    const now = performance.now();
    this.ms = this.ms ? this.ms * 0.9 + r.ms * 0.1 : r.ms;
    if (this.lastT && r.t > this.lastT) this.frameDt += (Math.min(0.1, r.t - this.lastT) - this.frameDt) * 0.1;
    this.lastT = r.t;
    this.frames++;
    this.results++;
    if (now - this.fpsT > 1000) {
      this.fps = (this.frames * 1000) / (now - this.fpsT);
      this.frames = 0;
      this.fpsT = now;
    }
    // Auto: the precise model unless this machine can't keep up with it.
    if (this.accuracy === 'auto' && this.model === 'precise' && this.results > 90 && this.ms > 26) {
      this.model = 'fast';
      void this.configure();
    }
    const latency = (this.ms + this.frameDt * 500 + 18) / 1000;
    const poses = r.poses.map((p) => ({ ...p, x: (p.image[23 * 4]! + p.image[24 * 4]!) / 2 }));
    const n = this.players;
    const used = new Set<number>();
    const usedHands = new Set<number>();
    const order = n === 2 && poses.length === 2 ? assign2(poses.map((p) => p.x), this.tracks) : poses.map((_, k) => k);
    for (let i = 0; i < n; i++) {
      const k = order[i];
      if (k === undefined || used.has(k) || !poses[k]) continue;
      used.add(k);
      const p = poses[k]!;
      const tr = this.tracks[i]!;
      tr.x = p.x;
      tr.seenAt = now;
      tr.image = p.image;
      const det = this.detectors[i]!;
      const world: Lm[] = [];
      for (let j = 0; j < 33; j++) world.push({ x: p.world[j * 4]!, y: p.world[j * 4 + 1]!, z: p.world[j * 4 + 2]!, visibility: p.world[j * 4 + 3]! });
      const st = det.feed(r.t, world);
      if (st) this.pending[i] = st;
      // The racket hand: the tracked hand whose wrist is at this player's racket wrist.
      const at = this.arms[i]!;
      at.hand = det.hand;
      at.latency = latency;
      const wi = det.hand === 'left' ? P.lWrist : P.rWrist;
      const wx = p.image[wi * 4]! * r.aspect;
      const wy = p.image[wi * 4 + 1]!;
      let best = -1;
      let bd = 0.09;
      r.hands.forEach((h, j) => {
        if (usedHands.has(j)) return;
        const d = Math.hypot(h.image[0]! * r.aspect - wx, h.image[1]! - wy);
        if (d < bd) {
          bd = d;
          best = j;
        }
      });
      if (best >= 0) usedHands.add(best);
      const hand = best >= 0 ? r.hands[best]! : null;
      tr.hand = hand?.image ?? null;
      at.feed(r.t, now, r.aspect, p, hand);
    }
  }

  stop(): void {
    this.running = false;
    this.worker?.postMessage({ k: 'stop' });
    this.stream?.getTracks().forEach((t) => t.stop());
    this.procTrack?.stop();
    this.procTrack = null;
    this.stream = null;
    this.direct = false;
    this.inFlight = false;
    this.video.srcObject = null;
    for (const d of this.detectors) d.reset();
    for (const a of this.arms) a.reset();
    this.pending.fill(null);
  }

  /** The stroke player `i` (0 / 1) finished since the last call. */
  take(i: number): CameraStroke | null {
    const s = this.pending[i] ?? null;
    this.pending[i] = null;
    return s;
  }

  /** Player `i`'s live racket arm right now (motion play), if they're in view. */
  arm(i: number): LiveArm | null {
    return this.sees(i) ? (this.arms[i]?.predict(performance.now()) ?? null) : null;
  }

  /** Is player `i` in view right now? */
  sees(i: number): boolean {
    return performance.now() - (this.tracks[i]?.seenAt ?? 0) < 400;
  }

  /** Draw the mirrored camera image with each player's skeleton, racket hand and racket line. */
  draw(ctx: CanvasRenderingContext2D, w: number, h: number, showVideo = true): void {
    const v = this.video;
    ctx.save();
    ctx.clearRect(0, 0, w, h);
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    // Cover-fit the video (the overlay uses the same box).
    const vw0 = v.videoWidth || 640;
    const vh0 = v.videoHeight || 480;
    const fit = Math.max(w / vw0, h / vh0);
    const sw = vw0 * fit;
    const sh = vh0 * fit;
    const ox = (w - sw) / 2;
    const oy = (h - sh) / 2;
    if (showVideo && v.readyState >= 2) {
      ctx.globalAlpha = 0.85;
      ctx.drawImage(v, ox, oy, sw, sh);
      ctx.globalAlpha = 1;
    }
    const line = (x0: number, y0: number, x1: number, y1: number) => {
      ctx.beginPath();
      ctx.moveTo(ox + x0 * sw, oy + y0 * sh);
      ctx.lineTo(ox + x1 * sw, oy + y1 * sh);
      ctx.stroke();
    };
    ctx.lineCap = 'round';
    for (let i = 0; i < this.players; i++) {
      const tr = this.tracks[i]!;
      const im = tr.image;
      if (!im || !this.sees(i)) continue;
      const col = CAM_COLORS[i]!;
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(2, w / 160);
      for (const [a, b] of BONES) {
        if (im[a * 4 + 3]! < 0.3 || im[b * 4 + 3]! < 0.3) continue;
        line(im[a * 4]!, im[a * 4 + 1]!, im[b * 4]!, im[b * 4 + 1]!);
      }
      // The racket hand as the hand tracker sees it.
      if (tr.hand) {
        const hd = tr.hand;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(1.5, w / 260);
        for (const [a, b] of HAND_BONES) line(hd[a * 3]!, hd[a * 3 + 1]!, hd[b * 3]!, hd[b * 3 + 1]!);
      }
      // The racket as we think you're holding it.
      const r2 = this.arms[i]!.racket2d;
      if (r2) {
        ctx.strokeStyle = '#e7f53a';
        ctx.lineWidth = Math.max(3, w / 90);
        line(r2[0], r2[1], r2[2], r2[3]);
      }
      const d = this.detectors[i]!;
      const wi = d.hand === 'left' ? P.lWrist : P.rWrist;
      ctx.fillStyle = d.speed > 1.7 / d.sens ? '#e7f53a' : col;
      ctx.beginPath();
      ctx.arc(ox + im[wi * 4]! * sw, oy + im[wi * 4 + 1]! * sh, Math.max(5, w / 60) * (1 + Math.min(1.5, d.speed / 4)), 0, Math.PI * 2);
      ctx.fill();
      // Label over the head (unmirrored text).
      ctx.save();
      ctx.translate(ox + im[0]! * sw, oy + im[1]! * sh - h * 0.12);
      ctx.scale(-1, 1);
      ctx.fillStyle = col;
      ctx.font = `800 ${Math.max(12, w / 22)}px "Barlow Condensed", sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(`P${i + 1}`, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }
}

/** Two poses → slots [P1, P2]: the pairing that moves each the least (P1 on the image's left). */
function assign2(xs: number[], tracks: Track[]): number[] {
  const fresh = performance.now() - Math.min(tracks[0]!.seenAt, tracks[1]!.seenAt) < 1500;
  if (!fresh) return xs[0]! < xs[1]! ? [0, 1] : [1, 0];
  const keep = Math.abs(xs[0]! - tracks[0]!.x) + Math.abs(xs[1]! - tracks[1]!.x);
  const swap = Math.abs(xs[1]! - tracks[0]!.x) + Math.abs(xs[0]! - tracks[1]!.x);
  return keep <= swap ? [0, 1] : [1, 0];
}
