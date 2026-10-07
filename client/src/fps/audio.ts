import type { WeaponClass } from './sim/weapons';

/** Procedural war sounds: gunshots per weapon class (with distance), reloads, hits, explosions, announcer. */
export class FpsAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private verb: ConvolverNode | null = null;
  private heli: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  volume = 0.7;
  announcer = true;

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
    const vg = c.createGain();
    vg.gain.value = 0.25;
    this.verb.connect(vg).connect(this.master);
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  private burst(dur: number, freq: number, q: number, vol: number, type: BiquadFilterType, delay = 0, sweep = 0, verb = 0, pan = 0): void {
    const c = this.ctx;
    if (!c || !this.master || !this.noise) return;
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
    const p = c.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    s.connect(f).connect(g).connect(p).connect(this.master);
    if (verb && this.verb) {
      const vg = c.createGain();
      vg.gain.value = verb;
      g.connect(vg).connect(this.verb);
    }
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur + 0.05);
  }

  private tone(f: number, dur: number, type: OscillatorType, vol: number, slide = 1, delay = 0, pan = 0): void {
    const c = this.ctx;
    if (!c || !this.master) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (slide !== 1) o.frequency.exponentialRampToValueAtTime(Math.max(20, f * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = c.createStereoPanner();
    p.pan.value = pan;
    o.connect(g).connect(p).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** A gunshot. `dist` in metres (0 = you), `pan` −1..1. */
  shot(cls: WeaponClass, suppressed: boolean, dist = 0, pan = 0): void {
    const near = Math.max(0.04, 1 / (1 + dist * 0.06));
    if (suppressed) {
      this.burst(0.08, 1400, 0.8, 0.45 * near, 'bandpass', 0, 0.5, 0, pan);
      this.tone(160, 0.06, 'sine', 0.25 * near, 0.6, 0, pan);
      return;
    }
    const heavy = cls === 'sniper' || cls === 'shotgun' ? 1.6 : cls === 'pistol' ? 0.75 : cls === 'lmg' ? 1.15 : cls === 'smg' ? 0.85 : 1;
    // Crack (high), body (mid), boom (low), tail (reverb).
    const far = dist > 25;
    if (!far) this.burst(0.05, 3500, 0.7, 0.55 * near, 'highpass', 0, 0.4, 0, pan);
    this.burst(0.16 * heavy, far ? 700 : 1300, 0.6, 0.8 * near, 'lowpass', 0, 0.35, 0.6, pan);
    this.tone(far ? 70 : 95 * (2 - heavy * 0.5), 0.14 * heavy, 'sine', 0.75 * near * heavy, 0.45, 0, pan);
    if (cls === 'sniper') this.burst(0.9, 500, 0.5, 0.35 * near, 'lowpass', 0.05, 0.3, 0.9, pan);
  }

  reload(cls: WeaponClass, t: number): void {
    // Mag out, mag in, slide/bolt.
    this.click(0.15, 900);
    this.click(t * 0.55, 1200);
    if (cls !== 'shotgun') this.click(t * 0.85, 700, 0.35);
    else for (let i = 0; i < 4; i++) this.click(0.4 + i * (t / 5), 1500, 0.2);
  }
  bolt(): void {
    this.click(0.12, 600, 0.3);
    this.click(0.3, 900, 0.3);
  }
  private click(delay: number, f: number, vol = 0.25): void {
    this.burst(0.04, f, 2, vol, 'bandpass', delay);
    this.tone(f * 1.8, 0.03, 'square', vol * 0.25, 1, delay);
  }
  empty(): void {
    this.click(0, 2400, 0.2);
  }
  hitmarker(kill: boolean, head: boolean): void {
    this.tone(head ? 2600 : 1800, 0.05, 'square', 0.12);
    this.burst(0.03, 4000, 3, 0.25, 'bandpass');
    if (kill) {
      this.tone(1300, 0.09, 'sine', 0.18, 1, 0.04);
      this.tone(1750, 0.14, 'sine', 0.15, 1, 0.1);
    }
  }
  hurt(): void {
    this.burst(0.12, 300, 1, 0.4, 'lowpass');
  }
  footstep(dist: number, pan = 0): void {
    const v = Math.max(0.02, 0.22 / (1 + dist * 0.25));
    this.burst(0.06, 220 + Math.random() * 80, 1.4, v, 'bandpass', 0, 0, 0, pan);
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
    this.burst(1.8, 900, 0.4, v, 'lowpass', 0, 0.08, 1, pan);
    this.tone(45, 0.9, 'sine', v, 0.5, 0, pan);
    this.burst(0.25, 3000, 0.6, v * 0.4, 'highpass', 0, 0.3, 0, pan);
  }
  jet(): void {
    this.burst(3.2, 400, 0.5, 0.7, 'bandpass', 0, 6, 0.4);
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
      this.heli = { src, gain, filter };
    } else if (!on && this.heli) {
      this.heli.gain.gain.setTargetAtTime(0, c.currentTime, 0.3);
      this.heli.src.stop(c.currentTime + 1);
      this.heli = null;
    }
    if (this.heli) this.heli.gain.gain.setTargetAtTime(Math.max(0.05, 0.6 / (1 + dist * 0.04)), c.currentTime, 0.2);
  }
  grenadePin(): void {
    this.click(0, 3000, 0.2);
  }
  capture(): void {
    [523, 659, 784].forEach((f, i) => this.tone(f, 0.18, 'triangle', 0.14, 1, i * 0.1));
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
  }
}
