import type { AudioEngine, Spatial } from './AudioEngine';
import { EngineDynamics } from './EngineDynamics';
import type { EngineProfile } from './EngineProfiles';

export interface EngineInput {
  speed01: number;
  load: number;
  throttle: number;
  /** Countdown, stationary revving or unloaded wheels in a jump. */
  freeRev: boolean;
  drifting: boolean;
  grounded: boolean;
  offroad: boolean;
  boost: number;
  stunned: boolean;
}

const SMOOTH = 0.035;
const sampleCache = new WeakMap<BaseAudioContext, Map<string, Promise<AudioBuffer>>>();

function loadSample(ctx: BaseAudioContext, url: string): Promise<AudioBuffer> {
  let cache = sampleCache.get(ctx);
  if (!cache) { cache = new Map(); sampleCache.set(ctx, cache); }
  let pending = cache.get(url);
  if (!pending) {
    pending = fetch(import.meta.env.BASE_URL + url).then((r) => {
      if (!r.ok) throw new Error(`Engine sample ${url}: ${r.status}`);
      return r.arrayBuffer();
    }).then((data) => ctx.decodeAudioData(data));
    cache.set(url, pending);
  }
  return pending;
}

/** Exhaust pulses for one bank; no borrowed recordings are used by this generator. */
function exhaustWave(ctx: BaseAudioContext, events: readonly number[], rasp: number): PeriodicWave {
  const real = new Float32Array(65);
  const imag = new Float32Array(65);
  for (let h = 1; h < real.length; h++) {
    const rolloff = Math.exp(-h / (11 + rasp * 30)) / Math.pow(h, 0.45);
    for (let i = 0; i < events.length; i++) {
      const phase = events[i]! * Math.PI * 2 * h;
      const weight = 1 + Math.sin(i * 2.17) * rasp * 0.13;
      real[h] = real[h]! + Math.cos(phase) * rolloff * weight;
      imag[h] = imag[h]! + Math.sin(phase) * rolloff * weight;
    }
  }
  return ctx.createPeriodicWave(real, imag);
}

/** Per-kart exhaust banks, intake, induction and overrun, driven by an audio-only gearbox. */
export class EngineVoice {
  readonly dynamics: EngineDynamics;
  /** Resolves once any real recordings are loaded (or failed and fell back). */
  readonly ready: Promise<void>;
  private readonly nodes: AudioNode[] = [];
  private readonly sources: AudioScheduledSourceNode[] = [];
  private readonly banks: OscillatorNode[] = [];
  private readonly intake: OscillatorNode;
  private readonly induction: OscillatorNode;
  private readonly intakeGain: GainNode;
  private readonly inductionGain: GainNode;
  private readonly synth: GainNode;
  private readonly filter: BiquadFilterNode;
  private readonly body: GainNode;
  private readonly squeal: GainNode;
  private readonly squealFilter: BiquadFilterNode;
  private readonly wind: GainNode;
  private readonly rumble: GainNode;
  private readonly combustion: GainNode;
  private readonly pops: GainNode;
  private readonly out: GainNode;
  private readonly panner: StereoPannerNode;
  private readonly loops: Array<{ source: AudioBufferSourceNode; gain: GainNode; rpm: number }> = [];
  private time = 0;
  private disposed = false;

