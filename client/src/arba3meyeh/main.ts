import './styles.css';
import { HEARTS, SUIT_SYMBOL, cardImage, label, rankOf, suitOf } from './cards';
import { bidValue, type Action, type GameEvent, type HandResult, type Rules } from './engine';
import type { BotLevel } from './bots';
import { LocalLink, type GameLink } from './link';
import type { View } from './view';
import { TableAudio } from './audio';
import { FourHundredNet, OnlineLink } from './net/online';
import type { FhLobby } from './net/protocol';
import { bindFullscreenButton, installFullscreenKey } from '../ui/fullscreen';

// ============================================================================ settings

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
      /* private mode */
    }
  },
};
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const AVATARS = ['🦊', '🐼', '🐸', '🦁', '🐙', '🐵', '🐯', '🐨', '🦄', '🐧', '🐶', '🐱'];
const AV_BG = ['#ff8a3d', '#8fd3ff', '#7ee08a', '#ffd23f', '#ff7aa8', '#c9a27a', '#ffb347', '#b8c4d6', '#d8a6ff', '#9fd8e8', '#e8c39e', '#ffc4d6'];
const avatar = (i: number) => `<span class="fh-av" style="--bg:${AV_BG[((i % 12) + 12) % 12]}">${AVATARS[((i % 12) + 12) % 12]}</span>`;
const BACKS = ['#a3172b', '#1d4fa0', '#1f6b3a', '#2a2a2e'];

const settings = {
  name: store.get('fh-name') || `Player${Math.floor(100 + Math.random() * 900)}`,
  avatar: Number(store.get('fh-avatar') ?? Math.floor(Math.random() * 12)),
  level: (store.get('fh-level') as BotLevel) || 'normal',
  target: Number(store.get('fh-target') ?? 41),
  scoring: (store.get('fh-scoring') as Rules['scoring']) || 'lebanese',
  back: Number(store.get('fh-back') ?? 0),
};
const save = () => {
  store.set('fh-name', settings.name);
  store.set('fh-avatar', String(settings.avatar));
  store.set('fh-level', settings.level);
  store.set('fh-target', String(settings.target));
  store.set('fh-scoring', settings.scoring);
  store.set('fh-back', String(settings.back));
};
const audio = new TableAudio();
audio.setMuted(store.get('fh-muted') === '1');
addEventListener('pointerdown', () => audio.unlock(), { capture: true });

/** The classic card back (a diamond lattice in the deck colour, "400" badge): pre-rendered images, see tools/400-backs.mjs. */
function backImage(i: number): string {
  // Single quotes: this also goes inside style="…" attributes.
  return `url('/assets/400/backs/back-${Math.max(0, Math.min(BACKS.length - 1, i | 0))}.webp')`;
}

// ============================================================================ DOM

