import './styles.css';
import { BOUNDS, DT, POCKETS, R, Sim, castCue, spotFree, HEAD_STRING_X, MAX_TIP, type BallRest, type ShotInput } from './physics';
import type { Action, GameEvent, Group } from './engine';
import { BALL_COLORS, Transform, ballColor, drawCue, randomOrientation, renderBall, renderTable, spin, type Quat } from './art';
import { LocalLink, type Aim, type GameLink } from './link';
import type { View } from './view';
import type { BotLevel } from './bots';
import { PoolAudio } from './audio';
import { OnlineLink, PoolNet } from './net/online';
import type { PlLobby } from './net/protocol';
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

const AVATARS = ['🦊', '🐼', '🐸', '🦁', '🐙', '🐵', '🐯', '🐨', '🦄', '🐧', '🐶', '🐱'];
const AV_BG = ['#ff8a3d', '#8fd3ff', '#7ee08a', '#ffd23f', '#ff7aa8', '#c9a27a', '#ffb347', '#b8c4d6', '#d8a6ff', '#9fd8e8', '#e8c39e', '#ffc4d6'];
const avatar = (i: number) => `<span class="pl-avatar" style="--bg:${AV_BG[i % 12]}">${AVATARS[i % 12]}</span>`;

/** Small ball icon (SVG) for the HUD. */
function ballIcon(id: number, cls = ''): string {
  const col = ballColor(id);
  const stripe = id >= 9;
  return `<svg class="pl-ball ${cls}" viewBox="0 0 40 40"><defs><radialGradient id="pg${id}" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".45"/></radialGradient><clipPath id="pc${id}"><circle cx="20" cy="20" r="19"/></clipPath></defs>
    <circle cx="20" cy="20" r="19" fill="${stripe || id === 0 ? '#f6f3ea' : col}"/>${stripe ? `<rect x="0" y="9" width="40" height="22" fill="${col}" clip-path="url(#pc${id})"/>` : ''}
    ${id ? `<circle cx="20" cy="20" r="8.5" fill="#fbf9f1"/><text x="20" y="21" font-size="${id > 9 ? 9 : 11}" font-weight="900" font-family="Nunito, Arial" text-anchor="middle" dominant-baseline="middle" fill="#111">${id}</text>` : ''}
    <circle cx="20" cy="20" r="19" fill="url(#pg${id})"/></svg>`;
}

const audio = new PoolAudio();
audio.setMuted(store.get('pl-muted') === '1');
const settings = {
  name: store.get('pl-name') || `Player${Math.floor(100 + Math.random() * 900)}`,
  avatar: Number(store.get('pl-avatar') ?? Math.floor(Math.random() * 12)),
  level: (store.get('pl-level') as BotLevel) || 'normal',
  guides: store.get('pl-guides') !== '0',
};

document.getElementById('game')!.innerHTML = `
<div class="pl-shell">
  <canvas id="cv"></canvas>
  <div class="pl-topbar">
    <a class="pl-chip" href="/">← Arcade</a>
    <div class="pl-topbar__right"><button class="pl-chip" id="rules-btn">? Rules</button><button class="pl-chip" id="sound"></button><button class="pl-chip" id="fullscreen"></button></div>
  </div>

  <section class="pl-menu" id="menu">
    <div class="pl-logo"><div class="pl-logo-ball">${ballIcon(8)}</div><div class="pl-wordmark"><span class="pl-display">CORNER</span><span class="pl-display">POCKET</span></div></div>
    <p class="pl-tag">8-Ball Pool · Pot your group, then sink the 8</p>
    <div class="pl-panel">
      <div class="pl-row"><label>Your name</label><input id="m-name" maxlength="14" spellcheck="false" /></div>
      <div class="pl-row"><label>Avatar</label><div class="pl-avatars" id="m-avatars"></div></div>
      <div class="pl-row"><label>Opponent</label><div class="pl-seg" id="m-level"><button data-v="easy">Rookie</button><button data-v="normal">Hustler</button><button data-v="hard">Shark</button></div></div>
      <div class="pl-row"><label>Aim guide</label><div class="pl-seg" id="m-guides"><button data-v="1">Long lines</button><button data-v="0">Short lines</button></div></div>
      <button class="pl-btn pl-btn--go" id="m-play"><span class="pl-display">PLAY VS BOT</span></button>
      <button class="pl-btn pl-btn--online" id="m-online">🌐 Online · LAN <small>1v1 with a friend</small></button>
    </div>
  </section>

  <section class="pl-online hidden" id="online">
    <div class="pl-panel pl-panel--wide">
      <h2 class="pl-display" id="o-title">ONLINE</h2>
      <p class="pl-sub" id="o-sub">Play a friend anywhere</p>
      <div class="pl-lan hidden" id="o-lan"><small>OTHER DEVICES OPEN</small><b id="o-lan-url"></b></div>
      <div id="o-connect">
        <div class="pl-online__choices">
          <button class="pl-btn pl-btn--go" id="o-create"><span class="pl-display">CREATE TABLE</span></button>
          <button class="pl-btn" id="o-quick">Quick match</button>
          <div class="pl-join"><input id="o-code" maxlength="4" placeholder="CODE" spellcheck="false" autocapitalize="characters" /><button class="pl-btn" id="o-join">Join</button></div>
        </div>
      </div>
      <div class="hidden" id="o-lobby">
        <div class="pl-code"><small>TABLE CODE</small><b class="pl-display" id="o-code-big">----</b><button class="pl-chip" id="o-copy">Copy invite link</button></div>
        <div class="pl-lobby-players" id="o-players"></div>
        <div class="pl-host hidden" id="o-host">
          <div class="pl-row"><label>Opponent</label><div class="pl-seg" id="o-bot"><button data-v="off">Wait for a friend</button><button data-v="easy">Rookie bot</button><button data-v="normal">Hustler bot</button><button data-v="hard">Shark bot</button></div></div>
          <div class="pl-row"><label>Shot clock</label><div class="pl-seg" id="o-time"><button data-v="20">20 s</button><button data-v="30">30 s</button><button data-v="60">60 s</button><button data-v="0">Off</button></div></div>
          <button class="pl-btn pl-btn--go" id="o-start"><span class="pl-display">START GAME</span></button>
        </div>
        <p class="pl-wait" id="o-wait"></p>
      </div>
      <p class="pl-status" id="o-status"></p>
      <div class="pl-foot"><button class="pl-chip" id="o-back">← Back</button><span id="o-server"></span></div>
    </div>
  </section>

  <section class="pl-hud hidden" id="hud">
    <div class="pl-side" id="p0"></div>
    <div class="pl-vs"><span id="turn-text"></span></div>
    <div class="pl-side right" id="p1"></div>
  </section>
  <div class="pl-power hidden" id="power"><div class="pl-power__track"><div class="pl-power__fill" id="power-fill"></div><div class="pl-power__cue" id="power-cue"></div></div><small>PULL</small></div>
  <div class="pl-spin hidden" id="spin" title="Cue ball spin (double-click to reset)"><div class="pl-spin__ball"><div class="pl-spin__dot" id="spin-dot"></div></div><small>SPIN</small></div>
  <div class="pl-msg" id="msg"></div>
  <div class="pl-hint hidden" id="hint"></div>

  <section class="pl-modal hidden" id="modal"><div class="pl-modal__panel" id="modal-panel"></div></section>
  <section class="pl-modal hidden" id="rules"><div class="pl-modal__panel pl-rules" id="rules-panel"></div></section>
</div>`;

