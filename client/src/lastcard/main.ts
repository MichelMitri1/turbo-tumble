import './styles.css';
import { COLOR_INFO, COLORS, cardLabel, sortKey, type Card, type Color } from './cards';
import { avatar, backSvg, cardSvg, AVATAR_COUNT } from './art';
import { LocalLink, type GameLink } from './link';
import type { Action, GameEvent } from './engine';
import type { View } from './view';
import type { BotLevel } from './bots';
import { LastCardAudio } from './audio';
import { OnlineLink, LastCardNet } from './net/online';
import type { LcLobby } from './net/protocol';
import { bindFullscreenButton, installFullscreenKey } from '../ui/fullscreen';

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* ignore */
    }
  },
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const audio = new LastCardAudio();
audio.setMuted(store.get('lc-muted') === '1');
const settings = {
  name: store.get('lc-name') || `Player${Math.floor(100 + Math.random() * 900)}`,
  avatar: Number(store.get('lc-avatar') ?? Math.floor(Math.random() * AVATAR_COUNT)),
  bots: Number(store.get('lc-bots') ?? 3),
  level: (store.get('lc-level') as BotLevel) || 'normal',
  stacking: store.get('lc-stacking') === '1',
  drawToMatch: store.get('lc-match') === '1',
  target: Number(store.get('lc-target') ?? 0),
};

const fanCards = (['r', 'y', 'g', 'b'] as Color[]).map((c, i) => `<div class="lc-logo-card" style="--i:${i - 1.5}">${cardSvg({ kind: i === 3 ? 'wild4' : 'num', color: i === 3 ? null : c, n: [7, 2, 9, 0][i]! })}</div>`).join('');

document.getElementById('game')!.innerHTML = `
<div class="lc-shell">
  <div class="lc-topbar">
    <a class="lc-chip" href="/">← Arcade</a>
    <div class="lc-topbar__right"><button class="lc-chip" id="rules-btn">? Rules</button><button class="lc-chip" id="sound"></button><button class="lc-chip" id="fullscreen"></button></div>
  </div>

  <section class="lc-menu" id="menu">
    <div class="lc-logo"><div class="lc-logo-fan">${fanCards}</div><div class="lc-wordmark"><span class="lc-display">LAST</span><span class="lc-display">CARD!</span></div></div>
    <p class="lc-tag">Match colours. Dump your hand. Don't forget to shout.</p>
    <div class="lc-panel">
      <div class="lc-row"><label>Your name</label><input id="m-name" maxlength="14" spellcheck="false" /></div>
      <div class="lc-row"><label>Avatar</label><div class="lc-avatars" id="m-avatars"></div></div>
      <div class="lc-row"><label>Bots</label><div class="lc-seg" id="m-bots">${[1, 2, 3, 4, 5, 6, 7].map((n) => `<button data-v="${n}">${n}</button>`).join('')}</div></div>
      <div class="lc-row"><label>Bot brains</label><div class="lc-seg" id="m-level"><button data-v="easy">Easy</button><button data-v="normal">Normal</button><button data-v="hard">Hard</button></div></div>
      <div class="lc-row"><label>Game</label><div class="lc-seg" id="m-target"><button data-v="0">One round</button><button data-v="200">First to 200</button><button data-v="500">First to 500</button></div></div>
      <div class="lc-row"><label>House rules</label><div class="lc-toggles"><label><input type="checkbox" id="m-stacking" /> Stack +2 / +4</label><label><input type="checkbox" id="m-match" /> Draw until you can play</label></div></div>
      <button class="lc-btn lc-btn--go" id="m-play"><span class="lc-display">PLAY VS BOTS</span></button>
      <button class="lc-btn lc-btn--online" id="m-online">🌐 Online · LAN <small>2–8 friends</small></button>
    </div>
  </section>

  <section class="lc-online hidden" id="online">
    <div class="lc-panel lc-panel--wide">
      <h2 class="lc-display" id="o-title">ONLINE</h2>
      <p class="lc-sub" id="o-sub">Play with friends anywhere</p>
      <div class="lc-lan hidden" id="o-lan"><small>OTHER DEVICES OPEN</small><b id="o-lan-url"></b></div>
      <div id="o-connect">
        <div class="lc-online__choices">
          <button class="lc-btn lc-btn--go" id="o-create"><span class="lc-display">CREATE ROOM</span></button>
          <button class="lc-btn" id="o-quick">Quick match</button>
          <div class="lc-join"><input id="o-code" maxlength="4" placeholder="CODE" spellcheck="false" autocapitalize="characters" /><button class="lc-btn" id="o-join">Join</button></div>
        </div>
      </div>
      <div class="hidden" id="o-lobby">
        <div class="lc-code"><small>ROOM CODE</small><b class="lc-display" id="o-code-big">----</b><button class="lc-chip" id="o-copy">Copy invite link</button></div>
        <div class="lc-lobby-players" id="o-players"></div>
        <div class="lc-host hidden" id="o-host">
          <div class="lc-row"><label>Bots</label><div class="lc-seg" id="o-bots">${[0, 1, 2, 3, 4, 5, 6].map((n) => `<button data-v="${n}">${n}</button>`).join('')}</div></div>
          <div class="lc-row"><label>Bot brains</label><div class="lc-seg" id="o-level"><button data-v="easy">Easy</button><button data-v="normal">Normal</button><button data-v="hard">Hard</button></div></div>
          <div class="lc-row"><label>Game</label><div class="lc-seg" id="o-target"><button data-v="0">One round</button><button data-v="200">To 200</button><button data-v="500">To 500</button></div></div>
          <div class="lc-row"><label>House rules</label><div class="lc-toggles"><label><input type="checkbox" id="o-stacking" /> Stack +2 / +4</label><label><input type="checkbox" id="o-match" /> Draw until you can play</label></div></div>
          <button class="lc-btn lc-btn--go" id="o-start"><span class="lc-display">START GAME</span></button>
        </div>
        <p class="lc-wait" id="o-wait"></p>
      </div>
      <p class="lc-status" id="o-status"></p>
      <div class="lc-foot"><button class="lc-chip" id="o-back">← Back</button><span id="o-server"></span></div>
    </div>
  </section>

  <section class="lc-table hidden" id="table">
    <div class="lc-seats" id="seats"></div>
    <div class="lc-center">
      <div class="lc-dir" id="dir"><svg viewBox="0 0 200 200"><defs><marker id="lc-arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="currentColor"/></marker></defs>
        <path d="M100 12 A88 88 0 0 1 188 100" marker-end="url(#lc-arrow)"/><path d="M188 100 A88 88 0 0 1 100 188" marker-end="url(#lc-arrow)"/><path d="M100 188 A88 88 0 0 1 12 100" marker-end="url(#lc-arrow)"/><path d="M12 100 A88 88 0 0 1 100 12" marker-end="url(#lc-arrow)"/></svg></div>
      <div class="lc-pile" id="pile"><div class="lc-pile__stack" id="pile-stack"></div><div class="lc-pile__info"><b id="pile-count">0</b></div></div>
      <div class="lc-discard" id="discard"></div>
      <div class="lc-stack hidden" id="stack"></div>
    </div>
    <div class="lc-ticker" id="ticker"></div>
    <div class="lc-me" id="me">
      <div class="lc-me__info"><div class="lc-me__avatar" id="me-avatar"></div><div><b id="me-name"></b><small id="me-turn"></small></div></div>
      <div class="lc-hint" id="hint"></div>
      <div class="lc-actions">
        <button class="lc-btn lc-btn--catch hidden" id="catch-btn"><span class="lc-display">CATCH!</span></button>
        <button class="lc-btn lc-btn--call hidden" id="call-btn"><span class="lc-display">LAST CARD!</span></button>
        <button class="lc-btn hidden" id="keep-btn">Keep it</button>
        <button class="lc-btn lc-btn--draw hidden" id="draw-btn"><span class="lc-display">DRAW</span></button>
      </div>
      <div class="lc-hand" id="hand"></div>
    </div>
    <div class="lc-fx" id="fx"></div>
    <canvas class="lc-particles" id="particles"></canvas>
  </section>

  <section class="lc-modal hidden" id="modal"><div class="lc-modal__panel" id="modal-panel"></div></section>
  <section class="lc-modal hidden" id="rules"><div class="lc-modal__panel lc-rules" id="rules-panel"></div></section>
</div>`;

