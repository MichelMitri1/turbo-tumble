import './styles.css';
import { backSvg, cardImage, cardLabel, isBlack, RANK_LABEL, sortKey, SUIT_GLYPH, type Card } from './cards';
import { BoardView, playerColor, TEAM_NAMES } from './board';
import { LocalLink, type GameLink } from './link';
import { chooseAction, type BotLevel } from './bots';
import { boardOf, movesIn, type View } from './view';
import { JackarooAudio } from './audio';
import { OnlineLink, JackarooNet } from './net/online';
import type { JkLobby } from './net/protocol';
import { controlledOwner, fwdPath, HOME, owner, SAFE0, startOf, teamOf, applyMove, cloneBoard, type Action, type GameEvent, type Mode, type Move } from './engine';
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

const AVATARS = ['🦁', '🐯', '🦊', '🐼', '🐨', '🐸', '🦉', '🐙', '🦄', '🐲', '🐵', '🐺'];
const avatar = (i: number, color = '#ffd76a') => `<span class="jk-av" style="--c:${color}">${AVATARS[Math.abs(i) % AVATARS.length]}</span>`;

const audio = new JackarooAudio();
audio.setMuted(store.get('jk-muted') === '1');
const settings = {
  name: store.get('jk-name') || `Player${Math.floor(100 + Math.random() * 900)}`,
  avatar: Number(store.get('jk-avatar') ?? Math.floor(Math.random() * AVATARS.length)) % AVATARS.length,
  players: (Number(store.get('jk-players')) === 2 ? 2 : 4) as 2 | 4,
  level: ((store.get('jk-level') as BotLevel) || 'normal') as BotLevel,
  mode: (store.get('jk-mode') === 'complex' ? 'complex' : 'classic') as Mode,
  music: store.get('jk-music') === '1',
};
const q = new URLSearchParams(location.search);
/** Test hook: speed everything up (animations, bots). */
let speed = Math.max(0.25, Math.min(20, Number(q.get('speed')) || 1));

const marbleSvg = (hex: string, light: string) =>
  `<svg viewBox="0 0 40 40"><defs><radialGradient id="g${hex.slice(1)}" cx="35%" cy="30%" r="70%"><stop offset="0" stop-color="#fff"/><stop offset="0.25" stop-color="${light}"/><stop offset="0.75" stop-color="${hex}"/><stop offset="1" stop-color="#000" stop-opacity="0.6"/></radialGradient></defs><circle cx="20" cy="20" r="18" fill="url(#g${hex.slice(1)})"/></svg>`;
const logoMarbles = [0, 1, 2, 3].map((p) => {
  const c = playerColor(4, p);
  return `<i class="jk-logo-marble" style="--i:${p}">${marbleSvg(c.hex, c.light)}</i>`;
});

document.getElementById('game')!.innerHTML = `
<div class="jk-shell">
  <div class="jk-stage" id="stage"></div>
  <div class="jk-loading" id="loading"><div class="jk-loading__logo"><span class="jk-display">JACKAROO</span><span class="jk-arabic">جاكارو</span></div><div class="jk-loading__bar"><i id="load-bar"></i></div><small id="load-text">Polishing the marbles…</small></div>
  <div class="jk-topbar">
    <a class="jk-chip" href="/">← Arcade</a>
    <div class="jk-scorebar hidden" id="scorebar"></div>
    <div class="jk-topbar__right"><button class="jk-chip hidden" id="series-btn" title="Series scoreboard">🏆</button><button class="jk-chip" id="rules-btn">?<span class="jk-wide"> Rules</span></button><button class="jk-chip" id="music" title="Music">♪</button><button class="jk-chip" id="sound" title="Sound effects"></button><button class="jk-chip" id="fullscreen"></button></div>
  </div>

  <section class="jk-menu hidden" id="menu">
    <div class="jk-logo">
      <div class="jk-logo-row">${logoMarbles.join('')}</div>
      <div class="jk-wordmark"><span class="jk-display">JACKAROO</span><span class="jk-arabic">جاكارو</span></div>
      <p class="jk-tag">The Gulf's favourite marble race. Play your cards, race your marbles home, knock your rivals back to the start.</p>
    </div>
    <div class="jk-panel">
      <div class="jk-row"><label>Your name</label><input id="m-name" maxlength="14" spellcheck="false" /></div>
      <div class="jk-row"><label>Avatar</label><div class="jk-avatars" id="m-avatars"></div></div>
      <div class="jk-row"><label>Teams</label><div class="jk-seg" id="m-players"><button data-v="4">2 v 2 <small>with a partner</small></button><button data-v="2">1 v 1</button></div></div>
      <div class="jk-row"><label>Rules</label><div class="jk-seg" id="m-mode"><button data-v="classic">Classic</button><button data-v="complex">Complex</button></div></div>
      <div class="jk-row"><label>Bot brains</label><div class="jk-seg" id="m-level"><button data-v="easy">Easy</button><button data-v="normal">Normal</button><button data-v="hard">Hard</button></div></div>
      <p class="jk-mode-note" id="m-note"></p>
      <button class="jk-btn jk-btn--go" id="m-play"><span class="jk-display">PLAY VS BOTS</span></button>
      <button class="jk-btn jk-btn--online" id="m-online">🌐 Online · LAN <small>rooms with codes</small></button>
    </div>
  </section>

  <section class="jk-online hidden" id="online">
    <div class="jk-panel jk-panel--wide">
      <h2 class="jk-display" id="o-title">ONLINE</h2>
      <p class="jk-sub" id="o-sub">Play with friends anywhere — bots fill empty seats</p>
      <div class="jk-lan hidden" id="o-lan"><small>OTHER DEVICES OPEN</small><b id="o-lan-url"></b></div>
      <div id="o-connect">
        <div class="jk-online__choices">
          <button class="jk-btn jk-btn--go" id="o-create"><span class="jk-display">CREATE ROOM</span></button>
          <button class="jk-btn" id="o-quick">Quick match</button>
          <div class="jk-join"><input id="o-code" maxlength="4" placeholder="CODE" spellcheck="false" autocapitalize="characters" /><button class="jk-btn" id="o-join">Join</button></div>
        </div>
      </div>
      <div class="hidden" id="o-lobby">
        <div class="jk-code"><small>ROOM CODE</small><b class="jk-display" id="o-code-big">----</b><button class="jk-chip" id="o-copy">Copy invite link</button></div>
        <div class="jk-seats" id="o-seats"></div>
        <div class="jk-host hidden" id="o-host">
          <div class="jk-row"><label>Teams</label><div class="jk-seg" id="o-players"><button data-v="4">2 v 2</button><button data-v="2">1 v 1</button></div></div>
          <div class="jk-row"><label>Rules</label><div class="jk-seg" id="o-mode"><button data-v="classic">Classic</button><button data-v="complex">Complex</button></div></div>
          <div class="jk-row"><label>Bots</label><div class="jk-seg" id="o-level"><button data-v="easy">Easy</button><button data-v="normal">Normal</button><button data-v="hard">Hard</button></div></div>
          <button class="jk-btn jk-btn--go" id="o-start"><span class="jk-display">START GAME</span></button>
        </div>
        <p class="jk-rules-sum" id="o-rules"></p>
        <p class="jk-wait" id="o-wait"></p>
        <button class="jk-btn hidden" id="o-rematch">Vote rematch</button>
      </div>
      <p class="jk-status" id="o-status"></p>
      <div class="jk-foot"><button class="jk-chip" id="o-back">← Back</button><span id="o-server"></span></div>
    </div>
  </section>

  <section class="jk-hud hidden" id="hud">
    <div class="jk-plates" id="plates"></div>
    <div class="jk-ticker" id="ticker"></div>
    <div class="jk-me" id="me">
      <div class="jk-me__info" id="me-info"></div>
      <div class="jk-hand" id="hand"></div>
      <div class="jk-me__side">
        <div class="jk-split hidden" id="split"></div>
        <div class="jk-hint" id="hint"></div>
        <div class="jk-actions" id="actions"></div>
      </div>
    </div>
  </section>
  <div class="jk-fx" id="fx"></div>
  <canvas class="jk-particles" id="particles"></canvas>
  <div class="jk-zoom hidden" id="zoom"></div>

  <section class="jk-modal hidden" id="modal"><div class="jk-modal__panel" id="modal-panel"></div></section>
  <section class="jk-modal hidden" id="rules"><div class="jk-modal__panel jk-rules" id="rules-panel"></div></section>
  <section class="jk-modal hidden" id="series"><div class="jk-modal__panel" id="series-panel"></div></section>
</div>`;

// ============================================================================ board

const board = new BoardView($('#stage'));
board.onHop = (i, n) => audio.hop(i, n);
let loaded = false;
void board
  .warmup((f) => {
    $('#load-bar').style.width = `${Math.round(f * 100)}%`;
  })
  .then(() => {
    loaded = true;
    $('#loading').classList.add('gone');
    setTimeout(() => $('#loading').remove(), 600);
    if (q.get('room')) void openOnline(q.get('room')!);
    else if (q.has('play')) startLocal();
    else showMenu();
  });

// ============================================================================ menu

const nameInput = $<HTMLInputElement>('#m-name');
nameInput.value = settings.name;
nameInput.addEventListener('change', () => {
  settings.name = nameInput.value.trim() || 'Player';
  store.set('jk-name', settings.name);
});
function renderAvatars(): void {
  $('#m-avatars').innerHTML = AVATARS.map((_, i) => `<button class="${i === settings.avatar ? 'on' : ''}" data-i="${i}">${avatar(i)}</button>`).join('');
}
$('#m-avatars').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
  if (!b) return;
  settings.avatar = Number(b.dataset.i);
  store.set('jk-avatar', String(settings.avatar));
  audio.select();
  renderAvatars();
});
function setSeg(sel: string, v: string): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>(`${sel} button`)) b.classList.toggle('on', b.dataset.v === v);
}
const MODE_NOTE: Record<Mode, string> = {
  classic: 'Classic: the most common Gulf rules — K & A bring out, 4 goes back, 7 splits, J swaps.',
  complex: 'Complex: K kills every marble it passes · 5 moves ANY marble · 10 and black Q can make the next player throw a card away.',
};
for (const [sel, key] of [
  ['#m-players', 'players'],
  ['#m-level', 'level'],
  ['#m-mode', 'mode'],
] as const) {
  $(sel).addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!b) return;
    const v = b.dataset.v!;
    if (key === 'players') settings.players = v === '2' ? 2 : 4;
    else if (key === 'level') settings.level = v as BotLevel;
    else settings.mode = v as Mode;
    store.set(`jk-${key}`, v);
    setSeg(sel, v);
    audio.select();
    $('#m-note').textContent = MODE_NOTE[settings.mode];
  });
}
renderAvatars();
setSeg('#m-players', String(settings.players));
setSeg('#m-level', settings.level);
setSeg('#m-mode', settings.mode);
$('#m-note').textContent = MODE_NOTE[settings.mode];

