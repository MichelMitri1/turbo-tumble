import './styles.css';
import { CARD_INFO, DECKS, GODCAT_AS, cardName, title, type Card, type CardType, type DeckId } from './cards';
import { avatar, cardArt, cardBack, AVATAR_COUNT } from './art';
import { LocalLink, type GameLink } from './link';
import type { Action, GameEvent } from './engine';
import type { View } from './view';
import type { BotLevel } from './bots';
import { KittenAudio } from './audio';
import { OnlineLink, KittensNet } from './net/online';
import type { KkLobby } from './net/protocol';
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

const audio = new KittenAudio();
audio.setMuted(store.get('kk-muted') === '1');
const settings = {
  name: store.get('kk-name') || `Kitty${Math.floor(100 + Math.random() * 900)}`,
  avatar: Number(store.get('kk-avatar') ?? Math.floor(Math.random() * AVATAR_COUNT)),
  bots: Number(store.get('kk-bots') ?? 3),
  level: (store.get('kk-level') as BotLevel) || 'normal',
  deck: (store.get('kk-deck') as DeckId) || 'gve',
};

document.getElementById('game')!.innerHTML = `
<div class="kk-shell">
  <div class="kk-topbar">
    <a class="kk-chip" href="/">← Arcade</a>
    <div class="kk-topbar__right"><button class="kk-chip" id="rules-btn">? Rules</button><button class="kk-chip" id="sound"></button><button class="kk-chip" id="fullscreen"></button></div>
  </div>

  <section class="kk-menu" id="menu">
    <div class="kk-menu__logo">
      <div class="kk-menu__art">${cardArt({ type: 'kitten' })}</div>
      <div><span class="kk-display kk-logo1">KITTEN</span><span class="kk-display kk-logo2">KABOOM</span></div>
    </div>
    <p class="kk-tag">Draw cards. Dodge kittens. Don't explode.</p>
    <div class="kk-panel">
      <div class="kk-row"><label>Your name</label><input id="m-name" maxlength="14" spellcheck="false" /></div>
      <div class="kk-row"><label>Your cat</label><div class="kk-avatars" id="m-avatars"></div></div>
      <div class="kk-row"><label>Deck</label><div class="kk-seg" id="m-deck"><button data-v="gve">😇 Heaven vs Heck <small>Armageddon</small></button><button data-v="classic">💣 Classic</button></div></div>
      <div class="kk-row"><label>Bots</label><div class="kk-seg" id="m-bots"><button data-v="1">1</button><button data-v="2">2</button><button data-v="3">3</button><button data-v="4">4</button></div></div>
      <div class="kk-row"><label>Bot brains</label><div class="kk-seg" id="m-level"><button data-v="easy">Easy</button><button data-v="normal">Normal</button><button data-v="hard">Hard</button></div></div>
      <button class="kk-btn kk-btn--go" id="m-play"><span class="kk-display">PLAY VS BOTS</span></button>
      <button class="kk-btn kk-btn--online" id="m-online">🌐 Online · LAN <small>2–5 friends</small></button>
    </div>
  </section>

  <section class="kk-online hidden" id="online">
    <div class="kk-panel kk-panel--wide">
      <h2 class="kk-display" id="o-title">ONLINE</h2>
      <p class="kk-sub" id="o-sub">Play with friends anywhere</p>
      <div class="kk-lan hidden" id="o-lan"><small>OTHER DEVICES OPEN</small><b id="o-lan-url"></b></div>
      <div id="o-connect">
        <div class="kk-online__choices">
          <button class="kk-btn kk-btn--go" id="o-create"><span class="kk-display">CREATE ROOM</span></button>
          <button class="kk-btn" id="o-quick">Quick match</button>
          <div class="kk-join"><input id="o-code" maxlength="4" placeholder="CODE" spellcheck="false" autocapitalize="characters" /><button class="kk-btn" id="o-join">Join</button></div>
        </div>
      </div>
      <div class="hidden" id="o-lobby">
        <div class="kk-code"><small>ROOM CODE</small><b class="kk-display" id="o-code-big">----</b><button class="kk-chip" id="o-copy">Copy invite link</button></div>
        <div class="kk-lobby-players" id="o-players"></div>
        <div class="kk-host hidden" id="o-host">
          <div class="kk-row"><label>Deck</label><div class="kk-seg" id="o-deck"><button data-v="gve">😇 Heaven vs Heck</button><button data-v="classic">💣 Classic</button></div></div>
          <div class="kk-row"><label>Bots</label><div class="kk-seg" id="o-bots"><button data-v="0">0</button><button data-v="1">1</button><button data-v="2">2</button><button data-v="3">3</button><button data-v="4">4</button></div></div>
          <button class="kk-btn kk-btn--go" id="o-start"><span class="kk-display">START GAME</span></button>
        </div>
        <p class="kk-wait" id="o-wait"></p>
      </div>
      <p class="kk-status" id="o-status"></p>
      <div class="kk-foot"><button class="kk-chip" id="o-back">← Back</button><span id="o-server"></span></div>
    </div>
  </section>

  <section class="kk-table hidden" id="table">
    <div class="kk-seats" id="seats"></div>
    <div class="kk-center">
      <div class="kk-mat hidden" id="mat"><div class="kk-mat__slot" id="mat-god"></div><div class="kk-mat__slot" id="mat-devil"></div><small>PLAYMAT</small></div>
      <div class="kk-pile" id="pile"><div class="kk-pile__stack" id="pile-stack"></div><div class="kk-pile__info"><b id="pile-count">0</b><span id="pile-odds"></span></div></div>
      <div class="kk-discard" id="discard"><div class="kk-nope-ring hidden" id="nope-ring"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46"/></svg></div></div>
    </div>
    <div class="kk-ticker" id="ticker"></div>
    <div class="kk-me" id="me">
      <div class="kk-me__info"><div class="kk-me__avatar" id="me-avatar"></div><div><b id="me-name"></b><small id="me-turns"></small></div></div>
      <div class="kk-actions">
        <button class="kk-btn kk-btn--nope hidden" id="nope-btn"><span class="kk-display">NOPE!</span></button>
        <button class="kk-btn hidden" id="pass-btn">Pass</button>
        <button class="kk-btn kk-btn--go hidden" id="play-btn"><span class="kk-display">PLAY</span></button>
        <button class="kk-btn kk-btn--draw" id="draw-btn"><span class="kk-display">DRAW</span></button>
      </div>
      <div class="kk-hint" id="hint"></div>
      <div class="kk-hand" id="hand"></div>
    </div>
    <div class="kk-fx" id="fx"></div>
    <canvas class="kk-particles" id="particles"></canvas>
  </section>

  <section class="kk-modal hidden" id="modal"><div class="kk-modal__panel" id="modal-panel"></div></section>
  <section class="kk-modal hidden" id="rules"><div class="kk-modal__panel kk-rules" id="rules-panel"></div></section>
</div>`;

