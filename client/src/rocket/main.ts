import './styles.css';
import * as THREE from 'three';
import { RocketRenderer, type Quality } from './render/scene';
import { BIND_ACTIONS, DEFAULT_PREFS, Input, QUICK_CHAT, keyLabel, padLabel, sanitizePrefs, type BindAction, type InputPrefs } from './input';
import { RocketAudio } from './audio';
import { Hud, scoreboardHtml } from './hud';
import { LocalSession, OnlineSession, type Session } from './session';
import { RocketNet } from './net/online';
import { DEFAULT_CAM, type CamSettings } from './render/camera';
import { TEAM_COLORS } from './render/colors';
import { BODIES, CARS, CAR_IDS, carInfo, type CarId } from './sim/constants';
import { DEFAULT_RULES, REPLAY_EXTRA, sanitizeRules, type Rules } from './sim/rules';
import { GoalReplay } from './replay';
import { DEFAULT_EXPLOSION, type ExplosionFx } from './render/fx';
import { toThree } from './render/arenaMesh';
import type { BotLevel } from './sim/bot';
import type { WorldEvent } from './sim/world';
import type { RbBegin, RbLobby } from './net/protocol';
import { ARENAS, ARENA_IDS, isArenaId, pickArena, type ArenaId } from './arenas';
import { THEMES } from './render/themes';
import { bindFullscreenButton, installFullscreenKey } from '../ui/fullscreen';

// ============================================================================ settings