const soundBtn = $('#sound');
const musicBtn = $('#music');
const syncSound = () => {
  soundBtn.textContent = audio.muted ? '🔇' : '🔊';
  musicBtn.classList.toggle('off', !settings.music);
};
soundBtn.addEventListener('click', () => {
  audio.setMuted(!audio.muted);
  store.set('jk-muted', audio.muted ? '1' : '0');
  syncSound();
});
musicBtn.addEventListener('click', () => {
  settings.music = !settings.music;
  store.set('jk-music', settings.music ? '1' : '0');
  audio.setMusic(settings.music);
  syncSound();
});
const kickMusic = () => {
  if (settings.music && !audio.music) audio.setMusic(true);
};
addEventListener('pointerdown', kickMusic, { once: true });
addEventListener('keydown', kickMusic, { once: true });
syncSound();
bindFullscreenButton($('#fullscreen'), ['⛶', '⛶']);
installFullscreenKey();

function showMenu(): void {
  board.showcase = true;
  board.reset({ n: 4, me: 0 }, demoMarbles());
  board.setDiscard([]);
  $('#menu').classList.remove('hidden');
  $('#online').classList.add('hidden');
  $('#hud').classList.add('hidden');
  $('#scorebar').classList.add('hidden');
  reserve();
}
/** A mid-game position for the menu backdrop. */
function demoMarbles(): number[] {
  return [3, 12, HOME, SAFE0 + 3, 28, 22, HOME, HOME, 45, 41, SAFE0 + 3, HOME, 60, 66, 70, HOME];
}

// ============================================================================ rules

const cardImg = (label: string) => {
  const m = /^(10|[A2-9JQK])([SHDC])$/.exec(label)!;
  return `<img class="jk-rule-card" src="/assets/jackaroo/cards/${m[1]}${m[2]}.webp" alt="${label}" />`;
};
/** Tiny track diagram: holes in a row, marbles, an arrow (hops) and labels. */
function diagram(holes: Array<{ c?: string; ring?: string; safe?: boolean; start?: boolean }>, arrows: Array<[number, number, string?, boolean?]>, w = 260): string {
  const step = w / holes.length;
  const y = 34;
  const hs = holes
    .map((h, i) => {
      const x = step * (i + 0.5);
      return `<circle cx="${x}" cy="${y}" r="9" fill="${h.safe ? '#1f3b70' : h.start ? '#2f6dff' : '#2a1a10'}" stroke="${h.start ? '#ffd76a' : '#d9a648'}" stroke-width="${h.start ? 3 : 1.5}"/>${h.c ? `<circle cx="${x}" cy="${y}" r="7.5" fill="${h.c}" stroke="#000" stroke-opacity="0.35"/>` : ''}${h.ring ? `<circle cx="${x}" cy="${y}" r="12.5" fill="none" stroke="${h.ring}" stroke-width="2.5" stroke-dasharray="3 2"/>` : ''}`;
    })
    .join('');
  const as = arrows
    .map(([a, b, label, low]) => {
      const x0 = step * (a + 0.5);
      const x1 = step * (b + 0.5);
      const cy = low ? y + 26 : y - 26;
      return `<path d="M${x0} ${low ? y + 10 : y - 10} Q${(x0 + x1) / 2} ${cy} ${x1} ${low ? y + 10 : y - 10}" fill="none" stroke="#ffd76a" stroke-width="2" marker-end="url(#jk-arr)"/>${label ? `<text x="${(x0 + x1) / 2}" y="${low ? y + 30 : y - 20}" fill="#ffd76a" font-size="12" font-weight="900" text-anchor="middle">${label}</text>` : ''}`;
    })
    .join('');
  return `<svg class="jk-diagram" viewBox="0 0 ${w} 68" width="${w}" height="68"><defs><marker id="jk-arr" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10z" fill="#ffd76a"/></marker></defs>${hs}${as}</svg>`;
}
const B_ = '#2f6dff';
const R_ = '#e8323c';
$('#rules-panel').innerHTML = `<h2 class="jk-display">HOW TO PLAY <span class="jk-arabic">جاكارو</span></h2>
<p class="jk-small">House rules vary from family to family; these are the most common Gulf rules.</p>
<div class="jk-rules-cols">
<div>
<h3>The race</h3>
<p><b>2 v 2</b>: partners sit opposite each other (Blue + Green vs Red + Gold). <b>1 v 1</b>: one colour each. Everyone has <b>4 marbles</b> waiting in their <b>home</b> pocket.</p>
<p>Marbles enter the <b>76-hole track</b> on their coloured <b>start square</b>, travel clockwise all the way round, and turn into their own 4-hole <b>safe zone</b> just before their start. A team wins when <b>all 8</b> of its marbles are safe (in 1 v 1: all 4).</p>
${diagram([{}, {}, { c: B_ }, {}, {}, {}, { c: R_, ring: '#ffd76a' }, {}], [[2, 6, '4 → capture!']])}
<p><b>Captures</b> — land exactly on any other marble (even your partner's!) and it goes back home. You can't land on your own colour.</p>
<p><b>Protected start</b> — a marble sitting on its <b>own</b> start square can't be passed, captured or swapped by anyone. It blocks the track — even for its own team. Bringing out onto your start <i>does</i> capture an opponent sitting there.</p>
<p><b>Safe zone</b> — you enter with an exact forward move; you can't overshoot the last hole, jump over your own marbles in there, or go round again. Nobody can touch a safe marble.</p>
<p><b>Cards</b> — one deck of 52. Hands of <b>5, then 4, then 4</b> cards (twice round in 1 v 1), then a new shuffled deck and the deal moves on. Each turn you play exactly one card. <b>If you can move, you must.</b> If no card in your hand can move, you <b>burn</b> one 🔥 and your turn is over.</p>
<p><b>Finished?</b> When all four of your marbles are safe, you keep playing your cards — to move your <b>partner's</b> marbles (7 splits may use them too).</p>
</div>
<div>
<h3>The cards — Classic</h3>
<div class="jk-rule"><div>${cardImg('AS')}${cardImg('KH')}</div><p><b>A</b> — bring a marble out onto your start, or move 1 or 11.<br><b>K</b> — bring a marble out, or move 13.</p></div>
<div class="jk-rule"><div>${cardImg('QD')}${cardImg('10C')}</div><p><b>Q</b> moves 12. <b>10, 9, 8, 6, 5, 3, 2</b> move that many forward.</p></div>
<div class="jk-rule"><div>${cardImg('4S')}</div><p><b>4</b> — move one marble <b>backwards</b> 4 (never into a safe zone). Trick: right after coming out, go back 4… then a short forward move takes you straight into your safe zone!</p></div>
${diagram([{}, { safe: true }, {}, {}, { c: B_ }, { start: true }, {}, {}], [[5, 2, '4 back', true], [2, 1, 'then 1 → safe']])}
<div class="jk-rule"><div>${cardImg('7H')}</div><p><b>7</b> — split 7 steps between one or two of your marbles (7, 4 + 3, 6 + 1…). Each part captures on its own; parts may go into the safe zone. All 7 must be used.</p></div>
<div class="jk-rule"><div>${cardImg('JD')}</div><p><b>J</b> — swap one of your track marbles with any other marble on the track. Marbles at home, in a safe zone or on their own start can't be swapped.</p></div>
<h3>Complex mode changes</h3>
<div class="jk-rule"><div>${cardImg('KS')}</div><p><b>K</b> — bring out, or move 13 <b>killing every marble it passes</b> (and the one it lands on). It can't pass a marble protected on its start.</p></div>
${diagram([{ c: B_ }, {}, { c: R_ }, {}, { c: R_ }, {}, {}, { c: R_, ring: '#ffd76a' }], [[0, 7, 'K sweep: all three die']])}
<div class="jk-rule"><div>${cardImg('5H')}</div><p><b>5</b> — move <b>any</b> marble on the track forward 5: yours, your partner's or an opponent's.</p></div>
<div class="jk-rule"><div>${cardImg('10D')}${cardImg('QC')}</div><p><b>10</b> (move 10) and <b>black Q</b> ♠♣ (move 12) can instead make the <b>next player discard a random card</b>.</p></div>
</div>
</div>
<p class="jk-keys">Controls: tap a glowing card, then a lifted marble, then a glowing ring. Keys <b>1</b>–<b>5</b> pick a card · <b>Esc</b> cancel · <b>B</b> bring out · <b>Enter</b> confirm.</p>
<button class="jk-btn" id="rules-close">Got it</button>`;
$('#rules-btn').addEventListener('click', () => $('#rules').classList.remove('hidden'));
$('#rules').addEventListener('click', (e) => {
  const id = (e.target as HTMLElement).id;
  if (id === 'rules' || id === 'rules-close') $('#rules').classList.add('hidden');
});

// ============================================================================ table state

interface Step {
  ev: GameEvent;
  view: View | null;
}

let link: GameLink | null = null;
let view: View | null = null;
let real: View | null = null;
const queue: Step[] = [];
let busyUntil = 0;
let lastFrame = performance.now();
let updateAt = performance.now();
const frameGaps: number[] = [];

