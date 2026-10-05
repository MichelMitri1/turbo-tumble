import { AudioEngine } from './AudioEngine';
import { MusicPlayer } from './music/MusicPlayer';
import { GARAGE_GROOVE } from './music/songs';
import { SoundBoard } from './SoundBoard';
import type { SfxName } from './sfx';

/** The game's audio services: engine (buses, settings), sound effects, music. */
export class GameAudio {
  readonly engine = new AudioEngine();
  readonly sfx = new SoundBoard(this.engine);
  readonly music = new MusicPlayer(this.engine);
  private wantsMenuMusic = false;

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
    this.wantsMenuMusic = false;
  }

  toggleMute(): boolean {
    this.engine.setMuted(!this.engine.settings.muted);
    return this.engine.settings.muted;
  }
}
