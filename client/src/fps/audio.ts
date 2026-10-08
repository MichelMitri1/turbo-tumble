import type { WeaponClass } from './sim/weapons';

export type Surface = 'hard' | 'soft' | 'metal' | 'wood';

/** Enemy gunfire further than this is inaudible under the action (and costs nodes). */
const SHOT_CULL = 90;
/** Most gunshot voices playing at once (a full lobby on full-auto). */
const MAX_SHOT_VOICES = 40;

/**
 * Real recordings per weapon (CC0, The Free Firearm Sound Library; tools/fps-sfx.mjs):
 * `src` = recording, `rate` = playback rate (heavier calibre → lower), `vol` = level.
 * Each recording has a `near` take (your gun) and a `far` take (other players at range).
 */
export const GUN_SFX: Record<string, { src: string; rate: number; vol: number }> = {
  m13: { src: 'ar15', rate: 1, vol: 1 },
  kr47: { src: 'ak47', rate: 1, vol: 1 },
  grau: { src: 'ar15', rate: 1.08, vol: 0.95 },
  raptor: { src: 'sks', rate: 1.06, vol: 0.95 },
  viper: { src: 'm45', rate: 1, vol: 0.9 },
  striker: { src: 'ppsh', rate: 1, vol: 0.9 },
  fennec: { src: 'm45', rate: 1.14, vol: 0.85 },
  carbine: { src: 'ppq', rate: 0.86, vol: 0.95 },
  holger: { src: 'ak47', rate: 0.86, vol: 1.05 },
  r725: { src: 'nova', rate: 1, vol: 1.1 },
  origin: { src: 'daly', rate: 1, vol: 1.05 },
  hdr: { src: 'tikka', rate: 0.82, vol: 1.15 },
  kar: { src: 'mosin', rate: 1, vol: 1.1 },
  ebr: { src: 'm1917', rate: 1, vol: 1.05 },
  x9: { src: 'ppq', rate: 1, vol: 0.85 },
  deagle: { src: 'm1911', rate: 0.88, vol: 1 },
  magnum: { src: 'sw642', rate: 0.9, vol: 1 },
  sawed: { src: 'model12', rate: 0.95, vol: 1.1 },
  // Killstreak guns.
  heli: { src: 'ak47', rate: 1.25, vol: 0.9 },
  sentry: { src: 'savage', rate: 1.35, vol: 0.85 },
  gunner: { src: 'm45', rate: 0.72, vol: 1.1 },
};