const app = document.getElementById('game')!;
const TARGETS = [31, 41, 61];
app.innerHTML = `
<div class="fh-screen" id="menu">
  <div class="fh-brand"><div class="fh-logo"><span class="fh-logo__cards"><img src="${cardImage(51)}" alt=""><img src="${cardImage(25)}" alt=""><img src="${cardImage(12)}" alt=""></span><b>400</b><i>أربعمية</i></div><small>The Lebanese partnership card game · hearts are trump</small></div>
  <div class="fh-menu">
    <button class="fh-btn primary" data-go="setup">PLAY vs BOTS</button>
    <button class="fh-btn" data-go="online">ONLINE · LAN</button>
    <button class="fh-btn" data-go="rules">HOW TO PLAY</button>
    <button class="fh-btn" data-go="profile">PROFILE</button>
    <a class="fh-btn ghost" href="/">← ARCADE</a>
  </div>
  <button class="fh-chip fh-fs" id="fullscreen"></button>
</div>

<div class="fh-screen hidden" id="setup">
  <div class="fh-panel">
    <h2>Play vs bots</h2>
    <p class="fh-sub">You and your partner (sitting opposite) against two bots. Everything goes to the right.</p>
    <div class="fh-field"><span>Bots</span><div class="fh-seg" id="s-level"><button data-v="easy">Easy</button><button data-v="normal">Normal</button><button data-v="hard">Hard</button></div></div>
    <div class="fh-field"><span>Play to</span><div class="fh-seg" id="s-target">${TARGETS.map((t) => `<button data-v="${t}">${t}</button>`).join('')}</div></div>
    <div class="fh-field"><span>Scoring</span><div class="fh-seg" id="s-scoring"><button data-v="lebanese">Classic</button><button data-v="jawaker">Jawaker</button></div><small id="s-scoring-help"></small></div>
    <div class="fh-field"><span>Card back</span><div class="fh-backs" id="s-back">${BACKS.map((c, i) => `<button data-v="${i}" title="${c}" style="background-image:${backImage(i)}"></button>`).join('')}</div></div>
    <div class="fh-actions"><button class="fh-btn ghost" data-back>Back</button><button class="fh-btn primary" id="s-start">Deal</button></div>
  </div>
</div>

<div class="fh-screen hidden" id="profile">
  <div class="fh-panel">
    <h2>Profile</h2>
    <label class="fh-text">Name <input id="p-name" maxlength="14" spellcheck="false"></label>
    <div class="fh-avs" id="p-avs">${AVATARS.map((_, i) => `<button data-v="${i}">${avatar(i)}</button>`).join('')}</div>
    <div class="fh-actions"><button class="fh-btn primary" data-back>Done</button></div>
  </div>
</div>

<div class="fh-screen hidden" id="rules">
  <div class="fh-panel wide">
    <h2>How to play 400 <small>أربعمية</small></h2>
    <div class="fh-rules">
      <section><h3>The table</h3><p>Four players, two teams. Your <b>partner sits opposite</b> you. The deal, the bidding and the play all go <b>to the right</b> (counter-clockwise). A normal 52-card deck, aces high. <b>Hearts ♥ are always trump.</b></p></section>
      <section><h3>Bidding</h3><p>Everyone gets 13 cards. Starting right of the dealer, each player bids <b>once</b> how many tricks <b>they alone</b> will take — no passing. The minimum bid is <b>2</b> (3 once your score is 30+, 4 at 40+, 5 at 50+). The four bids must add up to at least <b>11</b> (12 / 13 / 14 once anyone reaches 30 / 40 / 50) or the cards are thrown in and the next player deals.</p></section>
      <section><h3>Playing</h3><p>The player right of the dealer leads. Follow suit if you can; if you can't, trump with a heart or throw anything. The highest heart wins the trick, otherwise the highest card of the suit led. The winner leads the next trick.</p></section>
      <section><h3>Scoring</h3><p>Take at least your bid and you <b>score its value</b>; fall short and you <b>lose it</b>. Extra tricks don't count. Values: 2→2, 3→3, 4→4, <b>5→10, 6→12, 7→14, 8→16, 9→27, 10→30, 11→33, 12→36</b>. Bid <b>13 and take them all</b> and your team wins on the spot. (Jawaker scoring: once you have 30+, bids up to 6 are worth their face value.)</p></section>
      <section><h3>Winning</h3><p>Your team wins when one of you reaches <b>41</b> while the other has <b>more than zero</b>. If your partner is negative, keep going until they climb out.</p></section>
    </div>
    <div class="fh-actions"><button class="fh-btn primary" data-back>Got it</button></div>
  </div>
</div>

<div class="fh-screen hidden" id="online">
  <div class="fh-panel wide">
    <h2>Online · LAN</h2>
    <p class="fh-sub" id="o-sub">Play with friends anywhere — or on the same Wi-Fi with <b>npm run lan</b>. Empty chairs are filled by bots.</p>
    <div class="hidden fh-lan" id="o-lan"><small>OTHER DEVICES OPEN</small><b id="o-lan-url"></b></div>
    <div id="o-connect">
      <div class="fh-actions left"><button class="fh-btn primary" id="o-create">Create table</button><button class="fh-btn" id="o-quick">Quick match</button></div>
      <div class="fh-row"><input id="o-code" placeholder="CODE" maxlength="4" spellcheck="false"><button class="fh-btn" id="o-join">Join</button></div>
    </div>
    <div class="hidden" id="o-lobby">
      <div class="fh-code">Table <b id="o-code-big"></b><button class="fh-chip" id="o-copy">Copy invite</button><span class="fh-series" id="o-series"></span></div>
      <div class="fh-chairs" id="o-chairs"></div>
      <div id="o-host">
        <div class="fh-field"><span>Play to</span><div class="fh-seg" id="o-target">${TARGETS.map((t) => `<button data-v="${t}">${t}</button>`).join('')}</div></div>
        <div class="fh-field"><span>Scoring</span><div class="fh-seg" id="o-scoring"><button data-v="lebanese">Classic</button><button data-v="jawaker">Jawaker</button></div></div>
        <div class="fh-field"><span>Bots</span><div class="fh-seg" id="o-level"><button data-v="easy">Easy</button><button data-v="normal">Normal</button><button data-v="hard">Hard</button></div></div>
      </div>
      <p class="fh-sub" id="o-wait"></p>
      <div class="fh-actions"><button class="fh-btn primary" id="o-start">Deal</button></div>
    </div>
    <p class="fh-status" id="o-status"></p>
    <div class="fh-actions"><button class="fh-btn ghost" id="o-back">Leave</button></div>
  </div>
</div>

<div class="fh-table hidden" id="table">
  <div class="fh-felt"><div class="fh-felt__logo">٤٠٠<small>♥ TRUMP</small></div></div>
  <div class="fh-top">
    <div class="fh-score" id="t-score"></div>
    <div class="fh-info" id="t-info"></div>
    <div class="fh-tools"><button class="fh-icon" id="t-sheet" title="Score sheet">📋</button><button class="fh-icon" id="t-last" title="Last trick">↺</button><button class="fh-icon" id="t-sound" title="Sound"></button><button class="fh-icon" id="t-fs" title="Full screen">⛶</button><button class="fh-icon" id="t-menu" title="Leave">✕</button></div>
  </div>
  <div class="fh-seat" data-pos="0"></div><div class="fh-seat" data-pos="1"></div><div class="fh-seat" data-pos="2"></div><div class="fh-seat" data-pos="3"></div>
  <div class="fh-cards" id="cards"></div>
  <div class="fh-bidpanel hidden" id="bidpanel"></div>
  <div class="fh-toast" id="toast"></div>
  <div class="fh-overlay hidden" id="summary"></div>
  <div class="fh-overlay hidden" id="sheet"></div>
  <div class="fh-overlay hidden" id="lasttrick"></div>
  <div class="fh-overlay hidden" id="over"></div>
</div>`;

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
type ScreenId = 'menu' | 'setup' | 'profile' | 'rules' | 'online' | 'table';
let screen: ScreenId = 'menu';
function show(id: ScreenId): void {
  screen = id;
  for (const s of ['menu', 'setup', 'profile', 'rules', 'online', 'table'] as const) $(`#${s}`).classList.toggle('hidden', s !== id);
}
app.querySelectorAll<HTMLElement>('[data-go]').forEach((b) =>
  b.addEventListener('click', () => {
    audio.ui();
    const go = b.dataset.go as ScreenId;
    if (go === 'online') return void openOnline();
    show(go);
  }),
);
app.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => (audio.ui(), show('menu'))));
bindFullscreenButton($('#fullscreen'), ['⛶', '⛶']);
installFullscreenKey();
$('#t-fs').addEventListener('click', () => (document.fullscreenElement ? void document.exitFullscreen() : void document.documentElement.requestFullscreen?.()));

