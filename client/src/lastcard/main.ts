import './styles.css';
import { COLOR_INFO, COLORS, cardLabel, sortKey, type Card, type Color } from './cards';
import { avatar, backSvg, cardSvg, svgDefs, AVATAR_COUNT, BACK_COUNT } from './art';
import { LocalLink, type GameLink } from './link';
import type { Action, GameEvent, Rules } from './engine';
import type { View } from './view';
import type { BotLevel } from './bots';
import { LastCardAudio } from './audio';
import { OnlineLink, LastCardNet } from './net/online';
import type { LcConfig, LcLobby } from './net/protocol';
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

/** House-rule switches shared by the setup screen and the online lobby. */
type RuleFlag = 'stacking' | 'stackTwoOnFour' | 'drawToMatch' | 'challenge' | 'sevenZero' | 'jumpIn' | 'forcePlay';
const RULE_FLAGS: Array<[RuleFlag, string, string]> = [
  ['challenge', '+4 challenges', 'A Wild Draw Four can be challenged'],
  ['stacking', 'Stack +2 / +4', 'Answer a Draw card with another one'],
  ['stackTwoOnFour', '+2 on +4', 'With stacking: a +2 may go on a +4'],
  ['drawToMatch', 'Draw until you can play', 'Keep drawing until a card fits — and play it'],
  ['sevenZero', '7-0 swaps', '7: swap hands with someone · 0: all hands move on'],
  ['jumpIn', 'Jump-in', 'Slap down an identical card out of turn'],
  ['forcePlay', 'Force play', 'If you can play, you must'],
];
const FLAG_DEFAULT: Record<RuleFlag, boolean> = { stacking: false, stackTwoOnFour: false, drawToMatch: false, challenge: true, sevenZero: false, jumpIn: false, forcePlay: false };
const legacyKey: Partial<Record<RuleFlag, string>> = { stacking: 'lc-stacking', drawToMatch: 'lc-match' };

const audio = new LastCardAudio();
audio.setMuted(store.get('lc-muted') === '1');
const settings = {
  name: store.get('lc-name') || `Player${Math.floor(100 + Math.random() * 900)}`,
  avatar: Number(store.get('lc-avatar') ?? Math.floor(Math.random() * AVATAR_COUNT)),
  bots: Number(store.get('lc-bots') ?? 3),
  level: (store.get('lc-level') as BotLevel) || 'normal',
  target: Number(store.get('lc-target') ?? 0),
  timer: Number(store.get('lc-timer') ?? 0),
  penalty: Number(store.get('lc-penalty') ?? 2) === 4 ? 4 : 2,
  back: Math.min(BACK_COUNT - 1, Math.max(0, Number(store.get('lc-back') ?? 0) || 0)),
  music: store.get('lc-music') === '1',
  flags: Object.fromEntries(
    RULE_FLAGS.map(([k]) => {
      const v = store.get(`lc-rule-${k}`) ?? (legacyKey[k] ? store.get(legacyKey[k]!) : null);
      return [k, v === null ? FLAG_DEFAULT[k] : v === '1'];
    }),
  ) as Record<RuleFlag, boolean>,
};

const fanCards = (['r', 'y', 'g', 'b'] as Color[]).map((c, i) => `<div class="lc-logo-card" style="--i:${i - 1.5}">${cardSvg({ kind: i === 3 ? 'wild4' : 'num', color: i === 3 ? null : c, n: [7, 2, 9, 0][i]! })}</div>`).join('');
const ruleToggles = (p: string) => `<div class="lc-toggles">${RULE_FLAGS.map(([k, label, tip]) => `<label title="${tip}"><input type="checkbox" id="${p}-rule-${k}" data-rule="${k}" /> ${label}</label>`).join('')}</div>`;
const penaltySeg = (p: string) => `<div class="lc-seg" id="${p}-penalty"><button data-v="2">Draw 2</button><button data-v="4">Draw 4</button></div>`;

document.getElementById('game')!.innerHTML = `
<div class="lc-shell">${svgDefs()}
  <div class="lc-topbar">
    <a class="lc-chip" href="/">← Arcade</a>
    <div class="lc-topbar__right"><button class="lc-chip hidden" id="series-btn" title="Series scoreboard">🏆</button><button class="lc-chip" id="rules-btn">?<span class="lc-wide"> Rules</span></button><button class="lc-chip" id="music" title="Music"></button><button class="lc-chip" id="sound" title="Sound effects"></button><button class="lc-chip" id="fullscreen"></button></div>
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
      <div class="lc-row"><label>House rules</label>${ruleToggles('m')}</div>
      <div class="lc-row lc-row--pair"><label>Caught</label>${penaltySeg('m')}<label>Turn timer</label><div class="lc-seg" id="m-timer"><button data-v="0">Off</button><button data-v="15">15 s</button><button data-v="30">30 s</button></div></div>
      <div class="lc-row"><label>Card back</label><div class="lc-backs" id="m-back">${Array.from({ length: BACK_COUNT }, (_, i) => `<button data-v="${i}" title="Card back ${i + 1}">${backSvg(i)}</button>`).join('')}</div></div>
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
          <div class="lc-row"><label>House rules</label>${ruleToggles('o')}</div>
          <div class="lc-row"><label>Caught</label>${penaltySeg('o')}</div>
          <button class="lc-btn lc-btn--go" id="o-start"><span class="lc-display">START GAME</span></button>
        </div>
        <p class="lc-rules-sum" id="o-rules"></p>
        <p class="lc-wait" id="o-wait"></p>
        <button class="lc-btn hidden" id="o-rematch">Rematch</button>
      </div>
      <p class="lc-status" id="o-status"></p>
      <div class="lc-foot"><button class="lc-chip" id="o-back">← Back</button><span id="o-server"></span></div>
    </div>
  </section>

  <section class="lc-table hidden" id="table">
    <div class="lc-seats" id="seats"></div>
    <div class="lc-center">
      <div class="lc-dir" id="dir"><div class="lc-dir__ring"><svg viewBox="0 0 200 200"><defs><marker id="lc-arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="currentColor"/></marker></defs>
        <path d="M100 12 A88 88 0 0 1 188 100" marker-end="url(#lc-arrow)"/><path d="M188 100 A88 88 0 0 1 100 188" marker-end="url(#lc-arrow)"/><path d="M100 188 A88 88 0 0 1 12 100" marker-end="url(#lc-arrow)"/><path d="M12 100 A88 88 0 0 1 100 12" marker-end="url(#lc-arrow)"/></svg></div>
        <div class="lc-dir__chev" id="chev"><svg viewBox="0 0 24 24"><path d="M4 7 L12 15 L20 7"/></svg></div></div>
      <div class="lc-pile" id="pile"><div class="lc-pile__stack" id="pile-stack"></div><div class="lc-pile__info"><b id="pile-count">0</b></div><div class="lc-pile__tap lc-display">TAP TO DRAW</div></div>
      <div class="lc-discard" id="discard"></div>
      <div class="lc-stack hidden" id="stack"></div>
      <div class="lc-ticker" id="ticker"></div>
    </div>
    <div class="lc-me" id="me">
      <div class="lc-me__info"><div class="lc-me__avatar" id="me-avatar"></div><div><b id="me-name"></b><small id="me-turn"></small></div><b class="lc-clock hidden" id="me-clock"></b></div>
      <div class="lc-hint" id="hint"></div>
      <div class="lc-actions">
        <button class="lc-btn lc-btn--catch hidden" id="catch-btn"><span class="lc-display">CATCH!</span></button>
        <button class="lc-btn lc-btn--call dim" id="call-btn"><span class="lc-display">LAST CARD!</span></button>
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
  <section class="lc-modal hidden" id="series"><div class="lc-modal__panel" id="series-panel"></div></section>
</div>`;

