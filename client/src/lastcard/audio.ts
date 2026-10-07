/** Procedural sound for Last Card (no audio files). */
export class LastCardAudio {
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
  error(): void {
    this.tone(180, 0.15, 'square', 0.1, 0.8);
  }
  win(won: boolean): void {
    const notes = won ? [523, 659, 784, 1047, 1319] : [392, 330, 262];
    notes.forEach((f, i) => this.tone(f, 0.28, 'triangle', 0.16, 1, i * 0.13));
  }
}