function seg(sel: string, v: string, pick: (v: string) => void): (v: string) => void {
  const el = $(sel);
  const sync = (x: string) => el.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('on', b.dataset.v === x));
  sync(v);
  el.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-v]');
    if (!b) return;
    audio.ui();
    sync(b.dataset.v!);
    pick(b.dataset.v!);
  });
  return sync;
}
const scoringHelp = () => ($('#s-scoring-help').textContent = settings.scoring === 'lebanese' ? '5 → 10, 6 → 12 … always' : 'At 30+ points, bids up to 6 score face value');
seg('#s-level', settings.level, (v) => ((settings.level = v as BotLevel), save()));
seg('#s-target', String(settings.target), (v) => ((settings.target = Number(v)), save()));
seg('#s-scoring', settings.scoring, (v) => ((settings.scoring = v as Rules['scoring']), save(), scoringHelp()));
scoringHelp();
const syncBack = seg('#s-back', String(settings.back), (v) => ((settings.back = Number(v)), save()));
void syncBack;
$<HTMLInputElement>('#p-name').value = settings.name;
$<HTMLInputElement>('#p-name').addEventListener('input', (e) => {
  settings.name = (e.target as HTMLInputElement).value.trim().slice(0, 14) || 'Player';
  save();
});
seg('#p-avs', String(settings.avatar), (v) => ((settings.avatar = Number(v)), save()));
$('#s-start').addEventListener('click', () => startLocal());

// ============================================================================ the table

let link: GameLink | null = null;
let view: View | null = null;
/** Events waiting to be animated, each with the view right after it. */
let queue: Array<{ e: GameEvent; v: View | null }> = [];
let busy = 0;
let latest: View | null = null;
const cardsEl = $('#cards');
/** Every card on screen by key: `h<card>` my hand, `b<pos>-<i>` an opponent's back, `t<card>` on the table. */
const els = new Map<string, HTMLElement>();
let W = 0;
let H = 0;
let CW = 90;
const pos = (seat: number) => (view ? (seat - Math.max(0, view.me) + 4) % 4 : seat);
const seatAt = (p: number) => (view ? (p + Math.max(0, view.me)) % 4 : p);

function measure(): void {
  const r = $('#table').getBoundingClientRect();
  W = r.width;
  H = r.height;
  CW = Math.max(54, Math.min(W * 0.078, H * 0.125, 112));
  $('#table').style.setProperty('--cw', `${CW}px`);
}
addEventListener('resize', () => {
  measure();
  if (view) layout(view, null);
});