const shell = $('.lc-shell');

// ============================================================================ helpers

function cardHtml(c: Pick<Card, 'kind' | 'color' | 'n'> & { id?: number }, cls = ''): string {
  return `<div class="lc-card ${cls}" ${c.id !== undefined ? `data-id="${c.id}"` : ''}>${cardSvg(c)}</div>`;
}
function backHtml(cls = ''): string {
  return `<div class="lc-card lc-back ${cls}">${backSvg(settings.back)}</div>`;
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
const isWild = (c: Pick<Card, 'kind'>) => c.kind === 'wild' || c.kind === 'wild4';

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
for (const [sel, key] of [['#m-bots', 'bots'], ['#m-level', 'level'], ['#m-target', 'target'], ['#m-timer', 'timer'], ['#m-penalty', 'penalty'], ['#m-back', 'back']] as const) {
  $(sel).addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!b) return;
    (settings as Record<string, unknown>)[key] = key === 'level' ? b.dataset.v : Number(b.dataset.v);
    store.set(`lc-${key}`, String(b.dataset.v));
    setSeg(sel, b.dataset.v!);
    if (key === 'back') applyBack();
  });
}
function syncRuleBoxes(p: string, flags: Record<RuleFlag, boolean>): void {
  for (const [k] of RULE_FLAGS) $<HTMLInputElement>(`#${p}-rule-${k}`).checked = flags[k];
  // "+2 on +4" only means something with stacking on.
  $<HTMLInputElement>(`#${p}-rule-stackTwoOnFour`).disabled = !flags.stacking;
}
$('#menu').addEventListener('change', (e) => {
  const k = (e.target as HTMLElement).dataset.rule as RuleFlag | undefined;
  if (!k) return;
  settings.flags[k] = (e.target as HTMLInputElement).checked;
  store.set(`lc-rule-${k}`, settings.flags[k] ? '1' : '0');
  syncRuleBoxes('m', settings.flags);
});
function applyBack(): void {
  shell.dataset.back = String(settings.back);
}
renderAvatars();
setSeg('#m-bots', String(settings.bots));
setSeg('#m-level', settings.level);
setSeg('#m-target', String(settings.target));
setSeg('#m-timer', String(settings.timer));
setSeg('#m-penalty', String(settings.penalty));
setSeg('#m-back', String(settings.back));
syncRuleBoxes('m', settings.flags);
applyBack();

const soundBtn = $('#sound');
const musicBtn = $('#music');
const syncSound = () => {
  soundBtn.textContent = audio.muted ? '🔇' : '🔊';
  musicBtn.textContent = '♪';
  musicBtn.classList.toggle('off', !settings.music);
};
soundBtn.addEventListener('click', () => {
  audio.setMuted(!audio.muted);
  store.set('lc-muted', audio.muted ? '1' : '0');
  syncSound();
});
musicBtn.addEventListener('click', () => {
  settings.music = !settings.music;
  store.set('lc-music', settings.music ? '1' : '0');
  audio.setMusic(settings.music);
  syncSound();
});
// Browsers only start audio after a gesture: resume the music on the first one.
const kickMusic = () => {
  if (settings.music && !audio.music) audio.setMusic(true);
};
addEventListener('pointerdown', kickMusic, { once: true });
addEventListener('keydown', kickMusic, { once: true });
syncSound();
bindFullscreenButton($('#fullscreen'), ['⛶', '⛶']);
installFullscreenKey();

$('#rules-panel').innerHTML = `<h2 class="lc-display">HOW TO PLAY</h2>
<p><b>Get rid of all your cards.</b> On your turn, play a card that matches the top card by <b>colour</b>, <b>number</b> or <b>symbol</b>. Can't (or don't want to)? <b>Draw one</b> — if it can be played, you may play it right away.</p>
<p><b>Skip</b> — the next player loses their turn. <b>Reverse</b> — switch direction (with two players it works like Skip). <b>Draw Two</b> — the next player draws 2 and loses their turn.</p>
<p><b>Wild</b> — pick the colour; play it any time. If the very first card is a Wild, the first player picks the colour. <b>Wild Draw Four</b> — pick the colour, the next player draws 4 and loses their turn. You're only allowed to play it when you have <b>no card of the current colour</b>… but you can bluff! The next player may <b>challenge</b>: if you bluffed, <i>you</i> draw 4; if you didn't, they draw 6.</p>
<p><b>LAST CARD!</b> — you may call it any time you're down to <b>two cards or fewer</b>: before you play, or right after (we're lenient — until the next player acts). If someone <b>catches</b> you on one card before you call it, you draw 2 (or 4 with the harsh penalty).</p>
<p><b>Scoring</b> — the round winner scores the cards left in everyone's hands: numbers at face value, Skip / Reverse / Draw Two 20, Wilds 50. Play one round, or race to 200 / 500. The 🏆 button keeps a scoreboard across games.</p>
<p><b>House rules</b> (optional) — <b>Stacking</b>: answer a +2 with a +2 or +4, and a +4 with a +4, to pass the growing pile on (a stacked +4 can't be challenged; a +2 can't go on a +4 unless <b>+2 on +4</b> is on). <b>Draw until you can play</b>: keep drawing, then you must play the card. <b>Force play</b>: if you can play, you must (including a playable drawn card). <b>7-0</b>: a 7 swaps hands with a player you pick; a 0 passes every hand along in the play direction. <b>Jump-in</b>: play the exact same card (colour and number/symbol) out of turn — play continues from you. <b>+4 challenges</b> off: a +4 always costs 4.</p>
<p class="lc-keys">Keys: <b>1</b>–<b>9</b> play the n-th playable card · <b>←</b>/<b>→</b> select · <b>Enter</b> play · <b>D</b>/<b>Space</b> draw · <b>L</b> last card · <b>C</b> catch · <b>K</b> keep · <b>R</b>/<b>Y</b>/<b>G</b>/<b>B</b> pick a colour · <b>Esc</b> close</p>
<button class="lc-btn" id="rules-close">Got it</button>`;
$('#rules-btn').addEventListener('click', () => $('#rules').classList.remove('hidden'));
$('#rules').addEventListener('click', (e) => {
  if ((e.target as HTMLElement).id === 'rules' || (e.target as HTMLElement).id === 'rules-close') $('#rules').classList.add('hidden');
});

// ============================================================================ table state

/** One animation step: an event and my view right after it (null when unknown). */
interface Step {
  ev: GameEvent;
  view: View | null;
  at: number;
}

let link: GameLink | null = null;
/** The state the table is SHOWING (catches up with the real one event by event). */
let view: View | null = null;
/** The latest real state from the link. */
let real: View | null = null;
const queue: Step[] = [];
let busyUntil = 0;
let lastFrame = performance.now();
let updateAt = performance.now();
/** Delay between an event arriving and its animation starting (ms) — for the lag probe. */
const lagLog: number[] = [];

function startLocal(): void {
  settings.name = nameInput.value.trim() || 'Player';
  link?.dispose();
  const rules: Partial<Rules> = { ...settings.flags, target: settings.target, turnTime: settings.timer, unoPenalty: settings.penalty };
  attach(new LocalLink({ name: settings.name, avatar: settings.avatar, bots: settings.bots, level: settings.level, rules }));
}

