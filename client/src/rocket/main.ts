import './styles.css';
import * as THREE from 'three';
import { RocketRenderer, type Quality } from './render/scene';
import { Input, QUICK_CHAT } from './input';
import { RocketAudio } from './audio';
import { Hud, scoreboardHtml } from './hud';
import { LocalSession, OnlineSession, type Session } from './session';
import { RocketNet } from './net/online';
import { DEFAULT_CAM, type CamSettings } from './render/camera';
import { TEAM_COLORS } from './render/colors';
import { BODIES, type CarBody } from './sim/constants';
import type { BotLevel } from './sim/bot';
import type { WorldEvent } from './sim/world';
import type { RbBegin, RbLobby } from './net/protocol';
import { bindFullscreenButton, installFullscreenKey } from '../ui/fullscreen';

// ============================================================================ settings

interface Settings {
  name: string;
  body: CarBody['id'];
  cam: CamSettings;
  ballCam: boolean;
  quality: Quality;
  volume: number;
  mode: 1 | 2 | 3;
  level: BotLevel;
  team: 0 | 1;
  length: number;
}
const KEY = 'boostball:settings';
const settings: Settings = (() => {
  const d: Settings = { name: 'Player', body: 'octane', cam: { ...DEFAULT_CAM }, ballCam: true, quality: 'high', volume: 0.7, mode: 2, level: 'pro', team: 0, length: 300 };
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
    return { ...d, ...s, cam: { ...d.cam, ...(s.cam ?? {}) } };
  } catch {
    return d;
  }
})();
const save = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* private mode */
  }
};

/** Original names for the three hitbox families. */
const CAR_NAMES: Record<CarBody['id'], { name: string; desc: string }> = {
  octane: { name: 'Vortex', desc: 'Tall all-rounder hitbox. Great for 50/50s and flicks.' },
  dominus: { name: 'Phantom', desc: 'Long, flat hitbox. Powerful shots and dribbles.' },
  breakout: { name: 'Razor', desc: 'Longest, flattest hitbox. Pinches and air dribbles.' },
};

// ============================================================================ DOM

