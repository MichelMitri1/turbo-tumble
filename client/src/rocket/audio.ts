/** Arena background sound: crowd size, wind, city / machine hum, and snow-muffled crowd. */
export interface Ambience {
  crowd: number;
  wind: number;
  hum: number;
  muffled: boolean;
}
export type MusicTrack = 'menu' | 'match';

/** Another car heard from the player's position. */
export interface CarVoice {
  id: number;
  speed: number;
  boosting: boolean;
  /** 0..1 distance attenuation. */
  near: number;
}

interface Voice {
  src: AudioBufferSourceNode;
  gain: GainNode;
  boost: GainNode;
  boostSrc: AudioBufferSourceNode;
  seen: boolean;
}

/**
 * Music patterns: 16 steps per bar, 4 bars. Chords are root offsets (semitones)
 * from the key; the scheduler plays a bass, a pad / arp and drums.
 */
const MUSIC: Record<MusicTrack, { bpm: number; key: number; chords: number[][]; arp: boolean; kick: string; hat: string; snare: string; bass: string }> = {
  menu: { bpm: 96, key: 45, chords: [[0, 3, 7, 10], [-4, 0, 3, 7], [-7, -3, 0, 3], [-2, 2, 5, 9]], arp: true, kick: 'x.......x.......', hat: '..x...x...x...x.', snare: '....x.......x...', bass: 'x.....x...x.....' },
  match: { bpm: 124, key: 40, chords: [[0, 3, 7], [0, 3, 7], [-4, 0, 3], [-2, 2, 5]], arp: false, kick: 'x...x...x...x...', hat: '..x...x...x...xx', snare: '....x.......x...', bass: 'x.xx..x.x.xx..x.' },
};