function attach(l: GameLink): void {
  link?.dispose();
  link = l;
  view = null;
  real = null;
  queue.length = 0;
  busyUntil = 0;
  flights = 0;
  flying = null;
  pileShown = [];
  incoming.clear();
  lastHandRects.clear();
  prevCounts.clear();
  selected = -1;
  gameRecorded = false;
  closeModal();
  closeWheel();
  $('#fx').innerHTML = '';
  floats.clear();
  $('#discard').innerHTML = '';
  $('#menu').classList.add('hidden');
  $('#online').classList.add('hidden');
  $('#table').classList.remove('hidden');
  $('#ticker').innerHTML = '';
  l.onUpdate = (v, events, views) => {
    real = v;
    updateAt = performance.now();
    if (!events.length) {
      // A refresh without events (timers, connections): same state as the last queued step.
      const last = queue[queue.length - 1];
      if (last) last.view = v;
      else {
        view = v;
        render();
      }
      return;
    }
    const aligned = views.length === events.length;
    events.forEach((ev, i) => queue.push({ ev, view: aligned ? views[i]! : i === events.length - 1 ? v : null, at: updateAt }));
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
  // While the table is behind, freeze the local game (bots and timers) so it can catch up.
  link?.tick(queue.length > 1 ? 0 : dt);
  while (queue.length && now >= busyUntil) {
    const step = queue.shift()!;
    // Hurry when several steps are waiting (online the server doesn't wait for us).
    const speed = queue.length > 4 ? 0.35 : queue.length > 2 ? 0.65 : 1;
    busyUntil = now + runStep(step) * 1000 * speed;
  }
  if (view && !flights) syncDiscard(view.top);
  if (view) renderTimers(now);
  particles.update(dt);
}
requestAnimationFrame(frame);

function runStep(step: Step): number {
  lagLog.push(performance.now() - step.at);
  if (lagLog.length > 400) lagLog.shift();
  if (step.view) {
    const ev = step.ev;
    // My new cards stay invisible until their flight lands.
    if (ev.k === 'draw' && ev.by === step.view.you && ev.cards) for (const c of ev.cards) incoming.add(c.id);
    // A card about to fly onto the pile: keep the pile as it is until it lands.
    if (ev.k === 'play' || ev.k === 'flip') {
      flights++;
      flying = ev.card.id;
    }
    rememberHand();
    view = step.view;
    render();
  }
  if (!view) {
    if (step.ev.k === 'play' || step.ev.k === 'flip') flights--;
    return 0;
  }
  return animate(step.ev);
}

// ============================================================================ rendering

function nameOf(id: string): string {
  if (!view) return id;
  if (id === view.you) return 'You';
  return view.players.find((p) => p.id === id)?.name ?? id;
}

const prevCounts = new Map<string, number>();
const playing = (v: View) => v.phase !== 'over' && v.phase !== 'roundOver';
const myTurnIn = (v: View) => v.current === v.you && (v.phase === 'play' || v.phase === 'drawn');

function render(): void {
  const v = view;
  if (!v) return;
  const me = v.players.find((p) => p.id === v.you);
  const scored = v.rules.target > 0;
  // Seats: everyone else, in turn order after me.
  const i0 = Math.max(0, v.players.findIndex((p) => p.id === v.you));
  const order = v.players.map((_, k) => v.players[(i0 + 1 + k) % v.players.length]!).filter((p) => p.id !== v.you);
  const swapping = v.phase === 'pickSwap' && v.current === v.you;
  setHTML(
    $('#seats'),
    order
      .map((p) => {
        const turn = v.current === p.id && playing(v);
        const backs = Math.min(p.count, 10);
        const fan = Array.from({ length: backs }, (_, k) => `<i style="--k:${k - (backs - 1) / 2}"></i>`).join('');
        const one = p.count === 1;
        return `<div class="lc-seat ${turn ? 'turn' : ''} ${one ? 'one' : ''} ${swapping ? 'pick' : ''}" data-id="${p.id}">
          <div class="lc-seat__avatar">${avatar(p.avatar)}${p.bot ? '<em>BOT</em>' : ''}${p.connected ? '' : '<em class="off">…</em>'}<svg class="lc-seat__timer" viewBox="0 0 100 100"><circle cx="50" cy="50" r="46"/></svg>${turn && v.rules.turnTime ? '<b class="lc-seat__clock"></b>' : ''}</div>
          <div class="lc-seat__name">${esc(p.name)}</div>
          <div class="lc-seat__fan">${fan}<b>${p.count}</b></div>
          ${scored ? `<div class="lc-seat__score">${p.score} pts</div>` : ''}
          ${one && p.called ? '<div class="lc-seat__last">LAST CARD!</div>' : ''}
          ${v.vulnerable === p.id ? '<button class="lc-seat__catch" data-catch="' + p.id + '">CATCH!</button>' : ''}
        </div>`;
      })
      .join(''),
  );
  // One-shot "!" when someone drops to their last card.
  for (const p of order) {
    const was = prevCounts.get(p.id);
    if (p.count === 1 && was !== undefined && was > 1 && playing(v)) {
      seatPop(p.id, '!', 'warn');
      audio.warn();
    }
    prevCounts.set(p.id, p.count);
  }
  // Draw pile.
  setHTML($('#pile-stack'), Array.from({ length: Math.max(1, Math.min(6, Math.ceil(v.drawCount / 12))) }, (_, k) => backHtml(`s${k}`)).join(''));
  $('#pile-count').textContent = String(v.drawCount);
  const myTurn = myTurnIn(v);
  const canDraw = myTurn && v.phase === 'play' && !v.mustPlay;
  $('#pile').classList.toggle('mine', canDraw);
  $('#pile').classList.toggle('tap', canDraw && !v.playable.length);
  // Direction + colour.
  const dir = $('#dir');
  dir.classList.toggle('ccw', v.dir === -1);
  applyColor(v.color);
  const stack = $('#stack');
  stack.classList.toggle('hidden', !v.pendingDraw);
  stack.textContent = `+${v.pendingDraw}`;
  if (!flights) syncDiscard(v.top);
  // Me.
  setHTML($('#me-avatar'), avatar(me?.avatar ?? 0));
  $('#me-name').textContent = `${me?.name ?? 'Watching'}${scored && me ? ` · ${me.score} pts` : ''}`;
  $('#me').classList.toggle('turn', v.current === v.you && playing(v));
  $('#me-turn').textContent = !playing(v) ? '' : v.current === v.you ? (v.phase === 'pickColor' ? 'Pick the colour' : v.phase === 'pickSwap' ? 'Pick who to swap with' : 'Your turn') : `${nameOf(v.current)}'s turn`;
  // Hand.
  const hand = sortedHand();
  const playable = new Set(v.playable);
  const n = hand.length;
  if (selected >= n) selected = n - 1;
  setHTML(
    $('#hand'),
    hand
      .map((c, k) => {
        const mid = (n - 1) / 2;
        const cls = myTurn ? (playable.has(c.id) ? 'ok' : 'no') : playable.has(c.id) ? 'ok jump' : '';
        return `<div class="lc-slot ${c.id === v.drawnId ? 'drawn' : ''} ${k === selected ? 'sel' : ''} ${incoming.has(c.id) ? 'incoming' : ''}" style="--k:${k - mid}">${cardHtml(c, cls)}</div>`;
      })
      .join(''),
  );
  layoutHand();
  renderActions();
  placeChevron();
  // Prompts that belong to the shown state.
  const kind = $('#modal').dataset.kind;
  if (v.phase === 'challenge' && v.challengeFrom && !kind) showChallenge(v.challengeFrom);
  if (v.phase !== 'challenge' && kind === 'challenge') closeModal();
  if (swapping && !kind) showSwap();
  if (!swapping && kind === 'swap') closeModal();
  if (v.phase === 'pickColor' && v.current === v.you) {
    if (!wheel) openWheel(null);
  } else if (wheel && (!wheel.card ? true : !myTurn)) closeWheel();
  if (v.phase === 'play' && kind === 'round') closeModal();
  refitFloats();
}

function sortedHand(): Card[] {
  return [...(view?.hand ?? [])].sort((a, b) => sortKey(a) - sortKey(b));
}

/** Fan the hand so any number of cards fits the width (scrolls past ~1 card in 5 visible). */
function layoutHand(): void {
  const el = $('#hand');
  const n = view?.hand.length ?? 0;
  const card = el.querySelector<HTMLElement>('.lc-card');
  if (!card || !n) return;
  const cs = getComputedStyle(el);
  const cw = card.offsetWidth;
  const avail = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 8;
  const minStep = Math.max(14, cw * 0.22);
  let step = n > 1 ? Math.min(cw * 0.8, (avail - cw) / (n - 1)) : cw;
  const scroll = step < minStep;
  if (scroll) step = minStep;
  el.style.setProperty('--m', `${(step - cw) / 2}px`);
  el.style.setProperty('--rot', `${Math.min(2.6, 34 / n)}deg`);
  // Big hands sag less so the outer cards stay on screen.
  el.style.setProperty('--sag', `${n > 12 ? 12 : n > 8 ? 20 : 28}px`);
  el.classList.toggle('scroll', scroll);
}
addEventListener('resize', () => {
  layoutHand();
  placeChevron();
  refitFloats();
});

function applyColor(c: Color | null): void {
  const hex = c ? COLOR_INFO[c].hex : '#ffffff';
  $('#dir').style.setProperty('--col', hex);
  $('#discard').style.setProperty('--col', c ? hex : 'transparent');
}

let chevAngle = -90;
/** Point the ring's chevron at whoever's turn it is. */
function placeChevron(): void {
  const v = view;
  const chev = $('#chev');
  if (!v || !playing(v)) return chev.classList.add('hidden');
  chev.classList.remove('hidden');
  const r = $('#dir').getBoundingClientRect();
  const t = v.current === v.you ? $('#me-avatar').getBoundingClientRect() : document.querySelector(`.lc-seat[data-id="${v.current}"] .lc-seat__avatar`)?.getBoundingClientRect();
  if (!t || !r.width) return;
  let a = (Math.atan2(t.top + t.height / 2 - (r.top + r.height / 2), t.left + t.width / 2 - (r.left + r.width / 2)) * 180) / Math.PI;
  // Keep the angle continuous so the transition takes the short way round.
  while (a - chevAngle > 180) a -= 360;
  while (a - chevAngle < -180) a += 360;
  chevAngle = a;
  chev.style.transform = `rotate(${a}deg) translateX(${r.width / 2 + 4}px) rotate(-90deg)`;
}

function renderActions(): void {
  const v = view!;
  const me = v.players.find((p) => p.id === v.you);
  const myTurn = myTurnIn(v);
  const count = v.hand.length;
  const live = playing(v) && !!me;
  // The call button is always there in a game; it lights up when calling is allowed.
  const canCall = live && !me.called && count > 0 && count <= 2;
  const call = $('#call-btn');
  call.classList.toggle('hidden', !live);
  call.classList.toggle('dim', !canCall);
  call.classList.toggle('urgent', v.vulnerable === v.you);
  const catchable = v.vulnerable && v.vulnerable !== v.you;
  $('#catch-btn').classList.toggle('hidden', !catchable);
  $('#keep-btn').classList.toggle('hidden', !(myTurn && v.phase === 'drawn' && !v.mustPlay));
  $('#draw-btn').classList.toggle('hidden', !(myTurn && v.phase === 'play' && !v.mustPlay));
  $('#draw-btn').innerHTML = `<span class="lc-display">${v.pendingDraw ? `TAKE +${v.pendingDraw}` : 'DRAW'}</span>`;
  $('#hint').textContent =
    v.phase === 'drawn' && myTurn
      ? v.mustPlay
        ? 'Play the card you drew'
        : 'Play the card you drew, or keep it'
      : myTurn && v.pendingDraw
        ? `Stack a Draw card, or take ${v.pendingDraw}`
        : myTurn && !v.playable.length
          ? 'No match — draw a card'
          : myTurn && v.mustPlay
            ? 'You can play — so you must!'
            : myTurn
              ? 'Your turn — play a glowing card'
              : v.playable.length
                ? 'Jump in! You hold the same card'
                : '';
}

let lastClock = { secs: '', cur: '' };
function renderTimers(now: number): void {
  const v = view!;
  const total = v.rules.turnTime;
  // The real clock only runs while the table is caught up; otherwise show the step's value.
  const src = !queue.length && real ? real : v;
  const left = Math.max(0, src.turnLeft - (src === real ? (now - updateAt) / 1000 : 0));
  const show = !!total && playing(v);
  for (const el of document.querySelectorAll<HTMLElement>('.lc-seat.turn .lc-seat__timer')) el.style.setProperty('--p', total ? String(left / total) : '1');
  const mine = show && v.current === v.you;
  $('#me').style.setProperty('--p', mine ? String(left / total) : '0');
  const secs = String(Math.ceil(left));
  const low = left < 5;
  const clock = $('#me-clock');
  clock.classList.toggle('hidden', !mine);
  if (show && (secs !== lastClock.secs || v.current !== lastClock.cur)) {
    // Tick through the last seconds of my turn.
    if (mine && low && v.current === lastClock.cur && left > 0) audio.tick();
    lastClock = { secs, cur: v.current };
    clock.textContent = secs;
    clock.classList.toggle('low', low);
    $('#me').classList.toggle('low', mine && low);
  }
  // Seats are re-rendered often: keep their clock text in step every frame.
  const sc = document.querySelector<HTMLElement>('.lc-seat.turn .lc-seat__clock');
  if (sc && sc.textContent !== secs) {
    sc.textContent = secs;
    sc.classList.toggle('low', low);
  }
  if (!mine) $('#me').classList.remove('low');
  const m = $('#modal');
  if (m.dataset.kind === 'round' && real) {
    // Total wait = what's left of the hold + the engine's pause (which only runs after the hold).
    const held = link?.holdLeft ?? 0;
    const pause = Math.max(0, real.pauseLeft - (held > 0 ? 0 : (now - updateAt) / 1000));
    const t = $('#round-next');
    if (t) t.textContent = String(Math.max(0, Math.ceil(held + pause)));
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
/** Card currently flying onto the pile (it counts as "on the pile" for the lag probe). */
let flying: number | null = null;
/** Cards visible on the discard pile (top last) with their random tilt. */
let pileShown: Array<{ id: number; html: string; rot: number; dx: number; dy: number }> = [];
function pushDiscard(c: Card): void {
  if (pileShown[pileShown.length - 1]?.id === c.id) return;
  pileShown.push({ id: c.id, html: cardHtml(c), rot: (Math.random() - 0.5) * 30, dx: (Math.random() - 0.5) * 14, dy: (Math.random() - 0.5) * 10 });
  if (pileShown.length > 5) pileShown.shift();
  drawDiscard(true);
}
function syncDiscard(top: Card | null): void {
  if (!top) {
    if (pileShown.length) {
      pileShown = [];
      drawDiscard(false);
    }
    return;
  }
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

/** Play a card from my hand (asks for a colour first for wilds). */
function playCard(card: Card, el?: HTMLElement | null): void {
  if (!view) return;
  if (!view.playable.includes(card.id)) {
    audio.error();
    el?.animate([{ transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'none' }], { duration: 180 });
    if (myTurnIn(view) && !view.playable.length) noMatch();
    return;
  }
  if (isWild(card)) return openWheel(card);
  send({ t: 'play', card: card.id });
}

/** Nothing fits: shake the whole hand and point at the deck. */
function noMatch(): void {
  $('#hand').animate([{ transform: 'translateX(-10px)' }, { transform: 'translateX(9px)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(4px)' }, { transform: 'none' }], { duration: 320 });
  const p = $('#pile');
  p.classList.remove('nudge');
  void p.offsetWidth;
  p.classList.add('nudge');
}

$('#hand').addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('.lc-card');
  if (!el || !view) return;
  const card = view.hand.find((c) => c.id === Number(el.dataset.id));
  if (card) playCard(card, el);
});

// ---------------------------------------------------------------- colour wheel

let wheel: { card: Card | null; el: HTMLElement } | null = null;

/** A ring of four colour wedges around the discard pile (card = the wild being played; null = first-card wild). */
function openWheel(card: Card | null): void {
  closeWheel();
  const r = $('#discard').getBoundingClientRect();
  const R = Math.max(84, r.height * 0.98);
  const wedge = (i: number) => {
    const a0 = ((-90 + i * 90 - 42) * Math.PI) / 180;
    const a1 = ((-90 + i * 90 + 42) * Math.PI) / 180;
    const p = (rad: number, a: number) => `${(rad * Math.cos(a)).toFixed(2)} ${(rad * Math.sin(a)).toFixed(2)}`;
    const am = ((-90 + i * 90) * Math.PI) / 180;
    const c = COLORS[i]!;
    return `<g class="lc-wheel__w" data-c="${c}"><path d="M ${p(98, a0)} A 98 98 0 0 1 ${p(98, a1)} L ${p(60, a1)} A 60 60 0 0 0 ${p(60, a0)} Z" fill="${COLOR_INFO[c].hex}"/>
      <text x="${(79 * Math.cos(am)).toFixed(1)}" y="${(79 * Math.sin(am)).toFixed(1)}" text-anchor="middle" dominant-baseline="central">${COLOR_INFO[c].name.toUpperCase()}</text></g>`;
  };
  const el = document.createElement('div');
  el.className = 'lc-wheel';
  el.innerHTML = `<div class="lc-wheel__back" data-cancel></div>
    <div class="lc-wheel__ring" style="left:${r.left + r.width / 2}px;top:${r.top + r.height / 2}px;--R:${R}px">
      <svg viewBox="-100 -100 200 200">${COLORS.map((_, i) => wedge(i)).join('')}</svg>
      ${card ? `<div class="lc-wheel__card">${cardHtml(card)}</div>` : ''}
      <div class="lc-wheel__title lc-display">${card ? 'PICK A COLOUR' : 'FIRST CARD IS WILD — PICK A COLOUR'}</div>
    </div>`;
  $('#table').appendChild(el);
  wheel = { card, el };
  refitFloats();
  el.addEventListener('pointerover', (e) => {
    const w = (e.target as Element).closest<SVGGElement>('[data-c]');
    if (w) previewColor(w.dataset.c as Color);
  });
  el.addEventListener('pointerout', (e) => {
    if ((e.target as Element).closest('[data-c]')) previewColor(null);
  });
  el.addEventListener('click', (e) => {
    const w = (e.target as Element).closest<SVGGElement>('[data-c]');
    if (w) return chooseColor(w.dataset.c as Color);
    if ((e.target as HTMLElement).closest('[data-cancel]') && card) closeWheel();
  });
}
function previewColor(c: Color | null): void {
  if (!wheel) return;
  applyColor(c ?? view?.color ?? null);
  wheel.el.querySelector<HTMLElement>('.lc-wheel__ring')!.style.setProperty('--glow', c ? COLOR_INFO[c].hex : 'transparent');
}
function chooseColor(c: Color): void {
  const w = wheel;
  if (!w) return;
  closeWheel();
  if (w.card) send({ t: 'play', card: w.card.id, color: c });
  else send({ t: 'color', color: c });
}
function closeWheel(): void {
  if (!wheel) return;
  wheel.el.remove();
  wheel = null;
  applyColor(view?.color ?? null);
}

// ---------------------------------------------------------------- buttons + keys

function doCatch(): void {
  if (view?.vulnerable && view.vulnerable !== view.you) send({ t: 'catch', target: view.vulnerable });
}
function doCall(): void {
  if (!view) return;
  if ($('#call-btn').classList.contains('dim')) {
    audio.error();
    ticker(view.players.find((p) => p.id === view!.you)?.called ? 'You already called it' : 'Call <b>LAST CARD!</b> when you are down to 2 cards', 'dim');
    return;
  }
  send({ t: 'call' });
}
$('#draw-btn').addEventListener('click', () => send({ t: 'draw' }));
$('#pile').addEventListener('click', () => {
  if (view && myTurnIn(view) && view.phase === 'play' && !view.mustPlay) send({ t: 'draw' });
});
$('#keep-btn').addEventListener('click', () => send({ t: 'keep' }));
$('#call-btn').addEventListener('click', doCall);
$('#catch-btn').addEventListener('click', doCatch);
$('#seats').addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest('[data-catch]')) return doCatch();
  const seat = (e.target as HTMLElement).closest<HTMLElement>('.lc-seat.pick');
  if (seat?.dataset.id) send({ t: 'swap', target: seat.dataset.id });
});

