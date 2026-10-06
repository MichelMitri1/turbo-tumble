/** Fullscreen toggle shared by the arcade hub and the games (with Safari's prefixed API). */
type FsDocument = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> };
type FsElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };

const doc = document as FsDocument;

export const fullscreenSupported = (): boolean => Boolean(document.fullscreenEnabled ?? (document.documentElement as FsElement).webkitRequestFullscreen);

export const isFullscreen = (): boolean => Boolean(document.fullscreenElement ?? doc.webkitFullscreenElement);

export function toggleFullscreen(): void {
  const root = document.documentElement as FsElement;
  const p = isFullscreen() ? (document.exitFullscreen ?? doc.webkitExitFullscreen)?.call(document) : (root.requestFullscreen ?? root.webkitRequestFullscreen)?.call(root);
  void p?.catch(() => undefined); // refused outside a click / key press
}

/** Keep a button's label in sync: `labels` = [windowed, fullscreen]. Hidden where unsupported (iPhone). */
export function bindFullscreenButton(button: HTMLElement, labels: [string, string] = ['⛶ Fullscreen', '⛶ Exit Fullscreen']): void {
  if (!fullscreenSupported()) {
    button.style.display = 'none';
    return;
  }
  const sync = () => (button.textContent = labels[isFullscreen() ? 1 : 0]);
  button.addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', sync);
  document.addEventListener('webkitfullscreenchange', sync);
  sync();
}

/** F toggles fullscreen anywhere except while typing. */
export function installFullscreenKey(): void {
  addEventListener('keydown', (e) => {
    if (e.code !== 'KeyF' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    toggleFullscreen();
  });
}
