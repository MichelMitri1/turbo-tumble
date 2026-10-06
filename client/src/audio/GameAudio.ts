import { AudioEngine } from './AudioEngine';
import { MusicPlayer } from './music/MusicPlayer';
import { GARAGE_GROOVE } from './music/songs';
import { SoundBoard } from './SoundBoard';
import type { SfxName } from './sfx';
import { EngineVoice } from './EngineVoice';
import { getEngineProfile } from './EngineProfiles';
import { getKartBody } from '../config/roster';

/** The game's audio services: engine (buses, settings), sound effects, music. */
export class GameAudio {
  readonly engine = new AudioEngine();
  readonly sfx = new SoundBoard(this.engine);
  readonly music = new MusicPlayer(this.engine);
  private wantsMenuMusic = false;
  private preview: EngineVoice | null = null;
  private previewFrame = 0;

  constructor() {
    // Music requested before the first click starts as soon as audio unlocks.
    this.engine.onUnlock = () => {
      if (this.wantsMenuMusic) this.music.play(GARAGE_GROOVE, { restart: true });
    };
  }

  /** Interface sound (menus, lobby). */
  ui(name: SfxName): void {
    this.sfx.play(name, { minGap: 0.03 });
  }

  menuMusic(): void {
    this.wantsMenuMusic = true;
    this.engine.duckMusic(1);
    this.music.play(GARAGE_GROOVE);
  }

  /** A race took over the music. */
  leaveMenu(): void {
    this.stopEnginePreview();
    this.wantsMenuMusic = false;
  }

  /** One short idle → rev → lift audition; changing karts replaces the last voice. */
  previewEngine(kart: string | null): void {
    this.stopEnginePreview();
    if (!kart || !this.engine.ctx || this.engine.settings.muted) return;
    void this.engine.ctx.resume();
    const voice = this.preview = new EngineVoice(this.engine, true, getEngineProfile(getKartBody(kart).engine));
    this.engine.duckMusic(0.25, 0.1);
    const started = performance.now();
    let previous = started;
    const frame = (now: number): void => {
      if (this.preview !== voice) return;
      const elapsed = (now - started) / 1000;
      if (elapsed > 2.8) { this.stopEnginePreview(); return; }
      const throttle = elapsed < 0.35 ? 0 : elapsed < 1.65 ? Math.min(1, (elapsed - 0.35) / 0.7) : 0;
      voice.update({ speed01: 0, throttle, load: throttle, freeRev: true, grounded: true, drifting: false, offroad: false, boost: 0, stunned: false }, { gain: 0.85, pan: 0 }, Math.min(0.05, (now - previous) / 1000));
      previous = now;
      this.previewFrame = requestAnimationFrame(frame);
    };
    this.previewFrame = requestAnimationFrame(frame);
  }

  stopEnginePreview(): void {
    cancelAnimationFrame(this.previewFrame);
    this.preview?.dispose();
    this.preview = null;
    this.engine.duckMusic(1, 0.2);
  }

  toggleMute(): boolean {
    this.engine.setMuted(!this.engine.settings.muted);
    return this.engine.settings.muted;
  }
}