// ============================================================================ helpers

function cardHtml(c: Pick<Card, 'type' | 'cat'> & { id?: number }, cls = ''): string {
  const info = CARD_INFO[c.type];
  return `<div class="kk-card ${cls} t-${c.type}" ${c.id !== undefined ? `data-id="${c.id}"` : ''} style="--c:${info.color}">
    <div class="kk-card__name">${esc(cardName(c))}</div>
    <div class="kk-card__art">${cardArt(c)}</div>
    <div class="kk-card__text">${esc(c.type === 'cat' ? CARD_INFO.cat.text : info.text)}</div>
  </div>`;
}

function backHtml(gold = false, cls = ''): string {
  return `<div class="kk-back ${gold ? 'gold' : ''} ${cls}">${cardBack(gold)}</div>`;
}

/** Replace an element's markup only when it actually changed (no flicker, animations keep running). */
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
  settings.name = nameInput.value.trim() || 'Kitty';
  store.set('kk-name', settings.name);
});
function renderAvatars(): void {
  $('#m-avatars').innerHTML = Array.from({ length: AVATAR_COUNT }, (_, i) => `<button class="kk-av ${i === settings.avatar ? 'on' : ''}" data-i="${i}">${avatar(i)}</button>`).join('');
}
$('#m-avatars').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
  if (!b) return;
  settings.avatar = Number(b.dataset.i);
  store.set('kk-avatar', String(settings.avatar));
  audio.meow();
  renderAvatars();
});
for (const [sel, key] of [['#m-deck', 'deck'], ['#m-bots', 'bots'], ['#m-level', 'level']] as const) {
  $(sel).addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!b) return;
    (settings as Record<string, unknown>)[key] = key === 'bots' ? Number(b.dataset.v) : b.dataset.v;
    store.set(`kk-${key}`, String(b.dataset.v));
    setSeg(sel, b.dataset.v!);
  });
}
renderAvatars();
setSeg('#m-deck', settings.deck);
setSeg('#m-bots', String(settings.bots));
setSeg('#m-level', settings.level);

const soundBtn = $('#sound');
const syncSound = () => (soundBtn.textContent = audio.muted ? '🔇' : '♫');
soundBtn.addEventListener('click', () => {
  audio.setMuted(!audio.muted);
  store.set('kk-muted', audio.muted ? '1' : '0');
  syncSound();
});
syncSound();
bindFullscreenButton($('#fullscreen'), ['⛶', '⛶']);
installFullscreenKey();

$('#rules-panel').innerHTML = `<h2 class="kk-display">HOW TO PLAY</h2>
<p><b>Don't explode.</b> On your turn, play as many cards as you like, then <b>draw a card</b> to end your turn. Draw a <b>Kaboom Kitten</b> and you explode — unless you play a <b>Defuse</b>, then secretly hide the kitten back in the deck. Last cat standing wins.</p>
<p><b>Attack</b> skips your draw and makes the next player take 2 turns (attacks stack: 4, 6…). <b>Targeted Attack</b> picks the victim. <b>Favor</b>: someone gives you a card. <b>Shuffle</b>, <b>See / Reveal the Future</b> (top 3 cards), <b>Raising Heck</b> (take the bottom card or put it on top — ends your turn). <b>Nope</b> cancels any action (even another Nope) — play it any time.</p>
<p><b>Combos:</b> two matching cards steal a random card; three let you name the card you want. Feral Cat matches any cat. In Heaven vs Heck any two cards with the same name pair up.</p>
<p><b>Armageddon</b> (Heaven vs Heck): while the <b>Angel Cat</b> waits on the playmat, play Armageddon to deal the Angel and the <b>Demon Cat</b> face down — one to you, one to a rival. They keep or swap. Angel → into your hand (play it as any card except Nope, even a Defuse). Demon → explode: Defuse or die. Armageddon ends your turn without drawing.</p>
<button class="kk-btn" id="rules-close">Got it</button>`;
$('#rules-btn').addEventListener('click', () => $('#rules').classList.remove('hidden'));
$('#rules').addEventListener('click', (e) => {
  if ((e.target as HTMLElement).id === 'rules' || (e.target as HTMLElement).id === 'rules-close') $('#rules').classList.add('hidden');
});

// ============================================================================ table state

let link: GameLink | null = null;
let view: View | null = null;
let selected = new Set<number>();
let targeting: { cards: number[]; as?: CardType; named?: string } | null = null;
const queue: GameEvent[] = [];
let busyUntil = 0;
let lastFrame = performance.now();

function startLocal(): void {
  settings.name = nameInput.value.trim() || 'Kitty';
  link?.dispose();
  const l = new LocalLink({ name: settings.name, avatar: settings.avatar, bots: settings.bots, level: settings.level, deck: settings.deck });
  attach(l);
}

function attach(l: GameLink): void {
  link = l;
  view = null;
  selected.clear();
  targeting = null;
  queue.length = 0;
  flights = 0;
  shownDiscard = -2;
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
    // Periodic refreshes only move timers: skip the full re-render unless something changed.
    const key = JSON.stringify({ ...v, time: 0, turnLeft: 0, promptLeft: 0, pending: v.pending && { ...v.pending, left: 0 }, prompt: v.prompt && !v.prompt.mine ? { ...v.prompt, left: 0 } : v.prompt });
    if (key !== lastKey || events.length) {
      lastKey = key;
      render();
    }
    updateAt = performance.now();
  };
  l.onError = (msg) => {
    audio.error();
    ticker(msg, 'error');
  };
}