interface Sel {
  card: Card;
  marble: number;
  /** 7 split: the first part already chosen. */
  first: { m: number; n: number } | null;
}
let sel: Sel | null = null;
let ringActs: Array<() => void> = [];
/** Per-game stats for the win screen (team → captures / burns). */
let stats = { captures: [0, 0], burns: [0, 0], kills: [0, 0] };

function startLocal(): void {
  settings.name = nameInput.value.trim() || 'Player';
  store.set('jk-name', settings.name);
  attach(new LocalLink({ name: settings.name, avatar: settings.avatar, players: settings.players, level: settings.level, mode: settings.mode }));
}

function attach(l: GameLink): void {
  link?.dispose();
  link = l;
  view = null;
  real = null;
  queue.length = 0;
  busyUntil = 0;
  flights = 0;
  sel = null;
  gameRecorded = false;
  stats = { captures: [0, 0], burns: [0, 0], kills: [0, 0] };
  pileTop = -1;
  fireCount = -1;
  closeModal();
  $('#fx').innerHTML = '';
  floats.clear();
  $('#ticker').innerHTML = '';
  $('#menu').classList.add('hidden');
  $('#online').classList.add('hidden');
  $('#hud').classList.remove('hidden');
  $('#scorebar').classList.remove('hidden');
  board.showcase = false;
  let first = true;
  l.onUpdate = (v, events, views) => {
    real = v;
    updateAt = performance.now();
    if (first) {
      first = false;
      // The board starts from the state before these events (or the current one when joining late).
      const start = views.length === events.length && views.length ? null : v;
      board.reset({ n: v.n, me: v.me }, start ? start.marbles : new Array(v.n * 4).fill(HOME));
      board.setDiscard([]);
      board.setFire([]);
      if (start) {
        view = start;
        board.setDiscard(start.discard);
        board.setFire(start.fire);
        pileTop = start.discard[start.discard.length - 1]?.id ?? -1;
        fireCount = start.fireCount;
        render();
      }
    }
    if (!events.length) {
      const last = queue[queue.length - 1];
      if (last) last.view = v;
      else {
        view = v;
        render();
      }
      return;
    }
    const aligned = views.length === events.length;
    events.forEach((ev, i) => queue.push({ ev, view: aligned ? views[i]! : i === events.length - 1 ? v : null }));
  };
  l.onError = (msg) => {
    audio.error();
    ticker(esc(msg), 'error');
  };
  reserve();
}

function frame(now: number): void {
  requestAnimationFrame(frame);
  const gap = now - lastFrame;
  frameGaps.push(gap);
  if (frameGaps.length > 600) frameGaps.shift();
  const dt = Math.min(0.1, gap / 1000);
  lastFrame = now;
  // While the table is behind, freeze the local game (bots + timers) so it can catch up.
  link?.tick(queue.length > 1 ? 0 : dt * speed);
  while (queue.length && now >= busyUntil) {
    const step = queue.shift()!;
    const hurry = queue.length > 6 ? 0.35 : queue.length > 3 ? 0.65 : 1;
    busyUntil = now + (runStep(step) * 1000 * hurry) / speed;
  }
  if (view && !queue.length && now >= busyUntil && !board.animating) idleSync();
  if (view) renderTimers(now);
  board.frame(dt * speed);
  particles.update(dt);
  if (platesDirty) layoutPlates();
}
requestAnimationFrame(frame);

let pileTop = -1;
let fireCount = -1;
/** Caught up: make sure marbles and piles match the shown state exactly. */
function idleSync(): void {
  const v = view!;
  board.sync(v.marbles);
  if (!flights) {
    const top = v.discard[v.discard.length - 1]?.id ?? -1;
    if (top !== pileTop) {
      board.setDiscard(v.discard);
      pileTop = top;
    }
    if (v.fireCount !== fireCount) {
      board.setFire(v.fire);
      fireCount = v.fireCount;
    }
  }
}

/** Recently animated events (test hook). */
const evLog: Array<{ k: string; t: number; ev: GameEvent }> = [];
function runStep(step: Step): number {
  evLog.push({ k: step.ev.k, t: performance.now(), ev: step.ev });
  if (evLog.length > 300) evLog.shift();
  if (step.view) {
    board.finishAll();
    if (view) board.sync(view.marbles);
    rememberHand();
    view = step.view;
    render();
  }
  if (!view) return 0;
  return animate(step.ev);
}

// ============================================================================ rendering

const isMe = (p: number) => !!view && p === view.me;
function nameOf(p: number): string {
  if (!view) return '?';
  if (p === view.me) return 'You';
  return view.players[p]?.name ?? '?';
}
const colorOf = (p: number) => playerColor(view?.n ?? 4, p);
const who = (p: number) => `<b style="color:${colorOf(p).light}">${esc(nameOf(p))}</b>`;
const playing = (v: View) => v.phase === 'play';
/** My turn, the table is caught up, so I can act. */
function canAct(): boolean {
  return !!view && !!real && !queue.length && view.phase === 'play' && view.current === view.me && real.current === view.me && performance.now() >= busyUntil;
}
function stuck(v: View): boolean {
  return v.hand.every((c) => !movesIn(v, c).length);
}

function counts(v: View, p: number): { home: number; track: number; safe: number } {
  const r = { home: 0, track: 0, safe: 0 };
  for (let k = 0; k < 4; k++) {
    const pos = v.marbles[p * 4 + k]!;
    if (pos === HOME) r.home++;
    else if (pos >= SAFE0) r.safe++;
    else r.track++;
  }
  return r;
}
function dots(v: View, p: number): string {
  const c = colorOf(p);
  const out: string[] = [];
  for (let k = 0; k < 4; k++) {
    const pos = v.marbles[p * 4 + k]!;
    const cls = pos === HOME ? 'home' : pos >= SAFE0 ? 'safe' : 'track';
    out.push(`<i class="jk-dot ${cls}" style="--c:${c.hex}" title="${cls}"></i>`);
  }
  return out.join('');
}

function render(): void {
  const v = view;
  if (!v) return;
  if (sel && (!canAct() || !v.hand.some((c) => c.id === sel!.card.id))) sel = null;
  renderScorebar(v);
  renderPlates(v);
  renderMe(v);
  renderHand(v);
  highlights();
  board.setDeckCount(v.deckCount);
  board.setTurn(playing(v) ? v.current : -1, colorOf(v.current).hex);
}

function renderScorebar(v: View): void {
  const teams = v.n === 4 ? [0, 1] : [0, 1];
  const myTeam = v.me >= 0 ? teamOf(v.n, v.me) : 0;
  const html = teams
    .map((t) => {
      const ps = v.n === 4 ? [t, t + 2] : [t];
      const safe = ps.reduce((s, p) => s + counts(v, p).safe, 0);
      const total = ps.length * 4;
      const sw = ps.map((p) => `<i style="background:${colorOf(p).hex}"></i>`).join('');
      const label = v.n === 4 ? (t === myTeam ? 'YOUR TEAM' : 'RIVALS') : t === v.me ? 'YOU' : esc(v.players[t]?.name ?? '').toUpperCase();
      return `<div class="jk-team ${t === myTeam ? 'mine' : ''}"><span class="jk-team__sw">${sw}</span><span class="jk-team__name">${label}</span><b>${safe}<small>/${total}</small></b></div>`;
    })
    .join('<span class="jk-vs">vs</span>');
  setHTML($('#scorebar'), `${html}<div class="jk-handinfo"><span>${v.mode === 'complex' ? 'COMPLEX' : 'CLASSIC'}</span><span>Hand ${Math.max(1, v.inDeck)}/${v.perDeck} · Deck ${v.deckNo}</span></div>`);
}

function setHTML(el: HTMLElement, html: string): void {
  if (el.dataset.html === html) return;
  el.dataset.html = html;
  el.innerHTML = html;
}

function renderPlates(v: View): void {
  const others = v.players.map((_, p) => p).filter((p) => p !== v.me);
  const html = others
    .map((p) => {
      const pl = v.players[p]!;
      const c = colorOf(p);
      const turn = playing(v) && v.current === p;
      const partner = v.n === 4 && v.me >= 0 && teamOf(4, p) === teamOf(4, v.me);
      const backs = Math.min(pl.count, 5);
      const fan = Array.from({ length: backs }, (_, k) => `<i style="--k:${k - (backs - 1) / 2}"></i>`).join('');
      const done = counts(v, p).safe === 4;
      return `<div class="jk-plate ${turn ? 'turn' : ''}" data-p="${p}" style="--c:${c.hex};--cl:${c.light}">
        <div class="jk-plate__top">${avatar(pl.avatar, c.hex)}<div class="jk-plate__id"><b>${esc(pl.name)}</b><small>${partner ? 'PARTNER' : v.n === 4 ? 'RIVAL' : 'OPPONENT'}${pl.bot ? ' · BOT' : ''}${pl.connected ? '' : ' · offline'}</small></div></div>
        <div class="jk-plate__row"><span class="jk-plate__dots">${dots(v, p)}</span><span class="jk-plate__fan">${fan}<b>${pl.count}</b></span></div>
        ${done ? '<div class="jk-plate__done">ALL SAFE — plays for partner</div>' : ''}
        ${turn ? '<svg class="jk-plate__timer" viewBox="0 0 100 100" preserveAspectRatio="none"><rect x="2" y="2" width="96" height="96" rx="14" pathLength="100"/></svg>' : ''}
      </div>`;
    })
    .join('');
  if ($('#plates').dataset.html !== html) {
    setHTML($('#plates'), html);
    platesDirty = true;
  }
}

