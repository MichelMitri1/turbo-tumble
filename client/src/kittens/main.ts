import './styles.css';
import { CARD_INFO, DECKS, GODCAT_AS, cardName, title, typesInPlay, type Card, type CardType, type DeckId } from './cards';
import { avatar, cardArt, cardBack, AVATAR_COUNT } from './art';
import { LocalLink, type GameLink } from './link';
import type { Action, Choice, GameEvent, Rules } from './engine';
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
const savedDeck = (store.get('kk-deck') as DeckId) || 'gve';
const settings = {
  name: store.get('kk-name') || `Kitty${Math.floor(100 + Math.random() * 900)}`,
  avatar: Number(store.get('kk-avatar') ?? Math.floor(Math.random() * AVATAR_COUNT)),
  bots: Number(store.get('kk-bots') ?? 3),
  level: (store.get('kk-level') as BotLevel) || 'normal',
  deck: savedDeck,
  // Rule options (B2/B3/E): the pairing rule follows the deck unless changed.
  fullDeck: store.get('kk-fullDeck') === '1',
  anyPairs: store.get('kk-anyPairs') === null ? DECKS[savedDeck].anyPairs : store.get('kk-anyPairs') === '1',
  imploding: store.get('kk-imploding') === '1',
};

/** Option rows shared by the bot-game menu and the online lobby. */
const ruleRows = (p: string) => `
      <div class="kk-row"><label>Pairs</label><div class="kk-seg" id="${p}-anyPairs"><button data-v="0">🐾 Cat cards only <small>classic</small></button><button data-v="1">🃏 Any matching pair <small>current rules</small></button></div></div>
      <div class="kk-row"><label>2–3 players</label><div class="kk-seg" id="${p}-fullDeck"><button data-v="0">⚡ Short deck <small>house rule</small></button><button data-v="1">📚 Full deck</button></div></div>
      <div class="kk-row"><label>Expansion</label><div class="kk-seg" id="${p}-imploding"><button data-v="0">Off</button><button data-v="1">🌀 Imploding Kittens <small>Reverse · Alter · Bottom</small></button></div></div>`;

document.getElementById('game')!.innerHTML = `
<div class="kk-shell">
  <div class="kk-topbar">
    <a class="kk-chip" href="/">← Arcade</a>
    <div class="kk-topbar__right"><button class="kk-chip hidden" id="log-btn">📜 Log</button><button class="kk-chip" id="rules-btn">? Rules</button><button class="kk-chip" id="sound"></button><button class="kk-chip" id="fullscreen"></button></div>
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
      <details class="kk-more" id="m-more"><summary>Rules &amp; expansion <span id="m-summary"></span></summary>${ruleRows('m')}</details>
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
          ${ruleRows('o')}
          <button class="kk-btn kk-btn--go" id="o-start"><span class="kk-display">START GAME</span></button>
        </div>
        <p class="kk-rulesline" id="o-rules"></p>
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
      <div class="kk-pile" id="pile"><div class="kk-pile__stack" id="pile-stack"></div><div class="kk-pile__info"><b id="pile-count">0</b><span id="pile-odds"></span></div><div class="kk-dir hidden" id="dir"></div></div>
      <div class="kk-discard" id="discard" title="Discard pile — click to browse"><div class="kk-nope-ring hidden" id="nope-ring"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46"/></svg></div><b class="kk-discard__count" id="discard-count"></b></div>
      <div class="kk-peek" id="peek" title="Draw-pile cards you know (#1 is drawn next)"></div>
    </div>
    <div class="kk-lane"><div class="kk-waiting hidden" id="waiting"></div><div class="kk-ticker" id="ticker" title="Click for the full log"></div></div>
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

  <div class="kk-preview hidden" id="preview"></div>
  <section class="kk-modal hidden" id="modal"><div class="kk-modal__panel" id="modal-panel"></div></section>
  <section class="kk-modal hidden" id="rules"><div class="kk-modal__panel kk-rules" id="rules-panel"></div></section>
</div>`;

// ============================================================================ helpers