interface Settings {
  name: string;
  body: CarId;
  cam: CamSettings;
  ballCam: boolean;
  quality: Quality;
  volume: number;
  mode: 1 | 2 | 3;
  level: BotLevel;
  team: 0 | 1;
  length: number;
  /** Mutators for offline matches (game / ball / boost / goal physics). */
  rules: Rules;
  /** Goal explosion look. */
  fx: ExplosionFx;
  /** Bindings, air roll mode, sensitivities. */
  input: InputPrefs;
  /** Arena for exhibition / free play. */
  arena: ArenaId | 'random';
  /** Background music. */
  music: boolean;
  /** Camera shake and punch-in. */
  motion: boolean;
}
const KEY = 'boostball:settings';
const settings: Settings = (() => {
  const d: Settings = { name: 'Player', body: 'octane', cam: { ...DEFAULT_CAM }, ballCam: true, quality: 'high', volume: 0.7, mode: 2, level: 'pro', team: 0, length: 300, rules: { ...DEFAULT_RULES }, fx: { ...DEFAULT_EXPLOSION }, input: sanitizePrefs(undefined), arena: 'dome', music: true, motion: true };
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
    return {
      ...d,
      ...s,
      body: s.body && s.body in CARS ? s.body : 'octane',
      cam: { ...d.cam, ...(s.cam ?? {}) },
      rules: sanitizeRules(s.rules),
      fx: { ...d.fx, ...(s.fx ?? {}) },
      input: sanitizePrefs(s.input),
      arena: s.arena === 'random' || isArenaId(s.arena) ? s.arena : 'dome',
      music: s.music !== false,
      motion: s.motion !== false,
    };
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


// ============================================================================ DOM

/** Arena picker buttons (setup + online lobby). */
const ARENA_SHORT: Record<ArenaId, string> = { dome: 'DOME', mannfield: 'MANNFIELD', urban: 'URBAN', badlands: 'BADLANDS', frosty: 'FROSTY', starbase: 'STARBASE' };
const ARENA_SEG = [...ARENA_IDS.map((id) => `<button data-v="${id}" title="${ARENAS[id].name}">${ARENA_SHORT[id]}</button>`), '<button data-v="random">🎲 RANDOM</button>'].join('');

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
    <div class="rk-field"><span>ARENA</span><div class="rk-seg rk-arenas" id="s-arena">${ARENA_SEG}</div><small class="rk-arena-desc" id="s-arena-desc"></small></div>
    <div class="rk-field"><span>MUTATORS</span><button class="rk-btn small" id="s-rules">⚙ PHYSICS &amp; GOALS <small id="s-rules-sum"></small></button></div>
    <div class="rk-row end"><button class="rk-btn small ghost" data-back>BACK</button><button class="rk-btn primary" id="s-start">START MATCH</button></div>
  </div>
</div>

<div class="rk-screen hidden" id="garage">
  <div class="rk-panel wide">
    <h2>GARAGE</h2>
    <div class="rk-cars" id="g-cars"></div>
    <p class="rk-note">Every car handles identically — only the hitbox family (Octane, Dominus, Plank, Breakout, Hybrid, Merc) changes, exactly like the real game.</p>
    <div class="rk-row end"><button class="rk-btn small ghost" data-back>DONE</button></div>
  </div>
</div>

<div class="rk-screen hidden" id="settings">
  <div class="rk-panel wide">
    <h2>SETTINGS</h2>
    <div class="rk-tabs" id="set-tabs"><button data-tab="cam">CAMERA</button><button data-tab="physics">GAME PHYSICS</button><button data-tab="goals">GOALS &amp; EXPLOSIONS</button><button data-tab="video">VIDEO &amp; AUDIO</button></div>
    <div class="rk-pane" data-pane="cam">
      <div class="rk-field"><span>PRESET</span><div class="rk-seg" id="cam-presets"></div></div>
      <div class="rk-cols">
        <div><h3>CAMERA</h3><div id="cam-fields"></div></div>
        <div><h3>BALL CAM &amp; SWIVEL</h3><div id="cam-fields2"></div>
          <label class="rk-check"><input type="checkbox" id="c-ballcam" /> Ball cam on at kickoff</label></div>
      </div>
      <div class="rk-row end"><button class="rk-btn small ghost" id="c-reset">RESET CAMERA</button></div>
    </div>
    <div class="rk-pane" data-pane="physics">
      <p class="rk-sub">Mutators for exhibition and free play — they apply live, even mid-match. Online matches always use standard rules.</p>
      <div class="rk-cols"><div><h3>GAME &amp; CARS</h3><div id="phys-car"></div></div><div><h3>BALL</h3><div id="phys-ball"></div></div></div>
      <div class="rk-row end"><button class="rk-btn small ghost" id="phys-reset">RESET TO STANDARD</button></div>
    </div>
    <div class="rk-pane" data-pane="goals">
      <div class="rk-cols"><div><h3>GOAL PHYSICS</h3><div id="goal-rules"></div><p class="rk-note">Goal physics apply offline (online uses standard). The explosion look is yours everywhere.</p></div><div><h3>EXPLOSION LOOK</h3><div id="goal-fx"></div></div></div>
      <div class="rk-row end"><button class="rk-btn small ghost" id="goal-reset">RESET</button><button class="rk-btn small" id="goal-preview">💥 PREVIEW</button></div>
    </div>
    <div class="rk-pane" data-pane="video">
      <div class="rk-field"><span>QUALITY</span><div class="rk-seg" id="c-quality"><button data-v="low">LOW</button><button data-v="medium">MEDIUM</button><button data-v="high">HIGH</button></div></div>
      <label class="rk-slider"><span>VOLUME</span><input type="range" min="0" max="1" step="0.05" id="c-volume" /><b id="c-volume-v"></b></label>
      <label class="rk-check"><input type="checkbox" id="c-music" /> Music</label>
      <label class="rk-check"><input type="checkbox" id="c-motion" /> Motion effects (camera shake &amp; punch)</label>
    </div>
    <div class="rk-row end"><button class="rk-btn small ghost" data-back>DONE</button></div>
  </div>
</div>

<div class="rk-screen hidden" id="controls">
  <div class="rk-panel wide">
    <h2>CONTROLS <small>click a binding, then press a key / button · Esc cancels · Backspace clears</small></h2>
    <div class="rk-cols">
      <div><h3>⌨️ KEYBOARD &amp; MOUSE</h3><table class="rk-binds" id="b-kb"></table></div>
      <div><h3>🎮 CONTROLLER</h3><table class="rk-binds" id="b-pad"></table></div>
    </div>
    <p class="rk-status" id="b-status"></p>
    <div class="rk-cols">
      <div><h3>AIR ROLL</h3><div id="ctl-roll"></div><p class="rk-note">AUTO: tap air roll left / right once and the car keeps rolling by itself — tap again (or land) to stop. HOLD: rolls while held. Free air roll (steer to roll) always works too.</p></div>
      <div><h3>SENSITIVITY &amp; DEADZONE</h3><div id="ctl-sens"></div></div>
    </div>
    <p class="rk-note">Fixed: left stick steers / aims in the air, right stick swivels the camera, Esc · P · OPTIONS pause, D-pad / 1–4 quick chat (when not bound). Mechanics: jump twice for a double jump; jump + stick direction to dodge. Flip within 1.25 s of leaving the ground. Touch the ball with your wheels in the air to get your flip back. Hit someone at supersonic speed to demolish them.</p>
    <div class="rk-row end"><button class="rk-btn small ghost" id="b-reset">RESET TO DEFAULTS</button><button class="rk-btn small ghost" data-back>DONE</button></div>
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
        <div class="rk-field"><span>ARENA</span><div class="rk-seg rk-arenas" id="o-arena">${ARENA_SEG}</div></div>
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
    <div class="rk-quick"><label class="rk-check"><input type="checkbox" id="p-ballcam" /> Ball cam</label><label class="rk-check"><input type="checkbox" id="p-invert" /> Invert camera swivel</label></div>
  </div>
</div>

<div class="rk-screen hidden dim" id="end">
  <div class="rk-panel wide">
    <div class="rk-result" id="e-result"></div>
    <div class="rk-board end" id="e-board"></div>
    <div class="rk-row end"><button class="rk-btn ghost" id="e-menu">MAIN MENU</button><button class="rk-btn primary" id="e-again">PLAY AGAIN</button></div>
  </div>
</div>
<div class="rk-autoroll hidden" id="autoroll"></div>
<div class="rk-replay hidden" id="replay"><div class="rk-replay-tag"><i></i>REPLAY</div><div class="rk-replay-by" id="replay-by"></div><div class="rk-replay-skip" id="replay-skip"></div></div>
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
renderer.cam.motion = settings.motion;
renderer.fx.explosion = settings.fx;
audio.setVolume(settings.volume);
audio.setMusicEnabled(settings.music);
addEventListener('pointerdown', () => audio.unlock(), { capture: true });
addEventListener('keydown', () => audio.unlock(), { capture: true });

// ============================================================================ screens

type ScreenId = 'menu' | 'setup' | 'garage' | 'settings' | 'controls' | 'online' | 'pause' | 'end' | 'game';
let screen: ScreenId = 'menu';
const stack: ScreenId[] = [];
function show(id: ScreenId, push = true): void {
  input.capture = null;
  if (id !== 'game') $('#autoroll').classList.add('hidden'), (autoRollShown = 0);
  if (push && screen !== id) stack.push(screen);
  screen = id;
  for (const s of ['menu', 'setup', 'garage', 'settings', 'controls', 'online', 'pause', 'end'] as const) $(`#${s}`).classList.toggle('hidden', s !== id);
  input.active = id === 'game';
  hud.show(!!session && session !== attract && (id === 'game' || id === 'pause'));
  audio.music(id === 'game' && session && session !== attract ? 'match' : id === 'pause' ? 'match' : 'menu');
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
const arenaDesc = (v: ArenaId | 'random') => (v === 'random' ? 'A different arena every match.' : `${ARENAS[v].name} — ${ARENAS[v].desc}`);
$('#s-arena-desc').textContent = arenaDesc(settings.arena);
seg('#s-arena', settings.arena, (v) => {
  settings.arena = v as ArenaId | 'random';
  $('#s-arena-desc').textContent = arenaDesc(settings.arena);
  save();
});

// Garage.
let thumbs: Map<CarId, string> | null = null;
function renderGarage(): void {
  thumbs ??= renderer.carThumbs(0);
  $('#g-cars').innerHTML = CAR_IDS.map((id) => {
    const c = CARS[id];
    const hb = BODIES[c.hitbox];
    const [l, w, h] = hb.hitbox;
    return `<button class="rk-car ${settings.body === id ? 'on' : ''}" data-id="${id}">
        <div class="rk-car-art"><img src="${thumbs!.get(id) ?? ''}" alt="" /></div>
        <b>${c.name}</b><small>${c.desc}</small>
        <span class="rk-car-hb">${hb.name.toUpperCase()} HITBOX · ${l.toFixed(0)} × ${w.toFixed(0)} × ${h.toFixed(0)}</span></button>`;
  }).join('');
}
$('#g-cars').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.rk-car');
  if (!b) return;
  settings.body = b.dataset.id as CarId;
  save();
  renderGarage();
  net?.body(settings.body);
});

// ---------------------------------------------------------------- option fields

type Field = { k: string; label: string } & ({ t: 'range'; min: number; max: number; step: number; unit?: string } | { t: 'seg'; opts: Array<[string, string]> } | { t: 'check' });
type Obj = Record<string, unknown>;

function fmt(f: Field & { t: 'range' }, v: number): string {
  const dec = f.step >= 1 ? 0 : f.step >= 0.1 ? 1 : 2;
  return `${v.toFixed(dec)}${f.unit ?? ''}`;
}
function fieldsHtml(fields: Field[], obj: Obj): string {
  return fields
    .map((f) => {
      const v = obj[f.k];
      if (f.t === 'range') return `<label class="rk-slider"><span>${f.label}</span><input type="range" min="${f.min}" max="${f.max}" step="${f.step}" data-k="${f.k}" value="${v}" /><b>${fmt(f, v as number)}</b></label>`;
      if (f.t === 'check') return `<label class="rk-check"><input type="checkbox" data-k="${f.k}" ${v ? 'checked' : ''} /> ${f.label}</label>`;
      return `<div class="rk-field"><span>${f.label}</span><div class="rk-seg" data-k="${f.k}">${f.opts.map(([val, l]) => `<button data-v="${val}" class="${String(v) === val ? 'on' : ''}">${l}</button>`).join('')}</div></div>`;
    })
    .join('');
}
/** Render fields into a container and keep `obj` in sync (re-rendering on demand). */
function mountFields(sel: string, fields: Field[], obj: () => Obj, onChange: () => void): () => void {
  const el = $(sel);
  const render = () => (el.innerHTML = fieldsHtml(fields, obj()));
  const byKey = new Map(fields.map((f) => [f.k, f]));
  el.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    const f = byKey.get(t.dataset.k ?? '');
    if (!f || f.t !== 'range') return;
    obj()[f.k] = Number(t.value);
    t.nextElementSibling!.textContent = fmt(f, Number(t.value));
    onChange();
  });
  el.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    const f = byKey.get(t.dataset.k ?? '');
    if (!f || f.t !== 'check') return;
    obj()[f.k] = t.checked;
    onChange();
  });
  el.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.rk-seg button');
    const segEl = b?.parentElement;
    const f = byKey.get(segEl?.dataset.k ?? '');
    if (!b || !f || f.t !== 'seg') return;
    obj()[f.k] = b.dataset.v;
    segEl!.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    onChange();
  });
  render();
  return render;
}