const app = document.getElementById('game')!;
app.innerHTML = `
<div id="view"></div>
<div class="rk-screen" id="menu">
  <div class="rk-brand"><div class="rk-logo">BOOST<span>BALL</span></div><p>Rocket-powered car soccer</p></div>
  <div class="rk-menu-col">
    <label class="rk-name">PLAYER NAME <input id="m-name" maxlength="16" spellcheck="false" /></label>
    <button class="rk-btn primary" id="m-play">▶ PLAY <small>vs bots</small></button>
    <button class="rk-btn" id="m-online">🌐 ONLINE · LAN <small>friends</small></button>
    <button class="rk-btn" id="m-free">⚽ FREE PLAY <small>practice</small></button>
    <button class="rk-btn" id="m-garage">🚗 GARAGE</button>
    <div class="rk-row">
      <button class="rk-btn small" id="m-settings">⚙ SETTINGS</button>
      <button class="rk-btn small" id="m-controls">🎮 CONTROLS</button>
    </div>
    <a class="rk-btn small ghost" href="/">← ARCADE</a>
  </div>
  <div class="rk-pad-status" id="pad-status"></div>
  <button class="rk-chip rk-fs" id="fullscreen"></button>
</div>

<div class="rk-screen hidden" id="setup">
  <div class="rk-panel">
    <h2>EXHIBITION</h2>
    <div class="rk-field"><span>MODE</span><div class="rk-seg" id="s-mode"><button data-v="1">1v1 DUEL</button><button data-v="2">2v2 DOUBLES</button><button data-v="3">3v3 STANDARD</button></div></div>
    <div class="rk-field"><span>BOTS</span><div class="rk-seg" id="s-level"><button data-v="rookie">ROOKIE</button><button data-v="pro">PRO</button><button data-v="allstar">ALL-STAR</button></div></div>
    <div class="rk-field"><span>TEAM</span><div class="rk-seg" id="s-team"><button data-v="0" class="blue">BLUE</button><button data-v="1" class="orange">ORANGE</button></div></div>
    <div class="rk-field"><span>LENGTH</span><div class="rk-seg" id="s-length"><button data-v="120">2 MIN</button><button data-v="180">3 MIN</button><button data-v="300">5 MIN</button><button data-v="600">10 MIN</button></div></div>
    <div class="rk-row end"><button class="rk-btn small ghost" data-back>BACK</button><button class="rk-btn primary" id="s-start">START MATCH</button></div>
  </div>
</div>

<div class="rk-screen hidden" id="garage">
  <div class="rk-panel wide">
    <h2>GARAGE</h2>
    <div class="rk-cars" id="g-cars"></div>
    <p class="rk-note">All three handle identically — only the hitbox shape differs, exactly like the real game.</p>
    <div class="rk-row end"><button class="rk-btn small ghost" data-back>DONE</button></div>
  </div>
</div>

<div class="rk-screen hidden" id="settings">
  <div class="rk-panel wide">
    <h2>SETTINGS</h2>
    <div class="rk-cols">
      <div>
        <h3>CAMERA</h3>
        <div id="cam-sliders"></div>
        <label class="rk-check"><input type="checkbox" id="c-shake" /> Camera shake</label>
        <label class="rk-check"><input type="checkbox" id="c-ballcam" /> Ball cam on at kickoff</label>
        <button class="rk-btn small ghost" id="c-reset">RESET TO DEFAULTS</button>
      </div>
      <div>
        <h3>VIDEO &amp; AUDIO</h3>
        <div class="rk-field"><span>QUALITY</span><div class="rk-seg" id="c-quality"><button data-v="low">LOW</button><button data-v="medium">MEDIUM</button><button data-v="high">HIGH</button></div></div>
        <label class="rk-slider"><span>VOLUME</span><input type="range" min="0" max="1" step="0.05" id="c-volume" /><b id="c-volume-v"></b></label>
      </div>
    </div>
    <div class="rk-row end"><button class="rk-btn small ghost" data-back>DONE</button></div>
  </div>
</div>

<div class="rk-screen hidden" id="controls">
  <div class="rk-panel wide">
    <h2>CONTROLS <small>Rocket League default bindings</small></h2>
    <div class="rk-cols">
      <div><h3>🎮 PS4 CONTROLLER</h3><table class="rk-binds">
        <tr><td>Drive / Reverse</td><td><kbd>R2</kbd> / <kbd>L2</kbd></td></tr>
        <tr><td>Steer · Air pitch &amp; yaw</td><td><kbd>L</kbd> stick</td></tr>
        <tr><td>Jump · Dodge (with stick)</td><td><kbd>✕</kbd></td></tr>
        <tr><td>Boost</td><td><kbd>○</kbd></td></tr>
        <tr><td>Powerslide · Air roll</td><td><kbd>□</kbd> (+ stick)</td></tr>
        <tr><td>Ball cam</td><td><kbd>△</kbd></td></tr>
        <tr><td>Camera swivel</td><td><kbd>R</kbd> stick</td></tr>
        <tr><td>Rear view</td><td><kbd>R3</kbd></td></tr>
        <tr><td>Scoreboard</td><td><kbd>L1</kbd> / touchpad</td></tr>
        <tr><td>Quick chat</td><td><kbd>D-pad</kbd> ×2</td></tr>
        <tr><td>Pause</td><td><kbd>OPTIONS</kbd></td></tr>
      </table></div>
      <div><h3>⌨️ KEYBOARD &amp; MOUSE</h3><table class="rk-binds">
        <tr><td>Drive / Reverse · Air pitch</td><td><kbd>W</kbd> / <kbd>S</kbd></td></tr>
        <tr><td>Steer · Air yaw</td><td><kbd>A</kbd> / <kbd>D</kbd></td></tr>
        <tr><td>Jump · Dodge</td><td><kbd>Right mouse</kbd></td></tr>
        <tr><td>Boost</td><td><kbd>Left mouse</kbd></td></tr>
        <tr><td>Powerslide · Air roll</td><td><kbd>Left Shift</kbd></td></tr>
        <tr><td>Air roll left / right</td><td><kbd>Q</kbd> / <kbd>E</kbd></td></tr>
        <tr><td>Ball cam</td><td><kbd>Space</kbd></td></tr>
        <tr><td>Rear view</td><td><kbd>H</kbd></td></tr>
        <tr><td>Scoreboard</td><td><kbd>Tab</kbd></td></tr>
        <tr><td>Quick chat</td><td><kbd>1</kbd>–<kbd>4</kbd> ×2</td></tr>
        <tr><td>Pause · Fullscreen</td><td><kbd>Esc</kbd> · <kbd>F</kbd></td></tr>
      </table></div>
    </div>
    <p class="rk-note">Mechanics: jump twice for a double jump; jump + stick direction to dodge (front/side/back flip). Flip within 1.25 s of leaving the ground. Touch the ball with all four wheels in the air to get your flip back. Hit someone at supersonic speed to demolish them.</p>
    <div class="rk-row end"><button class="rk-btn small ghost" data-back>DONE</button></div>
  </div>
</div>

<div class="rk-screen hidden" id="online">
  <div class="rk-panel wide">
    <h2 id="o-title">ONLINE PLAY</h2>
    <p class="rk-sub" id="o-sub">Play with friends anywhere — or on the same Wi-Fi with <b>npm run lan</b>.</p>
    <div id="o-connect">
      <div class="rk-row">
        <button class="rk-btn primary" id="o-create">CREATE PRIVATE MATCH</button>
        <button class="rk-btn" id="o-quick">QUICK MATCH</button>
      </div>
      <div class="rk-row"><input id="o-code" placeholder="CODE" maxlength="4" spellcheck="false" /><button class="rk-btn" id="o-join">JOIN</button></div>
      <div class="rk-lan hidden" id="o-lan"><small>OTHER DEVICES OPEN</small><b id="o-lan-url"></b></div>
    </div>
    <div id="o-lobby" class="hidden">
      <div class="rk-code">ROOM <b id="o-code-big"></b><button class="rk-chip" id="o-copy">COPY INVITE</button></div>
      <div class="rk-teams"><div class="rk-team t0"><h3>BLUE</h3><div id="o-t0"></div><button class="rk-btn small" id="o-join0">JOIN BLUE</button></div>
      <div class="rk-team t1"><h3>ORANGE</h3><div id="o-t1"></div><button class="rk-btn small" id="o-join1">JOIN ORANGE</button></div></div>
      <div id="o-host">
        <div class="rk-field"><span>SIZE</span><div class="rk-seg" id="o-size"><button data-v="1">1v1</button><button data-v="2">2v2</button><button data-v="3">3v3</button></div></div>
        <div class="rk-field"><span>BOTS</span><div class="rk-seg" id="o-bots"><button data-v="off">NONE</button><button data-v="rookie">ROOKIE</button><button data-v="pro">PRO</button><button data-v="allstar">ALL-STAR</button></div></div>
        <div class="rk-field"><span>LENGTH</span><div class="rk-seg" id="o-length"><button data-v="120">2 MIN</button><button data-v="180">3 MIN</button><button data-v="300">5 MIN</button><button data-v="600">10 MIN</button></div></div>
      </div>
      <p class="rk-sub" id="o-wait"></p>
      <div class="rk-row end"><button class="rk-btn primary" id="o-start">START MATCH</button></div>
    </div>
    <p class="rk-status" id="o-status"></p>
    <div class="rk-row end"><span class="rk-server" id="o-server"></span><button class="rk-btn small ghost" id="o-back">LEAVE</button></div>
  </div>
</div>

<div class="rk-screen hidden dim" id="pause">
  <div class="rk-panel">
    <h2>PAUSED</h2>
    <div class="rk-menu-col">
      <button class="rk-btn primary" id="p-resume">RESUME</button>
      <button class="rk-btn" id="p-restart">RESTART MATCH</button>
      <button class="rk-btn" id="p-settings">SETTINGS</button>
      <button class="rk-btn" id="p-controls">CONTROLS</button>
      <button class="rk-btn ghost" id="p-leave">LEAVE MATCH</button>
    </div>
  </div>
</div>

<div class="rk-screen hidden dim" id="end">
  <div class="rk-panel wide">
    <div class="rk-result" id="e-result"></div>
    <div class="rk-board end" id="e-board"></div>
    <div class="rk-row end"><button class="rk-btn ghost" id="e-menu">MAIN MENU</button><button class="rk-btn primary" id="e-again">PLAY AGAIN</button></div>
  </div>
</div>
<div class="rk-loading" id="loading"><div class="rk-logo">BOOST<span>BALL</span></div><div class="rk-spin"></div></div>
`;

