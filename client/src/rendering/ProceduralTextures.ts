import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';
import { SeededRandom } from '@shared/math/random';

/**
 * Runtime-generated textures. Keeping these procedural means zero download cost
 * and crisp results at any resolution; they are cached per key.
 */
const cache = new Map<string, CanvasTexture>();
let anisotropy = 8;

export function setTextureAnisotropy(value: number): void {
  anisotropy = value;
}

function make(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): CanvasTexture {
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  draw(ctx, w, h);
  const tex = new CanvasTexture(canvas);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = anisotropy;
  cache.set(key, tex);
  return tex;
}

function speckle(ctx: CanvasRenderingContext2D, w: number, h: number, count: number, colors: string[], size: [number, number], seed: number): void {
  const rng = new SeededRandom(seed);
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = rng.pick(colors);
    const s = rng.range(size[0], size[1]);
    ctx.fillRect(rng.next() * w, rng.next() * h, s, s);
  }
}

/** Asphalt with edge lines and a dashed centre line. U spans the road edge-to-edge, V repeats along it. */
export function roadTexture(): Texture {
  return make('road', 512, 1024, (ctx, w, h) => {
    ctx.fillStyle = '#585d6b';
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 26000, ['#4f5462', '#626877', '#535866', '#6a6f7e', '#4a4e5a'], [1, 3], 1);
    // Subtle darker racing-line wear.
    const wear = ctx.createLinearGradient(0, 0, w, 0);
    wear.addColorStop(0.0, 'rgba(0,0,0,0)');
    wear.addColorStop(0.32, 'rgba(30,30,40,0.10)');
    wear.addColorStop(0.4, 'rgba(0,0,0,0)');
    wear.addColorStop(0.6, 'rgba(0,0,0,0)');
    wear.addColorStop(0.68, 'rgba(30,30,40,0.10)');
    wear.addColorStop(1.0, 'rgba(0,0,0,0)');
    ctx.fillStyle = wear;
    ctx.fillRect(0, 0, w, h);
    // Edge lines.
    ctx.fillStyle = '#f4f1e8';
    ctx.fillRect(w * 0.035, 0, w * 0.018, h);
    ctx.fillRect(w * (1 - 0.035 - 0.018), 0, w * 0.018, h);
    // Dashed centre line.
    ctx.fillStyle = '#f7d046';
    for (let y = 0; y < h; y += h / 2) ctx.fillRect(w * 0.494, y + h * 0.06, w * 0.012, h * 0.3);
  });
}

/** Red/white curb blocks along V. */
export function curbTexture(): Texture {
  return make('curb', 32, 256, (ctx, w, h) => {
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#e83a3a' : '#f7f3ea';
      ctx.fillRect(0, (i * h) / 4, w, h / 4);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(0, 0, 3, h);
  });
}

/** Barrier band: red/white diagonal stripes. */
export function barrierTexture(): Texture {
  return make('barrier', 256, 64, (ctx, w, h) => {
    ctx.fillStyle = '#f7f3ea';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#e8413a';
    for (let x = -h; x < w + h; x += 64) {
      ctx.beginPath();
      ctx.moveTo(x, h);
      ctx.lineTo(x + 32, h);
      ctx.lineTo(x + 32 + h, 0);
      ctx.lineTo(x + h, 0);
      ctx.closePath();
      ctx.fill();
    }
  });
}

/** Near-white grass detail; multiplied with terrain vertex colours. */
export function grassDetailTexture(): Texture {
  return make('grass', 256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#e9efe2';
    ctx.fillRect(0, 0, w, h);
    const rng = new SeededRandom(7);
    for (let i = 0; i < 5000; i++) {
      const x = rng.next() * w;
      const y = rng.next() * h;
      const l = rng.range(3, 8);
      const shade = Math.floor(rng.range(190, 255));
      ctx.strokeStyle = `rgba(${shade - 30},${shade},${shade - 40},0.55)`;
      ctx.lineWidth = rng.range(0.8, 1.6);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + rng.range(-1.5, 1.5), y - l);
      ctx.stroke();
    }
    speckle(ctx, w, h, 900, ['rgba(255,255,255,0.5)', 'rgba(170,190,150,0.5)'], [1, 2], 9);
  });
}

export function rockTexture(): Texture {
  return make('rock', 256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#d8d2c8';
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 9000, ['#c9c2b6', '#e4ded4', '#bdb5a8', '#cfc8bb'], [2, 6], 3);
    const rng = new SeededRandom(5);
    ctx.strokeStyle = 'rgba(120,110,100,0.35)';
    for (let i = 0; i < 40; i++) {
      ctx.lineWidth = rng.range(1, 2.5);
      ctx.beginPath();
      let x = rng.next() * w;
      let y = rng.next() * h;
      ctx.moveTo(x, y);
      for (let k = 0; k < 4; k++) {
        x += rng.range(-30, 30);
        y += rng.range(-12, 12);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  });
}

