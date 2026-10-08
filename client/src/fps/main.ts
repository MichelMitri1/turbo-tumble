import './styles.css';
import { Game, MODES, type Mode, type SoldierSetup } from './sim/game';
import { MAPS } from './sim/maps';
import { DEFAULT_CLASSES, LETHALS, NO_ATTACHMENTS as NO_ATT, PERKS, PRIMARIES, SECONDARIES, STREAKS, STREAK_LIST, TACTICALS, WEAPON, WEAPONS, applyAttachments, damageAt, fixLoadout, type Attachments, type Lethal, type Loadout, type Perk, type Streak, type Tactical, type WeaponDef } from './sim/weapons';
import type { BotSkill } from './sim/bots';
import { preload } from './render/assets';
import { CAMOS, progress } from './render/camo';
import { GunStage, cachedThumb, mapThumb, renderThumb, setThumbGate, type ItemThumb, type ThumbSpec } from './render/preview';
import { icon } from './icons';
import { Match, LocalSession, type Session } from './match';
import { FpsInput, DEFAULT_INPUT, connectedPads, type InputSettings, type InputSource } from './input';
import { FpsAudio } from './audio';
import { scoreboard } from './hud';
import { OnlineSession, FpsNet } from './net/online';
import type { FpLobby } from './net/protocol';
import { bindFullscreenButton, installFullscreenKey } from '../ui/fullscreen';

// ============================================================================ profile

interface Profile {
  name: string;
  classes: Loadout[];
  cls: number;
  camos: Record<string, string>;
  input: InputSettings;
  fov: number;
  volume: number;
  announcer: boolean;
  quality: 'high' | 'low';
  map: string;
  mode: Mode;
  bots: number;
  skill: BotSkill;
  xp: number;
  /** Splitscreen: 1–4 local players, on the same team or against each other, and the class each extra player uses. */
  split: number;
  splitTeams: 'together' | 'versus';
  splitClasses: number[];
}
const KEY = 'zh:profile';
const profile: Profile = (() => {
  const d: Profile = { name: `Soldier${Math.floor(100 + Math.random() * 900)}`, classes: structuredClone(DEFAULT_CLASSES), cls: 0, camos: {}, input: { ...DEFAULT_INPUT }, fov: 90, volume: 0.7, announcer: true, quality: 'high', map: 'culdesac', mode: 'tdm', bots: 5, skill: 'regular', xp: 0, split: 1, splitTeams: 'together', splitClasses: [1, 2, 3] };
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Profile>;
    // Old saves: fill in equipment / streak choices they didn't have.
    const classes = (Array.isArray(p.classes) && p.classes.length ? p.classes : d.classes).map((c, i) => fixLoadout(c, DEFAULT_CLASSES[i] ?? DEFAULT_CLASSES[0]));
    return { ...d, ...p, classes, input: { ...d.input, ...(p.input ?? {}) } };
  } catch {
    return d;
  }
})();
const save = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(profile));
  } catch {
    /* ignore */
  }
};
const level = (xp: number) => Math.floor(Math.sqrt(xp / 250)) + 1;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// ============================================================================ DOM

/** Lazy preview images (filled in by `thumbs()`). */
const gimg = (id: string, camo = profile.camos[id] ?? 'none', att?: Attachments) => `<img data-g="${id}|${camo}${att ? `|${att.optic}|${att.muzzle}|${att.under}` : ''}" alt="" draggable="false">`;
const iimg = (kind: ItemThumb) => `<img data-i="${kind}" alt="" draggable="false">`;
/** Map shots are pre-baked (see `__zh.bakeMapThumbs`): rendering a whole map in the menu froze it. */
const mimg = (id: string) => `<img src="/assets/fps/thumbs/${id}.jpg" alt="" draggable="false" decoding="async">`;
const app = document.getElementById('game')!;
app.innerHTML = `
<div id="view"></div>
<div class="zh-screen" id="menu">
  <div class="zh-brand"><div class="zh-logo">ZERO<span>HOUR</span></div><small>MULTIPLAYER</small></div>
  <nav class="zh-nav">
    <button class="zh-btn primary" data-go="play">PLAY <small>vs bots</small></button>
    <button class="zh-btn" data-go="online">ONLINE · LAN <small>friends</small></button>
    <button class="zh-btn" data-go="classes">WEAPONS <small>create-a-class</small></button>
    <button class="zh-btn" data-go="armory">ARMORY <small>camos</small></button>
    <button class="zh-btn" data-go="settings">SETTINGS</button>
    <a class="zh-btn ghost" href="/">← ARCADE</a>
  </nav>
  <div class="zh-profile"><b id="p-name"></b><span id="p-level"></span><div class="zh-xp"><i id="p-xp"></i></div></div>
  <div class="zh-pad" id="pad-status"></div>
  <button class="zh-chip zh-fs" id="fullscreen"></button>
</div>

<div class="zh-screen hidden" id="play">
  <div class="zh-panel wide">
    <h2>QUICK PLAY</h2>
    <div class="zh-field"><span>MODE</span><div class="zh-seg modes" id="q-mode">${(Object.keys(MODES) as Mode[]).map((m) => `<button data-v="${m}">${icon(m, 'zh-ico')}${MODES[m].name.toUpperCase()}</button>`).join('')}</div><p class="zh-sub" id="q-mode-desc"></p></div>
    <div class="zh-maps" id="q-maps">${MAPS.map((m) => `<button class="zh-map" data-v="${m.id}">${mimg(m.id)}<b>${m.name.toUpperCase()}</b><small>${esc(m.desc)}</small><i>${m.size.toUpperCase()}</i></button>`).join('')}</div>
    <div class="zh-row">
      <div class="zh-field"><span>PLAYERS (SPLITSCREEN)</span><div class="zh-seg" id="q-split">${[1, 2, 3, 4].map((n) => `<button data-v="${n}">${n}</button>`).join('')}</div></div>
      <div class="zh-field" id="q-teams-f"><span>SPLITSCREEN TEAMS</span><div class="zh-seg" id="q-teams"><button data-v="together">TOGETHER</button><button data-v="versus">VERSUS</button></div></div>
    </div>
    <div class="zh-split-setup" id="q-split-setup"></div>
    <div class="zh-row">
      <div class="zh-field"><span>BOTS PER TEAM</span><div class="zh-seg" id="q-bots">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-v="${n}">${n}</button>`).join('')}</div></div>
      <div class="zh-field"><span>DIFFICULTY</span><div class="zh-seg" id="q-skill"><button data-v="recruit">RECRUIT</button><button data-v="regular">REGULAR</button><button data-v="hardened">HARDENED</button><button data-v="veteran">VETERAN</button></div></div>
    </div>
    <div class="zh-actions"><button class="zh-btn ghost" data-back>BACK</button><button class="zh-btn primary" id="q-start">START MATCH</button></div>
  </div>
</div>

<div class="zh-screen hidden" id="classes">
  <div class="zh-panel wide tall">
    <h2>CREATE-A-CLASS</h2>
    <div class="zh-classes" id="c-list"></div>
    <div class="zh-gunsmith">
      <div class="zh-stage" id="c-stage"><div class="zh-stage__info" id="c-info"></div></div>
      <div class="zh-class" id="c-edit"></div>
    </div>
    <div class="zh-actions"><button class="zh-btn ghost" data-back>DONE</button></div>
  </div>
</div>

