import { SeededRandom } from './random';

/** Seeded 2D gradient (Perlin-style) noise with fBm helper. Output roughly in [-1, 1]. */
export class Noise2D {
  private readonly perm = new Uint8Array(512);
  private readonly grads: Float32Array;

  constructor(seed: number) {
    const rng = new SeededRandom(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      const t = p[i]!;
      p[i] = p[j]!;
      p[j] = t;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255]!;
    this.grads = new Float32Array(512);
    for (let i = 0; i < 256; i++) {
      const a = rng.next() * Math.PI * 2;
      this.grads[i * 2] = Math.cos(a);
      this.grads[i * 2 + 1] = Math.sin(a);
    }
  }

  private dot(hash: number, x: number, y: number): number {
    const g = (hash & 255) * 2;
    return this.grads[g]! * x + this.grads[g + 1]! * y;
  }

  noise(x: number, y: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const X = xi & 255;
    const Y = yi & 255;
    const p = this.perm;
    const aa = p[p[X]! + Y]!;
    const ab = p[p[X]! + Y + 1]!;
    const ba = p[p[X + 1]! + Y]!;
    const bb = p[p[X + 1]! + Y + 1]!;
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const x1 = this.dot(aa, xf, yf) + u * (this.dot(ba, xf - 1, yf) - this.dot(aa, xf, yf));
    const x2 = this.dot(ab, xf, yf - 1) + u * (this.dot(bb, xf - 1, yf - 1) - this.dot(ab, xf, yf - 1));
    return (x1 + v * (x2 - x1)) * 1.41;
  }

  fbm(x: number, y: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += this.noise(x * freq, y * freq) * amp;
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }
}