// ============================================================================ helpers

function cardHtml(c: Pick<Card, 'kind' | 'color' | 'n'> & { id?: number }, cls = ''): string {
  return `<div class="lc-card ${cls}" ${c.id !== undefined ? `data-id="${c.id}"` : ''}>${cardSvg(c)}</div>`;
}
function backHtml(cls = ''): string {
  return `<div class="lc-card lc-back ${cls}">${backSvg()}</div>`;
}
/** Replace an element's markup only when it actually changed (no flicker). */
function setHTML(el: HTMLElement, html: string): void {
  if (el.dataset.html === html) return;
  el.dataset.html = html;
  el.innerHTML = html;
}
function setSeg(sel: string, v: string): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>(`${sel} button`)) b.classList.toggle('on', b.dataset.v === v);
}

// ============================================================================ menu

const nameInput = $<HTMLInputElement>('#m-name');
nameInput.value = settings.name;
nameInput.addEventListener('change', () => {
  settings.name = nameInput.value.trim() || 'Player';
  store.set('lc-name', settings.name);
});
function renderAvatars(): void {
  $('#m-avatars').innerHTML = Array.from({ length: AVATAR_COUNT }, (_, i) => `<button class="lc-av ${i === settings.avatar ? 'on' : ''}" data-i="${i}">${avatar(i)}</button>`).join('');
}
$('#m-avatars').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
  if (!b) return;
  settings.avatar = Number(b.dataset.i);
  store.set('lc-avatar', String(settings.avatar));
  audio.card();
  renderAvatars();
});
for (const [sel, key] of [['#m-bots', 'bots'], ['#m-level', 'level'], ['#m-target', 'target']] as const) {
  $(sel).addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!b) return;
    (settings as Record<string, unknown>)[key] = key === 'level' ? b.dataset.v : Number(b.dataset.v);
    store.set(`lc-${key}`, String(b.dataset.v));
    setSeg(sel, b.dataset.v!);
  });
}
$<HTMLInputElement>('#m-stacking').checked = settings.stacking;
$<HTMLInputElement>('#m-match').checked = settings.drawToMatch;
$('#m-stacking').addEventListener('change', (e) => {
  settings.stacking = (e.target as HTMLInputElement).checked;
  store.set('lc-stacking', settings.stacking ? '1' : '0');
});
$('#m-match').addEventListener('change', (e) => {
  settings.drawToMatch = (e.target as HTMLInputElement).checked;
  store.set('lc-match', settings.drawToMatch ? '1' : '0');
});
renderAvatars();
setSeg('#m-bots', String(settings.bots));
setSeg('#m-level', settings.level);
setSeg('#m-target', String(settings.target));

const soundBtn = $('#sound');
const syncSound = () => (soundBtn.textContent = audio.muted ? '🔇' : '♫');
soundBtn.addEventListener('click', () => {
  audio.setMuted(!audio.muted);
  store.set('lc-muted', audio.muted ? '1' : '0');
  syncSound();
});
syncSound();
bindFullscreenButton($('#fullscreen'), ['⛶', '⛶']);
installFullscreenKey();