let platesDirty = true;
/** Plates sit next to their owner's home pocket: side columns on wide screens, a row at the top on narrow ones. */
function layoutPlates(): void {
  platesDirty = false;
  const v = view;
  if (!v) return;
  const side = sideMode();
  $('#plates').classList.toggle('row', !side);
  if (!side) {
    // Row order follows the table: left, across, right.
    const els = [...document.querySelectorAll<HTMLElement>('.jk-plate')];
    const order = (p: number) => ((p - Math.max(0, v.me) + v.n) % v.n) * (v.n === 2 ? 2 : 1);
    els.sort((a, b) => order(Number(a.dataset.p)) - order(Number(b.dataset.p)));
    for (const el of els) {
      el.style.left = '';
      el.style.top = '';
      $('#plates').appendChild(el);
    }
    return;
  }
  const br = board.boardRect();
  const top = 60;
  const bottom = $('#me').getBoundingClientRect().top - 8;
  for (const el of document.querySelectorAll<HTMLElement>('.jk-plate')) {
    const p = Number(el.dataset.p);
    const s = board.screenOfHome(p);
    const left = s.x < br.left + br.width / 2;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const colW = left ? br.left : innerWidth - br.right;
    let x = left ? Math.max(10, br.left - w - 14) : Math.min(innerWidth - w - 10, br.right + 14);
    if (colW < w + 24) x = left ? 10 : innerWidth - w - 10;
    const y = Math.max(top, Math.min(bottom - h, s.y - h / 2));
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }
}
function sideMode(): boolean {
  return innerWidth >= 760 && innerWidth >= innerHeight * 1.12;
}

function renderMe(v: View): void {
  const me = v.players[v.me];
  if (!me) {
    setHTML($('#me-info'), '<b>Watching</b>');
    return;
  }
  const c = colorOf(v.me);
  const turn = playing(v) && v.current === v.me;
  const finished = counts(v, v.me).safe === 4;
  setHTML(
    $('#me-info'),
    `${avatar(me.avatar, c.hex)}<div class="jk-me__id"><b>${esc(me.name)}</b><span class="jk-plate__dots">${dots(v, v.me)}</span>${finished && v.n === 4 ? '<small class="jk-me__partner">Moving your partner\'s marbles</small>' : ''}</div><b class="jk-clock hidden" id="me-clock"></b>`,
  );
  $('#me').classList.toggle('turn', turn);
  $('#me').style.setProperty('--c', c.hex);
}

function renderHand(v: View): void {
  const hand = [...v.hand].sort((a, b) => sortKey(a) - sortKey(b));
  const my = canAct();
  const stuckNow = my && stuck(v);
  const n = hand.length;
  setHTML(
    $('#hand'),
    hand
      .map((c, k) => {
        const ok = my && movesIn(v, c).length > 0;
        const cls = !my ? '' : stuckNow ? 'burnable' : ok ? 'ok' : 'no';
        return `<div class="jk-slot ${sel?.card.id === c.id ? 'sel' : ''} ${incoming.has(c.id) ? 'incoming' : ''}" style="--k:${k - (n - 1) / 2};--n:${n}"><div class="jk-card ${cls}" data-id="${c.id}"><img src="${cardImage(c)}" alt="${cardLabel(c)}" draggable="false" /><kbd>${k + 1}</kbd></div></div>`;
      })
      .join(''),
  );
  renderActions(v, stuckNow);
}

function cardHelp(c: Card, mode: Mode): string {
  const cx = mode === 'complex';
  switch (c.r) {
    case 1:
      return 'Bring a marble out, or move 1 or 11';
    case 13:
      return cx ? 'Bring out, or move 13 killing every marble passed' : 'Bring a marble out, or move 13';
    case 12:
      return cx && isBlack(c) ? 'Move 12, or the next player discards' : 'Move 12';
    case 11:
      return 'Swap one of your marbles with another on the track';
    case 10:
      return cx ? 'Move 10, or the next player discards' : 'Move 10';
    case 7:
      return 'Split 7 between one or two marbles';
    case 5:
      return cx ? 'Move ANY marble on the track 5' : 'Move 5';
    case 4:
      return 'Move one marble 4 backwards';
    default:
      return `Move ${c.r}`;
  }
}

function renderActions(v: View, stuckNow: boolean): void {
  const my = canAct();
  const acts: string[] = [];
  let hint = '';
  if (!playing(v)) hint = '';
  else if (!my) hint = v.current === v.me ? '' : `${esc(nameOf(v.current))} is thinking…`;
  else if (stuckNow) {
    hint = sel ? `Burn ${cardLabel(sel.card)}?` : 'No legal move — pick a card to burn 🔥';
    if (sel) acts.push(`<button class="jk-btn jk-btn--burn" data-act="burn"><span class="jk-display">🔥 BURN</span></button>`);
  } else if (!sel) hint = 'Your turn — pick a glowing card';
  else {
    const moves = movesIn(v, sel.card);
    const c = sel.card;
    if (moves.some((m) => m.k === 'out')) acts.push(`<button class="jk-btn jk-btn--go" data-act="out"><span class="jk-display">BRING OUT</span></button>`);
    if (moves.some((m) => m.k === 'attack')) acts.push(`<button class="jk-btn jk-btn--attack" data-act="attack">Next player discards</button>`);
    if (c.r === 11) hint = sel.marble >= 0 ? 'Now pick the marble to swap with' : 'Pick one of your marbles to swap';
    else if (c.r === 7) hint = sel.first ? `Pick a marble for the other ${7 - sel.first.n}` : sel.marble >= 0 ? 'How far? Tap a numbered ring (7, or less and split the rest)' : 'Pick a marble for the 7 (you can split it)';
    else hint = `${RANK_LABEL[c.r]}${SUIT_GLYPH[c.s]}: ${cardHelp(c, v.mode)}`;
  }
  if (my && sel) acts.push(`<button class="jk-btn jk-btn--ghost" data-act="cancel">Cancel</button>`);
  setHTML($('#actions'), acts.join(''));
  $('#hint').textContent = hint;
  renderSplit(v);
}

function renderSplit(v: View): void {
  const el = $('#split');
  if (!sel || sel.card.r !== 7 || !sel.first || !canAct()) {
    el.classList.add('hidden');
    return;
  }
  const c = colorOf(owner(sel.first.m));
  el.classList.remove('hidden');
  setHTML(el, `<div class="jk-split__eq"><span class="jk-display">7</span>=<b style="color:${c.light}">${sel.first.n}</b>+<b class="todo">${7 - sel.first.n}</b></div><small>Pick a marble for the remaining ${7 - sel.first.n}</small><button class="jk-chip" data-act="undo-split">Undo</button>`);
  void v;
}

// ---------------------------------------------------------------- highlights

/** Where a marble ends up after a move (board-local spot), for rings. */
function destOf(v: View, mv: Move): { x: number; z: number } | null {
  const b = boardOf(v);
  switch (mv.k) {
    case 'out':
      return board.squareSpot(owner(mv.m), startOf(v.n, owner(mv.m)));
    case 'fwd': {
      const p = fwdPath(b, mv.m, mv.n);
      return p ? board.squareSpot(owner(mv.m), p[p.length - 1]!) : null;
    }
    case 'back': {
      const pos = b.marbles[mv.m]!;
      return board.squareSpot(owner(mv.m), (pos + 76 - 4) % 76);
    }
    case 'swap':
      return board.spot(mv.t, b.marbles[mv.t]!);
    default:
      return null;
  }
}

function highlights(): void {
  ringActs = [];
  const v = view;
  if (!v || !canAct() || !sel) {
    board.setRings([]);
    board.setLift([]);
    return;
  }
  const moves = movesIn(v, sel.card);
  const rings: Array<{ x: number; z: number; id: number; label?: string; color?: string }> = [];
  const lift = new Set<number>();
  const card = sel.card;
  const play = (mv: Move) => () => send({ t: 'play', card: card.id, move: mv });
  const ring = (spot: { x: number; z: number } | null, act: () => void, label?: string, color?: string) => {
    if (!spot) return;
    rings.push({ ...spot, id: ringActs.length, label, color });
    ringActs.push(act);
  };
  const outMv = moves.find((m) => m.k === 'out');
  if (outMv) {
    ring(destOf(v, outMv), play(outMv), undefined, '#7dffb0');
    for (let k = 0; k < 4; k++) {
      const m = controlledOwner(boardOf(v), v.me) * 4 + k;
      if (v.marbles[m] === HOME) lift.add(m);
    }
  }
  if (card.r === 11) {
    const swaps = moves.filter((m): m is Extract<Move, { k: 'swap' }> => m.k === 'swap');
    if (sel.marble >= 0) {
      for (const s of swaps) if (s.m === sel.marble) {
        ring(destOf(v, s), play(s), undefined, '#ff9de0');
        lift.add(s.t);
      }
    } else for (const s of swaps) lift.add(s.m);
  } else if (card.r === 7) {
    const splits = moves.filter((m): m is Extract<Move, { k: 'split' }> => m.k === 'split');
    if (sel.first) {
      const f = sel.first;
      const after = boardOf(v);
      applyMove(after, v.me, card, { k: 'split', parts: [f] });
      for (const s of splits) {
        const p2 = s.parts[1];
        if (s.parts[0]!.m !== f.m || s.parts[0]!.n !== f.n || !p2) continue;
        if (sel.marble >= 0 && p2.m !== sel.marble) continue;
        lift.add(p2.m);
        const path = fwdPath(after, p2.m, p2.n);
        if (path) ring(board.squareSpot(owner(p2.m), path[path.length - 1]!), play(s), String(p2.n));
      }
    } else if (sel.marble >= 0) {
      const m = sel.marble;
      const ns = new Set<number>();
      for (const s of splits) if (s.parts[0]!.m === m) ns.add(s.parts[0]!.n);
      for (const n of [...ns].sort((a, b) => a - b)) {
        const path = fwdPath(boardOf(v), m, n)!;
        const full = splits.find((s) => s.parts.length === 1 && s.parts[0]!.m === m);
        ring(
          board.squareSpot(owner(m), path[path.length - 1]!),
          n === 7 && full
            ? play(full)
            : () => {
                sel!.first = { m, n };
                sel!.marble = -1;
                audio.select();
                refresh();
              },
          String(n),
        );
      }
    } else {
      for (const s of splits) lift.add(s.parts[0]!.m);
      for (const s of splits) if (s.parts.length === 1) ring(destOf(v, { k: 'fwd', m: s.parts[0]!.m, n: 7 }), play(s), '7');
    }
  } else {
    const mm = moves.filter((m): m is Extract<Move, { k: 'fwd' | 'back' }> => m.k === 'fwd' || m.k === 'back');
    const shown = sel.marble >= 0 ? mm.filter((m) => m.m === sel!.marble) : mm;
    for (const m of mm) lift.add(m.m);
    // Two marbles reaching the same hole: that ring asks for a marble first.
    const bySpot = new Map<string, Move[]>();
    for (const m of shown) {
      const d = destOf(v, m);
      if (!d) continue;
      const k = `${d.x.toFixed(2)},${d.z.toFixed(2)}`;
      bySpot.set(k, [...(bySpot.get(k) ?? []), m]);
    }
    for (const list of bySpot.values()) {
      const m0 = list[0]!;
      const label = sel.card.r === 1 && m0.k === 'fwd' ? String(m0.n) : undefined;
      ring(destOf(v, m0), list.length === 1 ? play(m0) : () => hintFlash('Two marbles can get there — tap the one to move'), label, m0.k === 'back' ? '#8fd0ff' : undefined);
    }
  }
  board.setRings(rings);
  board.setLift([...lift], sel.marble >= 0 ? sel.marble : (sel.first?.m ?? -1));
}