// ---------------------------------------------------------------- settings: camera

const X = '×';
const CAM_FIELDS: Field[] = [
  { k: 'fov', label: 'FIELD OF VIEW', t: 'range', min: 60, max: 110, step: 1 },
  { k: 'distance', label: 'DISTANCE', t: 'range', min: 100, max: 400, step: 10 },
  { k: 'height', label: 'HEIGHT', t: 'range', min: 40, max: 200, step: 10 },
  { k: 'angle', label: 'ANGLE', t: 'range', min: -15, max: 0, step: 1 },
  { k: 'stiffness', label: 'STIFFNESS', t: 'range', min: 0, max: 1, step: 0.05 },
  { k: 'shake', label: 'Camera shake', t: 'check' },
];
const CAM_FIELDS2: Field[] = [
  { k: 'swivel', label: 'SWIVEL SPEED', t: 'range', min: 1, max: 10, step: 0.1 },
  { k: 'transition', label: 'TRANSITION SPEED', t: 'range', min: 1, max: 2, step: 0.1 },
  { k: 'ballCamMode', label: 'BALL CAM BUTTON', t: 'seg', opts: [['toggle', 'TOGGLE'], ['hold', 'HOLD']] },
  { k: 'invertX', label: 'Invert swivel horizontal', t: 'check' },
  { k: 'invertY', label: 'Invert swivel vertical', t: 'check' },
];
const CAM_PRESETS: Array<[string, Partial<CamSettings>]> = [
  ['DEFAULT', { fov: 110, distance: 270, height: 100, angle: -4, stiffness: 0.45, swivel: 2.5, transition: 1.2 }],
  ['PRO', { fov: 110, distance: 270, height: 100, angle: -3, stiffness: 0.5, swivel: 5, transition: 1.2 }],
  ['CLOSE', { fov: 105, distance: 240, height: 90, angle: -3, stiffness: 0.55, swivel: 4, transition: 1.3 }],
  ['WIDE', { fov: 110, distance: 310, height: 110, angle: -5, stiffness: 0.35, swivel: 4, transition: 1.2 }],
  ['HIGH', { fov: 108, distance: 280, height: 140, angle: -7, stiffness: 0.45, swivel: 4, transition: 1.4 }],
];
const camChanged = () => {
  renderer.resize();
  save();
};
const renderCam = mountFields('#cam-fields', CAM_FIELDS, () => settings.cam as unknown as Obj, camChanged);
const renderCam2 = mountFields('#cam-fields2', CAM_FIELDS2, () => settings.cam as unknown as Obj, camChanged);
$('#cam-presets').innerHTML = CAM_PRESETS.map(([n], i) => `<button data-i="${i}">${n}</button>`).join('');
$('#cam-presets').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!b) return;
  Object.assign(settings.cam, CAM_PRESETS[Number(b.dataset.i)]![1]);
  renderCam();
  renderCam2();
  camChanged();
});
$('#c-ballcam').addEventListener('change', (e) => ((settings.ballCam = (e.target as HTMLInputElement).checked), save()));
$('#c-reset').addEventListener('click', () => {
  Object.assign(settings.cam, DEFAULT_CAM);
  renderCam();
  renderCam2();
  camChanged();
});

