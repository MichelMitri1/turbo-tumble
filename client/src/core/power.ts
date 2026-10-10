/**
 * Arcade-wide power limits, loaded before every game. MacBook Pro screens refresh at 120 Hz,
 * so every requestAnimationFrame loop drew twice as many frames as anyone needs, at 2× pixel
 * density: that's what made laptops hot. Defaults: 60 fps, render at most 1.5× (Retina 2×
 * is barely sharper in motion and costs ~44% more pixels).
 *
 *   ?fps=120 / ?fps=0 (uncapped)   ?dpr=2   — remembered on this device
 */
const read = (key: string, param: string, fallback: number): number => {
  try {
    const q = new URLSearchParams(location.search).get(param);
    if (q !== null) localStorage.setItem(key, q);
    const v = localStorage.getItem(key);
    return v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : fallback;
  } catch {
    return fallback;
  }
};

const fps = read('arcade-fps', 'fps', 60);
const maxDpr = read('arcade-dpr', 'dpr', 1.5);

// Pixel density: the games read devicePixelRatio to size their canvases.
const realDpr = window.devicePixelRatio;
if (maxDpr > 0 && realDpr > maxDpr) {
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, get: () => Math.min(maxDpr, realDpr) });
}

// Frame cap: callbacks run at most `fps` times a second (a 120 Hz display gives every other frame).
if (fps > 0) {
  const native = window.requestAnimationFrame.bind(window);
  const interval = 1000 / fps;
  let queue = new Map<number, FrameRequestCallback>();
  let nextId = 1;
  let scheduled = false;
  let last = -Infinity;
  const tick = (t: number): void => {
    // A little slack so a 60 Hz display (16.7 ms) never skips a frame.
    if (t - last < interval - 2) {
      native(tick);
      return;
    }
    last = t;
    scheduled = false;
    const q = queue;
    queue = new Map();
    for (const cb of q.values()) {
      try {
        cb(t);
      } catch (e) {
        setTimeout(() => {
          throw e;
        });
      }
    }
  };
  window.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    const id = nextId++;
    queue.set(id, cb);
    if (!scheduled) {
      scheduled = true;
      native(tick);
    }
    return id;
  };
  window.cancelAnimationFrame = (id: number): void => {
    queue.delete(id);
  };
}
export {};