// ============================================================================ menu

const nameInput = $<HTMLInputElement>('#m-name');
nameInput.value = settings.name;
nameInput.addEventListener('change', () => {
  settings.name = nameInput.value.trim() || 'Player';
  store.set('pl-name', settings.name);
});
function setSeg(sel: string, v: string): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>(`${sel} button`)) b.classList.toggle('on', b.dataset.v === v);
}
function renderAvatars(): void {
  $('#m-avatars').innerHTML = AVATARS.map((_, i) => `<button class="pl-av ${i === settings.avatar ? 'on' : ''}" data-i="${i}">${avatar(i)}</button>`).join('');
}
$('#m-avatars').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
  if (!b) return;
  settings.avatar = Number(b.dataset.i);
  store.set('pl-avatar', String(settings.avatar));
  audio.ui();
  renderAvatars();
});
$('#m-level').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!b) return;
  settings.level = b.dataset.v as BotLevel;
  store.set('pl-level', settings.level);
  setSeg('#m-level', settings.level);
});
$('#m-guides').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!b) return;
  settings.guides = b.dataset.v === '1';
  store.set('pl-guides', b.dataset.v!);
  setSeg('#m-guides', b.dataset.v!);
});
renderAvatars();
setSeg('#m-level', settings.level);
setSeg('#m-guides', settings.guides ? '1' : '0');
const soundBtn = $('#sound');
const syncSound = () => (soundBtn.textContent = audio.muted ? '🔇' : '♫');
soundBtn.addEventListener('click', () => {
  audio.setMuted(!audio.muted);
  store.set('pl-muted', audio.muted ? '1' : '0');
  syncSound();
});
syncSound();
bindFullscreenButton($('#fullscreen'), ['⛶', '⛶']);
installFullscreenKey();

$('#rules-panel').innerHTML = `<h2 class="pl-display">8-BALL RULES</h2>
<p><b>Break</b> from behind the line. After the break the table is <b>open</b>: the first ball you legally pot decides your group — <b>solids</b> (1–7) or <b>stripes</b> (9–15).</p>
<p>Pot one of yours and you <b>shoot again</b>. Miss and it's your opponent's turn.</p>
<p><b>Fouls</b> give your opponent <b>ball in hand</b> (they can put the cue ball anywhere): potting the cue ball, hitting nothing, hitting an opponent's ball (or the 8) first, no ball touching a cushion after contact, or running out of time.</p>
<p><b>The 8-ball</b>: once your group is cleared, <b>call a pocket</b> (tap it) and sink the 8 there to win. Pot the 8 early, in the wrong pocket, or scratch while potting it — and you lose.</p>
<p><b>Controls</b>: drag on the table to aim (scroll / ← → for fine aim). Pull the <b>power bar</b> down and let go to shoot (or hold <b>Space</b>). Set <b>spin</b> on the cue-ball icon: top = follow, bottom = draw, sides = english. With ball in hand, drag the cue ball.</p>
<button class="pl-btn" id="rules-close">Got it</button>`;
$('#rules-btn').addEventListener('click', () => $('#rules').classList.remove('hidden'));
$('#rules').addEventListener('click', (e) => {
  if ((e.target as HTMLElement).id === 'rules' || (e.target as HTMLElement).id === 'rules-close') $('#rules').classList.add('hidden');
});

// ============================================================================ state

let link: GameLink | null = null;
let view: View | null = null;
const queue: GameEvent[] = [];
let busy = false;
let updateAt = performance.now();
/** Display state for every ball. */
interface DBall {
  id: number;
  x: number;
  y: number;
  q: Quat;
  on: boolean;
  wx: number;
  wy: number;
  wz: number;
  canvas: HTMLCanvasElement;
  img: ImageData | null;
  key: string;
}
const dballs = new Map<number, DBall>();
let replay: {
  sim: Sim;
  acc: number;
  evi: number;
  pre: number;
  preTotal: number;
  shot: ShotInput;
  by: string;
  cue: { x: number; y: number };
} | null = null;
const sinking: Array<{ id: number; x: number; y: number; px: number; py: number; t: number }> = [];
// Aim state (mine).
let aimDx = 1;
let aimDy = 0;
let power = 0;
let charging = false;
let spinX = 0;
let spinY = 0;
let cuePlace: { x: number; y: number } | null = null;
let call = -1;
let callAuto = -1;
let oppAim: Aim | null = null;
let oppShown: Aim | null = null;
let strikeAnim = 0;
let lastTurnKey = '';
/** Whose shot the screen shows (follows the animation queue, not the latest state). */
let shownCurrent = '';

function startLocal(): void {
  settings.name = nameInput.value.trim() || 'Player';
  link?.dispose();
  attach(new LocalLink({ name: settings.name, avatar: settings.avatar, level: settings.level }));
}