$('#rules-panel').innerHTML = `<h2 class="lc-display">HOW TO PLAY</h2>
<p><b>Get rid of all your cards.</b> On your turn, play a card that matches the top card by <b>colour</b>, <b>number</b> or <b>symbol</b>. Can't (or don't want to)? <b>Draw one</b> — if it can be played, you may play it right away.</p>
<p><b>Skip</b> — the next player loses their turn. <b>Reverse</b> — switch direction (with two players it works like Skip). <b>Draw Two</b> — the next player draws 2 and loses their turn.</p>
<p><b>Wild</b> — pick the colour; play it any time. <b>Wild Draw Four</b> — pick the colour, the next player draws 4 and loses their turn. You're only allowed to play it when you have <b>no card of the current colour</b>… but you can bluff! The next player may <b>challenge</b>: if you bluffed, <i>you</i> draw 4; if you didn't, they draw 6.</p>
<p><b>LAST CARD!</b> — when you're down to two cards, hit <b>LAST CARD!</b> before (or right after) you play. If someone <b>catches</b> you with one card before you call it, you draw 2.</p>
<p><b>Scoring</b> — the round winner scores the cards left in everyone's hands: numbers at face value, Skip / Reverse / Draw Two 20, Wilds 50. Play one round, or race to 200 / 500.</p>
<p><b>House rules</b> (optional) — <b>Stacking</b>: answer a +2 with a +2 or +4 (and +4 with +4) to pass the pile on. <b>Draw until you can play</b>.</p>
<p class="lc-keys">Keys: <b>D</b>/<b>Space</b> draw · <b>L</b> last card · <b>C</b> catch · <b>K</b> keep</p>
<button class="lc-btn" id="rules-close">Got it</button>`;
$('#rules-btn').addEventListener('click', () => $('#rules').classList.remove('hidden'));
$('#rules').addEventListener('click', (e) => {
  if ((e.target as HTMLElement).id === 'rules' || (e.target as HTMLElement).id === 'rules-close') $('#rules').classList.add('hidden');
});

// ============================================================================ table state

let link: GameLink | null = null;
let view: View | null = null;
const queue: GameEvent[] = [];
let busyUntil = 0;
let lastFrame = performance.now();
let updateAt = performance.now();

function startLocal(): void {
  settings.name = nameInput.value.trim() || 'Player';
  link?.dispose();
  attach(new LocalLink({ name: settings.name, avatar: settings.avatar, bots: settings.bots, level: settings.level, rules: { stacking: settings.stacking, drawToMatch: settings.drawToMatch, target: settings.target } }));
}

function attach(l: GameLink): void {
  link = l;
  view = null;
  queue.length = 0;
  flights = 0;
  pileShown = [];
  lastHandRects.clear();
  closeModal();
  $('#menu').classList.add('hidden');
  $('#online').classList.add('hidden');
  $('#table').classList.remove('hidden');
  $('#ticker').innerHTML = '';
  let lastKey = '';
  l.onUpdate = (v, events) => {
    view = v;
    queue.push(...events);
    const key = JSON.stringify({ ...v, turnLeft: 0, pauseLeft: 0 });
    if (key !== lastKey || events.length) {
      lastKey = key;
      render();
    }
    updateAt = performance.now();
  };
  l.onError = (msg) => {
    audio.error();
    ticker(esc(msg), 'error');
  };
}

function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  link?.tick(dt);
  while (queue.length && now >= busyUntil) busyUntil = now + animate(queue.shift()!) * 1000;
  if (view && !flights && !queue.length) syncDiscard(view.top);
  if (view) renderTimers();
  particles.update(dt);
}
requestAnimationFrame(frame);

// ============================================================================ rendering

function nameOf(id: string): string {
  if (!view) return id;
  if (id === view.you) return 'You';
  return view.players.find((p) => p.id === id)?.name ?? id;
}

function render(): void {
  const v = view;
  if (!v) return;
  const me = v.players.find((p) => p.id === v.you);
  const scored = v.rules.target > 0;
  // Seats: everyone else, in turn order after me.
  const i0 = Math.max(0, v.players.findIndex((p) => p.id === v.you));
  const order = v.players.map((_, k) => v.players[(i0 + 1 + k) % v.players.length]!).filter((p) => p.id !== v.you);
  setHTML(
    $('#seats'),
    order
      .map((p) => {
        const turn = v.current === p.id && v.phase !== 'over' && v.phase !== 'roundOver';
        const backs = Math.min(p.count, 10);
        const fan = Array.from({ length: backs }, (_, k) => `<i style="--k:${k - (backs - 1) / 2}"></i>`).join('');
        const one = p.count === 1;
        return `<div class="lc-seat ${turn ? 'turn' : ''} ${one ? 'one' : ''}" data-id="${p.id}">
          <div class="lc-seat__avatar">${avatar(p.avatar)}${p.bot ? '<em>BOT</em>' : ''}${p.connected ? '' : '<em class="off">…</em>'}<svg class="lc-seat__timer" viewBox="0 0 100 100"><circle cx="50" cy="50" r="46"/></svg></div>
          <div class="lc-seat__name">${esc(p.name)}</div>
          <div class="lc-seat__fan">${fan}<b>${p.count}</b></div>
          ${scored ? `<div class="lc-seat__score">${p.score} pts</div>` : ''}
          ${one && p.called ? '<div class="lc-seat__last">LAST CARD!</div>' : ''}
          ${v.vulnerable === p.id ? '<button class="lc-seat__catch" data-catch="' + p.id + '">CATCH!</button>' : ''}
        </div>`;
      })
      .join(''),
  );
  // Draw pile.
  setHTML($('#pile-stack'), Array.from({ length: Math.max(1, Math.min(6, Math.ceil(v.drawCount / 12))) }, (_, k) => backHtml(`s${k}`)).join(''));
  $('#pile-count').textContent = String(v.drawCount);
  const myTurn = v.current === v.you && (v.phase === 'play' || v.phase === 'drawn');
  $('#pile').classList.toggle('mine', myTurn && v.phase === 'play');
  // Direction + colour.
  const dir = $('#dir');
  dir.classList.toggle('ccw', v.dir === -1);
  dir.style.setProperty('--col', v.color ? COLOR_INFO[v.color].hex : '#ffffff');
  $('#discard').style.setProperty('--col', v.color ? COLOR_INFO[v.color].hex : 'transparent');
  const stack = $('#stack');
  stack.classList.toggle('hidden', !v.pendingDraw);
  stack.textContent = `+${v.pendingDraw}`;
  if (!flights && !queue.length) syncDiscard(v.top);
  // Me.
  setHTML($('#me-avatar'), avatar(me?.avatar ?? 0));
  $('#me-name').textContent = `${me?.name ?? ''}${scored ? ` · ${me?.score ?? 0} pts` : ''}`;
  $('#me').classList.toggle('turn', myTurn || (v.phase === 'challenge' && v.current === v.you));
  $('#me-turn').textContent = v.phase === 'roundOver' || v.phase === 'over' ? '' : v.current === v.you ? 'Your turn' : `${nameOf(v.current)}'s turn`;
  // Hand.
  rememberHand();
  const hand = [...v.hand].sort((a, b) => sortKey(a) - sortKey(b));
  const playable = new Set(v.playable);
  const n = hand.length;
  setHTML(
    $('#hand'),
    hand
      .map((c, k) => {
        const mid = (n - 1) / 2;
        const cls = myTurn ? (playable.has(c.id) ? 'ok' : 'no') : '';
        return `<div class="lc-slot ${c.id === v.drawnId ? 'drawn' : ''}" style="--k:${k - mid};--n:${n}">${cardHtml(c, cls)}</div>`;
      })
      .join(''),
  );
  renderActions();
  if (v.phase === 'challenge' && v.challengeFrom && !$('#modal').dataset.kind) showChallenge(v.challengeFrom);
  if (v.phase !== 'challenge' && $('#modal').dataset.kind === 'challenge') closeModal();
  if (v.phase === 'play' && $('#modal').dataset.kind === 'round') closeModal();
}