function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  link?.tick(dt);
  // Play queued events one after another so the table can be followed.
  while (queue.length && now >= busyUntil) busyUntil = now + animate(queue.shift()!) * 1000;
  // Once everything has landed, the discard pile catches up with the game.
  if (view && !flights && !queue.length) showDiscard(view.discardTop);
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
  // Seats (everyone but me), in turn order starting after me.
  const i0 = v.players.findIndex((p) => p.id === v.you);
  const order = v.players.map((_, k) => v.players[(i0 + 1 + k) % v.players.length]!).filter((p) => p.id !== v.you);
  setHTML($('#seats'), order
    .map((p) => {
      const turn = v.current === p.id && v.phase !== 'over';
      const backs = Math.min(p.count, 8);
      const fan = Array.from({ length: backs }, (_, k) => `<i style="--k:${k - (backs - 1) / 2}"></i>`).join('');
      return `<div class="kk-seat ${turn ? 'turn' : ''} ${p.alive ? '' : 'dead'} ${targeting && p.alive ? 'targetable' : ''}" data-id="${p.id}">
        <div class="kk-seat__avatar">${avatar(p.avatar, p.alive ? 'normal' : 'dead')}${p.bot ? '<em>BOT</em>' : ''}${p.connected ? '' : '<em class="off">…</em>'}</div>
        <div class="kk-seat__name">${esc(p.name)}</div>
        <div class="kk-seat__fan">${fan}${p.godcat ? '<i class="gold"></i>' : ''}<b>${p.alive ? p.count : 'OUT'}</b></div>
        ${turn && v.turns > 1 ? `<div class="kk-seat__turns">×${v.turns}</div>` : ''}
      </div>`;
    })
    .join(''));
  // Pile + odds.
  setHTML($('#pile-stack'), Array.from({ length: Math.min(6, Math.ceil(v.drawCount / 6)) }, (_, k) => backHtml(false, `s${k}`)).join('') + knownTopHtml(v));
  $('#pile-count').textContent = String(v.drawCount);
  const odds = v.drawCount ? (v.kittens / v.drawCount) * 100 : 0;
  $('#pile-odds').innerHTML = `💣 ${v.kittens} · <b class="${odds > 30 ? 'hot' : odds > 15 ? 'warm' : ''}">${odds.toFixed(0)}%</b>`;
  $('#pile').classList.toggle('mine', v.current === v.you && v.phase === 'play');
  // Discard.
  // The discard pile follows the animations: it only changes when a flying card lands
  // (or when nothing is in flight / queued, to stay in sync with the game).
  if (!flights && !queue.length) showDiscard(v.discardTop);
  // Playmat.
  const gve = v.deck === 'gve';
  $('#mat').classList.toggle('hidden', !gve);
  if (gve) {
    setHTML($('#mat-god'), v.godcatOnMat ? cardHtml({ type: 'godcat' }, 'mini') : '<span>Angel Cat is out!</span>');
    setHTML($('#mat-devil'), cardHtml({ type: 'devilcat' }, 'mini'));
  }
  // Me.
  setHTML($('#me-avatar'), avatar(me?.avatar ?? 0, me?.alive === false ? 'dead' : 'normal'));
  $('#me-name').textContent = me?.name ?? '';
  $('#me').classList.toggle('turn', v.current === v.you && v.phase !== 'over');
  $('#me').classList.toggle('dead', me?.alive === false);
  $('#me-turns').textContent = me?.alive === false ? 'Exploded — spectating' : v.current === v.you ? (v.turns > 1 ? `Your turn ×${v.turns}` : 'Your turn') : `${nameOf(v.current)}'s turn`;
  // Hand (sorted). Keep the old card positions for flight animations.
  rememberHand();
  const hand = [...v.hand].sort((a, b) => CARD_INFO[a.type].order - CARD_INFO[b.type].order || title(a).localeCompare(title(b)));
  for (const id of [...selected]) if (!hand.some((c) => c.id === id)) selected.delete(id);
  const n = hand.length;
  setHTML($('#hand'), hand
    .map((c, k) => {
      const mid = (n - 1) / 2;
      return `<div class="kk-slot" style="--k:${k - mid};--n:${n}">${cardHtml(c, selected.has(c.id) ? 'sel' : '')}</div>`;
    })
    .join(''));
  renderActions();
  if (v.phase === 'over' && !$('#modal').dataset.over) showGameOver();
  renderPrompt();
}

let flights = 0;
let shownDiscard = -2;
function showDiscard(c: Card | null): void {
  const id = c ? c.id : -1;
  if (id === shownDiscard) return;
  shownDiscard = id;
  const disc = $('#discard');
  const ring = $('#nope-ring');
  for (const el of [...disc.children]) if (el !== ring) el.remove();
  disc.insertAdjacentHTML('afterbegin', c ? cardHtml(c, 'discard-top') : '<div class="kk-discard__empty">DISCARD</div>');
}

function knownTopHtml(v: View): string {
  const top = v.known.filter((k) => k.index < 3).sort((a, b) => a.index - b.index);
  if (!top.length) return '';
  return `<div class="kk-known">${top.map((k) => `<span class="${k.card.type === 'kitten' ? 'bad' : ''}">#${k.index + 1} ${esc(cardName(k.card))}</span>`).join('')}</div>`;
}

