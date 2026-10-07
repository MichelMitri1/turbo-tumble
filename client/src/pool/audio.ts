/** Procedural pool sounds: ball clicks, cushion thumps, pocket drops, cue strikes. */
export class PoolAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  muted = false;
  private recent = 0;

  private ensure(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return null;
      }
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.6;
      const comp = this.ctx.createDynamicsCompressor();
      this.master.connect(comp).connect(this.ctx.destination);
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
    if (this.master) this.master.gain.value = m ? 0 : 0.6;
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
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.002);
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
    g.gain.setValueAtTime(Math.max(0.0002, vol), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.master!);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.05);
  }

  /** Phenolic ball-on-ball click. */
  click(speed: number): void {
    const v = Math.min(1, speed / 4);
    if (v < 0.01) return;
    // Don't machine-gun during the break.
    const now = performance.now();
    if (now - this.recent < 6) return;
    this.recent = now;
    const f = 2600 + Math.random() * 900;
    this.tone(f, 0.035, 'sine', 0.5 * v);
    this.tone(f * 1.52, 0.02, 'sine', 0.25 * v);
    this.noise(0.03, 0.45 * v, 4200, 'bandpass', 0, 1.5);
  }
  cushion(speed: number): void {
    const v = Math.min(1, speed / 3.5);
    if (v < 0.02) return;
    this.tone(120, 0.12, 'sine', 0.4 * v, 0.6);
    this.noise(0.08, 0.25 * v, 500, 'lowpass');
  }
  pocket(): void {
    this.noise(0.08, 0.4, 900, 'bandpass', 0, 0.8);
    this.tone(180, 0.18, 'sine', 0.35, 0.5, 0.05);
    // Rolling down the return.
    for (let i = 0; i < 4; i++) this.noise(0.05, 0.12, 700 - i * 60, 'bandpass', 0.18 + i * 0.07, 2);
  }
  cue(power: number): void {
    const v = 0.3 + power * 0.7;
    this.tone(900, 0.04, 'triangle', 0.35 * v);
    this.noise(0.05, 0.5 * v, 1800, 'bandpass', 0, 1);
    this.tone(240, 0.07, 'sine', 0.3 * v, 0.7);
  }
  break(): void {
    for (let i = 0; i < 9; i++) this.click(2 + Math.random() * 2);
  }
  turn(): void {
    this.tone(660, 0.1, 'sine', 0.15);
    this.tone(880, 0.14, 'sine', 0.13, 1, 0.08);
  }
  foul(): void {
    this.tone(220, 0.3, 'sawtooth', 0.12, 0.6);
  }
  tick(): void {
    this.tone(1200, 0.03, 'square', 0.06);
  }
  ui(): void {
    this.tone(700, 0.04, 'triangle', 0.08);
  }
  win(won: boolean): void {
    const notes = won ? [523, 659, 784, 1047, 1319] : [392, 330, 262];
    notes.forEach((f, i) => this.tone(f, 0.28, 'triangle', 0.16, 1, i * 0.13));
  }
}