<div class="zh-screen hidden" id="armory">
  <div class="zh-panel wide tall">
    <h2>ARMORY <small>Unlock camos with kills on each weapon</small></h2>
    <div class="zh-armory"><div class="zh-armory__list" id="a-list"></div><div class="zh-armory__camos"><div class="zh-stage short" id="a-stage"><div class="zh-stage__info" id="a-info"></div></div><div id="a-camos"></div></div></div>
    <div class="zh-actions"><button class="zh-btn ghost" data-back>DONE</button></div>
  </div>
</div>

<div class="zh-screen hidden" id="settings">
  <div class="zh-panel wide">
    <h2>SETTINGS</h2>
    <div class="zh-cols">
      <div>
        <label class="zh-text">NAME <input id="s-name" maxlength="16" spellcheck="false" /></label>
        <label class="zh-slider"><span>MOUSE SENSITIVITY</span><input type="range" id="s-sens" min="0.2" max="3" step="0.05" /><b></b></label>
        <label class="zh-slider"><span>ADS SENSITIVITY</span><input type="range" id="s-ads" min="0.3" max="1.5" step="0.05" /><b></b></label>
        <label class="zh-slider"><span>CONTROLLER SENSITIVITY</span><input type="range" id="s-pad" min="0.3" max="2.5" step="0.05" /><b></b></label>
        <label class="zh-check"><input type="checkbox" id="s-invert" /> Invert look</label>
        <label class="zh-check"><input type="checkbox" id="s-assist" /> Controller aim assist</label>
        <label class="zh-check"><input type="checkbox" id="s-toggle" /> Toggle aim (mouse)</label>
      </div>
      <div>
        <label class="zh-slider"><span>FIELD OF VIEW</span><input type="range" id="s-fov" min="65" max="120" step="1" /><b></b></label>
        <label class="zh-slider"><span>VOLUME</span><input type="range" id="s-vol" min="0" max="1" step="0.05" /><b></b></label>
        <label class="zh-check"><input type="checkbox" id="s-ann" /> Announcer voice</label>
        <div class="zh-field"><span>GRAPHICS</span><div class="zh-seg" id="s-quality"><button data-v="high">HIGH</button><button data-v="low">PERFORMANCE</button></div></div>
        <table class="zh-binds"><tr><th></th><th>KEYBOARD</th><th>PS4</th></tr>
          <tr><td>Move / Look</td><td>WASD / Mouse</td><td>L / R sticks</td></tr><tr><td>Fire / Aim</td><td>LMB / RMB</td><td>R2 / L2</td></tr>
          <tr><td>Sprint</td><td>Shift</td><td>L3</td></tr><tr><td>Jump</td><td>Space</td><td>✕</td></tr><tr><td>Crouch / Slide</td><td>C / Ctrl</td><td>○</td></tr>
          <tr><td>Reload</td><td>R</td><td>□</td></tr><tr><td>Swap weapon</td><td>1 / 2 / Wheel</td><td>△</td></tr><tr><td>Lethal (hold: cook frag)</td><td>G</td><td>R1</td></tr><tr><td>Tactical</td><td>Q</td><td>L1</td></tr>
          <tr><td>Melee</td><td>V / E</td><td>R3</td></tr><tr><td>Killstreaks 1 / 2 / 3</td><td>4 / 5 / 6</td><td>D-pad ← ↑ ↓ (→ next)</td></tr><tr><td>Scoreboard</td><td>Tab</td><td>Touchpad</td></tr></table>
      </div>
    </div>
    <div class="zh-actions"><button class="zh-btn ghost" data-back>DONE</button></div>
  </div>
</div>

<div class="zh-screen hidden" id="online">
  <div class="zh-panel wide">
    <h2 id="o-title">ONLINE</h2>
    <p class="zh-sub" id="o-sub">Play with friends anywhere — or on the same Wi-Fi with <b>npm run lan</b>.</p>
    <div class="zh-lan hidden" id="o-lan"><small>OTHER DEVICES OPEN</small><b id="o-lan-url"></b></div>
    <div id="o-connect">
      <div class="zh-actions left"><button class="zh-btn primary" id="o-create">CREATE LOBBY</button><button class="zh-btn" id="o-quick">QUICK MATCH</button></div>
      <div class="zh-row"><input id="o-code" placeholder="CODE" maxlength="4" spellcheck="false" /><button class="zh-btn" id="o-join">JOIN</button></div>
    </div>
    <div class="hidden" id="o-lobby">
      <div class="zh-code">LOBBY <b id="o-code-big"></b><button class="zh-chip" id="o-copy">COPY INVITE</button></div>
      <div class="zh-teams"><div class="zh-team t0"><h3>COALITION</h3><div id="o-t0"></div><button class="zh-btn small" id="o-j0">JOIN</button></div><div class="zh-team t1"><h3>MILITIA</h3><div id="o-t1"></div><button class="zh-btn small" id="o-j1">JOIN</button></div></div>
      <div id="o-host">
        <div class="zh-field"><span>MODE</span><div class="zh-seg modes" id="o-mode">${(Object.keys(MODES) as Mode[]).map((m) => `<button data-v="${m}" title="${MODES[m].desc}">${icon(m, 'zh-ico')}${MODES[m].short}</button>`).join('')}</div></div>
        <div class="zh-field"><span>MAP</span><div class="zh-seg maps" id="o-map">${MAPS.map((m) => `<button data-v="${m.id}">${mimg(m.id)}<span>${m.name.toUpperCase()}</span></button>`).join('')}</div></div>
        <div class="zh-field"><span>BOTS PER TEAM (FILL)</span><div class="zh-seg" id="o-bots">${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-v="${n}">${n}</button>`).join('')}</div></div>
        <div class="zh-field"><span>BOT DIFFICULTY</span><div class="zh-seg" id="o-skill"><button data-v="recruit">RECRUIT</button><button data-v="regular">REGULAR</button><button data-v="hardened">HARDENED</button><button data-v="veteran">VETERAN</button></div></div>
      </div>
      <p class="zh-sub" id="o-wait"></p>
      <div class="zh-actions"><button class="zh-btn primary" id="o-start">START MATCH</button></div>
    </div>
    <p class="zh-status" id="o-status"></p>
    <div class="zh-actions"><span class="zh-server" id="o-server"></span><button class="zh-btn ghost" id="o-back">LEAVE</button></div>
  </div>
</div>

<div class="zh-screen hidden dim" id="pause">
  <div class="zh-panel">
    <h2>PAUSED</h2>
    <div class="zh-field"><span>CHANGE CLASS (NEXT SPAWN)</span><div class="zh-classpick" id="p-classes"></div></div>
    <div class="zh-actions col"><button class="zh-btn primary" id="p-resume">RESUME</button><button class="zh-btn" id="p-settings">SETTINGS</button><button class="zh-btn ghost" id="p-leave">LEAVE MATCH</button></div>
  </div>
</div>

<div class="zh-screen hidden dim" id="end">
  <div class="zh-panel wide">
    <div class="zh-result" id="e-result"></div>
    <div class="zh-board end" id="e-board"></div>
    <div class="zh-actions"><button class="zh-btn ghost" id="e-menu">MAIN MENU</button><button class="zh-btn primary" id="e-again">PLAY AGAIN</button></div>
  </div>
</div>
<div class="zh-loading hidden" id="loading"><div class="zh-logo">ZERO<span>HOUR</span></div><div class="zh-bar"><i id="l-bar"></i></div><small id="l-text">LOADING</small></div>
<div class="zh-click hidden" id="click">CLICK TO PLAY</div>
`;

const $ = <T extends HTMLElement = HTMLElement>(s: string) => app.querySelector<T>(s)!;
bindFullscreenButton($('#fullscreen'), ['⛶', '⛶']);
installFullscreenKey();
const input = new FpsInput($('#view'));
input.settings = profile.input;
const audio = new FpsAudio();
audio.setVolume(profile.volume);
audio.announcer = profile.announcer;
addEventListener('pointerdown', () => audio.unlock(), { capture: true });
addEventListener('keydown', () => audio.unlock(), { capture: true });

type ScreenId = 'menu' | 'play' | 'classes' | 'armory' | 'settings' | 'online' | 'pause' | 'end' | 'game';
let screen: ScreenId = 'menu';
let back: ScreenId = 'menu';
/** Mouse players need pointer lock; controller players never need the click gate. */
const syncClickPrompt = () => $('#click').classList.toggle('hidden', !(screen === 'game' && !input.locked && !input.hasPad));
function show(id: ScreenId): void {
  if (id !== 'settings') back = screen === 'pause' ? 'pause' : 'menu';
  if (id === 'settings' && screen === 'pause') back = 'pause';
  screen = id;
  quietUntil = performance.now() + 500;
  for (const s of ['menu', 'play', 'classes', 'armory', 'settings', 'online', 'pause', 'end'] as const) $(`#${s}`).classList.toggle('hidden', s !== id);
  syncClickPrompt();
  audio.ui();
  renderProfile();
}
app.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => show(back === 'pause' && screen === 'settings' ? 'pause' : 'menu')));
app.querySelectorAll<HTMLElement>('[data-go]').forEach((b) =>
  b.addEventListener('click', () => {
    const go = b.dataset.go as ScreenId;
    if (go === 'play') renderSplit();
    if (go === 'classes') renderClasses();
    if (go === 'armory') renderArmory();
    if (go === 'settings') renderSettings();
    if (go === 'online') return void openOnline();
    show(go);
  }),
);

