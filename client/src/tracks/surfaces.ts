import { CanvasTexture, Color, MeshBasicMaterial, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace, type Material, type Texture } from 'three';
import type { TrackDefinition } from '@shared/types/track';
import { SeededRandom } from '@shared/math/random';
import { roadTexture } from '../rendering/ProceduralTextures';

/**
 * Road surfaces: every course style gets its own painted texture (U spans the road
 * edge to edge, V runs along it, one tile per 16 m), plus matching curbs and walls.
 */
export type Surface =
  | 'asphalt'
  | 'coastal'
  | 'pavers'
  | 'beachSand'
  | 'desertSand'
  | 'dirt'
  | 'redDirt'
  | 'gravel'
  | 'leaves'
  | 'cobble'
  | 'flagstone'
  | 'boardwalk'
  | 'metal'
  | 'neon'
  | 'ice'
  | 'snow'
  | 'moss'
  | 'basalt'
  | 'cloud'
  | 'starlight'
  | 'comet'
  | 'rainbow';

/** Which surface a course drives on: its road style first, then its world. */
export function surfaceFor(def: TrackDefinition): Surface {
  switch (def.roadStyle) {
    case 'sand':
      return def.theme === 'beach' ? 'beachSand' : 'desertSand';
    case 'cobble':
      return 'cobble';
    case 'wood':
      return 'boardwalk';
    case 'neon':
      return def.theme === 'city' ? 'neon' : def.theme === 'comet' ? 'comet' : 'starlight';
    case 'ice':
      return def.theme === 'glacier' ? 'ice' : 'snow';
    case 'rainbow':
      return def.theme === 'prism' ? 'rainbow' : 'starlight';
    default:
      break;
  }
  const byTheme: Record<string, Surface> = {
    tropical: 'pavers',
    sunset: 'coastal',
    farm: 'dirt',
    alpine: 'gravel',
    autumn: 'leaves',
    river: 'flagstone',
    jungle: 'flagstone',
    mushroom: 'moss',
    marsh: 'boardwalk',
    factory: 'metal',
    volcano: 'basalt',
    magma: 'basalt',
    mesa: 'redDirt',
    sky: 'cloud',
    snow: 'snow',
    glacier: 'ice',
    city: 'neon',
    starlight: 'starlight',
    comet: 'comet',
    prism: 'rainbow',
  };
  return byTheme[def.theme] ?? 'asphalt';
}

const cache = new Map<string, CanvasTexture>();

function canvasTexture(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number, rng: SeededRandom) => void, srgb = true): CanvasTexture {
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  draw(g, w, h, new SeededRandom(key.length * 977 + key.charCodeAt(0)));
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  if (srgb) t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  cache.set(key, t);
  return t;
}

function speckle(g: CanvasRenderingContext2D, w: number, h: number, n: number, colors: string[], size: [number, number], rng: SeededRandom): void {
  for (let i = 0; i < n; i++) {
    g.fillStyle = rng.pick(colors);
    const s = rng.range(size[0], size[1]);
    g.fillRect(rng.next() * w, rng.next() * h, s, s);
  }
}

/** Two worn grooves where the wheels go (u ≈ 0.3 and 0.7). */
function ruts(g: CanvasRenderingContext2D, w: number, h: number, color: string, width = 0.09): void {
  for (const u of [0.3, 0.7]) {
    const grad = g.createLinearGradient(w * (u - width), 0, w * (u + width), 0);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.5, color);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(w * (u - width), 0, w * width * 2, h);
  }
}

/** Soft darker band fading in from both road edges. */
function edgeShade(g: CanvasRenderingContext2D, w: number, h: number, color: string, depth = 0.08): void {
  for (const [a, b] of [[0, depth], [1, 1 - depth]] as const) {
    const grad = g.createLinearGradient(w * a, 0, w * b, 0);
    grad.addColorStop(0, color);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(Math.min(a, b) * w, 0, depth * w, h);
  }
}