function renderActions(): void {
  const v = view!;
  const me = v.players.find((p) => p.id === v.you);
  const myTurn = v.current === v.you && (v.phase === 'play' || v.phase === 'drawn');
  const count = v.hand.length;
  const canCall = !!me && !me.called && (count === 1 ? v.vulnerable === v.you : count === 2 && myTurn);
  $('#call-btn').classList.toggle('hidden', !canCall);
  $('#call-btn').classList.toggle('urgent', v.vulnerable === v.you);
  const catchable = v.vulnerable && v.vulnerable !== v.you;
  $('#catch-btn').classList.toggle('hidden', !catchable);
  $('#keep-btn').classList.toggle('hidden', !(myTurn && v.phase === 'drawn'));
  $('#draw-btn').classList.toggle('hidden', !(myTurn && v.phase === 'play'));
  $('#draw-btn').innerHTML = `<span class="lc-display">${v.pendingDraw ? `TAKE +${v.pendingDraw}` : 'DRAW'}</span>`;
  $('#hint').textContent =
    v.phase === 'drawn' && myTurn
      ? 'Play the card you drew, or keep it'
      : myTurn && v.pendingDraw
        ? `Stack a Draw card, or take ${v.pendingDraw}`
        : myTurn && !v.playable.length
          ? 'No match — draw a card'
          : myTurn
            ? 'Your turn — play a glowing card'
            : '';
}

function renderTimers(): void {
  const v = view!;
  const total = v.rules.turnTime;
  const left = Math.max(0, v.turnLeft - (performance.now() - updateAt) / 1000);
  for (const el of document.querySelectorAll<HTMLElement>('.lc-seat.turn .lc-seat__timer')) el.style.setProperty('--p', total ? String(left / total) : '1');
  $('#me').style.setProperty('--p', total && v.current === v.you ? String(left / total) : '0');
  const m = $('#modal');
  if (m.dataset.kind === 'round') {
    const t = $('#round-next');
    if (t) t.textContent = String(Math.max(0, Math.ceil(v.pauseLeft - (performance.now() - updateAt) / 1000)));
  }
}

function ticker(text: string, kind = ''): void {
  const t = $('#ticker');
  const el = document.createElement('div');
  el.className = `lc-tick ${kind}`;
  el.innerHTML = text;
  t.prepend(el);
  while (t.children.length > 4) t.lastElementChild!.remove();
  setTimeout(() => el.classList.add('old'), 4000);
}

// ---------------------------------------------------------------- discard pile

let flights = 0;
/** Cards visible on the discard pile (top last) with their random tilt. */
let pileShown: Array<{ id: number; html: string; rot: number; dx: number; dy: number }> = [];
function pushDiscard(c: Card): void {
  if (pileShown[pileShown.length - 1]?.id === c.id) return;
  pileShown.push({ id: c.id, html: cardHtml(c), rot: (Math.random() - 0.5) * 30, dx: (Math.random() - 0.5) * 14, dy: (Math.random() - 0.5) * 10 });
  if (pileShown.length > 5) pileShown.shift();
  drawDiscard(true);
}
function syncDiscard(top: Card): void {
  if (pileShown[pileShown.length - 1]?.id !== top.id) {
    pileShown = [];
    pushDiscard(top);
  }
}
function drawDiscard(land: boolean): void {
  const el = $('#discard');
  el.innerHTML = pileShown.map((p, i) => `<div class="lc-discard__card ${land && i === pileShown.length - 1 ? 'land' : ''}" style="transform: translate(${p.dx}px, ${p.dy}px) rotate(${p.rot}deg)">${p.html}</div>`).join('');
}

// ============================================================================ input

function send(a: Action): void {
  rememberHand();
  link?.send(a);
}

$('#hand').addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('.lc-card');
  if (!el || !view) return;
  const id = Number(el.dataset.id);
  const card = view.hand.find((c) => c.id === id);
  if (!card) return;
  if (!view.playable.includes(id)) {
    audio.error();
    el.animate([{ transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'none' }], { duration: 180 });
    return;
  }
  if (card.kind === 'wild' || card.kind === 'wild4') return pickColor(card);
  send({ t: 'play', card: id });
});