function attach(l: GameLink): void {
  link = l;
  view = null;
  shownCurrent = '';
  queue.length = 0;
  busy = false;
  replay = null;
  dballs.clear();
  sinking.length = 0;
  closeModal();
  $('#menu').classList.add('hidden');
  $('#online').classList.add('hidden');
  for (const id of ['#hud', '#power', '#spin']) $(id).classList.remove('hidden');
  l.onUpdate = (v, events) => {
    view = v;
    queue.push(...events);
    updateAt = performance.now();
    renderHud();
  };
  l.onError = (m) => {
    audio.foul();
    toast(esc(m), 'error');
  };
  l.onAim = (a) => (oppAim = a);
  resize();
}

function myTurn(): boolean {
  return !!view && view.phase === 'aim' && view.current === view.you && !replay && !busy && !queue.length;
}

// ============================================================================ canvas

const cv = $<HTMLCanvasElement>('#cv');
const g = cv.getContext('2d')!;
const T = new Transform();
let tableImg: HTMLCanvasElement | null = null;
let dpr = 1;
function resize(): void {
  dpr = Math.min(2, devicePixelRatio || 1);
  const w = innerWidth;
  const h = innerHeight;
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  cv.style.width = `${w}px`;
  cv.style.height = `${h}px`;
  const portrait = h > w * 1.15;
  if (portrait) T.fit(w, h, 64, 14, 118, 128, true);
  else T.fit(w, h, 96, 130, 92, 16, false);
  tableImg = renderTable(T, w, h, dpr);
  for (const b of dballs.values()) b.key = '';
}
addEventListener('resize', resize);
resize();

function syncBalls(rest: BallRest[]): void {
  for (const b of rest) {
    let d = dballs.get(b.id);
    if (!d) {
      d = { id: b.id, x: b.x, y: b.y, q: randomOrientation(), on: b.pocket < 0, wx: 0, wy: 0, wz: 0, canvas: document.createElement('canvas'), img: null, key: '' };
      dballs.set(b.id, d);
    }
    d.x = b.x;
    d.y = b.y;
    d.on = b.pocket < 0;
    d.wx = d.wy = d.wz = 0;
  }
}

/** Cue ball position to aim from (ball in hand uses my placement). */
function cuePos(): { x: number; y: number } | null {
  if (!view) return null;
  if (view.ballInHand && cuePlace && (view.current === view.you || !link?.online)) return cuePlace;
  const c = dballs.get(0);
  return c && c.on ? { x: c.x, y: c.y } : null;
}

function restForAim(): BallRest[] {
  const out: BallRest[] = [];
  for (const d of dballs.values()) out.push({ id: d.id, x: d.x, y: d.y, pocket: d.on ? -1 : 0 });
  const c = cuePos();
  const cue = out.find((b) => b.id === 0);
  if (cue && c) {
    cue.x = c.x;
    cue.y = c.y;
    cue.pocket = -1;
  }
  return out;
}

// ============================================================================ loop

let lastFrame = performance.now();
function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  link?.tick(dt);
  if (!view) {
    drawIdle();
    return;
  }
  // Events: a shot blocks the queue until its replay has finished.
  while (!busy && !replay && queue.length) handle(queue.shift()!);
  if (!replay && !busy && !queue.length) syncBalls(view.balls);
  if (replay) stepReplay(dt);
  onTurnChange();
  // Charging with Space.
  if (charging) power = Math.min(1, power + dt / 1.3);
  strikeAnim = Math.max(0, strikeAnim - dt);
  if (oppAim) {
    if (!oppShown) oppShown = { ...oppAim };
    const k = Math.min(1, dt * 12);
    oppShown.dx += (oppAim.dx - oppShown.dx) * k;
    oppShown.dy += (oppAim.dy - oppShown.dy) * k;
    oppShown.power += (oppAim.power - oppShown.power) * k;
    oppShown.cue = oppAim.cue;
  }
  if (myTurn()) link?.aim({ dx: aimDx, dy: aimDy, power, sx: spinX, sy: spinY, cue: view.ballInHand && cuePlace ? cuePlace : undefined });
  draw(dt);
  renderControls();
  renderTimer();
}
requestAnimationFrame(frame);

/** New turn: reset aim helpers, place the cue for ball in hand, auto-aim at a target. */
function onTurnChange(): void {
  const v = view!;
  const key = `${v.seq}:${v.current}:${v.phase}:${v.ballInHand}`;
  if (key === lastTurnKey || replay || busy || queue.length) return;
  lastTurnKey = key;
  oppAim = oppShown = null;
  power = 0;
  charging = false;
  call = -1;
  if (v.phase !== 'aim') return;
  const cue = v.balls.find((b) => b.id === 0)!;
  cuePlace = v.ballInHand ? (spotOk(cue.x, cue.y) && cue.pocket < 0 ? { x: cue.x, y: cue.y } : defaultSpot()) : null;
  if (v.current === v.you) {
    spinX = spinY = 0;
    // Point at the nearest legal ball.
    const from = cuePos();
    if (from) {
      let best: BallRest | null = null;
      let bd = Infinity;
      for (const b of v.balls) {
        if (b.pocket >= 0 || !v.targets.includes(b.id)) continue;
        const d = (b.x - from.x) ** 2 + (b.y - from.y) ** 2;
        if (d < bd) {
          bd = d;
          best = b;
        }
      }
      if (best) {
        const dx = best.x - from.x;
        const dy = best.y - from.y;
        const l = Math.sqrt(dx * dx + dy * dy) || 1;
        aimDx = dx / l;
        aimDy = dy / l;
      }
    }
  }
}

function spotOk(x: number, y: number): boolean {
  if (!view) return false;
  if (view.kitchen && x > HEAD_STRING_X) return false;
  return spotFree(view.balls, x, y, 0);
}
function defaultSpot(): { x: number; y: number } {
  for (let k = 0; k < 200; k++) {
    const x = HEAD_STRING_X - 0.05 - (k % 8) * 0.04;
    const y = ((Math.floor(k / 8) % 2 ? 1 : -1) * Math.floor(k / 16)) * 0.06;
    if (spotOk(x, y)) return { x, y };
  }
  return { x: HEAD_STRING_X - 0.1, y: 0 };
}