function renderProfile(): void {
  $('#p-name').textContent = profile.name;
  const lv = level(profile.xp);
  $('#p-level').textContent = `LEVEL ${lv}`;
  const a = (lv - 1) ** 2 * 250;
  const b = lv ** 2 * 250;
  $('#p-xp').style.width = `${((profile.xp - a) / (b - a)) * 100}%`;
  $('#pad-status').textContent = input.hasPad ? '🎮 Controller connected' : '';
}

function seg(sel: string, v: string, pick: (v: string) => void): void {
  const el = $(sel);
  const sync = (x: string) => el.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('on', b.dataset.v === x));
  sync(v);
  el.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!b?.dataset.v) return;
    sync(b.dataset.v);
    pick(b.dataset.v);
  });
}
const setSeg = (sel: string, v: string) => $(sel).querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));

// Quick play.
const modeDesc = () => ($('#q-mode-desc').textContent = MODES[profile.mode].desc);
seg('#q-mode', profile.mode, (v) => ((profile.mode = v as Mode), save(), modeDesc()));
modeDesc();
seg('#q-bots', String(profile.bots), (v) => ((profile.bots = Number(v)), save()));
seg('#q-skill', profile.skill, (v) => ((profile.skill = v as BotSkill), save()));
// Splitscreen: who plays with what, and each extra player's class.
seg('#q-split', String(profile.split), (v) => ((profile.split = Number(v)), save(), renderSplit()));
seg('#q-teams', profile.splitTeams, (v) => ((profile.splitTeams = v as Profile['splitTeams']), save()));
/** Devices for N local players: if there's a pad for everyone, player 1 gets one too (and keeps the keyboard). */
function splitSources(n: number): InputSource[] {
  const pads = connectedPads().length;
  if (n === 1) return [{ kb: true, pad: 0 }];
  const p1Pad = pads >= n;
  return Array.from({ length: n }, (_, i) => (i === 0 ? { kb: true, pad: p1Pad ? 0 : null } : { kb: false, pad: p1Pad ? i : i - 1 }));
}

/**
 * Resolve each local seat to a class with a different primary weapon. Player 1
 * keeps their choice; later seats move to the first available class when an old
 * save (or an edited class) would otherwise duplicate it.
 */
function uniqueSplitClassIndexes(n: number): number[] {
  const used = new Set<string>();
  const chosen: number[] = [];
  let changed = false;
  for (let i = 0; i < n; i++) {
    const preferred = i === 0 ? profile.cls : (profile.splitClasses[i - 1] ?? i);
    let pick = profile.classes[preferred] ? preferred : 0;
    const primary = profile.classes[pick]?.primary;
    if (primary && used.has(primary)) {
      const free = profile.classes.findIndex((candidate) => !used.has(candidate.primary));
      if (free >= 0) pick = free;
    }
    chosen.push(pick);
    used.add(profile.classes[pick]!.primary);
    if (i === 0 && profile.cls !== pick) {
      profile.cls = pick;
      changed = true;
    } else if (i > 0 && profile.splitClasses[i - 1] !== pick) {
      profile.splitClasses[i - 1] = pick;
      changed = true;
    }
  }
  if (changed) save();
  return chosen;
}

function renderSplit(): void {
  const n = profile.split;
  $('#q-teams-f').classList.toggle('hidden', n < 2);
  const box = $('#q-split-setup');
  if (n < 2) {
    box.innerHTML = '';
    return;
  }
  const pads = connectedPads();
  const src = splitSources(n);
  const chosen = uniqueSplitClassIndexes(n);
  box.innerHTML = Array.from({ length: n }, (_, i) => {
    const s = src[i]!;
    const pad = s.pad !== null ? pads[s.pad] : undefined;
    const dev = s.kb ? (pad ? 'Keyboard &amp; mouse / Controller 1' : 'Keyboard &amp; mouse') : pad ? `Controller ${s.pad! + 1}` : '<em>Connect a controller</em>';
    const cls = chosen[i]!;
    const currentWeapon = profile.classes[cls]!.primary;
    return `<div class="zh-split-p ${!s.kb && !pad ? 'missing' : ''}"><b>P${i + 1}</b><span>${i === 0 ? esc(profile.name) : `Player ${i + 1}`}</span><small>${dev} · <strong>${esc(WEAPON[currentWeapon]?.name ?? currentWeapon)}</strong></small><div class="zh-seg small" data-p="${i}">${profile.classes.map((c, k) => {
      const owner = chosen.findIndex((other, seat) => seat !== i && profile.classes[other]!.primary === c.primary);
      const locked = owner >= 0 && k !== cls;
      const reason = locked ? `Primary weapon already assigned to P${owner + 1}` : `${WEAPON[c.primary]?.name ?? c.primary} primary`;
      return `<button data-v="${k}" class="${k === cls ? 'on' : ''}" title="${esc(reason)}" ${locked ? 'disabled' : ''}>${esc(c.name.toUpperCase())}</button>`;
    }).join('')}</div></div>`;
  }).join('');
}
$('#q-split-setup').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-v]');
  const row = b?.closest<HTMLElement>('[data-p]');
  if (!b || b.disabled || !row) return;
  const i = Number(row.dataset.p);
  if (i === 0) profile.cls = Number(b.dataset.v);
  else profile.splitClasses[i - 1] = Number(b.dataset.v);
  save();
  audio.ui();
  renderSplit();
});
addEventListener('gamepadconnected', () => {
  renderSplit();
  syncClickPrompt();
});
addEventListener('gamepaddisconnected', () => {
  renderSplit();
  syncClickPrompt();
});
renderSplit();
const mapsEl = $('#q-maps');
const syncMaps = () => mapsEl.querySelectorAll<HTMLElement>('.zh-map').forEach((b) => b.classList.toggle('on', b.dataset.v === profile.map));
mapsEl.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('.zh-map');
  if (!b) return;
  profile.map = b.dataset.v!;
  save();
  syncMaps();
});
syncMaps();
$('#q-start').addEventListener('click', () => void startLocal());