function pickColor(card: Card): void {
  const p = openModal(
    `<h3 class="lc-display">PICK A COLOUR</h3><div class="lc-colors">${COLORS.map((c) => `<button data-c="${c}" style="--c:${COLOR_INFO[c].hex}"><span>${COLOR_INFO[c].name}</span></button>`).join('')}</div>
    <div class="lc-modal__card">${cardHtml(card)}</div><button class="lc-chip" data-cancel>Cancel</button>`,
    'color',
  );
  p.onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-c],[data-cancel]');
    if (!b) return;
    closeModal();
    if (b.dataset.c) send({ t: 'play', card: card.id, color: b.dataset.c as Color });
  };
}

function doCatch(): void {
  if (view?.vulnerable && view.vulnerable !== view.you) send({ t: 'catch', target: view.vulnerable });
}
$('#draw-btn').addEventListener('click', () => send({ t: 'draw' }));
$('#pile').addEventListener('click', () => {
  if (view?.current === view?.you && view?.phase === 'play') send({ t: 'draw' });
});
$('#keep-btn').addEventListener('click', () => send({ t: 'keep' }));
$('#call-btn').addEventListener('click', () => send({ t: 'call' }));
$('#catch-btn').addEventListener('click', doCatch);
$('#seats').addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest('[data-catch]')) doCatch();
});
addEventListener('keydown', (e) => {
  if (!view || document.activeElement?.tagName === 'INPUT' || $('#table').classList.contains('hidden')) return;
  const vis = (id: string) => !$(id).classList.contains('hidden');
  if ((e.key === 'd' || e.key === ' ') && vis('#draw-btn')) {
    e.preventDefault();
    send({ t: 'draw' });
  }
  if (e.key === 'l' && vis('#call-btn')) send({ t: 'call' });
  if (e.key === 'c' && vis('#catch-btn')) doCatch();
  if (e.key === 'k' && vis('#keep-btn')) send({ t: 'keep' });
});

// ============================================================================ modals

function openModal(html: string, kind = ''): HTMLElement {
  const m = $('#modal');
  m.classList.remove('hidden');
  m.dataset.kind = kind;
  const p = $('#modal-panel');
  p.className = `lc-modal__panel ${kind}`;
  p.innerHTML = html;
  return p;
}
function closeModal(): void {
  $('#modal').classList.add('hidden');
  delete $('#modal').dataset.kind;
}

function showChallenge(from: string): void {
  const p = openModal(
    `<h3 class="lc-display">WILD DRAW FOUR!</h3><div class="lc-modal__card">${cardHtml({ kind: 'wild4', color: null, n: -1 })}</div>
    <p><b>${esc(nameOf(from))}</b> hit you with +4. Think they were bluffing — holding a card of the colour that was in play?</p>
    <p class="lc-small">Challenge: if they bluffed, <b>they</b> draw 4 and you play on. If not, you draw <b>6</b>.</p>
    <div class="lc-two"><button class="lc-btn lc-btn--catch" data-y="1"><span class="lc-display">CHALLENGE!</span></button><button class="lc-btn" data-y="0">Accept · draw 4</button></div>`,
    'challenge',
  );
  p.onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-y]');
    if (!b) return;
    closeModal();
    send({ t: 'challenge', yes: b.dataset.y === '1' });
  };
}

function showRound(ev: Extract<GameEvent, { k: 'roundOver' }>): void {
  const v = view!;
  const won = ev.winner === v.you;
  const rows = v.players
    .map((p) => {
      const hand = ev.hands[p.id] ?? [];
      return `<div class="lc-result ${p.id === ev.winner ? 'win' : ''}"><div class="lc-result__who">${avatar(p.avatar)}<b>${esc(p.id === v.you ? 'You' : p.name)}</b></div>
        <div class="lc-result__hand">${p.id === ev.winner ? '<span class="lc-display">OUT!</span>' : hand.map((c) => cardHtml(c, 'tiny')).join('')}</div>
        ${v.rules.target ? `<div class="lc-result__score">${ev.scores[p.id] ?? 0}</div>` : ''}</div>`;
    })
    .join('');
  const final = v.phase === 'over';
  const p = openModal(
    `<h2 class="lc-display ${won ? 'gold' : ''}">${final ? (v.winner === v.you ? 'YOU WIN!' : `${esc(nameOf(v.winner ?? ev.winner).toUpperCase())} WINS!`) : won ? 'YOU WON THE ROUND!' : `${esc(nameOf(ev.winner).toUpperCase())} WINS THE ROUND`}</h2>
    <p>${ev.points} points${v.rules.target ? ` · first to ${v.rules.target}` : ''}</p><div class="lc-results">${rows}</div>
    ${final ? `<div class="lc-two"><button class="lc-btn lc-btn--go" id="again"><span class="lc-display">${link?.online ? 'BACK TO LOBBY' : 'PLAY AGAIN'}</span></button><button class="lc-btn" id="to-menu">Menu</button></div>` : '<p class="lc-small">Next round in <b id="round-next">7</b>…</p>'}`,
    final ? 'over' : 'round',
  );
  audio.win(final ? v.winner === v.you : won);
  if ((final ? v.winner : ev.winner) === v.you) particles.confetti();
  p.onclick = (e) => {
    const id = (e.target as HTMLElement).closest('button')?.id;
    if (id === 'again') {
      closeModal();
      if (link?.online) backToLobby();
      else startLocal();
    }
    if (id === 'to-menu') toMenu();
  };
}

function toMenu(): void {
  link?.dispose();
  link = null;
  view = null;
  void net?.leave();
  net = null;
  closeModal();
  $('#table').classList.add('hidden');
  $('#online').classList.add('hidden');
  $('#menu').classList.remove('hidden');
}

// ============================================================================ animations