// ---------------------------------------------------------------- settings: physics & goals (mutators)

const PHYS_CAR: Field[] = [
  { k: 'gameSpeed', label: 'GAME SPEED', t: 'range', min: 0.5, max: 1.5, step: 0.05, unit: X },
  { k: 'gravity', label: 'GRAVITY', t: 'range', min: 0.25, max: 2.5, step: 0.05, unit: X },
  { k: 'boostMode', label: 'BOOST AMOUNT', t: 'seg', opts: [['default', 'DEFAULT'], ['unlimited', 'UNLIMITED'], ['none', 'NO BOOST']] },
  { k: 'boostStrength', label: 'BOOST STRENGTH', t: 'range', min: 0.5, max: 3, step: 0.05, unit: X },
  { k: 'padSize', label: 'BOOST PAD SIZE', t: 'range', min: 0.5, max: 2, step: 0.05, unit: X },
  { k: 'jumpHeight', label: 'JUMP HEIGHT', t: 'range', min: 0.5, max: 2.5, step: 0.05, unit: X },
  { k: 'airControl', label: 'AIR CONTROL', t: 'range', min: 0.5, max: 2, step: 0.05, unit: X },
  { k: 'bumpStrength', label: 'BUMP STRENGTH', t: 'range', min: 0, max: 3, step: 0.1, unit: X },
  { k: 'demolish', label: 'DEMOLISH', t: 'seg', opts: [['default', 'DEFAULT'], ['disabled', 'OFF'], ['friendly', 'FRIENDLY FIRE'], ['contact', 'ON CONTACT']] },
  { k: 'respawnTime', label: 'RESPAWN TIME', t: 'range', min: 0.5, max: 10, step: 0.5, unit: 's' },
];
const PHYS_BALL: Field[] = [
  { k: 'ballSize', label: 'BALL SIZE', t: 'range', min: 0.5, max: 2.5, step: 0.05, unit: X },
  { k: 'ballWeight', label: 'BALL WEIGHT', t: 'range', min: 0.25, max: 3, step: 0.05, unit: X },
  { k: 'ballBounce', label: 'BOUNCINESS', t: 'range', min: 0, max: 1, step: 0.05 },
  { k: 'ballMaxSpeed', label: 'MAX BALL SPEED', t: 'range', min: 2000, max: 12000, step: 100 },
  { k: 'ballDrag', label: 'AIR RESISTANCE', t: 'range', min: 0, max: 3, step: 0.1, unit: X },
  { k: 'hitPower', label: 'HIT POWER', t: 'range', min: 0.25, max: 3, step: 0.05, unit: X },
];
const GOAL_RULES: Field[] = [
  { k: 'goalDelay', label: 'RESET DELAY', t: 'range', min: 1, max: 8, step: 0.5, unit: 's' },
  { k: 'explosionForce', label: 'BLAST FORCE', t: 'range', min: 0, max: 3, step: 0.1, unit: X },
  { k: 'explosionRadius', label: 'BLAST RADIUS', t: 'range', min: 400, max: 3000, step: 50 },
  { k: 'explosionDemos', label: 'Blast demolishes cars near the ball', t: 'check' },
  { k: 'replayTime', label: 'GOAL REPLAY (0 = OFF)', t: 'range', min: 0, max: 10, step: 0.5, unit: 's' },
];
const GOAL_FX: Field[] = [
  { k: 'style', label: 'STYLE', t: 'seg', opts: [['classic', 'CLASSIC'], ['fireworks', 'FIREWORKS'], ['shockwave', 'SHOCKWAVE'], ['vortex', 'VORTEX'], ['none', 'NONE']] },
  { k: 'color', label: 'COLOR', t: 'seg', opts: [['team', 'TEAM'], ['gold', 'GOLD'], ['rainbow', 'RAINBOW'], ['white', 'WHITE']] },
  { k: 'size', label: 'SIZE', t: 'range', min: 0.5, max: 2.5, step: 0.05, unit: X },
  { k: 'density', label: 'PARTICLES', t: 'range', min: 0.25, max: 2, step: 0.05, unit: X },
  { k: 'shake', label: 'SCREEN SHAKE', t: 'range', min: 0, max: 2, step: 0.1, unit: X },
];
const rulesObj = () => settings.rules as unknown as Obj;
const rulesChanged = () => (save(), renderRulesSummary());
const renderPhysCar = mountFields('#phys-car', PHYS_CAR, rulesObj, rulesChanged);
const renderPhysBall = mountFields('#phys-ball', PHYS_BALL, rulesObj, rulesChanged);
const renderGoalRules = mountFields('#goal-rules', GOAL_RULES, rulesObj, rulesChanged);
const renderGoalFx = mountFields('#goal-fx', GOAL_FX, () => settings.fx as unknown as Obj, save);
const PHYS_KEYS = [...PHYS_CAR, ...PHYS_BALL].map((f) => f.k as keyof Rules);
$('#phys-reset').addEventListener('click', () => {
  for (const k of PHYS_KEYS) (settings.rules as unknown as Obj)[k] = DEFAULT_RULES[k];
  renderPhysCar();
  renderPhysBall();
  rulesChanged();
});
$('#goal-reset').addEventListener('click', () => {
  for (const f of GOAL_RULES) (settings.rules as unknown as Obj)[f.k] = DEFAULT_RULES[f.k as keyof Rules];
  Object.assign(settings.fx, DEFAULT_EXPLOSION);
  renderGoalRules();
  renderGoalFx();
  rulesChanged();
});
$('#goal-preview').addEventListener('click', () => {
  // Fade the panel out for a moment and blow up the ball on screen.
  const at = toThree(renderer.ballPos.x, renderer.ballPos.y, renderer.ballPos.z);
  renderer.fx.goal(at, settings.team, 3000);
  audio.goal(settings.team);
  if (settings.fx.shake > 0 && settings.cam.shake) renderer.cam.shake(1.2 * settings.fx.shake);
  $('#settings').classList.add('peek');
  setTimeout(() => $('#settings').classList.remove('peek'), 2600);
});
function renderRulesSummary(): void {
  const n = (Object.keys(DEFAULT_RULES) as Array<keyof Rules>).filter((k) => settings.rules[k] !== DEFAULT_RULES[k]).length;
  $('#s-rules-sum').textContent = n ? `${n} CUSTOM` : 'STANDARD';
}
renderRulesSummary();