/** `short`: the one-line text used on cards in your hand (legible at hand size). */
function cardHtml(c: Pick<Card, 'type' | 'cat'> & { id?: number }, cls = '', short = false): string {
  const info = CARD_INFO[c.type];
  const text = c.type === 'cat' ? (short ? CARD_INFO.cat.short : CARD_INFO.cat.text) : short ? info.short : info.text;
  return `<div class="kk-card ${cls} t-${c.type}" ${c.id !== undefined ? `data-id="${c.id}"` : ''} style="--c:${info.color}">
    <div class="kk-card__name">${esc(cardName(c))}</div>
    <div class="kk-card__art">${cardArt(c)}</div>
    <div class="kk-card__text">${esc(text)}</div>
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

function rulesSummary(deck: DeckId, r: Rules): string {
  return [DECKS[deck].name, r.anyPairs ? 'any pairs' : 'cat pairs only', r.fullDeck ? 'full deck' : 'short deck (2–3p)', r.imploding ? '🌀 Imploding Kittens' : ''].filter(Boolean).join(' · ');
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
function syncMenuRules(): void {
  setSeg('#m-anyPairs', settings.anyPairs ? '1' : '0');
  setSeg('#m-fullDeck', settings.fullDeck ? '1' : '0');
  setSeg('#m-imploding', settings.imploding ? '1' : '0');
  $('#m-summary').textContent = `— ${rulesSummary(settings.deck, settings)}`;
}
for (const [sel, key] of [['#m-deck', 'deck'], ['#m-bots', 'bots'], ['#m-level', 'level'], ['#m-anyPairs', 'anyPairs'], ['#m-fullDeck', 'fullDeck'], ['#m-imploding', 'imploding']] as const) {
  $(sel).addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!b) return;
    const v = b.dataset.v!;
    if (key === 'bots') settings.bots = Number(v);
    else if (key === 'deck' || key === 'level') (settings as Record<string, unknown>)[key] = v;
    else settings[key] = v === '1';
    store.set(`kk-${key}`, v);
    // A new deck brings its own pairing rule back.
    if (key === 'deck') {
      settings.anyPairs = DECKS[settings.deck].anyPairs;
      store.set('kk-anyPairs', settings.anyPairs ? '1' : '0');
    }
    setSeg(sel, v);
    syncMenuRules();
  });
}
renderAvatars();
setSeg('#m-deck', settings.deck);
setSeg('#m-bots', String(settings.bots));
setSeg('#m-level', settings.level);
syncMenuRules();

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
<p><b>Don't explode.</b> On your turn, play as many cards as you like, then <b>draw a card</b> to end your turn. Draw a <b>Kaboom Kitten</b> and you explode — unless you play a <b>Defuse</b>, then secretly hide the kitten back in the deck. Last cat standing wins. Exploded kittens leave the game with their victim.</p>
<p><b>Attack</b> skips your draw and makes the next player take 2 turns (attacks stack: 4, 6…). <b>Targeted Attack</b> picks the victim. <b>Favor</b>: someone gives you a card (nothing, if their hand is empty). <b>Shuffle</b>, <b>See / Reveal the Future</b> (top 3 cards), <b>Raising Heck</b> (take the bottom card or put it on top — ends your turn). <b>Nope</b> cancels any action (even another Nope) — play it any time.</p>
<p><b>Combos:</b> two matching cards steal a random card; three let you name the card you want; <b>five different cards</b> take any card you like from the discard pile (click the discard pile any time to browse it). Feral Cat matches any cat. Classic rules pair <b>cat cards only</b>; the "any matching pair" option lets any two cards with the same name pair up (Heaven vs Heck plays that way by default).</p>
<p><b>House rule — short deck:</b> with 2–3 players a third of the deck is removed for a quicker game. Pick "Full deck" in the setup to play the printed rules.</p>
<p><b>Armageddon</b> (Heaven vs Heck): while the <b>Angel Cat</b> waits on the playmat, play Armageddon to deal the Angel and the <b>Demon Cat</b> face down — one to you, one to a rival. They keep or swap. Angel → into your hand (play it as any card except Nope, even a Defuse). Demon → explode: Defuse or die. Armageddon ends your turn without drawing.</p>
<p><b>Imploding Kittens pack</b> (optional): the <b>Imploding Kitten</b> replaces one Kaboom Kitten. The first time it's drawn you put it back <b>face up</b> wherever you like (no Defuse needed) — everyone sees where. Draw it face up and you implode: no Defuse can help. <b>Reverse</b> flips the turn order and ends your turn. <b>Draw From the Bottom</b> ends your turn with the bottom card. <b>Alter the Future</b>: look at the top 3 and put them back in any order.</p>
<button class="kk-btn" id="rules-close">Got it</button>`;
$('#rules-btn').addEventListener('click', () => $('#rules').classList.remove('hidden'));
$('#rules').addEventListener('click', (e) => {
  if ((e.target as HTMLElement).id === 'rules' || (e.target as HTMLElement).id === 'rules-close') $('#rules').classList.add('hidden');
});

// ============================================================================ table state

let link: GameLink | null = null;
let view: View | null = null;
let selected = new Set<number>();
let targeting: { cards: number[]; as?: CardType; named?: string; favor?: boolean } | null = null;
const queue: GameEvent[] = [];
let busyUntil = 0;
let lastFrame = performance.now();
/** Bumped on every new table so callbacks from old animations are ignored. */
let generation = 0;
/** My own Nope, predicted before the server confirms it (pending key + the count it makes). */
let myNope: { key: string; count: number } | null = null;
/** Players looking scared right now (fuse phase), until a time. */
const scaredUntil = new Map<string, number>();
/** Full game log (newest last). */
const logLines: string[] = [];
/** Where the kitten I just hid flies from (the insert modal). */
let insertFrom: DOMRect | null = null;

function startLocal(): void {
  settings.name = nameInput.value.trim() || 'Kitty';
  link?.dispose();
  const l = new LocalLink({ name: settings.name, avatar: settings.avatar, bots: settings.bots, level: settings.level, deck: settings.deck, fullDeck: settings.fullDeck, anyPairs: settings.anyPairs, imploding: settings.imploding });
  attach(l);
}

function attach(l: GameLink): void {
  link = l;
  view = null;
  generation++;
  selected.clear();
  targeting = null;
  myNope = null;
  queue.length = 0;
  busyUntil = 0;
  flights = 0;
  shownDiscard = '';
  nopeMarks.clear();
  lastPlayTop = null;
  scaredUntil.clear();
  logLines.length = 0;
  insertFrom = null;
  lastHandRects.clear();
  // Anything still flying from the last game goes (its callbacks are stale).
  $('#fx').replaceChildren();
  hidePreview();
  closeModal();
  $('#menu').classList.add('hidden');
  $('#online').classList.add('hidden');
  $('#table').classList.remove('hidden');
  $('#log-btn').classList.remove('hidden');
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
    ticker(esc(msg), 'error');
  };
}

function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  link?.tick(dt, queue.length > 0 || now < busyUntil);
  // Play queued events one after another so the table can be followed.
  while (queue.length && now >= busyUntil) busyUntil = now + animate(queue.shift()!) * 1000;
  // Once everything has landed, the discard pile catches up with the game.
  if (view && !flights && !queue.length) showDiscard(view.discardTop);
  if (view) {
    renderTimers();
    // Prompts and the game-over screen wait until the table has shown everything that led to them.
    const idle = !queue.length && now >= busyUntil;
    if (view.phase !== 'over' && $('#modal').dataset.over) closeModal();
    if (idle) {
      if (view.phase === 'over' && !$('#modal').dataset.over && !flights) showGameOver();
      else if (view.phase !== 'over') renderPrompt();
    }
    renderWaiting(idle);
    for (const [id, t] of scaredUntil) {
      if (now <= t) continue;
      scaredUntil.delete(id);
      render();
    }
  }
  particles.update(dt);
}
requestAnimationFrame(frame);

// ============================================================================ rendering

function nameOf(id: string): string {
  if (!view) return id;
  if (id === view.you) return 'You';
  return view.players.find((p) => p.id === id)?.name ?? id;
}

const pendingKey = (v: View) => (v.pending ? `${v.pending.by}:${v.pending.cards[0]?.id}` : '');
/** The Nope count as I believe it (my own unconfirmed Nope included). */
function nopeCount(v: View): number {
  if (!v.pending) return 0;
  return myNope && myNope.key === pendingKey(v) ? Math.max(v.pending.nopes, myNope.count) : v.pending.nopes;
}

/** Who looks scared: whoever's in a kitten-danger Nope window (dodging a likely kitten, or the target of an attack). */
function scared(v: View, id: string): boolean {
  if ((scaredUntil.get(id) ?? 0) > performance.now()) return true;
  const pd = v.pending;
  if (v.phase !== 'nope' || !pd) return false;
  const odds = v.drawCount ? v.kittens / v.drawCount : 0;
  const topKitten = v.known.some((k) => k.index === 0 && (k.card.type === 'kitten' || (k.card.type === 'imploding' && k.card.faceUp)));
  const escaping = ['skip', 'attack', 'targeted', 'reverse', 'shuffle', 'bottom', 'heck', 'alter'].includes(pd.effect.k);
  if (pd.by === id && escaping && (topKitten || odds >= 0.2)) return true;
  const target = pd.effect.k === 'targeted' ? pd.effect.target : pd.effect.k === 'attack' ? nextAliveId(v, pd.by) : null;
  return target === id && (topKitten || odds >= 0.15);
}