/** Animate one event; returns seconds to wait before the next. */
function animate(ev: GameEvent): number {
  const v = view;
  if (!v) return 0;
  const me = v.you;
  const who = (id: string) => (id === me ? '<b>You</b>' : `<b>${esc(nameOf(id))}</b>`);
  switch (ev.k) {
    case 'round':
      closeModal();
      pileShown = [];
      drawDiscard(false);
      banner(v.rules.target ? `ROUND ${ev.round}` : 'SHUFFLE UP!', 'gold');
      audio.shuffle();
      ticker(`${who(ev.dealer)} ${ev.dealer === me ? 'deal' : 'deals'} 7 cards each`);
      return 0.6;
    case 'draw': {
      if (ev.why === 'deal') {
        audio.deal();
        for (let i = 0; i < Math.min(ev.n, 7); i++) fly(pileRect(), seatRect(ev.by), ev.by === me && ev.cards?.[i] ? cardHtml(ev.cards[i]!) : backHtml(), i * 0.05, undefined, 360);
        return 0.12;
      }
      audio.draw();
      const n = Math.min(ev.n, 6);
      for (let i = 0; i < n; i++) fly(pileRect(), seatRect(ev.by), ev.by === me && ev.cards?.[i] ? cardHtml(ev.cards[i]!) : backHtml(), i * 0.08);
      if (ev.why === 'turn' || ev.why === 'match') {
        if (ev.by === me && ev.cards?.[0]) ticker(`You drew <b>${esc(cardLabel(ev.cards[0]))}</b>`);
        else ticker(`${who(ev.by)} drew a card`, 'dim');
      } else if (ev.why !== 'catch' && ev.why !== 'challenge') ticker(`${who(ev.by)} ${ev.by === me ? 'draw' : 'draws'} <b>${ev.n}</b>`, ev.by === me ? 'bad' : '');
      if (ev.n >= 2) seatPop(ev.by, `+${ev.n}`, 'plus');
      return 0.25 + n * 0.06;
    }
    case 'flip':
      flights++;
      fly(pileRect(), $('#discard').getBoundingClientRect(), cardHtml(ev.card), 0, () => {
        flights--;
        pileShown = [];
        pushDiscard(ev.card);
      });
      ticker(`First card: <b>${esc(cardLabel(ev.card))}</b>`);
      return 0.6;
    case 'turn':
      // Only announce it if it's still my turn by the time the queue gets here.
      if (ev.player === me && v.current === me) {
        audio.turn();
        if (v.phase !== 'challenge') banner('YOUR TURN', 'small');
      }
      return 0.1;
    case 'play': {
      audio.card();
      const from = ev.by === me ? (lastHandRects.get(ev.card.id) ?? seatRect(ev.by)) : seatRect(ev.by);
      flights++;
      fly(from, $('#discard').getBoundingClientRect(), cardHtml(ev.card), 0, () => {
        flights--;
        pushDiscard(ev.card);
        if (ev.card.kind === 'wild' || ev.card.kind === 'wild4') {
          const r = $('#discard').getBoundingClientRect();
          particles.burst(r.left + r.width / 2, r.top + r.height / 2, ev.color ? COLOR_INFO[ev.color].hex : '#fff');
        }
      });
      const wild = ev.card.kind === 'wild' || ev.card.kind === 'wild4';
      ticker(`${who(ev.by)} played <b>${esc(cardLabel(ev.card))}</b>${wild && ev.color ? ` → <b style="color:${COLOR_INFO[ev.color].hex}">${COLOR_INFO[ev.color].name}</b>` : ''}`);
      if (wild) {
        audio.wild();
        setTimeout(() => banner(ev.color ? COLOR_INFO[ev.color].name.toUpperCase() : 'WILD!', `color-${ev.color}`), 350);
      }
      if (ev.card.kind === 'draw2' || ev.card.kind === 'wild4') audio.plus(ev.card.kind === 'draw2' ? 2 : 4);
      return wild ? 0.9 : 0.5;
    }
    case 'skip':
      audio.skip();
      seatPop(ev.target, '⊘ SKIP', 'skip');
      ticker(`${who(ev.target)} ${ev.target === me ? 'are' : 'is'} skipped`);
      return 0.5;
    case 'reverse':
      audio.reverse();
      $('#dir').classList.remove('spin');
      void $('#dir').offsetWidth;
      $('#dir').classList.add('spin');
      banner('⇄ REVERSE', 'small');
      return 0.5;
    case 'stack':
      seatPop(v.current, `+${ev.total}`, 'plus');
      ticker(`The pile is up to <b>+${ev.total}</b>!`, 'bad');
      return 0.35;
    case 'call':
      audio.call();
      shout(ev.by);
      ticker(`${who(ev.by)}: <b>LAST CARD!</b>`, 'good');
      return 0.6;
    case 'caught':
      audio.caught();
      stamp('CAUGHT!', 'caught');
      ticker(`${who(ev.by)} caught ${who(ev.target)} — <b>+2</b>!`, 'bad');
      shake(8);
      return 0.9;
    case 'challenge': {
      audio.challenge();
      if (!ev.yes) {
        ticker(`${who(ev.by)} accepted the +4`);
        return 0.2;
      }
      stamp(ev.guilty ? 'BLUFF!' : 'LEGIT!', ev.guilty ? 'caught' : 'legit');
      ticker(`${who(ev.by)} challenged ${who(ev.target)}: ${ev.guilty ? 'it was a <b>bluff</b> — they draw 4!' : 'it was <b>legal</b> — +6!'}`, ev.guilty ? 'good' : 'bad');
      return 1;
    }
    case 'keep':
      ticker(`${who(ev.by)} kept the card`, 'dim');
      return 0.2;
    case 'reshuffle':
      audio.shuffle();
      $('#pile').classList.remove('shuffling');
      void $('#pile').offsetWidth;
      $('#pile').classList.add('shuffling');
      ticker('Deck ran out — the discard pile is reshuffled');
      return 0.6;
    case 'timeout':
      ticker(`${who(ev.by)} ran out of time`, 'dim');
      return 0.2;
    case 'left':
      ticker(`${who(ev.by)} left the table`, 'dim');
      return 0.2;
    case 'roundOver':
      link?.hold(2);
      setTimeout(() => showRound(ev), 700);
      return 1.2;
    case 'over':
      return 0.3;
  }
  return 0;
}