export function checkerTexture(cells = 8): Texture {
  return make(`checker-${cells}`, 256, 256, (ctx, w) => {
    const s = w / cells;
    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < cells; x++) {
        ctx.fillStyle = (x + y) % 2 === 0 ? '#14121c' : '#f7f5ef';
        ctx.fillRect(x * s, y * s, s, s);
      }
    }
  });
}

/** Original in-world sponsor brands (fictional). */
export const BRANDS = [
  { name: 'ZAPP!', tag: 'ENERGY FIZZ', bg: '#ff4f9a', fg: '#fffaf0', accent: '#ffd23f' },
  { name: 'NITRO NOODLES', tag: 'FAST FOOD. FASTER.', bg: '#ffd23f', fg: '#1b1446', accent: '#ff4f00' },
  { name: 'GIZMO GAS', tag: 'FUEL THE FUN', bg: '#2fb4ff', fg: '#fffaf0', accent: '#1b1446' },
  { name: 'BOLT BURGER', tag: 'DOUBLE STACK', bg: '#ff8c1a', fg: '#fffaf0', accent: '#b3123f' },
  { name: 'TURBO TUMBLE', tag: 'GRAND PRIX', bg: '#1b1446', fg: '#ffd23f', accent: '#3fd8ff' },
] as const;

export function brandTexture(index: number): Texture {
  const b = BRANDS[index % BRANDS.length]!;
  return make(`brand-${index % BRANDS.length}`, 1024, 384, (ctx, w, h) => {
    ctx.fillStyle = b.bg;
    ctx.fillRect(0, 0, w, h);
    // Sunburst.
    ctx.save();
    ctx.translate(w * 0.85, h * 0.5);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    for (let i = 0; i < 16; i++) {
      ctx.rotate((Math.PI * 2) / 16);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(w, -40);
      ctx.lineTo(w, 40);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = b.accent;
    ctx.fillRect(0, h - 46, w, 46);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    const size = b.name.length > 10 ? 130 : 170;
    ctx.font = `900 ${size}px "Lilita One", "Arial Black", sans-serif`;
    ctx.lineWidth = 22;
    ctx.strokeStyle = '#1b1446';
    ctx.strokeText(b.name, w / 2, h * 0.42);
    ctx.fillStyle = b.fg;
    ctx.fillText(b.name, w / 2, h * 0.42);
    ctx.font = '900 34px "Nunito", "Arial Black", sans-serif';
    ctx.fillStyle = b.bg === '#1b1446' ? '#fffaf0' : '#1b1446';
    ctx.fillText(b.tag, w / 2, h - 23);
  });
}

/** Big start-gantry banner. */
export function gantryBannerTexture(): Texture {
  return make('gantry-banner', 2048, 256, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#3a2f97');
    g.addColorStop(1, '#1b1446');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // Checkered trim along the top and bottom edges.
    const cell = 32;
    [0, h - cell].forEach((rowY, row) => {
      for (let x = 0; x < w / cell; x++) {
        ctx.fillStyle = (x + row) % 2 === 0 ? '#14121c' : '#f7f5ef';
        ctx.fillRect(x * cell, rowY, cell, cell);
      }
    });
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 150px "Lilita One", "Arial Black", sans-serif';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 20;
    ctx.strokeStyle = '#1b1446';
    const text = 'TURBO  TUMBLE';
    ctx.strokeText(text, w / 2, h / 2 + 6);
    const tg = ctx.createLinearGradient(0, h * 0.25, 0, h * 0.8);
    tg.addColorStop(0, '#ffe066');
    tg.addColorStop(1, '#ff8c1a');
    ctx.fillStyle = tg;
    ctx.fillText(text, w / 2, h / 2 + 6);
  });
}

/** Repeating sponsor strip (replaces third-party brand decals on kit models). */
export function brandStripTexture(): Texture {
  const t = make('brand-strip', 512, 128, (ctx, w, h) => {
    ctx.fillStyle = '#1b1446';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ff4f9a';
    ctx.fillRect(0, h - 14, w, 14);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 64px "Lilita One", "Arial Black", sans-serif';
    ctx.fillStyle = '#ffd23f';
    ctx.fillText('TURBO TUMBLE', w / 2, h / 2 - 4);
  });
  t.flipY = false; // glTF UV convention
  return t;
}

/** Boost pad: bright chevrons pointing along +V (driving direction). */
export function boostPadTexture(): Texture {
  return make('boost-pad', 128, 256, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, '#ff5a1a');
    g.addColorStop(0.5, '#ff8c1a');
    g.addColorStop(1, '#ff5a1a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fff3a6';
    for (let y = 0; y < h; y += h / 3) {
      ctx.beginPath();
      ctx.moveTo(w * 0.12, y + h * 0.2);
      ctx.lineTo(w * 0.5, y + h * 0.05);
      ctx.lineTo(w * 0.88, y + h * 0.2);
      ctx.lineTo(w * 0.88, y + h * 0.3);
      ctx.lineTo(w * 0.5, y + h * 0.15);
      ctx.lineTo(w * 0.12, y + h * 0.3);
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = '#ffe14d';
    ctx.lineWidth = 8;
    ctx.strokeRect(4, -10, w - 8, h + 20);
  });
}
