import type { AudioEngine, Spatial } from './AudioEngine';

export interface EngineInput {
  /** |speed| / top speed. */
  speed01: number;
  /** 0..1 how hard the engine is working (throttle, or estimated from acceleration). */
  load: number;
  drifting: boolean;
  grounded: boolean;
  offroad: boolean;
  /** 0 none, 1 boost, >1 rocket. */
  boost: number;
  /** Spinning / tumbling: engine bogs down. */
  stunned: boolean;
}

const SMOOTH = 0.045;

/**
 * Continuous synthesised kart engine: a growly sawtooth + sub-octave square
 * through a load-driven low-pass, plus tyre squeal (drift), wind (speed) and
 * off-road rumble layers. Pitch follows speed, brightness follows throttle.
 */
export class EngineVoice {
  private readonly nodes: AudioNode[] = [];
  private readonly sources: AudioScheduledSourceNode[] = [];
  private readonly saw: OscillatorNode;
  private readonly sub: OscillatorNode;
  private readonly filter: BiquadFilterNode;
  private readonly body: GainNode;
  private readonly squeal: GainNode;
  private readonly squealFilter: BiquadFilterNode;
  private readonly wind: GainNode;
  private readonly rumble: GainNode;
  private readonly out: GainNode;
  private readonly panner: StereoPannerNode;
  private time = Math.random() * 10;

  constructor(
    private readonly audio: AudioEngine,
    /** Own kart: louder and centred. */
    private readonly local: boolean,
    /** Per-kart pitch character (heavier karts lower). */
    private readonly pitch: number,
  ) {
    const ctx = audio.ctx!;
    const mk = <T extends AudioNode>(n: T): T => {
      this.nodes.push(n);
      return n;
    };
    this.panner = mk(ctx.createStereoPanner());
    this.out = mk(ctx.createGain());
    this.out.gain.value = 0;
    this.out.connect(this.panner).connect(audio.bus('engine'));

    // Engine body.
    this.filter = mk(ctx.createBiquadFilter());
    this.filter.type = 'lowpass';
    this.filter.Q.value = 3;
    this.body = mk(ctx.createGain());
    this.body.gain.value = 0;
    this.filter.connect(this.body).connect(this.out);
    this.saw = mk(ctx.createOscillator());
    this.saw.type = 'sawtooth';
    this.sub = mk(ctx.createOscillator());
    this.sub.type = 'square';
    const subGain = mk(ctx.createGain());
    subGain.gain.value = 0.45;
    this.saw.connect(this.filter);
    this.sub.connect(subGain).connect(this.filter);

    // Noise layers.
    const noiseLayer = (type: BiquadFilterType, freq: number, q: number): [GainNode, BiquadFilterNode] => {
      const src = ctx.createBufferSource();
      src.buffer = audio.noise;
      src.loop = true;
      const f = mk(ctx.createBiquadFilter());
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = mk(ctx.createGain());
      g.gain.value = 0;
      src.connect(f).connect(g).connect(this.out);
      src.start(ctx.currentTime, Math.random() * (audio.noise.duration - 0.1));
      this.sources.push(src);
      this.nodes.push(src);
      return [g, f];
    };
    [this.squeal, this.squealFilter] = noiseLayer('bandpass', 2400, 9);
    [this.wind] = noiseLayer('bandpass', 1100, 0.6);
    [this.rumble] = noiseLayer('lowpass', 260, 1);

    const t = ctx.currentTime;
    this.saw.start(t);
    this.sub.start(t);
    this.sources.push(this.saw, this.sub);
  }

  update(input: EngineInput, spatial: Spatial, dt: number): void {
    const ctx = this.audio.ctx!;
    const t = ctx.currentTime;
    this.time += dt;
    const set = (p: AudioParam, v: number, k = SMOOTH): void => {
      p.setTargetAtTime(v, t, k);
    };

    const boost = Math.min(1.3, input.boost);
    const air = input.grounded ? 0 : 1;
    // A little irregular wobble keeps it from sounding like a test tone.
    const wobble = 1 + Math.sin(this.time * 11.3) * 0.012 + Math.sin(this.time * 3.7) * 0.01;
    let f = (52 + 150 * input.speed01 + 28 * boost + 22 * air * input.load) * this.pitch * wobble;
    if (input.stunned) f *= 0.75;
    set(this.saw.frequency, f);
    set(this.sub.frequency, f * 0.5);
    set(this.filter.frequency, 380 + 1500 * input.load + 1100 * input.speed01 + 1600 * boost);

    const level = this.local ? 1 : 0.85;
    set(this.body.gain, (0.09 + 0.1 * input.load + 0.05 * input.speed01 + 0.05 * boost) * level);
    const sliding = input.drifting && input.grounded;
    set(this.squeal.gain, sliding ? (0.07 + 0.05 * input.speed01) * level : 0, sliding ? 0.03 : 0.08);
    if (sliding) set(this.squealFilter.frequency, 2200 + Math.sin(this.time * 7) * 260);
    set(this.wind.gain, input.speed01 * input.speed01 * 0.05 * (this.local ? 1 : 0.4) + boost * 0.03);
    set(this.rumble.gain, input.offroad && input.grounded ? Math.min(1, input.speed01 * 2) * 0.22 * level : 0);

    set(this.out.gain, spatial.gain, 0.06);
    set(this.panner.pan, spatial.pan, 0.06);
  }

  /** Fade out quickly and release the nodes. */
  dispose(): void {
    const ctx = this.audio.ctx!;
    this.out.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
    setTimeout(() => {
      for (const s of this.sources) {
        try {
          s.stop();
        } catch {
          /* already stopped */
        }
      }
      for (const n of this.nodes) n.disconnect();
    }, 200);
  }
}