// ---------------------------------------------------------------- events

function handle(ev: GameEvent): void {
  const v = view!;
  const me = v.you;
  const name = (id: string) => (id === me ? 'You' : (v.players.find((p) => p.id === id)?.name ?? '?'));
  switch (ev.k) {
    case 'start':
      syncBalls(v.balls.map((b) => ({ ...b })));
      banner(ev.breaker === me ? 'YOUR BREAK' : `${name(ev.breaker).toUpperCase()} BREAKS`);
      break;
    case 'turn':
      shownCurrent = ev.player;
      renderHud();
      if (ev.player === me) {
        audio.turn();
        if (!v.isBreak) toast(ev.ballInHand ? '<b>Ball in hand</b> — drag the cue ball anywhere' : 'Your turn');
      }
      break;
    case 'shot': {
      syncBalls(ev.start);
      const sim = new Sim(ev.start);
      sim.shoot(ev.shot);
      const cue = ev.start.find((b) => b.id === 0)!;
      const mine = ev.by === me;
      replay = { sim, acc: 0, evi: 0, pre: mine ? 0 : 0.65, preTotal: 0.65, shot: ev.shot, by: ev.by, cue: { x: cue.x, y: cue.y } };
      if (mine) {
        audio.cue(ev.shot.power);
        if (v.isBreak || ev.shot.power > 0.85) audio.break();
      }
      cuePlace = null;
      break;
    }
    case 'result': {
      if (ev.foul) {
        audio.foul();
        stamp('FOUL');
        toast(`${esc(ev.foul)} ${ev.by === me ? `${esc(name(otherId()))} has` : 'You have'} ball in hand.`, 'error');
      } else if (ev.assigned) {
        const myGroup = v.players.find((p) => p.id === me)?.group;
        banner(`YOU ARE ${(myGroup ?? ev.assigned).toUpperCase()}`);
      } else if (ev.respot8) toast('The 8-ball went down on the break — it\'s back on the spot.');
      else if (!ev.keep && ev.by === me) toast('No ball potted.', 'dim');
      break;
    }
    case 'timeout':
      audio.foul();
      toast(`${esc(name(ev.by))} ran out of time — ball in hand!`, 'error');
      break;
    case 'left':
      toast(`${esc(name(ev.by))} left the table.`, 'error');
      break;
    case 'over': {
      const won = ev.winner === me;
      busy = true;
      setTimeout(() => {
        busy = false;
        showOver(won, ev.reason);
      }, 900);
      break;
    }
  }
}

function otherId(): string {
  return view!.players.find((p) => p.id !== view!.you)?.id ?? '';
}

function stepReplay(dt: number): void {
  const r = replay!;
  if (r.pre > 0) {
    r.pre -= dt;
    if (r.pre <= 0) audio.cue(r.shot.power);
    return;
  }
  r.acc += dt;
  const sim = r.sim;
  while (r.acc >= DT && sim.moving) {
    sim.step();
    r.acc -= DT;
  }
  // Sounds + pockets.
  for (; r.evi < sim.events.length; r.evi++) {
    const e = sim.events[r.evi]!;
    if (e.k === 'ball') audio.click(e.speed);
    else if (e.k === 'cushion') audio.cushion(e.speed);
    else {
      audio.pocket();
      const d = dballs.get(e.a);
      const p = POCKETS[e.pocket]!;
      if (d) sinking.push({ id: e.a, x: d.x, y: d.y, px: p.x, py: p.y, t: 0 });
    }
  }
  for (const b of sim.balls) {
    const d = dballs.get(b.id);
    if (!d) continue;
    d.x = b.x;
    d.y = b.y;
    d.on = b.pocket < 0;
    d.wx = b.wx;
    d.wy = b.wy;
    d.wz = b.wz;
  }
  if (!sim.moving) {
    replay = null;
    for (const d of dballs.values()) d.wx = d.wy = d.wz = 0;
  }
}

// ---------------------------------------------------------------- drawing

function drawIdle(): void {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, cv.width, cv.height);
  if (tableImg) g.drawImage(tableImg, 0, 0);
}

