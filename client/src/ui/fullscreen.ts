import './mobile.css';
import { installArcadeNavigation } from './navigation';

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
type StandaloneNavigator = Navigator & { standalone?: boolean };

const doc = document as FsDocument;
const WANT_KEY = 'arcade:fullscreen';

export const fullscreenSupported = (): boolean => Boolean(document.fullscreenEnabled ?? (document.documentElement as FsElement).webkitRequestFullscreen);

export const isFullscreen = (): boolean => Boolean(document.fullscreenElement ?? doc.webkitFullscreenElement);

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = (): boolean => matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || (navigator as StandaloneNavigator).standalone === true;

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
  const request = root.requestFullscreen;
  if (request) {
    // Android Chrome honours this hint by hiding its navigation UI as well as
    // filling the screen. It is ignored by browsers that do not need it.
    void request.call(root, { navigationUI: 'hide' }).catch(() => undefined); // refused outside a click / key press
  } else {
    void root.webkitRequestFullscreen?.call(root)?.catch(() => undefined);
  }
}

/** iPhone only permits a whole web app without browser chrome from its Home Screen. */
function showIOSFullscreenGuide(): void {
  const old = document.querySelector<HTMLElement>('.arcade-install-guide');
  if (old) {
    old.querySelector<HTMLButtonElement>('.arcade-install-guide__close')?.focus();
    return;
  }

  const guide = document.createElement('div');
  guide.className = 'arcade-install-guide';
  guide.setAttribute('role', 'dialog');
  guide.setAttribute('aria-modal', 'true');
  guide.setAttribute('aria-labelledby', 'arcade-install-title');
  guide.innerHTML = `
    <div class="arcade-install-guide__panel">
      <button class="arcade-install-guide__x" type="button" aria-label="Close">×</button>
      <div class="arcade-install-guide__icon">⛶</div>
      <h2 id="arcade-install-title">Fullscreen on iPhone</h2>
      <ol>
        <li>Tap the <strong>Share</strong> button in Chrome.</li>
        <li>Choose <strong>Add to Home Screen</strong>.</li>
        <li>Open Mitris’ Arcade from the new Home Screen icon.</li>
      </ol>
      <p>iOS only removes all browser controls when a web app is launched from the Home Screen.</p>
      <button class="arcade-install-guide__close" type="button">Got it</button>
    </div>`;
  const close = () => guide.remove();
  guide.addEventListener('click', (event) => {
    if (event.target === guide || (event.target as Element).closest('.arcade-install-guide__x, .arcade-install-guide__close')) close();
  });
  guide.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });
  document.body.append(guide);
  guide.querySelector<HTMLButtonElement>('.arcade-install-guide__close')?.focus();
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
  installArcadeNavigation();
  // `manipulation` keeps ordinary panning/pinch gestures but tells mobile
  // browsers that a quick second tap is not a request to zoom the page.
  document.documentElement.style.touchAction = 'manipulation';
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

/** Keep a button's label in sync: `labels` = [windowed, fullscreen]. */
export function bindFullscreenButton(button: HTMLElement, labels: [string, string] = ['⛶ Fullscreen', '⛶ Exit Fullscreen']): void {
  init();
  if (!fullscreenSupported()) {
    if (isIOS && !isStandalone()) {
      button.textContent = labels[0];
      button.title = 'How to use fullscreen on iPhone';
      button.addEventListener('click', showIOSFullscreenGuide);
      return;
    }
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
