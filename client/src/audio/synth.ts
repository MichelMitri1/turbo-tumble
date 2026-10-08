/**
 * Synthesis building blocks shared by sound effects, engines and music. Every
 * function takes a SynthCtx (context + destination + start time) so the same
 * code renders live or into an OfflineAudioContext (tools/audio-check).
 */
export interface SynthCtx {
  ctx: BaseAudioContext;
  out: AudioNode;
  /** Absolute start time (seconds). */
  t: number;
  noise: AudioBuffer;
  /** Pitch multiplier (variation / kart size). */
  pitch: number;
}

export interface FilterOpts {
  type: BiquadFilterType;
  freq: number;
  /** Sweep target over the sound's duration. */
  to?: number;
  q?: number;
}

export interface ToneOpts {
  type?: OscillatorType;
  freq: number;
  /** Exponential pitch sweep target. */
  to?: number;
  /** Offset from SynthCtx.t. */
  at?: number;
  dur: number;
  gain: number;
  attack?: number;
  /** Portion of `dur` spent decaying at the end (default: whole note decays). */
  release?: number;
  detune?: number;
  vibrato?: { rate: number; depth: number; delay?: number };
  filter?: FilterOpts;
  out?: AudioNode;
}

export interface NoiseOpts {
  at?: number;
  dur: number;
  gain: number;
  attack?: number;
  release?: number;
  filter: FilterOpts;
  /** Playback rate of the noise buffer (lower = darker / grainier). */
  rate?: number;
  out?: AudioNode;
}

const SILENT = 0.0001;

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

const NOTE_INDEX: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "C#4" / "Bb3" → MIDI number (C4 = 60). */
export function noteToMidi(name: string): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`Bad note "${name}"`);
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return 12 * (Number(m[3]) + 1) + NOTE_INDEX[m[1]!]! + acc;
}

/** Attack → (hold) → exponential release envelope on a fresh gain node. */
function envelope(c: SynthCtx, start: number, dur: number, peak: number, attack: number, release: number): GainNode {
  const g = c.ctx.createGain();
  // Intrinsic value first: automation only applies from `start`, and a gain of 1
  // on the very first sample is an audible click (worst through high-passes).
  g.gain.value = SILENT;
  const a = Math.min(attack, dur * 0.5);
  const r = Math.min(release, dur - a);
  g.gain.setValueAtTime(SILENT, start);
  g.gain.exponentialRampToValueAtTime(Math.max(SILENT, peak), start + Math.max(0.002, a));
  g.gain.setValueAtTime(Math.max(SILENT, peak), start + dur - r);
  g.gain.exponentialRampToValueAtTime(SILENT, start + dur);
  return g;
}

function makeFilter(c: SynthCtx, f: FilterOpts, start: number, dur: number): BiquadFilterNode {
  const node = c.ctx.createBiquadFilter();
  node.type = f.type;
  node.Q.value = f.q ?? 0.8;
  node.frequency.value = f.freq;
  node.frequency.setValueAtTime(f.freq, start);
  if (f.to !== undefined) node.frequency.exponentialRampToValueAtTime(Math.max(20, f.to), start + dur);
  return node;
}

function cleanup(source: AudioScheduledSourceNode, nodes: AudioNode[]): void {
  source.onended = () => {
    for (const n of nodes) n.disconnect();
  };
}

/** One oscillator note. Returns the end time. */
export function tone(c: SynthCtx, o: ToneOpts): number {
  const start = c.t + (o.at ?? 0);
  const osc = c.ctx.createOscillator();
  osc.type = o.type ?? 'sine';
  const f0 = o.freq * c.pitch;
  osc.frequency.setValueAtTime(f0, start);
  if (o.to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(10, o.to * c.pitch), start + o.dur);
  if (o.detune) osc.detune.value = o.detune;
  const nodes: AudioNode[] = [osc];
  if (o.vibrato) {
    const lfo = c.ctx.createOscillator();
    const depth = c.ctx.createGain();
    lfo.frequency.value = o.vibrato.rate;
    depth.gain.setValueAtTime(0, start);
    depth.gain.linearRampToValueAtTime(f0 * o.vibrato.depth, start + (o.vibrato.delay ?? 0) + 0.05);
    lfo.connect(depth).connect(osc.frequency);
    lfo.start(start);
    lfo.stop(start + o.dur + 0.02);
    nodes.push(lfo, depth);
  }
  const env = envelope(c, start, o.dur, o.gain, o.attack ?? 0.005, o.release ?? o.dur);
  let head: AudioNode = osc;
  if (o.filter) {
    const f = makeFilter(c, o.filter, start, o.dur);
    head.connect(f);
    head = f;
    nodes.push(f);
  }
  head.connect(env).connect(o.out ?? c.out);
  nodes.push(env);
  osc.start(start);
  osc.stop(start + o.dur + 0.02);
  cleanup(osc, nodes);
  return start + o.dur;
}

