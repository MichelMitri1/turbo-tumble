import * as THREE from 'three';
import type { Material } from '../sim/level';

/** Procedural surface textures (canvas), tiled in world metres. */
const cache = new Map<string, THREE.Texture>();

function canvas(n = 512): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = n;
  return [c, c.getContext('2d', { willReadFrequently: true })!];
}

/** Grey speckle: `amount` random size×size dots blended at `alpha`, written straight into the pixels (fillRect per dot was ~250 ms a texture). */
function noise(g: CanvasRenderingContext2D, n: number, amount: number, alpha: number, size = 1): void {
  const img = g.getImageData(0, 0, n, n);
  const d = img.data;
  for (let i = 0; i < amount; i++) {
    const v = Math.random() * 255;
    const x0 = Math.floor(Math.random() * n);
    const y0 = Math.floor(Math.random() * n);
    for (let y = y0; y < Math.min(n, y0 + size); y++)
      for (let x = x0; x < Math.min(n, x0 + size); x++) {
        const k = (y * n + x) * 4;
        d[k] = d[k]! + (v - d[k]!) * alpha;
        d[k + 1] = d[k + 1]! + (v - d[k + 1]!) * alpha;
        d[k + 2] = d[k + 2]! + (v - d[k + 2]!) * alpha;
      }
  }
  g.putImageData(img, 0, 0);
}

/** Grass blades: short vertical strokes of varied green, also written straight into the pixels. */
function blades(g: CanvasRenderingContext2D, n: number, count: number): void {
  const img = g.getImageData(0, 0, n, n);
  const d = img.data;
  for (let i = 0; i < count; i++) {
    const v = 60 + Math.random() * 70;
    const r = v * 0.7;
    const gr = v + 20;
    const b = v * 0.4;
    const x = Math.floor(Math.random() * n);
    const y0 = Math.floor(Math.random() * n);
    const len = 3 + Math.floor(Math.random() * 3);
    for (let y = y0; y < y0 + len; y++) {
      const k = ((y % n) * n + x) * 4;
      d[k] = (d[k]! + r) / 2;
      d[k + 1] = (d[k + 1]! + gr) / 2;
      d[k + 2] = (d[k + 2]! + b) / 2;
    }
  }
  g.putImageData(img, 0, 0);
}