function draw(dt: number): void {
  const v = view!;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, cv.width, cv.height);
  if (tableImg) g.drawImage(tableImg, 0, 0);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const s = T.s;
  const rpx = R * s;
  const mine = myTurn();
  // Kitchen highlight while placing the cue for the break.
  if (v.ballInHand && v.kitchen && v.phase === 'aim' && !replay) {
    const a = [T.x(-BOUNDS.HL, -BOUNDS.HW), T.y(-BOUNDS.HL, -BOUNDS.HW)];
    const b = [T.x(HEAD_STRING_X, BOUNDS.HW), T.y(HEAD_STRING_X, BOUNDS.HW)];
    g.fillStyle = 'rgba(255,255,255,0.05)';
    g.fillRect(Math.min(a[0]!, b[0]!), Math.min(a[1]!, b[1]!), Math.abs(b[0]! - a[0]!), Math.abs(b[1]! - a[1]!));
  }
  // Pocket to call for the 8.
  const callingEight = v.onEight && v.phase === 'aim' && !replay;
  if (callingEight) {
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 180);
    POCKETS.forEach((p, i) => {
      const chosen = i === (call >= 0 ? call : callAuto);
      g.strokeStyle = chosen ? `rgba(255,214,64,${0.7 + pulse * 0.3})` : `rgba(255,255,255,${0.15 + pulse * 0.15})`;
      g.lineWidth = chosen ? 4 : 2;
      g.beginPath();
      g.arc(T.x(p.x, p.y), T.y(p.x, p.y), p.r * s * 1.05, 0, Math.PI * 2);
      g.stroke();
      if (chosen) {
        g.fillStyle = '#ffd640';
        g.font = `bold ${Math.round(14 + s * 0.02)}px 'Lilita One', sans-serif`;
        g.textAlign = 'center';
        g.fillText('8', T.x(p.x, p.y), T.y(p.x, p.y) + 5);
      }
    });
  }
  // Ball spin integration (visual orientation).
  for (const d of dballs.values()) if (d.on && (d.wx || d.wy || d.wz)) d.q = spin(d.q, d.wx, d.wy, d.wz, dt);
  // Ball-in-hand: show the placed cue ball.
  const cp = cuePos();
  const cueD = dballs.get(0);
  if (cueD && cp && v.ballInHand && !replay) {
    cueD.x = cp.x;
    cueD.y = cp.y;
    cueD.on = true;
  }
  if (cueD && v.ballInHand && !replay && !mine && link?.online && oppShown?.cue) {
    cueD.x = oppShown.cue.x;
    cueD.y = oppShown.cue.y;
    cueD.on = true;
  }
  // Shadows.
  g.fillStyle = 'rgba(0,0,0,0.32)';
  for (const d of dballs.values()) {
    if (!d.on) continue;
    g.beginPath();
    g.ellipse(T.x(d.x, d.y) + rpx * 0.28, T.y(d.x, d.y) + rpx * 0.38, rpx * 1.05, rpx * 0.92, 0, 0, Math.PI * 2);
    g.fill();
  }
  // Balls.
  for (const d of dballs.values()) {
    if (!d.on) continue;
    drawBall(d, T.x(d.x, d.y), T.y(d.x, d.y), rpx, 1);
  }
  // Balls dropping into pockets.
  for (let i = sinking.length - 1; i >= 0; i--) {
    const k = sinking[i]!;
    k.t += dt;
    const f = Math.min(1, k.t / 0.25);
    const d = dballs.get(k.id);
    if (d && f < 1) {
      const x = k.x + (k.px - k.x) * f;
      const y = k.y + (k.py - k.y) * f;
      drawBall(d, T.x(x, y), T.y(x, y), rpx * (1 - f * 0.55), 1 - f);
    } else sinking.splice(i, 1);
  }
  // Ball-in-hand marker.
  if (cueD && v.ballInHand && mine && cp) {
    const ok = spotOk(cp.x, cp.y);
    g.strokeStyle = ok ? 'rgba(255,255,255,0.8)' : 'rgba(255,60,60,0.9)';
    g.lineWidth = 2;
    g.setLineDash([5, 4]);
    g.beginPath();
    g.arc(T.x(cp.x, cp.y), T.y(cp.x, cp.y), rpx * 1.9, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
  }
  // Guides + cue.
  if (v.phase === 'aim' && !replay && !busy && !queue.length) {
    if (mine && cp) {
      drawGuides(cp, aimDx, aimDy);
      const back = rpx + 4 + power * 0.28 * s + (strikeAnim > 0 ? -strikeAnim * 40 : 0);
      const [sdx, sdy] = screenDir(aimDx, aimDy);
      drawCue(g, T.x(cp.x, cp.y) - sdx * back, T.y(cp.x, cp.y) - sdy * back, sdx, sdy, s);
    } else if (!mine && oppShown && cp) {
      const [sdx, sdy] = screenDir(oppShown.dx, oppShown.dy);
      const back = rpx + 4 + oppShown.power * 0.28 * s;
      drawCue(g, T.x(cp.x, cp.y) - sdx * back, T.y(cp.x, cp.y) - sdy * back, sdx, sdy, s, 0.9);
    }
  }
  // Opponent's stroke before their shot plays.
  if (replay && replay.pre > 0) {
    const f = 1 - replay.pre / replay.preTotal;
    const pull = f < 0.75 ? (f / 0.75) * replay.shot.power : replay.shot.power * (1 - (f - 0.75) / 0.25) - 0.05;
    const [sdx, sdy] = screenDir(replay.shot.dx, replay.shot.dy);
    const back = rpx + 4 + pull * 0.28 * s;
    const c = replay.cue;
    drawCue(g, T.x(c.x, c.y) - sdx * back, T.y(c.x, c.y) - sdy * back, sdx, sdy, s);
  } else if (replay && replay.sim.t < 0.15) {
    const [sdx, sdy] = screenDir(replay.shot.dx, replay.shot.dy);
    const c = replay.cue;
    drawCue(g, T.x(c.x, c.y) - sdx * (rpx + 2), T.y(c.x, c.y) - sdy * (rpx + 2), sdx, sdy, s, 1 - replay.sim.t / 0.15);
  }
}

function screenDir(dx: number, dy: number): [number, number] {
  const x = T.x(dx, dy) - T.x(0, 0);
  const y = T.y(dx, dy) - T.y(0, 0);
  const l = Math.hypot(x, y) || 1;
  return [x / l, y / l];
}

function drawBall(d: DBall, sx: number, sy: number, rpx: number, alpha: number): void {
  const r = rpx * dpr;
  const key = `${d.q.map((x) => x.toFixed(3)).join(',')}:${r.toFixed(1)}:${T.rot}`;
  if (key !== d.key) {
    d.key = key;
    d.img = renderBall(d.id, d.q, r, T, d.img ?? undefined);
    d.canvas.width = d.img.width;
    d.canvas.height = d.img.height;
    d.canvas.getContext('2d')!.putImageData(d.img, 0, 0);
  }
  const size = d.canvas.width / dpr;
  g.globalAlpha = alpha;
  g.drawImage(d.canvas, sx - size / 2, sy - size / 2, size, size);
  g.globalAlpha = 1;
}

