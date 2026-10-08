import './styles.css';
import { BOUNDS, DT, FOOT_SPOT_X, ON_TABLE, POCKETS, R, Sim, spotFree, HEAD_STRING_X, MAX_TIP, type BallRest, type ShotInput } from './physics';
import type { Action, GameEvent, Group } from './engine';
import { BALL_COLORS, Transform, ballColor, drawCue, hole, randomOrientation, renderBall, renderTable, spin, type Quat } from './art';
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
    <button class="pl-chip" id="arcade">← Arcade</button>
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
// "← Arcade" never drops a game without asking.
$('#arcade').addEventListener('click', () => {
  if (link) openGameMenu(true);
  else location.href = '/';
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
  /** Render size / view the cached image was made for, and the orientation it shows. */
  key: string;
  rq: Quat | null;
}
/** Ball images re-rendered this frame (the per-pixel shading is the CPU hot spot at dpr 2). */
let renders = 0;
const RENDER_BUDGET = 6;
/** Re-render once a ball has turned more than ~3° since its cached image (cos of half the angle). */
const TURN_DOT = Math.cos((3 * Math.PI) / 360);
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
  isBreak: boolean;
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
let lastTurnKey = '';
/**
 * What the HUD shows: it follows the animation queue, not the latest state, so
 * groups, potted balls and "game over" appear when the balls stop, not before.
 */
const hud = { current: '', groups: new Map<string, Group | null>(), over: false };
/** Foul explanation: the ball hit first / the pocket scratched in, ringed in red for a moment. */
let foulMark: { ball: number; pocket: number; t: number } | null = null;
/** Last whole second the shot clock ticked on. */
let lastTick = -1;
/** Reconnecting after a dropped socket: input is off until the room is back. */
let reconnecting = false;
/** The sim-driven aim guide, recomputed only when the aim changes. */
let guide: Guide | null = null;

function startLocal(): void {
  settings.name = nameInput.value.trim() || 'Player';
  link?.dispose();
  attach(new LocalLink({ name: settings.name, avatar: settings.avatar, level: settings.level, rules: { shotTime: 30 } }));
}

function attach(l: GameLink): void {
  link = l;
  view = null;
  hud.current = '';
  hud.groups.clear();
  hud.over = false;
  foulMark = null;
  guide = null;
  lastTurnKey = '';
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
  return !!view && view.phase === 'aim' && view.current === view.you && !replay && !busy && !queue.length && !reconnecting;
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
      d = { id: b.id, x: b.x, y: b.y, q: randomOrientation(), on: b.pocket === ON_TABLE, wx: 0, wy: 0, wz: 0, canvas: document.createElement('canvas'), img: null, key: '', rq: null };
      dballs.set(b.id, d);
    }
    d.x = b.x;
    d.y = b.y;
    d.on = b.pocket === ON_TABLE;
    d.wx = d.wy = d.wz = 0;
  }
}

