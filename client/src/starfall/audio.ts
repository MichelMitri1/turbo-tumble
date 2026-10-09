/** Synthesised sound effects (no files): UI blips, the kill slash, alarms, the meeting horn. */

export type Sfx =
  | 'click' | 'use' | 'task' | 'taskStep' | 'wrong' | 'kill' | 'report' | 'emergency' | 'vote' | 'eject' | 'vent' | 'sabotage'
  | 'alarm' | 'door' | 'fixed' | 'win' | 'lose' | 'reveal' | 'chat' | 'step';

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  volume = 0.5;
  private alarmT = 0;

  private ac(): AudioContext | null {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
      } catch {
        return null;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    this.master!.gain.value = this.volume;
    return this.ctx;
  }

  private tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.3, at = 0, slide = 0): void {
    const c = this.ac();
    if (!c) return;
    const t = c.currentTime + at;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol = 0.3, at = 0, filter = 2000, q = 1, type: BiquadFilterType = 'bandpass'): void {
    const c = this.ac();
    if (!c) return;
    const t = c.currentTime + at;
    const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = filter;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t);
  }

  play(s: Sfx): void {
    switch (s) {
      case 'click':
        return this.tone(900, 0.05, 'square', 0.08);
      case 'use':
        return this.tone(620, 0.08, 'triangle', 0.18);
      case 'taskStep':
        this.tone(660, 0.08, 'triangle', 0.2);
        return this.tone(990, 0.12, 'triangle', 0.2, 0.07);
      case 'task':
        this.tone(523, 0.12, 'triangle', 0.25);
        this.tone(659, 0.12, 'triangle', 0.25, 0.1);
        return this.tone(1047, 0.3, 'triangle', 0.25, 0.2);
      case 'wrong':
        return this.tone(180, 0.25, 'sawtooth', 0.15, 0, 0.7);
      case 'kill':
        this.noise(0.25, 0.6, 0, 3500, 0.8, 'highpass');
        this.tone(220, 0.35, 'sawtooth', 0.25, 0.02, 0.3);
        return this.noise(0.4, 0.35, 0.1, 400, 1, 'lowpass');
      case 'report':
        for (let i = 0; i < 3; i++) this.tone(880, 0.12, 'square', 0.15, i * 0.16, 0.8);
        return;
      case 'emergency':
        for (let i = 0; i < 4; i++) {
          this.tone(740, 0.18, 'square', 0.15, i * 0.36);
          this.tone(587, 0.18, 'square', 0.15, i * 0.36 + 0.18);
        }
        return;
      case 'vote':
        return this.tone(1200, 0.06, 'square', 0.1);
      case 'eject':
        return this.noise(1.6, 0.25, 0, 600, 0.5, 'lowpass');
      case 'vent':
        this.noise(0.12, 0.4, 0, 900, 2);
        return this.tone(140, 0.15, 'square', 0.15, 0.02, 0.6);
      case 'sabotage':
      case 'alarm':
        this.tone(950, 0.22, 'square', 0.12);
        return this.tone(700, 0.22, 'square', 0.12, 0.24);
      case 'door':
        this.noise(0.18, 0.5, 0, 300, 1, 'lowpass');
        return this.tone(90, 0.2, 'square', 0.2, 0, 0.5);
      case 'fixed':
        this.tone(784, 0.1, 'triangle', 0.2);
        return this.tone(1175, 0.2, 'triangle', 0.2, 0.09);
      case 'win':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.35, 'triangle', 0.22, i * 0.14));
        return;
      case 'lose':
        [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.45, 'sawtooth', 0.12, i * 0.2));
        return;
      case 'reveal':
        this.noise(0.9, 0.18, 0, 5000, 0.6, 'highpass');
        return this.tone(110, 1.4, 'sawtooth', 0.12, 0.6, 1.5);
      case 'chat':
        return this.tone(1400, 0.04, 'sine', 0.08);
      case 'step':
        return this.noise(0.05, 0.05, 0, 700, 1.5);
    }
  }

  /** Critical sabotage siren: call every frame while it's on. */
  siren(dt: number, on: boolean): void {
    if (!on) {
      this.alarmT = 0;
      return;
    }
    this.alarmT -= dt;
    if (this.alarmT <= 0) {
      this.alarmT = 1.1;
      this.play('alarm');
    }
  }
}