function drawGuides(c: { x: number; y: number }, dx: number, dy: number): void {
  const v = view!;
  const balls = restForAim();
  const hit = castCue(balls, c.x, c.y, dx, dy);
  const s = T.s;
  const px = c.x + dx * hit.t;
  const py = c.y + dy * hit.t;
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = 1.6;
  g.beginPath();
  g.moveTo(T.x(c.x, c.y), T.y(c.x, c.y));
  g.lineTo(T.x(px, py), T.y(px, py));
  g.stroke();
  // Ghost ball.
  const legal = hit.ball < 0 || v.targets.includes(hit.ball);
  g.strokeStyle = legal ? 'rgba(255,255,255,0.9)' : 'rgba(255,70,70,0.95)';
  g.lineWidth = 1.8;
  g.beginPath();
  g.arc(T.x(px, py), T.y(px, py), R * s, 0, Math.PI * 2);
  g.stroke();
  if (!legal) {
    const k = R * s * 0.6;
    g.beginPath();
    g.moveTo(T.x(px, py) - k, T.y(px, py) - k);
    g.lineTo(T.x(px, py) + k, T.y(px, py) + k);
    g.moveTo(T.x(px, py) + k, T.y(px, py) - k);
    g.lineTo(T.x(px, py) - k, T.y(px, py) + k);
    g.stroke();
  }
  callAuto = -1;
  if (hit.ball >= 0) {
    const b = balls.find((x) => x.id === hit.ball)!;
    const cosA = dx * hit.nx + dy * hit.ny;
    const len = (settings.guides ? 0.5 : 0.18) * Math.max(0.25, cosA);
    // Object ball path.
    g.strokeStyle = 'rgba(255,255,255,0.75)';
    g.beginPath();
    g.moveTo(T.x(b.x, b.y), T.y(b.x, b.y));
    g.lineTo(T.x(b.x + hit.nx * len, b.y + hit.ny * len), T.y(b.x + hit.nx * len, b.y + hit.ny * len));
    g.stroke();
    // Cue ball deflection (tangent line).
    const tx = dx - cosA * hit.nx;
    const ty = dy - cosA * hit.ny;
    const tl = Math.hypot(tx, ty);
    if (tl > 0.02) {
      const l2 = (settings.guides ? 0.3 : 0.12) * tl;
      g.strokeStyle = 'rgba(255,255,255,0.4)';
      g.setLineDash([4, 4]);
      g.beginPath();
      g.moveTo(T.x(px, py), T.y(px, py));
      g.lineTo(T.x(px + (tx / tl) * l2, py + (ty / tl) * l2), T.y(px + (tx / tl) * l2, py + (ty / tl) * l2));
      g.stroke();
      g.setLineDash([]);
    }
    // Suggest the pocket the 8 is heading for.
    if (hit.ball === 8 && v.onEight) {
      let best = -1;
      let bd = -Infinity;
      POCKETS.forEach((p, i) => {
        const ox = p.x - b.x;
        const oy = p.y - b.y;
        const l = Math.hypot(ox, oy);
        const d = (ox * hit.nx + oy * hit.ny) / l;
        if (d > bd) {
          bd = d;
          best = i;
        }
      });
      callAuto = best;
    }
  }
}

// ---------------------------------------------------------------- input

let dragging: 'aim' | 'cue' | 'power' | 'spin' | null = null;
let powerStart = 0;
cv.addEventListener('pointerdown', (e) => {
  if (!myTurn()) return;
  const v = view!;
  const w = T.world(e.clientX, e.clientY);
  const cp = cuePos();
  cv.setPointerCapture(e.pointerId);
  if (v.ballInHand && cp && Math.hypot(w.x - cp.x, w.y - cp.y) < R * 2.6) {
    dragging = 'cue';
    return;
  }
  if (v.onEight) {
    const i = POCKETS.findIndex((p) => Math.hypot(w.x - p.x, w.y - p.y) < p.r + 0.05);
    if (i >= 0) {
      call = i;
      audio.ui();
      return;
    }
  }
  dragging = 'aim';
  aimAt(w.x, w.y);
});
cv.addEventListener('pointermove', (e) => {
  if (!dragging || !myTurn()) return;
  const w = T.world(e.clientX, e.clientY);
  if (dragging === 'aim') aimAt(w.x, w.y);
  else if (dragging === 'cue') {
    const hl = BOUNDS.HL - R;
    const hw = BOUNDS.HW - R;
    let x = Math.max(-hl, Math.min(hl, w.x));
    const y = Math.max(-hw, Math.min(hw, w.y));
    if (view!.kitchen) x = Math.min(x, HEAD_STRING_X);
    cuePlace = { x, y };
  }
});
const endDrag = () => {
  if (dragging === 'cue' && cuePlace && !spotOk(cuePlace.x, cuePlace.y)) {
    toast("The cue ball can't go there.", 'error');
  }
  dragging = null;
};
cv.addEventListener('pointerup', endDrag);
cv.addEventListener('pointercancel', endDrag);
cv.addEventListener(
  'wheel',
  (e) => {
    if (!myTurn()) return;
    e.preventDefault();
    rotateAim(e.deltaY * 0.0006 * (e.shiftKey ? 5 : 1));
  },
  { passive: false },
);

function aimAt(x: number, y: number): void {
  const c = cuePos();
  if (!c) return;
  const dx = x - c.x;
  const dy = y - c.y;
  const l = Math.hypot(dx, dy);
  if (l < R * 0.5) return;
  aimDx = dx / l;
  aimDy = dy / l;
}
function rotateAim(a: number): void {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const x = aimDx * c - aimDy * s;
  const y = aimDx * s + aimDy * c;
  aimDx = x;
  aimDy = y;
}

// Power bar: pull down, let go to shoot.
const powerEl = $('#power');
powerEl.addEventListener('pointerdown', (e) => {
  if (!myTurn()) return;
  powerEl.setPointerCapture(e.pointerId);
  dragging = 'power';
  powerStart = e.clientY;
  power = 0;
});
powerEl.addEventListener('pointermove', (e) => {
  if (dragging !== 'power') return;
  const h = $('.pl-power__track').getBoundingClientRect().height;
  power = Math.max(0, Math.min(1, (e.clientY - powerStart) / (h * 0.92)));
});
powerEl.addEventListener('pointerup', () => {
  if (dragging !== 'power') return;
  dragging = null;
  if (power > 0.03) shoot();
  else power = 0;
});