// ---------------------------------------------------------------- settings: video & tabs

function renderSettings(): void {
  $<HTMLInputElement>('#c-ballcam').checked = settings.ballCam;
  $<HTMLInputElement>('#c-music').checked = settings.music;
  $<HTMLInputElement>('#c-motion').checked = settings.motion;
  $<HTMLInputElement>('#c-volume').value = String(settings.volume);
  $('#c-volume-v').textContent = `${Math.round(settings.volume * 100)}%`;
  setSeg('#c-quality', settings.quality);
  renderCam();
  renderCam2();
  renderPhysCar();
  renderPhysBall();
  renderGoalRules();
  renderGoalFx();
}
$('#c-volume').addEventListener('input', (e) => {
  settings.volume = Number((e.target as HTMLInputElement).value);
  audio.setVolume(settings.volume);
  $('#c-volume-v').textContent = `${Math.round(settings.volume * 100)}%`;
  save();
});
$('#c-music').addEventListener('change', (e) => {
  settings.music = (e.target as HTMLInputElement).checked;
  audio.setMusicEnabled(settings.music);
  save();
});
$('#c-motion').addEventListener('change', (e) => {
  settings.motion = (e.target as HTMLInputElement).checked;
  renderer.cam.motion = settings.motion;
  save();
});
$('#p-ballcam').addEventListener('change', (e) => {
  settings.ballCam = renderer.cam.ballCam = (e.target as HTMLInputElement).checked;
  save();
});
$('#p-invert').addEventListener('change', (e) => {
  settings.cam.invertX = settings.cam.invertY = (e.target as HTMLInputElement).checked;
  save();
});
seg('#c-quality', settings.quality, (v) => {
  settings.quality = v as Quality;
  renderer.setQuality(settings.quality);
  save();
});
let settingsTab = 'cam';
function setTab(tab: string): void {
  settingsTab = tab;
  $('#set-tabs').querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  app.querySelectorAll<HTMLElement>('#settings .rk-pane').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== tab));
}
$('#set-tabs').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (b?.dataset.tab) setTab(b.dataset.tab);
});
function openSettings(tab = settingsTab): void {
  renderSettings();
  setTab(tab);
  show('settings');
}
setTab('cam');

// ---------------------------------------------------------------- controls: rebinding

/** Actions that may share a bind (W drives and pitches; one button powerslides and air rolls). */
const SHARED: BindAction[][] = [
  ['throttle', 'pitchDown'],
  ['reverse', 'pitchUp'],
  ['powerslide', 'airRoll'],
];
const canShare = (a: BindAction, b: BindAction) => SHARED.some((g) => g.includes(a) && g.includes(b));
input.prefs = settings.input;