  constructor(
    private readonly audio: AudioEngine,
    private readonly local: boolean,
    readonly profile: EngineProfile,
    private readonly variation = 1,
  ) {
    this.dynamics = new EngineDynamics(profile.tuning);
    const ctx = audio.ctx!;
    const mk = <T extends AudioNode>(n: T): T => { this.nodes.push(n); return n; };
    this.panner = mk(ctx.createStereoPanner());
    this.out = mk(ctx.createGain());
    this.out.gain.value = 0;
    this.out.connect(this.panner).connect(audio.bus('engine'));
    this.filter = mk(ctx.createBiquadFilter());
    this.filter.type = 'lowpass';
    this.filter.Q.value = 0.65;
    this.body = mk(ctx.createGain());
    this.body.gain.value = 0;
    this.filter.connect(this.body).connect(this.out);
    this.synth = mk(ctx.createGain());
    this.synth.connect(this.filter);
    profile.banks.forEach((events, i) => {
      const osc = mk(ctx.createOscillator());
      osc.setPeriodicWave(exhaustWave(ctx, events, profile.rasp));
      const gain = mk(ctx.createGain());
      gain.gain.value = i === 0 ? 0.7 : 0.62;
      osc.connect(gain).connect(this.synth);
      osc.start();
      this.sources.push(osc);
      this.banks.push(osc);
    });
    const tone = (type: OscillatorType): [OscillatorNode, GainNode] => {
      const osc = mk(ctx.createOscillator());
      osc.type = type;
      const gain = mk(ctx.createGain()); gain.gain.value = 0;
      osc.connect(gain).connect(this.synth);
      osc.start(); this.sources.push(osc);
      return [osc, gain];
    };
    [this.intake, this.intakeGain] = tone('triangle');
    [this.induction, this.inductionGain] = tone('sine');
    const noiseLayer = (type: BiquadFilterType, freq: number, q: number): [GainNode, BiquadFilterNode] => {
      const src = mk(ctx.createBufferSource());
      src.buffer = audio.noise; src.loop = true;
      const f = mk(ctx.createBiquadFilter()); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = mk(ctx.createGain()); g.gain.value = 0;
      src.connect(f).connect(g).connect(this.out);
      src.start(ctx.currentTime, Math.random() * (audio.noise.duration - 0.1));
      this.sources.push(src);
      return [g, f];
    };
    [this.squeal, this.squealFilter] = noiseLayer('bandpass', 2400, 9);
    [this.wind] = noiseLayer('bandpass', 1100, 0.6);
    [this.rumble] = noiseLayer('lowpass', 260, 1);
    [this.combustion] = noiseLayer('bandpass', 700 + profile.rasp * 700, 0.7);
    [this.pops] = noiseLayer('lowpass', 1800, 0.8);
    this.ready = profile.samples?.length ? this.loadRecordings() : Promise.resolve();
  }

  private async loadRecordings(): Promise<void> {
    const ctx = this.audio.ctx!;
    try {
      const samples = [...this.profile.samples!].sort((a, b) => a.rpm - b.rpm);
      const buffers = await Promise.all(samples.map((s) => loadSample(ctx, s.url)));
      if (this.disposed) return;
      samples.forEach((sample, i) => {
        const src = ctx.createBufferSource();
        src.buffer = buffers[i]!; src.loop = true;
        src.loopStart = sample.loopStart ?? 0;
        src.loopEnd = sample.loopEnd ?? src.buffer.duration;
        const gain = ctx.createGain(); gain.gain.value = 0;
        src.connect(gain).connect(this.filter); src.start();
        this.nodes.push(src, gain); this.sources.push(src);
        this.loops.push({ source: src, gain, rpm: sample.rpm });
      });
    } catch (error) {
      console.warn('Engine recordings unavailable; using the designed voice.', error);
    }
  }