// ---------------------------------------------------------------- create-a-class

// ---------------------------------------------------------------- previews

const spec = (el: HTMLImageElement): ThumbSpec => {
  if (el.dataset.i) return { item: el.dataset.i as ItemThumb };
  const [gun, camo, optic, muzzle, under] = el.dataset.g!.split('|');
  return { gun: gun!, camo: camo ?? 'none', att: optic ? ({ optic, muzzle, under, ammo: 'standard' } as Attachments) : undefined };
};
/** A real idle slot (≥ 12 ms free), never within half a second of a screen change. */
let quietUntil = 0;
const idle = () =>
  new Promise<void>((res) => {
    if (typeof requestIdleCallback !== 'function') return void setTimeout(res, 50);
    const f = (d: IdleDeadline) => (d.timeRemaining() < 12 || performance.now() < quietUntil ? requestIdleCallback(f) : res());
    requestIdleCallback(f);
  });
const thumbQ: HTMLImageElement[] = [];
let thumbBusy = false;
// Menu thumbnails also wait for idle before their render + readback (not during the loading screen's pre-render).
setThumbGate(() => (loading ? Promise.resolve() : idle()));

/**
 * Fill `<img data-g|data-i>` thumbnails: cached ones (memory / localStorage) at
 * once, the rest rendered one per idle slot (never during a match).
 */
function thumbs(root: ParentNode = app): void {
  for (const el of root.querySelectorAll<HTMLImageElement>('img[data-g]:not([src]), img[data-i]:not([src])')) {
    const url = cachedThumb(spec(el));
    if (url) el.src = url;
    else thumbQ.push(el);
  }
  void pumpThumbs();
}
async function pumpThumbs(): Promise<void> {
  if (thumbBusy) return;
  thumbBusy = true;
  while (thumbQ.length) {
    await idle();
    while (screen === 'game' || loading) await new Promise((r) => setTimeout(r, 400));
    const el = thumbQ.shift()!;
    if (!el.isConnected || el.src) continue;
    const url = await renderThumb(spec(el));
    if (url) el.src = url;
  }
  thumbBusy = false;
}

/** Render thumbnails ahead (e.g. the pause menu's class list during the loading screen). */
async function prerenderThumbs(root: ParentNode): Promise<void> {
  for (const el of root.querySelectorAll<HTMLImageElement>('img[data-g], img[data-i]')) if (!el.src) el.src = await renderThumb(spec(el));
}

/** Every model the menus can show; previews fill in once they're loaded. */
void preload(MAPS.flatMap((m) => m.props.map((p) => p.model))).then(async () => {
  thumbs();
  if (screen === 'classes') updateStage();
  if (screen === 'armory') updateArmoryStage();
  // GL contexts + studio lighting for the turntables, before anyone opens those screens.
  await idle();
  if (!loading && screen !== 'game') classStage.warm();
  await idle();
  if (!loading && screen !== 'game') armoryStage.warm();
});

const CLASS_NAME: Record<WeaponDef['cls'], string> = { ar: 'ASSAULT RIFLE', smg: 'SUBMACHINE GUN', lmg: 'LIGHT MACHINE GUN', shotgun: 'SHOTGUN', sniper: 'SNIPER RIFLE', marksman: 'MARKSMAN RIFLE', pistol: 'HANDGUN' };
const STAT_NAMES = ['DAMAGE', 'FIRE RATE', 'RANGE', 'ACCURACY', 'MOBILITY', 'HANDLING'];
function stats(w: WeaponDef): number[] {
  const dmg = damageAt(w, 10) * (w.pellets ?? 1);
  return [
    Math.min(1, dmg / 140),
    Math.min(1, w.rpm / 1100),
    Math.min(1, w.damage[0]![0] / 60),
    Math.max(0.05, Math.min(1, 1.05 - w.recoilV / 4.5 - w.hip / 30)),
    Math.max(0.05, Math.min(1, (w.move - 0.82) / 0.24)),
    Math.max(0.05, Math.min(1, 1 - (w.ads - 0.14) / 0.4)),
  ];
}
/** Stat bars; with `base`, the difference shows green (better) or red (worse), like the real gunsmith. */
function statBars(cur: WeaponDef, base?: WeaponDef): string {
  const v = stats(cur);
  const b = base ? stats(base) : v;
  return `<div class="zh-stats">${STAT_NAMES.map((n, i) => {
    const d = v[i]! - b[i]!;
    return `<div><span>${n}</span><i class="${d > 0.004 ? 'up' : d < -0.004 ? 'down' : ''}" style="--v:${Math.min(v[i]!, b[i]!).toFixed(3)};--d:${Math.abs(d).toFixed(3)}"></i></div>`;
  }).join('')}</div>`;
}
function facts(w: WeaponDef): string {
  const dmg = w.damage[0]![1] * (w.pellets ?? 1);
  return `<div class="zh-facts"><span><b>${dmg}</b>DMG</span><span><b>${w.rpm}</b>RPM</span><span><b>${w.mag}</b>MAG</span><span><b>${Math.round(w.ads * 1000)}</b>MS ADS</span><span><b>${w.mode.toUpperCase()}</b>FIRE</span></div>`;
}
const card = (attrs: string, on: boolean, img: string, title: string, sub: string, extra = '') =>
  `<button class="zh-card ${on ? 'on' : ''}" ${attrs}><span class="zh-card__img">${img}</span><b>${title}</b><small>${sub}</small>${extra}</button>`;

// ---------------------------------------------------------------- create-a-class

let editing = 0;
/** What the stage previews while hovering / focusing an option (falls back to the selection). */
let hover: { slot: 'primary' | 'secondary'; id?: string; att?: Partial<Attachments> } | null = null;
const classStage = new GunStage();
$('#c-stage').prepend(classStage.canvas);

const ATTACH: Array<{ key: keyof Attachments; label: string; values: Array<[string, string, ItemThumb, string]> }> = [
  { key: 'optic', label: 'OPTIC', values: [['iron', 'IRON SIGHTS', 'iron', 'Factory sights'], ['reddot', 'RED DOT', 'reddot', 'Clean dot, open view'], ['holo', 'HOLOGRAPHIC', 'holo', 'Ring reticle'], ['acog', 'ACOG 3×', 'acog', 'Zoom · slower ADS']] },
  { key: 'muzzle', label: 'MUZZLE', values: [['none', 'NONE', 'none', 'Louder, full range'], ['suppressor', 'SUPPRESSOR', 'suppressor', 'Off the minimap · less range']] },
  { key: 'under', label: 'UNDERBARREL', values: [['none', 'NONE', 'none', 'No change'], ['grip', 'FOREGRIP', 'grip', 'Less recoil'], ['laser', 'TAC LASER', 'laser', 'Tighter hipfire · faster ADS']] },
  { key: 'ammo', label: 'MAGAZINE', values: [['standard', 'STANDARD', 'standard', 'Factory mag'], ['extended', 'EXTENDED MAG', 'extended', '+50% rounds · slower reload']] },
];