function pileRect(): DOMRect {
  return $('#pile').getBoundingClientRect();
}
function seatRect(id: string): DOMRect {
  if (view && id === view.you) return $('#hand').getBoundingClientRect();
  const s = document.querySelector<HTMLElement>(`.lc-seat[data-id="${id}"] .lc-seat__avatar`);
  return s?.getBoundingClientRect() ?? pileRect();
}

/** Remember where my cards are on screen (they leave the hand before the play animates). */
const lastHandRects = new Map<number, DOMRect>();
function rememberHand(): void {
  if (lastHandRects.size > 120) lastHandRects.clear();
  for (const el of document.querySelectorAll<HTMLElement>('#hand .lc-card[data-id]')) lastHandRects.set(Number(el.dataset.id), el.getBoundingClientRect());
}

function fly(from: DOMRect, to: DOMRect, html: string, delay = 0, done?: () => void, ms = 480): void {
  const el = document.createElement('div');
  el.className = 'lc-flyer';
  el.innerHTML = html;
  $('#fx').appendChild(el);
  const x0 = from.left + from.width / 2;
  const y0 = from.top + from.height / 2;
  const x1 = to.left + to.width / 2;
  const y1 = to.top + to.height / 2;
  const spin = (Math.random() - 0.5) * 40;
  const anim = el.animate(
    [
      { transform: `translate(${x0}px, ${y0}px) translate(-50%, -50%) scale(0.6) rotate(${-spin}deg)`, opacity: 0.6 },
      { transform: `translate(${(x0 + x1) / 2}px, ${Math.min(y0, y1) - 50}px) translate(-50%, -50%) scale(1) rotate(${spin / 2}deg)`, opacity: 1, offset: 0.5 },
      { transform: `translate(${x1}px, ${y1}px) translate(-50%, -50%) scale(0.85) rotate(${spin}deg)`, opacity: 1 },
    ],
    { duration: ms, delay: delay * 1000, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'both' },
  );
  anim.onfinish = () => {
    done?.();
    el.remove();
  };
}

function banner(text: string, tone: string): void {
  const el = document.createElement('div');
  el.className = `lc-banner lc-display ${tone}`;
  el.textContent = text;
  $('#fx').appendChild(el);
  setTimeout(() => el.remove(), 1500);
}

function stamp(text: string, kind: string): void {
  const el = document.createElement('div');
  el.className = `lc-stamp lc-display ${kind}`;
  el.textContent = text;
  $('#fx').appendChild(el);
  setTimeout(() => el.remove(), 1300);
}

/** A little label popping over a seat (SKIP, +2…). */
function seatPop(id: string, text: string, kind: string): void {
  const r = seatRect(id);
  const el = document.createElement('div');
  el.className = `lc-pop lc-display ${kind}`;
  el.textContent = text;
  el.style.left = `${r.left + r.width / 2}px`;
  el.style.top = `${id === view?.you ? r.top + 10 : r.top + r.height / 2}px`;
  $('#fx').appendChild(el);
  setTimeout(() => el.remove(), 1200);
}

/** Speech bubble: "LAST CARD!" */
function shout(id: string): void {
  const r = seatRect(id);
  const el = document.createElement('div');
  el.className = 'lc-shout lc-display';
  el.textContent = 'LAST CARD!';
  el.style.left = `${r.left + r.width / 2}px`;
  el.style.top = `${id === view?.you ? r.top : r.bottom + 10}px`;
  $('#fx').appendChild(el);
  setTimeout(() => el.remove(), 1500);
}

function shake(px: number): void {
  $('#table').animate(
    Array.from({ length: 8 }, (_, i) => ({ transform: `translate(${(Math.random() - 0.5) * px * (1 - i / 8)}px, ${(Math.random() - 0.5) * px * (1 - i / 8)}px)` })).concat([{ transform: 'none' }]),
    { duration: 380 },
  );
}

// ---------------------------------------------------------------- particles

const particles = (() => {
  const cv = $<HTMLCanvasElement>('#particles');
  const ctx = cv.getContext('2d')!;
  const list: Array<{ x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; g: number; spin?: number; rect?: boolean }> = [];
  const fit = () => {
    cv.width = innerWidth * devicePixelRatio;
    cv.height = innerHeight * devicePixelRatio;
  };
  fit();
  addEventListener('resize', fit);
  return {
    burst(x: number, y: number, color: string) {
      for (let i = 0; i < 60; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = 120 + Math.random() * 420;
        list.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.5 + Math.random() * 0.6, max: 1.1, size: 4 + Math.random() * 8, color: i % 4 === 0 ? '#fff' : color, g: 200 });
      }
    },
    confetti() {
      const cols = COLORS.map((c) => COLOR_INFO[c].hex);
      for (let i = 0; i < 180; i++) list.push({ x: Math.random() * innerWidth, y: -20 - Math.random() * 200, vx: (Math.random() - 0.5) * 120, vy: 100 + Math.random() * 200, life: 3.5, max: 3.5, size: 8 + Math.random() * 8, color: cols[i % 4]!, g: 60, spin: Math.random() * 10, rect: true });
    },
    update(dt: number) {
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i]!;
        p.life -= dt;
        if (p.life <= 0) {
          list.splice(i, 1);
          continue;
        }
        p.vy += p.g * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        ctx.globalAlpha = Math.min(1, p.life * 2);
        ctx.fillStyle = p.color;
        if (p.rect) {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.life * (p.spin ?? 0));
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
          ctx.restore();
        } else {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (0.4 + p.life / p.max), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    },
  };
})();

// ============================================================================ online

let net: LastCardNet | null = null;
let lobby: LcLobby | null = null;
let lanUrl: string | null = null;
const oCode = $<HTMLInputElement>('#o-code');
oCode.addEventListener('input', () => (oCode.value = oCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4)));
const oStatus = (t: string, err = false) => {
  $('#o-status').textContent = t;
  $('#o-status').classList.toggle('error', err);
};

