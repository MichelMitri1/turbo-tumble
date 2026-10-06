/**
 * Builds the engine loop library from real recordings (CC BY-SA, Wikimedia Commons —
 * see client/public/assets/audio/engines/LICENSES.md). For each recording, in Chrome:
 * decode → mono 32 kHz → firing-frequency track (YIN) → RPM → find steady, loud
 * stretches → cut up to 3 seamless crossfaded loops at different RPMs → 16-bit WAV.
 *
 *   node tools/make-engine-loops.mjs <dir with the .ogg sources> [url=http://localhost:5174/turbo-tumble/]
 *
 * Prints the `samples` arrays to paste into client/src/audio/EngineProfiles.ts.
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const srcDir = args.find((a) => !a.startsWith('http'));
const url = args.find((a) => a.startsWith('http')) ?? 'http://localhost:5174/turbo-tumble/';
const outDir = 'client/public/assets/audio/engines';
fs.mkdirSync(outDir, { recursive: true });

/** Recording → engine profile, with the engine's cylinder count and rev range. */
const SOURCES = [
  { file: 'jaguar-xkr.ogg', profile: 'svr-v8', cylinders: 8, idle: 700, redline: 7000 },
  { file: 'lexus-lfa-rev.ogg', profile: 'lfa-v10', cylinders: 10, idle: 850, redline: 9200 },
  { file: 'lexus-lfa-goodwood.ogg', profile: 'lfa-v10', cylinders: 10, idle: 850, redline: 9200 },
  { file: 'ferrari-458.ogg', profile: 'italia-v8', cylinders: 8, idle: 800, redline: 9200 },
  { file: 'porsche-gt3rs.ogg', profile: 'gt3-flat6', cylinders: 6, idle: 850, redline: 8800 },
  { file: 'aventador.ogg', profile: 'aventador-v12', cylinders: 12, idle: 800, redline: 8800 },
];

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
});
const page = await browser.newPage();
await page.goto(url, { waitUntil: 'domcontentloaded' });

for (const f of fs.readdirSync(outDir)) if (f.endsWith('.wav')) fs.unlinkSync(path.join(outDir, f));
const best = new Map(); // `${profile}:${band}` → loop (best across recordings)
for (const src of SOURCES) {
  const bytes = fs.readFileSync(path.join(srcDir, src.file)).toString('base64');
  const result = await page.evaluate(analyse, bytes, src);
  if (process.env.TRACE) console.log(result.trace);
  console.log(`${src.file}: ${result.duration.toFixed(1)} s, rpm track ${result.rpmMin}–${result.rpmMax}, bands found ${result.loops.map((l) => l.band).join(',')}`);
  for (const loop of result.loops) {
    const key = `${src.profile}:${loop.band}`;
    if (!best.has(key) || best.get(key).score < loop.score) best.set(key, { ...loop, profile: src.profile, file: src.file });
  }
}
// Drop near-duplicates (loops within 15% RPM of a better one).
const kept = [...best.values()].sort((a, b) => b.score - a.score).filter((l, i, all) => !all.slice(0, i).some((o) => o.profile === l.profile && Math.abs(o.rpm / l.rpm - 1) < 0.15));
const byProfile = new Map();
for (const loop of kept) {
  const name = `${loop.profile}-${loop.rpm}.wav`;
  fs.writeFileSync(path.join(outDir, name), Buffer.from(loop.wav, 'base64'));
  console.log(`   ${name}  ${loop.seconds.toFixed(2)} s  (±${loop.spread}% flattened, ${loop.file} @ ${loop.at.toFixed(2)} s)`);
  if (!byProfile.has(loop.profile)) byProfile.set(loop.profile, []);
  byProfile.get(loop.profile).push({ url: `assets/audio/engines/${name}`, rpm: loop.rpm });
}
console.log('\nsamples:');
for (const [profile, samples] of byProfile) console.log(`  ${profile}: ${JSON.stringify(samples.sort((a, b) => a.rpm - b.rpm))}`);
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 3000))]);
process.exit(0);

// ------------------------------------------------------------------ in the page