function bindCell(dev: 'kb' | 'pad', a: BindAction, i: number): string {
  const v = settings.input.binds[dev][a][i];
  const label = v == null || v === '' ? '—' : dev === 'kb' ? keyLabel(v as string) : padLabel(v as number);
  return `<button class="rk-bind ${v == null ? 'empty' : ''}" data-dev="${dev}" data-a="${a}" data-i="${i}">${esc(label)}</button>`;
}
function renderBinds(): void {
  $('#b-kb').innerHTML = BIND_ACTIONS.map((a) => `<tr><td>${a.label}</td><td>${bindCell('kb', a.id, 0)}${bindCell('kb', a.id, 1)}</td></tr>`).join('');
  $('#b-pad').innerHTML =
    BIND_ACTIONS.filter((a) => a.pad)
      .map((a) => `<tr><td>${a.label}</td><td>${bindCell('pad', a.id, 0)}${bindCell('pad', a.id, 1)}</td></tr>`)
      .join('') + `<tr><td>Steer · Air pitch &amp; yaw</td><td><kbd>L</kbd> stick</td></tr><tr><td>Camera swivel</td><td><kbd>R</kbd> stick</td></tr>`;
}
function setBind(dev: 'kb' | 'pad', a: BindAction, i: number, v: string | number | null): void {
  const binds = settings.input.binds[dev] as Record<BindAction, Array<string | number>>;
  if (v === null) return;
  const list = binds[a];
  if (v === '' || v === -1) list.splice(i, 1);
  else {
    // Take the key away from actions it can't share with.
    for (const other of BIND_ACTIONS) {
      if (other.id === a || canShare(a, other.id)) continue;
      const j = binds[other.id].indexOf(v);
      if (j >= 0) {
        binds[other.id].splice(j, 1);
        $('#b-status').textContent = `${dev === 'kb' ? keyLabel(v as string) : padLabel(v as number)} was unbound from “${other.label}”.`;
      }
    }
    const dup = list.indexOf(v);
    if (dup >= 0 && dup !== i) list.splice(dup, 1);
    list[Math.min(i, list.length)] = v;
  }
  save();
}
app.querySelector('#controls')!.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.rk-bind');
  if (!b) return;
  const dev = b.dataset.dev as 'kb' | 'pad';
  const a = b.dataset.a as BindAction;
  const i = Number(b.dataset.i);
  if (dev === 'pad' && !input.hasPad) {
    $('#b-status').textContent = 'Connect a controller and press any button on it first.';
    return;
  }
  app.querySelectorAll('.rk-bind.wait').forEach((x) => x.classList.remove('wait'));
  b.classList.add('wait');
  b.textContent = dev === 'kb' ? 'PRESS A KEY…' : 'PRESS A BUTTON…';
  $('#b-status').textContent = dev === 'kb' ? 'Press a key or mouse button · Esc cancels · Backspace clears' : 'Press a controller button · OPTIONS / Esc cancels';
  input.capture =
    dev === 'kb'
      ? { kind: 'kb', done: (code) => (setBind('kb', a, i, code), renderBinds()) }
      : { kind: 'pad', done: (btn) => (setBind('pad', a, i, btn), renderBinds()) };
});
const ROLL_FIELDS: Field[] = [{ k: 'airRollMode', label: 'AIR ROLL LEFT / RIGHT BUTTONS', t: 'seg', opts: [['hold', 'HOLD'], ['toggle', 'AUTO (TAP ON / OFF)']] }];
const SENS_FIELDS: Field[] = [
  { k: 'steerSens', label: 'STEERING SENS.', t: 'range', min: 0.1, max: 3, step: 0.05, unit: X },
  { k: 'aerialSens', label: 'AERIAL SENS.', t: 'range', min: 0.1, max: 3, step: 0.05, unit: X },
  { k: 'deadzone', label: 'STICK DEADZONE', t: 'range', min: 0, max: 0.5, step: 0.01 },
  { k: 'dodgeDeadzone', label: 'DODGE DEADZONE', t: 'range', min: 0.1, max: 0.9, step: 0.01 },
  { k: 'vibration', label: 'Controller vibration', t: 'check' },
];
const renderRoll = mountFields('#ctl-roll', ROLL_FIELDS, () => settings.input as unknown as Obj, save);
const renderSens = mountFields('#ctl-sens', SENS_FIELDS, () => settings.input as unknown as Obj, save);
$('#b-reset').addEventListener('click', () => {
  Object.assign(settings.input, sanitizePrefs(DEFAULT_PREFS));
  input.capture = null;
  $('#b-status').textContent = 'Controls reset to defaults.';
  renderBinds();
  renderRoll();
  renderSens();
  save();
});
function openControls(): void {
  $('#b-status').textContent = '';
  renderBinds();
  renderRoll();
  renderSens();
  show('controls');
}

$('#m-play').addEventListener('click', () => show('setup'));
$('#m-free').addEventListener('click', () => void startLocal(true));
$('#m-garage').addEventListener('click', () => (renderGarage(), show('garage')));
$('#m-settings').addEventListener('click', () => openSettings());
$('#m-controls').addEventListener('click', () => openControls());
$('#s-rules').addEventListener('click', () => openSettings('physics'));
$('#m-online').addEventListener('click', () => void openOnline());
$('#s-start').addEventListener('click', () => void startLocal(false));
$('#p-resume').addEventListener('click', () => resume());
$('#p-restart').addEventListener('click', () => (session?.online ? undefined : void startLocal(lastFree)));
$('#p-settings').addEventListener('click', () => openSettings());
$('#p-controls').addEventListener('click', () => openControls());
$('#p-leave').addEventListener('click', () => leaveMatch());
$('#e-menu').addEventListener('click', () => leaveMatch());
$('#e-again').addEventListener('click', () => (session?.online ? backToLobby() : void startLocal(lastFree)));

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
  endReplay();
  replayedGoal = -1;
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

/** Build the arena behind the loading overlay (≈ 0.5 s for a new one; instant when it's already up). */
let building: Promise<void> | null = null;
async function ensureArena(id: ArenaId): Promise<void> {
  audio.setAmbience(THEMES[id].ambience);
  if (renderer.currentArena === id) return;
  const loading = $('#loading');
  loading.classList.remove('hidden');
  await renderer.setArena(id);
  renderer.warm();
  loading.classList.add('hidden');
}
/** Run one arena build at a time (double clicks, quick restarts). */
async function withArena(id: ArenaId): Promise<boolean> {
  if (building) return false;
  building = ensureArena(id);
  try {
    await building;
  } finally {
    building = null;
  }
  return true;
}