/** Sound: sampled engine loop + synthesized boost, hits, horn, crowd, ambience and music. */
export class RocketAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private engineBuf: AudioBuffer | null = null;
  private engine: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private boost: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private crowd: { gain: GainNode; filter: BiquadFilterNode } | null = null;
  private wind: { gain: GainNode; filter: BiquadFilterNode } | null = null;
  private hum: { gain: GainNode } | null = null;
  private screech: { gain: GainNode; filter: BiquadFilterNode } | null = null;
  private readonly voices = new Map<number, Voice>();
  private crowdLevel = 0.12;
  private amb: Ambience = { crowd: 1, wind: 0, hum: 0.15, muffled: false };
  private musicBus: GainNode | null = null;
  private musicOn = true;
  private track: MusicTrack | null = null;
  private musicTimer = 0;
  private musicStep = 0;
  private musicNext = 0;
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
    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = this.musicOn ? 0.32 : 0;
    this.musicBus.connect(this.master);
    this.setAmbience(this.amb);
    if (this.track) this.startMusic();
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  /** A looping filtered noise bed. */
  private noiseBed(type: BiquadFilterType, freq: number, q: number): { gain: GainNode; filter: BiquadFilterNode } {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = c.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = c.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.master!);
    src.start(0, Math.random() * 1.5);
    return { gain, filter };
  }

  private startCrowd(): void {
    this.crowd = this.noiseBed('bandpass', 900, 0.6);
  }

  /** Arena ambience: crowd size, wind gusts, city / machine hum, snow-muffled crowd. */
  setAmbience(a: Ambience): void {
    this.amb = { ...a };
    const c = this.ctx;
    if (!c || !this.master) return;
    const t = c.currentTime;
    this.crowd?.filter.frequency.setTargetAtTime(a.muffled ? 520 : 900, t, 0.3);
    this.wind ??= this.noiseBed('lowpass', 380, 0.4);
    this.wind.gain.gain.setTargetAtTime(a.wind * 0.07, t, 0.5);
    if (!this.hum) {
      // Low mains hum + a band of traffic rumble.
      const g = c.createGain();
      g.gain.value = 0;
      g.connect(this.master);
      for (const [f, v] of [[55, 0.5], [110, 0.25], [165, 0.08]] as const) {
        const o = c.createOscillator();
        o.frequency.value = f;
        const og = c.createGain();
        og.gain.value = v;
        o.connect(og).connect(g);
        o.start();
      }
      const rumble = this.noiseBed('lowpass', 160, 0.7);
      rumble.gain.disconnect();
      rumble.gain.gain.value = 1.4;
      rumble.gain.connect(g);
      this.hum = { gain: g };
    }
    this.hum.gain.gain.setTargetAtTime(a.hum * 0.035, t, 0.5);
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
      this.crowd.gain.gain.setTargetAtTime((active ? this.crowdLevel : 0.03) * this.amb.crowd, t, 0.2);
    }
    // Wind gusts.
    if (this.wind && this.amb.wind > 0) {
      const gust = 0.6 + 0.4 * Math.sin(t * 0.37) * Math.sin(t * 0.13 + 1);
      this.wind.gain.gain.setTargetAtTime(this.amb.wind * 0.07 * gust, t, 0.4);
      this.wind.filter.frequency.setTargetAtTime(260 + gust * 260, t, 0.4);
    }
  }

  /** Tyre screech while powersliding (0 = off). */
  slide(amount: number): void {
    const c = this.ctx;
    if (!c || !this.master) return;
    if (!this.screech && amount <= 0) return;
    this.screech ??= this.noiseBed('bandpass', 2400, 6);
    const t = c.currentTime;
    this.screech.gain.gain.setTargetAtTime(Math.min(1, amount) * 0.08, t, amount > 0 ? 0.04 : 0.12);
    this.screech.filter.frequency.setTargetAtTime(2100 + amount * 700, t, 0.1);
  }

  /** Engines and boost of the other cars, attenuated by distance (the 5 nearest). */
  others(cars: CarVoice[]): void {
    const c = this.ctx;
    if (!c || !this.master) return;
    const t = c.currentTime;
    for (const v of this.voices.values()) v.seen = false;
    const near = cars.filter((x) => x.near > 0.18).sort((a, b) => b.near - a.near).slice(0, 5);
    for (const car of near) {
      let v = this.voices.get(car.id);
      if (!v) {
        if (!this.engineBuf || !this.noise) continue;
        const src = c.createBufferSource();
        src.buffer = this.engineBuf;
        src.loop = true;
        const gain = c.createGain();
        gain.gain.value = 0;
        src.connect(gain).connect(this.master);
        src.start(0, Math.random() * this.engineBuf.duration);
        const boostSrc = c.createBufferSource();
        boostSrc.buffer = this.noise;
        boostSrc.loop = true;
        const f = c.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = 1300;
        f.Q.value = 0.9;
        const boost = c.createGain();
        boost.gain.value = 0;
        boostSrc.connect(f).connect(boost).connect(this.master);
        boostSrc.start(0, Math.random());
        v = { src, gain, boost, boostSrc, seen: true };
        this.voices.set(car.id, v);
      }
      v.seen = true;
      const k = car.near * car.near;
      v.src.playbackRate.setTargetAtTime(0.55 + Math.min(1.25, car.speed / 1700) * 0.7, t, 0.1);
      v.gain.gain.setTargetAtTime(0.06 * k, t, 0.12);
      v.boost.gain.setTargetAtTime(car.boosting ? 0.14 * k : 0, t, 0.05);
    }
    for (const [id, v] of this.voices) {
      if (v.seen) continue;
      v.gain.gain.setTargetAtTime(0, t, 0.1);
      v.boost.gain.setTargetAtTime(0, t, 0.1);
      v.src.stop(t + 0.5);
      v.boostSrc.stop(t + 0.5);
      this.voices.delete(id);
    }
  }

  // ---------------------------------------------------------------- music

  setMusicEnabled(on: boolean): void {
    this.musicOn = on;
    if (this.musicBus && this.ctx) this.musicBus.gain.setTargetAtTime(on ? 0.32 : 0, this.ctx.currentTime, 0.3);
  }

  /** Switch the background loop (null = stop). */
  music(track: MusicTrack | null): void {
    if (track === this.track) return;
    this.track = track;
    clearInterval(this.musicTimer);
    this.musicTimer = 0;
    if (track && this.ctx) this.startMusic();
  }

  private startMusic(): void {
    clearInterval(this.musicTimer);
    this.musicStep = 0;
    this.musicNext = this.ctx!.currentTime + 0.1;
    // Look-ahead scheduler: queue notes ~0.25 s ahead every 80 ms.
    this.musicTimer = window.setInterval(() => this.scheduleMusic(), 80);
  }

  private scheduleMusic(): void {
    const c = this.ctx;
    const tr = this.track;
    if (!c || !tr || !this.musicBus) return;
    const M = MUSIC[tr];
    const stepDur = 60 / M.bpm / 4;
    if (this.musicNext < c.currentTime - 0.5) this.musicNext = c.currentTime + 0.05;
    while (this.musicNext < c.currentTime + 0.25) {
      const step = this.musicStep % 16;
      const bar = Math.floor(this.musicStep / 16) % M.chords.length;
      const chord = M.chords[bar]!;
      const t = this.musicNext;
      const hz = (n: number) => 440 * 2 ** ((M.key + n - 69) / 12);
      if (M.kick[step] === 'x') this.mNote(t, 'sine', 120, 0.22, 0.5, 0.3);
      if (M.snare[step] === 'x') this.mNoise(t, 0.16, 1800, 0.12);
      if (M.hat[step] === 'x') this.mNoise(t, 0.04, 8000, 0.05, 'highpass');
      if (M.bass[step] === 'x') this.mNote(t, 'sawtooth', hz(chord[0]! - 12), stepDur * 1.8, 0.08, 1, 600);
      if (step === 0) for (const n of chord) this.mNote(t, 'triangle', hz(n + 12), stepDur * 15, 0.025, 1, 1800, 0.25);
      if (M.arp && step % 2 === 0) this.mNote(t, 'square', hz(chord[(step / 2) % chord.length]! + 24), stepDur * 1.5, 0.018, 1, 2600);
      if (!M.arp && step % 4 === 2) this.mNote(t, 'square', hz(chord[(step / 4 | 0) % chord.length]! + 24), stepDur * 1.2, 0.015, 1, 2200);
      this.musicNext += stepDur;
      this.musicStep++;
    }
  }

  private mNote(t: number, type: OscillatorType, freq: number, dur: number, vol: number, slide = 1, lp = 0, attack = 0.005): void {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide !== 1) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur * 0.6);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let out: AudioNode = o;
    if (lp) {
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lp;
      out = o.connect(f);
    }
    out.connect(g).connect(this.musicBus!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private mNoise(t: number, dur: number, freq: number, vol: number, type: BiquadFilterType = 'bandpass'): void {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.musicBus!);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
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
  /** Explosion, the scoring team's horn (blue: low minor, orange: bright major), crowd roar. */
  goal(team: 0 | 1 = 0): void {
    this.burst(1.6, 300, 0.4, 1, 'lowpass', 0, 0.2);
    this.tone(48, 1.2, 'sine', 0.8, 0.5);
    const horn = team === 0 ? [196, 233, 294] : [262, 330, 392];
    for (const f of horn) this.tone(f, 1.6, 'sawtooth', 0.075, 0.98, 0.15);
    this.tone(horn[0]! / 2, 1.8, 'square', 0.05, 0.99, 0.15);
    this.burst(4, 1100, 0.5, 0.5 * Math.max(0.3, this.amb.crowd), 'bandpass', 0.1, 0.8);
    this.crowdLevel = 0.6;
  }
  /** Replay: a slow-motion boom as the ball crosses the line. */
  sting(): void {
    this.tone(70, 2.4, 'sine', 0.7, 0.35);
    this.tone(140, 1.8, 'triangle', 0.18, 0.4, 0.02);
    this.burst(2.6, 500, 0.5, 0.6, 'lowpass', 0, 0.12);
    this.burst(3, 2400, 0.3, 0.12, 'bandpass', 0.05, 0.3);
  }
  /** Kickoff "GO!": the crowd roars. */
  roar(): void {
    this.burst(2.2, 950, 0.5, 0.35 * Math.max(0.25, this.amb.crowd), 'bandpass', 0, 0.85);
    this.crowdLevel = Math.max(this.crowdLevel, 0.35);
  }
  /** Flip reset: a bright double ping. */
  ping(): void {
    this.tone(1760, 0.12, 'sine', 0.12);
    this.tone(2637, 0.22, 'sine', 0.1, 1, 0.07);
  }
  /** Heavy landing thud. */
  land(strength: number, near: number): void {
    const v = Math.min(1, strength) * near;
    if (v < 0.05) return;
    this.tone(62, 0.22, 'sine', 0.45 * v, 0.55);
    this.burst(0.18, 260, 0.8, 0.35 * v, 'lowpass');
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
    this.others([]);
    this.slide(0);
  }
}