let selected = -1;
function select(k: number): void {
  const n = view?.hand.length ?? 0;
  if (!n) return;
  selected = (k + n) % n;
  render();
  $('#hand .lc-slot.sel')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!$('#rules').classList.contains('hidden')) return $('#rules').classList.add('hidden');
    if (!$('#series').classList.contains('hidden')) return $('#series').classList.add('hidden');
    if (wheel?.card) return closeWheel();
    if ($('#modal').dataset.kind === 'info') return closeModal();
    return;
  }
  if (!view || document.activeElement?.tagName === 'INPUT' || $('#table').classList.contains('hidden')) return;
  if (wheel) {
    const c = ({ r: 'r', y: 'y', g: 'g', b: 'b', '1': 'r', '2': 'y', '3': 'g', '4': 'b' } as Record<string, Color>)[e.key.toLowerCase()];
    if (c) chooseColor(c);
    return;
  }
  if ($('#modal').dataset.kind) return;
  const vis = (id: string) => !$(id).classList.contains('hidden');
  if ((e.key === 'd' || e.key === ' ') && vis('#draw-btn')) {
    e.preventDefault();
    send({ t: 'draw' });
  }
  if (e.key === 'l') doCall();
  if (e.key === 'c' && vis('#catch-btn')) doCatch();
  if (e.key === 'k' && vis('#keep-btn')) send({ t: 'keep' });
  if (/^[1-9]$/.test(e.key)) {
    const playable = sortedHand().filter((c) => view!.playable.includes(c.id));
    const card = playable[Number(e.key) - 1];
    if (card) playCard(card);
    else if (view.current === view.you) noMatch();
  }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault();
    select(selected < 0 ? (e.key === 'ArrowLeft' ? -1 : 0) : selected + (e.key === 'ArrowLeft' ? -1 : 1));
  }
  if (e.key === 'Enter' && selected >= 0) {
    const card = sortedHand()[selected];
    if (card) playCard(card, document.querySelector<HTMLElement>(`#hand .lc-card[data-id="${card.id}"]`));
  }
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