function nextAliveId(v: View, from: string): string {
  const i = v.players.findIndex((p) => p.id === from);
  const n = v.players.length;
  for (let k = 1; k <= n; k++) {
    const p = v.players[(((i + k * v.dir) % n) + n) % n]!;
    if (p.alive) return p.id;
  }
  return from;
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
      const canTarget = targeting && p.alive && (targeting.favor || p.count > 0);
      const mood = !p.alive ? 'dead' : scared(v, p.id) ? 'scared' : 'normal';
      return `<div class="kk-seat ${turn ? 'turn' : ''} ${p.alive ? '' : 'dead'} ${canTarget ? 'targetable' : ''} ${mood === 'scared' ? 'scared' : ''}" data-id="${p.id}">
        <div class="kk-seat__avatar">${avatar(p.avatar, mood)}${p.bot ? '<em>BOT</em>' : ''}${p.connected ? '' : '<em class="off">…</em>'}</div>
        <div class="kk-seat__name">${esc(p.name)}</div>
        ${p.alive ? `<div class="kk-seat__fan">${fan}${p.godcat ? '<i class="gold"></i>' : ''}<b>${p.count}</b></div>` : `<div class="kk-seat__out">${p.out ? cardHtml({ type: p.out }, 'tiny') : ''}<b>OUT</b></div>`}
        ${turn && v.turns > 1 ? `<div class="kk-seat__turns">×${v.turns}</div>` : ''}
      </div>`;
    })
    .join(''));
  // Pile + odds (face-up cards stick out of the stack where they lie).
  const faceUps = v.known.filter((k) => k.card.faceUp);
  setHTML(
    $('#pile-stack'),
    Array.from({ length: Math.min(6, Math.ceil(v.drawCount / 6)) }, (_, k) => backHtml(false, `s${k}`)).join('') +
      faceUps.map((k) => `<div class="kk-faceup ${k.index === 0 ? 'top' : ''}" style="--d:${v.drawCount > 1 ? k.index / (v.drawCount - 1) : 0}" title="Face up at #${k.index + 1}">${cardHtml(k.card, 'tiny')}<b>#${k.index + 1}</b></div>`).join(''),
  );
  setHTML($('#peek'), knownTopHtml(v));
  $('#pile-count').textContent = String(v.drawCount);
  const odds = v.drawCount ? (v.kittens / v.drawCount) * 100 : 0;
  $('#pile-odds').innerHTML = `💣 ${v.kittens} · <b class="${odds > 30 ? 'hot' : odds > 15 ? 'warm' : ''}">${odds.toFixed(0)}%</b>`;
  $('#pile').classList.toggle('mine', v.current === v.you && v.phase === 'play');
  $('#dir').classList.toggle('hidden', !v.rules.imploding);
  $('#table').classList.toggle('imp', v.rules.imploding);
  $('#dir').textContent = v.dir === 1 ? '↻' : '↺';
  $('#dir').title = v.dir === 1 ? 'Turn order: clockwise' : 'Turn order: reversed';
  $('#discard-count').textContent = v.discardCount ? String(v.discardCount) : '';
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
  setHTML($('#me-avatar'), avatar(me?.avatar ?? 0, me?.alive === false ? 'dead' : scared(v, v.you) ? 'scared' : 'normal'));
  $('#me-name').innerHTML = `${esc(me?.name ?? '')}${me?.out ? cardHtml({ type: me.out }, 'tiny') : ''}`;
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
      return `<div class="kk-slot" style="--k:${k - mid};--n:${n}">${cardHtml(c, selected.has(c.id) ? 'sel' : '', true)}</div>`;
    })
    .join(''));
  renderActions();
}

let flights = 0;
let shownDiscard = '';
/** Nope cards on the discard pile → the card they Noped (shown with a red X while it's on top). */
const nopeMarks = new Map<number, { base: Card; noped: boolean }>();
let lastPlayTop: Card | null = null;
function showDiscard(c: Card | null): void {
  const mark = c ? nopeMarks.get(c.id) : undefined;
  const key = c ? `${c.id}:${mark ? (mark.noped ? 'x' : 'ok') : ''}` : 'none';
  if (key === shownDiscard) return;
  shownDiscard = key;
  const disc = $('#discard');
  for (const el of [...disc.querySelectorAll(':scope > .kk-card, :scope > .kk-discard__empty, :scope > .kk-noped, :scope > .kk-nopechip')]) el.remove();
  if (!c) disc.insertAdjacentHTML('afterbegin', '<div class="kk-discard__empty">DISCARD</div>');
  else if (mark) disc.insertAdjacentHTML('afterbegin', `${cardHtml(mark.base, 'discard-top')}${mark.noped ? '<div class="kk-noped">✕</div>' : ''}<div class="kk-nopechip">${mark.noped ? 'NOPED' : 'YUP!'}</div>`);
  else disc.insertAdjacentHTML('afterbegin', cardHtml(c, 'discard-top'));
}

/** The draw-pile cards I know about (top 3, plus any face-up card wherever it lies), as a list beside the pile. */
function knownTopHtml(v: View): string {
  const top = v.known.filter((k) => k.index < 3 || k.card.faceUp).sort((a, b) => a.index - b.index);
  if (!top.length) return '';
  return top.map((k) => `<span class="${k.card.type === 'kitten' || k.card.type === 'imploding' ? 'bad' : ''}"><b>#${k.index + 1}</b>${esc(cardName(k.card))}${k.card.faceUp ? ' <i>face up</i>' : ''}</span>`).join('');
}

/** Card types the Angel Cat may become in this game (mirrors the engine's canPlayAs). */
function asOptions(v: View): CardType[] {
  return GODCAT_AS.filter((t) => (t === 'skip' || t === 'future' ? v.deck === 'classic' : t === 'reveal' || t === 'heck' ? v.deck === 'gve' : t === 'reverse' || t === 'bottom' || t === 'alter' ? v.rules.imploding : true));
}

/** What the current selection would do (or why not). */
function selectionPlay(): { ok: boolean; label: string; needsTarget: boolean; needsAs: boolean; needsName: boolean; favor?: boolean } {
  const v = view!;
  const cards = v.hand.filter((c) => selected.has(c.id));
  const none = { ok: false, label: '', needsTarget: false, needsAs: false, needsName: false };
  if (!cards.length) return none;
  if (cards.length === 1) {
    const c = cards[0]!;
    if (c.type === 'godcat') return { ok: true, label: 'PLAY AS…', needsTarget: false, needsAs: true, needsName: false };
    if (['defuse', 'nope', 'cat', 'feral', 'kitten'].includes(c.type)) return { ...none, label: c.type === 'defuse' ? 'Defuse is automatic' : c.type === 'nope' ? 'Nope is for others’ actions' : 'Pick a matching card' };
    if (c.type === 'armageddon' && !v.godcatOnMat) return { ...none, label: 'Angel Cat is out' };
    return { ok: true, label: 'PLAY', needsTarget: c.type === 'favor' || c.type === 'targeted', needsAs: false, needsName: false, favor: c.type === 'favor' };
  }
  if (cards.some((c) => c.type === 'godcat')) return { ...none, label: 'Angel Cat can’t combo' };
  if (cards.length === 5) {
    if (new Set(cards.map(title)).size !== 5) return { ...none, label: 'Five DIFFERENT cards' };
    if (!v.discardCount) return { ...none, label: 'The discard pile is empty' };
    return { ok: true, label: 'TAKE FROM DISCARD', needsTarget: false, needsAs: false, needsName: false };
  }
  if (cards.length > 3) return { ...none, label: cards.length === 4 ? 'Pair, triple — or five different' : 'Too many cards' };
  const titles = cards.filter((c) => c.type !== 'feral').map(title);
  const allCats = titles.every((t) => t.startsWith('cat:'));
  if (new Set(titles).size > 1 || (cards.some((c) => c.type === 'feral') && !allCats)) return { ...none, label: 'Cards must match' };
  if (!v.rules.anyPairs && !allCats) return { ...none, label: 'Only cat cards pair up' };
  return { ok: true, label: cards.length === 2 ? 'STEAL (PAIR)' : 'STEAL (TRIPLE)', needsTarget: true, needsAs: false, needsName: cards.length === 3 };
}