const $ = <T extends HTMLElement = HTMLElement>(s: string) => app.querySelector<T>(s)!;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

bindFullscreenButton($('#fullscreen'), ['⛶', '⛶']);
installFullscreenKey();

const renderer = new RocketRenderer($('#view'));
const input = new Input($('#view'));
const audio = new RocketAudio();
const hud = new Hud(app);
renderer.cam.settings = settings.cam;
audio.setVolume(settings.volume);
addEventListener('pointerdown', () => audio.unlock(), { capture: true });
addEventListener('keydown', () => audio.unlock(), { capture: true });

// ============================================================================ screens

type ScreenId = 'menu' | 'setup' | 'garage' | 'settings' | 'controls' | 'online' | 'pause' | 'end' | 'game';
let screen: ScreenId = 'menu';
const stack: ScreenId[] = [];
function show(id: ScreenId, push = true): void {
  if (push && screen !== id) stack.push(screen);
  screen = id;
  for (const s of ['menu', 'setup', 'garage', 'settings', 'controls', 'online', 'pause', 'end'] as const) $(`#${s}`).classList.toggle('hidden', s !== id);
  input.active = id === 'game';
  hud.show(!!session && session !== attract && (id === 'game' || id === 'pause'));
  if (id !== 'game') queueMicrotask(() => app.querySelector<HTMLElement>(`#${id} button.primary, #${id} button`)?.focus());
  audio.ui();
}
function back(): void {
  if (screen === 'game') return;
  if (screen === 'pause') return resume();
  if (screen === 'end') return;
  if (screen === 'online') return void leaveOnline();
  const prev = stack.pop() ?? 'menu';
  show(prev, false);
}
app.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', back));