function refresh(): void {
  if (!view) return;
  renderHand(view);
  highlights();
}

function hintFlash(text: string): void {
  audio.error();
  const h = $('#hint');
  h.textContent = text;
  h.classList.remove('flash');
  void h.offsetWidth;
  h.classList.add('flash');
}

// ============================================================================ input

function send(a: Action): void {
  rememberHand();
  sel = null;
  board.setRings([]);
  board.setLift([]);
  link?.send(a);
}

function selectCard(c: Card): void {
  const v = view;
  if (!v || !canAct()) {
    if (v && playing(v) && v.current !== v.me) hintFlash(`Wait for ${nameOf(v.current)}…`);
    return;
  }
  if (sel?.card.id === c.id) {
    sel = null;
    refresh();
    return;
  }
  const moves = movesIn(v, c);
  if (!moves.length && !stuck(v)) {
    hintFlash(`${cardLabel(c)} can't move anything right now`);
    shakeCard(c.id);
    return;
  }
  audio.select();
  sel = { card: c, marble: -1, first: null };
  // Only one marble can use it (and no choice of distance): pick it right away.
  if (moves.length) {
    const movers = new Set(moves.map((m) => (m.k === 'fwd' || m.k === 'back' || m.k === 'swap' ? m.m : m.k === 'split' ? m.parts[0]!.m : -1)));
    if (movers.size === 1 && !movers.has(-1) && c.r !== 7) sel.marble = [...movers][0]!;
  }
  refresh();
}

function shakeCard(id: number): void {
  document.querySelector<HTMLElement>(`#hand .jk-card[data-id="${id}"]`)?.animate([{ transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'none' }], { duration: 200 });
}

function onMarble(m: number): void {
  const v = view;
  if (!v || !canAct()) return;
  if (!sel) {
    hintFlash('Pick a card first');
    $('#hand').animate([{ transform: 'translateY(-8px)' }, { transform: 'none' }], { duration: 260 });
    return;
  }
  const moves = movesIn(v, sel.card);
  const card = sel.card;
  const play = (mv: Move) => send({ t: 'play', card: card.id, move: mv });
  if (card.r === 11) {
    if (sel.marble >= 0) {
      const s = moves.find((x) => x.k === 'swap' && x.m === sel!.marble && x.t === m);
      if (s) return play(s);
    }
    if (moves.some((x) => x.k === 'swap' && x.m === m)) {
      sel.marble = sel.marble === m ? -1 : m;
      audio.select();
      return refresh();
    }
    return hintFlash(sel.marble >= 0 ? "Can't swap with that one" : 'Pick one of your own marbles first');
  }
  if (card.r === 7) {
    const splits = moves.filter((x): x is Extract<Move, { k: 'split' }> => x.k === 'split');
    if (sel.first) {
      const f = sel.first;
      const s = splits.find((x) => x.parts[0]!.m === f.m && x.parts[0]!.n === f.n && x.parts[1]?.m === m);
      if (s) return play(s);
      return hintFlash(`That marble can't move ${7 - f.n}`);
    }
    if (splits.some((x) => x.parts[0]!.m === m)) {
      sel.marble = sel.marble === m ? -1 : m;
      audio.select();
      return refresh();
    }
    return hintFlash("That marble can't use the 7");
  }
  const out = moves.find((x) => x.k === 'out');
  if (out && v.marbles[m] === HOME && owner(m) === controlledOwner(boardOf(v), v.me)) return play(out);
  const mm = moves.filter((x) => (x.k === 'fwd' || x.k === 'back') && x.m === m);
  if (mm.length === 1) return play(mm[0]!);
  if (mm.length > 1) {
    sel.marble = m;
    audio.select();
    return refresh();
  }
  hintFlash("That marble can't move with this card");
}

// Canvas clicks / taps (a drag of more than a few pixels is not a click).
let down: { x: number; y: number } | null = null;
const stage = $('#stage');
stage.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
stage.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) return;
  down = null;
  if (!view || $('#hud').classList.contains('hidden')) return;
  const hit = board.pick(e.clientX, e.clientY);
  if (hit?.ring !== undefined) {
    ringActs[hit.ring]?.();
    return;
  }
  if (hit?.marble !== undefined) return onMarble(hit.marble);
  if (sel) {
    if (sel.marble >= 0 && !sel.first) sel.marble = -1;
    else sel = null;
    refresh();
  }
});
let hoverPending = false;
stage.addEventListener('pointermove', (e) => {
  if (hoverPending || e.pointerType !== 'mouse') return;
  hoverPending = true;
  requestAnimationFrame(() => {
    hoverPending = false;
    const hit = view && canAct() ? board.pick(e.clientX, e.clientY) : null;
    stage.style.cursor = hit ? 'pointer' : '';
  });
});

// Hand: tap = select, long-press = zoom.
let pressTimer = 0;
let zoomed = false;
$('#hand').addEventListener('pointerdown', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('.jk-card');
  if (!el || !view) return;
  zoomed = false;
  clearTimeout(pressTimer);
  pressTimer = window.setTimeout(() => {
    const c = view?.hand.find((x) => x.id === Number(el.dataset.id));
    if (!c) return;
    zoomed = true;
    $('#zoom').innerHTML = `<img src="${cardImage(c)}" alt="" /><p>${esc(cardHelp(c, view!.mode))}</p>`;
    $('#zoom').classList.remove('hidden');
  }, 420);
});
const endPress = () => {
  clearTimeout(pressTimer);
  if (zoomed) setTimeout(() => $('#zoom').classList.add('hidden'), 50);
};
addEventListener('pointerup', endPress);
addEventListener('pointercancel', endPress);
$('#hand').addEventListener('click', (e) => {
  if (zoomed) return;
  const el = (e.target as HTMLElement).closest<HTMLElement>('.jk-card');
  if (!el || !view) return;
  const c = view.hand.find((x) => x.id === Number(el.dataset.id));
  if (c) selectCard(c);
});
$('#hand').addEventListener('contextmenu', (e) => e.preventDefault());

$('#hud').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
  if (!b || !view) return;
  const act = b.dataset.act;
  if (act === 'cancel') {
    sel = null;
    refresh();
  } else if (act === 'undo-split' && sel) {
    sel.first = null;
    sel.marble = -1;
    refresh();
  } else if (act === 'burn' && sel) send({ t: 'burn', card: sel.card.id });
  else if ((act === 'out' || act === 'attack') && sel) {
    const mv = movesIn(view, sel.card).find((m) => m.k === act);
    if (mv) send({ t: 'play', card: sel.card.id, move: mv });
  }
});

addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!$('#rules').classList.contains('hidden')) return $('#rules').classList.add('hidden');
    if (!$('#series').classList.contains('hidden')) return $('#series').classList.add('hidden');
    if (sel) {
      sel = null;
      refresh();
    }
    return;
  }
  if (!view || document.activeElement?.tagName === 'INPUT' || $('#hud').classList.contains('hidden') || $('#modal').dataset.kind) return;
  if (/^[1-5]$/.test(e.key)) {
    const hand = [...view.hand].sort((a, b) => sortKey(a) - sortKey(b));
    const c = hand[Number(e.key) - 1];
    if (c) selectCard(c);
  }
  if (e.key === 'b' || e.key === 'Enter') {
    const btn = $('#actions').querySelector<HTMLElement>(e.key === 'b' ? '[data-act="out"]' : '[data-act="burn"], [data-act="out"]');
    btn?.click();
  }
});

// ============================================================================ timers

let lastSecs = '';
function renderTimers(now: number): void {
  const v = view!;
  const total = v.turnTime;
  const src = !queue.length && real ? real : v;
  const left = Math.max(0, src.turnLeft - (src === real ? (now - updateAt) / 1000 : 0));
  const on = !!total && playing(v);
  const frac = on ? left / total : 1;
  for (const el of document.querySelectorAll<SVGElement>('.jk-plate.turn .jk-plate__timer rect')) el.style.strokeDashoffset = String(100 - frac * 100);
  const mine = on && v.current === v.me;
  const clock = document.getElementById('me-clock');
  if (clock) {
    clock.classList.toggle('hidden', !mine);
    const secs = String(Math.ceil(left));
    if (mine && secs !== lastSecs) {
      if (left < 6 && left > 0) audio.tick();
      lastSecs = secs;
      clock.textContent = secs;
      clock.classList.toggle('low', left < 6);
    }
  }
}

// ============================================================================ animations

function ticker(text: string, kind = ''): void {
  const t = $('#ticker');
  const el = document.createElement('div');
  el.className = `jk-tick ${kind}`;
  el.innerHTML = text;
  t.prepend(el);
  while (t.children.length > (innerWidth <= 760 ? 2 : 5)) t.lastElementChild!.remove();
  setTimeout(() => el.classList.add('old'), 5000);
}

function moveText(card: Card, mv: Move): string {
  switch (mv.k) {
    case 'out':
      return 'bring out';
    case 'fwd':
      return `move ${mv.n}`;
    case 'back':
      return 'back 4';
    case 'split':
      return mv.parts.length > 1 ? `split ${mv.parts[0]!.n} + ${mv.parts[1]!.n}` : 'move 7';
    case 'swap':
      return 'swap';
    case 'attack':
      return 'next player discards!';
  }
  void card;
}