function renderActions(): void {
  const v = view!;
  const myTurn = v.current === v.you && v.phase === 'play';
  const count = nopeCount(v);
  const canNope = v.phase === 'nope' && v.pending && !v.pending.passed && v.hand.some((c) => c.type === 'nope') && (v.pending.by !== v.you || count % 2 === 1) && v.players.find((p) => p.id === v.you)?.alive;
  $('#nope-btn').classList.toggle('hidden', !canNope);
  $('#pass-btn').classList.toggle('hidden', !canNope);
  if (canNope) setHTML($('#nope-btn'), `<span class="kk-display">${count % 2 ? 'YUP!' : 'NOPE!'}</span>`);
  const sp = selectionPlay();
  $('#play-btn').classList.toggle('hidden', !myTurn || !selected.size || !sp.ok);
  $('#play-btn').innerHTML = `<span class="kk-display">${sp.label || 'PLAY'}</span>`;
  $('#draw-btn').classList.toggle('hidden', !myTurn);
  $('#hint').textContent = targeting ? 'Choose a player ↑' : myTurn ? (selected.size && !sp.ok ? sp.label : selected.size ? '' : 'Play cards, then draw to end your turn') : v.phase === 'nope' ? 'Anyone can Nope…' : '';
}

let lastTick = 99;
function renderTimers(): void {
  const v = view!;
  const ring = $('#nope-ring');
  const show = v.phase === 'nope' && v.pending;
  ring.classList.toggle('hidden', !show);
  if (show) {
    const total = link?.online ? 3.5 : 2.6;
    const left = Math.max(0, v.pending!.left - (performance.now() - updateAt) / 1000);
    ring.style.setProperty('--p', String(Math.min(1, left / total)));
    // Tick through the last second (only when I could still Nope).
    const step = Math.ceil(left * 3);
    if (left > 0 && step <= 3 && step < lastTick && !$('#nope-btn').classList.contains('hidden')) audio.tick();
    lastTick = step;
  } else lastTick = 99;
}
let updateAt = performance.now();

/** Someone else is answering a prompt: say who we're waiting for (once the table has caught up). */
function renderWaiting(idle: boolean): void {
  const v = view!;
  const pr = v.prompt;
  const what: Partial<Record<string, string>> = { give: 'to choose a card to give', fan: 'to pick a card', insert: 'to hide the kitten', heck: 'to keep it or put it on top', reorder: 'to alter the future', rummage: 'to take a card from the discard pile' };
  const text = idle && pr && !pr.mine && what[pr.k] ? `Waiting for ${esc(nameOf(pr.player))} ${what[pr.k]}…` : '';
  const el = $('#waiting');
  el.classList.toggle('hidden', !text);
  if (text) setHTML(el, `<i></i><i></i><i></i> ${text}`);
}

function ticker(text: string, kind = ''): void {
  logLines.push(`<div class="kk-tick ${kind}">${text}</div>`);
  if (logLines.length > 400) logLines.shift();
  const t = $('#ticker');
  const el = document.createElement('div');
  el.className = `kk-tick ${kind}`;
  el.innerHTML = text;
  t.prepend(el);
  while (t.children.length > 3) t.lastElementChild!.remove();
  setTimeout(() => el.classList.add('old'), 4000);
}

function showLog(): void {
  const p = openModal(`<h3 class="kk-display">GAME LOG</h3><div class="kk-log">${logLines.join('') || '<p>Nothing yet.</p>'}</div><button class="kk-chip" data-close>Close</button>`, 'log');
  const list = $('.kk-log', p);
  list.scrollTop = list.scrollHeight;
  p.onclick = (e) => (e.target as HTMLElement).closest('[data-close]') && closeModal();
}

// ============================================================================ card preview (hover / long-press)

const preview = $('#preview');
let previewTimer = 0;
let longPressed = false;
function showPreview(c: Card, from: DOMRect): void {
  preview.innerHTML = cardHtml(c, 'zoom');
  preview.classList.remove('hidden');
  const r = preview.getBoundingClientRect();
  const x = Math.max(8, Math.min(innerWidth - r.width - 8, from.left + from.width / 2 - r.width / 2));
  const y = Math.max(8, Math.min(innerHeight - r.height - 8, from.top - r.height - 12));
  preview.style.left = `${x}px`;
  preview.style.top = `${y}px`;
}
function hidePreview(): void {
  clearTimeout(previewTimer);
  preview.classList.add('hidden');
}
function cardFor(el: HTMLElement): Card | null {
  const id = Number(el.dataset.id);
  return view?.hand.find((c) => c.id === id) ?? view?.discard.find((c) => c.id === id) ?? null;
}
function bindPreview(root: HTMLElement): void {
  root.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const el = (e.target as HTMLElement).closest<HTMLElement>('.kk-card[data-id]');
    if (!el) return;
    clearTimeout(previewTimer);
    previewTimer = window.setTimeout(() => {
      const c = cardFor(el);
      if (c && el.isConnected) showPreview(c, el.getBoundingClientRect());
    }, 320);
  });
  root.addEventListener('pointerout', (e) => {
    if (e.pointerType === 'mouse' && !(e.relatedTarget as HTMLElement | null)?.closest?.('.kk-card[data-id]')) hidePreview();
  });
  root.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    const el = (e.target as HTMLElement).closest<HTMLElement>('.kk-card[data-id]');
    if (!el) return;
    longPressed = false;
    clearTimeout(previewTimer);
    previewTimer = window.setTimeout(() => {
      const c = cardFor(el);
      if (!c) return;
      longPressed = true;
      showPreview(c, el.getBoundingClientRect());
    }, 420);
  });
  for (const ev of ['pointerup', 'pointercancel'] as const) root.addEventListener(ev, (e) => e.pointerType !== 'mouse' && hidePreview());
  root.addEventListener('contextmenu', (e) => e.preventDefault());
}
bindPreview($('#hand'));

// ============================================================================ input

$('#hand').addEventListener('click', (e) => {
  const card = (e.target as HTMLElement).closest<HTMLElement>('.kk-card');
  if (!card || !view) return;
  // A long-press only zooms: it doesn't select.
  if (longPressed) {
    longPressed = false;
    return;
  }
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
    targeting = { cards, favor: sp.favor };
    render();
    return;
  }
  send({ t: 'play', cards });
});

function send(a: Action): void {
  rememberHand();
  hidePreview();
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
$('#discard').addEventListener('click', () => view && showDiscardBrowser(null));
$('#ticker').addEventListener('click', showLog);
$('#log-btn').addEventListener('click', showLog);
$('#pass-btn').addEventListener('click', () => send({ t: 'pass' }));
$('#nope-btn').addEventListener('click', () => {
  const v = view;
  const nope = v?.hand.find((c) => c.type === 'nope');
  if (!v || !nope || !v.pending) return;
  // Name the Nope count this answers: if someone else Noped first, the server drops mine instead of flipping it.
  const count = nopeCount(v);
  send({ t: 'nope', card: nope.id, expect: count });
  myNope = { key: pendingKey(v), count: count + 1 };
  renderActions();
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
  p.onclick = null;
  return p;
}
function closeModal(): void {
  $('#modal').classList.add('hidden');
  delete $('#modal').dataset.over;
  promptShown = -1;
}

function pickAs(godId: number): void {
  const v = view!;
  const p = openModal(`<h3 class="kk-display">PLAY THE ANGEL CAT AS…</h3><div class="kk-pick">${asOptions(v).map((t) => `<button data-t="${t}">${cardHtml({ type: t }, 'mini')}</button>`).join('')}</div><button class="kk-chip" data-cancel>Cancel</button>`, 'angel');
  p.onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-t],[data-cancel]');
    if (!b) return;
    closeModal();
    if (b.dataset.cancel !== undefined) return;
    const as = b.dataset.t as CardType;
    if (as === 'favor' || as === 'targeted') {
      targeting = { cards: [godId], as, favor: as === 'favor' };
      render();
    } else send({ t: 'play', cards: [godId], as });
  };
}