function cardEl(key: string, face: number | null): HTMLElement {
  let el = els.get(key);
  if (!el) {
    el = document.createElement('div');
    el.className = 'fh-card';
    cardsEl.appendChild(el);
    els.set(key, el);
  }
  if (face !== null && face >= 0) {
    if (el.dataset.face !== String(face)) {
      el.dataset.face = String(face);
      el.style.backgroundImage = `url("${cardImage(face)}")`;
      el.classList.remove('back');
    }
  } else if (!el.classList.contains('back')) {
    el.classList.add('back');
    el.style.backgroundImage = backImage(settings.back);
  }
  return el;
}
function place(el: HTMLElement, x: number, y: number, rot: number, scale: number, z: number, delay = 0): void {
  el.style.transitionDelay = `${delay}s`;
  el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%) rotate(${rot.toFixed(2)}deg) scale(${scale})`;
  el.style.zIndex = String(z);
}
function drop(key: string): void {
  els.get(key)?.remove();
  els.delete(key);
}

/** Where a seat sits on screen (centre of its card area). */
function seatPoint(p: number): [number, number] {
  return [
    [W / 2, H - CW * 0.95],
    [W - CW * 0.75, H * 0.47],
    [W / 2, CW * 1.05 + 44],
    [CW * 0.75, H * 0.47],
  ][p] as [number, number];
}
/** Where a seat's card lands in the middle. */
function trickPoint(p: number): [number, number] {
  const cx = W / 2;
  const cy = H * 0.47;
  const d = CW * 0.62;
  return [
    [cx, cy + d * 0.95],
    [cx + d * 1.15, cy],
    [cx, cy - d * 0.95],
    [cx - d * 1.15, cy],
  ][p] as [number, number];
}
/** Fixed small tilt per card so the pile looks thrown, not stacked by a robot. */
const tilt = (c: number) => ((c * 37) % 17) - 8;

/** Put every card where the view says it is. */
function layout(v: View, ev: GameEvent | null): void {
  view = v;
  const live = new Set<string>();
  // My hand: a fan along the bottom.
  const n = v.hand.length;
  if (v.me >= 0) {
    const span = Math.min(W * 0.9, CW * (0.52 * Math.max(0, n - 1) + 1));
    const step = n > 1 ? (span - CW) / (n - 1) : 0;
    const legal = new Set(v.legal);
    const myTurn = v.legal.length > 0;
    v.hand.forEach((c, i) => {
      const key = `h${c}`;
      live.add(key);
      const fresh = !els.has(key);
      const el = cardEl(key, c);
      const t = n > 1 ? i / (n - 1) - 0.5 : 0;
      const x = W / 2 - span / 2 + CW / 2 + i * step;
      const y = H - CW * 0.78 + t * t * CW * 0.55 - (myTurn && legal.has(c) ? CW * 0.16 : 0);
      if (fresh && ev?.k === 'deal') {
        const [dx, dy] = seatPoint(pos(ev.dealer));
        place(el, dx, dy, 0, 0.5, 100 + i, 0);
        void el.offsetWidth;
      }
      el.classList.toggle('playable', myTurn && legal.has(c));
      el.classList.toggle('dim', myTurn && !legal.has(c));
      place(el, x, y, t * 16, 1, 100 + i, fresh && ev?.k === 'deal' ? 0.05 + i * 0.07 : 0);
    });
  }
  // Opponents' and partner's backs.
  for (const s of v.seats) {
    const p = pos(s.seat);
    if (p === 0 && v.me >= 0) continue;
    const [sx, sy] = seatPoint(p);
    const k = s.cards;
    const sc = 0.62;
    const spread = CW * sc * 0.22;
    for (let i = 0; i < 13; i++) {
      const key = `b${p}-${i}`;
      if (i >= k) {
        if (els.has(key) && ev?.k !== 'play') drop(key);
        continue;
      }
      live.add(key);
      const fresh = !els.has(key);
      const el = cardEl(key, null);
      const off = (i - (k - 1) / 2) * spread;
      const vertical = p === 1 || p === 3;
      const x = vertical ? sx : sx + off;
      const y = vertical ? sy + off : sy;
      const rot = (vertical ? 90 : 0) + (i - (k - 1) / 2) * (vertical ? -1.6 : 1.6) * (p === 3 ? -1 : 1);
      if (fresh && ev?.k === 'deal') {
        const [dx, dy] = seatPoint(pos(ev.dealer));
        place(el, dx, dy, 0, 0.5, 10 + i, 0);
        void el.offsetWidth;
      }
      place(el, x, y, rot, sc, 10 + i, fresh && ev?.k === 'deal' ? 0.05 + i * 0.07 + p * 0.02 : 0);
    }
  }
  // The trick in the middle.
  for (const t of v.trick) {
    const key = `t${t.card}`;
    live.add(key);
    const p = pos(t.seat);
    let el = els.get(key);
    if (!el) {
      // Mine came from my hand (same element); theirs fly in from their seat.
      const fromHand = els.get(`h${t.card}`);
      if (fromHand) {
        els.delete(`h${t.card}`);
        els.set(key, fromHand);
        el = fromHand;
        el.classList.remove('playable', 'dim');
      } else {
        el = cardEl(key, t.card);
        const [sx, sy] = seatPoint(p);
        place(el, sx, sy, p === 1 || p === 3 ? 90 : 0, 0.62, 300, 0);
        void el.offsetWidth;
        // Their hand shrinks by the card they played.
        const s = v.seats[t.seat]!;
        drop(`b${p}-${s.cards}`);
      }
    }
    const [tx, ty] = trickPoint(p);
    place(el, tx, ty, tilt(t.card), 0.92, 200 + v.trick.indexOf(t), 0);
    el.classList.toggle('win', ev?.k === 'trick' && t.seat === ev.winner);
  }
  // Anything else that's gone (collected tricks are handled by the collect animation).
  for (const [key] of els) if (!live.has(key) && !(key.startsWith('t') && ev?.k === 'collect')) drop(key);
  renderSeats(v);
  renderTop(v);
  renderBid(v);
}

function renderSeats(v: View): void {
  for (let p = 0; p < 4; p++) {
    const s = v.seats[seatAt(p)]!;
    const el = $(`.fh-seat[data-pos="${p}"]`);
    const turn = (v.phase === 'bidding' || v.phase === 'playing') && v.turn === s.seat && !v.waiting;
    const team = s.seat % 2 === v.me % 2 || v.me < 0 ? (s.seat % 2 === 0 ? 'us' : 'them') : 'them';
    const bidTxt = s.bid === null ? (v.phase === 'bidding' ? '…' : '') : `${s.tricks}<i>/</i>${s.bid}`;
    const made = s.bid !== null && s.tricks >= s.bid;
    const html = `<div class="fh-seat__av ${turn ? 'turn' : ''} ${s.connected ? '' : 'off'}">${avatar(s.avatar)}${v.dealer === s.seat ? '<b class="fh-dealer" title="Dealer">D</b>' : ''}${turn && v.rules.turnTime ? `<svg class="fh-clock" viewBox="0 0 36 36"><circle cx="18" cy="18" r="16" style="--t:${v.clock}s"/></svg>` : ''}</div>
      <div class="fh-seat__name ${team}">${esc(s.name)}${p === 2 ? ' <small>partner</small>' : ''}</div>
      <div class="fh-seat__row"><span class="fh-seat__score ${s.score < 0 ? 'neg' : ''}">${s.score}</span>${bidTxt ? `<span class="fh-seat__bid ${made ? 'made' : ''}" title="tricks / bid">${bidTxt}</span>` : ''}</div>`;
    if (el.dataset.html !== html) {
      el.dataset.html = html;
      el.innerHTML = html;
    }
    el.classList.toggle('active', turn);
  }
}

function renderTop(v: View): void {
  const me = Math.max(0, v.me);
  const us = [me, (me + 2) % 4].map((s) => v.seats[s]!);
  const them = [(me + 1) % 4, (me + 3) % 4].map((s) => v.seats[s]!);
  const team = (list: typeof us, name: string, cls: string) => `<div class="fh-team ${cls}"><b>${name}</b>${list.map((s) => `<span><em>${esc(s.name)}</em><i class="${s.score < 0 ? 'neg' : ''}">${s.score}</i></span>`).join('')}</div>`;
  const html = `${team(us, 'US', 'us')}${team(them, 'THEM', 'them')}`;
  const sc = $('#t-score');
  if (sc.dataset.html !== html) sc.innerHTML = sc.dataset.html = html;
  const bids = v.seats.filter((s) => s.bid !== null).reduce((a, s) => a + s.bid!, 0);
  const info = `<span>HAND <b>${v.handNo}</b></span><span class="trump">TRUMP <b>♥</b></span><span>TO <b>${v.rules.target}</b></span>${v.phase === 'bidding' || v.phase === 'playing' ? `<span>BIDS <b>${bids}</b><small>/${v.needTotal}+</small></span>` : ''}`;
  const ie = $('#t-info');
  if (ie.dataset.html !== info) ie.innerHTML = ie.dataset.html = info;
  $('#t-sound').textContent = audio.muted ? '🔇' : '🔊';
}

function renderBid(v: View): void {
  const panel = $('#bidpanel');
  const open = !!v.bidRange && !queue.length;
  panel.classList.toggle('hidden', !open);
  if (!open) {
    panel.dataset.key = '';
    return;
  }
  const [lo, hi] = v.bidRange!;
  const others = v.seats.filter((s) => s.bid !== null).reduce((a, s) => a + s.bid!, 0);
  const left = v.seats.filter((s) => s.bid === null).length;
  const me = v.seats[v.me]!;
  const key = `${lo}|${others}|${left}|${me.score}`;
  if (panel.dataset.key === key) return;
  panel.dataset.key = key;
  const need = v.needTotal - others;
  const nums = Array.from({ length: 12 }, (_, i) => i + 2)
    .map((n) => {
      const pts = bidValue(n, me.score, v.rules);
      const ok = n >= lo && n <= hi;
      const tooLow = left === 1 && n < need;
      return `<button data-n="${n}" ${ok ? '' : 'disabled'} class="${tooLow && ok ? 'low' : ''}"><b>${n}</b><small>${n === 13 ? 'WIN' : `±${pts}`}</small></button>`;
    })
    .join('');
  panel.innerHTML = `<div class="fh-bid__head"><b>Your bid</b><span>طلبك</span></div>
    <div class="fh-bid__info">Bids so far <b>${others}</b> · table needs <b>${v.needTotal}</b>${left === 1 ? (need > lo ? ` · bid <b>${need}+</b> or the cards are thrown in` : '') : ''}</div>
    <div class="fh-bid__nums">${nums}</div>`;
  audio.myTurn();
}
$('#bidpanel').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-n]');
  if (!b || b.disabled || !link) return;
  audio.bid();
  link.send({ t: 'bid', n: Number(b.dataset.n) });
  $('#bidpanel').classList.add('hidden');
});
cardsEl.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('.fh-card.playable');
  if (!el || !link || !view) return;
  const c = Number(el.dataset.face);
  if (!view.legal.includes(c)) return;
  for (const x of cardsEl.querySelectorAll('.playable')) x.classList.remove('playable');
  link.send({ t: 'play', card: c } satisfies Action);
});

// ---------------------------------------------------------------- event playback

function bubble(seat: number, html: string, cls = ''): void {
  const p = pos(seat);
  const el = document.createElement('div');
  el.className = `fh-bubble p${p} ${cls}`;
  el.innerHTML = html;
  $(`.fh-seat[data-pos="${p}"]`).appendChild(el);
  setTimeout(() => el.remove(), 1800);
}
function toast(html: string, secs = 2.2): void {
  const t = $('#toast');
  t.innerHTML = html;
  t.classList.remove('show');
  void t.offsetWidth;
  t.classList.add('show');
  clearTimeout(Number(t.dataset.timer));
  t.dataset.timer = String(window.setTimeout(() => t.classList.remove('show'), secs * 1000));
}

function play(e: GameEvent, v: View): number {
  switch (e.k) {
    case 'deal': {
      $('#summary').classList.add('hidden');
      for (const [key] of els) drop(key);
      audio.shuffle();
      setTimeout(() => {
        for (let i = 0; i < 8; i++) setTimeout(() => audio.deal(), i * 110);
      }, 700);
      layout(v, e);
      toast(`<small>HAND ${e.hand}</small><b>${esc(v.seats[e.dealer]!.name)} deals</b>`, 1.4);
      return 1.3;
    }
    case 'bid':
      audio.bid();
      layout(v, e);
      bubble(e.seat, `<b>${e.n}</b>`, 'bid');
      return 0.3;
    case 'redeal':
      layout(v, e);
      toast(`<small>THROWN IN</small><b>Bids add up to ${e.total} — the table needs ${e.need}</b><span>New deal</span>`, 2.2);
      return 1.6;
    case 'play':
      audio.play(suitOf(e.card) === HEARTS && !!v.trick.length && suitOf(v.trick[0]!.card) !== HEARTS);
      layout(v, e);
      return 0.28;
    case 'trick': {
      // The view after a trick still shows the four cards: highlight the winner.
      layout({ ...v, trick: v.trick.length ? v.trick : e.cards.map((card, i) => ({ seat: (e.leader + i) % 4, card })) }, e);
      return 0.55;
    }
    case 'collect': {
      const [wx, wy] = seatPoint(pos(e.winner));
      for (const [key, el] of els) {
        if (!key.startsWith('t')) continue;
        place(el, wx, wy, 0, 0.45, 150, 0);
        el.classList.add('gone');
        els.delete(key);
        setTimeout(() => el.remove(), 450);
      }
      audio.sweep(pos(e.winner) % 2 === 0);
      layout(v, e);
      return 0.35;
    }
    case 'hand':
      layout(v, e);
      showSummary(e.results, v);
      return 0.4;
    case 'over':
      layout(v, e);
      setTimeout(() => showOver(e.team, e.reason, v), 1200);
      return 0.4;
  }
  return 0;
}

function showSummary(results: HandResult[], v: View): void {
  const me = Math.max(0, v.me);
  const mine = results.find((r) => r.seat === me);
  if (mine) (mine.tricks >= mine.bid ? audio.made() : audio.missed());
  const order = [me, (me + 2) % 4, (me + 1) % 4, (me + 3) % 4];
  const rows = order
    .map((s) => {
      const r = results.find((x) => x.seat === s)!;
      const p = v.seats[s]!;
      const ok = r.tricks >= r.bid;
      return `<tr class="${s % 2 === me % 2 ? 'us' : 'them'}"><td>${avatar(p.avatar)} ${esc(p.name)}</td><td>${r.bid}</td><td>${r.tricks}</td><td class="${ok ? 'ok' : 'bad'}">${ok ? '✓' : '✗'} ${r.delta > 0 ? '+' : ''}${r.delta}</td><td><b class="${r.score < 0 ? 'neg' : ''}">${r.score}</b></td></tr>`;
    })
    .join('');
  const el = $('#summary');
  el.innerHTML = `<div class="fh-card-panel"><h3>Hand ${v.handNo} <small>نتيجة الجولة</small></h3><table class="fh-tbl"><tr><th></th><th>BID</th><th>TOOK</th><th></th><th>SCORE</th></tr>${rows}</table><p class="fh-sub">Next hand in a moment…</p></div>`;
  el.classList.remove('hidden');
}

function showOver(team: 0 | 1, reason: 'target' | 'thirteen', v: View): void {
  const me = Math.max(0, v.me);
  const won = team === me % 2;
  won ? audio.win() : audio.lose();
  $('#summary').classList.add('hidden');
  const names = (t: number) => [t, t + 2].map((s) => esc(v.seats[s]!.name)).join(' & ');
  const el = $('#over');
  el.innerHTML = `<div class="fh-card-panel big"><div class="fh-result ${won ? 'win' : 'lose'}">${won ? 'YOU WIN' : 'YOU LOSE'}</div><p class="fh-sub">${reason === 'thirteen' ? 'All thirteen tricks — a bid of 13 made!' : `${names(team)} reached ${v.rules.target} with a positive partner.`}</p>${sheetTable(v)}<div class="fh-actions"><button class="fh-btn ghost" id="over-menu">Menu</button><button class="fh-btn primary" id="over-again">${link?.online ? 'Back to table' : 'Play again'}</button></div></div>`;
  el.classList.remove('hidden');
  $('#over-menu').addEventListener('click', () => leaveTable());
  $('#over-again').addEventListener('click', () => {
    el.classList.add('hidden');
    if (link?.online) {
      net?.rematch();
      show('online');
      showLobby();
    } else startLocal();
  });
}

/** The score sheet: every hand, every player's bid / tricks / points, running totals. */
function sheetTable(v: View): string {
  const me = Math.max(0, v.me);
  const order = [me, (me + 2) % 4, (me + 1) % 4, (me + 3) % 4];
  const head = `<tr><th>#</th>${order.map((s) => `<th class="${s % 2 === me % 2 ? 'us' : 'them'}">${esc(v.seats[s]!.name)}</th>`).join('')}</tr>`;
  const rows = v.history
    .map((h, i) => `<tr><td>${i + 1}</td>${order.map((s) => {
      const r = h.find((x) => x.seat === s)!;
      return `<td><span class="${r.tricks >= r.bid ? 'ok' : 'bad'}">${r.tricks}/${r.bid}</span> <b class="${r.score < 0 ? 'neg' : ''}">${r.score}</b></td>`;
    }).join('')}</tr>`)
    .join('');
  return `<div class="fh-sheet"><table class="fh-tbl">${head}${rows || `<tr><td colspan="5">No hands yet.</td></tr>`}</table></div>`;
}
$('#t-sheet').addEventListener('click', () => {
  if (!view) return;
  const el = $('#sheet');
  el.innerHTML = `<div class="fh-card-panel"><h3>Score sheet <small>الشريط</small></h3>${sheetTable(view)}<div class="fh-actions"><button class="fh-btn primary" id="sheet-close">Close</button></div></div>`;
  el.classList.remove('hidden');
  $('#sheet-close').addEventListener('click', () => el.classList.add('hidden'));
});
$('#t-last').addEventListener('click', () => {
  if (!view?.lastTrick) return toast('<b>No trick yet</b>', 1);
  const el = $('#lasttrick');
  const lt = view.lastTrick;
  el.innerHTML = `<div class="fh-card-panel"><h3>Last trick <small>won by ${esc(view.seats[lt.winner]!.name)}</small></h3><div class="fh-last">${lt.cards.map((c) => `<div class="${c.seat === lt.winner ? 'win' : ''}"><img src="${cardImage(c.card)}" alt="${label(c.card)}"><small>${esc(view!.seats[c.seat]!.name)}</small></div>`).join('')}</div><div class="fh-actions"><button class="fh-btn primary" id="lt-close">Close</button></div></div>`;
  el.classList.remove('hidden');
  $('#lt-close').addEventListener('click', () => el.classList.add('hidden'));
});
$('#t-sound').addEventListener('click', () => {
  audio.setMuted(!audio.muted);
  store.set('fh-muted', audio.muted ? '1' : '0');
  if (view) renderTop(view);
});
$('#t-menu').addEventListener('click', () => {
  if (confirm('Leave this game?')) leaveTable();
});

