/**
 * Padel sound: the hollow "pock" of a foam-core racket (synthesized, harder shots crack louder), the
 * dull turf bounce, the deep thump of the ball off the glass, the rattle of the mesh, the net, the swish
 * of a miss — over a club crowd that applauds the points (Matchday's CC0 crowd recordings).
 */
const FILES = ['crowd', 'cheer', 'ooh'] as const;
type Sfx = (typeof FILES)[number];

export class PadelAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<Sfx, AudioBuffer>();
  private noise: AudioBuffer | null = null;
  private crowd: AudioBufferSourceNode | null = null;
  volume = 0.8;

  async init(): Promise<void> {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(ctx.destination);
    const n = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = n.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = n;
    await Promise.all(
      FILES.map(async (f) => {
        try {
          const res = await fetch(`/assets/football/sfx/${f}.m4a`);
          this.buffers.set(f, await ctx.decodeAudioData(await res.arrayBuffer()));
        } catch {
          /* no file: stay quiet */
        }
      }),
    );
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  /** Quiet club crowd underneath the match. */
  crowdOn(on: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    if (!on) {
      this.crowd?.stop();
      this.crowd = null;
      return;
    }
    const b = this.buffers.get('crowd');
    if (!b || this.crowd) return;
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.loop = true;
    const g = ctx.createGain();
    g.gain.value = 0.12;
    src.connect(g).connect(this.master);
    src.start();
    this.crowd = src;
  }

  private play(name: Sfx, vol: number): void {
    const ctx = this.ctx;
    const b = this.buffers.get(name);
    if (!ctx || !b || !this.master) return;
    const src = ctx.createBufferSource();
    src.buffer = b;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(g).connect(this.master);
    src.start();
  }

  /** A short filtered noise burst plus a decaying tone. */
  private knock(freq: number, q: number, toneHz: number, vol: number, decay: number, toneVol = 0.5): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5, decay + 0.05);
    if (toneHz > 0) {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(toneHz, t);
      o.frequency.exponentialRampToValueAtTime(toneHz * 0.7, t + decay);
      const og = ctx.createGain();
      og.gain.setValueAtTime(vol * toneVol, t);
      og.gain.exponentialRampToValueAtTime(0.0001, t + decay * 0.8);
      o.connect(og).connect(this.master);
      o.start(t);
      o.stop(t + decay);
    }
  }

  hit(power: number, overhead: boolean): void {
    const p = Math.max(0.15, Math.min(1, power));
    this.knock(1500 + p * 700, 2.2, overhead ? 520 : 640, 0.35 + 0.55 * p, 0.07 + 0.03 * p, 0.6);
  }
  bounce(speed: number): void {
    this.knock(380, 1.4, 150, Math.min(0.45, 0.06 + speed / 50), 0.07, 0.8);
  }
  glass(speed: number): void {
    this.knock(260, 1.2, 105, Math.min(0.8, 0.12 + speed / 30), 0.16, 1);
    this.knock(2600, 6, 0, Math.min(0.15, speed / 200), 0.08);
  }
  mesh(speed: number): void {
    const v = Math.min(0.5, 0.08 + speed / 45);
    this.knock(3200, 3, 0, v, 0.28);
    this.knock(4700, 5, 0, v * 0.7, 0.35);
  }
  net(speed: number): void {
    this.knock(700, 0.8, 0, Math.min(0.4, speed / 40), 0.12);
  }
  swish(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.5;
    bp.frequency.setValueAtTime(600, t);
    bp.frequency.exponentialRampToValueAtTime(2400, t + 0.14);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t, 0, 0.2);
  }
  applause(big: boolean): void {
    this.play('cheer', big ? 0.55 : 0.25);
  }
  groan(): void {
    this.play('ooh', 0.3);
  }
}