/** 7-0 rule: pick who gets my hand. */
function showSwap(): void {
  const v = view!;
  const others = v.players.filter((p) => p.id !== v.you);
  const p = openModal(
    `<h3 class="lc-display">SWAP HANDS!</h3><p>You played a <b>7</b> — trade your <b>${v.hand.length}</b> card${v.hand.length === 1 ? '' : 's'} with:</p>
    <div class="lc-swap">${others.map((o) => `<button class="lc-swap__p" data-swap="${o.id}">${avatar(o.avatar)}<b>${esc(o.name)}</b><span class="lc-swap__n">${o.count} card${o.count === 1 ? '' : 's'}</span></button>`).join('')}</div>`,
    'swap',
  );
  p.onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-swap]');
    if (!b) return;
    closeModal();
    send({ t: 'swap', target: b.dataset.swap! });
  };
}

function showRound(ev: Extract<GameEvent, { k: 'roundOver' }>, final: boolean): void {
  const v = view!;
  const won = ev.winner === v.you;
  const scored = v.rules.target > 0;
  const rows = v.players
    .map((p) => {
      const hand = ev.hands[p.id] ?? [];
      return `<div class="lc-result ${p.id === ev.winner ? 'win' : ''}"><div class="lc-result__who">${avatar(p.avatar)}<b>${esc(p.id === v.you ? 'You' : p.name)}</b></div>
        <div class="lc-result__hand">${p.id === ev.winner ? '<span class="lc-display">OUT!</span>' : hand.map((c) => cardHtml(c, 'tiny')).join('')}</div>
        ${scored ? `<div class="lc-result__score">${ev.scores[p.id] ?? 0}</div>` : ''}</div>`;
    })
    .join('');
  const online = !!link?.online;
  const p = openModal(
    `<h2 class="lc-display ${won ? 'gold' : ''}">${final ? (won ? 'YOU WIN!' : `${esc(nameOf(ev.winner).toUpperCase())} WINS!`) : won ? 'YOU WON THE ROUND!' : `${esc(nameOf(ev.winner).toUpperCase())} WINS THE ROUND`}</h2>
    <p>${ev.points} points${scored ? ` · first to ${v.rules.target}` : ''}</p><div class="lc-results">${rows}</div>
    ${
      final
        ? `<div class="lc-two"><button class="lc-btn lc-btn--go" id="again"><span class="lc-display">${online ? 'REMATCH' : 'PLAY AGAIN'}</span></button>${online ? '<button class="lc-btn" id="to-lobby">Lobby</button>' : ''}<button class="lc-btn" id="to-menu">Menu</button></div>${online ? '<p class="lc-small" id="rematch-votes"></p>' : ''}`
        : '<p class="lc-small">Next round in <b id="round-next">7</b>…</p>'
    }
    ${final && [...series.values()].some((r) => r.games > 1) ? `<h3 class="lc-display">SERIES</h3>${seriesTable()}` : ''}`,
    final ? 'over' : 'round',
  );
  audio.win(won);
  if (won) particles.confetti();
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
  void net?.leave();
  net = null;
  closeModal();
  closeWheel();
  $('#table').classList.add('hidden');
  $('#online').classList.add('hidden');
  $('#menu').classList.remove('hidden');
}