function updateStage(): void {
  const c = profile.classes[editing]!;
  const slot = hover?.slot ?? 'primary';
  const selId = slot === 'primary' ? c.primary : c.secondary;
  const selAtt = slot === 'primary' ? c.primaryAtt : NO_ATT;
  const id = hover?.id ?? selId;
  const att: Attachments = slot === 'primary' ? { ...c.primaryAtt, ...hover?.att } : NO_ATT;
  const def = WEAPON[id]!;
  classStage.show(id, profile.camos[id] ?? 'none', def.scoped ? { ...att, optic: 'iron' } : att);
  const cur = applyAttachments(def, att);
  const base = applyAttachments(WEAPON[selId]!, selAtt);
  const changed = hover && (hover.id ? hover.id !== selId : Object.entries(hover.att ?? {}).some(([k, v]) => selAtt[k as keyof Attachments] !== v));
  $('#c-info').innerHTML = `<div class="zh-stage__name"><small>${slot === 'primary' ? 'PRIMARY' : 'SECONDARY'} · ${CLASS_NAME[def.cls]}</small><b>${def.name.toUpperCase()}</b></div>${statBars(cur, changed ? base : undefined)}${facts(cur)}`;
}

function renderClasses(): void {
  $('#c-list').innerHTML = profile.classes.map((c, i) => `<button class="zh-cls ${i === editing ? 'on' : ''}" data-i="${i}">${gimg(c.primary, undefined, c.primaryAtt)}<b>${esc(c.name.toUpperCase())}</b><small>${WEAPON[c.primary]?.name ?? ''} · ${WEAPON[c.secondary]?.name ?? ''}</small></button>`).join('');
  const c = profile.classes[editing]!;
  const scoped = !!WEAPON[c.primary]?.scoped;
  const gun = (slot: string, w: WeaponDef, on: boolean) => card(`data-slot="${slot}" data-v="${w.id}"`, on, gimg(w.id), w.name.toUpperCase(), CLASS_NAME[w.cls]);
  const attach = ATTACH.map(({ key, label, values }) => {
    const items = values.map(([v, name, thumb, desc]) => {
      const blocked = key === 'optic' && scoped && v !== 'iron';
      const title = key === 'optic' && scoped && v === 'iron' ? 'BUILT-IN SCOPE' : name;
      return card(`data-att="${key}" data-v="${v}" ${blocked ? 'disabled' : ''}`, c.primaryAtt[key] === v, thumb === 'none' ? '<i class="zh-none">∅</i>' : iimg(thumb), title, blocked ? 'Sniper scope only' : desc);
    });
    return `<div class="zh-field"><span>${label}</span><div class="zh-cards small">${items.join('')}</div></div>`;
  }).join('');
  const perkTier = (t: 1 | 2 | 3) => `<div class="zh-field"><span>PERK ${t}</span><div class="zh-cards perks">${(Object.keys(PERKS) as Perk[]).filter((p) => PERKS[p].tier === t).map((p) => card(`data-perk="${t - 1}" data-v="${p}"`, c.perks[t - 1] === p, icon(p, 'zh-ico'), PERKS[p].name.toUpperCase(), PERKS[p].desc)).join('')}</div></div>`;
  const hardline = c.perks.includes('hardline');
  $('#c-edit').innerHTML = `
    <div class="zh-field"><span>PRIMARY WEAPON</span><div class="zh-cards guns">${PRIMARIES.map((w) => gun('primary', w, c.primary === w.id)).join('')}</div></div>
    <h4 class="zh-sec">GUNSMITH · ${WEAPON[c.primary]!.name.toUpperCase()}</h4>
    ${attach}
    <div class="zh-field"><span>SECONDARY WEAPON</span><div class="zh-cards guns">${SECONDARIES.map((w) => gun('secondary', w, c.secondary === w.id)).join('')}</div></div>
    <h4 class="zh-sec">PERKS</h4>
    ${perkTier(1)}${perkTier(2)}${perkTier(3)}
    <h4 class="zh-sec">EQUIPMENT</h4>
    <div class="zh-field"><span>LETHAL</span><div class="zh-cards perks">${(Object.keys(LETHALS) as Lethal[]).map((k) => card(`data-lethal="1" data-v="${k}"`, c.lethal === k, k === 'frag' ? iimg('grenade') : k === 'tknife' ? iimg('knife') : icon(k, 'zh-ico'), `${LETHALS[k].name.toUpperCase()} ×${LETHALS[k].count}`, LETHALS[k].desc)).join('')}</div></div>
    <div class="zh-field"><span>TACTICAL</span><div class="zh-cards perks">${(Object.keys(TACTICALS) as Tactical[]).map((k) => card(`data-tactical="1" data-v="${k}"`, c.tactical === k, icon(k, 'zh-ico'), `${TACTICALS[k].name.toUpperCase()} ×${TACTICALS[k].count}`, TACTICALS[k].desc)).join('')}</div></div>
    <h4 class="zh-sec">SCORESTREAKS <small>${c.streaks.length}/3 · kills in a row${hardline ? ' (Hardline −1)' : ''}</small></h4>
    <div class="zh-cards perks streaks">${STREAK_LIST.map((k) => {
      const i = c.streaks.indexOf(k);
      return card(`data-streak="1" data-v="${k}"`, i >= 0, icon(k, 'zh-ico'), `${STREAKS[k].name.toUpperCase()} · ${STREAKS[k].kills - (hardline ? 1 : 0)}`, `${STREAKS[k].desc}${STREAKS[k].pilot ? ' <em>You pilot it.</em>' : ''}`, i >= 0 ? `<i class="zh-card__badge">${i + 1}</i>` : '');
    }).join('')}</div>
    <p class="zh-sub">Knife: V / R3 · Lethal: G / R1 · Tactical: Q / L1 · Streaks: 4 · 5 · 6 (D-pad ← ↑ ↓, or → for the next ready one)</p>`;
  thumbs();
  updateStage();
}
$('#c-list').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
  if (!b) return;
  editing = Number(b.dataset.i);
  hover = null;
  renderClasses();
});
function hoverFrom(el: Element | null): typeof hover {
  const b = el?.closest<HTMLButtonElement>('button[data-v]');
  if (!b) return null;
  const slot = b.dataset.slot as 'primary' | 'secondary' | undefined;
  if (slot) return { slot, id: b.dataset.v };
  const att = b.dataset.att as keyof Attachments | undefined;
  if (att && !b.disabled) return { slot: 'primary', att: { [att]: b.dataset.v } };
  return null;
}
for (const ev of ['mouseover', 'focusin'] as const) {
  $('#c-edit').addEventListener(ev, (e) => {
    const h = hoverFrom(e.target as Element);
    if (JSON.stringify(h) === JSON.stringify(hover)) return;
    hover = h;
    updateStage();
  });
}
$('#c-edit').addEventListener('mouseleave', () => {
  hover = null;
  updateStage();
});
$('#c-edit').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-v]');
  if (!b || b.disabled) return;
  const c = profile.classes[editing]!;
  const slot = b.dataset.slot;
  const att = b.dataset.att as keyof Attachments | undefined;
  const perk = b.dataset.perk;
  if (b.dataset.lethal) c.lethal = b.dataset.v as Lethal;
  if (b.dataset.tactical) c.tactical = b.dataset.v as Tactical;
  if (b.dataset.streak) {
    const k = b.dataset.v as Streak;
    const list = [...c.streaks] as Streak[];
    if (list.includes(k)) {
      if (list.length > 1) list.splice(list.indexOf(k), 1);
    } else if (list.length < 3) list.push(k);
    else {
      // Full: swap out the one closest in cost.
      const near = list.reduce((a, x) => (Math.abs(STREAKS[x].kills - STREAKS[k].kills) < Math.abs(STREAKS[a].kills - STREAKS[k].kills) ? x : a));
      list[list.indexOf(near)] = k;
    }
    c.streaks = list.sort((a, x) => STREAKS[a].kills - STREAKS[x].kills) as Loadout['streaks'];
  }
  if (slot === 'primary') c.primary = b.dataset.v!;
  if (slot === 'secondary') c.secondary = b.dataset.v!;
  if (att) (c.primaryAtt as unknown as Record<string, string>)[att] = b.dataset.v!;
  if (perk !== undefined) c.perks[Number(perk)] = b.dataset.v as Perk;
  // Sniper rifles keep their own scope.
  if (WEAPON[c.primary]?.scoped) c.primaryAtt.optic = 'iron';
  save();
  audio.ui();
  hover = null;
  const scroll = $('#c-edit').scrollTop;
  renderClasses();
  $('#c-edit').scrollTop = scroll;
  // Keep controller focus on the same option.
  const sel = slot ? `[data-slot="${slot}"][data-v="${b.dataset.v}"]` : att ? `[data-att="${att}"][data-v="${b.dataset.v}"]` : perk !== undefined ? `[data-perk="${perk}"][data-v="${b.dataset.v}"]` : `[data-v="${b.dataset.v}"]`;
  $('#c-edit').querySelector<HTMLElement>(sel)?.focus({ preventScroll: true });
});