function animate(ev: GameEvent): number {
  const v = view;
  if (!v) return 0;
  switch (ev.k) {
    case 'hand': {
      board.setDeckCount(v.deckCount + v.players.reduce((s, p) => s + p.count, 0));
      ticker(`${who(ev.dealer)} ${isMe(ev.dealer) ? 'deal' : 'deals'} hand ${ev.inDeck}/${ev.perDeck} — ${ev.size} cards each`, 'dim');
      if (ev.hand > 1) banner(`HAND ${ev.inDeck} / ${ev.perDeck}`, 'small');
      audio.deal(ev.size * v.n);
      return 0.35;
    }
    case 'shuffle':
      board.setDiscard([]);
      board.setFire([]);
      pileTop = -1;
      fireCount = 0;
      board.setDeckCount(52);
      audio.shuffle();
      ticker(`New deck shuffled (deck ${ev.deck})`, 'dim');
      return 0.5;
    case 'deal': {
      const mine = isMe(ev.p);
      const from = rectAt(board.screenOfDeck());
      for (let i = 0; i < ev.n; i++) {
        const c = mine ? ev.cards?.[i] : undefined;
        const slot = c && document.querySelector(`#hand .jk-card[data-id="${c.id}"]`)?.getBoundingClientRect();
        if (c) incoming.add(c.id);
        fly(from, slot && slot.width ? slot : seatRect(ev.p), c ? cardFace(c) : cardBack(), i * 0.06, () => c && reveal(c.id), 380);
      }
      if (mine) refresh();
      return 0.16;
    }
    case 'turn': {
      if (isMe(ev.p) && real?.current === v.me && real.phase === 'play') {
        audio.turn();
        banner(stuck(v) ? 'NO MOVE — BURN A CARD' : 'YOUR TURN', 'small');
      }
      return 0.05;
    }
    case 'play': {
      audio.card();
      const from = isMe(ev.p) ? (lastHandRects.get(ev.card.id) ?? seatRect(ev.p)) : seatRect(ev.p);
      flights++;
      fly(from, rectAt(board.screenOfDiscard()), cardFace(ev.card), 0, () => {
        flights--;
        board.addDiscard(ev.card);
        pileTop = ev.card.id;
        audio.flip();
      });
      ticker(`${who(ev.p)} ${isMe(ev.p) ? 'play' : 'plays'} <b>${esc(cardLabel(ev.card))}</b> — ${moveText(ev.card, ev.move)}`, ev.move.k === 'attack' ? 'bad' : '');
      return 0.5;
    }
    case 'out': {
      audio.out();
      const d = board.out(ev.m, startOf(v.n, owner(ev.m)));
      return d + 0.05;
    }
    case 'move': {
      const victims = ev.kills ?? [];
      const d = board.hop(ev.m, ev.path, {
        back: ev.back,
        kills: victims,
        onKill: (victim) => {
          board.capture(victim, ev.m);
          audio.capture();
        },
      });
      if (victims.length) {
        audio.sweep();
        setTimeout(() => banner(victims.length > 1 ? `KING SWEEP ×${victims.length}!` : 'KING SWEEP!', 'sweep'), 200 / speed);
        const t = teamOf(v.n, owner(ev.m));
        stats.kills[t] = (stats.kills[t] ?? 0) + victims.length;
        ticker(`👑 ${who(owner(ev.m))}'s King wipes out ${victims.map((k) => who(owner(k.m))).join(', ')}!`, 'bad');
      }
      return d + (victims.length ? 0.7 : 0.08);
    }
    case 'capture': {
      board.capture(ev.m, ev.by);
      audio.capture();
      shake(6);
      const byP = owner(ev.by);
      const vic = owner(ev.m);
      const t = teamOf(v.n, byP);
      stats.captures[t] = (stats.captures[t] ?? 0) + 1;
      const friendly = teamOf(v.n, vic) === t;
      const mineHurt = v.me >= 0 && teamOf(v.n, vic) === teamOf(v.n, v.me);
      stamp(friendly ? 'OOPS!' : 'CAPTURE!', mineHurt ? 'bad' : 'good');
      ticker(`💥 ${who(byP)} ${isMe(byP) ? 'capture' : 'captures'} ${isMe(vic) ? 'your' : `${who(vic)}'s`} marble${friendly ? ' (own team!)' : ''}`, mineHurt ? 'bad' : 'good');
      return 0.85;
    }
    case 'swap': {
      audio.swap();
      const d = board.swap(ev.a, ev.b);
      stamp('SWAP!', 'swap');
      ticker(`🔄 ${who(owner(ev.a))} ${isMe(owner(ev.a)) ? 'swap' : 'swaps'} with ${isMe(owner(ev.b)) ? 'you' : who(owner(ev.b))}`);
      return d + 0.05;
    }
    case 'safe': {
      board.safeBurst(ev.m);
      audio.safe();
      const p = owner(ev.m);
      if (v.me >= 0 && teamOf(v.n, p) === teamOf(v.n, v.me)) banner('SAFE!', 'safe');
      ticker(`🛡️ ${who(p)} ${isMe(p) ? 'reach' : 'reaches'} the safe zone`, 'good');
      return 0.25;
    }
    case 'finish':
      banner(isMe(ev.p) ? 'ALL HOME! NOW HELP YOUR PARTNER' : `${nameOf(ev.p).toUpperCase()} IS HOME!`, 'safe');
      ticker(`🏁 ${who(ev.p)} ${isMe(ev.p) ? 'have' : 'has'} all four marbles safe${v.n === 4 ? ' — now plays for the partner' : ''}`, 'good');
      return 0.9;
    case 'burn': {
      const from = isMe(ev.p) ? (lastHandRects.get(ev.card.id) ?? seatRect(ev.p)) : seatRect(ev.p);
      flights++;
      fly(from, rectAt(board.screenOfFire()), cardFace(ev.card), ev.why === 'attack' ? 0.15 : 0, () => {
        flights--;
        board.burn(ev.card);
        fireCount = (fireCount < 0 ? 0 : fireCount) + 1;
        audio.burn();
      });
      const t = teamOf(v.n, ev.p);
      stats.burns[t] = (stats.burns[t] ?? 0) + 1;
      if (ev.why === 'attack') {
        stamp('DISCARD!', isMe(ev.p) ? 'bad' : 'burn');
        ticker(`🔥 ${who(ev.p)} ${isMe(ev.p) ? 'lose' : 'loses'} <b>${esc(cardLabel(ev.card))}</b> to the fire`, isMe(ev.p) ? 'bad' : '');
      } else {
        stamp('BURNED!', 'burn');
        ticker(`🔥 ${who(ev.p)} can't move — ${isMe(ev.p) ? 'burn' : 'burns'} <b>${esc(cardLabel(ev.card))}</b>`, 'dim');
      }
      return 0.95;
    }
    case 'over': {
      recordGame(ev.team);
      setTimeout(() => view && showWin(ev.team), 900 / speed);
      return 1.2;
    }
    case 'timeout':
      ticker(`⏱ ${who(ev.p)} ran out of time`, 'dim');
      return 0.05;
    case 'left':
      ticker(`${who(ev.p)} left — a bot takes over`, 'dim');
      return 0.1;
  }
  return 0;
}

function rectAt(p: { x: number; y: number }, w = 60, h = 86): DOMRect {
  return new DOMRect(p.x - w / 2, p.y - h / 2, w, h);
}
function seatRect(p: number): DOMRect {
  if (view && p === view.me) return $('#hand').getBoundingClientRect();
  const el = document.querySelector<HTMLElement>(`.jk-plate[data-p="${p}"] .jk-plate__fan`);
  return el?.getBoundingClientRect() ?? rectAt(board.screenOfHome(p));
}
const cardFace = (c: Card) => `<div class="jk-card"><img src="${cardImage(c)}" alt="" /></div>`;
const BACK = backSvg();
const cardBack = () => `<div class="jk-card jk-back">${BACK}</div>`;

const incoming = new Set<number>();
function reveal(id: number): void {
  if (!incoming.delete(id)) return;
  document.querySelector(`#hand .jk-card[data-id="${id}"]`)?.parentElement?.classList.remove('incoming');
}

const lastHandRects = new Map<number, DOMRect>();
function rememberHand(): void {
  for (const el of document.querySelectorAll<HTMLElement>('#hand .jk-card[data-id]')) lastHandRects.set(Number(el.dataset.id), el.getBoundingClientRect());
  if (lastHandRects.size > 80) lastHandRects.clear();
}

let flights = 0;
function fly(from: DOMRect, to: DOMRect, html: string, delay = 0, done?: () => void, ms = 460): void {
  const el = document.createElement('div');
  el.className = 'jk-flyer';
  el.innerHTML = html;
  $('#fx').appendChild(el);
  const x0 = from.left + from.width / 2;
  const y0 = from.top + from.height / 2;
  const x1 = to.left + to.width / 2;
  const y1 = to.top + to.height / 2;
  const spin = (Math.random() - 0.5) * 50;
  const anim = el.animate(
    [
      { transform: `translate(${x0}px, ${y0}px) translate(-50%, -50%) scale(0.75) rotate(${-spin}deg)`, opacity: 0.7 },
      { transform: `translate(${(x0 + x1) / 2}px, ${Math.min(y0, y1) - 60}px) translate(-50%, -50%) scale(1) rotate(${spin / 2}deg)`, opacity: 1, offset: 0.5 },
      { transform: `translate(${x1}px, ${y1}px) translate(-50%, -50%) scale(0.55) rotate(${spin}deg)`, opacity: 1 },
    ],
    { duration: ms / speed, delay: (delay * 1000) / speed, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'both' },
  );
  anim.onfinish = () => {
    done?.();
    el.remove();
  };
}

function banner(text: string, tone: string): void {
  floatText(`jk-banner jk-display ${tone}`, text, tone.includes('small') ? 44 : 64, 0, 1500);
}
function stamp(text: string, kind: string): void {
  floatText(`jk-stamp jk-display ${kind}`, text, 84, 10, 1250);
}

interface Float {
  wrap: HTMLElement;
  el: HTMLElement;
  maxPx: number;
  w: number;
  h: number;
}
const floats = new Set<Float>();

/** Big transient label in the largest free spot (never over the plates, the hand, the ticker or the board itself if avoidable). */
function floatText(cls: string, text: string, maxPx: number, angle: number, ms: number): void {
  const wrap = document.createElement('div');
  wrap.className = 'jk-float';
  const el = document.createElement('div');
  el.className = `${cls} measure`;
  el.textContent = text;
  el.style.fontSize = '100px';
  wrap.appendChild(el);
  $('#fx').appendChild(wrap);
  const m = el.getBoundingClientRect();
  const a = (angle * Math.PI) / 180;
  const f: Float = { wrap, el, maxPx, w: m.width * Math.cos(a) + m.height * Math.sin(a), h: m.width * Math.sin(a) + m.height * Math.cos(a) };
  el.classList.remove('measure');
  floats.add(f);
  placeFloat(f);
  setTimeout(() => {
    floats.delete(f);
    wrap.remove();
  }, ms);
}

function placeFloat(f: Float, spots = freeSpots()): void {
  let best: DOMRect | null = null;
  let bestScore = 0;
  let size = 0;
  for (const spot of spots) {
    const px = Math.min(f.maxPx, (100 * spot.width * 0.86) / f.w, (100 * spot.height * 0.84) / f.h);
    const score = px * ((spot as DOMRect & { pref?: number }).pref ?? 1);
    if (score > bestScore) {
      bestScore = score;
      best = spot;
      size = px;
    }
  }
  f.wrap.style.visibility = !best || size < 12 ? 'hidden' : '';
  if (!best) return;
  // Never under the top bar / off screen, whatever the spot.
  const hw = (f.w * size) / 200;
  const hh = (f.h * size) / 200;
  const cx = Math.max(hw + 4, Math.min(innerWidth - hw - 4, best.x + best.width / 2));
  const cy = Math.max(56 + hh, Math.min(innerHeight - hh - 4, best.y + best.height / 2));
  f.wrap.style.left = `${cx}px`;
  f.wrap.style.top = `${cy}px`;
  f.el.style.fontSize = `${size}px`;
}

/** Rectangles with nothing important under them: beside / above / below the board, minus plates and the ticker. */
function freeSpots(): DOMRect[] {
  const pad = 6;
  const R = (x: number, y: number, r: number, b: number) => new DOMRect(x, y, r - x, b - y);
  const top = 56;
  const bottom = Math.min($('#me').getBoundingClientRect().top, $('#ticker').getBoundingClientRect().top || Infinity) - pad;
  const br = board.boardRect();
  let spots: DOMRect[] = [R(pad, top, br.left - pad, bottom), R(br.right + pad, top, innerWidth - pad, bottom), R(pad, top, innerWidth - pad, br.top - pad), R(pad, br.bottom + pad, innerWidth - pad, bottom)];
  const blockers = [...document.querySelectorAll<HTMLElement>('.jk-plate, #ticker .jk-tick, #split:not(.hidden)')].map((e) => e.getBoundingClientRect()).filter((r) => r.width);
  for (const t of blockers) {
    spots = spots.flatMap((s) => {
      if (s.right <= t.left || t.right <= s.left || s.bottom <= t.top || t.bottom <= s.top) return [s];
      return [R(s.left, s.top, s.right, t.top - pad), R(s.left, t.bottom + pad, s.right, s.bottom), R(s.left, s.top, t.left - pad, s.bottom), R(t.right + pad, s.top, s.right, s.bottom)];
    });
  }
  spots = spots.filter((s) => s.width > 60 && s.height > 24);
  // Fallback: a band across the middle of the board (over the discard pile, never the hand).
  const band = R(br.left + br.width * 0.12, br.top + br.height * 0.4, br.right - br.width * 0.12, br.top + br.height * 0.6) as DOMRect & { pref?: number };
  band.pref = 0.55;
  spots.push(band);
  return spots;
}

function shake(px: number): void {
  $('#stage').animate(
    Array.from({ length: 7 }, (_, i) => ({ transform: `translate(${(Math.random() - 0.5) * px * (1 - i / 7)}px, ${(Math.random() - 0.5) * px * (1 - i / 7)}px)` })).concat([{ transform: 'none' }]),
    { duration: 320 },
  );
}

// ---------------------------------------------------------------- particles (confetti)

const particles = (() => {
  const cv = $<HTMLCanvasElement>('#particles');
  const ctx = cv.getContext('2d')!;
  const list: Array<{ x: number; y: number; vx: number; vy: number; life: number; size: number; color: string; spin: number }> = [];
  const fit = () => {
    cv.width = innerWidth * devicePixelRatio;
    cv.height = innerHeight * devicePixelRatio;
  };
  fit();
  addEventListener('resize', fit);
  return {
    confetti(colors: string[]) {
      for (let i = 0; i < 220; i++)
        list.push({ x: Math.random() * innerWidth, y: -20 - Math.random() * 260, vx: (Math.random() - 0.5) * 140, vy: 90 + Math.random() * 220, life: 4, size: 8 + Math.random() * 9, color: colors[i % colors.length]!, spin: Math.random() * 10 });
    },
    get count() {
      return list.length;
    },
    update(dt: number) {
      if (!list.length) return;
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i]!;
        p.life -= dt;
        if (p.life <= 0) {
          list.splice(i, 1);
          continue;
        }
        p.vy += 60 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        ctx.globalAlpha = Math.min(1, p.life * 2);
        ctx.fillStyle = p.color;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.life * p.spin);
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      if (!list.length) ctx.clearRect(0, 0, innerWidth, innerHeight);
    },
  };
})();