// ---------------------------------------------------------------- series scoreboard

interface SeriesRow {
  name: string;
  avatar: number;
  games: number;
  wins: number;
  rounds: number;
  points: number;
}
/** Results across games this session (by player id: "you", "bot0"… locally, session ids online). */
const series = new Map<string, SeriesRow>();
function seriesRow(id: string): SeriesRow {
  const p = view?.players.find((q) => q.id === id);
  let r = series.get(id);
  if (!r) series.set(id, (r = { name: '', avatar: 0, games: 0, wins: 0, rounds: 0, points: 0 }));
  if (p) {
    r.name = id === view?.you ? 'You' : p.name;
    r.avatar = p.avatar;
  }
  return r;
}
function seriesTable(): string {
  const rows = [...series.values()].sort((a, b) => b.wins - a.wins || b.points - a.points);
  return `<table class="lc-series"><thead><tr><th></th><th>Games won</th><th>Rounds won</th><th>Points</th><th>Played</th></tr></thead><tbody>${rows
    .map((r, i) => `<tr class="${i === 0 && r.wins ? 'lead' : ''}"><td>${avatar(r.avatar)}<b>${esc(r.name)}</b></td><td>${r.wins}</td><td>${r.rounds}</td><td>${r.points}</td><td>${r.games}</td></tr>`)
    .join('')}</tbody></table>`;
}
let gameRecorded = false;
function recordGame(winner: string): void {
  if (gameRecorded || !view) return;
  gameRecorded = true;
  for (const p of view.players) seriesRow(p.id).games++;
  seriesRow(winner).wins++;
  $('#series-btn').classList.remove('hidden');
}
function showSeries(): void {
  $('#series-panel').innerHTML = `<h2 class="lc-display gold">SCOREBOARD</h2><p class="lc-small">This session · points are scored by the round winner</p>${series.size ? seriesTable() : '<p>No games finished yet.</p>'}<div class="lc-two"><button class="lc-btn" id="series-close">Close</button><button class="lc-chip" id="series-reset">Reset</button></div>`;
  $('#series').classList.remove('hidden');
}
$('#series-btn').addEventListener('click', showSeries);
$('#series').addEventListener('click', (e) => {
  const id = (e.target as HTMLElement).id;
  if (id === 'series' || id === 'series-close') $('#series').classList.add('hidden');
  if (id === 'series-reset') {
    series.clear();
    $('#series-btn').classList.add('hidden');
    showSeries();
  }
});

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
      closeWheel();
      pileShown = [];
      drawDiscard(false);
      banner(v.rules.target ? `ROUND ${ev.round}` : 'SHUFFLE UP!', 'gold');
      audio.shuffle();
      ticker(`${who(ev.dealer)} ${ev.dealer === me ? 'deal' : 'deals'} 7 cards each`);
      return 0.5;
    case 'draw': {
      const mine = ev.by === me;
      if (ev.why === 'deal') audio.deal();
      else audio.draw();
      const n = Math.min(ev.n, ev.why === 'deal' ? 7 : 6);
      const gap = ev.why === 'deal' ? 0.05 : 0.08;
      for (let i = 0; i < n; i++) {
        const c = mine ? ev.cards?.[i] : undefined;
        const slot = c && document.querySelector(`#hand .lc-card[data-id="${c.id}"]`)?.getBoundingClientRect();
        fly(pileRect(), slot && slot.width ? slot : seatRect(ev.by), c ? cardHtml(c) : backHtml(), i * gap, () => c && reveal(c.id), ev.why === 'deal' ? 360 : 480);
      }
      // Anything not animated (more than 6 cards) shows up straight away.
      if (mine && ev.cards) for (const c of ev.cards.slice(n)) reveal(c.id);
      if (ev.why === 'deal') return 0.12;
      if (ev.why === 'turn' || ev.why === 'match') {
        if (mine && ev.cards?.[0]) ticker(`You drew <b>${esc(cardLabel(ev.cards[0]))}</b>`);
        else ticker(`${who(ev.by)} drew a card`, 'dim');
      } else if (ev.why !== 'catch' && ev.why !== 'challenge') ticker(`${who(ev.by)} ${mine ? 'draw' : 'draws'} <b>${ev.n}</b>`, mine ? 'bad' : '');
      if (ev.n >= 2) seatPop(ev.by, `+${ev.n}`, 'plus');
      return 0.25 + n * 0.06;
    }
    case 'flip':
      fly(pileRect(), $('#discard').getBoundingClientRect(), cardHtml(ev.card), 0, () => {
        flights--;
        if (flying === ev.card.id) flying = null;
        pileShown = [];
        pushDiscard(ev.card);
      });
      ticker(`First card: <b>${esc(cardLabel(ev.card))}</b>`);
      return 0.6;
    case 'turn':
      // Only announce it if it's still my turn for real.
      if (ev.player === me && real?.current === me && v.phase !== 'challenge') {
        audio.turn();
        banner(v.phase === 'pickColor' ? 'PICK A COLOUR' : v.phase === 'play' && !v.playable.length && !v.pendingDraw ? 'YOUR TURN — DRAW' : 'YOUR TURN', 'small');
      }
      return 0.1;
    case 'play': {
      audio.card();
      const from = ev.by === me ? (lastHandRects.get(ev.card.id) ?? seatRect(ev.by)) : seatRect(ev.by);
      const wild = isWild(ev.card);
      fly(from, $('#discard').getBoundingClientRect(), cardHtml(ev.card), 0, () => {
        flights--;
        if (flying === ev.card.id) flying = null;
        pushDiscard(ev.card);
        if (wild) {
          const r = $('#discard').getBoundingClientRect();
          particles.burst(r.left + r.width / 2, r.top + r.height / 2, ev.color ? COLOR_INFO[ev.color].hex : '#fff');
        }
      });
      if (ev.jump) {
        stamp('JUMP IN!', 'legit');
        ticker(`${who(ev.by)} jumped in with <b>${esc(cardLabel(ev.card))}</b>!`, 'good');
      } else ticker(`${who(ev.by)} played <b>${esc(cardLabel(ev.card))}</b>${wild && ev.color ? ` → <b style="color:${COLOR_INFO[ev.color].hex}">${COLOR_INFO[ev.color].name}</b>` : ''}`);
      if (wild) {
        audio.wild();
        setTimeout(() => banner(ev.color ? COLOR_INFO[ev.color].name.toUpperCase() : 'WILD!', `color-${ev.color}`), 350);
      }
      if (ev.card.kind === 'draw2' || ev.card.kind === 'wild4') audio.plus(ev.card.kind === 'draw2' ? 2 : 4);
      return wild ? 0.75 : 0.5;
    }
    case 'color':
      audio.wild();
      banner(COLOR_INFO[ev.color].name.toUpperCase(), `color-${ev.color}`);
      ticker(`${who(ev.by)} ${ev.by === me ? 'pick' : 'picks'} <b style="color:${COLOR_INFO[ev.color].hex}">${COLOR_INFO[ev.color].name}</b>`);
      return 0.5;
    // Skip / stack / call / keep… are overlays: they play alongside the next step.
    case 'skip':
      audio.skip();
      seatPop(ev.target, '⊘ SKIP', 'skip');
      ticker(`${who(ev.target)} ${ev.target === me ? 'are' : 'is'} skipped`);
      return 0.12;
    case 'reverse': {
      audio.reverse();
      const d = $('#dir');
      d.classList.remove('flash');
      void d.offsetWidth;
      d.classList.add('flash');
      banner('⇄ REVERSE', 'small');
      return 0.3;
    }
    case 'stack':
      seatPop(v.current, `+${ev.total}`, 'plus');
      ticker(`The pile is up to <b>+${ev.total}</b>!`, 'bad');
      return 0.15;
    case 'call':
      audio.call();
      shout(ev.by);
      ticker(`${who(ev.by)}: <b>LAST CARD!</b>`, 'good');
      return 0.1;
    case 'caught':
      audio.caught();
      stamp('CAUGHT!', 'caught');
      ticker(`${who(ev.by)} caught ${who(ev.target)} — <b>+${v.rules.unoPenalty}</b>!`, 'bad');
      shake(8);
      return 0.7;
    case 'challenge': {
      audio.challenge();
      if (!ev.yes) {
        ticker(`${who(ev.by)} accepted the +4`);
        return 0.15;
      }
      stamp(ev.guilty ? 'BLUFF!' : 'LEGIT!', ev.guilty ? 'caught' : 'legit');
      ticker(`${who(ev.by)} challenged ${who(ev.target)}: ${ev.guilty ? 'it was a <b>bluff</b> — they draw 4!' : 'it was <b>legal</b> — +6!'}`, ev.guilty ? 'good' : 'bad');
      return 0.9;
    }
    case 'swap': {
      audio.swap();
      const a = seatRect(ev.by);
      const b = seatRect(ev.with);
      for (let i = 0; i < 4; i++) {
        fly(a, b, backHtml(), i * 0.06);
        fly(b, a, backHtml(), i * 0.06);
      }
      stamp('SWAP!', 'legit');
      ticker(`${who(ev.by)} swapped hands with ${who(ev.with)}`, ev.by === me || ev.with === me ? 'good' : '');
      return 0.8;
    }
    case 'rotate': {
      audio.swap();
      const ids = v.players.map((p) => p.id);
      ids.forEach((id, i) => {
        const to = ids[(((i + ev.dir) % ids.length) + ids.length) % ids.length]!;
        for (let k = 0; k < 3; k++) fly(seatRect(id), seatRect(to), backHtml(), k * 0.07);
      });
      banner('HANDS ROTATE!', 'small');
      ticker('A <b>0</b>! Every hand moves on', 'good');
      return 0.8;
    }
    case 'keep':
      ticker(`${who(ev.by)} kept the card`, 'dim');
      return 0.05;
    case 'reshuffle':
      audio.shuffle();
      $('#pile').classList.remove('shuffling');
      void $('#pile').offsetWidth;
      $('#pile').classList.add('shuffling');
      ticker('Deck ran out — the discard pile is reshuffled');
      return 0.4;
    case 'timeout':
      ticker(`${who(ev.by)} ran out of time`, 'dim');
      return 0.05;
    case 'left':
      ticker(`${who(ev.by)} left the table`, 'dim');
      return 0.1;
    case 'roundOver': {
      link?.hold(2);
      const r = seriesRow(ev.winner);
      r.rounds++;
      r.points += ev.points;
      const final = queue.some((s) => s.ev.k === 'over') || real?.phase === 'over';
      if (final) recordGame(ev.winner);
      setTimeout(() => view && showRound(ev, final), 700);
      return 1.2;
    }
    case 'over':
      // (Usually already recorded with the last round; this covers "everyone else left".)
      recordGame(ev.winner);
      return 0.3;
  }
  return 0;
}