function onUpdate(v: View, events: GameEvent[], views: View[]): void {
  latest = v;
  events.forEach((e, i) => queue.push({ e, v: views[i] ?? null }));
  if (!queue.length && !busy) layout(v, null);
}

let lastT = performance.now();
function loop(now: number): void {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  link?.tick(dt);
  if (busy > 0) {
    // Behind (a fast table online): play animations quicker.
    busy -= dt * (queue.length > 5 ? 3 : 1);
    return;
  }
  const next = queue.shift();
  if (next) {
    busy = play(next.e, next.v ?? latest!);
    if (!queue.length && latest && next.v !== latest) setTimeout(() => !queue.length && !busy && latest && layout(latest, null), busy * 1000 + 30);
  } else if (latest && latest !== view) layout(latest, null);
}
requestAnimationFrame(loop);

function openTable(l: GameLink): void {
  link?.dispose();
  link = l;
  queue = [];
  busy = 0;
  latest = null;
  view = null;
  for (const [key] of els) drop(key);
  for (const id of ['#summary', '#sheet', '#over', '#lasttrick']) $(id).classList.add('hidden');
  show('table');
  measure();
  l.onUpdate = onUpdate;
  l.onError = (m) => toast(`<b>${esc(m)}</b>`, 1.6);
  if (l.view) onUpdate(l.view, [], []);
}

