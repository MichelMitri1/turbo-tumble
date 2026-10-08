/** Lounge loop: I–vi–IV–V in C, one chord per bar (root Hz + chord tones in semitones). */
const BARS: Array<[number, number[]]> = [
  [130.81, [0, 4, 7, 12]],
  [110.0, [0, 3, 7, 12]],
  [87.31, [0, 4, 7, 12]],
  [98.0, [0, 4, 7, 10]],
];
const STEP = 60 / 100 / 2; // eighth notes at 100 bpm

/** Procedural sound for Last Card (no audio files): effects, plus an optional music loop on its own bus. */
export class LastCardAudio {
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

  /** Music on/off (independent of the effects mute). Needs a user gesture the first time. */
  setMusic(on: boolean): void {
    this.music = on;
    const ctx = on ? this.context() : this.ctx;
    if (!ctx || !this.musicBus) return;
    this.musicBus.gain.setTargetAtTime(on ? 0.22 : 0, ctx.currentTime, 0.3);
    if (on && !this.musicTimer) {
      this.nextAt = ctx.currentTime + 0.1;
      this.musicTimer = window.setInterval(() => this.schedule(), 60);
    } else if (!on && this.musicTimer) {
      clearInterval(this.musicTimer);
      this.musicTimer = 0;
    }
  }

  /** Look-ahead scheduler: soft bass on beats 1 and 3, a gentle arpeggio, a brushed hat on the off-beats. */
  private schedule(): void {
    const ctx = this.ctx;
    const bus = this.musicBus;
    if (!ctx || !bus) return;
    while (this.nextAt < ctx.currentTime + 0.25) {
      const [root, chord] = BARS[Math.floor(this.step / 8) % BARS.length]!;
      const k = this.step % 8;
      const t = this.nextAt - ctx.currentTime;
      if (k === 0 || k === 4) this.tone(root / 2, STEP * 3.5, 'triangle', 0.5, 1, t, bus);
      const arp = [0, 1, 2, 3, 2, 1, 2, 3][k]!;
      this.tone(root * 2 * 2 ** (chord[arp]! / 12), STEP * 1.6, 'sine', k % 2 ? 0.14 : 0.2, 1, t, bus);
      if (k % 2 === 1) this.noise(0.04, 0.05, 7000, 'highpass', t, 1, bus);
      this.nextAt += STEP;
      this.step++;
    }
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
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out ?? this.master!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noise(dur: number, vol: number, freq: number, type: BiquadFilterType = 'bandpass', delay = 0, q = 1, out: GainNode | null = null): void {
    const ctx = out ? this.ctx : this.ensure();
    if (!ctx || !this.noiseBuf) return;
    const t = ctx.currentTime + delay;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(out ?? this.master!);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.05);
  }

  card(): void {
    this.noise(0.09, 0.35, 2600, 'bandpass', 0, 0.8);
    this.tone(320, 0.06, 'triangle', 0.12, 0.7);
  }
  draw(): void {
    this.noise(0.14, 0.25, 1500, 'bandpass', 0, 0.6);
  }
  deal(): void {
    for (let i = 0; i < 6; i++) this.noise(0.06, 0.2, 2200 + i * 80, 'bandpass', i * 0.06, 1);
  }
  shuffle(): void {
    for (let i = 0; i < 10; i++) this.noise(0.05, 0.18, 1800 + Math.random() * 1200, 'bandpass', i * 0.04, 1.2);
  }
  turn(): void {
    this.tone(660, 0.12, 'sine', 0.18);
    this.tone(990, 0.18, 'sine', 0.16, 1, 0.09);
  }
  skip(): void {
    this.tone(500, 0.18, 'square', 0.1, 0.5);
  }
  reverse(): void {
    this.tone(300, 0.14, 'triangle', 0.16, 2);
    this.tone(600, 0.14, 'triangle', 0.16, 0.5, 0.13);
  }
  plus(n: number): void {
    for (let i = 0; i < Math.min(4, n / 2 + 1); i++) this.tone(220 + i * 110, 0.12, 'sawtooth', 0.09, 1.2, i * 0.07);
  }
  wild(): void {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.18, 'triangle', 0.13, 1, i * 0.05));
  }
  call(): void {
    // A bright "hey!" shout.
    this.tone(880, 0.22, 'square', 0.12, 1.25);
    this.tone(1320, 0.3, 'triangle', 0.12, 1.1, 0.08);
  }
  caught(): void {
    this.tone(420, 0.25, 'sawtooth', 0.14, 0.5);
    this.noise(0.25, 0.2, 500, 'lowpass');
  }
  challenge(): void {
    this.tone(150, 0.4, 'sawtooth', 0.12, 1.5);
  }
  warn(): void {
    this.tone(1100, 0.08, 'square', 0.08);
    this.tone(1100, 0.08, 'square', 0.08, 1, 0.12);
  }
  tick(): void {
    this.tone(1500, 0.04, 'sine', 0.1);
  }
  swap(): void {
    for (let i = 0; i < 5; i++) this.noise(0.05, 0.18, 2000 + i * 200, 'bandpass', i * 0.05, 1);
    this.tone(400, 0.25, 'triangle', 0.12, 1.6, 0.05);
  }
  error(): void {
    this.tone(180, 0.15, 'square', 0.1, 0.8);
  }
  win(won: boolean): void {
    const notes = won ? [523, 659, 784, 1047, 1319] : [392, 330, 262];
    notes.forEach((f, i) => this.tone(f, 0.28, 'triangle', 0.16, 1, i * 0.13));
  }
}