// Spin widget.
const spinEl = $('#spin');
const setSpin = (e: PointerEvent) => {
  const r = $('.pl-spin__ball').getBoundingClientRect();
  let x = ((e.clientX - (r.left + r.width / 2)) / (r.width / 2)) * 1;
  let y = (-(e.clientY - (r.top + r.height / 2)) / (r.height / 2)) * 1;
  const m = Math.hypot(x, y);
  const lim = MAX_TIP / 0.75;
  if (m > lim) {
    x = (x / m) * lim;
    y = (y / m) * lim;
  }
  spinX = x * 0.75;
  spinY = y * 0.75;
};
spinEl.addEventListener('pointerdown', (e) => {
  if (!myTurn()) return;
  spinEl.setPointerCapture(e.pointerId);
  dragging = 'spin';
  setSpin(e);
});
spinEl.addEventListener('pointermove', (e) => dragging === 'spin' && setSpin(e));
spinEl.addEventListener('pointerup', () => (dragging = null));
spinEl.addEventListener('dblclick', () => (spinX = spinY = 0));

addEventListener('keydown', (e) => {
  if (!view || document.activeElement?.tagName === 'INPUT' || !myTurn()) return;
  if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
    e.preventDefault();
    rotateAim((e.code === 'ArrowLeft' ? 1 : -1) * (e.shiftKey ? 0.02 : 0.0025) * (T.rot ? -1 : 1));
  }
  if (e.code === 'Space' && !e.repeat) {
    e.preventDefault();
    charging = true;
    power = 0;
  }
  if (e.code === 'Escape') {
    charging = false;
    power = 0;
  }
});
addEventListener('keyup', (e) => {
  if (e.code !== 'Space' || !charging) return;
  charging = false;
  if (myTurn() && power > 0.03) shoot();
  else power = 0;
});

function shoot(): void {
  const v = view!;
  const cp = cuePos();
  if (!cp) return;
  if (v.ballInHand && cuePlace && !spotOk(cuePlace.x, cuePlace.y)) {
    toast("Move the cue ball somewhere legal first.", 'error');
    power = 0;
    return;
  }
  const pocket = call >= 0 ? call : callAuto;
  if (v.onEight && pocket < 0) {
    toast('Tap a pocket to call the 8-ball.', 'error');
    power = 0;
    return;
  }
  const a: Action = { t: 'shoot', shot: { dx: aimDx, dy: aimDy, power, sx: spinX, sy: spinY }, cue: v.ballInHand && cuePlace ? cuePlace : undefined, call: v.onEight ? pocket : undefined };
  strikeAnim = 0.12;
  link?.send(a);
  power = 0;
}

// ---------------------------------------------------------------- HUD

function renderHud(): void {
  const v = view;
  if (!v) return;
  v.players.forEach((p, i) => {
    const el = $(`#p${i}`);
    const turn = (shownCurrent || v.current) === p.id && v.phase !== 'over';
    const group: Group | null = p.group;
    const ids = group === 'solids' ? [1, 2, 3, 4, 5, 6, 7] : group === 'stripes' ? [9, 10, 11, 12, 13, 14, 15] : [];
    const onTable = new Set(v.balls.filter((b) => b.pocket < 0).map((b) => b.id));
    const left = ids.filter((id) => onTable.has(id));
    const balls = group
      ? ids.map((id) => ballIcon(id, onTable.has(id) ? '' : 'potted')).join('') + (left.length === 0 ? ballIcon(8, 'eight') : '')
      : '<span class="pl-open">Open table</span>';
    const html = `<div class="pl-side__who"><div class="pl-side__av ${turn ? 'turn' : ''}">${avatar(p.avatar)}<svg class="pl-timer" viewBox="0 0 100 100"><circle cx="50" cy="50" r="46"/></svg></div>
      <div><b>${esc(p.id === v.you ? `${p.name} (you)` : p.name)}</b>${p.bot ? '<em>BOT</em>' : ''}${p.connected ? '' : '<em class="off">offline</em>'}<small>${group ? group.toUpperCase() : ''}</small></div></div>
      <div class="pl-side__balls">${balls}</div>`;
    if (el.dataset.html !== html) {
      el.dataset.html = html;
      el.innerHTML = html;
    }
  });
  const curId = shownCurrent || v.current;
  const cur = v.players.find((p) => p.id === curId);
  $('#turn-text').innerHTML = v.phase === 'over' && !replay ? 'GAME OVER' : curId === v.you ? '<b>YOUR SHOT</b>' : `${esc(cur?.name ?? '')}'s shot`;
}

function renderTimer(): void {
  const v = view!;
  const total = v.rules.shotTime;
  const left = Math.max(0, v.shotLeft - (performance.now() - updateAt) / 1000);
  for (const el of document.querySelectorAll<HTMLElement>('.pl-side__av.turn .pl-timer')) el.style.setProperty('--p', total && v.phase === 'aim' && !replay ? String(left / total) : '1');
}

function renderControls(): void {
  const mine = myTurn();
  powerEl.classList.toggle('off', !mine);
  spinEl.classList.toggle('off', !mine);
  $('#power-fill').style.height = `${power * 100}%`;
  $('#power-cue').style.transform = `translateY(${power * 100}%)`;
  $('#spin-dot').style.transform = `translate(${(spinX / 0.75) * 50}%, ${(-spinY / 0.75) * 50}%)`;
  const v = view!;
  const hint = $('#hint');
  const text = mine ? (v.onEight ? (call >= 0 ? `8-ball → pocket called. Pull the power bar to shoot.` : 'Tap a pocket to call the 8-ball') : v.ballInHand ? (v.kitchen ? 'Break! Drag the cue ball behind the line, aim, pull to shoot' : 'Ball in hand — drag the cue ball') : '') : '';
  hint.classList.toggle('hidden', !text);
  if (hint.textContent !== text) hint.textContent = text;
}

// ---------------------------------------------------------------- messages

function toast(html: string, kind = ''): void {
  const m = $('#msg');
  const el = document.createElement('div');
  el.className = `pl-toast ${kind}`;
  el.innerHTML = html;
  m.prepend(el);
  while (m.children.length > 3) m.lastElementChild!.remove();
  setTimeout(() => el.classList.add('old'), 3500);
  setTimeout(() => el.remove(), 5000);
}
function banner(text: string): void {
  const el = document.createElement('div');
  el.className = 'pl-banner pl-display';
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1600);
}
function stamp(text: string): void {
  const el = document.createElement('div');
  el.className = 'pl-stamp pl-display';
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1300);
}