  /** `atTime` also supports deterministic offline audio renders. */
  update(input: EngineInput, spatial: Spatial, dt: number, atTime?: number): void {
    if (this.disposed) return;
    const ctx = this.audio.ctx!;
    const t = atTime ?? ctx.currentTime;
    this.time += dt;
    const set = (p: AudioParam, v: number, k = SMOOTH): void => { p.setTargetAtTime(v, t, k); };
    this.dynamics.update(input, dt);
    const p = this.profile;
    const rpm = this.dynamics.rpm;
    const rev = Math.max(0, (rpm - p.tuning.idle) / (p.tuning.redline - p.tuning.idle));
    const boost = Math.min(1.3, input.boost);
    const load = Math.min(1, input.load + boost * 0.15);
    const wobble = 1 + Math.sin(this.time * 13.3) * 0.003 + Math.sin(this.time * 5.7) * 0.002;
    for (const bank of this.banks) set(bank.frequency, rpm / 120 * this.variation * wobble);
    const cylinders = p.banks[0].length + p.banks[1].length;
    set(this.intake.frequency, rpm / 120 * cylinders * this.variation);
    set(this.induction.frequency, 350 + rpm * 0.27);
    set(this.intakeGain.gain, p.intake * (0.08 + rev * 0.32) * (0.3 + load * 0.7));
    set(this.inductionGain.gain, p.whine * load * rev);
    set(this.filter.frequency, 450 + p.brightness * (0.12 + rev * 0.6 + load * 0.28));
    const shifting = this.dynamics.shift > 0 ? 0.55 : 1;
    const limiter = rev > 0.93 && input.throttle > 0.9 ? (Math.sin(this.time * 65) > 0 ? 0.72 : 1) : 1;
    const level = this.local ? 1 : 0.72;
    set(this.body.gain, (0.14 + load * 0.2 + rev * 0.06 + p.bass * 0.04) * level * shifting * limiter);
    set(this.combustion.gain, this.loops.length ? 0 : p.rasp * (0.006 + load * rev * 0.045) * level);
    set(this.pops.gain, this.dynamics.lift > 0 && Math.sin(this.time * 91) > 0.45 ? p.crackle * 0.22 * level : 0, 0.008);
    if (this.loops.length) {
      // Hybrid: the real recordings cover the RPM band they were recorded in (a wide
      // margin either side); the designed voice fills in idle / extreme revs.
      const lo = this.loops[0]!.rpm;
      const hi = this.loops[this.loops.length - 1]!.rpm;
      const ramp = (e0: number, e1: number, v: number): number => Math.max(0, Math.min(1, (v - e0) / (e1 - e0)));
      const real = ramp(lo * 0.42, lo * 0.7, rpm) * (1 - ramp(hi * 1.75, hi * 2.3, rpm));
      set(this.synth.gain, 1 - real * 0.9, 0.08);
      let upper = this.loops.findIndex((s) => s.rpm >= rpm);
      if (upper < 0) upper = this.loops.length - 1;
      const lower = Math.max(0, upper - 1);
      const a = this.loops[lower]!, b = this.loops[upper]!;
      const mix = upper === lower ? 0 : Math.max(0, Math.min(1, (rpm - a.rpm) / (b.rpm - a.rpm)));
      this.loops.forEach((s, i) => {
        set(s.source.playbackRate, Math.max(0.4, Math.min(2.6, rpm / s.rpm)) * this.variation);
        const w = i === lower ? Math.cos(mix * Math.PI / 2) : i === upper ? Math.sin(mix * Math.PI / 2) : 0;
        set(s.gain.gain, w * real * (0.75 + load * 0.45) * level * shifting * limiter);
      });
    }
    const sliding = input.drifting && input.grounded;
    set(this.squeal.gain, sliding ? (0.07 + 0.05 * input.speed01) * level : 0, sliding ? 0.03 : 0.08);
    if (sliding) set(this.squealFilter.frequency, 2200 + Math.sin(this.time * 7) * 260);
    set(this.wind.gain, input.speed01 ** 2 * 0.035 * (this.local ? 1 : 0.4) + boost * 0.02);
    set(this.rumble.gain, input.offroad && input.grounded ? Math.min(1, input.speed01 * 2) * 0.15 * level : 0);
    set(this.out.gain, spatial.gain, 0.06);
    set(this.panner.pan, spatial.pan, 0.06);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const ctx = this.audio.ctx!;
    this.out.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
    setTimeout(() => {
      for (const s of this.sources) { try { s.stop(); } catch { /* already stopped */ } }
      for (const n of this.nodes) n.disconnect();
    }, 200);
  }
}