// ============================================================================ layout

/** Tell the board which screen pixels the HUD uses. */
function reserve(): void {
  const inGame = !$('#hud').classList.contains('hidden');
  if (!inGame) {
    board.setReserve({ top: 40, bottom: 40, left: 0, right: 0 });
    return;
  }
  const side = sideMode();
  const meTop = $('#me').getBoundingClientRect().top;
  const tickerLane = side ? 0 : 30;
  const platesH = side ? 0 : ($('#plates').getBoundingClientRect().height || 70) + 6;
  const sides = side ? Math.min(240, innerWidth * 0.18) : 0;
  board.setReserve({ top: 54 + platesH, bottom: innerHeight - meTop + tickerLane + 4, left: sides, right: sides });
  // The log gets its own lane: above my bar (left column on wide screens, a full-width strip on narrow ones).
  $('#ticker').style.bottom = `${innerHeight - meTop + 4}px`;
  platesDirty = true;
}
addEventListener('resize', () => {
  board.resize();
  reserve();
  platesDirty = true;
  for (const f of floats) placeFloat(f);
});
new ResizeObserver(() => reserve()).observe($('#me'));

// ============================================================================ modals + series

function openModal(html: string, kind = ''): HTMLElement {
  const m = $('#modal');
  m.classList.remove('hidden');
  m.dataset.kind = kind;
  const p = $('#modal-panel');
  p.className = `jk-modal__panel ${kind}`;
  p.innerHTML = html;
  return p;
}
function closeModal(): void {
  $('#modal').classList.add('hidden');
  delete $('#modal').dataset.kind;
}

/** Games won per team this session (local) — online the room keeps the count. */
const series = { local: [0, 0] as [number, number], games: 0 };
let gameRecorded = false;
function recordGame(team: number): void {
  if (gameRecorded || !view) return;
  gameRecorded = true;
  if (!link?.online) {
    series.local[team as 0 | 1]++;
    series.games++;
  }
  $('#series-btn').classList.remove('hidden');
}
function teamWins(): [number, number] {
  return link?.online && lobby ? lobby.teamWins : series.local;
}
function seriesTable(): string {
  const v = view;
  const n = v?.n ?? settings.players;
  const [a, b] = teamWins();
  const team = (t: number) => {
    const ps = n === 4 ? [t, t + 2] : [t];
    const names = v ? ps.map((p) => `<span style="color:${playerColor(n, p).light}">${esc(nameOf(p))}</span>`).join(' & ') : TEAM_NAMES[t];
    return `<tr class="${(t === 0 ? a > b : b > a) ? 'lead' : ''}"><td><span class="jk-team__sw">${ps.map((p) => `<i style="background:${playerColor(n, p).hex}"></i>`).join('')}</span>${names}</td><td><b>${t === 0 ? a : b}</b></td></tr>`;
  };
  return `<table class="jk-series"><thead><tr><th>Team</th><th>Games won</th></tr></thead><tbody>${team(0)}${team(1)}</tbody></table>`;
}
function showSeries(): void {
  $('#series-panel').innerHTML = `<h2 class="jk-display gold">SCOREBOARD</h2><p class="jk-small">${link?.online ? 'This room' : 'This session'}</p>${seriesTable()}<div class="jk-two"><button class="jk-btn" id="series-close">Close</button>${link?.online ? '' : '<button class="jk-chip" id="series-reset">Reset</button>'}</div>`;
  $('#series').classList.remove('hidden');
}
$('#series-btn').addEventListener('click', showSeries);
$('#series').addEventListener('click', (e) => {
  const id = (e.target as HTMLElement).id;
  if (id === 'series' || id === 'series-close') $('#series').classList.add('hidden');
  if (id === 'series-reset') {
    series.local = [0, 0];
    showSeries();
  }
});

