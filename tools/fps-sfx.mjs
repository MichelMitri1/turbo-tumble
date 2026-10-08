/**
 * Zero Hour gun sounds: trims real recordings from "The Free Firearm Sound Library"
 * (CC0, opengameart.org/content/the-free-firearm-sound-library) into one-shot mono WAVs.
 *
 *   node tools/fps-sfx.mjs "<path>/Prepared SFX Library"
 *
 * Each gun gets two perspectives: `near` (beside the shooter: your own gun) and `far`
 * (in front, further away: other players). Output: client/public/assets/fps/sfx/*.wav
 */
import { mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const src = resolve(process.argv[2] ?? 'Prepared SFX Library');
const out = resolve('client/public/assets/fps/sfx');
mkdirSync(out, { recursive: true });

// name → [folder, near file, mid file, seconds to keep]
const GUNS = {
  ar15: ['AR-15', 'D_32P', 'D_24P', 1.1],
  ak47: ['AK-47', 'C_28P', 'C_31P', 1.1],
  sks: ['SKS', 'U_14P', 'U_19P', 1.1],
  m45: ['Carl Gustav M45', 'G_31P', 'G_20P', 0.8],
  ppsh: ['PPSh', 'P_30P', 'P_30P', 0.8], // the mid-distance take is a burst: reuse the near one
  nova: ['Nova', 'O_21P', 'O_17P', 1.3],
  daly: ['CD', 'H_21P', 'H_16P', 1.3],
  model12: ['Model 12', 'K_22P', 'K_17P', 1.3],
  tikka: ['Tikka', 'W_29P', 'W_24P', 1.8],
  mosin: ['Mosin Nagant', 'M_21P', 'M_26P', 1.7],
  m1917: ['1917', 'B_24P', 'B_16P', 1.5],
  savage: ['Savage 10 .300 Blackout', 'T_27P', 'T_17P', 1.3],
  ppq: ['Walther PPQ', 'X_39P', 'X_31P', 0.8],
  m1911: ['1911', 'A_42P', 'A_34P', 0.9],
  sw642: ['Smith & Wesson 642', 'V_27P', 'V_22P', 0.9],
  marlin: ['Marlin 336', 'I_22P', 'I_17P', 1.3],
};
const RATE = 32000;

function readWav(file) {
  const b = readFileSync(file);
  let p = 12;
  let fmt = null;
  let data = null;
  while (p + 8 <= b.length) {
    const id = b.toString('ascii', p, p + 4);
    const len = b.readUInt32LE(p + 4);
    if (id === 'fmt ') fmt = { ch: b.readUInt16LE(p + 10), rate: b.readUInt32LE(p + 12), bits: b.readUInt16LE(p + 22) };
    if (id === 'data') data = b.subarray(p + 8, p + 8 + len);
    p += 8 + len + (len & 1);
  }
  const bytes = fmt.bits / 8;
  const n = Math.floor(data.length / (bytes * fmt.ch));
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < fmt.ch; c++) {
      const o = (i * fmt.ch + c) * bytes;
      s += bytes === 3 ? data.readIntLE(o, 3) / 8388608 : bytes === 2 ? data.readInt16LE(o) / 32768 : data.readFloatLE(o);
    }
    mono[i] = s / fmt.ch;
  }
  return { rate: fmt.rate, x: mono };
}

/** Windowed-sinc low-pass + decimation to RATE (integer or near-integer ratios). */
function resample(x, from) {
  const ratio = from / RATE;
  const cutoff = 0.45 / ratio;
  const taps = 63;
  const h = new Float32Array(taps);
  let sum = 0;
  for (let i = 0; i < taps; i++) {
    const m = i - (taps - 1) / 2;
    const sinc = m === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * m) / (Math.PI * m);
    h[i] = sinc * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (taps - 1)));
    sum += h[i];
  }
  for (let i = 0; i < taps; i++) h[i] /= sum;
  const n = Math.floor(x.length / ratio);
  const y = new Float32Array(n);
  for (let j = 0; j < n; j++) {
    const c = Math.round(j * ratio);
    let s = 0;
    for (let k = 0; k < taps; k++) {
      const i = c + k - (taps - 1) / 2;
      if (i >= 0 && i < x.length) s += x[i] * h[k];
    }
    y[j] = s;
  }
  return y;
}

/** The first shot: from just before the transient, `secs` long (cut before a second shot), faded out, peak-normalised. */
function oneShot(x, rate, secs) {
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  let on = 0;
  while (on < x.length && Math.abs(x[on]) < peak * 0.25) on++;
  const start = Math.max(0, on - Math.round(rate * 0.003));
  let end = Math.min(x.length, start + Math.round(rate * secs));
  // A second shot inside the window: stop just before it.
  const guard = Math.round(rate * 0.35); // echoes off the range come back well within this
  for (let i = on + guard; i < end; i++) {
    if (Math.abs(x[i]) > peak * 0.7) {
      end = i - Math.round(rate * 0.004);
      break;
    }
  }
  const y = x.slice(start, end);
  const fade = Math.round(y.length * 0.3);
  for (let i = 0; i < fade; i++) y[y.length - 1 - i] *= Math.pow(i / fade, 1.5);
  let p2 = 0;
  for (const v of y) p2 = Math.max(p2, Math.abs(v));
  for (let i = 0; i < y.length; i++) y[i] = (y[i] / p2) * 0.89;
  return y;
}

function writeWav(file, y) {
  const b = Buffer.alloc(44 + y.length * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + y.length * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(RATE, 24);
  b.writeUInt32LE(RATE * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(y.length * 2, 40);
  for (let i = 0; i < y.length; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(y[i] * 32767))), 44 + i * 2);
  writeFileSync(file, b);
}

let total = 0;
for (const [name, [folder, near, mid, secs]] of Object.entries(GUNS)) {
  for (const [tag, f] of [
    ['near', near],
    ['far', mid],
  ]) {
    const { rate, x } = readWav(join(src, folder, `${f}.wav`));
    const shot = oneShot(x, rate, secs);
    const y = resample(shot, rate);
    const file = join(out, `${name}-${tag}.wav`);
    writeWav(file, y);
    const kb = statSync(file).size / 1024;
    total += kb;
    console.log(`${name}-${tag}`.padEnd(16), `${(y.length / RATE).toFixed(2)} s`, `${kb.toFixed(0)} KB`);
  }
}
console.log(`total ${(total / 1024).toFixed(2)} MB`);
