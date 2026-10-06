/**
 * Procedural sound for Crownfall: short synthesized effects (no audio files) and a
 * light marching loop. Everything routes through one master gain.
 */
export class ArenaAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private music: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private musicTimer = 0;
  private step = 0;
  private last = new Map<string, number>();
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
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
      this.music = this.ctx.createGain();
      this.music.gain.value = 0.18;
      this.music.connect(this.master);
      const len = this.ctx.sampleRate * 0.6;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.55;
  }

  /** Rate-limit identical sounds (dozens of skeletons hitting at once). */
  private gate(key: string, gap: number): boolean {
    const now = performance.now();
    if (now - (this.last.get(key) ?? 0) < gap * 1000) return false;
    this.last.set(key, now);
    return true;
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, slide = 0, delay = 0, out?: AudioNode): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out ?? this.master!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number, freq: number, q = 1, type: BiquadFilterType = 'bandpass', delay = 0): void {
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
    s.stop(t + dur + 0.02);
  }

  deploy(big: boolean): void {
    if (!this.gate('deploy', 0.05)) return;
    this.tone(big ? 70 : 110, 0.25, 'sine', 0.5, 0.5);
    this.noise(0.18, 0.25, 500, 0.7, 'lowpass');
  }
  play(): void {
    this.tone(660, 0.08, 'triangle', 0.2);
    this.tone(990, 0.1, 'triangle', 0.15, 1, 0.05);
  }
  melee(): void {
    if (!this.gate('melee', 0.06)) return;
    this.noise(0.09, 0.22, 2400 + Math.random() * 1500, 3);
    this.tone(320 + Math.random() * 120, 0.06, 'square', 0.04, 0.7);
  }
  shoot(kind: string): void {
    if (!this.gate(`shoot-${kind}`, 0.07)) return;
    if (kind === 'cannonball' || kind === 'bomb' || kind === 'shot') {
      this.noise(0.18, 0.3, 300, 0.8, 'lowpass');
      this.tone(90, 0.15, 'sine', 0.3, 0.5);
    } else if (kind === 'zap' || kind === 'flame') {
      this.noise(0.15, 0.15, 4000, 2, 'highpass');
      this.tone(880, 0.12, 'sawtooth', 0.05, 2);
    } else if (kind === 'fireball' || kind === 'magic' || kind === 'iceball') {
      this.tone(420, 0.25, 'sine', 0.12, 1.8);
      this.noise(0.2, 0.08, 1500, 1);
    } else {
      this.noise(0.12, 0.12, 3000, 4);
    }
  }
  boom(size: number): void {
    if (!this.gate('boom', 0.08)) return;
    this.noise(0.5 + size * 0.15, 0.5, 200 + 100 / size, 0.6, 'lowpass');
    this.tone(60, 0.4, 'sine', 0.5, 0.4);
  }
  zap(): void {
    if (!this.gate('zap', 0.05)) return;
    this.noise(0.2, 0.25, 5000, 1.5, 'highpass');
    this.tone(1200, 0.15, 'sawtooth', 0.06, 0.3);
  }
  death(): void {
    if (!this.gate('death', 0.08)) return;
    this.tone(300, 0.2, 'triangle', 0.08, 0.4);
  }
  tower(ours: boolean): void {
    this.noise(1.2, 0.6, 150, 0.5, 'lowpass');
    this.tone(50, 0.9, 'sine', 0.6, 0.5);
    const notes = ours ? [392, 330, 262] : [523, 659, 784, 1047];
    notes.forEach((n, i) => this.tone(n, 0.25, 'triangle', 0.18, 1, 0.35 + i * 0.12));
  }
  elixir(): void {
    if (!this.gate('elixir', 0.2)) return;
    this.tone(880, 0.12, 'sine', 0.12, 1.5);
    this.tone(1320, 0.15, 'sine', 0.1, 1.2, 0.07);
  }
  heal(): void {
    if (!this.gate('heal', 0.25)) return;
    [660, 880, 1100].forEach((n, i) => this.tone(n, 0.18, 'sine', 0.06, 1, i * 0.05));
  }
  announce(): void {
    [523, 659, 784].forEach((n, i) => this.tone(n, 0.16, 'square', 0.06, 1, i * 0.07));
  }
  countdown(n: number): void {
    this.tone(n > 0 ? 600 : 900, n > 0 ? 0.15 : 0.4, 'square', 0.1);
  }
  victory(win: boolean): void {
    const seq = win ? [523, 659, 784, 1047, 784, 1047] : [440, 392, 349, 262];
    seq.forEach((n, i) => this.tone(n, 0.3, 'triangle', 0.2, 1, i * 0.16));
  }
  error(): void {
    this.tone(160, 0.15, 'square', 0.08, 0.8);
  }

  /** A little marching loop while battling; faster in double elixir. */
  tickMusic(dt: number, intensity: number): void {
    const ctx = this.ensure();
    if (!ctx || !this.music) return;
    this.musicTimer -= dt;
    if (this.musicTimer > 0) return;
    const bpm = 112 + intensity * 24;
    this.musicTimer = 60 / bpm / 2;
    const bar = [0, 4, 7, 4, 0, 4, 7, 9, 5, 9, 12, 9, 7, 11, 14, 11];
    const bass = [0, 0, 5, 7];
    const root = 196;
    const i = this.step++ % 16;
    const n = root * Math.pow(2, bar[i]! / 12);
    this.tone(n, 0.16, 'triangle', 0.5, 1, 0, this.music);
    if (i % 4 === 0) this.tone((root / 2) * Math.pow(2, bass[(i / 4) % 4]! / 12), 0.35, 'sine', 0.9, 1, 0, this.music);
    if (i % 2 === 1) this.noise(0.04, 0.05 + intensity * 0.04, 8000, 1, 'highpass');
  }
}