const nameInput = $<HTMLInputElement>('#m-name');
nameInput.value = settings.name;
nameInput.addEventListener('change', () => {
  settings.name = nameInput.value.trim().slice(0, 16) || 'Player';
  save();
});

function seg(sel: string, value: string, onPick: (v: string) => void): void {
  const el = $(sel);
  const sync = (v: string) => el.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  sync(value);
  el.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!b?.dataset.v) return;
    sync(b.dataset.v);
    onPick(b.dataset.v);
  });
}
const setSeg = (sel: string, v: string) => $(sel).querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));

seg('#s-mode', String(settings.mode), (v) => ((settings.mode = Number(v) as 1 | 2 | 3), save()));
seg('#s-level', settings.level, (v) => ((settings.level = v as BotLevel), save()));
seg('#s-team', String(settings.team), (v) => ((settings.team = Number(v) as 0 | 1), save()));
seg('#s-length', String(settings.length), (v) => ((settings.length = Number(v)), save()));

// Garage.
function renderGarage(): void {
  $('#g-cars').innerHTML = (Object.keys(BODIES) as Array<CarBody['id']>)
    .map((id) => {
      const b = BODIES[id];
      const [l, w, h] = b.hitbox;
      return `<button class="rk-car ${settings.body === id ? 'on' : ''}" data-id="${id}">
        <div class="rk-car-art"><img src="data:image/svg+xml,${encodeURIComponent(carSvg(id))}" alt="" /></div>
        <b>${CAR_NAMES[id].name}</b><small>${CAR_NAMES[id].desc}</small>
        <span class="rk-car-hb">HITBOX ${l.toFixed(0)} × ${w.toFixed(0)} × ${h.toFixed(0)}</span></button>`;
    })
    .join('');
}
function carSvg(id: CarBody['id']): string {
  const b = BODIES[id];
  const L = b.hitbox[0];
  const H = b.hitbox[2];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 90"><rect x="${100 - L * 0.6}" y="${60 - H * 1.2}" width="${L * 1.2}" height="${H * 1.2}" rx="14" fill="#3d86ff"/><rect x="${100 - L * 0.25}" y="${60 - H * 1.2 - 14}" width="${L * 0.45}" height="18" rx="8" fill="#9cc2ff"/><circle cx="${100 + b.front.offset[0] * 1.2}" cy="68" r="${b.front.radius}" fill="#222"/><circle cx="${100 + b.back.offset[0] * 1.2}" cy="68" r="${b.back.radius}" fill="#222"/></svg>`;
}
$('#g-cars').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.rk-car');
  if (!b) return;
  settings.body = b.dataset.id as CarBody['id'];
  save();
  renderGarage();
  net?.body(settings.body);
});

