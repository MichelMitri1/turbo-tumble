/** Maqam Hijaz on D (semitones above D): D Eb F# G A Bb C D. */
const HIJAZ = [0, 1, 4, 5, 7, 8, 10, 12, 13, 16, 17, 19];
const D3 = 146.83;
const STEP = 60 / 96 / 2; // eighth notes at 96 bpm
/** Maqsum: doum tek – tek doum – tek – (D = doum, T = tek, k = soft ka). */
const MAQSUM = ['D', 'T', 'k', 'T', 'D', 'k', 'T', 'k'];
/** Two-bar melodic cells (scale degrees, -1 = rest), chosen in a loose A A B A form. */
const CELLS: number[][] = [
  [4, -1, 3, 2, 1, -1, 2, -1, 3, 2, 1, 0, 1, -1, 0, -1],
  [4, 5, 4, 3, 4, -1, 2, 3, 2, 1, 2, -1, 1, 0, -1, -1],
  [7, -1, 6, 5, 4, 5, 6, -1, 5, 4, 3, 4, 2, -1, 1, 0],
  [0, 2, 3, 4, -1, 4, 5, 4, 3, -1, 2, 1, 2, -1, 0, -1],
];
const FORM = [0, 0, 1, 0, 2, 3, 1, 0];

/** Procedural sound for Jackaroo (no audio files): effects, plus a music loop on its own bus. */
export class JackarooAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  muted = false;
  music = false;
  private musicTimer = 0;
  private step = 0;
  private nextAt = 0;

  private ensure(): AudioContext | null {
    if (this.muted) return null;
    return this.context();
  }

  private context(): AudioContext | null {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return null;
      }
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = 0;
      this.musicBus.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }

  setMusic(on: boolean): void {
    this.music = on;
    const ctx = on ? this.context() : this.ctx;
    if (!ctx || !this.musicBus) return;
    this.musicBus.gain.setTargetAtTime(on ? 0.2 : 0, ctx.currentTime, 0.4);
    if (on && !this.musicTimer) {
      this.nextAt = ctx.currentTime + 0.1;
      this.musicTimer = window.setInterval(() => this.schedule(), 60);
    } else if (!on && this.musicTimer) {
      clearInterval(this.musicTimer);
      this.musicTimer = 0;
    }
  }

  /** Look-ahead scheduler: darbuka maqsum, a plucked oud line in Hijaz, a soft drone. */
  private schedule(): void {
    const ctx = this.ctx;
    const bus = this.musicBus;
    if (!ctx || !bus) return;
    while (this.nextAt < ctx.currentTime + 0.25) {
      const t = this.nextAt - ctx.currentTime;
      const k = this.step % 8;
      const hit = MAQSUM[k]!;
      if (hit === 'D') this.doum(t, bus);
      else if (hit === 'T') this.tek(t, bus, 0.16);
      else if (this.step % 2 === 1 && Math.random() < 0.7) this.tek(t, bus, 0.06);
      const bar16 = this.step % 16;
      const cell = CELLS[FORM[Math.floor(this.step / 16) % FORM.length]!]!;
      const deg = cell[bar16]!;
      if (deg >= 0) this.pluck(D3 * 2 ** (HIJAZ[deg]! / 12), t, bus, bar16 % 4 === 0 ? 0.26 : 0.18);
      // Drone on D every bar, a fifth above every other.
      if (bar16 === 0) this.drone(D3 / 2, t, STEP * 15, bus);
      if (bar16 === 8 && Math.floor(this.step / 16) % 2) this.drone((D3 / 2) * 1.5, t, STEP * 7, bus, 0.04);
      this.nextAt += STEP;
      this.step++;
    }
  }

  /** Oud-ish pluck: bright attack through a closing low-pass, quick decay, a touch of detune. */
  private pluck(f: number, delay: number, out: GainNode, vol: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 6;
    lp.frequency.setValueAtTime(f * 9, t);
    lp.frequency.exponentialRampToValueAtTime(f * 1.4, t + 0.35);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    for (const det of [-4, 5]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = det;
      o.connect(lp);
      o.start(t);
      o.stop(t + 1);
    }
    lp.connect(g).connect(out);
  }

  private drone(f: number, delay: number, dur: number, out: GainNode, vol = 0.07): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 600;
    o.type = 'sawtooth';
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp).connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private doum(delay: number, out: GainNode): void {
    this.tone(95, 0.32, 'sine', 0.55, 0.55, delay, out);
    this.noise(0.05, 0.12, 400, 'lowpass', delay, 1, out);
  }
  private tek(delay: number, out: GainNode, vol: number): void {
    this.noise(0.045, vol, 5200, 'bandpass', delay, 1.5, out);
    this.tone(620, 0.03, 'triangle', vol * 0.4, 0.8, delay, out);
  }

  private tone(f: number, dur: number, type: OscillatorType, vol: number, slide = 1, delay = 0, out: GainNode | null = null): void {
    const ctx = out ? this.ctx : this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (slide !== 1) o.frequency.exponentialRampToValueAtTime(Math.max(20, f * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out ?? this.master!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noise(dur: number, vol: number, freq: number, type: BiquadFilterType = 'bandpass', delay = 0, q = 1, out: GainNode | null = null, sweep = 1): void {
    const ctx = out ? this.ctx : this.ensure();
    if (!ctx || !this.noiseBuf) return;
    const t = ctx.currentTime + delay;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweep !== 1) f.frequency.exponentialRampToValueAtTime(freq * sweep, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(out ?? this.master!);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.05);
  }

  /** Marble lands on a hole: a glassy click, rising through the move. */
  hop(i: number, n: number): void {
    const f = 900 * 2 ** ((i / Math.max(1, n - 1)) * 0.6);
    this.tone(f, 0.05, 'sine', 0.16);
    this.tone(f * 2.7, 0.03, 'sine', 0.05);
    this.noise(0.025, 0.18, 3200, 'bandpass', 0, 2);
  }
  capture(): void {
    this.tone(150, 0.3, 'sine', 0.5, 0.4);
    this.noise(0.18, 0.35, 700, 'lowpass');
    this.tone(1400, 0.08, 'triangle', 0.1, 0.6, 0.02);
  }
  out(): void {
    this.tone(320, 0.16, 'sine', 0.28, 2.4);
    this.noise(0.05, 0.12, 2400, 'bandpass', 0, 2);
  }
  card(): void {
    this.noise(0.12, 0.3, 1800, 'bandpass', 0, 0.8, null, 2.2);
  }
  flip(): void {
    this.noise(0.04, 0.22, 3500, 'highpass', 0, 1);
  }
  deal(n: number): void {
    for (let i = 0; i < Math.min(8, n); i++) this.noise(0.05, 0.16, 2200 + i * 90, 'bandpass', i * 0.05, 1);
  }
  shuffle(): void {
    for (let i = 0; i < 12; i++) this.noise(0.05, 0.15, 1700 + Math.random() * 1400, 'bandpass', i * 0.035, 1.2);
  }
  burn(): void {
    this.noise(0.7, 0.32, 300, 'lowpass', 0, 1, null, 9);
    for (let i = 0; i < 9; i++) this.noise(0.02, 0.18, 3000 + Math.random() * 3000, 'bandpass', 0.05 + Math.random() * 0.6, 3);
  }
  swap(): void {
    this.noise(0.35, 0.22, 900, 'bandpass', 0, 1.2, null, 3);
    this.noise(0.35, 0.18, 2600, 'bandpass', 0.1, 1.2, null, 0.4);
  }
  sweep(): void {
    this.tone(90, 0.6, 'sawtooth', 0.18, 0.5);
    this.noise(0.5, 0.25, 500, 'lowpass', 0, 1, null, 4);
  }
  safe(): void {
    [0, 4, 7, 12].forEach((s, i) => this.tone(587 * 2 ** (s / 12), 0.5, 'sine', 0.13, 1, i * 0.06));
  }
  turn(): void {
    this.tone(740, 0.12, 'sine', 0.16);
    this.tone(1110, 0.2, 'sine', 0.13, 1, 0.09);
  }
  select(): void {
    this.tone(980, 0.05, 'triangle', 0.1);
  }
  error(): void {
    this.tone(170, 0.16, 'square', 0.09, 0.8);
  }
  tick(): void {
    this.tone(1500, 0.04, 'sine', 0.1);
  }
  win(won: boolean): void {
    // A Hijaz flourish up to the octave (won) or a falling sigh (lost).
    const notes = won ? [0, 1, 4, 5, 7, 8, 7, 12] : [7, 5, 4, 1, 0];
    notes.forEach((s, i) => {
      const f = 293.66 * 2 ** (s / 12);
      this.tone(f, 0.32, 'triangle', 0.16, 1, i * 0.11);
      this.tone(f * 2, 0.2, 'sine', 0.05, 1, i * 0.11);
    });
    if (won) [0, 4, 7].forEach((s) => this.tone(587 * 2 ** (s / 12), 1.4, 'sine', 0.08, 1, notes.length * 0.11));
  }
}