/** Filtered noise burst. Returns the end time. */
export function noise(c: SynthCtx, o: NoiseOpts): number {
  const start = c.t + (o.at ?? 0);
  const src = c.ctx.createBufferSource();
  src.buffer = c.noise;
  src.loop = true;
  src.playbackRate.value = (o.rate ?? 1) * c.pitch;
  // Random offset so repeated bursts don't sound identical.
  const offset = Math.random() * (c.noise.duration - 0.1);
  const f = makeFilter(c, o.filter, start, o.dur);
  const env = envelope(c, start, o.dur, o.gain, o.attack ?? 0.003, o.release ?? o.dur);
  src.connect(f).connect(env).connect(o.out ?? c.out);
  src.start(start, offset);
  src.stop(start + o.dur + 0.02);
  cleanup(src, [src, f, env]);
  return start + o.dur;
}

export interface VowelOpts {
  at?: number;
  dur: number;
  gain: number;
  /** Voice pitch (Hz) and its glide target. */
  f0: number;
  to?: number;
  /** First two formants (Hz) at the start and the end of the syllable. */
  from: [number, number];
  end?: [number, number];
  out?: AudioNode;
}

/**
 * One sung/voiced syllable: a buzzy source through two swept band-pass formants —
 * enough to read as a cartoon "wa", "oo" or "yeah" without samples.
 */
export function vowel(c: SynthCtx, o: VowelOpts): number {
  const start = c.t + (o.at ?? 0);
  const ctx = c.ctx;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(o.f0 * c.pitch, start);
  if (o.to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(30, o.to * c.pitch), start + o.dur);
  const env = envelope(c, start, o.dur, o.gain, 0.012, o.dur * 0.55);
  // Formants follow head size a little (higher voices → slightly higher formants).
  const size = Math.sqrt(c.pitch);
  const nodes: AudioNode[] = [osc, env];
  [0, 1].forEach((i) => {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = i === 0 ? 5 : 8;
    const f0 = o.from[i]! * size;
    bp.frequency.setValueAtTime(f0, start);
    if (o.end) bp.frequency.exponentialRampToValueAtTime(o.end[i]! * size, start + o.dur);
    const g = ctx.createGain();
    g.gain.value = i === 0 ? 1 : 0.55;
    osc.connect(bp).connect(g).connect(env);
    nodes.push(bp, g);
  });
  env.connect(o.out ?? c.out);
  osc.start(start);
  osc.stop(start + o.dur + 0.02);
  cleanup(osc, nodes);
  return start + o.dur;
}

/** Quick arpeggio / melody of tones (stingers, chimes). */
export function notes(c: SynthCtx, seq: Array<[note: string, at: number, dur: number]>, o: Omit<ToneOpts, 'freq' | 'dur' | 'at'>): number {
  let end = c.t;
  for (const [n, at, dur] of seq) end = Math.max(end, tone(c, { ...o, freq: midiToFreq(noteToMidi(n)), at, dur }));
  return end;
}

// ------------------------------------------------------------------ instruments

/** A music instrument: plays one note (MIDI, or 0 for unpitched drums). */
export type Instrument = (c: SynthCtx, midi: number, dur: number, velocity: number) => void;