// Settings.
const CAM_SLIDERS: Array<[keyof CamSettings, string, number, number, number]> = [
  ['fov', 'FIELD OF VIEW', 60, 110, 1],
  ['distance', 'DISTANCE', 100, 400, 10],
  ['height', 'HEIGHT', 40, 200, 10],
  ['angle', 'ANGLE', -15, 0, 1],
  ['stiffness', 'STIFFNESS', 0, 1, 0.05],
  ['swivel', 'SWIVEL SPEED', 1, 10, 0.1],
  ['transition', 'TRANSITION SPEED', 1, 2, 0.1],
];
function renderSettings(): void {
  $('#cam-sliders').innerHTML = CAM_SLIDERS.map(([k, label, min, max, step]) => `<label class="rk-slider"><span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" data-k="${k}" value="${settings.cam[k]}" /><b>${settings.cam[k]}</b></label>`).join('');
  $<HTMLInputElement>('#c-shake').checked = settings.cam.shake;
  $<HTMLInputElement>('#c-ballcam').checked = settings.ballCam;
  $<HTMLInputElement>('#c-volume').value = String(settings.volume);
  $('#c-volume-v').textContent = `${Math.round(settings.volume * 100)}%`;
  setSeg('#c-quality', settings.quality);
}
$('#cam-sliders').addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement;
  const k = el.dataset.k as keyof CamSettings;
  (settings.cam as unknown as Record<string, number>)[k] = Number(el.value);
  el.nextElementSibling!.textContent = el.value;
  renderer.cam.setAspect(renderer.cam.camera.aspect);
  renderer.resize();
  save();
});
$('#c-shake').addEventListener('change', (e) => ((settings.cam.shake = (e.target as HTMLInputElement).checked), save()));
$('#c-ballcam').addEventListener('change', (e) => ((settings.ballCam = (e.target as HTMLInputElement).checked), save()));
$('#c-volume').addEventListener('input', (e) => {
  settings.volume = Number((e.target as HTMLInputElement).value);
  audio.setVolume(settings.volume);
  $('#c-volume-v').textContent = `${Math.round(settings.volume * 100)}%`;
  save();
});
seg('#c-quality', settings.quality, (v) => {
  settings.quality = v as Quality;
  renderer.setQuality(settings.quality);
  save();
});
$('#c-reset').addEventListener('click', () => {
  Object.assign(settings.cam, DEFAULT_CAM);
  renderer.resize();
  renderSettings();
  save();
});

$('#m-play').addEventListener('click', () => show('setup'));
$('#m-free').addEventListener('click', () => startLocal(true));
$('#m-garage').addEventListener('click', () => (renderGarage(), show('garage')));
$('#m-settings').addEventListener('click', () => (renderSettings(), show('settings')));
$('#m-controls').addEventListener('click', () => show('controls'));
$('#m-online').addEventListener('click', () => void openOnline());
$('#s-start').addEventListener('click', () => startLocal(false));
$('#p-resume').addEventListener('click', () => resume());
$('#p-restart').addEventListener('click', () => (session?.online ? undefined : startLocal(lastFree)));
$('#p-settings').addEventListener('click', () => (renderSettings(), show('settings')));
$('#p-controls').addEventListener('click', () => show('controls'));
$('#p-leave').addEventListener('click', () => leaveMatch());
$('#e-menu').addEventListener('click', () => leaveMatch());
$('#e-again').addEventListener('click', () => (session?.online ? backToLobby() : startLocal(lastFree)));

// ============================================================================ game

let session: Session | null = null;
let attract: LocalSession | null = null;
let lastFree = false;
let endTimer = -1;
let netStats: Map<number, import('./sim/world').Stats> | null = null;

function playerName(id: number): string {
  return session?.world.players.find((p) => p.id === id)?.name ?? '???';
}

function setSession(s: Session): void {
  session?.dispose();
  session = s;
  renderer.setWorld(s.world);
  renderer.cam.ballCam = settings.ballCam;
  renderer.cam.reset();
  endTimer = -1;
  netStats = null;
}

function startAttract(): void {
  attract = new LocalSession({ name: '', body: 'octane', team: 0, size: 2, level: 'allstar', length: 99999, spectate: true });
  setSession(attract);
}

function startLocal(free: boolean): void {
  lastFree = free;
  stack.length = 0;
  setSession(
    new LocalSession({ name: settings.name, body: settings.body, team: free ? 0 : settings.team, size: settings.mode, level: settings.level, length: settings.length, freePlay: free }),
  );
  hud.hint(free ? 'FREE PLAY — goals reset the ball. Esc / OPTIONS to leave.' : '');
  show('game');
}

function resume(): void {
  if (session) session.paused = false;
  show('game', false);
}

function leaveMatch(): void {
  if (session?.online) void leaveOnline();
  stack.length = 0;
  startAttract();
  show('menu', false);
}

function pause(): void {
  if (!session) return;
  if (!session.online) session.paused = true;
  $('#p-restart').classList.toggle('hidden', session.online);
  show('pause');
}

function nearFactor(x: number, y: number, z: number): number {
  const d = renderer.cam.camera.position.distanceTo(new THREE.Vector3(x / 100, z / 100, -y / 100));
  return Math.max(0.15, Math.min(1, 25 / Math.max(1, d)));
}