/** Cue ball position to aim from (my ball in hand uses my placement). */
function cuePos(): { x: number; y: number } | null {
  if (!view) return null;
  if (view.ballInHand && cuePlace && view.current === view.you) return cuePlace;
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
  renders = 0;
  // The local table (and the bot) waits while the intro or the in-game menu is up.
  if (link && (link.online || (!introUp && $('#modal').classList.contains('hidden')))) link.tick(dt);
  if (!view) {
    drawIdle();
    return;
  }
  // Events: a shot blocks the queue until its replay has finished.
  while (!busy && !replay && queue.length) handle(queue.shift()!);
  if (!replay && !busy && !queue.length) {
    // Nothing left to show: the latest state is what's on screen.
    syncBalls(view.balls);
    syncHud();
  }
  if (replay) stepReplay(dt);
  onTurnChange();
  // Charging with Space.
  if (charging) power = Math.min(1, power + dt / 1.3);
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
  cuePlace = v.ballInHand && v.current === v.you ? (spotOk(cue.x, cue.y) && cue.pocket === ON_TABLE ? { x: cue.x, y: cue.y } : defaultSpot()) : null;
  if (v.current === v.you) {
    spinX = spinY = 0;
    // Point at the nearest legal ball.
    const from = cuePos();
    if (from) {
      let best: BallRest | null = null;
      let bd = Infinity;
      for (const b of v.balls) {
        if (b.pocket !== ON_TABLE || !v.targets.includes(b.id)) continue;
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
  const has = (id: string) => (id === me ? 'have' : 'has');
  switch (ev.k) {
    case 'start':
      syncBalls(v.balls.map((b) => ({ ...b })));
      for (const p of v.players) hud.groups.set(p.id, null);
      hud.current = ev.breaker;
      renderHud();
      showIntro(ev.breaker, () => banner(ev.breaker === me ? 'YOUR BREAK' : `${name(ev.breaker).toUpperCase()} BREAKS`));
      break;
    case 'turn':
      hud.current = ev.player;
      lastTick = -1;
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
      // Everyone gets the pull-back and strike; your own is just quicker.
      const pre = mine ? 0.25 : 0.65;
      const racked = ev.start.filter((b) => b.id && b.pocket === ON_TABLE);
      const isBreak = racked.length === 15 && racked.every((b) => b.x > FOOT_SPOT_X - 0.01 && b.x < FOOT_SPOT_X + 0.22 && Math.abs(b.y) < 0.13);
      replay = { sim, acc: 0, evi: 0, pre, preTotal: pre, shot: ev.shot, by: ev.by, cue: { x: cue.x, y: cue.y }, isBreak };
      cuePlace = null;
      foulMark = null;
      break;
    }
    case 'result': {
      if (ev.assigned) {
        const by = ev.by;
        hud.groups.set(by, ev.assigned);
        hud.groups.set(v.players.find((p) => p.id !== by)?.id ?? '', ev.assigned === 'solids' ? 'stripes' : 'solids');
      }
      renderHud();
      if (ev.foul) {
        audio.foul();
        stamp('FOUL');
        const wrongBall = /first$/.test(ev.foul) ? ev.firstHit : -1;
        foulMark = { ball: wrongBall, pocket: ev.scratch, t: 0 };
        const other = v.players.find((p) => p.id !== ev.by)?.id ?? '';
        toast(`${ev.by === me ? 'You' : esc(name(ev.by))} ${esc(ev.foul)} — ${esc(name(other))} ${has(other)} ball in hand`, 'error');
      } else if (ev.assigned) {
        const myGroup = hud.groups.get(me);
        banner(`YOU ARE ${(myGroup ?? ev.assigned).toUpperCase()}`);
      } else if (ev.respot8) toast('The 8-ball went down on the break — it\'s back on the spot.');
      else if (!ev.keep && ev.by === me) toast('No ball potted.', 'dim');
      break;
    }
    case 'timeout': {
      audio.foul();
      const other = v.players.find((p) => p.id !== ev.by)?.id ?? '';
      toast(`${esc(name(ev.by))} ran out of time — ${esc(name(other))} ${has(other)} ball in hand`, 'error');
      break;
    }
    case 'left':
      toast(`${esc(name(ev.by))} left the table.`, 'error');
      break;
    case 'over': {
      const won = ev.winner === me;
      hud.over = true;
      renderHud();
      busy = true;
      setTimeout(() => {
        busy = false;
        showOver(won, ev.reason);
      }, 900);
      break;
    }
  }
}

function stepReplay(dt: number): void {
  const r = replay!;
  if (r.pre > 0) {
    r.pre -= dt;
    if (r.pre <= 0) {
      audio.cue(r.shot.power);
      if (r.isBreak) audio.break();
    }
    return;
  }
  r.acc += dt;
  const sim = r.sim;
  const t0 = sim.t;
  while (r.acc >= DT && sim.moving) {
    sim.step();
    r.acc -= DT;
  }
  // Sounds + pockets, scheduled at their sim-time offset within this frame.
  for (; r.evi < sim.events.length; r.evi++) {
    const e = sim.events[r.evi]!;
    const delay = Math.max(0, e.t - t0);
    if (e.k === 'ball') audio.click(e.speed, delay);
    else if (e.k === 'cushion') {
      if (e.jaw) audio.rattle(e.speed, delay);
      else audio.cushion(e.speed, delay);
    } else if (e.k === 'pocket') {
      audio.pocket(delay);
      const d = dballs.get(e.a);
      const h = hole(POCKETS[e.pocket]!);
      if (d) sinking.push({ id: e.a, x: d.x, y: d.y, px: h.x, py: h.y, t: 0 });
      renderHud();
    }
  }
  for (const b of sim.balls) {
    const d = dballs.get(b.id);
    if (!d) continue;
    d.x = b.x;
    d.y = b.y;
    d.on = b.pocket === ON_TABLE;
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
  if (v.ballInHand && v.kitchen && v.phase === 'aim' && !replay && mine) {
    const a = [T.x(-BOUNDS.HL, -BOUNDS.HW), T.y(-BOUNDS.HL, -BOUNDS.HW)];
    const b = [T.x(HEAD_STRING_X, BOUNDS.HW), T.y(HEAD_STRING_X, BOUNDS.HW)];
    g.save();
    // Not over the pocket holes.
    g.beginPath();
    g.rect(0, 0, cv.width, cv.height);
    for (const p of POCKETS) {
      const h = hole(p);
      g.moveTo(T.x(h.x, h.y) + h.r * s, T.y(h.x, h.y));
      g.arc(T.x(h.x, h.y), T.y(h.x, h.y), h.r * s, 0, Math.PI * 2);
    }
    g.clip('evenodd');
    g.fillStyle = 'rgba(255,255,255,0.05)';
    g.fillRect(Math.min(a[0]!, b[0]!), Math.min(a[1]!, b[1]!), Math.abs(b[0]! - a[0]!), Math.abs(b[1]! - a[1]!));
    g.restore();
  }
  // Pocket to call for the 8: dashed = the guide's suggestion, solid + "8" badge = called (confirmed by a tap).
  const callingEight = v.onEight && v.phase === 'aim' && !replay && mine;
  if (callingEight) {
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 180);
    POCKETS.forEach((p, i) => {
      const h = hole(p);
      const hx = T.x(h.x, h.y);
      const hy = T.y(h.x, h.y);
      const called = i === call;
      const suggested = call < 0 && i === callAuto;
      g.strokeStyle = called ? '#ffd640' : suggested ? `rgba(255,214,64,${0.55 + pulse * 0.4})` : `rgba(255,255,255,${0.15 + pulse * 0.15})`;
      g.lineWidth = called ? 4 : suggested ? 3 : 2;
      if (suggested) g.setLineDash([6, 5]);
      g.beginPath();
      g.arc(hx, hy, h.r * s + 3, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
      if (called) {
        const br = Math.max(9, s * 0.02);
        g.fillStyle = '#121214';
        g.strokeStyle = '#ffd640';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(hx, hy, br, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        g.fillStyle = '#fff';
        g.font = `${Math.round(br * 1.3)}px 'Lilita One', sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('8', hx, hy + 1);
        g.textBaseline = 'alphabetic';
      }
    });
  }
  // Ball spin integration (visual orientation).
  for (const d of dballs.values()) if (d.on && (d.wx || d.wy || d.wz)) d.q = spin(d.q, d.wx, d.wy, d.wz, dt);
  // Ball-in-hand: show my placed cue ball (or the opponent's live placement online).
  const cp = cuePos();
  const cueD = dballs.get(0);
  if (cueD && cp && v.ballInHand && !replay && mine) {
    cueD.x = cp.x;
    cueD.y = cp.y;
    cueD.on = true;
  }
  if (cueD && v.ballInHand && !replay && !mine && link?.online && oppShown?.cue) {
    cueD.x = oppShown.cue.x;
    cueD.y = oppShown.cue.y;
    cueD.on = true;
  }
  // Where the stick and guides start: wherever the cue ball is drawn this frame (my placement, or the opponent's live one).
  const cueAt = cueD && cueD.on ? { x: cueD.x, y: cueD.y } : cp;
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
    drawBall(d, T.x(d.x, d.y), T.y(d.x, d.y), 1, 1);
  }
  // Balls dropping into pockets: roll on to the hole's centre, shrink and darken into it.
  for (let i = sinking.length - 1; i >= 0; i--) {
    const k = sinking[i]!;
    k.t += dt;
    const f = Math.min(1, k.t / 0.25);
    const d = dballs.get(k.id);
    if (d && f < 1) {
      const e = 1 - (1 - f) * (1 - f);
      const x = k.x + (k.px - k.x) * e;
      const y = k.y + (k.py - k.y) * e;
      const sc = 1 - f * f * 0.6;
      drawBall(d, T.x(x, y), T.y(x, y), sc, 1 - f * f);
      g.fillStyle = `rgba(0,0,0,${f * 0.7})`;
      g.beginPath();
      g.arc(T.x(x, y), T.y(x, y), rpx * sc, 0, Math.PI * 2);
      g.fill();
    } else sinking.splice(i, 1);
  }
  // Foul explanation: ring the ball hit first / the pocket the cue ball dropped in.
  if (foulMark) {
    foulMark.t += dt;
    const f = foulMark.t;
    if (f > 2.4) foulMark = null;
    else {
      const pulse = 0.8 + 0.2 * Math.sin(f * 14);
      g.strokeStyle = `rgba(255,50,50,${Math.min(1, 1.6 - f * 0.6) * pulse})`;
      g.lineWidth = 4;
      const ring = (x: number, y: number, r: number) => {
        g.beginPath();
        g.arc(T.x(x, y), T.y(x, y), r, 0, Math.PI * 2);
        g.stroke();
      };
      const b = dballs.get(foulMark.ball);
      if (b && b.on) ring(b.x, b.y, rpx * 1.7 + f * 4);
      const pk = POCKETS[foulMark.pocket];
      if (pk) {
        const h = hole(pk);
        ring(h.x, h.y, h.r * s + 4 + f * 4);
      }
    }
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
  // Guides + cue (the tip sits where the spin is set).
  if (v.phase === 'aim' && !replay && !busy && !queue.length) {
    if (mine && cueAt) {
      drawGuides(cueAt, aimDx, aimDy);
      // The stick is put down while the cue ball is being moved, and comes back behind it.
      if (dragging !== 'cue') {
        const back = rpx + 4 + power * PULL * s;
        const [sdx, sdy] = screenDir(aimDx, aimDy);
        const [ox, oy] = tipOffset(sdx, sdy, spinX, spinY, rpx);
        drawCue(g, T.x(cueAt.x, cueAt.y) - sdx * back + ox, T.y(cueAt.x, cueAt.y) - sdy * back + oy, sdx, sdy, s);
        drawTip(T.x(cueAt.x, cueAt.y) + ox, T.y(cueAt.x, cueAt.y) + oy, rpx, spinX || spinY ? 1 : 0);
      }
    } else if (!mine && oppShown && cueAt) {
      const [sdx, sdy] = screenDir(oppShown.dx, oppShown.dy);
      const back = rpx + 4 + oppShown.power * PULL * s;
      const [ox, oy] = tipOffset(sdx, sdy, oppShown.sx, oppShown.sy, rpx);
      drawCue(g, T.x(cueAt.x, cueAt.y) - sdx * back + ox, T.y(cueAt.x, cueAt.y) - sdy * back + oy, sdx, sdy, s, 0.9);
    }
  }
  // The stroke before a shot plays: draw back, then strike.
  if (replay && replay.pre > 0) {
    const f = 1 - replay.pre / replay.preTotal;
    const pull = f < 0.75 ? (f / 0.75) * replay.shot.power : replay.shot.power * (1 - (f - 0.75) / 0.25) - 0.05;
    const [sdx, sdy] = screenDir(replay.shot.dx, replay.shot.dy);
    const back = rpx + 4 + Math.max(0.04, pull) * PULL * s;
    const [ox, oy] = tipOffset(sdx, sdy, replay.shot.sx, replay.shot.sy, rpx);
    const c = replay.cue;
    drawCue(g, T.x(c.x, c.y) - sdx * back + ox, T.y(c.x, c.y) - sdy * back + oy, sdx, sdy, s);
  } else if (replay && replay.sim.t < 0.15) {
    const [sdx, sdy] = screenDir(replay.shot.dx, replay.shot.dy);
    const [ox, oy] = tipOffset(sdx, sdy, replay.shot.sx, replay.shot.sy, rpx);
    const c = replay.cue;
    drawCue(g, T.x(c.x, c.y) - sdx * (rpx + 2) + ox, T.y(c.x, c.y) - sdy * (rpx + 2) + oy, sdx, sdy, s, 1 - replay.sim.t / 0.15);
  }
}

/** How far (table metres per unit power) the stick draws back. */
const PULL = 0.2;

/** Where the tip meets the ball on screen: side spin shifts it across the aim line, follow/draw up/down the screen (as on the spin widget). */
function tipOffset(sdx: number, sdy: number, sx: number, sy: number, rpx: number): [number, number] {
  const k = rpx * 0.9;
  return [-sdy * sx * k, sdx * sx * k - sy * k * (T.rot ? 0 : 1)];
}

/** Chalk mark on the cue ball where the tip strikes. */
function drawTip(x: number, y: number, rpx: number, on: number): void {
  if (!on) return;
  g.fillStyle = 'rgba(70,150,220,0.9)';
  g.beginPath();
  g.arc(x, y, Math.max(2, rpx * 0.22), 0, Math.PI * 2);
  g.fill();
}

function screenDir(dx: number, dy: number): [number, number] {
  const x = T.x(dx, dy) - T.x(0, 0);
  const y = T.y(dx, dy) - T.y(0, 0);
  const l = Math.hypot(x, y) || 1;
  return [x / l, y / l];
}

/**
 * Balls are shaded per pixel into a cached image that is only redrawn when the
 * ball has visibly turned (and at most RENDER_BUDGET per frame); `scale` shrinks
 * the cached image (a ball dropping into a pocket) without re-rendering it.
 */
function drawBall(d: DBall, sx: number, sy: number, scale: number, alpha: number): void {
  const r = R * T.s * dpr;
  const key = `${r.toFixed(1)}:${T.rot}`;
  const q = d.q;
  const rq = d.rq;
  const turned = !rq || Math.abs(q[0] * rq[0] + q[1] * rq[1] + q[2] * rq[2] + q[3] * rq[3]) < TURN_DOT;
  if (key !== d.key || (turned && renders < RENDER_BUDGET)) {
    renders++;
    d.key = key;
    d.rq = [q[0], q[1], q[2], q[3]];
    d.img = renderBall(d.id, q, r, T, d.img ?? undefined);
    d.canvas.width = d.img.width;
    d.canvas.height = d.img.height;
    d.canvas.getContext('2d')!.putImageData(d.img, 0, 0);
  }
  const size = (d.canvas.width / dpr) * scale;
  g.globalAlpha = alpha;
  g.drawImage(d.canvas, sx - size / 2, sy - size / 2, size, size);
  g.globalAlpha = 1;
}

interface Guide {
  key: string;
  /** Cue-ball path up to contact, and after it (through its first cushion).  */
  pre: Array<[number, number]>;
  post: Array<[number, number]>;
  /** Object-ball path to its first cushion / pocket. */
  obj: Array<[number, number]>;
  /** Where the cue ball is at contact (the ghost ball), or at the rail if it hits nothing. */
  ghost: { x: number; y: number };
  hit: number;
  /** Object-ball direction at contact (for the 8-ball call) and its pocket if it drops. */
  nx: number;
  ny: number;
  potted: number;
}

/**
 * Miniclip-style guide: simulate the shot from the aim (with the current spin
 * and power, so squirt, swerve and english are all in) and keep the cue ball's
 * path through its first cushion after contact plus the object ball's line to
 * its first cushion or pocket.
 */
function computeGuide(c: { x: number; y: number }, dx: number, dy: number, pw: number, sx: number, sy: number): Guide {
  const balls = restForAim();
  const sim = new Sim(balls);
  sim.shoot({ dx, dy, power: pw, sx, sy });
  const cue = sim.ball(0)!;
  const pre: Array<[number, number]> = [[c.x, c.y]];
  const post: Array<[number, number]> = [];
  const obj: Array<[number, number]> = [];
  let ghost = { x: c.x, y: c.y };
  let hit = -1;
  let nx = 0;
  let ny = 0;
  let potted = -1;
  let cueRails = 0;
  let objDone = false;
  let evi = 0;
  let ob: { x: number; y: number } | null = null;
  const maxSteps = settings.guides ? 700 : 450;
  for (let i = 0; i < maxSteps && sim.moving; i++) {
    sim.step();
    for (; evi < sim.events.length; evi++) {
      const e = sim.events[evi]!;
      if (e.k === 'ball' && hit < 0 && (e.a === 0 || e.b === 0)) {
        hit = e.a === 0 ? e.b : e.a;
        ghost = { x: cue.x, y: cue.y };
        ob = sim.ball(hit)!;
        const l = Math.hypot(ob.x - cue.x, ob.y - cue.y) || 1;
        nx = (ob.x - cue.x) / l;
        ny = (ob.y - cue.y) / l;
        obj.push([ob.x, ob.y]);
        post.push([cue.x, cue.y]);
      } else if (e.k === 'cushion' && e.a === 0) {
        if (hit < 0) {
          ghost = { x: cue.x, y: cue.y };
          pre.push([cue.x, cue.y]);
          i = maxSteps;
        } else cueRails++;
      } else if (e.k === 'ball' && hit >= 0 && (e.a === 0 || e.b === 0)) {
        // The cue ball's line ends at its next ball.
        cueRails = 2;
        post.push([cue.x, cue.y]);
      } else if (ob && !objDone && ((e.k === 'ball' && (e.a === hit || e.b === hit) && e.a !== 0 && e.b !== 0) || ((e.k === 'cushion' || e.k === 'pocket') && e.a === hit))) {
        // The object ball's line ends at its first cushion, pocket or ball.
        if (e.k === 'pocket') potted = e.pocket;
        obj.push([ob.x, ob.y]);
        objDone = true;
      }
    }
    if (i % 4) continue;
    if (hit < 0) pre.push([cue.x, cue.y]);
    else if (cueRails < 2) post.push([cue.x, cue.y]);
    if (ob && !objDone) obj.push([ob.x, ob.y]);
    if (hit >= 0 && cueRails >= 2 && objDone) break;
  }
  return { key: '', pre, post, obj, ghost, hit, nx, ny, potted };
}

function drawGuides(c: { x: number; y: number }, dx: number, dy: number): void {
  const v = view!;
  const pw = Math.max(0.45, power);
  const key = [c.x, c.y, dx, dy, pw, spinX, spinY, v.seq, settings.guides].map((x) => (typeof x === 'number' ? x.toFixed(4) : String(x))).join(':');
  if (!guide || guide.key !== key) {
    guide = computeGuide(c, dx, dy, pw, spinX, spinY);
    guide.key = key;
  }
  const gd = guide;
  const s = T.s;
  const poly = (pts: Array<[number, number]>, maxLen: number) => {
    if (pts.length < 2) return;
    g.beginPath();
    g.moveTo(T.x(pts[0]![0], pts[0]![1]), T.y(pts[0]![0], pts[0]![1]));
    let len = 0;
    for (let i = 1; i < pts.length && len < maxLen; i++) {
      len += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
      g.lineTo(T.x(pts[i]![0], pts[i]![1]), T.y(pts[i]![0], pts[i]![1]));
    }
    g.stroke();
  };
  const long = settings.guides;
  g.lineCap = 'round';
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = 1.6;
  poly(gd.pre, 9);
  // Ghost ball.
  const legal = gd.hit < 0 || v.targets.includes(gd.hit);
  const gx = T.x(gd.ghost.x, gd.ghost.y);
  const gy = T.y(gd.ghost.x, gd.ghost.y);
  g.strokeStyle = legal ? 'rgba(255,255,255,0.9)' : 'rgba(255,70,70,0.95)';
  g.lineWidth = 1.8;
  g.beginPath();
  g.arc(gx, gy, R * s, 0, Math.PI * 2);
  g.stroke();
  if (!legal) {
    const k = R * s * 0.6;
    g.beginPath();
    g.moveTo(gx - k, gy - k);
    g.lineTo(gx + k, gy + k);
    g.moveTo(gx + k, gy - k);
    g.lineTo(gx - k, gy + k);
    g.stroke();
  }
  callAuto = -1;
  if (gd.hit >= 0) {
    // Object ball to its first cushion / pocket.
    g.strokeStyle = gd.potted >= 0 ? 'rgba(255,214,64,0.9)' : 'rgba(255,255,255,0.75)';
    g.lineWidth = 1.6;
    poly(gd.obj, long ? 9 : 0.22);
    // Cue ball after contact, dashed, through its first cushion.
    g.strokeStyle = 'rgba(255,255,255,0.45)';
    g.setLineDash([4, 4]);
    poly(gd.post, long ? 0.9 : 0.16);
    g.setLineDash([]);
    // Spin arrow at the ghost ball: follow / draw along the aim, side spin as a curl.
    if (spinY || spinX) drawSpinArrow(gx, gy, R * s);
    // Suggest the pocket the 8 is heading for.
    if (gd.hit === 8 && v.onEight) {
      if (gd.potted >= 0) callAuto = gd.potted;
      else {
        const b = gd.obj[0]!;
        let best = -1;
        let bd = -Infinity;
        POCKETS.forEach((p, i) => {
          const ox = p.x - b[0];
          const oy = p.y - b[1];
          const l = Math.hypot(ox, oy);
          const d = (ox * gd.nx + oy * gd.ny) / l;
          if (d > bd) {
            bd = d;
            best = i;
          }
        });
        callAuto = best;
      }
    }
  }
  g.lineCap = 'butt';
}

function drawSpinArrow(gx: number, gy: number, r: number): void {
  const [sdx, sdy] = screenDir(aimDx, aimDy);
  g.strokeStyle = 'rgba(120,200,255,0.95)';
  g.fillStyle = 'rgba(120,200,255,0.95)';
  g.lineWidth = 2;
  if (Math.abs(spinY) > 0.05) {
    // Follow pushes on through the object ball, draw comes back.
    const dir = spinY > 0 ? 1 : -1;
    const len = r * (1.2 + Math.abs(spinY) * 2.5);
    const x0 = gx + sdx * r * 1.15 * dir;
    const y0 = gy + sdy * r * 1.15 * dir;
    const x1 = x0 + sdx * len * dir;
    const y1 = y0 + sdy * len * dir;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
    g.beginPath();
    g.moveTo(x1 + sdx * 5 * dir, y1 + sdy * 5 * dir);
    g.lineTo(x1 - sdy * 4, y1 + sdx * 4);
    g.lineTo(x1 + sdy * 4, y1 - sdx * 4);
    g.closePath();
    g.fill();
  }
  if (Math.abs(spinX) > 0.05) {
    // Side spin: a curl around the ghost ball in the direction it turns (right english = counter-clockwise from above).
    const ccw = (spinX > 0) !== T.rot;
    const a0 = Math.atan2(sdy, sdx) + Math.PI / 2;
    const sweep = (0.9 + Math.abs(spinX)) * (ccw ? 1 : -1);
    g.beginPath();
    g.arc(gx, gy, r * 1.55, a0, a0 + sweep, !ccw);
    g.stroke();
    const ae = a0 + sweep;
    const ex = gx + Math.cos(ae) * r * 1.55;
    const ey = gy + Math.sin(ae) * r * 1.55;
    const tx = -Math.sin(ae) * (ccw ? 1 : -1);
    const ty = Math.cos(ae) * (ccw ? 1 : -1);
    g.beginPath();
    g.moveTo(ex + tx * 5, ey + ty * 5);
    g.lineTo(ex - ty * 4, ey + tx * 4);
    g.lineTo(ex + ty * 4, ey - tx * 4);
    g.closePath();
    g.fill();
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
    const i = POCKETS.findIndex((p) => {
      const h = hole(p);
      return Math.hypot(w.x - h.x, w.y - h.y) < h.r + 0.04;
    });
    if (i >= 0) {
      call = i;
      audio.ui();
      toast('8-ball called — pull the power bar to shoot', 'dim', 1500);
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
addEventListener('keydown', (e) => {
  if (e.code !== 'Escape' || !link || document.activeElement?.tagName === 'INPUT') return;
  if (!$('#rules').classList.contains('hidden')) return $('#rules').classList.add('hidden');
  if (charging) return;
  if ($('#modal').classList.contains('hidden')) openGameMenu();
  else if ($('#modal-panel').querySelector('#gm-resume, #gm-no')) closeModal();
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
  link?.send(a);
  power = 0;
}

// ---------------------------------------------------------------- HUD

/** Caught up with the queue: take the HUD from the view (covers states we never got the events for, e.g. after a reconnect). */
function syncHud(): void {
  const v = view!;
  hud.current = v.phase === 'over' ? hud.current || v.current : v.current;
  for (const p of v.players) hud.groups.set(p.id, p.group);
  hud.over = v.phase === 'over';
  renderHud();
}

/** The HUD follows the displayed table (dballs / hud), not the latest state, so it never spoils a shot. */
function renderHud(): void {
  const v = view;
  if (!v) return;
  v.players.forEach((p, i) => {
    const el = $(`#p${i}`);
    const turn = (hud.current || v.current) === p.id && !hud.over;
    const group: Group | null = hud.groups.get(p.id) ?? null;
    const ids = group === 'solids' ? [1, 2, 3, 4, 5, 6, 7] : group === 'stripes' ? [9, 10, 11, 12, 13, 14, 15] : [];
    const onTable = new Set([...dballs.values()].filter((b) => b.on).map((b) => b.id));
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
  const curId = hud.current || v.current;
  const cur = v.players.find((p) => p.id === curId);
  $('#turn-text').innerHTML = hud.over ? 'GAME OVER' : curId === v.you ? '<b>YOUR SHOT</b>' : `${esc(cur?.name ?? '')}'s shot`;
}

/**
 * Shot clock ring. The engine's clock runs a little longer than shotTime
 * (CLOCK_GRACE) so the ring only starts shrinking once the shot replay is over;
 * the last five seconds tick and flash red.
 */
function renderTimer(): void {
  const v = view!;
  const total = v.rules.shotTime;
  const running = !!total && v.phase === 'aim' && !replay && !busy && !queue.length;
  const left = Math.min(total, Math.max(0, v.shotLeft - (performance.now() - updateAt) / 1000));
  const low = running && left < 5;
  if (low && v.current === v.you) {
    const sec = Math.ceil(left);
    if (sec !== lastTick) {
      lastTick = sec;
      audio.tick();
    }
  }
  for (const el of document.querySelectorAll<HTMLElement>('.pl-side__av.turn')) {
    el.classList.toggle('low', low);
    el.querySelector<HTMLElement>('.pl-timer')!.style.setProperty('--p', running ? String(left / total) : '1');
  }
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
  const pocketName = (i: number) => ['top left', 'top side', 'top right', 'bottom left', 'bottom side', 'bottom right'][T.rot ? [3, 4, 5, 0, 1, 2][i]! : i] ?? '';
  const text = mine
    ? v.onEight
      ? call >= 0
        ? `8-ball called in the ${pocketName(call)} pocket — tap another pocket to change`
        : callAuto >= 0
          ? `8-ball → ${pocketName(callAuto)} pocket (tap a pocket to call a different one)`
          : 'Tap a pocket to call the 8-ball'
      : v.ballInHand
        ? v.kitchen
          ? 'Break! Drag the cue ball behind the line, aim, pull to shoot'
          : 'Ball in hand — drag the cue ball'
        : ''
    : reconnecting
      ? 'Reconnecting…'
      : '';
  hint.classList.toggle('hidden', !text);
  if (hint.textContent !== text) hint.textContent = text;
}

// ---------------------------------------------------------------- messages

function toast(html: string, kind = '', ms = 3500): void {
  const m = $('#msg');
  const el = document.createElement('div');
  el.className = `pl-toast ${kind}`;
  el.innerHTML = html;
  m.prepend(el);
  while (m.children.length > 3) m.lastElementChild!.remove();
  setTimeout(() => el.classList.add('old'), ms);
  setTimeout(() => el.remove(), ms + 1500);
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
  $('#modal-panel').onclick = null;
}

/** Match intro: VS card, a coin flip for the break, then the rack settles. */
let introUp = false;
function showIntro(breaker: string, done: () => void): void {
  introUp = true;
  const v = view!;
  const ps = v.players;
  const card = (p: (typeof ps)[number]) => `<div class="pl-vsc ${p.id === breaker ? 'breaks' : ''}">${avatar(p.avatar)}<b>${esc(p.id === v.you ? 'You' : p.name)}</b><small>${p.bot ? 'BOT' : ''}</small></div>`;
  busy = true;
  const el = document.createElement('div');
  el.className = 'pl-intro';
  el.innerHTML = `<div class="pl-intro__row">${card(ps[0]!)}<div class="pl-coin"><div class="pl-coin__face pl-coin__face--a">${ballIcon(8)}</div><div class="pl-coin__face pl-coin__face--b">${avatar(ps[breaker === ps[0]!.id ? 0 : 1]!.avatar)}</div></div>${card(ps[1]!)}</div><div class="pl-intro__text pl-display">COIN FLIP</div>`;
  document.body.appendChild(el);
  const text = el.querySelector<HTMLElement>('.pl-intro__text')!;
  audio.ui();
  setTimeout(() => {
    text.textContent = breaker === v.you ? 'YOU BREAK' : `${ps.find((p) => p.id === breaker)?.name.toUpperCase() ?? ''} BREAKS`;
    el.classList.add('decided');
    audio.turn();
  }, 1500);
  setTimeout(() => {
    el.classList.add('out');
    audio.rack();
  }, 2500);
  setTimeout(() => {
    el.remove();
    busy = false;
    introUp = false;
    if (link) done();
  }, 2900);
}

/** In-game menu (Esc / "← Arcade"): resume, rules, or leave (to the arcade or this game's menu) with a confirmation. */
function openGameMenu(toArcade = false): void {
  if (!link) return;
  const p = openModal(`<h2 class="pl-display">PAUSED</h2><p class="pl-dim">${link.online ? 'Your shot clock keeps running.' : 'The bot waits for you.'}</p>
    <div class="pl-stack"><button class="pl-btn pl-btn--go" id="gm-resume"><span class="pl-display">RESUME</span></button><button class="pl-btn" id="gm-rules">? Rules</button><button class="pl-btn pl-btn--danger" id="gm-leave">Leave game</button></div>`);
  p.onclick = (e) => {
    const id = (e.target as HTMLElement).closest('button')?.id;
    if (id === 'gm-resume') closeModal();
    if (id === 'gm-rules') $('#rules').classList.remove('hidden');
    if (id === 'gm-leave') confirmLeave(toArcade);
  };
}
function confirmLeave(toArcade: boolean): void {
  const p = openModal(`<h2 class="pl-display">LEAVE THE GAME?</h2><p class="pl-dim">${hud.over ? 'Back to the arcade.' : `You'll forfeit this game${link?.online ? ' and your opponent wins' : ''}.`}</p>
    <div class="pl-two"><button class="pl-btn pl-btn--danger" id="gm-yes">Leave</button><button class="pl-btn" id="gm-no">Stay</button></div>`);
  p.onclick = (e) => {
    const id = (e.target as HTMLElement).closest('button')?.id;
    if (id === 'gm-no') openGameMenu(toArcade);
    if (id === 'gm-yes') {
      toMenu();
      if (toArcade) location.href = '/';
    }
  };
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
  reconnecting = false;
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
  n.onDrop = () => {
    if (net !== n) return;
    reconnecting = true;
    if (link?.online) toast('Connection lost — reconnecting…', 'error', 30000);
    else oStatus('Connection lost — reconnecting…', true);
  };
  n.onReconnect = () => {
    if (net !== n) return;
    reconnecting = false;
    if (link?.online) toast('Reconnected.');
    else oStatus('');
  };
  n.onClosed = (reason) => {
    if (net !== n) return;
    net = null;
    const wasReconnecting = reconnecting;
    reconnecting = false;
    if (link?.online) {
      toast(wasReconnecting ? 'Could not reconnect — the game is lost.' : 'Disconnected.', 'error');
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
  spin(x: number, y: number) {
    spinX = x;
    spinY = y;
  },
  place(x: number, y: number) {
    cuePlace = { x, y };
  },
  setPower(p: number) {
    power = p;
  },
  callPocket(i: number) {
    call = i;
  },
  toScreen(x: number, y: number) {
    return { x: T.x(x, y), y: T.y(x, y) };
  },
  get cuePlace() {
    return cuePlace;
  },
  get replay() {
    return replay;
  },
  get sinking() {
    return sinking.length;
  },
  get foulMark() {
    return foulMark;
  },
  get hud() {
    return hud;
  },
};