/** What the current selection would do (or why not). */
function selectionPlay(): { ok: boolean; label: string; needsTarget: boolean; needsAs: boolean; needsName: boolean } {
  const v = view!;
  const cards = v.hand.filter((c) => selected.has(c.id));
  const none = { ok: false, label: '', needsTarget: false, needsAs: false, needsName: false };
  if (!cards.length) return none;
  if (cards.length === 1) {
    const c = cards[0]!;
    if (c.type === 'godcat') return { ok: true, label: 'PLAY AS…', needsTarget: false, needsAs: true, needsName: false };
    if (['defuse', 'nope', 'cat', 'feral', 'kitten'].includes(c.type)) return { ...none, label: c.type === 'defuse' ? 'Defuse is automatic' : c.type === 'nope' ? 'Nope is for others’ actions' : 'Pick a matching card' };
    if (c.type === 'armageddon' && !v.godcatOnMat) return { ...none, label: 'Angel Cat is out' };
    return { ok: true, label: 'PLAY', needsTarget: c.type === 'favor' || c.type === 'targeted', needsAs: false, needsName: false };
  }
  if (cards.length > 3) return { ...none, label: 'Too many cards' };
  const titles = cards.filter((c) => c.type !== 'feral').map(title);
  const allCats = titles.every((t) => t.startsWith('cat:'));
  if (cards.some((c) => c.type === 'godcat')) return { ...none, label: 'Angel Cat can’t combo' };
  if (new Set(titles).size > 1 || (cards.some((c) => c.type === 'feral') && !allCats)) return { ...none, label: 'Cards must match' };
  if (!DECKS[v.deck].anyPairs && !allCats) return { ...none, label: 'Only cat cards pair up' };
  return { ok: true, label: cards.length === 2 ? 'STEAL (PAIR)' : 'STEAL (TRIPLE)', needsTarget: true, needsAs: false, needsName: cards.length === 3 };
}

function renderActions(): void {
  const v = view!;
  const myTurn = v.current === v.you && v.phase === 'play';
  const canNope = v.phase === 'nope' && v.pending && !v.pending.passed && v.hand.some((c) => c.type === 'nope') && (v.pending.by !== v.you || v.pending.nopes % 2 === 1) && v.players.find((p) => p.id === v.you)?.alive;
  $('#nope-btn').classList.toggle('hidden', !canNope);
  $('#pass-btn').classList.toggle('hidden', !canNope);
  if (canNope) $('#nope-btn').innerHTML = `<span class="kk-display">${v.pending!.nopes % 2 ? 'YUP!' : 'NOPE!'}</span>`;
  const sp = selectionPlay();
  $('#play-btn').classList.toggle('hidden', !myTurn || !selected.size || !sp.ok);
  $('#play-btn').innerHTML = `<span class="kk-display">${sp.label || 'PLAY'}</span>`;
  $('#draw-btn').classList.toggle('hidden', !myTurn);
  $('#hint').textContent = targeting ? 'Choose a player ↑' : myTurn ? (selected.size && !sp.ok ? sp.label : selected.size ? '' : 'Play cards, then draw to end your turn') : v.phase === 'nope' ? 'Anyone can Nope…' : '';
}

function renderTimers(): void {
  const v = view!;
  const ring = $('#nope-ring');
  const show = v.phase === 'nope' && v.pending;
  ring.classList.toggle('hidden', !show);
  if (show) {
    const total = link?.online ? 3.5 : 2.6;
    const left = Math.max(0, v.pending!.left - (performance.now() - updateAt) / 1000);
    ring.style.setProperty('--p', String(Math.min(1, left / total)));
  }
}
let updateAt = performance.now();

function ticker(text: string, kind = ''): void {
  const t = $('#ticker');
  const el = document.createElement('div');
  el.className = `kk-tick ${kind}`;
  el.innerHTML = text;
  t.prepend(el);
  while (t.children.length > 4) t.lastElementChild!.remove();
  setTimeout(() => el.classList.add('old'), 4000);
}

// ============================================================================ input

$('#hand').addEventListener('click', (e) => {
  const card = (e.target as HTMLElement).closest<HTMLElement>('.kk-card');
  if (!card || !view) return;
  const id = Number(card.dataset.id);
  if (selected.has(id)) selected.delete(id);
  else selected.add(id);
  targeting = null;
  audio.card();
  render();
});

$('#play-btn').addEventListener('click', () => {
  if (!view || !link) return;
  const sp = selectionPlay();
  if (!sp.ok) return;
  const cards = [...selected];
  if (sp.needsAs) return pickAs(cards[0]!);
  if (sp.needsName) return pickName(cards);
  if (sp.needsTarget) {
    targeting = { cards };
    render();
    return;
  }
  send({ t: 'play', cards });
});

function send(a: Action): void {
  rememberHand();
  link?.send(a);
  if (a.t === 'play') {
    selected.clear();
    targeting = null;
  }
}

$('#seats').addEventListener('click', (e) => {
  const seat = (e.target as HTMLElement).closest<HTMLElement>('.kk-seat.targetable');
  if (!seat || !targeting) return;
  send({ t: 'play', cards: targeting.cards, target: seat.dataset.id, as: targeting.as, named: targeting.named });
});
$('#draw-btn').addEventListener('click', () => send({ t: 'draw' }));
$('#pile').addEventListener('click', () => {
  if (view?.current === view?.you && view?.phase === 'play') send({ t: 'draw' });
});
$('#pass-btn').addEventListener('click', () => send({ t: 'pass' }));
$('#nope-btn').addEventListener('click', () => {
  const nope = view?.hand.find((c) => c.type === 'nope');
  if (nope) send({ t: 'nope', card: nope.id });
});
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    targeting = null;
    selected.clear();
    render();
  }
  if ((e.key === 'n' || e.key === 'N') && !$('#nope-btn').classList.contains('hidden')) $('#nope-btn').click();
  if ((e.key === 'd' || e.key === ' ') && !$('#draw-btn').classList.contains('hidden') && document.activeElement?.tagName !== 'INPUT') {
    e.preventDefault();
    send({ t: 'draw' });
  }
});

// ============================================================================ modals

let promptShown = -1;
function openModal(html: string, cls = ''): HTMLElement {
  const m = $('#modal');
  m.classList.remove('hidden');
  const p = $('#modal-panel');
  p.className = `kk-modal__panel ${cls}`;
  p.innerHTML = html;
  return p;
}
function closeModal(): void {
  $('#modal').classList.add('hidden');
  delete $('#modal').dataset.over;
  promptShown = -1;
}