// ---------------------------------------------------------------- armory

let armoryWeapon = WEAPONS[0]!.id;
let armoryHover: string | null = null;
const armoryStage = new GunStage();
$('#a-stage').prepend(armoryStage.canvas);

function updateArmoryStage(): void {
  const camoId = armoryHover ?? profile.camos[armoryWeapon] ?? 'none';
  const camo = CAMOS.find((c) => c.id === camoId) ?? CAMOS[0]!;
  const k = progress.kills()[armoryWeapon] ?? 0;
  armoryStage.show(armoryWeapon, camo.id);
  const w = WEAPON[armoryWeapon]!;
  const status = k >= camo.kills ? ((profile.camos[armoryWeapon] ?? 'none') === camo.id ? 'EQUIPPED' : 'UNLOCKED') : `LOCKED · ${camo.kills - k} MORE KILLS`;
  $('#a-info').innerHTML = `<div class="zh-stage__name"><small>${CLASS_NAME[w.cls]} · ${k} KILLS</small><b>${w.name.toUpperCase()}</b><em class="${camo.mastery ? 'mastery' : ''}">${camo.name.toUpperCase()} <span>${status}</span></em></div>`;
}

function renderArmory(): void {
  const kills = progress.kills();
  $('#a-list').innerHTML = WEAPONS.map((w) => `<button class="${w.id === armoryWeapon ? 'on' : ''}" data-w="${w.id}">${gimg(w.id)}<span><b>${w.name}</b><small>${kills[w.id] ?? 0} kills · ${(CAMOS.find((c) => c.id === profile.camos[w.id]) ?? CAMOS[0]!).name}</small></span></button>`).join('');
  const k = kills[armoryWeapon] ?? 0;
  $('#a-camos').innerHTML = `<div class="zh-camos">${CAMOS.map((c) => {
    const unlocked = k >= c.kills;
    const sel = (profile.camos[armoryWeapon] ?? 'none') === c.id;
    const bar = unlocked ? '' : `<i class="zh-camo__bar" style="--v:${(k / c.kills).toFixed(3)}"></i>`;
    return `<button class="zh-camo ${unlocked ? '' : 'locked'} ${sel ? 'on' : ''} ${c.mastery ? 'mastery' : ''}" data-c="${c.id}" aria-disabled="${!unlocked}">${gimg(armoryWeapon, c.id)}<b>${c.name}</b><small>${unlocked ? (sel ? 'EQUIPPED' : 'UNLOCKED') : `🔒 ${k}/${c.kills} kills`}</small>${bar}</button>`;
  }).join('')}</div>`;
  thumbs();
  updateArmoryStage();
}
$('#a-list').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-w]');
  if (!b) return;
  armoryWeapon = b.dataset.w!;
  armoryHover = null;
  renderArmory();
});
for (const ev of ['mouseover', 'focusin'] as const) {
  $('#a-camos').addEventListener(ev, (e) => {
    const c = (e.target as HTMLElement).closest<HTMLElement>('[data-c]')?.dataset.c ?? null;
    if (c === armoryHover || !c) return;
    armoryHover = c;
    updateArmoryStage();
  });
}
$('#a-camos').addEventListener('mouseleave', () => {
  armoryHover = null;
  updateArmoryStage();
});
$('#a-camos').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-c]');
  if (!b) return;
  armoryHover = b.dataset.c!;
  if (b.getAttribute('aria-disabled') === 'true') return void updateArmoryStage();
  profile.camos[armoryWeapon] = b.dataset.c!;
  save();
  audio.ui();
  renderArmory();
  $('#a-camos').querySelector<HTMLElement>(`[data-c="${b.dataset.c}"]`)?.focus({ preventScroll: true });
});

// ---------------------------------------------------------------- settings

function renderSettings(): void {
  const s = profile.input;
  $<HTMLInputElement>('#s-name').value = profile.name;
  const slider = (id: string, v: number) => {
    const el = $<HTMLInputElement>(id);
    el.value = String(v);
    el.nextElementSibling!.textContent = String(v);
  };
  slider('#s-sens', s.sens);
  slider('#s-ads', s.adsSens);
  slider('#s-pad', s.padSens);
  slider('#s-fov', profile.fov);
  slider('#s-vol', profile.volume);
  $<HTMLInputElement>('#s-invert').checked = s.invert;
  $<HTMLInputElement>('#s-assist').checked = s.aimAssist;
  $<HTMLInputElement>('#s-toggle').checked = s.toggleAds;
  $<HTMLInputElement>('#s-ann').checked = profile.announcer;
  setSeg('#s-quality', profile.quality);
}
$('#settings').addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement;
  const s = profile.input;
  const v = Number(el.value);
  if (el.type === 'range') el.nextElementSibling!.textContent = el.value;
  if (el.id === 's-name') profile.name = el.value.trim().slice(0, 16) || 'Soldier';
  if (el.id === 's-sens') s.sens = v;
  if (el.id === 's-ads') s.adsSens = v;
  if (el.id === 's-pad') s.padSens = v;
  if (el.id === 's-fov') {
    profile.fov = v;
    if (match) match.settings.fov = v;
  }
  if (el.id === 's-vol') {
    profile.volume = v;
    audio.setVolume(v);
  }
  if (el.id === 's-invert') s.invert = el.checked;
  if (el.id === 's-assist') s.aimAssist = el.checked;
  if (el.id === 's-toggle') s.toggleAds = el.checked;
  if (el.id === 's-ann') {
    profile.announcer = el.checked;
    audio.announcer = el.checked;
  }
  save();
});
seg('#s-quality', profile.quality, (v) => ((profile.quality = v as 'high' | 'low'), save()));

// ============================================================================ matches

let match: Match | null = null;
let lastLocal: (() => Promise<void>) | null = null;

function loadout(): Loadout {
  return profile.classes[profile.cls] ?? profile.classes[0]!;
}

let loading = false;
const bar = (f: number) => ($('#l-bar').style.width = `${(f * 100).toFixed(1)}%`);

/**
 * Everything a match needs happens behind the loading bar: models, the session
 * (sim, nav), then the map, shaders and first shadowed frame (Match.load).
 */
/** Extra players' input readers (made once: each one listens to the window). */
const extraInputs: FpsInput[] = [];
function inputFor(i: number, src: InputSource): FpsInput {
  if (i === 0) {
    input.source = src;
    return input;
  }
  let inp = extraInputs[i - 1];
  if (!inp) extraInputs[i - 1] = inp = new FpsInput($('#view'), src);
  inp.source = src;
  inp.settings = profile.input;
  return inp;
}

