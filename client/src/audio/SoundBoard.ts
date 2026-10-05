import type { Vector3 } from 'three';
import type { AudioEngine } from './AudioEngine';
import { SFX, isUiSound, type SfxName, type SfxParams } from './sfx';

export interface PlayOptions extends SfxParams {
  /** World position for distance/pan (omit = centred, e.g. your own kart). */
  at?: Vector3 | null;
  /** Extra gain multiplier. */
  volume?: number;
  /** Pitch multiplier (1 = as designed). Random ±3% is added for variety. */
  pitch?: number;
  /** Override the per-sound repeat guard (seconds). */
  minGap?: number;
}

/** Most sounds won't retrigger faster than this (stacked identical sounds just get loud). */
const DEFAULT_MIN_GAP = 0.04;
const MAX_VOICES_PER_SECOND = 90;
const RELEASE_AFTER_MS = 2600;

/** Plays named one-shot sound effects through the audio engine. */
export class SoundBoard {
  private readonly last = new Map<SfxName, number>();
  private recent: number[] = [];

  constructor(private readonly audio: AudioEngine) {}

  play(name: SfxName, opts: PlayOptions = {}): void {
    const audio = this.audio;
    const ctx = audio.ctx;
    if (!ctx || !audio.running) return;
    const now = ctx.currentTime;
    const gap = opts.minGap ?? DEFAULT_MIN_GAP;
    if (now - (this.last.get(name) ?? -1) < gap) return;

    const { gain, pan } = audio.spatial(opts.at ?? null);
    const volume = gain * (opts.volume ?? 1);
    if (volume < 0.02) return;

    this.recent = this.recent.filter((t) => now - t < 1);
    if (this.recent.length >= MAX_VOICES_PER_SECOND) return;
    this.recent.push(now);
    this.last.set(name, now);
    audio.voices = this.recent.length;

    const out = ctx.createGain();
    out.gain.value = volume;
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    out.connect(panner).connect(audio.bus(isUiSound(name) ? 'ui' : 'sfx'));
    SFX[name]({ ctx, out, t: now + 0.005, noise: audio.noise, pitch: (opts.pitch ?? 1) * (0.97 + Math.random() * 0.06) }, opts);
    setTimeout(() => {
      out.disconnect();
      panner.disconnect();
    }, RELEASE_AFTER_MS + (name === 'crowdCheer' || name === 'zap' || name === 'jetRocket' ? 1500 : 0));
  }
}