async function openOnline(code = ''): Promise<void> {
  settings.name = nameInput.value.trim() || 'Player';
  store.set('lc-name', settings.name);
  $('#menu').classList.add('hidden');
  $('#online').classList.remove('hidden');
  $('#o-connect').classList.remove('hidden');
  $('#o-lobby').classList.add('hidden');
  if (code) oCode.value = code.toUpperCase().slice(0, 4);
  oStatus('');
  const probe = new LastCardNet();
  $('#o-server').textContent = `Server: ${probe.url.replace(/^wss?:\/\//, '')}`;
  const info = await probe.probe();
  if (!info.ok) oStatus("Can't reach the game server. Run `npm run dev` (or `npm run lan` for home Wi-Fi).", true);
  if (info.lan?.length) {
    const ip = /^(localhost|127\.)/.test(location.hostname) ? info.lan[0] : location.hostname;
    lanUrl = `${location.protocol}//${ip}${location.port ? `:${location.port}` : ''}${location.pathname}`;
    $('#o-title').textContent = 'LAN PLAY';
    $('#o-sub').textContent = 'Same Wi-Fi · instant';
    $('#o-lan-url').textContent = lanUrl;
    $('#o-lan').classList.remove('hidden');
  }
  if (code) void connect((n) => n.join(code, settings.name, settings.avatar));
}

async function connect(how: (n: LastCardNet) => Promise<void>): Promise<void> {
  if (net?.room) return;
  oStatus('Connecting…');
  const n = new LastCardNet();
  try {
    await how(n);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    oStatus(/not found/i.test(msg) ? 'No room with that code.' : /locked|full|maxClients/i.test(msg) ? 'That room is full or already playing.' : msg, true);
    return;
  }
  net = n;
  oStatus('');
  n.onLobby = (l) => {
    lobby = l;
    renderLobby();
    if (l.phase === 'playing' && (!link || !link.online)) attach(new OnlineLink(n));
  };
  n.onError = (m) => {
    oStatus(m, true);
    if (link) ticker(esc(m), 'error');
  };
  n.onClosed = (reason) => {
    if (net !== n) return;
    net = null;
    if (link?.online) {
      ticker('Disconnected.', 'error');
      setTimeout(toMenu, 1200);
    } else oStatus(reason ?? 'Disconnected.', true);
  };
  $('#o-connect').classList.add('hidden');
  $('#o-lobby').classList.remove('hidden');
  $('#o-code-big').textContent = n.code;
}

function renderLobby(): void {
  const l = lobby;
  if (!l || !net) return;
  $('#o-code-big').textContent = l.code;
  const host = l.hostId === net.sessionId;
  $('#o-players').innerHTML = l.players
    .map((p) => `<div class="lc-lp ${p.id === net!.sessionId ? 'me' : ''}">${avatar(p.avatar)}<b>${esc(p.name)}</b><small>${p.bot ? 'BOT' : p.id === l.hostId ? 'HOST' : p.id === net!.sessionId ? 'YOU' : ''}${p.connected ? '' : ' · reconnecting'}</small></div>`)
    .join('');
  $('#o-host').classList.toggle('hidden', !host || l.phase === 'playing');
  setSeg('#o-bots', String(l.config.bots));
  setSeg('#o-level', l.config.botLevel);
  setSeg('#o-target', String(l.config.target));
  $<HTMLInputElement>('#o-stacking').checked = l.config.stacking;
  $<HTMLInputElement>('#o-match').checked = l.config.drawToMatch;
  $('#o-wait').textContent = l.phase === 'playing' ? 'Game in progress…' : host ? (l.players.length < 2 ? 'Add bots or wait for friends, then start.' : '') : 'Waiting for the host to start…';
  ($('#o-start') as HTMLButtonElement).disabled = l.players.length < 2;
}

function backToLobby(): void {
  link?.dispose();
  link = null;
  view = null;
  $('#table').classList.add('hidden');
  $('#online').classList.remove('hidden');
  renderLobby();
}

$('#m-online').addEventListener('click', () => void openOnline());
$('#m-play').addEventListener('click', startLocal);
$('#o-create').addEventListener('click', () => void connect((n) => n.create(settings.name, settings.avatar)));
$('#o-quick').addEventListener('click', () => void connect((n) => n.quick(settings.name, settings.avatar)));
$('#o-join').addEventListener('click', () => {
  if (oCode.value.length < 4) return oStatus('Room codes have 4 characters.', true);
  void connect((n) => n.join(oCode.value, settings.name, settings.avatar));
});
oCode.addEventListener('keydown', (e) => e.key === 'Enter' && $('#o-join').click());
for (const [sel, key] of [['#o-bots', 'bots'], ['#o-level', 'botLevel'], ['#o-target', 'target']] as const) {
  $(sel).addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (b) net?.config({ [key]: key === 'botLevel' ? b.dataset.v : Number(b.dataset.v) });
  });
}
$('#o-stacking').addEventListener('change', (e) => net?.config({ stacking: (e.target as HTMLInputElement).checked }));
$('#o-match').addEventListener('change', (e) => net?.config({ drawToMatch: (e.target as HTMLInputElement).checked }));
$('#o-start').addEventListener('click', () => net?.start());
$('#o-copy').addEventListener('click', () => {
  const url = `${lanUrl ?? location.origin + location.pathname}?room=${net?.code ?? ''}`;
  void navigator.clipboard?.writeText(url).then(
    () => oStatus('Invite link copied!'),
    () => oStatus(url),
  );
});
$('#o-back').addEventListener('click', toMenu);

const q = new URLSearchParams(location.search);
if (q.get('room')) void openOnline(q.get('room')!);
if (q.has('play')) startLocal();
(window as unknown as Record<string, unknown>).__lc = {
  get link() {
    return link;
  },
  get view() {
    return view;
  },
};