function pickAs(godId: number): void {
  const v = view!;
  const opts = GODCAT_AS.filter((t) => (v.deck === 'classic' ? t !== 'reveal' : t !== 'skip' && t !== 'future'));
  const p = openModal(`<h3 class="kk-display">PLAY THE ANGEL CAT AS…</h3><div class="kk-pick">${opts.map((t) => `<button data-t="${t}">${cardHtml({ type: t }, 'mini')}</button>`).join('')}</div><button class="kk-chip" data-cancel>Cancel</button>`, 'angel');
  p.onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-t],[data-cancel]');
    if (!b) return;
    closeModal();
    if (b.dataset.cancel !== undefined) return;
    const as = b.dataset.t as CardType;
    if (as === 'favor' || as === 'targeted') {
      targeting = { cards: [godId], as };
      render();
    } else send({ t: 'play', cards: [godId], as });
  };
}

function pickName(cards: number[]): void {
  const v = view!;
  const types: Array<{ key: string; card: Pick<Card, 'type' | 'cat'> }> = [{ key: 'defuse', card: { type: 'defuse' } }, { key: 'nope', card: { type: 'nope' } }];
  if (v.deck === 'gve') types.push({ key: 'godcat', card: { type: 'godcat' } }, { key: 'armageddon', card: { type: 'armageddon' } }, { key: 'targeted', card: { type: 'targeted' } });
  types.push({ key: 'attack', card: { type: 'attack' } }, { key: v.deck === 'gve' ? 'reveal' : 'future', card: { type: v.deck === 'gve' ? 'reveal' : 'future' } }, { key: 'favor', card: { type: 'favor' } }, { key: 'shuffle', card: { type: 'shuffle' } });
  if (v.deck === 'classic') types.push({ key: 'skip', card: { type: 'skip' } });
  const p = openModal(`<h3 class="kk-display">NAME THE CARD YOU WANT</h3><div class="kk-pick">${types.map((t) => `<button data-n="${t.key}">${cardHtml(t.card, 'mini')}</button>`).join('')}</div><button class="kk-chip" data-cancel>Cancel</button>`);
  p.onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-n],[data-cancel]');
    if (!b) return;
    closeModal();
    if (b.dataset.cancel !== undefined) return;
    targeting = { cards, named: b.dataset.n };
    render();
  };
}

function renderPrompt(): void {
  const v = view!;
  const pr = v.prompt;
  if (!pr || !pr.mine) {
    if (promptShown !== -1 && !$('#modal').dataset.over) closeModal();
    if (pr && !pr.mine && (pr.k === 'armPick' || pr.k === 'armDeal')) armWaiting(pr.player, pr.k);
    return;
  }
  if (promptShown === pr.id) return;
  promptShown = pr.id;
  const respond = (choice: Extract<Action, { t: 'respond' }>['choice']) => {
    closeModal();
    send({ t: 'respond', prompt: pr.id, choice });
  };
  switch (pr.k) {
    case 'insert': {
      const size = pr.size;
      const p = openModal(`<div class="kk-modal__kitten">${cardHtml({ type: 'kitten' }, 'mini')}</div><h3 class="kk-display">DEFUSED! HIDE THE KITTEN</h3><p>Where in the deck? (${size} cards)</p>
        <div class="kk-insert"><button data-i="0">Top 😈</button><button data-i="1">2nd</button><button data-i="2">3rd</button><button data-i="${Math.floor(size / 2)}">Middle</button><button data-i="${size}">Bottom</button><button data-i="rand">🎲 Random</button></div>
        <input type="range" min="0" max="${size}" value="0" id="ins-range" /><button class="kk-btn kk-btn--go" id="ins-go"><span class="kk-display">HIDE AT #<b id="ins-n">1</b></span></button>`, 'kitten');
      const range = $<HTMLInputElement>('#ins-range', p);
      range.oninput = () => ($('#ins-n', p).textContent = String(Number(range.value) + 1));
      p.onclick = (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
        if (b) respond(b.dataset.i === 'rand' ? Math.floor(Math.random() * (size + 1)) : Math.min(size, Number(b.dataset.i)));
        if ((e.target as HTMLElement).closest('#ins-go')) respond(Number(range.value));
      };
      break;
    }
    case 'give': {
      const p = openModal(`<h3 class="kk-display">FAVOR FOR ${esc(nameOf(pr.to).toUpperCase())}</h3><p>Pick a card to give away.</p><div class="kk-pick">${v.hand.map((c) => `<button data-c="${c.id}">${cardHtml(c, 'mini')}</button>`).join('')}</div>`);
      p.onclick = (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('[data-c]');
        if (b) respond(Number(b.dataset.c));
      };
      break;
    }
    case 'fan': {
      const n = pr.fanCount ?? 1;
      const p = openModal(`<h3 class="kk-display">STEAL FROM ${esc(nameOf(pr.from).toUpperCase())}</h3><p>Pick a card — any card.${(pr.fanGod ?? -1) >= 0 ? ' (That golden one looks heavenly…)' : ''}</p><div class="kk-fanpick">${Array.from({ length: n }, (_, i) => `<button data-i="${i}" style="--k:${i - (n - 1) / 2}">${backHtml(i === pr.fanGod)}</button>`).join('')}</div>`);
      p.onclick = (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
        if (b) respond(Number(b.dataset.i));
      };
      break;
    }
    case 'heck': {
      const p = openModal(`<h3 class="kk-display">RAISING HECK</h3><p>You pulled the bottom card:</p><div class="kk-big">${cardHtml(pr.card)}</div><div class="kk-two"><button class="kk-btn kk-btn--go" data-v="keep"><span class="kk-display">${pr.card.type === 'kitten' ? 'KEEP (EXPLODE!)' : 'KEEP IT'}</span></button><button class="kk-btn" data-v="top">Put it on top</button></div>`, pr.card.type === 'kitten' ? 'kitten' : '');
      p.onclick = (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('[data-v]');
        if (b) respond(b.dataset.v!);
      };
      break;
    }
    case 'armDeal': {
      const others = v.players.filter((x) => x.alive && x.id !== v.you);
      let target = others[0]?.id ?? '';
      const p = openModal(`<h3 class="kk-display arm">ARMAGEDDON!</h3><p>You hold the Angel and the Demon. Pick a rival and the card you deal them — they may swap with you.</p>
        <div class="kk-two">${cardHtml({ type: 'godcat' }, 'mini')}${cardHtml({ type: 'devilcat' }, 'mini')}</div>
        <div class="kk-targets">${others.map((o, i) => `<button class="${i === 0 ? 'on' : ''}" data-t="${o.id}">${avatar(o.avatar)}<b>${esc(o.name)}</b></button>`).join('')}</div>
        <div class="kk-two"><button class="kk-btn kk-btn--angel" data-g="godcat"><span class="kk-display">GIVE THEM THE ANGEL</span></button><button class="kk-btn kk-btn--devil" data-g="devilcat"><span class="kk-display">GIVE THEM THE DEMON</span></button></div>`, 'arm');
      p.onclick = (e) => {
        const t = (e.target as HTMLElement).closest<HTMLElement>('[data-t]');
        if (t) {
          target = t.dataset.t!;
          for (const b of p.querySelectorAll('[data-t]')) b.classList.toggle('on', b === t);
        }
        const g = (e.target as HTMLElement).closest<HTMLElement>('[data-g]');
        if (g) respond({ target, give: g.dataset.g as 'godcat' | 'devilcat' });
      };
      break;
    }
    case 'armPick': {
      const p = openModal(`<h3 class="kk-display arm">ARMAGEDDON!</h3><p><b>${esc(nameOf(pr.against))}</b> dealt you one cat face down and kept the other. One is the Angel… one is the Demon.</p>
        <div class="kk-two arm-cards"><div>${backHtml(false, 'big')}<small>YOURS</small></div><div>${backHtml(false, 'big')}<small>${esc(nameOf(pr.against).toUpperCase())}'S</small></div></div>
        <div class="kk-two"><button class="kk-btn kk-btn--go" data-v="keep"><span class="kk-display">KEEP MINE</span></button><button class="kk-btn kk-btn--devil" data-v="swap"><span class="kk-display">SWAP!</span></button></div>`, 'arm');
      audio.drumroll();
      p.onclick = (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('[data-v]');
        if (b) respond(b.dataset.v!);
      };
      break;
    }
  }
}