function pickName(cards: number[]): void {
  const v = view!;
  const nameable = (['defuse', 'nope', ...(v.deck === 'gve' ? ['godcat'] : []), ...typesInPlay(v.deck, v.rules.imploding)] as CardType[]).filter((t, i, a) => a.indexOf(t) === i && !['kitten', 'imploding', 'cat', 'feral', 'devilcat'].includes(t));
  const p = openModal(`<h3 class="kk-display">NAME THE CARD YOU WANT</h3><div class="kk-pick">${nameable.map((t) => `<button data-n="${t}">${cardHtml({ type: t }, 'mini')}</button>`).join('')}</div><button class="kk-chip" data-cancel>Cancel</button>`);
  p.onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-n],[data-cancel]');
    if (!b) return;
    closeModal();
    if (b.dataset.cancel !== undefined) return;
    targeting = { cards, named: b.dataset.n };
    render();
  };
}

/** The discard pile, newest first. `pick`: answer a five-card combo by taking one. */
function showDiscardBrowser(pick: ((id: number) => void) | null): void {
  const v = view!;
  const cards = [...v.discard].reverse();
  const p = openModal(
    `<h3 class="kk-display">${pick ? 'TAKE ANY CARD' : `DISCARD PILE (${cards.length})`}</h3><p>${pick ? 'Five different cards: pick one from the discard pile.' : 'Newest first. Exploded kittens are out of the game, not here.'}</p>
    <div class="kk-pick kk-discards">${cards.map((c) => `<button data-c="${c.id}" ${pick ? '' : 'disabled'}>${cardHtml(c, 'mini')}</button>`).join('') || '<p>Empty.</p>'}</div>${pick ? '' : '<button class="kk-chip" data-close>Close</button>'}`,
    pick ? 'rummage' : 'browse',
  );
  p.onclick = (e) => {
    if ((e.target as HTMLElement).closest('[data-close]')) return closeModal();
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-c]');
    if (b && pick) pick(Number(b.dataset.c));
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
  hidePreview();
  const respond = (choice: Choice) => {
    closeModal();
    send({ t: 'respond', prompt: pr.id, choice });
  };
  switch (pr.k) {
    case 'insert': {
      const size = pr.size;
      const implode = pr.kind === 'imploding';
      // Slots inside my own remaining draws are marked: I'd draw it myself.
      const own = Math.max(0, v.turns - 1);
      const slot = (i: number, label: string) => `<button data-i="${i}" class="${i < own ? 'own' : ''}">${label}</button>`;
      const p = openModal(
        `<div class="kk-modal__kitten">${cardHtml({ type: implode ? 'imploding' : 'kitten' }, 'mini')}</div><h3 class="kk-display">${implode ? 'IMPLODING KITTEN! PUT IT BACK FACE UP' : 'DEFUSED! HIDE THE KITTEN'}</h3><p>${implode ? 'Everyone will see exactly where it is. Whoever draws it next is out.' : 'Where in the deck?'} (${size} cards)${own ? ` — careful: you still draw ${own} more!` : ''}</p>
        <div class="kk-insert">${slot(0, 'Top 😈')}${slot(1, '2nd')}${slot(2, '3rd')}${slot(Math.floor(size / 2), 'Middle')}${slot(size, 'Bottom')}<button data-i="rand">🎲 Random</button></div>
        <input type="range" min="0" max="${size}" value="${Math.min(size, own)}" id="ins-range" /><button class="kk-btn kk-btn--go" id="ins-go"><span class="kk-display">${implode ? 'PUT IT' : 'HIDE'} AT #<b id="ins-n">${Math.min(size, own) + 1}</b></span></button>`,
        'kitten',
      );
      const range = $<HTMLInputElement>('#ins-range', p);
      range.oninput = () => ($('#ins-n', p).textContent = String(Number(range.value) + 1));
      const go = (i: number) => {
        insertFrom = $('.kk-modal__kitten', p).getBoundingClientRect();
        respond(i);
      };
      p.onclick = (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
        if (b) go(b.dataset.i === 'rand' ? own + Math.floor(Math.random() * (size - Math.min(size, own) + 1)) : Math.min(size, Number(b.dataset.i)));
        if ((e.target as HTMLElement).closest('#ins-go')) go(Number(range.value));
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
      const c = pr.card;
      const bomb = c.type === 'kitten' || c.type === 'imploding';
      const saver = v.hand.some((x) => x.type === 'defuse' || x.type === 'godcat');
      // A kitten: putting it back on top is the obvious move, so that's the big button.
      const keepLabel = c.type === 'kitten' ? (saver ? 'Keep it (use a Defuse)' : 'Keep it (EXPLODE!)') : c.type === 'imploding' ? (c.faceUp ? 'Keep it (IMPLODE!)' : 'Keep it (put it back face up)') : 'KEEP IT';
      const topLabel = v.turns > 1 ? `PUT IT ON TOP <small>(you draw next!)</small>` : 'PUT IT ON TOP';
      const p = openModal(
        `<h3 class="kk-display">RAISING HECK</h3><p>You pulled the bottom card:</p><div class="kk-big">${cardHtml(c)}</div><div class="kk-two">${
          bomb
            ? `<button class="kk-btn kk-btn--go" data-v="top"><span class="kk-display">${topLabel}</span></button><button class="kk-btn" data-v="keep">${keepLabel}</button>`
            : `<button class="kk-btn kk-btn--go" data-v="keep"><span class="kk-display">${keepLabel}</span></button><button class="kk-btn" data-v="top">Put it on top</button>`
        }</div>`,
        bomb ? 'kitten' : '',
      );
      p.onclick = (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('[data-v]');
        if (b) respond(b.dataset.v!);
      };
      break;
    }
    case 'reorder':
      reorderPrompt(pr.cards, (order) => respond(order));
      break;
    case 'rummage':
      showDiscardBrowser((id) => respond(id));
      break;
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

/** Alter the Future: drag a card onto another (or tap two) to swap them; #1 is drawn next. */
function reorderPrompt(cards: Card[], done: (order: number[]) => void): void {
  const order = cards.map((_, i) => i);
  let picked = -1;
  const p = openModal(`<h3 class="kk-display">ALTER THE FUTURE</h3><p>Drag a card onto another — or tap two — to swap them. #1 is drawn next.</p><div class="kk-reorder" id="reorder"></div><button class="kk-btn kk-btn--go" id="reorder-go"><span class="kk-display">DONE</span></button>`, 'alter');
  const row = $('#reorder', p);
  const draw = () => {
    row.innerHTML = order.map((ci, pos) => `<div class="kk-reorder__slot ${pos === picked ? 'picked' : ''}" data-p="${pos}"><small>#${pos + 1}${pos === 0 ? ' · next' : ''}</small>${cardHtml(cards[ci]!, '', true)}</div>`).join('');
  };
  const swap = (a: number, b: number) => {
    [order[a], order[b]] = [order[b]!, order[a]!];
    picked = -1;
    audio.card();
    draw();
  };
  draw();
  let from = -1;
  row.addEventListener('pointerdown', (e) => {
    const s = (e.target as HTMLElement).closest<HTMLElement>('[data-p]');
    from = s ? Number(s.dataset.p) : -1;
  });
  row.addEventListener('pointerup', (e) => {
    const s = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-p]');
    if (!s || from < 0) return;
    const to = Number(s.dataset.p);
    if (to !== from) swap(from, to);
    else if (picked >= 0 && picked !== to) swap(picked, to);
    else {
      picked = picked === to ? -1 : to;
      draw();
    }
    from = -1;
  });
  $('#reorder-go', p).onclick = () => {
    closeModal();
    done([...order]);
  };
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
  const p = openModal(`<div class="kk-over__avatar">${avatar(w?.avatar ?? 0)}</div><h2 class="kk-display ${won ? 'gold' : 'pink'}">${won ? 'YOU SURVIVED!' : `${esc((w?.name ?? 'Nobody').toUpperCase())} WINS`}</h2><p>${won ? 'Last cat standing. Not a single whisker singed.' : 'You will be remembered as a fine pile of fluff.'}</p>
    <div class="kk-two"><button class="kk-btn kk-btn--go" id="again"><span class="kk-display">${link?.online ? 'BACK TO LOBBY' : 'PLAY AGAIN'}</span></button><button class="kk-btn" id="to-menu">Menu</button></div>`, 'over');
  $('#modal').dataset.over = '1';
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
  hidePreview();
  $('#table').classList.add('hidden');
  $('#online').classList.add('hidden');
  $('#log-btn').classList.add('hidden');
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
      ticker(`New game — ${esc(rulesSummary(ev.deck, v.rules))}. Don't explode!`);
      return 0.3;
    case 'turn':
      if (ev.player === me && v.players.find((p) => p.id === me)?.alive) {
        audio.turn();
        banner(ev.turns > 1 ? `YOUR TURN ×${ev.turns}` : 'YOUR TURN', 'gold');
      }
      return 0.25;
    case 'play': {
      audio.card();
      myNope = null;
      const what = ev.as
        ? `the <b>Angel Cat</b> as ${CARD_INFO[ev.as].name}`
        : ev.cards.length === 5
          ? '<b>five different cards</b>'
          : ev.cards.length > 1
            ? `a ${ev.cards.length === 2 ? 'pair' : 'triple'} (${esc(cardName(ev.cards[0]!))})`
            : `<b>${esc(cardName(ev.cards[0]!))}</b>`;
      ticker(`${who(ev.by)} played ${what}${ev.target ? ` on ${who(ev.target)}` : ''}${ev.named ? ` — wants ${esc(ev.named === 'godcat' ? 'the Angel Cat' : (CARD_INFO[ev.named as CardType]?.name ?? ev.named))}` : ''}`);
      ev.cards.forEach((c, i) => {
        const from = ev.by === me ? (lastHandRects.get(c.id) ?? seatRect(ev.by)) : seatRect(ev.by);
        flyToDiscard(from, c, i * 0.08);
      });
      lastPlayTop = ev.cards[ev.cards.length - 1] ?? null;
      if (ev.cards[0]?.type === 'armageddon') {
        audio.devil();
        banner('ARMAGEDDON!', 'pink');
      }
      return ev.cards.length > 1 ? 0.45 + ev.cards.length * 0.08 : 0.45;
    }
    case 'nope': {
      const noped = ev.count % 2 === 1;
      ticker(`${who(ev.by)}: ${noped ? 'NOPE!' : 'YUP!'}`);
      if (lastPlayTop) nopeMarks.set(ev.card.id, { base: lastPlayTop, noped });
      // The Nope slams down onto the card it stops: stamp, thud and shake on impact.
      flyToDiscard(ev.by === me ? (lastHandRects.get(ev.card.id) ?? seatRect(ev.by)) : seatRect(ev.by), ev.card, 0, () => {
        audio.nope();
        stamp(noped ? 'NOPE!' : 'YUP!', noped ? 'nope' : 'yup');
        shake(9);
        restartAnim($('#discard'), 'slammed');
      });
      return 1;
    }
    case 'resolve':
      if (!ev.ok) ticker('…and it was Noped.', 'dim');
      myNope = null;
      return 0.1;
    case 'draw': {
      audio.draw();
      const pr = $('#pile').getBoundingClientRect();
      const from = ev.bottom ? new DOMRect(pr.left, pr.bottom - 20, pr.width, 20) : pr;
      const bomb = ev.card && (ev.card.type === 'kitten' || ev.card.type === 'imploding');
      fly(from, seatRect(ev.by), ev.card && (ev.by === me || bomb) ? cardHtml(ev.card) : backHtml());
      if (ev.by === me && ev.card && !bomb) ticker(`You ${ev.bottom ? 'pulled from the bottom' : 'drew'} <b>${esc(cardName(ev.card))}</b>`);
      else if (ev.bottom && ev.by !== me) ticker(`${who(ev.by)} drew from the bottom`);
      return bomb ? 0.5 : 0.35;
    }
    case 'explode':
      return explode(ev.by, ev.card, who);
    case 'defuse':
      audio.defuse();
      stamp(ev.card.type === 'godcat' ? 'SAVED BY AN ANGEL!' : 'DEFUSED!', 'defuse');
      ticker(`${who(ev.by)} ${ev.card.type === 'godcat' ? 'was saved by the Angel Cat' : 'defused it'}!`, 'good');
      return 0.9;
    case 'insert': {
      const from = ev.by === me && insertFrom ? insertFrom : seatRect(ev.by);
      insertFrom = null;
      const size = v.drawCount;
      if (ev.kind === 'imploding') ticker(`${who(ev.by)} put the <b>Imploding Kitten</b> back face up at <b>#${(ev.index ?? 0) + 1}</b> 👀`, 'bad');
      else ticker(ev.by === me ? `You hid the kitten at position <b>#${(ev.index ?? 0) + 1}</b> 🤫` : `${who(ev.by)} hid the kitten back in the deck…`);
      if (ev.index !== undefined) insertAnim(from, ev.index, size, ev.card ?? { id: -1, type: 'kitten' });
      else {
        // Secret: just a card back going in, and a wobbling deck.
        fly(from, $('#pile').getBoundingClientRect(), backHtml());
        restartAnim($('#pile'), 'wobble');
      }
      return ev.index !== undefined ? 1.15 : 0.6;
    }
    case 'eliminated': {
      const imp = ev.card?.type === 'imploding';
      audio.meow(false);
      stamp(ev.by === me ? (imp ? 'YOU IMPLODED!' : 'YOU EXPLODED!') : `${nameOf(ev.by).toUpperCase()} ${imp ? 'IMPLODED' : 'EXPLODED'}!`, 'boom');
      ticker(`☠️ ${who(ev.by)} ${ev.by === me ? 'are' : 'is'} out!`, 'bad');
      link?.hold(1.2);
      return 1.2;
    }
    case 'steal':
    case 'give': {
      audio.steal();
      const known = ev.card && (ev.from === me || ev.to === me);
      fly(seatRect(ev.from), seatRect(ev.to), known ? cardHtml(ev.card!) : backHtml(ev.card?.type === 'godcat'));
      ticker(`${who(ev.to)} ${ev.k === 'steal' ? 'stole' : 'got'} ${known ? `<b>${esc(cardName(ev.card!))}</b>` : 'a card'} from ${who(ev.from)}`);
      return 0.6;
    }
    case 'rummage':
      audio.steal();
      fly($('#discard').getBoundingClientRect(), seatRect(ev.by), cardHtml(ev.card));
      ticker(`${who(ev.by)} took <b>${esc(cardName(ev.card))}</b> from the discard pile`);
      shownDiscard = '';
      return 0.6;
    case 'missed':
      ticker(`${who(ev.from)} didn't have it! 😹`);
      return 0.4;
    case 'shuffle':
      audio.shuffle();
      restartAnim($('#pile'), 'shuffling');
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
    case 'alter':
      ticker(`${who(ev.by)} altered the future 🔮`);
      restartAnim($('#pile'), 'wobble');
      return 0.5;
    case 'reverse':
      audio.reverse();
      banner('REVERSE!', 'gold');
      restartAnim($('#dir'), 'spin');
      ticker(`${who(ev.by)} reversed the turn order ${ev.dir === 1 ? '↻' : '↺'}`);
      return 0.7;
    case 'heckTop':
      ticker(`${who(ev.by)} put the bottom card on top${ev.card ? ` (<b>${esc(cardName(ev.card))}</b>)` : ''}`);
      return 0.4;
    case 'attacked': {
      if (ev.target === me) banner(`ATTACKED! ×${ev.turns}`, 'pink');
      ticker(`${who(ev.target)} must take <b>${ev.turns} turns</b>!`);
      audio.hit();
      // The hit lands on the target's seat: it shakes and a ×N badge pops.
      const seat = ev.target === me ? $('#me') : document.querySelector<HTMLElement>(`.kk-seat[data-id="${ev.target}"]`);
      seat?.animate(Array.from({ length: 6 }, (_, i) => ({ transform: `translateX(${(i % 2 ? -1 : 1) * (10 - i * 1.5)}px) rotate(${(i % 2 ? -1 : 1) * 3}deg)` })).concat([{ transform: 'none' }]), { duration: 450 });
      popBadge(ev.target === me ? $('#me-avatar').getBoundingClientRect() : seatRect(ev.target), `×${ev.turns}`);
      shake(5);
      return 0.7;
    }
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

/** Fuse (0.6 s: the card trembles and sparks) → boom. A first-drawn Imploding Kitten just goes back. */
function explode(by: string, card: Card, who: (id: string) => string): number {
  const me = view!.you;
  const imp = card.type === 'imploding';
  if (imp && !card.faceUp) {
    audio.devil();
    bigCard(card, 'IMPLODING KITTEN!');
    ticker(`🌀 ${who(by)} drew the <b>Imploding Kitten</b> — it goes back face up!`, 'bad');
    link?.hold(1.6);
    return 1.4;
  }
  const demon = card.type === 'devilcat';
  ticker(`💥 ${who(by)} ${imp ? 'drew the face-up <b>Imploding Kitten</b>' : `got ${demon ? 'the <b>Demon Cat</b>' : 'a <b>Kaboom Kitten</b>'}`}!`, 'bad');
  audio.fuse();
  scaredUntil.set(by, performance.now() + 1700);
  render();
  const el = bigCard(card, imp ? 'IMPLODING!' : demon ? 'DEMON CAT!' : 'KABOOM KITTEN!', 'fuse');
  const gen = generation;
  // Sparks fly off the bomb's fuse while it burns (where the art draws it).
  const fuseAt = () => {
    const r = el.querySelector('.kk-card__art')!.getBoundingClientRect();
    return [r.left + r.width * 0.73, r.top + r.height * 0.6] as const;
  };
  const sparkTimer = setInterval(() => {
    if (gen !== generation || !el.isConnected) return clearInterval(sparkTimer);
    particles.sparks(...fuseAt());
  }, 50);
  link?.hold(2.2);
  setTimeout(() => {
    clearInterval(sparkTimer);
    if (gen !== generation) return;
    el.classList.add('boom');
    const r = by === me ? $('#me-avatar').getBoundingClientRect() : seatRect(by);
    if (imp) {
      audio.implode();
      particles.implode(r.left + r.width / 2, r.top + r.height / 2);
    } else {
      audio.boom();
      particles.explode(r.left + r.width / 2, r.top + r.height / 2);
    }
    shake(imp ? 10 : 18);
  }, 600);
  return 1.5;
}

/** The deck splits at the chosen depth and the kitten slides into the gap. */
function insertAnim(from: DOMRect, index: number, size: number, card: Card): void {
  const pile = $('#pile-stack').getBoundingClientRect();
  const fx = $('#fx');
  const frac = size > 1 ? Math.min(1, index / (size - 1)) : 0;
  const lid = document.createElement('div');
  lid.className = 'kk-split';
  lid.style.left = `${pile.left}px`;
  lid.style.top = `${pile.top}px`;
  lid.style.width = `${pile.width}px`;
  lid.style.height = `${pile.height}px`;
  // The part above the slot lifts off (thicker the deeper the kitten goes).
  const layers = index === 0 ? 0 : Math.max(1, Math.round(frac * 4));
  lid.innerHTML = `${Array.from({ length: layers }, (_, k) => backHtml(false, `l${k}`)).join('')}<b class="kk-split__label">#${index + 1}</b>`;
  fx.appendChild(lid);
  lid.animate(
    [{ transform: 'none' }, { transform: `translate(-6px, -${36 + frac * 26}px) rotate(-7deg)`, offset: 0.25 }, { transform: `translate(-6px, -${36 + frac * 26}px) rotate(-7deg)`, offset: 0.7 }, { transform: 'none' }],
    { duration: 1100, easing: 'ease-in-out', fill: 'both' },
  ).onfinish = () => lid.remove();
  setTimeout(() => {
    fly(from, new DOMRect(pile.left + 6, pile.top - 6 + (1 - frac) * 4, pile.width, pile.height), cardHtml(card), 0, undefined, 'slide');
  }, 120);
  audio.card();
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

/** `slam`: a Nope coming down hard (called when it lands). */
function flyToDiscard(from: DOMRect, c: Card, delay = 0, slam?: () => void): void {
  flights++;
  const gen = generation;
  fly(from, $('#discard').getBoundingClientRect(), cardHtml(c), delay, () => {
    // (A flight from a previous table must not touch this one's counters.)
    if (gen !== generation) return;
    flights = Math.max(0, flights - 1);
    showDiscard(c);
    slam?.();
  }, slam ? 'slam' : 'arc');
}

function fly(from: DOMRect, to: DOMRect, html: string, delay = 0, done?: () => void, path: 'arc' | 'slam' | 'slide' = 'arc'): void {
  const el = document.createElement('div');
  el.className = 'kk-flyer';
  el.innerHTML = html;
  $('#fx').appendChild(el);
  const x0 = from.left + from.width / 2;
  const y0 = from.top + from.height / 2;
  const x1 = to.left + to.width / 2;
  const y1 = to.top + to.height / 2;
  const at = (x: number, y: number, s: number, r: number) => `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${s}) rotate(${r}deg)`;
  const frames: Keyframe[] =
    path === 'slam'
      ? [
          { transform: at(x0, y0, 0.5, -10), opacity: 0.4 },
          { transform: at(x1, y1 - 70, 1.5, -18), opacity: 1, offset: 0.55 },
          { transform: at(x1, y1, 0.66, -14), opacity: 1, offset: 0.85 },
          { transform: at(x1, y1, 0.72, -12), opacity: 1 },
        ]
      : path === 'slide'
        ? [
            { transform: at(x0, y0, 0.9, 0), opacity: 1 },
            { transform: at(x1 + 70, y1, 0.8, 8), opacity: 1, offset: 0.55 },
            { transform: at(x1, y1, 0.74, 0), opacity: 1, offset: 0.85 },
            { transform: at(x1, y1, 0.74, 0), opacity: 0 },
          ]
        : [
            { transform: at(x0, y0, 0.5, -10), opacity: 0.4 },
            { transform: at((x0 + x1) / 2, Math.min(y0, y1) - 60, 0.9, 6), opacity: 1, offset: 0.5 },
            { transform: at(x1, y1, 0.7, 0), opacity: 1 },
          ];
  const anim = el.animate(frames, { duration: path === 'slide' ? 900 : path === 'slam' ? 560 : 520, delay: delay * 1000, easing: path === 'slam' ? 'cubic-bezier(.5,0,.8,.6)' : 'cubic-bezier(.3,.7,.3,1)', fill: 'both' });
  anim.onfinish = () => {
    done?.();
    el.remove();
  };
}

/** Re-run a one-shot CSS animation class. */
function restartAnim(el: HTMLElement, cls: string): void {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
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

function popBadge(at: DOMRect, text: string): void {
  const el = document.createElement('div');
  el.className = 'kk-hitbadge kk-display';
  el.textContent = text;
  el.style.left = `${at.left + at.width / 2}px`;
  el.style.top = `${at.top + 6}px`;
  $('#fx').appendChild(el);
  setTimeout(() => el.remove(), 1300);
}

function bigCard(c: Card, label: string, cls = ''): HTMLElement {
  const el = document.createElement('div');
  el.className = `kk-bigcard ${cls}`;
  el.innerHTML = `${cardHtml(c)}<div class="kk-display">${label}</div>`;
  $('#fx').appendChild(el);
  setTimeout(() => el.remove(), 1500);
  return el;
}

function showTop(cards: Card[], label: string): void {
  const el = document.createElement('div');
  el.className = 'kk-future';
  el.innerHTML = `<div class="kk-display">${esc(label)}</div><div class="kk-future__cards">${cards.map((c, i) => `<div style="--i:${i}"><small>#${i + 1}</small>${cardHtml(c)}</div>`).join('')}</div>`;
  $('#fx').appendChild(el);
  // One flip sound per card as they turn over.
  cards.forEach((_, i) => setTimeout(() => audio.flip(), 60 + i * 150));
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
  const list: Array<{ x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; g: number; spin?: number; rect?: boolean; to?: [number, number] }> = [];
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
    /** Everything rushes inward to one point. */
    implode(x: number, y: number) {
      for (let i = 0; i < 80; i++) {
        const a = Math.random() * Math.PI * 2;
        const d = 120 + Math.random() * 260;
        list.push({ x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, vx: 0, vy: 0, life: 0.7 + Math.random() * 0.3, max: 1, size: 5 + Math.random() * 10, color: ['#3fd8ff', '#ff4fd8', '#b48aff', '#fff'][i % 4]!, g: 0, to: [x, y] });
      }
    },
    sparks(x: number, y: number) {
      for (let i = 0; i < 4; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
        const s = 80 + Math.random() * 200;
        list.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.25 + Math.random() * 0.25, max: 0.5, size: 2 + Math.random() * 4, color: ['#ffd23f', '#fff3b0', '#ff8c1a'][i % 3]!, g: 400 });
      }
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
        if (p.to) {
          // Ease toward the target (implosion), faster as it closes in.
          const k = Math.min(1, dt * (3 + (1 - p.life / p.max) * 9));
          p.x += (p.to[0] - p.x) * k;
          p.y += (p.to[1] - p.y) * k;
        } else {
          p.vy += p.g * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
        }
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
  let lastPhase: KkLobby['phase'] = 'lobby';
  n.onLobby = (l) => {
    lobby = l;
    renderLobby();
    // A new game starts (also when the host restarts while I'm still on the game-over screen).
    if (l.phase === 'playing' && (!link || !link.online || lastPhase !== 'playing')) {
      link?.dispose();
      attach(new OnlineLink(n));
    }
    lastPhase = l.phase;
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
    .map((p) => `<div class="kk-lp ${p.id === net!.sessionId ? 'me' : ''}">${avatar(p.avatar)}<b>${esc(p.name)}</b><small>${p.bot ? 'BOT' : p.id === l.hostId ? 'HOST' : p.id === net!.sessionId ? 'YOU' : ''}${p.connected ? '' : ' · reconnecting'}</small></div>`)
    .join('');
  $('#o-host').classList.toggle('hidden', !host || l.phase === 'playing');
  setSeg('#o-deck', l.config.deck);
  setSeg('#o-bots', String(l.config.bots));
  setSeg('#o-anyPairs', l.config.anyPairs ? '1' : '0');
  setSeg('#o-fullDeck', l.config.fullDeck ? '1' : '0');
  setSeg('#o-imploding', l.config.imploding ? '1' : '0');
  $('#o-rules').textContent = rulesSummary(l.config.deck, l.config);
  $('#o-wait').textContent = l.phase === 'playing' ? 'Game in progress…' : host ? (l.players.length < 2 ? 'Add bots or wait for friends, then start.' : '') : 'Waiting for the host to start…';
  ($('#o-start') as HTMLButtonElement).disabled = l.players.length < 2;
}

function backToLobby(): void {
  link?.dispose();
  link = null;
  view = null;
  $('#table').classList.add('hidden');
  $('#log-btn').classList.add('hidden');
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
for (const [sel, key] of [['#o-deck', 'deck'], ['#o-bots', 'bots'], ['#o-anyPairs', 'anyPairs'], ['#o-fullDeck', 'fullDeck'], ['#o-imploding', 'imploding']] as const) {
  $(sel).addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!b) return;
    const v = b.dataset.v!;
    net?.config({ [key]: key === 'bots' ? Number(v) : key === 'deck' ? v : v === '1' });
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
  /** Dev: start a local game with these settings (e.g. { imploding: true, deck: 'classic', bots: 2 }). */
  start(o: Partial<typeof settings> = {}) {
    Object.assign(settings, o);
    startLocal();
  },
  get link() {
    return link;
  },
  get view() {
    return view;
  },
  get busy() {
    return queue.length > 0 || performance.now() < busyUntil;
  },
};