async function runMatch(props: string[], make: () => Session, say: string, localIds?: string[]): Promise<void> {
  if (loading) return;
  loading = true;
  match?.dispose();
  match = null;
  $('#loading').classList.remove('hidden');
  bar(0);
  try {
    await preload(props, (f) => bar(f * 0.4));
    const session = make();
    const ids = localIds ?? [session.meId];
    const srcs = splitSources(ids.length);
    const m = new Match($('#view'), session, ids.map((id, i) => ({ id, input: inputFor(i, srcs[i]!) })), audio, { fov: profile.fov, quality: profile.quality });
    m.onPause = pause;
    m.onOver = (g) => showEnd(g);
    await m.load((f) => bar(0.4 + f * 0.55));
    renderPauseClasses();
    await prerenderThumbs($('#p-classes'));
    bar(1);
    match = m;
    // Pre-roll a few real (paused) frames behind the bar: first-frame GPU syncs land here, not in the first second of play.
    for (let i = 0; i < 4; i++) {
      m.frame(0);
      await new Promise<void>((res) => requestAnimationFrame(() => setTimeout(res, 0)));
    }
  } finally {
    loading = false;
    $('#loading').classList.add('hidden');
  }
  show('game');
  input.lock();
  audio.say(say);
}

const BOT_NAMES = ['Ghost', 'Soap', 'Price', 'Gaz', 'Roach', 'Nikolai', 'Yuri', 'Farah', 'Alex', 'Kyle', 'Hesh', 'Logan', 'Keegan', 'Merrick', 'Kick', 'Ajax', 'Rook', 'Dutch', 'Ripper', 'Sarge', 'Vasquez', 'Mara', 'Tank', 'Hawk', 'Wolf', 'Viper', 'Echo', 'Bishop', 'Reyes', 'Kowalski', 'Novak', 'Ortiz', 'Sasha', 'Dmitri', 'Okafor', 'Lindqvist'];

async function startLocal(): Promise<void> {
  lastLocal = startLocal;
  const map = MAPS.find((m) => m.id === profile.map) ?? MAPS[0]!;
  const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
  const n = Math.max(1, Math.min(4, profile.split));
  const splitClasses = uniqueSplitClassIndexes(n);
  const ffa = profile.mode === 'ffa';
  // Local players: together on one team, or alternating teams (versus).
  const setups: SoldierSetup[] = Array.from({ length: n }, (_, i) => ({
    id: i === 0 ? 'me' : `p${i + 1}`,
    name: i === 0 ? profile.name : `Player ${i + 1}`,
    team: (profile.splitTeams === 'versus' ? i % 2 : 0) as 0 | 1,
    bot: false,
    loadout: structuredClone(profile.classes[splitClasses[i]!] ?? loadout()),
    camos: profile.camos,
  }));
  const per = profile.bots;
  const camoPool = ['none', 'woodland', 'desert', 'urban', 'digital', 'tiger', 'gold'];
  let bi = 0;
  const addBot = (team: 0 | 1) => {
    const cls = DEFAULT_CLASSES[Math.floor(Math.random() * DEFAULT_CLASSES.length)]!;
    setups.push({ id: `bot${bi}`, name: names.pop() ?? `Bot${bi}`, team, bot: true, loadout: cls, camos: { [cls.primary]: camoPool[Math.floor(Math.random() * camoPool.length)]! } });
    bi++;
  };
  // Teams fill up to `per` each (FFA: `per` × 2 players in total).
  if (ffa) while (setups.length < Math.max(2, per * 2)) addBot(0);
  else for (const t of [0, 1] as const) while (setups.filter((s) => s.team === t).length < per) addBot(t);
  await runMatch(
    map.props.map((p) => p.model),
    () => new LocalSession(new Game(map.id, { mode: profile.mode }, setups), profile.skill, setups.filter((s) => !s.bot).map((s) => s.id)),
    `${MODES[profile.mode].name}. ${map.name}. Good luck.`,
    setups.filter((s) => !s.bot).map((s) => s.id),
  );
}

/** The pause menu's class list: rebuilt only when the classes change (its thumbnails are rendered at match start). */
let pauseKey = '';
function renderPauseClasses(): void {
  const key = JSON.stringify([profile.classes, profile.camos]);
  if (key !== pauseKey) {
    pauseKey = key;
    $('#p-classes').innerHTML = profile.classes.map((c, i) => `<button data-i="${i}">${gimg(c.primary, undefined, c.primaryAtt)}<span>${esc(c.name.toUpperCase())}<small>${WEAPON[c.primary]?.name} · ${WEAPON[c.secondary]?.name}</small></span></button>`).join('');
  }
  $('#p-classes').querySelectorAll<HTMLElement>('[data-i]').forEach((b) => b.classList.toggle('on', Number(b.dataset.i) === profile.cls));
}

function pause(): void {
  if (!match || match.over) return;
  input.unlock();
  renderPauseClasses();
  show('pause');
  thumbs($('#p-classes'));
}
$('#p-classes').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
  if (!b || !match) return;
  profile.cls = Number(b.dataset.i);
  save();
  // Applies on the next spawn (like the real thing).
  match.me.nextLoadout = structuredClone(loadout());
  (match.session as Session & { setClass?: (l: Loadout) => void }).setClass?.(loadout());
  pause();
});
$('#p-resume').addEventListener('click', resume);
function resume(): void {
  show('game');
  input.lock();
}
$('#p-settings').addEventListener('click', () => {
  renderSettings();
  show('settings');
});
$('#p-leave').addEventListener('click', () => leave());
function leave(): void {
  match?.dispose();
  match = null;
  void net?.leave();
  net = null;
  show('menu');
}

function showEnd(g: Game): void {
  // Left (or started another match) during the end delay: nothing to show.
  if (!match || match.session.game !== g) return;
  const me = g.soldier(match.session.meId);
  if (!me) return;
  input.unlock();
  const won = g.mode === 'ffa' ? [...g.soldiers].sort((a, b) => b.kills - a.kills)[0] === me : g.winner === me.team;
  const draw = g.mode !== 'ffa' && g.winner === -1;
  profile.xp += me.score + (won ? 500 : 100);
  save();
  $('#e-result').innerHTML = `<div class="zh-result__big ${draw ? '' : won ? 'win' : 'lose'}">${draw ? 'DRAW' : won ? 'VICTORY' : 'DEFEAT'}</div><div class="zh-result__sub">${MODES[g.mode].name} · ${g.map.name} · ${g.mode === 'ffa' ? `${me.kills} kills` : `${g.score[me.team]} – ${g.score[1 - me.team]}`}</div>
    <div class="zh-result__me"><span>SCORE <b>${me.score}</b></span><span>KILLS <b>${me.kills}</b></span><span>DEATHS <b>${me.deaths}</b></span><span>BEST STREAK <b>${me.bestStreak}</b></span><span>XP <b>+${me.score + (won ? 500 : 100)}</b></span></div>`;
  $('#e-board').innerHTML = scoreboard(g, me.id);
  $('#e-again').textContent = match?.session.online ? 'BACK TO LOBBY' : 'PLAY AGAIN';
  show('end');
}
$('#e-menu').addEventListener('click', () => leave());
$('#e-again').addEventListener('click', () => {
  if (match?.session.online) {
    match.dispose();
    match = null;
    show('online');
    $('#o-connect').classList.add('hidden');
    $('#o-lobby').classList.remove('hidden');
    renderLobby();
  } else void lastLocal?.();
});

// Clicking the game view re-locks the mouse.
$('#click').addEventListener('click', () => input.lock());
document.addEventListener('pointerlockchange', () => {
  syncClickPrompt();
  // Esc releases the lock: open the pause menu like the real game.
  if (!input.locked && !input.hasPad && screen === 'game' && match && !match.over) pause();
});