function onEvent(e: WorldEvent): void {
  const s = session!;
  const w = s.world;
  const watching = s !== attract;
  renderer.onEvent(e, w);
  if (!watching) return;
  switch (e.k) {
    case 'countdown':
      hud.big(`<span class="cd">${e.n}</span>`, 1, 'count');
      audio.countdown(e.n);
      break;
    case 'go':
      hud.big('<span class="cd">GO!</span>', 0.8, 'count go');
      audio.countdown(0);
      break;
    case 'touch':
      audio.hit(e.power, nearFactor(e.x, e.y, e.z));
      if (e.car === s.myId) input.rumble(Math.min(1, e.power / 3000), 0.6, 90);
      break;
    case 'bounce':
      audio.bounce(e.power, nearFactor(e.x, e.y, e.z));
      break;
    case 'jump':
      if (e.car === s.myId) audio.jump();
      break;
    case 'dodge':
      if (e.car === s.myId) audio.dodge();
      break;
    case 'pad':
      if (e.car === s.myId) audio.pad(e.big);
      break;
    case 'bump':
      if (e.car === s.myId || e.other === s.myId) {
        audio.bump();
        input.rumble(0.7, 0.4, 150);
      }
      break;
    case 'demo': {
      const near = nearFactor(e.x, e.y, e.z);
      audio.demo(near);
      hud.feed(`<b class="t${w.car(e.attacker)?.team ?? 0}">${esc(playerName(e.attacker))}</b> 💥 <b class="t${w.car(e.victim)?.team ?? 0}">${esc(playerName(e.victim))}</b>`);
      if (e.victim === s.myId) {
        hud.big('<span class="demo">DEMOLISHED</span>', 2, 'demo');
        input.rumble(1, 1, 400);
      }
      if (near > 0.5) renderer.cam.shake(0.4);
      break;
    }
    case 'goal': {
      audio.goal();
      renderer.cam.shake(1.2);
      input.rumble(1, 1, 600);
      const kph = Math.round(e.speed * 0.036);
      const scorer = e.scorer >= 0 ? playerName(e.scorer) : '';
      const own = e.scorer >= 0 && w.car(e.scorer)?.team !== e.team;
      hud.big(`<span class="goal t${e.team}">GOAL!</span><small>${scorer ? `${esc(scorer)}${own ? ' (own goal)' : ''}` : ''}${e.assist >= 0 ? ` · assist ${esc(playerName(e.assist))}` : ''}</small><small>${kph} KPH</small>`, 3, 'goal');
      if (!w.freePlay) hud.feed(`⚽ <b class="t${e.team}">${esc(scorer || TEAM_COLORS[e.team].name)}</b> scored · ${kph} kph`);
      // Bots are good sports.
      if (!s.online && Math.random() < 0.6) {
        const bot = w.players.find((p) => p.bot && p.team !== e.team);
        if (bot) setTimeout(() => hud.chat(bot.name, bot.team, ['Nice shot!', 'Wow!', 'OMG!', 'Close one!'][Math.floor(Math.random() * 4)]!), 900);
      }
      break;
    }
    case 'overtime':
      hud.big('<span class="ot">OVERTIME</span>', 2.5, 'ot');
      audio.whistle();
      break;
    case 'over':
      audio.whistle();
      endTimer = 2.5;
      break;
  }
}

function showEnd(): void {
  const s = session!;
  const w = s.world;
  const me = w.players.find((p) => p.id === s.myId);
  const won = me ? w.winner === me.team : null;
  $('#e-result').innerHTML = `<div class="rk-result-big ${won === null ? '' : won ? 'win' : 'lose'}">${won === null ? `${TEAM_COLORS[w.winner === 1 ? 1 : 0].name} WINS` : won ? 'VICTORY' : 'DEFEAT'}</div>
    <div class="rk-result-score"><span class="t0">${w.score[0]}</span> – <span class="t1">${w.score[1]}</span></div>`;
  const stats = netStats ?? w.stats;
  const mvp = [...w.players].filter((p) => p.team === w.winner).sort((a, b) => (stats.get(b.id)?.score ?? 0) - (stats.get(a.id)?.score ?? 0))[0];
  $('#e-board').innerHTML = scoreboardHtml(w, s.myId, stats) + (mvp ? `<div class="rk-mvp">⭐ MVP: ${esc(mvp.name)}</div>` : '');
  $('#e-again').textContent = s.online ? 'BACK TO LOBBY' : 'PLAY AGAIN';
  show('end');
}

// ============================================================================ online

let net: RocketNet | null = null;
let lobby: RbLobby | null = null;
let lanUrl: string | null = null;
const oCode = $<HTMLInputElement>('#o-code');
oCode.addEventListener('input', () => (oCode.value = oCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4)));
const oStatus = (t: string, err = false) => {
  $('#o-status').textContent = t;
  $('#o-status').classList.toggle('error', err);
};