function startLocal(): void {
  audio.unlock();
  const l = new LocalLink({ name: settings.name, avatar: settings.avatar, level: settings.level, rules: { target: settings.target, scoring: settings.scoring, turnTime: 0 } });
  openTable(l);
  // The engine already dealt: replay its first events through the table.
  l.tick(0);
}

function leaveTable(): void {
  link?.dispose();
  link = null;
  if (net) {
    void net.leave();
    net = null;
  }
  for (const [key] of els) drop(key);
  show('menu');
}

// ============================================================================ online

let net: FourHundredNet | null = null;
const oStatus = (t: string, err = false) => {
  const el = $('#o-status');
  el.textContent = t;
  el.classList.toggle('err', err);
};
const oCode = $<HTMLInputElement>('#o-code');
oCode.addEventListener('input', () => (oCode.value = oCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4)));

async function openOnline(code?: string): Promise<void> {
  show('online');
  $('#o-connect').classList.remove('hidden');
  $('#o-lobby').classList.add('hidden');
  net ??= new FourHundredNet();
  oStatus('Checking the server…');
  const probe = await net.probe();
  if (!probe.ok) return oStatus('Can’t reach the game server. Start it with npm run dev (or npm run lan).', true);
  oStatus('');
  $('#o-lan').classList.toggle('hidden', !probe.lan?.length);
  if (probe.lan?.length) $('#o-lan-url').textContent = probe.lan.map((ip) => `http://${ip}:${location.port || 80}/arba3meyeh/`).join('  ·  ');
  if (code) void connect(() => net!.join(code, settings.name, settings.avatar));
}

