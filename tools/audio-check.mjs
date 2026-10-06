/**
 * Renders every sound effect and song offline in Chrome (through the Vite dev
 * server, so it's the real game code) and checks levels:
 *   - not silent (RMS), no clipping (peak), sensible length
 * Writes WAVs to <outDir> so they can be auditioned.
 *
 *   node tools/audio-check.mjs [url=http://localhost:5174/turbo-tumble/] [outDir=smoke-out/audio] [--songs=8]  (seconds of each song)
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith('http')) ?? 'http://localhost:5174/turbo-tumble/';
const outDir = args.find((a) => !a.startsWith('http') && !a.startsWith('--')) ?? 'smoke-out/audio';
const enginesOnly = args.includes('--engines-only');
const songSeconds = Number(args.find((a) => a.startsWith('--songs='))?.split('=')[1] ?? 0);
fs.mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${url}?mode=race&lowgfx`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__game !== undefined, { timeout: 90000 });

const results = await page.evaluate(async ({ songSeconds, enginesOnly }) => {
  const { EngineVoice } = await import('/src/audio/EngineVoice.ts');
  const { ENGINE_PROFILES } = await import('/src/audio/EngineProfiles.ts');
  const { SFX } = await import('/src/audio/sfx.ts');
  const { createNoiseBuffer } = await import('/src/audio/AudioEngine.ts');
  const { SONGS } = await import('/src/audio/music/songs.ts');
  const { scheduleSongPass } = await import('/src/audio/music/renderOffline.ts');
  const { songSeconds: passSeconds } = await import('/src/audio/music/Song.ts');
  const SR = 44100;

  const wav = (buf) => {
    const ch = buf.getChannelData(0);
    const bytes = new ArrayBuffer(44 + ch.length * 2);
    const v = new DataView(bytes);
    const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    str(0, 'RIFF');
    v.setUint32(4, 36 + ch.length * 2, true);
    str(8, 'WAVEfmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, SR, true);
    v.setUint32(28, SR * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    str(36, 'data');
    v.setUint32(40, ch.length * 2, true);
    for (let i = 0; i < ch.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, ch[i])) * 32767, true);
    let bin = '';
    const u8 = new Uint8Array(bytes);
    for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    return btoa(bin);
  };
  const measure = (buf) => {
    const ch = buf.getChannelData(0);
    let peak = 0;
    let sum = 0;
    let last = 0;
    for (let i = 0; i < ch.length; i++) {
      const a = Math.abs(ch[i]);
      if (a > peak) peak = a;
      sum += ch[i] * ch[i];
      if (a > 0.001) last = i;
    }
    // Loudness over the audible part only (short blips shouldn't read as "quiet").
    let audibleSum = 0;
    for (let i = 0; i <= last; i++) audibleSum += ch[i] * ch[i];
    return { peak: +peak.toFixed(3), rms: +Math.sqrt(audibleSum / Math.max(1, last + 1)).toFixed(4), audible: +(last / SR).toFixed(2) };
  };

  const out = [];
  for (const [name, gen] of Object.entries(enginesOnly ? {} : SFX)) {
    const ctx = new OfflineAudioContext(1, SR * 4, SR);
    gen({ ctx, out: ctx.destination, t: 0.01, noise: createNoiseBuffer(ctx), pitch: 1 }, { intensity: 1, stage: 3 });
    const buf = await ctx.startRendering();
    out.push({ kind: 'sfx', name, ...measure(buf), wav: wav(buf) });
  }
  for (const spec of (enginesOnly ? [] : SONGS)) {
    const seconds = spec.loopFrom === undefined ? passSeconds(spec) + 2 : Math.min(passSeconds(spec), songSeconds || passSeconds(spec));
    const ctx = new OfflineAudioContext(1, Math.ceil(SR * seconds), SR);
    scheduleSongPass({ ctx, out: ctx.destination, t: 0.01, noise: createNoiseBuffer(ctx), pitch: 1 }, spec);
    const buf = await ctx.startRendering();
    out.push({ kind: 'song', name: spec.id, ...measure(buf), wav: wav(buf) });
  }
  for (const profile of [...ENGINE_PROFILES, null]) {
    const seconds = 7;
    const ctx = new OfflineAudioContext(1, SR * seconds, SR);
    const bus = ctx.createGain(); bus.gain.value = 0.38;
    bus.connect(ctx.destination);
    const audio = { ctx, noise: createNoiseBuffer(ctx), bus: () => bus };
    const profiles = profile ? [profile] : Array.from({ length: 12 }, (_, i) => ENGINE_PROFILES[i % ENGINE_PROFILES.length]);
    const voices = profiles.map((p, i) => new EngineVoice(audio, i === 0, p, 1 + i * 0.002));
    await Promise.all(voices.map((v) => v.ready));
    for (let tick = 0; tick < seconds * 60; tick++) {
      const t = tick / 60;
      voices.forEach((voice, i) => {
        const throttle = t < 0.7 || (t > 2.1 && t < 3) || t > 6 ? 0 : 1;
        voice.update({ speed01: t > 3 ? Math.min(1, (t - 3) / 3) : 0, throttle, load: throttle, freeRev: t < 3, grounded: true, drifting: false, offroad: false, boost: 0, stunned: false }, { gain: i === 0 ? 1 : 0.3, pan: 0 }, 1 / 60, t);
      });
    }
    const buf = await ctx.startRendering();
    out.push({ kind: 'engine', name: profile?.id ?? '12-kart-pack', ...measure(buf), wav: wav(buf) });
  }
  return out;
}, { songSeconds, enginesOnly });

let bad = 0;
console.log('kind  name             peak   rms     audible');
for (const r of results) {
  fs.writeFileSync(`${outDir}/${r.kind}-${r.name}.wav`, Buffer.from(r.wav, 'base64'));
  const problems = [];
  if (r.rms < 0.01) problems.push('too quiet');
  if (r.peak > 0.95) problems.push('CLIPS');
  if (r.kind === 'sfx' && r.audible > 3.5) problems.push('too long');
  if (problems.length) bad++;
  console.log(`${r.kind.padEnd(5)} ${r.name.padEnd(16)} ${String(r.peak).padEnd(6)} ${String(r.rms).padEnd(7)} ${r.audible}s ${problems.length ? '✗ ' + problems.join(', ') : ''}`);
}
console.log(`${results.length} rendered → ${outDir}/  ·  ${bad ? `${bad} with problems` : 'all levels OK'}`);
if (errors.length) console.log('page errors:', errors);
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 3000))]);
process.exit(bad || errors.length ? 1 : 0);