async function openOnline(code = ''): Promise<void> {
  settings.name = nameInput.value.trim() || 'Player';
  save();
  show('online');
  $('#o-connect').classList.remove('hidden');
  $('#o-lobby').classList.add('hidden');
  if (code) oCode.value = code.toUpperCase().slice(0, 4);
  oStatus('');
  const probe = new RocketNet();
  $('#o-server').textContent = `Server: ${probe.url.replace(/^wss?:\/\//, '')}`;
  const info = await probe.probe();
  if (!info.ok) oStatus("Can't reach the game server. Run `npm run dev` (or `npm run lan` for home Wi-Fi).", true);
  if (info.lan?.length) {
    const ip = /^(localhost|127\.)/.test(location.hostname) ? info.lan[0] : location.hostname;
    lanUrl = `${location.protocol}//${ip}${location.port ? `:${location.port}` : ''}${location.pathname}`;
    $('#o-title').textContent = 'LAN PLAY';
    $('#o-sub').textContent = 'Same Wi-Fi · server-authoritative at 120 Hz · zero lag';
    $('#o-lan-url').textContent = lanUrl;
    $('#o-lan').classList.remove('hidden');
  }
  if (code) void connect((n) => n.join(code, settings.name, settings.body));
}

async function connect(how: (n: RocketNet) => Promise<void>): Promise<void> {
  if (net?.room) return;
  oStatus('Connecting…');
  const n = new RocketNet();
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
    if (l.phase === 'lobby' && screen === 'end' && session?.online) $('#e-again').removeAttribute('disabled');
  };
  n.onBegin = (b) => startOnline(n, b);
  n.onStats = (s) => {
    netStats = new Map(s);
    if (session?.online) for (const [id, st] of s) session.world.stats.set(id, st);
  };
  n.onChat = (c) => {
    const p = session?.world.players.find((x) => x.id === c.id);
    if (p) {
      hud.chat(p.name, p.team, QUICK_CHAT[c.g]?.[c.i] ?? '');
      audio.chat();
    }
  };
  n.onError = (m) => oStatus(m, true);
  n.onClosed = (reason) => {
    if (net !== n) return;
    net = null;
    if (session?.online) {
      hud.big('<span class="ot">DISCONNECTED</span>', 2);
      setTimeout(leaveMatch, 1500);
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
  for (const t of [0, 1] as const) {
    $(`#o-t${t}`).innerHTML = l.players
      .filter((p) => p.team === t)
      .map((p) => `<div class="rk-lp ${p.id === net!.sessionId ? 'me' : ''}"><b>${p.bot ? '🤖 Bot' : esc(p.name)}</b><small>${p.bot ? l.config.botLevel.toUpperCase() : `${CAR_NAMES[p.body].name}${p.id === l.hostId ? ' · HOST' : ''}${p.connected ? '' : ' · reconnecting'}`}</small></div>`)
      .join('');
  }
  $('#o-host').classList.toggle('hidden', !host || l.phase !== 'lobby');
  setSeg('#o-size', String(l.config.size));
  setSeg('#o-bots', l.config.bots ? l.config.botLevel : 'off');
  setSeg('#o-length', String(l.config.length));
  $('#o-wait').textContent = l.phase === 'playing' ? 'Match in progress…' : l.phase === 'over' ? 'Match finished — back to the lobby shortly…' : host ? 'Pick teams, then start.' : 'Waiting for the host to start…';
  $('#o-start').classList.toggle('hidden', !host || l.phase !== 'lobby');
}

function startOnline(n: RocketNet, b: RbBegin): void {
  const s = new OnlineSession(n, b);
  s.views = () => renderer.cars;
  s.ballErr = renderer.ball.errPos;
  stack.length = 0;
  setSession(s);
  hud.hint('');
  show('game');
}

function backToLobby(): void {
  startAttract();
  stack.length = 0;
  show('online', false);
  $('#o-connect').classList.add('hidden');
  $('#o-lobby').classList.remove('hidden');
  renderLobby();
}

async function leaveOnline(): Promise<void> {
  const n = net;
  net = null;
  lobby = null;
  await n?.leave();
  if (screen === 'online') {
    stack.length = 0;
    show('menu', false);
  }
}

$('#o-create').addEventListener('click', () => void connect((n) => n.create(settings.name, settings.body)));
$('#o-quick').addEventListener('click', () => void connect((n) => n.quick(settings.name, settings.body)));
$('#o-join').addEventListener('click', () => {
  if (oCode.value.length < 4) return oStatus('Room codes have 4 characters.', true);
  void connect((n) => n.join(oCode.value, settings.name, settings.body));
});
oCode.addEventListener('keydown', (e) => e.key === 'Enter' && $('#o-join').click());
$('#o-join0').addEventListener('click', () => net?.team(0));
$('#o-join1').addEventListener('click', () => net?.team(1));
$('#o-size').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (b) net?.config({ size: Number(b.dataset.v) as 1 | 2 | 3 });
});
$('#o-bots').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!b) return;
  net?.config(b.dataset.v === 'off' ? { bots: false } : { bots: true, botLevel: b.dataset.v as BotLevel });
});
$('#o-length').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (b) net?.config({ length: Number(b.dataset.v) });
});
$('#o-start').addEventListener('click', () => net?.start());
$('#o-copy').addEventListener('click', () => {
  const url = `${lanUrl ?? location.origin + location.pathname}?room=${net?.code ?? ''}`;
  void navigator.clipboard?.writeText(url).then(
    () => oStatus('Invite link copied!'),
    () => oStatus(url),
  );
});
$('#o-back').addEventListener('click', () => void leaveOnline());