async function connect(how: () => Promise<void>): Promise<void> {
  if (!net) return;
  oStatus('Connecting…');
  try {
    net.onLobby = () => showLobby();
    net.onError = (m) => oStatus(m, true);
    net.onClosed = (reason) => {
      oStatus(reason ?? 'Disconnected.', true);
      if (screen === 'table') leaveTable();
      $('#o-connect').classList.remove('hidden');
      $('#o-lobby').classList.add('hidden');
    };
    await how();
    oStatus('');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    oStatus(/not found/i.test(msg) ? 'No table with that code.' : /full|locked/i.test(msg) ? 'That table is full or mid-game.' : msg, true);
  }
}
$('#o-create').addEventListener('click', () => void connect(() => net!.create(settings.name, settings.avatar)));
$('#o-quick').addEventListener('click', () => void connect(() => net!.quick(settings.name, settings.avatar)));
$('#o-join').addEventListener('click', () => oCode.value.length === 4 && void connect(() => net!.join(oCode.value, settings.name, settings.avatar)));
$('#o-back').addEventListener('click', () => leaveTable());
$('#o-copy').addEventListener('click', () => {
  const url = `${location.origin}/arba3meyeh/?table=${net?.code}`;
  void navigator.clipboard?.writeText(url).then(() => oStatus('Invite link copied.'));
});
const syncOTarget = seg('#o-target', '41', (v) => net?.config({ target: Number(v) }));
const syncOScoring = seg('#o-scoring', 'lebanese', (v) => net?.config({ scoring: v as Rules['scoring'] }));
const syncOLevel = seg('#o-level', 'normal', (v) => net?.config({ botLevel: v as BotLevel }));
$('#o-start').addEventListener('click', () => net?.start());
$('#o-chairs').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-chair]');
  if (b && !b.classList.contains('taken')) net?.seat(Number(b.dataset.chair));
});