function armWaiting(player: string, k: string): void {
  if (promptShown === -2) return;
  promptShown = -2;
  openModal(`<h3 class="kk-display arm">ARMAGEDDON!</h3><p>${esc(nameOf(player))} is ${k === 'armDeal' ? 'dealing the Angel and the Demon…' : 'deciding: keep or swap?'}</p><div class="kk-two arm-cards"><div>${cardHtml({ type: 'godcat' }, 'mini')}</div><div>${cardHtml({ type: 'devilcat' }, 'mini')}</div></div>`, 'arm watching');
}

function showGameOver(): void {
  const v = view!;
  const won = v.winner === v.you;
  const w = v.players.find((p) => p.id === v.winner);
  $('#modal').dataset.over = '1';
  const p = openModal(`<div class="kk-over__avatar">${avatar(w?.avatar ?? 0)}</div><h2 class="kk-display ${won ? 'gold' : 'pink'}">${won ? 'YOU SURVIVED!' : `${esc((w?.name ?? 'Nobody').toUpperCase())} WINS`}</h2><p>${won ? 'Last cat standing. Not a single whisker singed.' : 'You will be remembered as a fine pile of fluff.'}</p>
    <div class="kk-two"><button class="kk-btn kk-btn--go" id="again"><span class="kk-display">${link?.online ? 'BACK TO LOBBY' : 'PLAY AGAIN'}</span></button><button class="kk-btn" id="to-menu">Menu</button></div>`, 'over');
  audio.win(won);
  if (won) particles.confetti();
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
    case 'start':
      ticker(`New game — ${DECKS[ev.deck].name} deck. Don't explode!`);
      return 0.3;
    case 'turn':
      if (ev.player === me && v.players.find((p) => p.id === me)?.alive) {
        audio.turn();
        banner(ev.turns > 1 ? `YOUR TURN ×${ev.turns}` : 'YOUR TURN', 'gold');
      }
      return 0.25;
    case 'play': {
      audio.card();
      const what = ev.as ? `the <b>Angel Cat</b> as ${CARD_INFO[ev.as].name}` : ev.cards.length > 1 ? `a ${ev.cards.length === 2 ? 'pair' : 'triple'} (${esc(cardName(ev.cards[0]!))})` : `<b>${esc(cardName(ev.cards[0]!))}</b>`;
      ticker(`${who(ev.by)} played ${what}${ev.target ? ` on ${who(ev.target)}` : ''}${ev.named ? ` — wants ${esc(ev.named === 'godcat' ? 'the Angel Cat' : (CARD_INFO[ev.named as CardType]?.name ?? ev.named))}` : ''}`);
      ev.cards.forEach((c, i) => {
        const from = ev.by === me ? (lastHandRects.get(c.id) ?? seatRect(ev.by)) : seatRect(ev.by);
        flyToDiscard(from, c, i * 0.08);
      });
      if (ev.cards[0]?.type === 'armageddon') {
        audio.devil();
        banner('ARMAGEDDON!', 'pink');
      }
      return ev.cards.length > 1 ? 0.6 : 0.45;
    }
    case 'nope':
      audio.nope();
      stamp(ev.count % 2 ? 'NOPE!' : 'YUP!', ev.count % 2 ? 'nope' : 'yup');
      ticker(`${who(ev.by)}: ${ev.count % 2 ? 'NOPE!' : 'YUP!'}`);
      flyToDiscard(ev.by === me ? (lastHandRects.get(ev.card.id) ?? seatRect(ev.by)) : seatRect(ev.by), ev.card);
      shake(6);
      return 0.7;
    case 'resolve':
      if (!ev.ok) ticker('…and it was Noped.', 'dim');
      return 0.1;
    case 'draw':
      audio.draw();
      fly($('#pile').getBoundingClientRect(), seatRect(ev.by), ev.card && ev.by === me ? cardHtml(ev.card) : backHtml());
      if (ev.by === me && ev.card && ev.card.type !== 'kitten') ticker(`You ${ev.bottom ? 'pulled from the bottom' : 'drew'} <b>${esc(cardName(ev.card))}</b>`);
      return ev.card?.type === 'kitten' ? 0.5 : 0.35;
    case 'explode': {
      audio.fuse();
      const demon = ev.card.type === 'devilcat';
      ticker(`💥 ${who(ev.by)} got ${demon ? 'the <b>Demon Cat</b>' : 'a <b>Kaboom Kitten</b>'}!`, 'bad');
      bigCard(ev.card, demon ? 'DEMON CAT!' : 'KABOOM KITTEN!');
      link?.hold(2.2);
      setTimeout(() => {
        audio.boom();
        shake(18);
        const r = seatRect(ev.by);
        particles.explode(r.left + r.width / 2, r.top + r.height / 2);
      }, 900);
      return 1.5;
    }
    case 'defuse':
      audio.defuse();
      stamp(ev.card.type === 'godcat' ? 'SAVED BY AN ANGEL!' : 'DEFUSED!', 'defuse');
      ticker(`${who(ev.by)} ${ev.card.type === 'godcat' ? 'was saved by the Angel Cat' : 'defused it'}!`, 'good');
      return 0.9;
    case 'insert':
      ticker(ev.by === me ? `You hid the kitten at position <b>#${(ev.index ?? 0) + 1}</b> 🤫` : `${who(ev.by)} hid the kitten back in the deck…`);
      return 0.3;
    case 'eliminated':
      audio.meow(false);
      stamp(ev.by === me ? 'YOU EXPLODED!' : `${nameOf(ev.by).toUpperCase()} EXPLODED!`, 'boom');
      ticker(`☠️ ${who(ev.by)} ${ev.by === me ? 'are' : 'is'} out!`, 'bad');
      link?.hold(1.2);
      return 1.2;
    case 'steal':
    case 'give': {
      audio.steal();
      const known = ev.card && (ev.from === me || ev.to === me);
      fly(seatRect(ev.from), seatRect(ev.to), known ? cardHtml(ev.card!) : backHtml(ev.card?.type === 'godcat'));
      ticker(`${who(ev.to)} ${ev.k === 'steal' ? 'stole' : 'got'} ${known ? `<b>${esc(cardName(ev.card!))}</b>` : 'a card'} from ${who(ev.from)}`);
      return 0.6;
    }
    case 'missed':
      ticker(`${who(ev.from)} didn't have it! 😹`);
      return 0.4;
    case 'shuffle':
      audio.shuffle();
      $('#pile').classList.remove('shuffling');
      void $('#pile').offsetWidth;
      $('#pile').classList.add('shuffling');
      ticker(`${who(ev.by)} shuffled the deck`);
      return 0.7;
    case 'future':
      if (ev.cards) {
        showTop(ev.cards, 'THE FUTURE (ONLY YOU SEE IT)');
        link?.hold(1.6);
        return 1.2;
      }
      ticker(`${who(ev.by)} peeked at the future 🔮`);
      return 0.4;
    case 'reveal':
      showTop(ev.cards, `${nameOf(ev.by).toUpperCase()} REVEALED THE FUTURE`);
      link?.hold(1.6);
      return 1.2;
    case 'heckTop':
      ticker(`${who(ev.by)} put the bottom card on top${ev.card ? ` (<b>${esc(cardName(ev.card))}</b>)` : ''}`);
      return 0.4;
    case 'attacked':
      if (ev.target === me) banner(`ATTACKED! ×${ev.turns}`, 'pink');
      ticker(`${who(ev.target)} must take <b>${ev.turns} turns</b>!`);
      shake(5);
      return 0.6;
    case 'armStart':
      return 0.3;
    case 'armDeal':
      ticker(`${who(ev.by)} dealt the Angel & Demon to ${who(ev.target)}…`);
      return 0.3;
    case 'armPick':
      audio.drumroll();
      ticker(`${who(ev.by)} chose to <b>${ev.swap ? 'SWAP' : 'KEEP'}</b>!`);
      return 1;
    case 'armReveal': {
      audio.angel();
      closeModal();
      const p = openModal(`<h3 class="kk-display arm">THE REVEAL</h3><div class="kk-two arm-cards"><div class="flip">${cardHtml({ type: 'godcat' }, 'mini')}<small>${esc(nameOf(ev.god))}</small></div><div class="flip">${cardHtml({ type: 'devilcat' }, 'mini')}<small>${esc(nameOf(ev.devil))}</small></div></div>`, 'arm watching');
      setTimeout(() => {
        if (p.classList.contains('arm')) closeModal();
      }, 2200);
      ticker(`😇 ${who(ev.god)} won the <b>Angel Cat</b> · 😈 ${who(ev.devil)} got the <b>Demon</b>!`);
      link?.hold(2.6);
      return 2.2;
    }
    case 'godcatHome':
      return 0.2;
    case 'win':
      return 0.5;
  }
  return 0;
}