// ============================================================================ online

let net: FpsNet | null = null;
let lobby: FpLobby | null = null;
let lanUrl: string | null = null;
const oCode = $<HTMLInputElement>('#o-code');
oCode.addEventListener('input', () => (oCode.value = oCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4)));
const oStatus = (t: string, err = false) => {
  $('#o-status').textContent = t;
  $('#o-status').classList.toggle('error', err);
};

async function openOnline(code = ''): Promise<void> {
  show('online');
  $('#o-connect').classList.remove('hidden');
  $('#o-lobby').classList.add('hidden');
  if (code) oCode.value = code.toUpperCase().slice(0, 4);
  oStatus('');
  const probe = new FpsNet();
  $('#o-server').textContent = `Server: ${probe.url.replace(/^wss?:\/\//, '')}`;
  const info = await probe.probe();
  if (!info.ok) oStatus("Can't reach the game server. Run `npm run dev` (or `npm run lan` for home Wi-Fi).", true);
  if (info.lan?.length) {
    const ip = /^(localhost|127\.)/.test(location.hostname) ? info.lan[0] : location.hostname;
    lanUrl = `${location.protocol}//${ip}${location.port ? `:${location.port}` : ''}${location.pathname}`;
    $('#o-title').textContent = 'LAN PARTY';
    $('#o-sub').textContent = 'Same Wi-Fi · 60 Hz server · zero lag';
    $('#o-lan-url').textContent = lanUrl;
    $('#o-lan').classList.remove('hidden');
  }
  if (code) void connect((n) => n.join(code, profile.name, loadout(), profile.camos));
}

async function connect(how: (n: FpsNet) => Promise<void>): Promise<void> {
  if (net?.room) return;
  oStatus('Connecting…');
  const n = new FpsNet();
  try {
    await how(n);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    oStatus(/not found/i.test(msg) ? 'No lobby with that code.' : /locked|full|maxClients/i.test(msg) ? 'That lobby is full or in a match.' : msg, true);
    return;
  }
  net = n;
  oStatus('');
  n.onLobby = (l) => {
    lobby = l;
    renderLobby();
  };
  n.onBegin = (b) => {
    const map = MAPS.find((m) => m.id === b.map) ?? MAPS[0]!;
    // The session starts listening straight away (snapshots queue while the map loads).
    const session = new OnlineSession(n, b);
    void runMatch(map.props.map((p) => p.model), () => session, `${MODES[b.mode].name}. ${map.name}. Good luck.`);
  };
  n.onError = (m) => oStatus(m, true);
  n.onClosed = (reason) => {
    if (net !== n) return;
    net = null;
    if (match?.session.online) {
      leave();
      oStatus(reason ?? 'Disconnected.', true);
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
  for (const t of [0, 1] as const)
    $(`#o-t${t}`).innerHTML = l.players
      .filter((p) => p.team === t)
      .map((p) => `<div class="zh-lp ${p.id === net!.sessionId ? 'me' : ''}"><b>${esc(p.name)}</b><small>${p.id === l.hostId ? 'HOST' : ''}${p.connected ? '' : ' · reconnecting'}</small></div>`)
      .join('') + (l.config.bots ? `<div class="zh-lp bot"><small>+ bots to ${l.config.bots}</small></div>` : '');
  $('#o-host').classList.toggle('hidden', !host || l.phase !== 'lobby');
  setSeg('#o-mode', l.config.mode);
  setSeg('#o-map', l.config.map);
  setSeg('#o-bots', String(l.config.bots));
  setSeg('#o-skill', l.config.skill);
  $('#o-wait').textContent = l.phase === 'playing' ? 'Match in progress…' : host ? 'Pick teams and settings, then start.' : 'Waiting for the host…';
  $('#o-start').classList.toggle('hidden', !host || l.phase !== 'lobby');
}

$('#o-create').addEventListener('click', () => void connect((n) => n.create(profile.name, loadout(), profile.camos)));
$('#o-quick').addEventListener('click', () => void connect((n) => n.quick(profile.name, loadout(), profile.camos)));
$('#o-join').addEventListener('click', () => {
  if (oCode.value.length < 4) return oStatus('Lobby codes have 4 characters.', true);
  void connect((n) => n.join(oCode.value, profile.name, loadout(), profile.camos));
});
$('#o-j0').addEventListener('click', () => net?.team(0));
$('#o-j1').addEventListener('click', () => net?.team(1));
for (const [sel, key] of [['#o-mode', 'mode'], ['#o-map', 'map'], ['#o-bots', 'bots'], ['#o-skill', 'skill']] as const)
  $(sel).addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (b) net?.config({ [key]: key === 'bots' ? Number(b.dataset.v) : b.dataset.v });
  });
$('#o-start').addEventListener('click', () => net?.start());
$('#o-copy').addEventListener('click', () => {
  const url = `${lanUrl ?? location.origin + location.pathname}?room=${net?.code ?? ''}`;
  void navigator.clipboard?.writeText(url).then(
    () => oStatus('Invite link copied!'),
    () => oStatus(url),
  );
});
$('#o-back').addEventListener('click', () => {
  void net?.leave();
  net = null;
  show('menu');
});

// ============================================================================ loop

let lastT = performance.now();
function loop(now: number): void {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  if (match && (screen === 'game' || screen === 'pause' || screen === 'end' || screen === 'settings')) match.frame(screen === 'game' || match.session.online ? dt : 0);
  else if (screen !== 'game') menuPad();
}
requestAnimationFrame(loop);

/** Controller navigation in menus. */
function menuPad(): void {
  const p = input.menuPad();
  if (!p.up && !p.down && !p.left && !p.right && !p.ok && !p.back) return;
  const root = $(`#${screen}`);
  const items = [...root.querySelectorAll<HTMLElement>('button:not([disabled]), a.zh-btn, input')].filter((e) => e.offsetParent !== null);
  const cur = document.activeElement as HTMLElement | null;
  if (p.ok) cur?.click();
  if (p.back) {
    if (screen === 'pause') resume();
    else if (screen !== 'menu') show('menu');
  }
  if (!p.up && !p.down && !p.left && !p.right) return;
  if (!cur || !items.includes(cur)) return void items[0]?.focus();
  const r = cur.getBoundingClientRect();
  let best: HTMLElement | null = null;
  let bd = Infinity;
  for (const it of items) {
    if (it === cur) continue;
    const q = it.getBoundingClientRect();
    const dx = q.left + q.width / 2 - (r.left + r.width / 2);
    const dy = q.top + q.height / 2 - (r.top + r.height / 2);
    const ok = p.up ? dy < -4 : p.down ? dy > 4 : p.left ? dx < -4 : dx > 4;
    if (!ok) continue;
    const d = p.up || p.down ? Math.abs(dy) + Math.abs(dx) * 2 : Math.abs(dx) + Math.abs(dy) * 2;
    if (d < bd) {
      bd = d;
      best = it;
    }
  }
  best?.focus();
}

renderProfile();
const q = new URLSearchParams(location.search);
if (q.get('room')) void openOnline(q.get('room')!);
else if (q.has('play')) void startLocal();
(window as unknown as Record<string, unknown>).__zh = {
  get match() {
    return match;
  },
  profile,
  audio,
  /** Dev: render every map's menu shot (data URLs) — saved as assets/fps/thumbs/<id>.jpg. */
  async bakeMapThumbs() {
    await preload(MAPS.flatMap((m) => m.props.map((p) => p.model)));
    return Object.fromEntries(MAPS.map((m) => [m.id, mapThumb(m.id)]));
  },
};
