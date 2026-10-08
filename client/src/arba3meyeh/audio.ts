/** Table sounds, synthesised: shuffle riffle, card snaps on felt, trick sweeps, chimes. */
export class TableAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  muted = false;

  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const c = (this.ctx = new AC());
    this.master = c.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(c.destination);
    const n = c.sampleRate;
    this.noise = c.createBuffer(1, n, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.8;
  }

  private burst(delay: number, dur: number, freq: number, q: number, vol: number, type: BiquadFilterType = 'bandpass'): void {
    const c = this.ctx;
    if (!c || !this.master || !this.noise) return;
    const t = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.05);
  }

  private tone(delay: number, f: number, dur: number, vol: number, type: OscillatorType = 'sine'): void {
    const c = this.ctx;
    if (!c || !this.master) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = f;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** A riffle shuffle: a rapid run of tiny card clicks. */
  shuffle(): void {
    for (let i = 0; i < 26; i++) this.burst(i * 0.022 + Math.random() * 0.006, 0.03, 3200 + Math.random() * 1600, 1.2, 0.08);
    for (let i = 0; i < 10; i++) this.burst(0.65 + i * 0.03, 0.035, 2600, 1.2, 0.07);
  }
  /** One card dealt across the felt. */
  deal(): void {
    this.burst(0, 0.06, 2400 + Math.random() * 600, 0.9, 0.12);
  }
  /** A card snapped down on the table. */
  play(hard = false): void {
    this.burst(0, 0.05, 1900, 1, hard ? 0.4 : 0.26);
    this.burst(0.012, 0.09, 600, 0.8, hard ? 0.2 : 0.12, 'lowpass');
  }
  /** The trick swept in. */
  sweep(mine: boolean): void {
    this.burst(0, 0.22, 3000, 0.6, 0.1, 'highpass');
    if (mine) this.tone(0.05, 880, 0.12, 0.05, 'triangle');
  }
  bid(): void {
    this.tone(0, 660, 0.08, 0.06, 'triangle');
  }
  myTurn(): void {
    this.tone(0, 784, 0.09, 0.05, 'triangle');
    this.tone(0.08, 1046, 0.12, 0.05, 'triangle');
  }
  made(): void {
    [523, 659, 784].forEach((f, i) => this.tone(i * 0.09, f, 0.25, 0.08, 'triangle'));
  }
  missed(): void {
    this.tone(0, 220, 0.3, 0.09, 'sawtooth');
    this.tone(0.12, 165, 0.4, 0.08, 'sawtooth');
  }
  win(): void {
    [523, 659, 784, 1046, 784, 1046].forEach((f, i) => this.tone(i * 0.12, f, 0.35, 0.09, 'triangle'));
  }
  lose(): void {
    [392, 330, 262].forEach((f, i) => this.tone(i * 0.18, f, 0.4, 0.08, 'triangle'));
  }
  ui(): void {
    this.tone(0, 900, 0.04, 0.04, 'triangle');
  }
}