function openModal(html: string): HTMLElement {
  $('#modal').classList.remove('hidden');
  const p = $('#modal-panel');
  p.innerHTML = html;
  return p;
}
function closeModal(): void {
  $('#modal').classList.add('hidden');
}

function showOver(won: boolean, reason: string): void {
  const v = view!;
  const w = v.players.find((p) => p.id === v.winner);
  audio.win(won);
  if (won) confetti();
  const p = openModal(`<div class="pl-over__ball">${ballIcon(8)}</div><h2 class="pl-display ${won ? 'gold' : ''}">${won ? 'YOU WIN!' : `${esc((w?.name ?? '').toUpperCase())} WINS`}</h2>
    <p>${esc(reason.charAt(0).toUpperCase() + reason.slice(1))}.</p>
    <div class="pl-two"><button class="pl-btn pl-btn--go" id="again"><span class="pl-display">${link?.online ? 'BACK TO LOBBY' : 'REMATCH'}</span></button><button class="pl-btn" id="to-menu">Menu</button></div>`);
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

function confetti(): void {
  const cols = Object.values(BALL_COLORS);
  for (let i = 0; i < 90; i++) {
    const el = document.createElement('i');
    el.className = 'pl-confetti';
    el.style.left = `${Math.random() * 100}vw`;
    el.style.background = cols[i % cols.length]!;
    el.style.animationDelay = `${Math.random() * 0.8}s`;
    el.style.animationDuration = `${2 + Math.random() * 1.5}s`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }
}

function toMenu(): void {
  link?.dispose();
  link = null;
  view = null;
  void net?.leave();
  net = null;
  closeModal();
  for (const id of ['#hud', '#power', '#spin', '#hint']) $(id).classList.add('hidden');
  $('#online').classList.add('hidden');
  $('#menu').classList.remove('hidden');
}

// ============================================================================ online

let net: PoolNet | null = null;
let lobby: PlLobby | null = null;
let lanUrl: string | null = null;
const oCode = $<HTMLInputElement>('#o-code');
oCode.addEventListener('input', () => (oCode.value = oCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4)));
const oStatus = (t: string, err = false) => {
  $('#o-status').textContent = t;
  $('#o-status').classList.toggle('error', err);
};

async function openOnline(code = ''): Promise<void> {
  settings.name = nameInput.value.trim() || 'Player';
  store.set('pl-name', settings.name);
  $('#menu').classList.add('hidden');
  $('#online').classList.remove('hidden');
  $('#o-connect').classList.remove('hidden');
  $('#o-lobby').classList.add('hidden');
  if (code) oCode.value = code.toUpperCase().slice(0, 4);
  oStatus('');
  const probe = new PoolNet();
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

async function connect(how: (n: PoolNet) => Promise<void>): Promise<void> {
  if (net?.room) return;
  oStatus('Connecting…');
  const n = new PoolNet();
  try {
    await how(n);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    oStatus(/not found/i.test(msg) ? 'No table with that code.' : /locked|full|maxClients/i.test(msg) ? 'That table is full or already playing.' : msg, true);
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
    if (link) toast(esc(m), 'error');
  };
  n.onClosed = (reason) => {
    if (net !== n) return;
    net = null;
    if (link?.online) {
      toast('Disconnected.', 'error');
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
  const seats = [...l.players];
  while (seats.length < 2) seats.push({ id: '', name: 'Waiting…', avatar: 0, bot: false, connected: false });
  $('#o-players').innerHTML = seats
    .map((p, i) => `${i === 1 ? '<span class="pl-display pl-vs-big">VS</span>' : ''}<div class="pl-lp ${p.id === net!.sessionId ? 'me' : ''} ${p.id ? '' : 'empty'}">${p.id ? avatar(p.avatar) : '<span class="pl-avatar empty">?</span>'}<b>${esc(p.name)}</b><small>${p.bot ? 'BOT' : p.id === l.hostId ? 'HOST' : p.id === net!.sessionId ? 'YOU' : ''}</small></div>`)
    .join('');
  $('#o-host').classList.toggle('hidden', !host || l.phase === 'playing');
  setSeg('#o-bot', l.config.bot ? l.config.botLevel : 'off');
  setSeg('#o-time', String(l.config.shotTime));
  const ready = l.players.length === 2;
  $('#o-wait').textContent = l.phase === 'playing' ? 'Game in progress…' : host ? (ready ? '' : 'Send the code to a friend — or add a bot.') : 'Waiting for the host to start…';
  ($('#o-start') as HTMLButtonElement).disabled = !ready;
}

function backToLobby(): void {
  link?.dispose();
  link = null;
  view = null;
  for (const id of ['#hud', '#power', '#spin', '#hint']) $(id).classList.add('hidden');
  $('#online').classList.remove('hidden');
  renderLobby();
}

$('#m-online').addEventListener('click', () => void openOnline());
$('#m-play').addEventListener('click', startLocal);
$('#o-create').addEventListener('click', () => void connect((n) => n.create(settings.name, settings.avatar)));
$('#o-quick').addEventListener('click', () => void connect((n) => n.quick(settings.name, settings.avatar)));
$('#o-join').addEventListener('click', () => {
  if (oCode.value.length < 4) return oStatus('Table codes have 4 characters.', true);
  void connect((n) => n.join(oCode.value, settings.name, settings.avatar));
});
oCode.addEventListener('keydown', (e) => e.key === 'Enter' && $('#o-join').click());
$('#o-bot').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!b) return;
  net?.config(b.dataset.v === 'off' ? { bot: false } : { bot: true, botLevel: b.dataset.v as BotLevel });
});
$('#o-time').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (b) net?.config({ shotTime: Number(b.dataset.v) });
});
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
(window as unknown as Record<string, unknown>).__pl = {
  get link() {
    return link;
  },
  get view() {
    return view;
  },
  aim(dx: number, dy: number) {
    const l = Math.hypot(dx, dy);
    aimDx = dx / l;
    aimDy = dy / l;
  },
  shoot(p: number) {
    power = p;
    shoot();
  },
  get myTurn() {
    return myTurn();
  },
};