/** My drawn cards pop into the hand as their flights land. */
const incoming = new Set<number>();
function reveal(id: number): void {
  if (!incoming.delete(id)) return;
  document.querySelector(`#hand .lc-card[data-id="${id}"]`)?.parentElement?.classList.remove('incoming');
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
  floatText(`lc-banner lc-display ${tone}`, text, tone.includes('small') ? 46 : 68, 0, 1500);
}

function stamp(text: string, kind: string): void {
  floatText(`lc-stamp lc-display ${kind}`, text, 92, 12, 1300);
}

/**
 * Show a big transient label in the largest free spot of the table: never over a
 * seat, the piles, the direction ring, the colour wheel or the ticker. The font
 * shrinks to fit the spot (angle = the label's tilt, for its rotated bounding box).
 */
function floatText(cls: string, text: string, maxPx: number, angle: number, ms: number): void {
  const wrap = document.createElement('div');
  wrap.className = 'lc-float';
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

interface Float {
  wrap: HTMLElement;
  el: HTMLElement;
  maxPx: number;
  /** Size of the (tilted) label at a 100px font. */
  w: number;
  h: number;
}
const floats = new Set<Float>();

function placeFloat(f: Float, spots = freeSpots()): void {
  let best: DOMRect | null = null;
  let bestScore = 0;
  let size = 0;
  for (const spot of spots) {
    // 0.84: room for the pop-in overshoot (scale 1.12) and the text outline.
    const px = Math.min(f.maxPx, (100 * spot.width * 0.84) / f.w, (100 * spot.height * 0.84) / f.h);
    // Centred bands read best: prefer them unless a gutter fits a much bigger label.
    const centred = Math.abs(spot.x + spot.width / 2 - innerWidth / 2) < 40;
    const score = px * (centred ? 1.3 : 1);
    if (score > bestScore) {
      bestScore = score;
      best = spot;
      size = px;
    }
  }
  // Nowhere to put it without covering something: skip it rather than cover.
  f.wrap.style.visibility = !best || size < 12 ? 'hidden' : '';
  if (!best) return;
  f.wrap.style.left = `${best.x + best.width / 2}px`;
  f.wrap.style.top = `${best.y + best.height / 2}px`;
  f.el.style.fontSize = `${size}px`;
}

/** The table moved (panel grew, wheel opened…): move live banners out of the way again. */
function refitFloats(): void {
  if (!floats.size) return;
  const spots = freeSpots();
  for (const f of floats) placeFloat(f, spots);
}

/** Rectangles of the table nothing important is drawn in right now. */
function freeSpots(): DOMRect[] {
  const pad = 6;
  const rect = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)].map((e) => e.getBoundingClientRect()).filter((r) => r.width && r.height);
  const seats = rect('.lc-seat');
  const top = Math.max(52, ...seats.map((r) => r.bottom)) + pad;
  const bottom = $('#me').getBoundingClientRect().top - pad;
  const core = rect('#pile, #discard, #dir, #stack:not(.hidden), .lc-wheel__ring, .lc-wheel__title');
  const x0 = Math.min(...core.map((r) => r.left));
  const x1 = Math.max(...core.map((r) => r.right));
  const y0 = Math.min(...core.map((r) => r.top));
  const y1 = Math.max(...core.map((r) => r.bottom));
  const R = (x: number, y: number, r: number, b: number) => new DOMRect(x, y, r - x, b - y);
  let spots = [R(pad, top, innerWidth - pad, y0 - pad), R(pad, y1 + pad, innerWidth - pad, bottom), R(x1 + 12, top, innerWidth - pad, bottom), R(pad, top, x0 - 12, bottom)];
  // Keep clear of the ticker, including the lines it can still grow to.
  const tk = $('#ticker').getBoundingClientRect();
  const lines = innerWidth <= 760 ? 2 : 4;
  const t = R(tk.left, tk.bottom - lines * 27, tk.right, tk.bottom);
  spots = spots.flatMap((s) => {
    if (s.right <= t.left || t.right <= s.left || s.bottom <= t.top || t.bottom <= s.top) return [s];
    return [R(s.left, s.top, s.right, t.top - pad), R(s.left, t.bottom + pad, s.right, s.bottom), R(s.left, s.top, t.left - pad, s.bottom), R(t.right + pad, s.top, s.right, s.bottom)];
  });
  return spots.filter((s) => s.width > 40 && s.height > 14);
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
      if (!list.length) ctx.clearRect(0, 0, innerWidth, innerHeight);
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
    const was = lobby?.phase;
    lobby = l;
    renderLobby();
    renderRematch();
    // A new game started (first one, or a rematch): (re)attach the table to it.
    if (l.phase === 'playing' && (was !== 'playing' || !link?.online)) {
      if (was !== 'playing') n.backlog.length = 0;
      attach(new OnlineLink(n));
    }
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

