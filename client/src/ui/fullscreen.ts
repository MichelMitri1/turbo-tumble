/**
 * Fullscreen shared by the arcade hub and the games (with Safari's prefixed API).
 *
 * - Ctrl+F (⌘F on Mac) toggles it.
 * - The hub and each game are separate pages, and browsers always drop fullscreen
 *   when a page loads. So we remember that the player wanted fullscreen and put it
 *   back on their first click / key press in the next page (browsers only allow
 *   entering fullscreen from a user gesture).
 * - While fullscreen, Esc is kept for the game (pause / back) instead of exiting:
 *   hold Esc (Chrome / Edge) or press Ctrl+F to leave.
 */
type FsDocument = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> };
type FsElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
type KeyboardLock = { lock?: (keys?: string[]) => Promise<void>; unlock?: () => void };

const doc = document as FsDocument;
const WANT_KEY = 'arcade:fullscreen';

export const fullscreenSupported = (): boolean => Boolean(document.fullscreenEnabled ?? (document.documentElement as FsElement).webkitRequestFullscreen);

export const isFullscreen = (): boolean => Boolean(document.fullscreenElement ?? doc.webkitFullscreenElement);

const keyboard = (): KeyboardLock | undefined => (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard;

function setWanted(on: boolean): void {
  try {
    if (on) sessionStorage.setItem(WANT_KEY, '1');
    else sessionStorage.removeItem(WANT_KEY);
  } catch {
    /* storage blocked */
  }
}
function wanted(): boolean {
  try {
    return sessionStorage.getItem(WANT_KEY) === '1';
  } catch {
    return false;
  }
}

function enter(): void {
  const root = document.documentElement as FsElement;
  void (root.requestFullscreen ?? root.webkitRequestFullscreen)?.call(root)?.catch(() => undefined); // refused outside a click / key press
}

export function toggleFullscreen(): void {
  if (isFullscreen()) {
    setWanted(false);
    void (document.exitFullscreen ?? doc.webkitExitFullscreen)?.call(document)?.catch(() => undefined);
  } else enter();
}

let initialized = false;
let leaving = false;
let leavingTimer = 0;
/** About to navigate (if the page is still here shortly after, it didn't). */
function markLeaving(): void {
  leaving = true;
  clearTimeout(leavingTimer);
  leavingTimer = window.setTimeout(() => (leaving = false), 2500);
}

/** Shared setup (idempotent): remember the choice, lock Esc, restore after a page change. */
function init(): void {
  if (initialized) return;
  initialized = true;
  // Leaving the page drops fullscreen, but the player still wants it on the next page.
  addEventListener('pagehide', markLeaving);
  addEventListener('beforeunload', markLeaving);
  // Clicking a link to another page also counts as leaving.
  addEventListener(
    'click',
    (e) => {
      const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (a && a.origin === location.origin && !a.target && !a.href.includes('#') && !(e.ctrlKey || e.metaKey || e.shiftKey)) markLeaving();
    },
    { capture: true },
  );
  const onChange = () => {
    if (isFullscreen()) {
      setWanted(true);
      // Keep Esc for the game (Chromium only; elsewhere Esc still exits).
      void keyboard()?.lock?.(['Escape'])?.catch(() => undefined);
    } else {
      keyboard()?.unlock?.();
      // Exited by the player (not by navigating away): stop restoring it.
      if (!leaving) setWanted(false);
    }
  };
  document.addEventListener('fullscreenchange', onChange);
  document.addEventListener('webkitfullscreenchange', onChange);
  addEventListener('pageshow', () => (leaving = false));

  // Came from a page that was fullscreen: restore it on the first gesture.
  if (wanted() && fullscreenSupported() && !isFullscreen()) {
    const restore = (e: Event) => {
      if (e instanceof KeyboardEvent) {
        // Ctrl+F handles itself; Esc and lone modifiers can't start fullscreen.
        if (isToggleKey(e) || e.code === 'Escape' || ['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
      }
      off();
      if (wanted() && !isFullscreen()) enter();
    };
    const off = () => {
      removeEventListener('pointerdown', restore, true);
      removeEventListener('keydown', restore, true);
    };
    addEventListener('pointerdown', restore, true);
    addEventListener('keydown', restore, true);
  }
}

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
/** Ctrl+F (or ⌘F on Mac). */
const isToggleKey = (e: KeyboardEvent) => e.code === 'KeyF' && (e.ctrlKey || (isMac && e.metaKey)) && !e.altKey && !e.shiftKey;

/** Keep a button's label in sync: `labels` = [windowed, fullscreen]. Hidden where unsupported (iPhone). */
export function bindFullscreenButton(button: HTMLElement, labels: [string, string] = ['⛶ Fullscreen', '⛶ Exit Fullscreen']): void {
  init();
  if (!fullscreenSupported()) {
    button.style.display = 'none';
    return;
  }
  button.title = `Fullscreen (${isMac ? '⌘F / Ctrl+F' : 'Ctrl+F'})`;
  const sync = () => (button.textContent = labels[isFullscreen() ? 1 : 0]);
  button.addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', sync);
  document.addEventListener('webkitfullscreenchange', sync);
  sync();
}

/** Ctrl+F (⌘F on Mac) toggles fullscreen anywhere, instead of the browser's Find. */
export function installFullscreenKey(): void {
  init();
  addEventListener(
    'keydown',
    (e) => {
      if (!isToggleKey(e)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!e.repeat) toggleFullscreen();
    },
    { capture: true },
  );
}
