/** Sound: sampled engine loop + synthesized boost, hits, horn, crowd. */
export class RocketAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private engineBuf: AudioBuffer | null = null;
  private engine: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private boost: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private crowd: { gain: GainNode; filter: BiquadFilterNode } | null = null;
  private crowdLevel = 0.12;
  volume = 0.7;

  /** Must be called from a user gesture. */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = this.ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    void fetch('/assets/audio/engines/italia-v8-3000.wav')
      .then((r) => r.arrayBuffer())
      .then((b) => this.ctx!.decodeAudioData(b))
      .then((buf) => (this.engineBuf = buf))
      .catch(() => undefined);
    this.startCrowd();
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  private startCrowd(): void {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = c.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 900;
    filter.Q.value = 0.6;
    const gain = c.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.master!);
    src.start();
    this.crowd = { gain, filter };
  }

  /** Per-frame: engine pitch from speed/throttle, boost hiss, crowd swell from ball danger. */
  update(speed: number, throttle: number, boosting: boolean, onGround: boolean, excitement: number, active: boolean): void {
    const c = this.ctx;
    if (!c || !this.master) return;
    const t = c.currentTime;
    if (active && this.engineBuf && !this.engine) {
      const src = c.createBufferSource();
      src.buffer = this.engineBuf;
      src.loop = true;
      const gain = c.createGain();
      gain.gain.value = 0;
      src.connect(gain).connect(this.master);
      src.start();
      this.engine = { src, gain };
    }
    if (this.engine) {
      const rate = 0.55 + Math.min(1.25, speed / 1700) * (onGround ? 0.75 : 0.6) + Math.abs(throttle) * 0.08;
      this.engine.src.playbackRate.setTargetAtTime(rate, t, 0.08);
      this.engine.gain.gain.setTargetAtTime(active ? 0.1 + Math.abs(throttle) * 0.08 : 0, t, 0.1);
    }
    if (boosting && active && !this.boost) {
      const src = c.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const filter = c.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 500;
      filter.Q.value = 0.9;
      const gain = c.createGain();
      gain.gain.value = 0;
      gain.gain.setTargetAtTime(0.32, t, 0.03);
      filter.frequency.setTargetAtTime(1600, t, 0.15);
      src.connect(filter).connect(gain).connect(this.master);
      src.start();
      this.boost = { src, gain, filter };
    } else if ((!boosting || !active) && this.boost) {
      const b = this.boost;
      b.gain.gain.setTargetAtTime(0, t, 0.05);
      b.src.stop(t + 0.3);
      this.boost = null;
    }
    if (this.crowd) {
      this.crowdLevel += (0.05 + excitement * 0.22 - this.crowdLevel) * 0.03;
      this.crowd.gain.gain.setTargetAtTime(active ? this.crowdLevel : 0.03, t, 0.2);
    }
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, slide = 0, delay = 0): void {
    const c = this.ctx;
    if (!c || !this.master) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private burst(dur: number, freq: number, q: number, vol: number, type: BiquadFilterType = 'bandpass', delay = 0, sweep = 0): void {
    const c = this.ctx;
    if (!c || !this.master || !this.noise) return;
    const t = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweep) f.frequency.exponentialRampToValueAtTime(freq * sweep, t + dur);
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  /** Ball touch: a deep "thwump" scaled by impact. */
  hit(power: number, near: number): void {
    const v = Math.min(1, power / 2500) * near;
    if (v < 0.03) return;
    this.tone(95 + v * 40, 0.22, 'sine', 0.55 * v, 0.5);
    this.burst(0.12, 1800, 0.8, 0.35 * v, 'bandpass');
    this.burst(0.25, 400, 1, 0.3 * v, 'lowpass');
  }
  bounce(power: number, near: number): void {
    const v = Math.min(1, power / 2000) * near * 0.6;
    if (v < 0.03) return;
    this.tone(70, 0.18, 'sine', 0.5 * v, 0.6);
    this.burst(0.08, 1200, 1, 0.2 * v);
  }
  jump(): void {
    this.burst(0.18, 700, 1.2, 0.12, 'bandpass', 0, 2.2);
  }
  dodge(): void {
    this.burst(0.3, 500, 0.8, 0.14, 'bandpass', 0, 3);
  }
  pad(big: boolean): void {
    this.tone(big ? 660 : 880, 0.12, 'triangle', 0.12);
    this.tone(big ? 990 : 1320, 0.16, 'triangle', 0.1, 0, 0.05);
  }
  bump(): void {
    this.burst(0.15, 300, 0.7, 0.4, 'lowpass');
    this.tone(60, 0.15, 'square', 0.12, 0.5);
  }
  demo(near: number): void {
    this.burst(1.2, 600, 0.4, 0.9 * near, 'lowpass', 0, 0.15);
    this.tone(55, 0.6, 'sawtooth', 0.35 * near, 0.4);
  }
  countdown(n: number): void {
    if (n > 0) this.tone(587, 0.18, 'square', 0.12);
    else this.tone(1175, 0.45, 'square', 0.14);
  }
  goal(): void {
    // Explosion, stadium horn, crowd roar.
    this.burst(1.6, 300, 0.4, 1, 'lowpass', 0, 0.2);
    this.tone(48, 1.2, 'sine', 0.8, 0.5);
    for (const [f, d] of [
      [233, 0],
      [233, 0.0],
      [311, 0.0],
    ] as Array<[number, number]>)
      this.tone(f, 1.6, 'sawtooth', 0.09, 0.98, d + 0.15);
    this.burst(4, 1100, 0.5, 0.5, 'bandpass', 0.1, 0.8);
    this.crowdLevel = 0.6;
  }
  chat(): void {
    this.tone(1400, 0.06, 'sine', 0.08);
    this.tone(1800, 0.08, 'sine', 0.07, 0, 0.06);
  }
  whistle(): void {
    this.tone(2600, 0.5, 'sine', 0.12, 1.02);
  }
  ui(): void {
    this.tone(900, 0.05, 'triangle', 0.08);
  }

  silence(): void {
    this.update(0, 0, false, true, 0, false);
  }
}