function showLobby(): void {
  const l: FhLobby | null = net?.lobby ?? null;
  if (!l || !net) return;
  if (l.phase === 'playing') {
    if (screen !== 'table' || !link?.online) openTable(new OnlineLink(net));
    return;
  }
  // Finished game on screen: stay on the result until the player leaves it.
  if (screen === 'table' && (l.phase === 'over' || !$('#over').classList.contains('hidden'))) return;
  show('online');
  $('#o-connect').classList.add('hidden');
  $('#o-lobby').classList.remove('hidden');
  $('#o-code-big').textContent = l.code;
  $('#o-series').textContent = l.wins[0] + l.wins[1] ? `Series ${l.wins[0]} – ${l.wins[1]}` : '';
  const host = l.hostId === net.sessionId;
  // Four chairs around a little table: 0 bottom, 1 right, 2 top, 3 left (partners opposite).
  $('#o-chairs').innerHTML = `<div class="fh-minitable"><span>٤٠٠</span></div>${[0, 1, 2, 3]
    .map((c) => {
      const p = l.chairs[c];
      const mine = p?.id === net!.sessionId;
      return `<button class="fh-chair c${c} ${p ? 'taken' : ''} ${mine ? 'mine' : ''}" data-chair="${c}">${p ? avatar(p.avatar) : '<span class="fh-chair__bot">🤖</span>'}<b>${p ? esc(p.name) : 'Bot'}</b><small>${c % 2 === 0 ? 'Team A' : 'Team B'}${!p ? ' · tap to sit' : ''}${p && !p.connected ? ' · reconnecting' : ''}</small></button>`;
    })
    .join('')}`;
  syncOTarget(String(l.config.target));
  syncOScoring(l.config.scoring);
  syncOLevel(l.config.botLevel);
  $('#o-host').classList.toggle('locked', !host);
  $('#o-start').classList.toggle('hidden', !host);
  $('#o-wait').textContent = host ? 'Pick your chair, then deal. Bots take the empty chairs.' : l.phase === 'over' ? 'Waiting for the next game…' : 'Waiting for the host to deal…';
}

// Invite links: /arba3meyeh/?table=CODE
const q = new URLSearchParams(location.search);
if (q.get('table')) void openOnline(q.get('table')!);
else if (q.has('play')) startLocal();
(window as unknown as Record<string, unknown>).__fh = {
  get view() {
    return view;
  },
  get link() {
    return link;
  },
  rankOf,
  SUIT_SYMBOL,
};