async function analyse(b64, src) {
  const SR = 32000;
  const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const decoded = await new AudioContext().decodeAudioData(raw.buffer);
  // Mono + resample.
  const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * SR), SR);
  const node = off.createBufferSource();
  node.buffer = decoded;
  node.connect(off.destination);
  node.start();
  const x = (await off.startRendering()).getChannelData(0).slice();
  // DC / rumble removal (one-pole high-pass ~30 Hz).
  let prevIn = 0;
  let prevOut = 0;
  const a = Math.exp((-2 * Math.PI * 30) / SR);
  for (let i = 0; i < x.length; i++) {
    const y = a * (prevOut + x[i] - prevIn);
    prevIn = x[i];
    prevOut = y;
    x[i] = y;
  }

  // YIN firing-frequency track.
  const fMin = (src.idle * src.cylinders) / 120 / 1.15;
  const fMax = (src.redline * src.cylinders) / 120 * 1.1;
  const W = 1536;
  const HOP = 400;
  const tauMin = Math.floor(SR / fMax);
  const tauMax = Math.ceil(SR / fMin);
  const frames = [];
  const d = new Float32Array(tauMax + 1);
  for (let start = 0; start + W + tauMax < x.length; start += HOP) {
    let energy = 0;
    for (let i = 0; i < W; i++) energy += x[start + i] * x[start + i];
    for (let tau = 1; tau <= tauMax; tau++) {
      let s = 0;
      for (let i = 0; i < W; i++) {
        const diff = x[start + i] - x[start + i + tau];
        s += diff * diff;
      }
      d[tau] = s;
    }
    // Cumulative-mean normalisation, then the first dip under the threshold.
    let run = 0;
    let best = -1;
    let bestVal = Infinity;
    const cmnd = new Float32Array(tauMax + 1);
    for (let tau = 1; tau <= tauMax; tau++) {
      run += d[tau];
      cmnd[tau] = (d[tau] * tau) / Math.max(1e-12, run);
    }
    for (let tau = tauMin; tau <= tauMax; tau++) {
      if (cmnd[tau] < 0.25) {
        while (tau + 1 <= tauMax && cmnd[tau + 1] < cmnd[tau]) tau++;
        best = tau;
        bestVal = cmnd[tau];
        break;
      }
      if (cmnd[tau] < bestVal) {
        bestVal = cmnd[tau];
        best = tau;
      }
    }
    // Parabolic interpolation.
    let t = best;
    if (best > tauMin && best < tauMax) {
      const s0 = cmnd[best - 1];
      const s1 = cmnd[best];
      const s2 = cmnd[best + 1];
      const den = s0 + s2 - 2 * s1;
      if (Math.abs(den) > 1e-9) t = best + (0.5 * (s0 - s2)) / den;
    }
    const f0 = SR / t;
    frames.push({ start, rms: Math.sqrt(energy / W), clarity: 1 - bestVal, rpm: (f0 * 120) / src.cylinders });
  }

  // Clean the track: median-smooth, drop quiet/unclear frames and octave glitches.
  const maxRms = Math.max(...frames.map((f) => f.rms));
  const med = (arr) => arr.slice().sort((p, q) => p - q)[arr.length >> 1];
  const smooth = frames.map((f, k) => med(frames.slice(Math.max(0, k - 3), k + 4).map((g) => g.rpm)));
  const valid = frames.map((f, k) => f.rms > maxRms * 0.08 && f.clarity > 0.35 && Math.abs(f.rpm / smooth[k] - 1) < 0.15);

  // Best ~0.6 s window per RPM band (low / mid / high) with at most ±20% RPM change.
  const WIN_LONG = Math.round((0.6 * SR) / HOP);
  const span = src.redline - src.idle;
  const bands = [src.idle, src.idle + span * 0.3, src.idle + span * 0.6, src.redline * 1.05];
  const chosen = [];
  // High revs rarely hold long in a launch: if no 0.6 s stretch exists there, accept a shorter, noisier one.
  const attempts = [
    [0, WIN_LONG, 0.75],
    [1, WIN_LONG, 0.75],
    [2, WIN_LONG, 0.75],
    [2, Math.round((0.25 * SR) / HOP), 0.6],
    [1, Math.round((0.25 * SR) / HOP), 0.6],
  ];
  for (const [b, WIN, minOk] of attempts) {
    if (chosen.some((c) => c.band === b)) continue;
    let best = null;
    for (let k = 0; k + WIN < frames.length; k += 2) {
      const win = smooth.slice(k, k + WIN);
      const ok = valid.slice(k, k + WIN).filter(Boolean).length / WIN;
      if (ok < minOk) continue;
      const lo = Math.min(...win);
      const hi = Math.max(...win);
      if (hi / lo > 1.5) continue;
      const m = med(win);
      if (m < bands[b] || m >= bands[b + 1]) continue;
      const loud = frames.slice(k, k + WIN).reduce((s2, f) => s2 + f.rms, 0) / WIN;
      const score = loud * ok * (1.5 - (hi / lo - 1));
      if (!best || score > best.score) best = { k, rpm: m, score, spread: hi / lo - 1 };
    }
    if (best) chosen.push({ ...best, band: b, win: WIN });
  }

  // Pitch-flatten each window to its median RPM: read the input at a variable rate
  // (target / instantaneous firing frequency) so the loop holds one steady note.
  const flattened = chosen.map((c) => {
    const target = c.rpm;
    const rpmAt = (pos) => {
      const f = Math.min(frames.length - 1, Math.max(0, (pos - W / 2) / HOP));
      const k0 = Math.floor(f);
      const k1 = Math.min(frames.length - 1, k0 + 1);
      return smooth[k0] + (smooth[k1] - smooth[k0]) * (f - k0);
    };
    const begin = frames[c.k].start + W / 2;
    const stop = frames[c.k + c.win].start + W / 2;
    const out = [];
    for (let pos = begin; pos < stop - 1; ) {
      const i0 = Math.floor(pos);
      const t = pos - i0;
      out.push(x[i0] * (1 - t) + x[i0 + 1] * t);
      pos += target / rpmAt(pos);
    }
    return { ...c, seg: Float32Array.from(out), from: begin };
  });

  // Seamless loop: equal-power crossfade of the tail into the head.
  const loops = flattened.map((s) => {
    const seg = s.seg;
    const X = Math.min(Math.floor(seg.length * 0.3), Math.floor(SR * 0.14));
    const n = seg.length - X;
    const out = new Float32Array(n);
    for (let k = 0; k < n; k++) out[k] = seg[k];
    for (let k = 0; k < X; k++) {
      const t = k / X;
      out[k] = seg[k] * Math.sin((t * Math.PI) / 2) + seg[n + k] * Math.cos((t * Math.PI) / 2);
    }
    // Loudness-normalise so every loop sits at the same level.
    let sum = 0;
    for (const v of out) sum += v * v;
    const gain = 0.16 / Math.max(1e-6, Math.sqrt(sum / n));
    let peak = 0;
    for (const v of out) peak = Math.max(peak, Math.abs(v * gain));
    const g = gain * Math.min(1, 0.95 / peak);
    // 16-bit mono WAV.
    const buf = new ArrayBuffer(44 + n * 2);
    const v = new DataView(buf);
    const str = (o, txt) => [...txt].forEach((c, k) => v.setUint8(o + k, c.charCodeAt(0)));
    str(0, 'RIFF');
    v.setUint32(4, 36 + n * 2, true);
    str(8, 'WAVEfmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, SR, true);
    v.setUint32(28, SR * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    str(36, 'data');
    v.setUint32(40, n * 2, true);
    for (let k = 0; k < n; k++) v.setInt16(44 + k * 2, Math.max(-1, Math.min(1, out[k] * g)) * 32767, true);
    const u8 = new Uint8Array(buf);
    let bin = '';
    for (let k = 0; k < u8.length; k += 0x8000) bin += String.fromCharCode(...u8.subarray(k, k + 0x8000));
    return { rpm: Math.round(s.rpm / 50) * 50, band: s.band, score: s.score, seconds: n / SR, spread: (s.spread * 100).toFixed(0), at: s.from / SR, wav: btoa(bin) };
  });
  const rpms = smooth.filter((r, k) => valid[k]);
  const trace = frames.filter((f, k) => k % 6 === 0).map((f, k) => `${(f.start / SR).toFixed(1)}:${Math.round(smooth[k * 6] / 100)}${valid[k * 6] ? '' : '?'}${Math.round((f.rms / maxRms) * 9)}`).join(' ');
  return { trace, duration: x.length / SR, rpmMin: Math.round(Math.min(...rpms)), rpmMax: Math.round(Math.max(...rpms)), loops };
}