/** Procedural war sounds: gunshots per weapon class (with distance), reloads, hits, explosions, announcer. */
export class FpsAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private verb: ConvolverNode | null = null;
  /** Reverb send shared by every sound (one gain per sound instead of one per burst). */
  private verbIn: GainNode | null = null;
  private heli: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private samples = new Map<string, AudioBuffer>();
  private shotVoices = 0;
  volume = 0.7;
  announcer = true;
  /** Slowest speechSynthesis.speak() call so far (ms), for the perf probe. */
  sayMs = 0;

  constructor() {
    // The voice list loads lazily; ask early so the first callout doesn't wait for it.
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.getVoices();
  }

  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const c = (this.ctx = new AC());
    this.master = c.createGain();
    this.master.gain.value = this.volume;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14;
    this.master.connect(comp).connect(c.destination);
    const len = c.sampleRate * 2;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // Short room reverb for gun tails.
    const ir = c.createBuffer(2, c.sampleRate * 1.6, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const x = ir.getChannelData(ch);
      for (let i = 0; i < x.length; i++) x[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / x.length, 3.2);
    }
    this.verb = c.createConvolver();
    this.verb.buffer = ir;
    this.verbIn = c.createGain();
    this.verbIn.gain.value = 0.25;
    this.verbIn.connect(this.verb).connect(this.master);
    void this.loadGuns();
    // The first utterance initialises the speech engine (can stall a frame): do it now, silently, at menu time.
    if (typeof speechSynthesis !== 'undefined') {
      try {
        const u = new SpeechSynthesisUtterance(' ');
        u.volume = 0;
        speechSynthesis.speak(u);
      } catch {
        /* no voice */
      }
    }
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  /** One output per sound: a panner into the master (+ an optional reverb send). Every part of the sound connects here. */
  private out(pan: number, verb = 0): AudioNode | null {
    const c = this.ctx;
    if (!c || !this.master) return null;
    if (!pan && !verb) return this.master;
    const p = c.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(this.master);
    if (verb && this.verbIn) {
      const vg = c.createGain();
      vg.gain.value = verb;
      p.connect(vg).connect(this.verbIn);
    }
    return p;
  }

  private burst(dur: number, freq: number, q: number, vol: number, type: BiquadFilterType, delay = 0, sweep = 0, dest: AudioNode | null = this.master): void {
    const c = this.ctx;
    if (!c || !dest || !this.noise) return;
    const t = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(30, freq * sweep), t + dur);
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(dest);
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur + 0.05);
  }

  private tone(f: number, dur: number, type: OscillatorType, vol: number, slide = 1, delay = 0, dest: AudioNode | null = this.master): void {
    const c = this.ctx;
    if (!c || !dest) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (slide !== 1) o.frequency.exponentialRampToValueAtTime(Math.max(20, f * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** Fetch + decode every gun recording (once, after the audio context exists). */
  private async loadGuns(): Promise<void> {
    const c = this.ctx;
    if (!c) return;
    const srcs = new Set(Object.values(GUN_SFX).map((g) => g.src));
    await Promise.all(
      [...srcs].flatMap((src) =>
        ['near', 'far'].map(async (tag) => {
          try {
            const r = await fetch(`/assets/fps/sfx/${src}-${tag}.wav`);
            if (r.ok) this.samples.set(`${src}-${tag}`, await c.decodeAudioData(await r.arrayBuffer()));
          } catch {
            /* falls back to the synthesised shot */
          }
        }),
      ),
    );
  }

  /** A gunshot from `weapon`. `dist` in metres (0 = you), `pan` −1..1. */
  shot(weapon: string, cls: WeaponClass, suppressed: boolean, dist = 0, pan = 0): void {
    const c = this.ctx;
    if (dist > SHOT_CULL || !c) return;
    const def = GUN_SFX[weapon];
    const own = dist < 2;
    const buf = def && (this.samples.get(`${def.src}-${own || dist < 14 ? 'near' : 'far'}`) ?? this.samples.get(`${def.src}-near`));
    if (!def || !buf) return this.synthShot(cls, suppressed, dist, pan);
    // Busy firefight: drop distant voices first.
    if (this.shotVoices >= MAX_SHOT_VOICES && !own) return;
    const t = c.currentTime;
    const s = c.createBufferSource();
    s.buffer = buf;
    s.playbackRate.value = def.rate * (0.97 + Math.random() * 0.06);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    // Distance eats the crack; a suppressor eats most of everything.
    f.frequency.value = suppressed ? (own ? 2600 : 1400) : own ? 20000 : Math.max(1100, 14000 / (1 + dist * 0.045));
    const g = c.createGain();
    const near = own ? 1 : Math.max(0.05, 1 / (1 + dist * 0.07));
    g.gain.value = def.vol * near * (suppressed ? 0.3 : own ? 0.85 : 0.9);
    const o = this.out(pan, suppressed ? 0.1 : own ? 0.3 : 0.55);
    if (!o) return;
    s.connect(f).connect(g).connect(o);
    s.start(t);
    this.shotVoices++;
    s.onended = () => this.shotVoices--;
    // Your own gun: a little extra low-end punch (the recordings are mic'd from the side).
    if (own && !suppressed) this.tone(cls === 'pistol' ? 120 : 85, cls === 'sniper' || cls === 'shotgun' ? 0.22 : 0.12, 'sine', cls === 'sniper' || cls === 'shotgun' ? 0.6 : 0.35, 0.5, 0, o);
    if (suppressed) this.burst(0.05, 2400, 0.8, 0.18 * near, 'bandpass', 0, 0.6, o);
  }

  /** Fallback (before the recordings have loaded): crack, body, boom, tail. */
  private synthShot(cls: WeaponClass, suppressed: boolean, dist: number, pan: number): void {
    const near = Math.max(0.04, 1 / (1 + dist * 0.06));
    if (suppressed) {
      if (dist > 30) return;
      const o = this.out(pan);
      this.burst(0.08, 1400, 0.8, 0.45 * near, 'bandpass', 0, 0.5, o);
      this.tone(160, 0.06, 'sine', 0.25 * near, 0.6, 0, o);
      return;
    }
    const heavy = cls === 'sniper' || cls === 'shotgun' ? 1.6 : cls === 'pistol' ? 0.75 : cls === 'lmg' ? 1.15 : cls === 'smg' ? 0.85 : 1;
    const far = dist > 25;
    const o = this.out(pan, 0.6);
    if (!far) this.burst(0.05, 3500, 0.7, 0.55 * near, 'highpass', 0, 0.4, o);
    this.burst(0.16 * heavy, far ? 700 : 1300, 0.6, 0.8 * near, 'lowpass', 0, 0.35, o);
    if (!far || heavy > 1.1) this.tone(far ? 70 : 95 * (2 - heavy * 0.5), 0.14 * heavy, 'sine', 0.75 * near * heavy, 0.45, 0, o);
    if (cls === 'sniper') this.burst(0.9, 500, 0.5, 0.35 * near, 'lowpass', 0.05, 0.3, o);
  }

  /** Reload foley per weapon class: mag out, mag in, then bolt / slide / pump. `t` = reload length. */
  reload(cls: WeaponClass, t: number): void {
    if (cls === 'shotgun') {
      const shells = Math.max(2, Math.min(6, Math.round(t / 0.5)));
      for (let i = 0; i < shells; i++) this.click(0.3 + (i * (t - 0.7)) / shells, 1500, 0.2, 'shell');
      this.click(t - 0.2, 500, 0.35);
      this.click(t - 0.08, 800, 0.35);
      return;
    }
    if (cls === 'lmg') {
      // Box mag: lid, belt rattle, lid slam.
      this.click(0.3, 1100, 0.25);
      for (let i = 0; i < 6; i++) this.click(t * 0.35 + i * 0.05, 2600 + i * 120, 0.08);
      this.click(t * 0.7, 700, 0.35);
      this.click(t * 0.9, 600, 0.35);
      return;
    }
    this.click(0.15, cls === 'pistol' ? 1300 : 900);
    this.click(t * 0.55, cls === 'pistol' ? 1600 : 1200, 0.28);
    if (cls === 'sniper') {
      this.click(t * 0.78, 600, 0.3);
      this.click(t * 0.88, 900, 0.3);
    } else if (cls === 'pistol') this.click(t * 0.85, 2000, 0.3);
    else this.click(t * 0.85, cls === 'smg' ? 900 : 700, 0.35);
  }
  bolt(): void {
    this.click(0.12, 600, 0.3);
    this.click(0.3, 900, 0.3);
  }
  private click(delay: number, f: number, vol = 0.25, kind: 'click' | 'shell' = 'click'): void {
    this.burst(kind === 'shell' ? 0.06 : 0.04, f, 2, vol, 'bandpass', delay);
    this.tone(f * (kind === 'shell' ? 1.2 : 1.8), 0.03, kind === 'shell' ? 'triangle' : 'square', vol * 0.25, 1, delay);
  }
  empty(): void {
    this.click(0, 2400, 0.2);
  }
  /** Hit: a short dry tick. Kill: a bright two-note ding on top. */
  hitmarker(kill: boolean, head: boolean): void {
    this.burst(0.025, head ? 5200 : 4000, 3, 0.3, 'bandpass');
    this.tone(head ? 2600 : 1900, 0.035, 'square', 0.08);
    if (kill) {
      this.tone(1568, 0.22, 'sine', 0.2, 1, 0.02);
      this.tone(2349, 0.32, 'sine', 0.14, 1, 0.07);
      this.tone(3136, 0.18, 'triangle', 0.05, 1, 0.07);
    }
  }
  hurt(): void {
    this.burst(0.12, 300, 1, 0.4, 'lowpass');
  }
  /** Footstep on a surface: heel + toe (+ scuff), filtered by what's underfoot. */
  footstep(dist: number, pan = 0, surface: Surface = 'hard'): void {
    if (dist > 30) return;
    const v = Math.max(0.02, 0.22 / (1 + dist * 0.25));
    const o = this.out(pan);
    const r = 0.9 + Math.random() * 0.2;
    if (surface === 'soft') {
      this.burst(0.09, 500 * r, 0.8, v * 0.9, 'bandpass', 0, 0.6, o);
      this.burst(0.07, 1800 * r, 0.6, v * 0.35, 'highpass', 0.05, 0, o);
    } else if (surface === 'metal') {
      this.burst(0.05, 260 * r, 1.4, v, 'bandpass', 0, 0, o);
      this.tone(420 * r, 0.12, 'triangle', v * 0.25, 0.9, 0.01, o);
      this.burst(0.04, 2400 * r, 2, v * 0.4, 'bandpass', 0.05, 0, o);
    } else if (surface === 'wood') {
      this.burst(0.06, 180 * r, 1.2, v * 1.1, 'bandpass', 0, 0, o);
      this.burst(0.05, 700 * r, 1.6, v * 0.5, 'bandpass', 0.045, 0, o);
    } else {
      this.burst(0.05, 240 * r, 1.4, v, 'bandpass', 0, 0, o);
      this.burst(0.04, 1200 * r, 1.2, v * 0.45, 'bandpass', 0.05, 0, o);
      if (Math.random() < 0.5) this.burst(0.06, 3000 * r, 0.8, v * 0.15, 'highpass', 0.07, 0, o);
    }
  }
  /** A bullet snapping past your head. */
  whizz(pan = 0): void {
    const o = this.out(pan);
    this.burst(0.14, 3200, 4, 0.35, 'bandpass', 0, 0.35, o);
    this.burst(0.06, 6000, 1, 0.12, 'highpass', 0, 0, o);
  }
  /** One double-thump heartbeat (low health). */
  heartbeat(vol: number): void {
    this.tone(55, 0.12, 'sine', 0.5 * vol, 0.8);
    this.tone(48, 0.14, 'sine', 0.38 * vol, 0.8, 0.22);
  }
  land(): void {
    this.burst(0.12, 180, 1, 0.35, 'lowpass');
  }
  knife(hit: boolean): void {
    this.burst(0.16, 2500, 0.8, 0.3, 'bandpass', 0, 0.4);
    if (hit) this.burst(0.12, 400, 1, 0.5, 'lowpass', 0.05);
  }
  explosion(dist: number, pan = 0): void {
    const v = Math.max(0.08, 1.2 / (1 + dist * 0.05));
    const o = this.out(pan, 1);
    this.burst(1.8, 900, 0.4, v, 'lowpass', 0, 0.08, o);
    this.tone(45, 0.9, 'sine', v, 0.5, 0, o);
    if (dist < 60) this.burst(0.25, 3000, 0.6, v * 0.4, 'highpass', 0, 0.3, o);
  }
  /** Jet fly-over: a rising roar into a falling howl, panned with the jet. */
  jet(dist = 0, pan = 0): void {
    const v = Math.max(0.15, 0.9 / (1 + dist * 0.015));
    const o = this.out(pan, 0.4);
    this.burst(1.2, 300, 0.5, v * 0.6, 'bandpass', 0, 5, o);
    this.burst(2.4, 1600, 0.4, v, 'bandpass', 0.9, 0.2, o);
    this.burst(2.2, 120, 0.6, v * 0.8, 'lowpass', 0.9, 0.5, o);
  }
  heliLoop(on: boolean, dist = 30): void {
    const c = this.ctx;
    if (!c || !this.master || !this.noise) return;
    if (on && !this.heli) {
      const src = c.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const filter = c.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 220;
      const gain = c.createGain();
      gain.gain.value = 0;
      // Rotor chop via an LFO on the gain.
      const lfo = c.createOscillator();
      lfo.frequency.value = 11;
      const lfoG = c.createGain();
      lfoG.gain.value = 0.15;
      lfo.connect(lfoG).connect(gain.gain);
      lfo.start();
      src.connect(filter).connect(gain).connect(this.master);
      src.start();
      src.onended = () => lfo.stop();
      this.heli = { src, gain, filter };
    } else if (!on && this.heli) {
      this.heli.gain.gain.setTargetAtTime(0, c.currentTime, 0.3);
      this.heli.src.stop(c.currentTime + 1);
      this.heli = null;
    }
    if (this.heli) this.heli.gain.gain.setTargetAtTime(Math.max(0.05, 0.6 / (1 + dist * 0.04)), c.currentTime, 0.2);
  }
  /** Flashbang: a sharp crack; `ring` 0..1 adds the tinnitus whine (when it got you). */
  flashbang(dist: number, pan = 0, ring = 0): void {
    const v = Math.max(0.1, 1.3 / (1 + dist * 0.06));
    const o = this.out(pan, 0.8);
    this.burst(0.35, 4000, 0.5, v, 'highpass', 0, 0.3, o);
    this.burst(0.5, 900, 0.5, v * 0.8, 'lowpass', 0, 0.2, o);
    if (ring > 0) this.tone(3600, 1 + ring * 3.5, 'sine', 0.12 * ring, 1);
  }
  /** Stun grenade: a heavy thump and a muffled wobble. */
  stunPop(dist: number, pan = 0, hit = 0): void {
    const v = Math.max(0.1, 1 / (1 + dist * 0.06));
    const o = this.out(pan, 0.6);
    this.tone(70, 0.5, 'sine', v, 0.4, 0, o);
    this.burst(0.25, 600, 0.6, v * 0.7, 'lowpass', 0, 0.3, o);
    if (hit > 0) this.tone(220, 1.5 + hit * 2, 'triangle', 0.08 * hit, 0.5);
  }
  /** Smoke grenade: a pop then a long hiss. */
  smokePop(dist: number, pan = 0): void {
    const v = Math.max(0.05, 0.6 / (1 + dist * 0.07));
    const o = this.out(pan, 0.3);
    this.burst(0.06, 1200, 1, v, 'bandpass', 0, 0, o);
    this.burst(2.2, 5000, 0.4, v * 0.5, 'highpass', 0.05, 0.6, o);
  }
  /** Molotov: glass shatter + a whoosh of fire. */
  molotov(dist: number, pan = 0): void {
    const v = Math.max(0.05, 0.9 / (1 + dist * 0.07));
    const o = this.out(pan, 0.5);
    for (let i = 0; i < 5; i++) this.burst(0.05, 5000 + Math.random() * 3000, 3, v * 0.4, 'bandpass', i * 0.025, 0, o);
    this.burst(1.2, 700, 0.5, v * 0.8, 'lowpass', 0.05, 2.5, o);
  }
  /** Attack dog: a gruff bark (or a snarl on a bite). */
  bark(dist: number, pan = 0, bite = false): void {
    if (dist > 45) return;
    const v = Math.max(0.05, 0.7 / (1 + dist * 0.08));
    const o = this.out(pan, 0.3);
    this.tone(bite ? 180 : 420, bite ? 0.35 : 0.13, 'sawtooth', v * 0.5, bite ? 0.7 : 0.55, 0, o);
    this.burst(bite ? 0.3 : 0.12, bite ? 700 : 1100, 2, v * 0.6, 'bandpass', 0, 0.6, o);
  }
  grenadePin(): void {
    this.click(0, 3000, 0.2);
  }
  capture(): void {
    [523, 659, 784].forEach((f, i) => this.tone(f, 0.18, 'triangle', 0.14, 1, i * 0.1));
  }
  /** Dog tag: bright chime when confirmed, lower when denied. */
  tag(confirmed: boolean): void {
    const base = confirmed ? 988 : 659;
    this.tone(base, 0.1, 'triangle', 0.14);
    this.tone(base * 1.5, 0.16, 'triangle', 0.11, 1, 0.07);
    this.burst(0.05, 5000, 2, 0.12, 'bandpass', 0.02);
  }
  medal(): void {
    this.tone(1046, 0.08, 'triangle', 0.1);
    this.tone(1568, 0.12, 'triangle', 0.08, 1, 0.06);
  }
  ui(): void {
    this.tone(800, 0.04, 'triangle', 0.08);
  }

  /** CoD-style voice callouts via the browser's speech synthesis. */
  say(text: string): void {
    if (!this.announcer || typeof speechSynthesis === 'undefined') return;
    const t0 = performance.now();
    try {
      const u = new SpeechSynthesisUtterance(text);
      const voices = speechSynthesis.getVoices();
      u.voice = voices.find((v) => /en[-_](GB|US)/.test(v.lang) && /male|daniel|alex|fred|google uk english male/i.test(v.name)) ?? voices.find((v) => v.lang.startsWith('en')) ?? null;
      u.rate = 1.05;
      u.pitch = 0.75;
      u.volume = Math.min(1, this.volume + 0.2);
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch {
      /* no voice */
    }
    this.sayMs = Math.max(this.sayMs, performance.now() - t0);
  }
}