/** Rows of stones / slabs (staggered), each slightly different in tone. */
function stones(g: CanvasRenderingContext2D, w: number, h: number, rng: SeededRandom, o: { cols: number; rows: number; base: string[]; mortar: string; jitter: number; radius: number; moss?: string }): void {
  g.fillStyle = o.mortar;
  g.fillRect(0, 0, w, h);
  const cw = w / o.cols;
  const rh = h / o.rows;
  for (let r = 0; r < o.rows; r++) {
    const off = r % 2 ? cw / 2 : 0;
    for (let c = -1; c <= o.cols; c++) {
      const x = c * cw + off + rng.range(-o.jitter, o.jitter);
      const y = r * rh + rng.range(-o.jitter, o.jitter) * 0.5;
      const sw = cw * rng.range(0.82, 0.94);
      const sh = rh * rng.range(0.8, 0.92);
      g.fillStyle = rng.pick(o.base);
      g.beginPath();
      g.roundRect(x + (cw - sw) / 2, y + (rh - sh) / 2, sw, sh, o.radius);
      g.fill();
      // Top-left highlight, bottom-right shade: stones read as raised.
      g.fillStyle = 'rgba(255,255,255,0.10)';
      g.fillRect(x + (cw - sw) / 2 + 2, y + (rh - sh) / 2 + 2, sw * 0.6, 3);
      g.fillStyle = 'rgba(0,0,0,0.14)';
      g.fillRect(x + (cw - sw) / 2 + 3, y + (rh + sh) / 2 - 4, sw - 6, 3);
      if (o.moss && rng.chance(0.25)) {
        g.fillStyle = o.moss;
        g.beginPath();
        g.ellipse(x + cw * rng.range(0.2, 0.8), y + rh * rng.range(0.2, 0.8), cw * 0.2, rh * 0.18, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
}

/** Wavy ripples across the road (wind-blown sand). */
function ripples(g: CanvasRenderingContext2D, w: number, h: number, rng: SeededRandom, light: string, dark: string, count: number): void {
  for (let i = 0; i < count; i++) {
    const y0 = (i / count) * h;
    const amp = rng.range(4, 10);
    const ph = rng.range(0, 6.28);
    const freq = rng.range(1.5, 3);
    for (const [col, dy, lw] of [[dark, 3, 3], [light, 0, 2]] as const) {
      g.strokeStyle = col;
      g.lineWidth = lw;
      g.beginPath();
      for (let x = 0; x <= w; x += 8) {
        const y = y0 + dy + Math.sin((x / w) * Math.PI * 2 * freq + ph) * amp;
        if (x === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
  }
}

function crackLines(g: CanvasRenderingContext2D, w: number, h: number, rng: SeededRandom, color: string, n: number, lw: [number, number], seg = 6): void {
  g.strokeStyle = color;
  for (let i = 0; i < n; i++) {
    g.lineWidth = rng.range(lw[0], lw[1]);
    g.beginPath();
    let x = rng.next() * w;
    let y = rng.next() * h;
    g.moveTo(x, y);
    for (let k = 0; k < seg; k++) {
      x += rng.range(-40, 40);
      y += rng.range(-40, 40);
      g.lineTo(x, y);
      if (rng.chance(0.3)) {
        g.moveTo(x, y);
        g.lineTo(x + rng.range(-30, 30), y + rng.range(-30, 30));
        g.moveTo(x, y);
      }
    }
    g.stroke();
  }
}

const W = 512;
const H = 1024;

/** Colour map of a surface. */
function surfaceMap(surface: Surface): Texture {
  switch (surface) {
    case 'asphalt':
    case 'rainbow':
      return roadTexture();
    case 'coastal':
      return canvasTexture('coastal', W, H, (g, w, h, rng) => {
        g.fillStyle = '#4e5260';
        g.fillRect(0, 0, w, h);
        speckle(g, w, h, 24000, ['#464a57', '#585c6a', '#4b4f5c', '#62667a'], [1, 3], rng);
        g.fillStyle = '#f4f1e8';
        g.fillRect(w * 0.035, 0, w * 0.02, h);
        g.fillRect(w * (1 - 0.055), 0, w * 0.02, h);
        // Double solid yellow: the coast road.
        g.fillStyle = '#f2c230';
        g.fillRect(w * 0.482, 0, w * 0.011, h);
        g.fillRect(w * 0.507, 0, w * 0.011, h);
      });
    case 'pavers':
      return canvasTexture('pavers', W, H, (g, w, h, rng) => {
        stones(g, w, h, rng, { cols: 8, rows: 16, base: ['#e8dcc4', '#dccfb4', '#efe4cc', '#d8c7a8', '#e2d2b6'], mortar: '#b8a888', jitter: 1, radius: 4 });
        // Terracotta band down each side and a dashed white centre.
        g.fillStyle = '#c86a48';
        g.fillRect(0, 0, w * 0.07, h);
        g.fillRect(w * 0.93, 0, w * 0.07, h);
        g.fillStyle = 'rgba(255,255,255,0.85)';
        for (let y = 0; y < h; y += h / 4) g.fillRect(w * 0.492, y + 20, w * 0.016, h * 0.12);
      });
    case 'beachSand':
      return canvasTexture('beachSand', W, H, (g, w, h, rng) => {
        g.fillStyle = '#f1e2bc';
        g.fillRect(0, 0, w, h);
        speckle(g, w, h, 16000, ['#e9d8ae', '#f7ebcb', '#e2cfa2', '#fbf2d8'], [1, 3], rng);
        ripples(g, w, h, rng, 'rgba(255,250,235,0.55)', 'rgba(190,160,110,0.28)', 22);
        ruts(g, w, h, 'rgba(170,140,95,0.32)');
        edgeShade(g, w, h, 'rgba(150,125,85,0.35)', 0.07);
        // Shells and pebbles.
        speckle(g, w, h, 160, ['#ffffff', '#f6c8c0', '#c8b8a8', '#ffd9b0'], [3, 6], rng);
      });
    case 'desertSand':
      return canvasTexture('desertSand', W, H, (g, w, h, rng) => {
        g.fillStyle = '#dcae72';
        g.fillRect(0, 0, w, h);
        speckle(g, w, h, 16000, ['#d4a468', '#e4ba80', '#cc9a5e', '#e8c28c'], [1, 3], rng);
        ripples(g, w, h, rng, 'rgba(255,225,170,0.45)', 'rgba(150,95,50,0.3)', 14);
        ruts(g, w, h, 'rgba(140,90,50,0.35)');
        edgeShade(g, w, h, 'rgba(120,70,35,0.4)', 0.08);
      });
    case 'gravel':
      return canvasTexture('gravel', W, H, (g, w, h, rng) => {
        g.fillStyle = '#8a8478';
        g.fillRect(0, 0, w, h);
        speckle(g, w, h, 30000, ['#7a7468', '#9a948a', '#6e685e', '#a8a296', '#5e5a52'], [1, 4], rng);
        ruts(g, w, h, 'rgba(60,55,45,0.35)', 0.08);
        // Fallen pine needles and cones along the verges.
        for (let i = 0; i < 900; i++) {
          const u = rng.chance(0.5) ? rng.range(0, 0.12) : rng.range(0.88, 1);
          g.strokeStyle = rng.pick(['#6a4a2a', '#8a6238', '#4a5a2a']);
          g.lineWidth = 1.2;
          const x = u * w;
          const y = rng.next() * h;
          const a = rng.range(0, 6.28);
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x + Math.cos(a) * 7, y + Math.sin(a) * 7);
          g.stroke();
        }
        g.fillStyle = 'rgba(245,240,225,0.85)';
        g.fillRect(w * 0.035, 0, w * 0.014, h);
        g.fillRect(w * (1 - 0.049), 0, w * 0.014, h);
        edgeShade(g, w, h, 'rgba(50,45,35,0.35)', 0.06);
      });
    case 'dirt':
    case 'redDirt': {
      const red = surface === 'redDirt';
      return canvasTexture(surface, W, H, (g, w, h, rng) => {
        g.fillStyle = red ? '#a8603e' : '#9a7650';
        g.fillRect(0, 0, w, h);
        speckle(g, w, h, 20000, red ? ['#9a5436', '#b46c48', '#8e4c30', '#c07a52'] : ['#8e6c48', '#a6825a', '#86643f', '#b08c62'], [1, 4], rng);
        ruts(g, w, h, red ? 'rgba(80,30,15,0.38)' : 'rgba(70,45,25,0.38)', 0.1);
        speckle(g, w, h, 900, ['#cbbca4', '#7a6a5a', '#e2d4bc'], [2, 5], rng);
        // Grass tufts creeping in at the edges.
        if (!red) {
          for (let i = 0; i < 700; i++) {
            const side = rng.chance(0.5) ? rng.range(0, 0.07) : rng.range(0.93, 1);
            g.fillStyle = rng.pick(['#6a9a3a', '#7aaa44', '#5a8a30']);
            g.fillRect(side * w, rng.next() * h, rng.range(2, 4), rng.range(4, 9));
          }
        }
        edgeShade(g, w, h, red ? 'rgba(70,25,10,0.35)' : 'rgba(60,40,20,0.35)', 0.06);
      });
    }
    case 'leaves':
      return canvasTexture('leaves', W, H, (g, w, h, rng) => {
        const base = roadTexture().image as HTMLCanvasElement;
        g.drawImage(base, 0, 0, w, h);
        g.fillStyle = 'rgba(90,60,40,0.12)';
        g.fillRect(0, 0, w, h);
        // Drifts of fallen leaves, thicker towards the verges.
        for (let i = 0; i < 1400; i++) {
          const edge = rng.chance(0.65);
          const u = edge ? (rng.chance(0.5) ? rng.range(0, 0.16) : rng.range(0.84, 1)) : rng.next();
          g.save();
          g.translate(u * w, rng.next() * h);
          g.rotate(rng.range(0, 6.28));
          g.fillStyle = rng.pick(['#e0662a', '#c8401e', '#f0a030', '#b85a24', '#e8c040']);
          g.beginPath();
          g.ellipse(0, 0, rng.range(4, 8), rng.range(2, 4), 0, 0, Math.PI * 2);
          g.fill();
          g.restore();
        }
      });
    case 'cobble':
      return canvasTexture('cobble', W, H, (g, w, h, rng) => {
        stones(g, w, h, rng, { cols: 10, rows: 22, base: ['#b8aa98', '#a89a86', '#c4b6a2', '#9c8e7c', '#b0a08a'], mortar: '#6e6456', jitter: 3, radius: 10, moss: 'rgba(110,140,70,0.45)' });
        edgeShade(g, w, h, 'rgba(50,40,30,0.4)', 0.06);
      });
    case 'flagstone':
      return canvasTexture('flagstone', W, H, (g, w, h, rng) => {
        stones(g, w, h, rng, { cols: 5, rows: 9, base: ['#8e9688', '#7e8678', '#9aa292', '#869080', '#a0a494'], mortar: '#4a5a3a', jitter: 8, radius: 14, moss: 'rgba(80,130,60,0.55)' });
        crackLines(g, w, h, rng, 'rgba(40,50,35,0.35)', 30, [1, 2], 3);
        edgeShade(g, w, h, 'rgba(40,60,30,0.45)', 0.07);
      });
    case 'boardwalk':
      return canvasTexture('boardwalk', W, H, (g, w, h, rng) => {
        g.fillStyle = '#3a2a1e';
        g.fillRect(0, 0, w, h);
        const planks = 40;
        const ph = h / planks;
        for (let i = 0; i < planks; i++) {
          const tone = rng.pick(['#8a6a4a', '#7a5c3e', '#94744e', '#6e5236', '#86684a']);
          g.fillStyle = tone;
          g.fillRect(0, i * ph + 2, w, ph - 4);
          // Grain.
          g.strokeStyle = 'rgba(40,25,15,0.25)';
          g.lineWidth = 1;
          for (let k = 0; k < 4; k++) {
            g.beginPath();
            const y = i * ph + 4 + k * (ph - 8) / 3;
            g.moveTo(0, y);
            for (let x = 0; x <= w; x += 32) g.lineTo(x, y + rng.range(-1.2, 1.2));
            g.stroke();
          }
          // Nails over the two stringers.
          g.fillStyle = '#2a2a2a';
          for (const u of [0.12, 0.5, 0.88]) {
            g.fillRect(u * w - 3, i * ph + 5, 3, 3);
            g.fillRect(u * w - 3, i * ph + ph - 8, 3, 3);
          }
        }
        edgeShade(g, w, h, 'rgba(20,12,6,0.5)', 0.05);
      });
    case 'metal':
      return canvasTexture('metal', W, H, (g, w, h, rng) => {
        g.fillStyle = '#7a7e86';
        g.fillRect(0, 0, w, h);
        // Diamond tread.
        g.fillStyle = 'rgba(210,215,225,0.35)';
        for (let y = 0; y < h; y += 16) {
          for (let x = (y / 16) % 2 ? 8 : 0; x < w; x += 16) {
            g.save();
            g.translate(x, y);
            g.rotate(Math.PI / 4);
            g.fillRect(-5, -1.2, 10, 2.4);
            g.restore();
          }
        }
        speckle(g, w, h, 4000, ['rgba(60,50,40,0.25)', 'rgba(160,90,40,0.18)'], [1, 4], rng);
        // Plate seams and rivets.
        g.strokeStyle = 'rgba(30,32,38,0.75)';
        g.lineWidth = 3;
        for (let y = 0; y <= h; y += h / 4) {
          g.beginPath();
          g.moveTo(0, y);
          g.lineTo(w, y);
          g.stroke();
        }
        g.beginPath();
        g.moveTo(w / 2, 0);
        g.lineTo(w / 2, h);
        g.stroke();
        g.fillStyle = '#b8bcc4';
        for (let y = 10; y < h; y += h / 4) for (let x = 20; x < w; x += 60) g.fillRect(x, y, 4, 4);
        // Hazard stripes along both edges.
        for (const x0 of [0, w * 0.93]) {
          g.save();
          g.beginPath();
          g.rect(x0, 0, w * 0.07, h);
          g.clip();
          g.fillStyle = '#1e1e22';
          g.fillRect(x0, 0, w * 0.07, h);
          g.fillStyle = '#f2c230';
          for (let y = -64; y < h + 64; y += 48) {
            g.beginPath();
            g.moveTo(x0, y);
            g.lineTo(x0 + w * 0.07, y + 24);
            g.lineTo(x0 + w * 0.07, y + 48);
            g.lineTo(x0, y + 24);
            g.fill();
          }
          g.restore();
        }
      });
    case 'neon':
      return canvasTexture('neon', W, H, (g, w, h, rng) => {
        g.fillStyle = '#25223a';
        g.fillRect(0, 0, w, h);
        speckle(g, w, h, 14000, ['#211e34', '#2c2844', '#1e1b2e'], [1, 3], rng);
        g.strokeStyle = 'rgba(80,220,255,0.35)';
        g.lineWidth = 2;
        for (let y = 0; y <= h; y += 64) {
          g.beginPath();
          g.moveTo(0, y);
          g.lineTo(w, y);
          g.stroke();
        }
        for (let x = 0; x <= w; x += 64) {
          g.beginPath();
          g.moveTo(x, 0);
          g.lineTo(x, h);
          g.stroke();
        }
        g.fillStyle = '#3fe8ff';
        g.fillRect(w * 0.03, 0, w * 0.018, h);
        g.fillStyle = '#ff3fb4';
        g.fillRect(w * (1 - 0.048), 0, w * 0.018, h);
        // Chevrons down the middle.
        g.strokeStyle = 'rgba(255,240,120,0.9)';
        g.lineWidth = 6;
        for (let y = 60; y < h; y += h / 3) {
          g.beginPath();
          g.moveTo(w * 0.44, y + 30);
          g.lineTo(w * 0.5, y);
          g.lineTo(w * 0.56, y + 30);
          g.stroke();
        }
      });
    case 'ice':
      return canvasTexture('ice', W, H, (g, w, h, rng) => {
        const grad = g.createLinearGradient(0, 0, w, h);
        grad.addColorStop(0, '#bfe8fa');
        grad.addColorStop(0.5, '#9fd6f2');
        grad.addColorStop(1, '#c8eefc');
        g.fillStyle = grad;
        g.fillRect(0, 0, w, h);
        // Deep blue patches under the surface, bubbles, then white cracks on top.
        for (let i = 0; i < 40; i++) {
          g.fillStyle = `rgba(60,140,200,${rng.range(0.08, 0.2)})`;
          g.beginPath();
          g.ellipse(rng.next() * w, rng.next() * h, rng.range(20, 70), rng.range(30, 110), rng.range(0, 3), 0, Math.PI * 2);
          g.fill();
        }
        speckle(g, w, h, 600, ['rgba(255,255,255,0.7)', 'rgba(220,245,255,0.6)'], [2, 4], rng);
        crackLines(g, w, h, rng, 'rgba(255,255,255,0.85)', 26, [1, 2.5]);
        crackLines(g, w, h, rng, 'rgba(70,150,210,0.45)', 14, [1, 2]);
        g.fillStyle = 'rgba(255,255,255,0.8)';
        g.fillRect(w * 0.03, 0, w * 0.015, h);
        g.fillRect(w * (1 - 0.045), 0, w * 0.015, h);
      });
    case 'snow':
      return canvasTexture('snow', W, H, (g, w, h, rng) => {
        g.fillStyle = '#e6eef8';
        g.fillRect(0, 0, w, h);
        speckle(g, w, h, 14000, ['#dbe6f2', '#f2f7fc', '#d2deec', '#ffffff'], [1, 3], rng);
        ruts(g, w, h, 'rgba(120,150,190,0.4)', 0.07);
        // Tyre tread marks in the ruts.
        g.fillStyle = 'rgba(100,130,170,0.25)';
        for (const u of [0.3, 0.7]) for (let y = 0; y < h; y += 14) g.fillRect(w * (u - 0.035), y, w * 0.07, 5);
        speckle(g, w, h, 500, ['rgba(255,255,255,1)', 'rgba(200,230,255,1)'], [2, 3], rng);
        edgeShade(g, w, h, 'rgba(140,165,200,0.35)', 0.06);
      });
    case 'moss':
      return canvasTexture('moss', W, H, (g, w, h, rng) => {
        g.fillStyle = '#5a4a6e';
        g.fillRect(0, 0, w, h);
        speckle(g, w, h, 20000, ['#524466', '#64547a', '#4a3e5c', '#6a5a80'], [1, 4], rng);
        for (let i = 0; i < 120; i++) {
          g.fillStyle = rng.pick(['rgba(110,150,90,0.4)', 'rgba(90,130,110,0.35)']);
          g.beginPath();
          g.ellipse(rng.next() * w, rng.next() * h, rng.range(10, 40), rng.range(10, 50), 0, 0, Math.PI * 2);
          g.fill();
        }
        ruts(g, w, h, 'rgba(40,28,50,0.35)');
        speckle(g, w, h, 260, ['#c6ff7a', '#ff9ae8', '#9af0ff'], [2, 4], rng);
        edgeShade(g, w, h, 'rgba(30,20,40,0.5)', 0.07);
      });
    case 'basalt':
      return canvasTexture('basalt', W, H, (g, w, h, rng) => {
        stones(g, w, h, rng, { cols: 6, rows: 11, base: ['#2e2826', '#3a3230', '#26201e', '#342c2a'], mortar: '#ff6a1a', jitter: 6, radius: 6 });
        speckle(g, w, h, 6000, ['rgba(0,0,0,0.3)', 'rgba(90,70,60,0.3)'], [1, 3], rng);
        edgeShade(g, w, h, 'rgba(0,0,0,0.5)', 0.06);
      });
    case 'cloud':
      return canvasTexture('cloud', W, H, (g, w, h, rng) => {
        stones(g, w, h, rng, { cols: 4, rows: 8, base: ['#fbfbff', '#f2f4fa', '#f6f8ff', '#eef0f8'], mortar: '#d8b858', jitter: 0, radius: 2 });
        // Faint marble veins.
        crackLines(g, w, h, rng, 'rgba(170,180,210,0.35)', 30, [0.8, 1.6], 5);
        g.fillStyle = '#e8c048';
        g.fillRect(0, 0, w * 0.04, h);
        g.fillRect(w * 0.96, 0, w * 0.04, h);
      });
    case 'comet':
      // Teal glass panels with a glowing hex seam and chevron spine.
      return canvasTexture('comet', W, H, (g, w, h, rng) => {
        const grad = g.createLinearGradient(0, 0, w, 0);
        grad.addColorStop(0, '#0e5a5a');
        grad.addColorStop(0.5, '#082a30');
        grad.addColorStop(1, '#0e5a5a');
        g.fillStyle = grad;
        g.fillRect(0, 0, w, h);
        g.strokeStyle = 'rgba(90,255,216,0.4)';
        g.lineWidth = 2;
        for (let y = 0; y < h; y += 96) {
          for (let x = 0; x < w; x += 96) {
            g.beginPath();
            for (let k = 0; k <= 6; k++) {
              const a = (k / 6) * Math.PI * 2;
              const px = x + 48 + Math.cos(a) * 40;
              const py = y + 48 + Math.sin(a) * 40;
              if (k) g.lineTo(px, py);
              else g.moveTo(px, py);
            }
            g.stroke();
          }
        }
        speckle(g, w, h, 500, ['#ffffff', '#9afff0'], [1, 3], rng);
        g.fillStyle = '#5affd8';
        g.fillRect(w * 0.03, 0, w * 0.016, h);
        g.fillRect(w * (1 - 0.046), 0, w * 0.016, h);
        g.strokeStyle = 'rgba(255,240,140,0.9)';
        g.lineWidth = 6;
        for (let y = 40; y < h; y += h / 4) {
          g.beginPath();
          g.moveTo(w * 0.45, y + 24);
          g.lineTo(w * 0.5, y);
          g.lineTo(w * 0.55, y + 24);
          g.stroke();
        }
      });
    case 'starlight':
      return canvasTexture('starlight', W, H, (g, w, h, rng) => {
        const grad = g.createLinearGradient(0, 0, w, 0);
        grad.addColorStop(0, '#2a2a7a');
        grad.addColorStop(0.5, '#141448');
        grad.addColorStop(1, '#2a2a7a');
        g.fillStyle = grad;
        g.fillRect(0, 0, w, h);
        speckle(g, w, h, 900, ['#ffffff', '#bfe0ff', '#ffe8a0'], [1, 3], rng);
        g.fillStyle = '#8af0ff';
        g.fillRect(w * 0.03, 0, w * 0.016, h);
        g.fillRect(w * (1 - 0.046), 0, w * 0.016, h);
        g.fillStyle = 'rgba(255,230,120,0.95)';
        for (let y = 0; y < h; y += h / 6) g.fillRect(w * 0.494, y, w * 0.012, h * 0.08);
      });
  }
}

/** Glow map for surfaces that light up (neon lines, lava seams, stars). */
function surfaceGlow(surface: Surface): Texture | null {
  switch (surface) {
    case 'neon':
    case 'starlight':
    case 'comet':
    case 'basalt':
      return surfaceMap(surface);
    case 'moss':
      return canvasTexture('moss-glow', W, H, (g, w, h, rng) => {
        g.fillStyle = '#000000';
        g.fillRect(0, 0, w, h);
        speckle(g, w, h, 260, ['#c6ff7a', '#ff9ae8', '#9af0ff'], [2, 4], rng);
      });
    default:
      return null;
  }
}

interface SurfaceLook {
  roughness: number;
  metalness?: number;
  emissive?: string;
  emissiveIntensity?: number;
}

const LOOK: Partial<Record<Surface, SurfaceLook>> = {
  ice: { roughness: 0.12, metalness: 0.15 },
  snow: { roughness: 0.75 },
  metal: { roughness: 0.42, metalness: 0.55 },
  neon: { roughness: 0.5, emissive: '#ffffff', emissiveIntensity: 0.55 },
  starlight: { roughness: 0.3, metalness: 0.2, emissive: '#ffffff', emissiveIntensity: 0.6 },
  comet: { roughness: 0.25, metalness: 0.3, emissive: '#ffffff', emissiveIntensity: 0.55 },
  basalt: { roughness: 0.9, emissive: '#ffffff', emissiveIntensity: 0.9 },
  moss: { roughness: 0.95, emissive: '#ffffff', emissiveIntensity: 0.9 },
  cloud: { roughness: 0.35, emissive: '#fff8e0', emissiveIntensity: 0.12 },
  boardwalk: { roughness: 0.9 },
  beachSand: { roughness: 0.95 },
  desertSand: { roughness: 0.95 },
};

const materials = new Map<Surface, Material>();

/** Road material for a surface (vertex colours carry tunnel shading / rainbow hue). */
export function surfaceMaterial(surface: Surface): Material {
  let m = materials.get(surface);
  if (m) return m;
  if (surface === 'rainbow') m = rainbowMaterial();
  else {
    const look = LOOK[surface] ?? { roughness: 0.86 };
    const glow = surfaceGlow(surface);
    m = new MeshStandardMaterial({
      map: surfaceMap(surface),
      roughness: look.roughness,
      metalness: look.metalness ?? 0,
      vertexColors: true,
      ...(glow ? { emissive: new Color(look.emissive ?? '#ffffff'), emissiveMap: glow, emissiveIntensity: look.emissiveIntensity ?? 0.6 } : look.emissive ? { emissive: new Color(look.emissive), emissiveIntensity: look.emissiveIntensity ?? 0.2 } : {}),
    });
  }
  materials.set(surface, m);
  return m;
}

/** Shared clock for animated surfaces (advanced by the road builder's updatable). */
export const surfaceClock = { value: 0 };

/**
 * Rainbow road: saturated hue bands sweeping along the road and drifting forward,
 * a bright glowing core with white lane sparkles — unlit, so it glows in space.
 */
function rainbowMaterial(): Material {
  const tex = canvasTexture('rainbow-detail', 256, 512, (g, w, h, rng) => {
    g.fillStyle = '#d8d8d8';
    g.fillRect(0, 0, w, h);
    // Lane seams and the bright edge rails.
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w * 0.05, h);
    g.fillRect(w * 0.95, 0, w * 0.05, h);
    g.fillStyle = 'rgba(255,255,255,0.9)';
    for (const u of [0.333, 0.666]) for (let y = 0; y < h; y += h / 4) g.fillRect(w * u - 2, y, 4, h * 0.14);
    speckle(g, w, h, 500, ['#ffffff', '#fff6c8'], [1, 3], rng);
    // Faint diagonal stripes give the bands texture.
    g.fillStyle = 'rgba(0,0,0,0.08)';
    for (let y = -w; y < h; y += 48) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y + w * 0.4);
      g.lineTo(w, y + w * 0.4 + 18);
      g.lineTo(0, y + 18);
      g.fill();
    }
  });
  const mat = new MeshBasicMaterial({ map: tex, vertexColors: true });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = surfaceClock;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vRainbowUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvRainbowUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec2 vRainbowUv;
uniform float uTime;
vec3 rbHue(float h) {
  vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return k * k * (3.0 - 2.0 * k);
}`,
      )
      .replace(
        '#include <color_fragment>',
        `// Hue bands along the road (V) that drift forward, shifted a little across it (U).
float band = vRainbowUv.y * 0.42 - uTime * 0.35 + (vRainbowUv.x - 0.5) * 0.18;
vec3 hue = rbHue(fract(band));
float core = 1.0 - pow(abs(vRainbowUv.x - 0.5) * 2.0, 3.0);
diffuseColor.rgb *= hue * (0.75 + 0.55 * core);`,
      );
  };
  mat.customProgramCacheKey = () => 'rainbow-road';
  return mat;
}

/** Curb stripes per surface (two colours alternating along the road). */
export const CURB_COLORS: Partial<Record<Surface, [string, string]>> = {
  coastal: ['#2a6ad8', '#f7f3ea'],
  pavers: ['#c86a48', '#f7ecd8'],
  beachSand: ['#3fc6d8', '#fff6e0'],
  desertSand: ['#c8742a', '#f2dcb0'],
  dirt: ['#8a5a32', '#c8a070'],
  gravel: ['#3a5a3a', '#e8e0c8'],
  redDirt: ['#7a3a22', '#c88a5a'],
  leaves: ['#d0581e', '#f2e2c4'],
  cobble: ['#8a7c68', '#d8cbb4'],
  flagstone: ['#5a6a4a', '#b8b8a0'],
  boardwalk: ['#5a4030', '#9a7a58'],
  metal: ['#1e1e22', '#f2c230'],
  neon: ['#ff3fb4', '#3fe8ff'],
  ice: ['#3a8ad8', '#f4fbff'],
  snow: ['#d83a3a', '#f4fbff'],
  moss: ['#8a4ac8', '#c6ff7a'],
  basalt: ['#1e1816', '#ff7a2a'],
  cloud: ['#e8c048', '#ffffff'],
  starlight: ['#8af0ff', '#2a2a7a'],
  comet: ['#5affd8', '#0a2a2a'],
  rainbow: ['#ffffff', '#ffd8f8'],
};

export function curbTextureFor(surface: Surface): Texture | null {
  const colors = CURB_COLORS[surface];
  if (!colors) return null;
  return canvasTexture(`curb-${surface}`, 32, 256, (g, w, h) => {
    for (let i = 0; i < 4; i++) {
      g.fillStyle = colors[i % 2]!;
      g.fillRect(0, (i * h) / 4, w, h / 4);
    }
    g.fillStyle = 'rgba(0,0,0,0.12)';
    g.fillRect(0, 0, 3, h);
  });
}

/** Wall / barrier look per surface: a texture (V along the road) and roughness. */
export function barrierTextureFor(surface: Surface): Texture | null {
  switch (surface) {
    case 'dirt':
    case 'gravel':
    case 'leaves':
    case 'boardwalk':
    case 'redDirt':
      // Wooden rail fence.
      return canvasTexture(`fence-${surface}`, 64, 256, (g, w, h, rng) => {
        g.fillStyle = surface === 'boardwalk' ? '#4a3a2e' : '#8a6040';
        g.fillRect(0, 0, w, h);
        for (let y = 0; y < h; y += 8) {
          g.fillStyle = `rgba(40,25,10,${rng.range(0.05, 0.2)})`;
          g.fillRect(0, y, w, 3);
        }
        g.fillStyle = surface === 'boardwalk' ? '#2e241c' : '#5a3a22';
        g.fillRect(0, 0, w, 12);
        g.fillRect(0, h / 2, w, 12);
      });
    case 'cobble':
    case 'flagstone':
    case 'pavers':
      // Dry-stone wall.
      return canvasTexture(`wall-${surface}`, 128, 256, (g, w, h, rng) => {
        stones(g, w, h, rng, { cols: 3, rows: 10, base: surface === 'flagstone' ? ['#7a8270', '#8a927e', '#6e7664'] : ['#b8aa94', '#a89a84', '#c8baa2'], mortar: '#5a5246', jitter: 3, radius: 6, moss: 'rgba(90,130,60,0.5)' });
      });
    case 'metal':
      return canvasTexture('wall-metal', 64, 256, (g, w, h) => {
        g.fillStyle = '#f2c230';
        g.fillRect(0, 0, w, h);
        g.fillStyle = '#1e1e22';
        for (let y = -64; y < h + 64; y += 64) {
          g.beginPath();
          g.moveTo(0, y);
          g.lineTo(w, y + 32);
          g.lineTo(w, y + 64);
          g.lineTo(0, y + 32);
          g.fill();
        }
      });
    case 'ice':
    case 'snow':
      return canvasTexture(`wall-${surface}`, 64, 256, (g, w, h, rng) => {
        g.fillStyle = surface === 'ice' ? '#a8dcf4' : '#f2f6fc';
        g.fillRect(0, 0, w, h);
        speckle(g, w, h, 300, ['rgba(255,255,255,0.8)', 'rgba(140,190,230,0.4)'], [2, 5], rng);
        if (surface === 'snow') {
          g.fillStyle = '#d83a3a';
          for (let y = 0; y < h; y += 64) g.fillRect(0, y, w, 10);
        }
      });
    case 'basalt':
      return canvasTexture('wall-basalt', 64, 256, (g, w, h, rng) => {
        g.fillStyle = '#2a2220';
        g.fillRect(0, 0, w, h);
        speckle(g, w, h, 500, ['#3a302c', '#1a1414'], [2, 6], rng);
        g.fillStyle = '#ff6a1a';
        g.fillRect(0, h * 0.45, w, 4);
      });
    case 'neon':
    case 'starlight':
    case 'comet':
      return canvasTexture(`wall-${surface}`, 64, 256, (g, w, h) => {
        g.fillStyle = '#1a1830';
        g.fillRect(0, 0, w, h);
        g.fillStyle = surface === 'neon' ? '#3fe8ff' : '#8af0ff';
        g.fillRect(0, 10, w, 6);
        g.fillStyle = surface === 'neon' ? '#ff3fb4' : '#ffe14d';
        for (let y = 40; y < h; y += 64) g.fillRect(0, y, w, 4);
      });
    case 'beachSand':
      // Rope-and-post beach barrier (white and turquoise).
      return canvasTexture('wall-beach', 64, 256, (g, w, h) => {
        for (let i = 0; i < 4; i++) {
          g.fillStyle = i % 2 ? '#3fc6d8' : '#fff6e0';
          g.fillRect(0, (i * h) / 4, w, h / 4);
        }
      });
    case 'desertSand':
      return canvasTexture('wall-desert', 64, 256, (g, w, h, rng) => {
        g.fillStyle = '#c89058';
        g.fillRect(0, 0, w, h);
        speckle(g, w, h, 400, ['#b07840', '#dca870'], [2, 6], rng);
      });
    case 'rainbow':
    case 'cloud':
    case 'coastal':
      // Two-tone rail: glowing white/pink, gold/white, or blue/white.
      return canvasTexture(`wall-${surface}`, 64, 256, (g, w, h) => {
        const [a, c] = surface === 'rainbow' ? ['#ffffff', '#ff9af0'] : surface === 'cloud' ? ['#ffffff', '#f2c440'] : ['#f7f3ea', '#2a6ad8'];
        for (let i = 0; i < 4; i++) {
          g.fillStyle = i % 2 ? c : a;
          g.fillRect(0, (i * h) / 4, w, h / 4);
        }
      });
    case 'moss':
      return canvasTexture('wall-moss', 64, 256, (g, w, h) => {
        g.fillStyle = '#4a3a5e';
        g.fillRect(0, 0, w, h);
        g.fillStyle = '#c6ff7a';
        for (let y = 0; y < h; y += 32) g.fillRect(0, y, w, 3);
      });
    default:
      return null;
  }
}

/** Glow for neon-ish walls. */
export function barrierGlow(surface: Surface): boolean {
  return surface === 'neon' || surface === 'starlight' || surface === 'comet' || surface === 'basalt' || surface === 'moss' || surface === 'rainbow';
}
