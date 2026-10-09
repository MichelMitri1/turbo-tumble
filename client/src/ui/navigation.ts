const FOCUSABLE = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

type Direction = 'up' | 'down' | 'left' | 'right';

const realtimeRoutes = new Set(['/turbo-tumble/', '/boostball/', '/zero-hour/']);
const ownsControllerNavigation = realtimeRoutes.has(location.pathname);

let installed = false;
let cursor: HTMLDivElement | null = null;
let selected: HTMLElement | null = null;
let navigationActive = false;
let previousButtons: boolean[][] = [];
let heldDirection = '';
let repeatAt = 0;

function visible(element: HTMLElement): boolean {
  if (element.closest('[hidden], .hidden, [aria-hidden="true"]')) return false;
  const style = getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 1 && rect.height > 1;
}

function items(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);
}

function ensureCursor(): HTMLDivElement {
  if (cursor) return cursor;
  cursor = document.createElement('div');
  cursor.className = 'arcade-nav-cursor';
  cursor.setAttribute('aria-hidden', 'true');
  cursor.innerHTML = '<span>↵ / A&nbsp; SELECT</span>';
  document.body.append(cursor);
  return cursor;
}

function setNavigationActive(active: boolean): void {
  navigationActive = active;
  document.body.classList.toggle('arcade-nav-active', active);
  if (!active) {
    selected?.classList.remove('arcade-nav-focus');
    selected = null;
    cursor?.classList.remove('is-visible');
  }
}

function select(element: HTMLElement | null, scroll = true): void {
  selected?.classList.remove('arcade-nav-focus');
  selected = element && visible(element) ? element : null;
  if (!selected) {
    cursor?.classList.remove('is-visible');
    return;
  }
  selected.classList.add('arcade-nav-focus');
  selected.focus({ preventScroll: true });
  if (scroll) selected.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  updateCursor();
}

function updateCursor(): void {
  if (!navigationActive) return;
  const active = document.activeElement instanceof HTMLElement && visible(document.activeElement) ? document.activeElement : selected;
  if (!active || !active.matches(FOCUSABLE)) {
    ensureCursor().classList.remove('is-visible');
    return;
  }
  if (active !== selected) {
    selected?.classList.remove('arcade-nav-focus');
    selected = active;
    selected.classList.add('arcade-nav-focus');
  }
  const rect = active.getBoundingClientRect();
  const ring = ensureCursor();
  ring.style.setProperty('--nav-x', `${Math.max(4, rect.left - 5)}px`);
  ring.style.setProperty('--nav-y', `${Math.max(4, rect.top - 5)}px`);
  ring.style.setProperty('--nav-w', `${Math.min(innerWidth - 8, rect.width + 10)}px`);
  ring.style.setProperty('--nav-h', `${Math.min(innerHeight - 8, rect.height + 10)}px`);
  ring.classList.add('is-visible');
}

function move(direction: Direction): void {
  const candidates = items();
  if (!candidates.length) return;
  const current = document.activeElement instanceof HTMLElement && candidates.includes(document.activeElement) ? document.activeElement : selected;
  if (!current || !candidates.includes(current)) {
    select(candidates[0]!);
    return;
  }
  const rect = current.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  let best: HTMLElement | null = null;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    if (candidate === current) continue;
    const next = candidate.getBoundingClientRect();
    const dx = next.left + next.width / 2 - cx;
    const dy = next.top + next.height / 2 - cy;
    const inDirection = direction === 'up' ? dy < -4 : direction === 'down' ? dy > 4 : direction === 'left' ? dx < -4 : dx > 4;
    if (!inDirection) continue;
    const primary = direction === 'up' || direction === 'down' ? Math.abs(dy) : Math.abs(dx);
    const cross = direction === 'up' || direction === 'down' ? Math.abs(dx) : Math.abs(dy);
    const distance = primary + cross * 2.25;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  select(best ?? current);
}

function directionFromPad(pad: Gamepad): Direction | '' {
  if (pad.buttons[12]?.pressed) return 'up';
  if (pad.buttons[13]?.pressed) return 'down';
  if (pad.buttons[14]?.pressed) return 'left';
  if (pad.buttons[15]?.pressed) return 'right';
  const x = pad.axes[0] ?? 0;
  const y = pad.axes[1] ?? 0;
  if (Math.max(Math.abs(x), Math.abs(y)) < 0.62) return '';
  return Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : y > 0 ? 'down' : 'up';
}

function pollGamepads(now: number): void {
  const pads = navigator.getGamepads?.() ?? [];
  let connected = false;
  for (let index = 0; index < pads.length; index++) {
    const pad = pads[index];
    if (!pad?.connected) continue;
    connected = true;
    const before = previousButtons[index] ?? [];
    const pressed = pad.buttons.map((button) => button.pressed);
    const direction = directionFromPad(pad);
    const directionPressed = direction && (direction !== heldDirection || now >= repeatAt);
    const acceptPressed = pressed[0] && !before[0];
    if (directionPressed || acceptPressed) setNavigationActive(true);
    if (!ownsControllerNavigation) {
      if (directionPressed) {
        move(direction as Direction);
        repeatAt = direction === heldDirection ? now + 115 : now + 360;
      }
      if (acceptPressed) (selected ?? (document.activeElement as HTMLElement | null))?.click();
    }
    heldDirection = direction;
    if (!direction) repeatAt = 0;
    previousButtons[index] = pressed;
  }
  if (!connected) {
    previousButtons = [];
    heldDirection = '';
  }
}

function frame(now: number): void {
  pollGamepads(now);
  updateCursor();
  requestAnimationFrame(frame);
}

/** Visible spatial navigation for keyboards, D-pads and controller sticks. */
export function installArcadeNavigation(): void {
  if (installed) return;
  installed = true;
  addEventListener('keydown', (event) => {
    const direction = ({ ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' } as const)[event.key];
    if (!direction) return;
    setNavigationActive(true);
    if (ownsControllerNavigation || event.defaultPrevented) return;
    const target = event.target as HTMLElement | null;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
    event.preventDefault();
    move(direction);
  });
  addEventListener('focusin', () => {
    if (navigationActive) select(document.activeElement instanceof HTMLElement ? document.activeElement : null, false);
  });
  addEventListener('pointerdown', () => setNavigationActive(false), { capture: true });
  addEventListener('mousemove', () => setNavigationActive(false), { capture: true });
  addEventListener('blur', () => setNavigationActive(false));
  requestAnimationFrame(frame);
}