function blotches(g: CanvasRenderingContext2D, n: number, color: string, count: number, r0: number, r1: number): void {
  for (let i = 0; i < count; i++) {
    const x = Math.random() * n;
    const y = Math.random() * n;
    const r = r0 + Math.random() * (r1 - r0);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, color);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

/** Metres of world covered by one texture repeat. */
export const TILE: Record<Material, number> = {
  concrete: 3,
  brick: 2,
  metal: 2.5,
  wood: 2,
  dirt: 4,
  sand: 6,
  asphalt: 5,
  grass: 4,
  glass: 2,
  plaster: 3,
  tile: 2,
  invisible: 1,
  marble: 2.4,
  carpet: 2,
  wallpaper: 2.4,
  darkwood: 1.6,
  shingle: 2,
  hedge: 2,
  facade: 6,
  paint: 3,
  fabric: 1,
};

export function texture(mat: Material): THREE.Texture {
  const hit = cache.get(mat);
  if (hit) return hit;
  const n = 512;
  const [c, g] = canvas(n);
  switch (mat) {
    case 'concrete': {
      g.fillStyle = '#8d8a84';
      g.fillRect(0, 0, n, n);
      blotches(g, n, 'rgba(60,58,55,0.18)', 40, 20, 90);
      blotches(g, n, 'rgba(200,198,190,0.12)', 30, 20, 70);
      noise(g, n, 40000, 0.06);
      g.strokeStyle = 'rgba(40,40,40,0.35)';
      g.lineWidth = 2;
      g.strokeRect(1, 1, n - 2, n - 2);
      g.beginPath();
      g.moveTo(0, n / 2);
      g.lineTo(n, n / 2);
      g.stroke();
      break;
    }
    case 'brick': {
      g.fillStyle = '#6e6458';
      g.fillRect(0, 0, n, n);
      const bh = n / 8;
      const bw = n / 4;
      for (let row = 0; row < 8; row++)
        for (let k = -1; k < 5; k++) {
          const x = k * bw + (row % 2 ? bw / 2 : 0);
          const shade = 120 + Math.random() * 50;
          g.fillStyle = `rgb(${shade + 30},${shade * 0.55},${shade * 0.42})`;
          g.fillRect(x + 3, row * bh + 3, bw - 6, bh - 6);
        }
      noise(g, n, 30000, 0.07);
      break;
    }
    case 'metal': {
      g.fillStyle = '#6c7278';
      g.fillRect(0, 0, n, n);
      // Corrugation.
      for (let x = 0; x < n; x += 16) {
        const grd = g.createLinearGradient(x, 0, x + 16, 0);
        grd.addColorStop(0, 'rgba(255,255,255,0.12)');
        grd.addColorStop(0.5, 'rgba(0,0,0,0.15)');
        grd.addColorStop(1, 'rgba(255,255,255,0.12)');
        g.fillStyle = grd;
        g.fillRect(x, 0, 16, n);
      }
      blotches(g, n, 'rgba(120,70,30,0.25)', 25, 10, 60);
      noise(g, n, 20000, 0.05);
      break;
    }
    case 'wood': {
      g.fillStyle = '#7a5a3a';
      g.fillRect(0, 0, n, n);
      for (let y = 0; y < n; y += n / 6) {
        g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,220,170' : '40,20,5'},0.12)`;
        g.fillRect(0, y, n, n / 6);
        g.fillStyle = 'rgba(20,10,0,0.5)';
        g.fillRect(0, y, n, 3);
      }
      for (let i = 0; i < 300; i++) {
        g.strokeStyle = `rgba(40,20,5,${Math.random() * 0.15})`;
        g.beginPath();
        const y = Math.random() * n;
        g.moveTo(0, y);
        g.bezierCurveTo(n / 3, y + 6, (2 * n) / 3, y - 6, n, y);
        g.stroke();
      }
      break;
    }
    case 'dirt':
    case 'sand': {
      g.fillStyle = mat === 'sand' ? '#c9a878' : '#7a6248';
      g.fillRect(0, 0, n, n);
      blotches(g, n, mat === 'sand' ? 'rgba(150,120,80,0.3)' : 'rgba(60,45,30,0.35)', 60, 20, 100);
      blotches(g, n, mat === 'sand' ? 'rgba(230,210,170,0.25)' : 'rgba(140,115,90,0.25)', 40, 20, 80);
      noise(g, n, 60000, 0.08, 2);
      break;
    }
    case 'asphalt': {
      g.fillStyle = '#3c3d40';
      g.fillRect(0, 0, n, n);
      noise(g, n, 80000, 0.1, 2);
      blotches(g, n, 'rgba(20,20,22,0.3)', 25, 30, 120);
      break;
    }
    case 'grass': {
      g.fillStyle = '#4d6b33';
      g.fillRect(0, 0, n, n);
      blotches(g, n, 'rgba(110,130,60,0.35)', 50, 20, 90);
      blotches(g, n, 'rgba(40,55,25,0.35)', 50, 20, 90);
      blades(g, n, 9000);
      break;
    }
    case 'plaster': {
      g.fillStyle = '#c8bfae';
      g.fillRect(0, 0, n, n);
      blotches(g, n, 'rgba(150,140,120,0.2)', 40, 20, 100);
      noise(g, n, 30000, 0.05);
      break;
    }
    case 'tile': {
      g.fillStyle = '#5a2e26';
      g.fillRect(0, 0, n, n);
      for (let y = 0; y < n; y += 32)
        for (let x = 0; x < n; x += 48) {
          const s = 70 + Math.random() * 40;
          g.fillStyle = `rgb(${s + 30},${s * 0.45},${s * 0.35})`;
          g.fillRect(x + (y % 64 ? 24 : 0), y, 46, 30);
        }
      break;
    }
    case 'marble': {
      g.fillStyle = '#e4e0d8';
      g.fillRect(0, 0, n, n);
      blotches(g, n, 'rgba(180,175,165,0.25)', 30, 30, 120);
      for (let i = 0; i < 14; i++) {
        g.strokeStyle = `rgba(110,105,100,${0.15 + Math.random() * 0.2})`;
        g.lineWidth = 1 + Math.random() * 1.5;
        g.beginPath();
        let x = Math.random() * n;
        let y = 0;
        g.moveTo(x, y);
        while (y < n) {
          x += (Math.random() - 0.5) * 60;
          y += 20 + Math.random() * 40;
          g.lineTo(x, y);
        }
        g.stroke();
      }
      // Floor tiles.
      g.strokeStyle = 'rgba(90,85,80,0.35)';
      g.lineWidth = 2;
      g.strokeRect(1, 1, n / 2 - 2, n / 2 - 2);
      g.strokeRect(n / 2 + 1, n / 2 + 1, n / 2 - 2, n / 2 - 2);
      g.strokeRect(n / 2 + 1, 1, n / 2 - 2, n / 2 - 2);
      g.strokeRect(1, n / 2 + 1, n / 2 - 2, n / 2 - 2);
      break;
    }
    case 'carpet': {
      g.fillStyle = '#d8d0c4';
      g.fillRect(0, 0, n, n);
      noise(g, n, 90000, 0.08, 2);
      g.strokeStyle = 'rgba(255,240,200,0.35)';
      g.lineWidth = 6;
      g.strokeRect(24, 24, n - 48, n - 48);
      g.strokeStyle = 'rgba(60,40,30,0.25)';
      g.lineWidth = 3;
      for (let i = 0; i < 4; i++) {
        g.beginPath();
        g.arc(n / 2, n / 2, 40 + i * 50, 0, Math.PI * 2);
        g.stroke();
      }
      break;
    }
    case 'wallpaper': {
      g.fillStyle = '#e2d8c4';
      g.fillRect(0, 0, n, n);
      // Vertical stripes and a damask diamond.
      for (let x = 0; x < n; x += 64) {
        g.fillStyle = 'rgba(120,100,70,0.12)';
        g.fillRect(x, 0, 20, n);
      }
      g.fillStyle = 'rgba(140,110,70,0.16)';
      for (let y = 0; y < n; y += 128)
        for (let x = 0; x < n; x += 128) {
          g.beginPath();
          g.moveTo(x + 64, y + 24);
          g.lineTo(x + 96, y + 64);
          g.lineTo(x + 64, y + 104);
          g.lineTo(x + 32, y + 64);
          g.fill();
        }
      noise(g, n, 20000, 0.04);
      break;
    }
    case 'darkwood': {
      g.fillStyle = '#4a2e1c';
      g.fillRect(0, 0, n, n);
      for (let y = 0; y < n; y += n / 8) {
        g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,200,150' : '20,8,0'},0.1)`;
        g.fillRect(0, y, n, n / 8);
        g.fillStyle = 'rgba(15,6,0,0.6)';
        g.fillRect(0, y, n, 2);
      }
      for (let i = 0; i < 400; i++) {
        g.strokeStyle = `rgba(20,8,0,${Math.random() * 0.2})`;
        g.beginPath();
        const y = Math.random() * n;
        g.moveTo(0, y);
        g.bezierCurveTo(n / 3, y + 4, (2 * n) / 3, y - 4, n, y);
        g.stroke();
      }
      break;
    }
    case 'shingle': {
      g.fillStyle = '#8a8a8e';
      g.fillRect(0, 0, n, n);
      for (let y = 0; y < n; y += 32)
        for (let x = -32; x < n; x += 48) {
          const v = 150 + Math.random() * 60;
          g.fillStyle = `rgb(${v},${v},${v + 4})`;
          g.fillRect(x + (y % 64 ? 24 : 0), y, 46, 30);
          g.fillStyle = 'rgba(0,0,0,0.3)';
          g.fillRect(x + (y % 64 ? 24 : 0), y + 26, 46, 4);
        }
      break;
    }
    case 'hedge': {
      g.fillStyle = '#2f4a22';
      g.fillRect(0, 0, n, n);
      for (let i = 0; i < 2600; i++) {
        const v = 40 + Math.random() * 60;
        g.fillStyle = `rgba(${v * 0.6},${v + 25},${v * 0.35},0.8)`;
        g.beginPath();
        g.arc(Math.random() * n, Math.random() * n, 3 + Math.random() * 6, 0, Math.PI * 2);
        g.fill();
      }
      break;
    }
    case 'facade': {
      // Office / apartment windows: one 6 m tile = 2 floors × 2 bays.
      g.fillStyle = '#8a8680';
      g.fillRect(0, 0, n, n);
      noise(g, n, 20000, 0.05);
      for (let fy = 0; fy < 2; fy++)
        for (let bx = 0; bx < 2; bx++) {
          const x = bx * 256 + 40;
          const y = fy * 256 + 50;
          const lit = Math.random() < 0.25;
          const grd = g.createLinearGradient(x, y, x + 176, y + 150);
          grd.addColorStop(0, lit ? '#e8d8a0' : '#4c6a80');
          grd.addColorStop(1, lit ? '#b89a60' : '#1c2a36');
          g.fillStyle = grd;
          g.fillRect(x, y, 176, 150);
          g.fillStyle = 'rgba(30,30,30,0.8)';
          g.fillRect(x + 86, y, 4, 150);
          g.fillRect(x - 6, y + 150, 188, 8);
        }
      break;
    }
    case 'paint': {
      g.fillStyle = '#ece8e0';
      g.fillRect(0, 0, n, n);
      blotches(g, n, 'rgba(160,150,140,0.12)', 30, 20, 100);
      noise(g, n, 20000, 0.04);
      break;
    }
    case 'fabric': {
      g.fillStyle = '#ddd6cc';
      g.fillRect(0, 0, n, n);
      for (let i = 0; i < n; i += 4) {
        g.fillStyle = 'rgba(0,0,0,0.06)';
        g.fillRect(i, 0, 2, n);
        g.fillRect(0, i, n, 2);
      }
      noise(g, n, 20000, 0.05);
      break;
    }
    default:
      g.fillStyle = '#888';
      g.fillRect(0, 0, n, n);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  cache.set(mat, t);
  return t;
}

/** Every surface texture, built ahead (during the loading screen) so the first frame of a match doesn't pay for them. */
export function prebuildTextures(mats: Iterable<Material>): void {
  for (const m of mats) if (m !== 'invisible') texture(m);
}