async function startLocal(free: boolean): Promise<void> {
  if (!(await withArena(pickArena(settings.arena)))) return;
  lastFree = free;
  stack.length = 0;
  setSession(
    new LocalSession({ name: settings.name, body: settings.body, team: free ? 0 : settings.team, size: settings.mode, level: settings.level, length: settings.length, freePlay: free, rules: settings.rules }),
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
  $<HTMLInputElement>('#p-ballcam').checked = renderer.cam.ballCam;
  $<HTMLInputElement>('#p-invert').checked = settings.cam.invertX && settings.cam.invertY;
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
      audio.roar();
      renderer.cam.punch(0.04);
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
      if (e.car === s.myId) {
        audio.pad(e.big);
        hud.pad(e.big);
      }
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
      if (e.attacker >= 0) hud.feed(`<b class="t${w.car(e.attacker)?.team ?? 0}">${esc(playerName(e.attacker))}</b> 💥 <b class="t${w.car(e.victim)?.team ?? 0}">${esc(playerName(e.victim))}</b>`);
      else hud.feed(`💥 <b class="t${w.car(e.victim)?.team ?? 0}">${esc(playerName(e.victim))}</b> caught in the goal explosion`);
      if (e.victim === s.myId) {
        hud.big('<span class="demo">DEMOLISHED</span>', 2, 'demo');
        input.rumble(1, 1, 400);
      }
      if (near > 0.5) renderer.cam.shake(0.4);
      break;
    }
    case 'goal': {
      audio.goal(e.team);
      if (settings.fx.shake > 0) renderer.cam.shake(1.2 * settings.fx.shake);
      input.rumble(1, 1, 600);
      const kph = Math.round(e.speed * 0.036);
      const scorer = e.scorer >= 0 ? playerName(e.scorer) : '';
      lastGoal = { scorer: e.scorer, team: e.team, kph, name: scorer };
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
  // Match titles: the best at each stat (ties go to the higher score).
  const best = (k: 'saves' | 'assists' | 'demos') => {
    const p = [...w.players].sort((a, b) => (stats.get(b.id)?.[k] ?? 0) - (stats.get(a.id)?.[k] ?? 0) || (stats.get(b.id)?.score ?? 0) - (stats.get(a.id)?.score ?? 0))[0];
    return p && (stats.get(p.id)?.[k] ?? 0) > 0 ? p : undefined;
  };
  const titles: Array<[string, string, (typeof w.players)[number] | undefined]> = [
    ['⭐', 'MVP', mvp],
    ['🧤', 'SAVIOUR', best('saves')],
    ['🎯', 'PLAYMAKER', best('assists')],
    ['💥', 'DEMOLISHER', best('demos')],
  ];
  const titleHtml = titles
    .filter(([, , p]) => p)
    .map(([icon, name, p]) => `<div class="rk-title t${p!.team}"><i>${icon}</i><small>${name}</small><b>${esc(p!.name)}</b></div>`)
    .join('');
  $('#e-board').innerHTML = scoreboardHtml(w, s.myId, stats) + (titleHtml ? `<div class="rk-titles">${titleHtml}</div>` : '');
  $('#e-again').textContent = s.online ? 'BACK TO LOBBY' : 'PLAY AGAIN';
  show('end');
}

// ============================================================================ goal replay

let replay: GoalReplay | null = null;
let replayedGoal = -1;
let lastGoal = { scorer: -1, team: 0 as 0 | 1, kph: 0, name: '' };
let replayJumpHeld = true;
let ballCamBeforeReplay = true;

/** Start the replay once the explosion has played (the goal phase runs on for it). */
function maybeStartReplay(s: Session): void {
  const w = s.world;
  if (replay || s === attract || w.freePlay || w.phase !== 'goal' || w.rules.replayTime <= 0) return;
  if (w.phaseTimer > w.rules.replayTime + REPLAY_EXTRA) return;
  const gt = s.recorder.goalTick();
  if (gt <= 0 || gt === replayedGoal) return;
  replayedGoal = gt;
  replay = new GoalReplay(s.recorder, w, gt, w.rules.replayTime, lastGoal.scorer);
  ballCamBeforeReplay = renderer.cam.ballCam;
  renderer.cam.ballCam = true;
  renderer.cam.rearView = false;
  renderer.cam.swivelX = renderer.cam.swivelY = 0;
  renderer.cam.reset();
  replayJumpHeld = true;
  renderer.resetTracking();
  hud.replay(true);
  const by = lastGoal.name ? `<b class="t${lastGoal.team}">${esc(lastGoal.name)}</b>` : `<b class="t${lastGoal.team}">${TEAM_COLORS[lastGoal.team].name}</b>`;
  $('#replay-by').innerHTML = `GOAL BY ${by} · ${lastGoal.kph} KPH`;
  const b = settings.input.binds;
  const key = input.device === 'pad' ? (b.pad.jump[0] != null ? padLabel(b.pad.jump[0]) : '') : b.kb.jump[0] ? keyLabel(b.kb.jump[0]) : '';
  $('#replay-skip').innerHTML = key ? `<kbd>${esc(key)}</kbd> SKIP` : '';
  $('#replay').classList.remove('hidden');
}

function endReplay(): void {
  if (!replay) return;
  replay = null;
  renderer.cam.ballCam = ballCamBeforeReplay;
  renderer.cam.reset();
  renderer.resetTracking();
  $('#replay').classList.add('hidden');
  hud.replay(false);
  hud.show(!!session && session !== attract && (screen === 'game' || screen === 'pause'));
}

/** Sounds + effects for events re-played in the replay. */
function onReplayEvent(e: WorldEvent): void {
  const w = replay!.world;
  renderer.onEvent(e, w);
  switch (e.k) {
    case 'touch':
      audio.hit(e.power, nearFactor(e.x, e.y, e.z));
      break;
    case 'bounce':
      audio.bounce(e.power, nearFactor(e.x, e.y, e.z));
      break;
    case 'demo':
      audio.demo(nearFactor(e.x, e.y, e.z));
      break;
    case 'goal':
      // Slow-motion sting as the ball crosses the line.
      audio.sting();
      audio.roar();
      if (settings.fx.shake > 0) renderer.cam.shake(1.2 * settings.fx.shake);
      break;
  }
}

/** Advance and draw the replay (ends it when done, skipped, or the kickoff comes). */
function replayFrame(s: Session, dt: number, jump: boolean): void {
  const r = replay!;
  // Skip with jump (after letting go of it once).
  const skip = jump && !replayJumpHeld && screen === 'game';
  replayJumpHeld = jump;
  if (screen === 'game') for (const e of r.update(dt)) onReplayEvent(e);
  if (skip || r.done || s.world.phase !== 'goal') {
    // Offline the kickoff follows right away; online the server decides.
    if (!s.online && s.world.phase === 'goal') s.world.phaseTimer = Math.min(s.world.phaseTimer, skip ? 0.4 : 0.6);
    endReplay();
    return;
  }
  const shot = r.shot();
  renderer.frame(r.world, r.prev, r.prevBall, r.alpha, dt, shot.kind === 'chase' ? shot.car : null, shot.kind === 'fixed' ? shot.pos : null);
  const c = r.world.car(r.scorer);
  audio.update(c?.speed ?? 0, c?.controls.throttle ?? 0, !!c?.isBoosting, !!c?.onGround, 0, !!c && !c.demolished);
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
  n.onBegin = (b) => void startOnline(n, b);
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
      .map((p) => `<div class="rk-lp ${p.id === net!.sessionId ? 'me' : ''}"><b>${p.bot ? '🤖 Bot' : esc(p.name)}</b><small>${p.bot ? l.config.botLevel.toUpperCase() : `${carInfo(p.body).name}${p.id === l.hostId ? ' · HOST' : ''}${p.connected ? '' : ' · reconnecting'}`}</small></div>`)
      .join('');
  }
  $('#o-host').classList.toggle('hidden', !host || l.phase !== 'lobby');
  setSeg('#o-size', String(l.config.size));
  setSeg('#o-bots', l.config.bots ? l.config.botLevel : 'off');
  setSeg('#o-length', String(l.config.length));
  setSeg('#o-arena', l.config.arena ?? 'random');
  const arena = l.config.arena && l.config.arena !== 'random' ? ARENAS[l.config.arena].name : 'Random arena';
  $('#o-wait').textContent = `${l.phase === 'playing' ? 'Match in progress…' : l.phase === 'over' ? 'Match finished — back to the lobby shortly…' : host ? 'Pick teams, then start.' : 'Waiting for the host to start…'} · ${arena}`;
  $('#o-start').classList.toggle('hidden', !host || l.phase !== 'lobby');
}

