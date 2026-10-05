import { Vector3 } from 'three';

export type BusName = 'music' | 'sfx' | 'engine' | 'ui';

export interface AudioSettings {
  /** 0..1 */
  master: number;
  music: number;
  sfx: number;
  muted: boolean;
}

/** An ear in the world: one per local player (split-screen) or the spectator camera. */
export interface Listener {
  position: Vector3;
  /** Camera right vector (for stereo panning). */
  right: Vector3;
}

export interface Spatial {
  gain: number;
  pan: number;
}

const STORAGE_KEY = 'turbo-tumble.audio.v1';
const DEFAULTS: AudioSettings = { master: 0.8, music: 0.7, sfx: 0.85, muted: false };
const NOISE_SECONDS = 2;

function loadSettings(): AudioSettings {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<AudioSettings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

/** White-noise buffer shared by every noise-based sound. */
export function createNoiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const buf = ctx.createBuffer(1, ctx.sampleRate * NOISE_SECONDS, ctx.sampleRate);
  const data = buf.getChannelData(0);
  // Deterministic LCG so offline renders are reproducible.
  let seed = 1234567;
  for (let i = 0; i < data.length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[i] = (seed / 0xffffffff) * 2 - 1;
  }
  return buf;
}

/**
 * Web Audio graph root: buses (music / sfx / engine / ui) → master → limiter →
 * speakers, persisted volume settings, the autoplay unlock, and a simple
 * multi-listener spatialiser (works for split-screen, where Web Audio's single
 * listener can't). Every sound in the game is synthesised — no audio files.
 */
export class AudioEngine {
  readonly ctx: AudioContext | null = null;
  readonly settings: AudioSettings = loadSettings();
  /** Ears for spatial sounds; empty = everything plays centred at full volume. */
  listeners: Listener[] = [];
  noise!: AudioBuffer;
  private master!: GainNode;
  private readonly buses = new Map<BusName, GainNode>();
  private musicDuck!: GainNode;
  private readonly tmp = new Vector3();
  /** Sounds started in the last second (debug). */
  voices = 0;
  onUnlock: (() => void) | null = null;

  constructor() {
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor({ latencyHint: 'interactive' });
    } catch {
      return;
    }
    const ctx = this.ctx;
    this.noise = createNoiseBuffer(ctx);
    // Gentle bus compression keeps explosions + music + 12 engines from clipping.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 8;
    limiter.ratio.value = 6;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.2;
    limiter.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(limiter);
    this.musicDuck = ctx.createGain();
    this.musicDuck.connect(this.master);
    for (const name of ['music', 'sfx', 'engine', 'ui'] as const) {
      const g = ctx.createGain();
      g.connect(name === 'music' ? this.musicDuck : this.master);
      this.buses.set(name, g);
    }
    this.applySettings();
    this.installUnlock();
  }

  get available(): boolean {
    return this.ctx !== null;
  }

  /** True once the browser lets us make sound (after the first click / key press). */
  get running(): boolean {
    return this.ctx?.state === 'running';
  }

  get now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  bus(name: BusName): AudioNode {
    return this.buses.get(name)!;
  }

  /** Browsers start audio suspended until a user gesture. Gamepad presses don't count. */
  private installUnlock(): void {
    const unlock = (): void => {
      if (!this.ctx || this.ctx.state === 'running') return;
      void this.ctx.resume().then(() => {
        if (this.ctx?.state === 'running') {
          for (const ev of ['pointerdown', 'keydown', 'touchend'] as const) window.removeEventListener(ev, unlock, true);
          this.onUnlock?.();
        }
      });
    };
    for (const ev of ['pointerdown', 'keydown', 'touchend'] as const) window.addEventListener(ev, unlock, true);
    unlock();
  }

  // ---------------------------------------------------------------- settings

  setVolume(kind: 'master' | 'music' | 'sfx', value: number): void {
    this.settings[kind] = Math.min(1, Math.max(0, value));
    this.applySettings();
    this.save();
  }

  setMuted(muted: boolean): void {
    this.settings.muted = muted;
    this.applySettings();
    this.save();
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      /* ignore */
    }
  }

  private applySettings(): void {
    if (!this.ctx) return;
    const s = this.settings;
    const t = this.ctx.currentTime;
    // Perceptual-ish curve: slider² so the low end isn't all "loud".
    const curve = (v: number): number => v * v;
    this.master.gain.setTargetAtTime(s.muted ? 0 : curve(s.master), t, 0.02);
    this.buses.get('music')!.gain.setTargetAtTime(curve(s.music), t, 0.02);
    this.buses.get('sfx')!.gain.setTargetAtTime(curve(s.sfx), t, 0.02);
    this.buses.get('engine')!.gain.setTargetAtTime(curve(s.sfx) * 0.8, t, 0.02);
    this.buses.get('ui')!.gain.setTargetAtTime(curve(s.sfx) * 0.7, t, 0.02);
  }

  /** Pause menu / results: pull the music back. 1 = full. */
  duckMusic(level: number, seconds = 0.25): void {
    if (!this.ctx) return;
    this.musicDuck.gain.setTargetAtTime(level, this.ctx.currentTime, seconds / 3);
  }

  // ---------------------------------------------------------------- spatial

  /**
   * Loudness and pan of a world-space sound for the nearest listener.
   * `ref` = distance with full volume; silent beyond `max`.
   */
  spatial(position: Vector3 | null, ref = 10, max = 140): Spatial {
    if (!position || !this.listeners.length) return { gain: 1, pan: 0 };
    let best = 0;
    let pan = 0;
    for (const l of this.listeners) {
      const d = this.tmp.copy(position).sub(l.position);
      const dist = d.length();
      const g = dist <= ref ? 1 : dist >= max ? 0 : Math.pow(ref / dist, 1.1) * (1 - (dist - ref) / (max - ref));
      if (g > best) {
        best = g;
        pan = dist > 0.5 ? d.dot(l.right) / dist : 0;
      }
    }
    // Split-screen: one shared pair of speakers, so keep panning modest.
    const panScale = this.listeners.length > 1 ? 0.35 : 0.8;
    return { gain: best, pan: Math.max(-1, Math.min(1, pan * panScale)) };
  }
}
