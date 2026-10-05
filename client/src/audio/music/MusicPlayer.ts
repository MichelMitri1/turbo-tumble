import type { AudioEngine } from '../AudioEngine';
import { INSTRUMENTS } from '../synth';
import { SONG_TRIM, compileSong, stepSeconds, type CompiledSong, type SongSpec } from './Song';

const LOOKAHEAD = 0.15;
const TICK_MS = 25;

interface Playback {
  song: CompiledSong;
  gain: GainNode;
  section: number;
  bar: number;
  step: number;
  nextTime: number;
  done: boolean;
  onEnd: (() => void) | null;
}

/**
 * Look-ahead step sequencer for SongSpec data. One main song at a time (with
 * crossfades) plus one-shot stingers on top; tempo and transpose can change
 * live (final lap).
 */
export class MusicPlayer {
  private current: Playback | null = null;
  private sting: Playback | null = null;
  private readonly compiled = new Map<string, CompiledSong>();
  private timer = 0;
  tempoMul = 1;
  transpose = 0;

  constructor(private readonly audio: AudioEngine) {}

  get playingId(): string | null {
    return this.current?.done === false ? this.current.song.spec.id : null;
  }

  private compile(spec: SongSpec): CompiledSong {
    let c = this.compiled.get(spec.id);
    if (!c) this.compiled.set(spec.id, (c = compileSong(spec)));
    return c;
  }

  private start(spec: SongSpec, fadeIn: number, onEnd: (() => void) | null): Playback | null {
    const ctx = this.audio.ctx;
    if (!ctx) return null;
    const gain = ctx.createGain();
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(fadeIn > 0 ? 0.0001 : 1, t);
    if (fadeIn > 0) gain.gain.exponentialRampToValueAtTime(1, t + fadeIn);
    gain.connect(this.audio.bus('music'));
    if (!this.timer) this.timer = window.setInterval(() => this.schedule(), TICK_MS);
    return { song: this.compile(spec), gain, section: 0, bar: 0, step: 0, nextTime: t + 0.06, done: false, onEnd };
  }

  /** Switch the main music (no-op if it's already playing). */
  play(spec: SongSpec, opts: { fadeIn?: number; restart?: boolean } = {}): void {
    if (!opts.restart && this.playingId === spec.id) return;
    this.stop(0.5);
    this.tempoMul = 1;
    this.transpose = 0;
    this.current = this.start(spec, opts.fadeIn ?? 0.4, null);
  }

  /** One-shot jingle over (or instead of) the main music. */
  stinger(spec: SongSpec, onEnd?: () => void): void {
    if (this.sting) this.release(this.sting, 0.1);
    this.sting = this.start(spec, 0, onEnd ?? null);
  }

  stop(fade = 0.6): void {
    if (this.current) this.release(this.current, fade);
    this.current = null;
  }

  private release(p: Playback, fade: number): void {
    const ctx = this.audio.ctx!;
    p.done = true;
    p.gain.gain.cancelScheduledValues(ctx.currentTime);
    p.gain.gain.setTargetAtTime(0.0001, ctx.currentTime, Math.max(0.01, fade / 4));
    setTimeout(() => p.gain.disconnect(), fade * 1000 + 1500);
  }

  private schedule(): void {
    const ctx = this.audio.ctx;
    if (!ctx) return;
    const horizon = ctx.currentTime + LOOKAHEAD;
    for (const p of [this.current, this.sting]) {
      if (!p || p.done) continue;
      // Suspended context (tab hidden / not unlocked yet): don't pile up a backlog.
      if (p.nextTime < ctx.currentTime - 0.25) p.nextTime = ctx.currentTime + 0.05;
      while (!p.done && p.nextTime < horizon) this.playStep(p);
    }
    if (this.sting?.done) this.sting = null;
    if (!this.current && !this.sting) {
      clearInterval(this.timer);
      this.timer = 0;
    }
  }

  private playStep(p: Playback): void {
    const spec = p.song.spec;
    const sectionName = spec.order[p.section]!;
    const section = spec.sections[sectionName]!;
    const parts = p.song.sections.get(sectionName)!;
    const isStinger = p === this.sting;
    const tempo = isStinger ? 1 : this.tempoMul;
    const transpose = isStinger ? 0 : this.transpose;
    const step = stepSeconds(spec, tempo);
    const swing = p.step % 2 === 1 ? (spec.swing ?? 0) * step : 0;

    for (const [part, bars] of parts) {
      const events = bars[p.bar % bars.length]!;
      const partSpec = spec.parts[part]!;
      const inst = INSTRUMENTS[partSpec.instrument];
      if (!inst) continue;
      for (const e of events) {
        if (e.step !== p.step) continue;
        for (const midi of e.midi) {
          inst(
            { ctx: this.audio.ctx!, out: p.gain, t: p.nextTime + swing, noise: this.audio.noise, pitch: 1 },
            midi ? midi + transpose : 0,
            e.steps * step * 0.95,
            e.velocity * partSpec.gain * SONG_TRIM,
          );
        }
      }
    }

    p.nextTime += step;
    if (++p.step < 16) return;
    p.step = 0;
    if (++p.bar < section.bars) return;
    p.bar = 0;
    if (++p.section < spec.order.length) return;
    if (spec.loopFrom !== undefined) {
      p.section = spec.loopFrom;
      return;
    }
    // One-shot finished: let the tail ring out.
    p.done = true;
    const onEnd = p.onEnd;
    const ctx = this.audio.ctx!;
    setTimeout(() => onEnd?.(), Math.max(0, (p.nextTime - ctx.currentTime) * 1000));
    setTimeout(() => p.gain.disconnect(), Math.max(0, (p.nextTime - ctx.currentTime) * 1000) + 2500);
  }
}
