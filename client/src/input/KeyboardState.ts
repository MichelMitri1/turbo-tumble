function isTextField(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

/**
 * Global keyboard tracker. Records held keys plus keys pressed since the last
 * `endFrame()` so per-frame edge detection works regardless of tick rate.
 */
export class KeyboardState {
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  /** When set, the next key press is captured (for rebinding) instead of played. */
  private captureCallback: ((code: string) => void) | null = null;
  lastActivity = 0;

  constructor(private readonly target: Window = window) {
    target.addEventListener('keydown', this.onDown);
    target.addEventListener('keyup', this.onUp);
    target.addEventListener('blur', this.onBlur);
  }

  private readonly onDown = (e: KeyboardEvent): void => {
    // Typing into a text field (player name, room code) isn't game input — except Enter / Escape.
    if (isTextField(e.target) && e.code !== 'Enter' && e.code !== 'Escape') return;
    if (this.captureCallback) {
      e.preventDefault();
      const cb = this.captureCallback;
      this.captureCallback = null;
      cb(e.code);
      return;
    }
    // Stop the page from scrolling / Safari quick-find on game keys.
    if (e.code.startsWith('Arrow') || e.code === 'Space' || e.code === 'Slash' || e.code === 'Backspace') e.preventDefault();
    if (e.repeat) return;
    this.down.add(e.code);
    this.pressed.add(e.code);
    this.lastActivity = performance.now();
  };

  private readonly onUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
  };

  private readonly onBlur = (): void => {
    this.down.clear();
  };

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  anyPressed(): boolean {
    return this.pressed.size > 0;
  }

  /** Capture the next key (used by the rebinding UI). */
  captureNextKey(cb: (code: string) => void): void {
    this.captureCallback = cb;
  }

  endFrame(): void {
    this.pressed.clear();
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.onDown);
    this.target.removeEventListener('keyup', this.onUp);
    this.target.removeEventListener('blur', this.onBlur);
  }
}
