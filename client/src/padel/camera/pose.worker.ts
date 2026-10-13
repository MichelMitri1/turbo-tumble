import { PoseEngine, type EngineOptions, type EngineResult } from './engine';

/**
 * The pose worker: detection off the main thread, so tracking never steals time from rendering.
 * Frames come straight from the camera track (a stream of VideoFrames, newest first — no queue to
 * add lag) or, where browsers can't do that, as ImageBitmaps posted by the page.
 *
 * MediaPipe loads its WebAssembly glue with importScripts, which module workers don't have: it then
 * falls back to `self.import(url)`, which we provide — fetch the script, run it as a global script.
 */
type In =
  | { k: 'init'; o: EngineOptions }
  | { k: 'opts'; o: EngineOptions }
  | { k: 'stream'; readable: ReadableStream<VideoFrame> }
  | { k: 'frame'; bitmap: ImageBitmap; t: number }
  | { k: 'stop' };
export type WorkerOut = { k: 'ready' } | { k: 'error'; msg: string } | { k: 'result'; r: EngineResult } | { k: 'idle' };

// (Typed by hand: the webworker lib would change the DOM types for the whole project.)
interface WorkerScope {
  import?: (url: string) => Promise<void>;
  postMessage(m: unknown, transfer: Transferable[]): void;
  onmessage: ((e: MessageEvent<In>) => void) | null;
}
const scope = self as unknown as WorkerScope;
scope.import = async (url: string) => {
  const code = await (await fetch(url)).text();
  (0, eval)(code);
};

const engine = new PoseEngine(true);
let ready = false;
let stopped = false;
const post = (m: WorkerOut, transfer: Transferable[] = []) => scope.postMessage(m, transfer);

function send(r: EngineResult): void {
  const tr: Transferable[] = [];
  for (const p of r.poses) tr.push(p.image.buffer, p.world.buffer);
  for (const h of r.hands) tr.push(h.image.buffer, h.world.buffer);
  post({ k: 'result', r }, tr);
}

async function pump(readable: ReadableStream<VideoFrame>): Promise<void> {
  const reader = readable.getReader();
  for (;;) {
    const { value: frame, done } = await reader.read();
    if (done || stopped) {
      frame?.close();
      break;
    }
    try {
      if (ready) send(engine.detect(frame, frame.timestamp / 1e6, frame.displayWidth, frame.displayHeight));
    } catch (e) {
      post({ k: 'error', msg: (e as Error).message });
    } finally {
      frame.close();
    }
  }
  reader.releaseLock();
}

scope.onmessage = async (e: MessageEvent<In>) => {
  const m = e.data;
  try {
    if (m.k === 'init' || m.k === 'opts') {
      ready = false;
      await engine.configure(m.o);
      ready = true;
      if (m.k === 'init') post({ k: 'ready' });
    } else if (m.k === 'stream') {
      stopped = false;
      void pump(m.readable);
    } else if (m.k === 'frame') {
      if (ready) send(engine.detect(m.bitmap, m.t, m.bitmap.width, m.bitmap.height));
      m.bitmap.close();
      post({ k: 'idle' });
    } else if (m.k === 'stop') stopped = true;
  } catch (err) {
    post({ k: 'error', msg: (err as Error).message });
    if (m.k === 'frame') post({ k: 'idle' });
  }
};
