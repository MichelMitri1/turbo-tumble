/** Procedural sound for Kitten Kaboom (no audio files). */
export class KittenAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  muted = false;

  private ensure(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return null;
      }
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
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

  private tone(f: number, dur: number, type: OscillatorType, vol: number, slide = 1, delay = 0): void {
    const ctx = this.ensure();
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
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noise(dur: number, vol: number, freq: number, type: BiquadFilterType = 'bandpass', delay = 0, q = 1): void {
    const ctx = this.ensure();
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
    s.connect(f).connect(g).connect(this.master!);
    s.start(t);
    s.stop(t + dur + 0.05);
  }

  card(): void {
    this.noise(0.08, 0.25, 2500, 'bandpass', 0, 2);
  }
  draw(): void {
    this.noise(0.12, 0.2, 1800, 'bandpass', 0, 1.5);
    this.tone(520, 0.08, 'triangle', 0.05);
  }
  shuffle(): void {
    for (let i = 0; i < 9; i++) this.noise(0.05, 0.18, 2000 + i * 120, 'bandpass', i * 0.045, 3);
  }
  nope(): void {
    this.tone(180, 0.25, 'square', 0.12, 0.6);
    this.noise(0.2, 0.4, 300, 'lowpass');
  }
  meow(happy = true): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(happy ? 520 : 380, t);
    o.frequency.linearRampToValueAtTime(happy ? 820 : 520, t + 0.12);
    o.frequency.linearRampToValueAtTime(happy ? 560 : 300, t + 0.4);
    f.type = 'bandpass';
    f.frequency.setValueAtTime(900, t);
    f.frequency.linearRampToValueAtTime(1800, t + 0.15);
    f.frequency.linearRampToValueAtTime(700, t + 0.4);
    f.Q.value = 4;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    o.connect(f).connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + 0.5);
  }
  fuse(): void {
    this.noise(0.6, 0.12, 6000, 'highpass');
  }
  boom(): void {
    this.noise(1.4, 0.8, 140, 'lowpass');
    this.tone(55, 1, 'sine', 0.7, 0.4);
    this.noise(0.4, 0.4, 900, 'bandpass', 0.05);
  }
  defuse(): void {
    this.noise(0.05, 0.4, 5000, 'highpass');
    [660, 880, 1320].forEach((n, i) => this.tone(n, 0.18, 'triangle', 0.1, 1, 0.08 + i * 0.07));
  }
  turn(): void {
    this.tone(880, 0.12, 'sine', 0.12);
    this.tone(1320, 0.18, 'sine', 0.1, 1, 0.09);
  }
  steal(): void {
    this.tone(700, 0.12, 'triangle', 0.08, 0.6);
    this.noise(0.08, 0.2, 2500);
  }
  error(): void {
    this.tone(160, 0.15, 'square', 0.08, 0.8);
  }
  angel(): void {
    [523, 659, 784, 1047, 1319].forEach((n, i) => this.tone(n, 0.4, 'sine', 0.08, 1, i * 0.07));
  }
  devil(): void {
    [220, 207, 196, 185].forEach((n, i) => this.tone(n, 0.35, 'sawtooth', 0.06, 1, i * 0.12));
  }
  drumroll(): void {
    for (let i = 0; i < 16; i++) this.noise(0.05, 0.1 + i * 0.01, 400, 'lowpass', i * 0.06);
  }
  /** Last second of a Nope window. */
  tick(): void {
    this.tone(1250, 0.05, 'square', 0.06);
  }
  /** A card flipping face up. */
  flip(): void {
    this.noise(0.06, 0.22, 3200, 'bandpass', 0, 2.5);
    this.tone(900, 0.05, 'triangle', 0.04, 1.4);
  }
  /** An attack lands on someone. */
  hit(): void {
    this.noise(0.18, 0.5, 220, 'lowpass');
    this.tone(120, 0.22, 'square', 0.1, 0.5);
  }
  /** Imploding: everything sucked into a point. */
  implode(): void {
    this.tone(70, 0.9, 'sawtooth', 0.12, 8);
    this.noise(0.9, 0.35, 400, 'bandpass', 0, 0.7);
    this.tone(1800, 0.25, 'sine', 0.1, 0.2, 0.85);
  }
  reverse(): void {
    [880, 660, 440].forEach((n, i) => this.tone(n, 0.12, 'triangle', 0.08, 1, i * 0.06));
    [440, 660, 880].forEach((n, i) => this.tone(n, 0.12, 'triangle', 0.08, 1, 0.22 + i * 0.06));
  }
  win(me: boolean): void {
    const seq = me ? [523, 659, 784, 1047, 784, 1047] : [440, 392, 349, 262];
    seq.forEach((n, i) => this.tone(n, 0.3, 'triangle', 0.15, 1, i * 0.15));
  }
}