function seatRect(id: string): DOMRect {
  if (view && id === view.you) return $('#hand').getBoundingClientRect();
  const s = document.querySelector<HTMLElement>(`.kk-seat[data-id="${id}"] .kk-seat__avatar`);
  return s?.getBoundingClientRect() ?? $('#pile').getBoundingClientRect();
}

/** Remember where my cards are on screen (they leave the hand before the play animates). */
const lastHandRects = new Map<number, DOMRect>();
function rememberHand(): void {
  if (lastHandRects.size > 60) lastHandRects.clear();
  for (const el of document.querySelectorAll<HTMLElement>('#hand .kk-card[data-id]')) lastHandRects.set(Number(el.dataset.id), el.getBoundingClientRect());
}

function flyToDiscard(from: DOMRect, c: Card, delay = 0): void {
  flights++;
  fly(from, $('#discard').getBoundingClientRect(), cardHtml(c), delay, () => {
    flights--;
    showDiscard(c);
  });
}

function fly(from: DOMRect, to: DOMRect, html: string, delay = 0, done?: () => void): void {
  const el = document.createElement('div');
  el.className = 'kk-flyer';
  el.innerHTML = html;
  $('#fx').appendChild(el);
  const x0 = from.left + from.width / 2;
  const y0 = from.top + from.height / 2;
  const x1 = to.left + to.width / 2;
  const y1 = to.top + to.height / 2;
  const anim = el.animate(
    [
      { transform: `translate(${x0}px, ${y0}px) translate(-50%, -50%) scale(0.5) rotate(-10deg)`, opacity: 0.4 },
      { transform: `translate(${(x0 + x1) / 2}px, ${Math.min(y0, y1) - 60}px) translate(-50%, -50%) scale(0.9) rotate(6deg)`, opacity: 1, offset: 0.5 },
      { transform: `translate(${x1}px, ${y1}px) translate(-50%, -50%) scale(0.7) rotate(0deg)`, opacity: 1 },
    ],
    { duration: 520, delay: delay * 1000, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'both' },
  );
  anim.onfinish = () => {
    done?.();
    el.remove();
  };
}