function rulesSummary(c: LcConfig): string {
  const on = RULE_FLAGS.filter(([k]) => c[k] && (k !== 'stackTwoOnFour' || c.stacking)).map(([, label]) => label);
  return `${c.target ? `First to ${c.target}` : 'One round'} · ${on.length ? on.join(' · ') : 'official rules'} · caught: draw ${c.unoPenalty} · 30 s turns`;
}

function renderLobby(): void {
  const l = lobby;
  if (!l || !net) return;
  $('#o-code-big').textContent = l.code;
  const host = l.hostId === net.sessionId;
  $('#o-players').innerHTML = l.players
    .map((p) => `<div class="lc-lp ${p.id === net!.sessionId ? 'me' : ''}">${avatar(p.avatar)}<b>${esc(p.name)}</b><small>${p.bot ? 'BOT' : p.id === l.hostId ? 'HOST' : p.id === net!.sessionId ? 'YOU' : ''}${p.connected ? '' : ' · reconnecting'}${p.wins ? ` · 🏆${p.wins}` : ''}${l.rematch.includes(p.id) ? ' · ✔' : ''}</small></div>`)
    .join('');
  $('#o-host').classList.toggle('hidden', !host || l.phase === 'playing');
  setSeg('#o-bots', String(l.config.bots));
  setSeg('#o-level', l.config.botLevel);
  setSeg('#o-target', String(l.config.target));
  setSeg('#o-penalty', String(l.config.unoPenalty));
  syncRuleBoxes('o', l.config);
  $('#o-rules').textContent = rulesSummary(l.config);
  $('#o-wait').textContent = l.phase === 'playing' ? 'Game in progress…' : host ? (l.players.length < 2 ? 'Add bots or wait for friends, then start.' : '') : 'Waiting for the host to start…';
  ($('#o-start') as HTMLButtonElement).disabled = l.players.length < 2;
  // Anyone can vote for a rematch from the lobby after a game.
  const played = l.players.some((p) => p.wins > 0);
  $('#o-rematch').classList.toggle('hidden', l.phase === 'playing' || !played);
  $('#o-rematch').textContent = l.rematch.includes(net.sessionId) ? 'Waiting for the others…' : 'Vote rematch';
}

function renderRematch(): void {
  const el = document.getElementById('rematch-votes');
  if (!el || !lobby) return;
  const humans = lobby.players.filter((p) => !p.bot);
  el.textContent = `Rematch votes: ${lobby.rematch.length} / ${humans.length}`;
}

function backToLobby(): void {
  link?.dispose();
  link = null;
  view = null;
  real = null;
  closeModal();
  closeWheel();
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
for (const [sel, key] of [['#o-bots', 'bots'], ['#o-level', 'botLevel'], ['#o-target', 'target'], ['#o-penalty', 'unoPenalty']] as const) {
  $(sel).addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (b) net?.config({ [key]: key === 'botLevel' ? b.dataset.v : Number(b.dataset.v) });
  });
}
$('#o-host').addEventListener('change', (e) => {
  const k = (e.target as HTMLElement).dataset.rule as RuleFlag | undefined;
  if (k) net?.config({ [k]: (e.target as HTMLInputElement).checked });
});
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

const q = new URLSearchParams(location.search);
if (q.get('room')) void openOnline(q.get('room')!);
if (q.has('play')) startLocal();
(window as unknown as Record<string, unknown>).__lc = {
  get link() {
    return link;
  },
  /** The state on screen. */
  get view() {
    return view;
  },
  /** The real (latest) state. */
  get real() {
    return real;
  },
  get queue() {
    return queue.length;
  },
  /** Top card drawn in the DOM discard pile, and the one flying onto it. */
  get pileTop() {
    return pileShown[pileShown.length - 1]?.id ?? null;
  },
  get flying() {
    return flying;
  },
  get lag() {
    return lagLog.slice();
  },
  get series() {
    return [...series.entries()];
  },
  settings,
  startLocal,
  banner,
  stamp,
  freeSpots,
};