function showWin(team: number): void {
  const v = view!;
  const won = v.me >= 0 && teamOf(v.n, v.me) === team;
  const ps = v.n === 4 ? [team, team + 2] : [team];
  const cols = ps.map((p) => colorOf(p).hex);
  const title = v.n === 2 ? (won ? 'YOU WIN!' : `${esc(nameOf(team)).toUpperCase()} WINS!`) : won ? 'YOUR TEAM WINS!' : 'THE RIVALS WIN';
  const online = !!link?.online;
  const row = (t: number) => {
    const tp = v.n === 4 ? [t, t + 2] : [t];
    return `<div class="jk-result ${t === team ? 'win' : ''}"><div class="jk-result__who">${tp.map((p) => `${avatar(v.players[p]!.avatar, colorOf(p).hex)}<b style="color:${colorOf(p).light}">${esc(nameOf(p))}</b>`).join('')}</div><div class="jk-result__stats"><span>💥 ${stats.captures[t]}</span><span>🔥 ${stats.burns[t]}</span>${v.mode === 'complex' ? `<span>👑 ${stats.kills[t]}</span>` : ''}<span>🛡️ ${tp.reduce((s, p) => s + counts(v, p).safe, 0)}/${tp.length * 4}</span></div></div>`;
  };
  const p = openModal(
    `<h2 class="jk-display ${won ? 'gold' : ''}">${title}</h2><p class="jk-small">${v.mode === 'complex' ? 'Complex' : 'Classic'} · ${v.n === 4 ? '2 v 2' : '1 v 1'} · ${v.handNo} hands</p>
    <div class="jk-results">${row(team)}${row(1 - team)}</div>
    ${seriesTable()}
    <div class="jk-two"><button class="jk-btn jk-btn--go" id="again"><span class="jk-display">${online ? 'REMATCH' : 'PLAY AGAIN'}</span></button>${online ? '<button class="jk-btn" id="to-lobby">Lobby</button>' : ''}<button class="jk-btn" id="to-menu">Menu</button></div>${online ? '<p class="jk-small" id="rematch-votes"></p>' : ''}`,
    'over',
  );
  audio.win(won);
  particles.confetti(won || v.me < 0 ? [...cols, '#ffd76a', '#ffffff'] : cols);
  renderRematch();
  p.onclick = (e) => {
    const b = (e.target as HTMLElement).closest('button');
    const id = b?.id;
    if (id === 'again') {
      if (online) {
        net?.rematch();
        b!.setAttribute('disabled', '');
      } else {
        closeModal();
        startLocal();
      }
    }
    if (id === 'to-lobby') backToLobby();
    if (id === 'to-menu') toMenu();
  };
}

function toMenu(): void {
  link?.dispose();
  link = null;
  view = null;
  real = null;
  queue.length = 0;
  sel = null;
  void net?.leave();
  net = null;
  closeModal();
  showMenu();
}

// ============================================================================ online

let net: JackarooNet | null = null;
let lobby: JkLobby | null = null;
let lanUrl: string | null = null;
let reconnecting = false;
const oCode = $<HTMLInputElement>('#o-code');
oCode.addEventListener('input', () => (oCode.value = oCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4)));
const oStatus = (t: string, err = false) => {
  $('#o-status').textContent = t;
  $('#o-status').classList.toggle('error', err);
};

async function openOnline(code = ''): Promise<void> {
  settings.name = nameInput.value.trim() || 'Player';
  store.set('jk-name', settings.name);
  board.showcase = true;
  $('#menu').classList.add('hidden');
  $('#hud').classList.add('hidden');
  $('#online').classList.remove('hidden');
  $('#o-connect').classList.remove('hidden');
  $('#o-lobby').classList.add('hidden');
  if (code) oCode.value = code.toUpperCase().slice(0, 4);
  oStatus('');
  const probe = new JackarooNet();
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

async function connect(how: (n: JackarooNet) => Promise<void>): Promise<void> {
  if (net?.room) return;
  oStatus('Connecting…');
  const n = new JackarooNet();
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
    const was = lobby?.phase;
    lobby = l;
    renderLobby();
    renderRematch();
    if (l.phase === 'playing' && (was !== 'playing' || !link?.online)) {
      if (was !== 'playing') n.backlog.length = 0;
      attach(new OnlineLink(n));
    }
  };
  n.onError = (m) => {
    oStatus(m, true);
    if (link) ticker(esc(m), 'error');
  };
  n.onDrop = () => {
    if (net !== n) return;
    reconnecting = true;
    if (link?.online) ticker('Connection lost — reconnecting…', 'error');
    else oStatus('Connection lost — reconnecting…', true);
  };
  n.onReconnect = () => {
    if (net !== n) return;
    reconnecting = false;
    if (link?.online) ticker('Reconnected.', 'good');
    else oStatus('');
  };
  n.onClosed = (reason) => {
    if (net !== n) return;
    net = null;
    const was = reconnecting;
    reconnecting = false;
    if (link?.online) {
      ticker(was ? 'Could not reconnect — the game is lost.' : 'Disconnected.', 'error');
      setTimeout(toMenu, 1500);
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
  const n = l.config.players;
  const seat = (s: number) => {
    const m = l.seats[s];
    const c = playerColor(n, s);
    const team = n === 4 ? s % 2 : s;
    if (!m) return `<button class="jk-seat empty" data-seat="${s}" style="--c:${c.hex}"><span class="jk-seat__marble">${marbleSvg(c.hex, c.light)}</span><b>${c.name}</b><small>${l.phase === 'playing' ? 'BOT' : 'Bot · tap to sit'}</small></button>`;
    const me = m.id === net!.sessionId;
    return `<div class="jk-seat ${me ? 'me' : ''}" style="--c:${c.hex}"><span class="jk-seat__marble">${marbleSvg(c.hex, c.light)}</span>${avatar(m.avatar, c.hex)}<b>${esc(m.name)}</b><small>${m.id === l.hostId ? 'HOST' : me ? 'YOU' : ''}${m.connected ? '' : ' · reconnecting'}${l.rematch.includes(m.id) ? ' · ✔' : ''}</small><em>${TEAM_NAMES[team] ?? ''}</em></div>`;
  };
  const cols = n === 4 ? [[0, 2], [1, 3]] : [[0], [1]];
  $('#o-seats').innerHTML = cols
    .map((list, t) => `<div class="jk-seatcol"><h4>${n === 4 ? TEAM_NAMES[t] : `Player ${t + 1}`} <span>${l.teamWins[t as 0 | 1] ? `🏆 ${l.teamWins[t as 0 | 1]}` : ''}</span></h4>${list.map(seat).join('')}</div>`)
    .join('<div class="jk-seatvs">VS</div>');
  $('#o-host').classList.toggle('hidden', !host || l.phase === 'playing');
  setSeg('#o-players', String(l.config.players));
  setSeg('#o-mode', l.config.mode);
  setSeg('#o-level', l.config.botLevel);
  $('#o-rules').textContent = `${l.config.mode === 'complex' ? 'Complex' : 'Classic'} rules · ${n === 4 ? '2 v 2' : '1 v 1'} · empty seats: ${l.config.botLevel} bots · 40 s turns`;
  $('#o-wait').textContent = l.phase === 'playing' ? 'Game in progress…' : host ? 'Pick seats (= teams), then start. Bots take any empty seat.' : 'Pick a seat · waiting for the host to start…';
  const played = l.teamWins[0] + l.teamWins[1] > 0;
  $('#o-rematch').classList.toggle('hidden', l.phase === 'playing' || !played);
  $('#o-rematch').textContent = l.rematch.includes(net.sessionId) ? 'Waiting for the others…' : 'Vote rematch';
}

function renderRematch(): void {
  const el = document.getElementById('rematch-votes');
  if (!el || !lobby) return;
  const humans = lobby.seats.filter((s) => s).length;
  el.textContent = `Rematch votes: ${lobby.rematch.length} / ${humans}`;
}

function backToLobby(): void {
  link?.dispose();
  link = null;
  view = null;
  real = null;
  queue.length = 0;
  closeModal();
  board.showcase = true;
  $('#hud').classList.add('hidden');
  $('#scorebar').classList.add('hidden');
  $('#online').classList.remove('hidden');
  reserve();
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
$('#o-seats').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-seat]');
  if (b && lobby?.phase !== 'playing') net?.seat(Number(b.dataset.seat));
});
for (const [sel2, key] of [
  ['#o-players', 'players'],
  ['#o-mode', 'mode'],
  ['#o-level', 'botLevel'],
] as const) {
  $(sel2).addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!b) return;
    const v = b.dataset.v!;
    net?.config({ [key]: key === 'players' ? Number(v) : v });
  });
}
$('#o-start').addEventListener('click', () => net?.start());
$('#o-rematch').addEventListener('click', () => net?.rematch());
$('#o-copy').addEventListener('click', () => {
  const url = `${lanUrl ?? location.origin + location.pathname}?room=${net?.code ?? ''}`;
  void navigator.clipboard?.writeText(url).then(
    () => oStatus('Invite link copied!'),
    () => oStatus(url),
  );
});
$('#o-back').addEventListener('click', toMenu);

// ============================================================================ test hooks

/** Let the local player be played by the hard bot (tests / demos). */
let autoMe = false;
setInterval(() => {
  if (!autoMe || !canAct() || !(link instanceof LocalLink)) return;
  const e = link.engine;
  link.send(chooseAction(e, e.cur, 'hard'));
}, 120);

(window as unknown as Record<string, unknown>).__jk = {
  get link() {
    return link;
  },
  get view() {
    return view;
  },
  get real() {
    return real;
  },
  get queue() {
    return queue.length;
  },
  get sel() {
    return sel;
  },
  get loaded() {
    return loaded;
  },
  get gaps() {
    return frameGaps.slice();
  },
  get evLog() {
    return evLog.map((e) => ({ k: e.k, t: e.t, kills: e.ev.k === 'move' ? (e.ev.kills?.length ?? 0) : 0, why: e.ev.k === 'burn' ? e.ev.why : '', split: e.ev.k === 'move' ? e.ev.split : undefined, p: 'p' in e.ev ? e.ev.p : undefined }));
  },
  board,
  settings,
  startLocal,
  showMenu,
  banner,
  stamp,
  freeSpots,
  selectCard: (id: number) => {
    const c = view?.hand.find((x) => x.id === id);
    if (c) selectCard(c);
  },
  onMarble,
  ring: (i: number) => ringActs[i]?.(),
  get rings() {
    return ringActs.length;
  },
  canAct,
  movesIn: (id: number) => {
    const c = view?.hand.find((x) => x.id === id);
    return c && view ? movesIn(view, c) : [];
  },
  setSpeed: (s: number) => (speed = s),
  setAuto: (on: boolean) => (autoMe = on),
  cloneBoard,
};