// ============================================================================ loop

let lastT = performance.now();
let padShown = '';
function loop(now: number): void {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  const s = session;
  if (!s) return;
  const inMatch = screen === 'game' && s !== attract;
  // Menu navigation reads controller edges first (poll() consumes them).
  if (!inMatch) input.pollMenu($(`#${screen === 'game' ? 'menu' : screen}`), back);
  const { controls, ui } = input.poll(dt);
  if (!inMatch && ui.pause && screen !== 'pause') back();
  const playing = inMatch || (screen === 'pause' && s.online);
  if (inMatch) {
    if (ui.pause) return pause();
    if (ui.ballCamToggle) renderer.cam.ballCam = !renderer.cam.ballCam;
    renderer.cam.rearView = ui.rearView;
    renderer.cam.swivelX = ui.swivelX;
    renderer.cam.swivelY = ui.swivelY;
    if (ui.chat) {
      const [g, i] = ui.chat;
      if (s.online) net?.chat(g, i);
      else {
        const me = s.world.players.find((p) => p.id === s.myId);
        if (me) hud.chat(me.name, me.team, QUICK_CHAT[g]![i]!);
        audio.chat();
      }
    }
  } else if (screen === 'pause' && ui.pause) resume();
  const events = s.update(dt, playing ? controls : { throttle: 0, steer: 0, pitch: 0, yaw: 0, roll: 0, jump: false, boost: false, handbrake: false });
  for (const e of events) onEvent(e);
  // Free play: no clock / no end.
  renderer.frame(s.world, s.prev, s.prevBall, s.alpha, dt, s === attract ? null : s.myId);
  if (s !== attract) {
    hud.update(dt, s.world, s.myId, renderer, { scoreboard: ui.scoreboard && inMatch, chatGroup: ui.chatGroup, device: ui.device });
    const me = s.world.car(s.myId);
    const ball = s.world.ball.pos;
    const danger = Math.max(0, 1 - Math.min(Math.abs(ball.y - 5120), Math.abs(ball.y + 5120)) / 3000);
    audio.update(me?.speed ?? 0, controls.throttle, !!me?.isBoosting, !!me?.onGround, danger, playing && !!me && !me.demolished);
    if (endTimer > 0) {
      endTimer -= dt;
      if (endTimer <= 0) showEnd();
    }
  } else audio.silence();
  // Controller status on the menu.
  const pad = input.hasPad ? `🎮 ${input.padName.replace(/\(.*?\)/g, '').trim().slice(0, 40) || 'Controller'} connected` : '🎮 Plug in a PS4 controller (or use keyboard + mouse)';
  if (pad !== padShown && screen === 'menu') $('#pad-status').textContent = padShown = pad;
}

// ============================================================================ boot

(async () => {
  await renderer.init();
  renderer.setQuality(settings.quality);
  startAttract();
  $('#loading').classList.add('hidden');
  show('menu', false);
  const q = new URLSearchParams(location.search);
  if (q.get('room')) void openOnline(q.get('room')!);
  else if (q.has('play')) startLocal(false);
  else if (q.has('free')) startLocal(true);
  requestAnimationFrame(loop);
})();

(window as unknown as Record<string, unknown>).__rk = {
  get session() {
    return session;
  },
  renderer,
  settings,
};