export const INSTRUMENTS: Record<string, Instrument> = {
  kick: (c, _m, _d, v) => {
    tone(c, { type: 'sine', freq: 150, to: 42, dur: 0.22, gain: 0.95 * v, release: 0.2 });
    tone(c, { type: 'triangle', freq: 320, to: 80, dur: 0.035, gain: 0.35 * v });
  },
  snare: (c, _m, _d, v) => {
    noise(c, { dur: 0.17, gain: 0.42 * v, filter: { type: 'highpass', freq: 1400 } });
    tone(c, { type: 'triangle', freq: 210, to: 150, dur: 0.09, gain: 0.32 * v });
  },
  clap: (c, _m, _d, v) => {
    for (const at of [0, 0.012, 0.024]) noise(c, { at, dur: 0.06, gain: 0.3 * v, filter: { type: 'bandpass', freq: 1300, q: 1.2 } });
    noise(c, { at: 0.03, dur: 0.16, gain: 0.22 * v, filter: { type: 'bandpass', freq: 1200, q: 1 } });
  },
  hat: (c, _m, _d, v) => {
    noise(c, { dur: 0.045, gain: 0.16 * v, filter: { type: 'highpass', freq: 7500 } });
  },
  crash: (c, _m, _d, v) => {
    noise(c, { dur: 1.3, gain: 0.16 * v, filter: { type: 'highpass', freq: 4200 } });
    noise(c, { dur: 0.4, gain: 0.1 * v, filter: { type: 'bandpass', freq: 2600, q: 0.6 } });
  },
  ohat: (c, _m, _d, v) => {
    noise(c, { dur: 0.2, gain: 0.13 * v, filter: { type: 'highpass', freq: 6500 } });
  },
  bass: (c, m, d, v) => {
    const f = midiToFreq(m);
    tone(c, { type: 'sawtooth', freq: f, dur: d, gain: 0.32 * v, attack: 0.004, release: Math.min(0.12, d), filter: { type: 'lowpass', freq: 1400, to: 380, q: 4 } });
    tone(c, { type: 'sine', freq: f, dur: d, gain: 0.3 * v, release: Math.min(0.1, d) });
  },
  lead: (c, m, d, v) => {
    const f = midiToFreq(m);
    const vib = d > 0.25 ? { rate: 5.5, depth: 0.012, delay: 0.12 } : undefined;
    tone(c, { type: 'square', freq: f, dur: d, gain: 0.085 * v, attack: 0.01, release: Math.min(0.15, d), vibrato: vib, filter: { type: 'lowpass', freq: 3400 } });
    tone(c, { type: 'sawtooth', freq: f, detune: 9, dur: d, gain: 0.05 * v, attack: 0.01, release: Math.min(0.15, d), vibrato: vib, filter: { type: 'lowpass', freq: 2600 } });
  },
  /** Soft electric-piano lead (menu). */
  keys: (c, m, d, v) => {
    const f = midiToFreq(m);
    tone(c, { type: 'triangle', freq: f, dur: Math.max(d, 0.3), gain: 0.2 * v, attack: 0.006, release: Math.max(d, 0.3) });
    tone(c, { type: 'sine', freq: f * 2, dur: 0.25, gain: 0.06 * v });
  },
  pluck: (c, m, d, v) => {
    tone(c, { type: 'square', freq: midiToFreq(m), dur: Math.min(d, 0.16), gain: 0.06 * v, filter: { type: 'lowpass', freq: 4200, to: 700, q: 2 } });
  },
  pad: (c, m, d, v) => {
    const f = midiToFreq(m);
    for (const det of [-7, 0, 7]) tone(c, { type: 'sawtooth', freq: f, detune: det, dur: d, gain: 0.028 * v, attack: Math.min(0.25, d * 0.3), release: Math.min(0.3, d * 0.4), filter: { type: 'lowpass', freq: 1500 } });
  },
  bell: (c, m, d, v) => {
    const f = midiToFreq(m);
    tone(c, { type: 'sine', freq: f, dur: Math.max(d, 0.5), gain: 0.22 * v });
    tone(c, { type: 'sine', freq: f * 2.76, dur: 0.35, gain: 0.06 * v });
  },
  brass: (c, m, d, v) => {
    const f = midiToFreq(m);
    tone(c, { type: 'sawtooth', freq: f, dur: d, gain: 0.12 * v, attack: 0.03, release: Math.min(0.2, d), vibrato: { rate: 5, depth: 0.01, delay: 0.15 }, filter: { type: 'lowpass', freq: 900, to: 2600, q: 1 } });
    tone(c, { type: 'sawtooth', freq: f, detune: -8, dur: d, gain: 0.08 * v, attack: 0.03, release: Math.min(0.2, d), filter: { type: 'lowpass', freq: 2000 } });
  },
};
