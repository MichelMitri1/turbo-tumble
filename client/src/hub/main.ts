import './hub.css';
import { GAMES, type GameEntry } from './games';
import { bindFullscreenButton, installFullscreenKey } from '../ui/fullscreen';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, children: Array<Node | string> = []): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = cls;
  node.append(...children);
  return node;
}

/** Gameplay screenshot (falls back to the emoji if it fails to load). */
function art(game: GameEntry): HTMLElement {
  const emoji = el('span', 'hub-card__emoji', [game.art.emoji]);
  if (!game.art.image) return emoji;
  const img = el('img', 'hub-card__shot');
  img.src = game.art.image;
  img.alt = `${game.title} gameplay`;
  img.loading = 'lazy';
  img.decoding = 'async';
  img.addEventListener('error', () => img.replaceWith(emoji));
  return img;
}

function card(game: GameEntry): HTMLElement {
  const playable = !!game.href;
  const root = playable ? el('a', 'hub-card') : el('div', 'hub-card is-locked');
  if (root instanceof HTMLAnchorElement) root.href = game.href!;
  else root.setAttribute('aria-disabled', 'true');
  root.style.setProperty('--from', game.art.from);
  root.style.setProperty('--to', game.art.to);
  root.append(
    el('div', 'hub-card__art', [art(game), playable ? '' : el('span', 'hub-card__badge', ['SOON'])]),
    el('div', 'hub-card__body', [
      el('h2', 'hub-card__title hub-display', [game.title]),
      el('p', 'hub-card__tagline', [game.tagline]),
      el('div', 'hub-card__tags', game.tags.map((t) => el('span', 'hub-tag', [t]))),
      el('span', 'hub-card__play hub-display', [playable ? 'PLAY ▶' : 'LOCKED']),
    ]),
  );
  return root;
}

const fullscreen = el('button', 'hub-fullscreen');
bindFullscreenButton(fullscreen);
installFullscreenKey();

const cards = GAMES.map(card);
const grid = el('div', 'hub-grid', cards);
document.getElementById('hub')!.append(
  fullscreen,
  el('header', 'hub-header', [
    el('div', 'hub-logo', [el('div', 'hub-logo__top hub-display', ["MITRIS'"]), el('div', 'hub-logo__bottom hub-display', ['ARCADE'])]),
    el('p', 'hub-sub', ['Pick a game']),
  ]),
  el('main', '', [grid]),
  el('footer', 'hub-footer', [`← → choose · Enter play · ${/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘F' : 'Ctrl+F'} fullscreen`]),
);

// Arrow keys / gamepad-style navigation between playable cards.
const playable = cards.filter((c): c is HTMLAnchorElement => c instanceof HTMLAnchorElement);
playable[0]?.focus();
addEventListener('keydown', (e) => {
  const dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
  if (!dir || !playable.length) return;
  e.preventDefault();
  const i = playable.indexOf(document.activeElement as HTMLAnchorElement);
  playable[(i + dir + playable.length) % playable.length]!.focus();
});