function banner(text: string, tone: string): void {
  const el = document.createElement('div');
  el.className = `kk-banner kk-display ${tone}`;
  el.textContent = text;
  $('#fx').appendChild(el);
  setTimeout(() => el.remove(), 1500);
}

function stamp(text: string, kind: string): void {
  const el = document.createElement('div');
  el.className = `kk-stamp kk-display ${kind}`;
  el.textContent = text;
  $('#fx').appendChild(el);
  setTimeout(() => el.remove(), 1300);
}

function bigCard(c: Card, label: string): void {
  const el = document.createElement('div');
  el.className = 'kk-bigcard';
  el.innerHTML = `${cardHtml(c)}<div class="kk-display">${label}</div>`;
  $('#fx').appendChild(el);
  setTimeout(() => el.remove(), 1500);
}

function showTop(cards: Card[], label: string): void {
  const el = document.createElement('div');
  el.className = 'kk-future';
  el.innerHTML = `<div class="kk-display">${esc(label)}</div><div class="kk-future__cards">${cards.map((c, i) => `<div style="--i:${i}"><small>#${i + 1}</small>${cardHtml(c)}</div>`).join('')}</div>`;
  $('#fx').appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

function shake(px: number): void {
  $('#table').animate(
    Array.from({ length: 8 }, (_, i) => ({ transform: `translate(${(Math.random() - 0.5) * px * (1 - i / 8)}px, ${(Math.random() - 0.5) * px * (1 - i / 8)}px)` })).concat([{ transform: 'none' }]),
    { duration: 420 },
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
    explode(x: number, y: number) {
      for (let i = 0; i < 90; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = 150 + Math.random() * 650;
        list.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 120, life: 0.6 + Math.random() * 0.8, max: 1.4, size: 6 + Math.random() * 16, color: ['#ffd23f', '#ff8c1a', '#ff4b5c', '#fff3b0'][i % 4]!, g: 500 });
      }
      for (let i = 0; i < 30; i++) list.push({ x, y, vx: (Math.random() - 0.5) * 200, vy: -Math.random() * 200, life: 1.5, max: 1.5, size: 30 + Math.random() * 40, color: 'rgba(60,50,80,0.5)', g: -30 });
    },
    confetti() {
      for (let i = 0; i < 160; i++) list.push({ x: Math.random() * innerWidth, y: -20 - Math.random() * 200, vx: (Math.random() - 0.5) * 120, vy: 100 + Math.random() * 200, life: 3.5, max: 3.5, size: 8 + Math.random() * 8, color: ['#ffd23f', '#ff4fd8', '#3fd8ff', '#43c26b', '#ff8c1a'][i % 5]!, g: 60, spin: Math.random() * 10, rect: true });
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

let net: KittensNet | null = null;
let lobby: KkLobby | null = null;
let lanUrl: string | null = null;
const oCode = $<HTMLInputElement>('#o-code');
oCode.addEventListener('input', () => (oCode.value = oCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4)));
const oStatus = (t: string, err = false) => {
  $('#o-status').textContent = t;
  $('#o-status').classList.toggle('error', err);
};

async function openOnline(code = ''): Promise<void> {
  settings.name = nameInput.value.trim() || 'Kitty';
  $('#menu').classList.add('hidden');
  $('#online').classList.remove('hidden');
  $('#o-connect').classList.remove('hidden');
  $('#o-lobby').classList.add('hidden');
  if (code) oCode.value = code.toUpperCase().slice(0, 4);
  oStatus('');
  const probe = new KittensNet();
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
}

async function connect(how: (n: KittensNet) => Promise<void>): Promise<void> {
  if (net?.room) return;
  oStatus('Connecting…');
  const n = new KittensNet();
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
    if (link) ticker(m, 'error');
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
    .map((p) => `<div class="kk-lp ${p.id === net!.sessionId ? 'me' : ''}">${avatar(p.avatar)}<b>${esc(p.name)}</b><small>${p.bot ? 'BOT' : p.id === l.hostId ? 'HOST' : p.id === net!.sessionId ? 'YOU' : ''}${p.connected ? '' : ' · reconnecting'}</small></div>`)
    .join('');
  $('#o-host').classList.toggle('hidden', !host || l.phase === 'playing');
  setSeg('#o-deck', l.config.deck);
  setSeg('#o-bots', String(l.config.bots));
  const humans = l.players.filter((p) => !p.bot).length;
  $('#o-wait').textContent = l.phase === 'playing' ? 'Game in progress…' : host ? (l.players.length < 2 ? 'Add bots or wait for friends, then start.' : '') : 'Waiting for the host to start…';
  ($('#o-start') as HTMLButtonElement).disabled = l.players.length < 2;
  void humans;
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
for (const [sel, key] of [['#o-deck', 'deck'], ['#o-bots', 'bots']] as const) {
  $(sel).addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (b) net?.config({ [key]: key === 'bots' ? Number(b.dataset.v) : b.dataset.v });
  });
}
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
(window as unknown as Record<string, unknown>).__kk = {
  /** Dev: every card face in a modal (art check). */
  gallery() {
    const all: Array<Pick<Card, 'type' | 'cat'>> = (Object.keys(CARD_INFO) as CardType[]).filter((t) => t !== 'cat').map((type) => ({ type }));
    for (const d of Object.values(DECKS)) for (const cat of d.cats) all.push({ type: 'cat', cat });
    openModal(`<div class="kk-pick">${all.map((c) => cardHtml(c)).join('')}${backHtml()}${backHtml(true)}</div>`);
    $('#modal-panel').style.width = '96vw';
  },
  get link() {
    return link;
  },
  get view() {
    return view;
  },
};