async function startOnline(n: RocketNet, b: RbBegin): Promise<void> {
  // The session starts buffering snapshots right away; the arena builds behind the overlay.
  const s = new OnlineSession(n, b);
  s.views = () => renderer.cars;
  s.ballErr = renderer.ball.errPos;
  await ensureArena(isArenaId(b.arena) ? b.arena : 'dome');
  if (net !== n) return s.dispose();
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
$('#o-arena').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (b?.dataset.v) net?.config({ arena: b.dataset.v as ArenaId | 'random' });
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

// Sounds for effects the renderer detects (landings, flip resets).
renderer.onFx = (e) => {
  const s = session;
  if (!s || s === attract || screen !== 'game') return;
  const w = replay?.world ?? s.world;
  const car = w.car(e.car);
  if (!car) return;
  if (e.k === 'land') audio.land(e.strength, nearFactor(car.pos.x, car.pos.y, car.pos.z));
  else if (e.car === s.myId || (replay && e.car === replay.scorer)) audio.ping();
};

// ============================================================================ loop

let lastT = performance.now();
const v3 = new THREE.Vector3();
let padShown = '';
let wasAirborne = false;
let autoRollShown = 0;
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
    if (settings.cam.ballCamMode === 'hold') renderer.cam.ballCam = settings.ballCam !== ui.ballCamHeld;
    else if (ui.ballCamToggle) renderer.cam.ballCam = !renderer.cam.ballCam;
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
  maybeStartReplay(s);
  if (replay) return replayFrame(s, dt, controls.jump);
  // Free play: no clock / no end.
  renderer.frame(s.world, s.prev, s.prevBall, s.alpha, dt, s === attract ? null : s.myId);
  if (s !== attract) {
    hud.update(dt, s.world, s.myId, renderer, { scoreboard: ui.scoreboard && inMatch, chatGroup: ui.chatGroup, device: ui.device, ballCam: renderer.cam.ballCam });
    const me = s.world.car(s.myId);
    // Everyone else's engines and boost, by distance; my tyres screech in a powerslide.
    const camPos = renderer.cam.camera.position;
    audio.others(
      playing
        ? s.world.cars
            .filter((c) => c.id !== s.myId && !c.demolished)
            .map((c) => ({ id: c.id, speed: c.speed, boosting: c.isBoosting, near: Math.min(1, 12 / Math.max(1, camPos.distanceTo(v3.set(c.pos.x / 100, c.pos.z / 100, -c.pos.y / 100)))) }))
        : [],
    );
    audio.slide(playing && me && me.onGround && !me.demolished && me.handbrakeVal > 0.5 && me.speed > 500 ? Math.min(1, me.speed / 1800) : 0);
    // Automatic air roll switches off when you land.
    const grounded = !me || me.onGround || me.demolished;
    if (grounded && wasAirborne) input.resetAutoRoll();
    wasAirborne = !grounded;
    const roll = inMatch ? ui.autoRoll : 0;
    if (roll !== autoRollShown) {
      autoRollShown = roll;
      $('#autoroll').classList.toggle('hidden', !roll);
      $('#autoroll').textContent = roll < 0 ? '⟲ AUTO AIR ROLL LEFT' : '⟳ AUTO AIR ROLL RIGHT';
    }
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
  const q = new URLSearchParams(location.search);
  // The menu background shows a random arena; a direct ?play / ?free link builds the chosen one.
  const first = q.has('play') || q.has('free') ? pickArena(settings.arena) : pickArena('random');
  await renderer.setArena(first);
  audio.setAmbience(THEMES[first].ambience);
  startAttract();
  renderer.warm();
  $('#loading').classList.add('hidden');
  show('menu', false);
  if (q.get('room')) void openOnline(q.get('room')!);
  else if (q.has('play')) void startLocal(false);
  else if (q.has('free')) void startLocal(true);
  requestAnimationFrame(loop);
})();

(window as unknown as Record<string, unknown>).__rk = {
  get session() {
    return session;
  },
  renderer,
  settings,
  audio,
};
