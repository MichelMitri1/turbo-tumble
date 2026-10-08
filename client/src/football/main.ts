import * as THREE from 'three';
import './styles.css';
import { bindFullscreenButton, installFullscreenKey } from '../ui/fullscreen';
import { CLUBS, CLUB, clubRatings, kitsFor, type Club, type Kit, type PlayerDef } from './sim/data';
import { MatchSim, GOAL_PAUSE, PITCH, TICK, type Input, type MatchEvent, type TeamStats } from './sim/match';
import { readFrame, writeFrame, lerpFrame, type Frame } from './sim/snapshot';
import { MatchView, HUMAN_COLORS, type CameraMode } from './render/view';
import { loadPlayerModel } from './render/players';
import { Hud, badgeSvg, kitSvg } from './hud';
import { MatchAudio, LINES } from './audio';
import { installKeys, readDevice, connectedPads, deviceName, readKeyboard, readPad, type DeviceId, type Pad } from './input';
import { FootballNet } from './net/online';
import { INPUT_BITS, FB_MAX_PER_TEAM, type FbBegin, type FbLobby, type FbConfig } from './net/protocol';

/**
 * Matchday 27 — eleven-a-side football in the style of the big yearly football game:
 * fictional clubs with rated squads, FC "classic" controls, a broadcast camera, crowd and
 * commentary, replays — vs the CPU, same-screen with friends, or online / LAN.
 */

// ---------------------------------------------------------------- settings

interface Profile {
  name: string;
  half: number;
  difficulty: FbConfig['difficulty'];
  camera: CameraMode;
  zoom: number;
  commentary: boolean;
  volume: number;
  home: string;
  away: string;
}
const PROFILE_KEY = 'matchday:profile';
const profile: Profile = (() => {
  const d: Profile = { name: '', half: 180, difficulty: 'pro', camera: 'broadcast', zoom: 1, commentary: true, volume: 0.8, home: 'nbu', away: 'val' };
  try {
    return { ...d, ...(JSON.parse(localStorage.getItem(PROFILE_KEY) ?? '{}') as Partial<Profile>) };
  } catch {
    return d;
  }
})();
const save = () => {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    /* storage blocked */
  }
};

const HALVES: Array<[number, string]> = [
  [60, '2 min'],
  [120, '4 min'],
  [180, '6 min'],
  [240, '8 min'],
  [300, '10 min'],
  [360, '12 min'],
  [600, '20 min'],
];
const DIFFS: Array<[FbConfig['difficulty'], string]> = [
  ['amateur', 'Amateur'],
  ['pro', 'Professional'],
  ['world', 'World Class'],
  ['legendary', 'Legendary'],
];

// ---------------------------------------------------------------- page

const root = document.getElementById('game')!;
root.innerHTML = `<canvas class="fb-canvas"></canvas><div class="fb-ui"></div>`;
const canvas = root.querySelector('canvas') as HTMLCanvasElement;
const ui = root.querySelector('.fb-ui') as HTMLDivElement;
installKeys();
installFullscreenKey();
const audio = new MatchAudio();
audio.volume = profile.volume;
audio.commentary = profile.commentary;
let renderer: THREE.WebGLRenderer | null = null;
function getRenderer(): THREE.WebGLRenderer {
  if (renderer) return renderer;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
function screen(html: string, cls = ''): HTMLDivElement {
  ui.innerHTML = `<div class="fb-screen ${cls}">${html}</div>`;
  menuFocus = 0;
  return ui.firstElementChild as HTMLDivElement;
}

// ---------------------------------------------------------------- menu navigation (keyboard / pad)

let menuFocus = 0;
let menuActive = true;
let prevNav = { x: 0, y: 0, a: false, b: false };
function menuNav(): void {
  if (!menuActive) return;
  const pads = connectedPads().map((i) => readPad(i)!).filter(Boolean);
  let x = 0;
  let y = 0;
  let a = false;
  let b = false;
  for (const p of pads) {
    if (Math.abs(p.sx) > 0.6) x = Math.sign(p.sx);
    if (Math.abs(p.sy) > 0.6) y = -Math.sign(p.sy);
    a ||= p.pass;
    b ||= p.shoot;
  }
  const btns = [...ui.querySelectorAll<HTMLElement>('[data-nav]')].filter((e) => e.offsetParent !== null);
  if (btns.length) {
    if (y && y !== prevNav.y) menuFocus = (menuFocus + y + btns.length) % btns.length;
    if (x && x !== prevNav.x) {
      const el = btns[menuFocus];
      el?.dispatchEvent(new CustomEvent('navx', { detail: x }));
    }
    btns.forEach((e, i) => e.classList.toggle('focus', i === menuFocus && pads.length > 0));
    if (a && !prevNav.a) btns[menuFocus]?.click();
  }
  if (b && !prevNav.b) ui.querySelector<HTMLElement>('[data-back]')?.click();
  prevNav = { x, y, a, b };
}
setInterval(menuNav, 50);

// ---------------------------------------------------------------- main menu

function mainMenu(): void {
  menuActive = true;
  const s = screen(
    `<div class="fb-title"><div class="logo">MATCHDAY<span>27</span></div><div class="sub">Eleven-a-side football · ${CLUBS.length} clubs · FC-style controls</div></div>
    <div class="fb-menu">
      <button data-nav data-a="kickoff" class="big">⚽ Kick-Off</button>
      <button data-nav data-a="online">🌐 Online · LAN</button>
      <button data-nav data-a="settings">⚙️ Settings</button>
      <button data-nav data-a="controls">🎮 Controls</button>
      <button data-nav data-a="fs">⛶ Fullscreen</button>
      <a data-nav href="/" class="btn ghost">← Arcade</a>
    </div>`,
    'home',
  );
  s.querySelector('[data-a=kickoff]')!.addEventListener('click', () => teamSelect());
  s.querySelector('[data-a=online]')!.addEventListener('click', () => onlineMenu());
  s.querySelector('[data-a=settings]')!.addEventListener('click', () => settings(mainMenu));
  s.querySelector('[data-a=controls]')!.addEventListener('click', () => controls(mainMenu));
  bindFullscreenButton(s.querySelector('[data-a=fs]') as HTMLElement);
}

// ---------------------------------------------------------------- player cards

function cardTier(ovr: number): string {
  return ovr >= 75 ? 'gold' : ovr >= 65 ? 'silver' : 'bronze';
}
function playerCard(p: PlayerDef, club: Club, kit: Kit): string {
  const s = p.stats;
  const st =
    p.role === 'GK'
      ? [
          ['DIV', s.gk],
          ['HAN', s.gk - 3],
          ['KIC', s.pas + 6],
          ['REF', s.gk + 2],
          ['SPD', s.pac],
          ['POS', s.gk - 1],
        ]
      : [
          ['PAC', s.pac],
          ['SHO', s.sho],
          ['PAS', s.pas],
          ['DRI', s.dri],
          ['DEF', s.def],
          ['PHY', s.phy],
        ];
  return `<div class="fut ${cardTier(p.ovr)}">
    <div class="fut-top"><div class="fut-ovr">${p.ovr}</div><div class="fut-pos">${p.role}</div>${badgeSvg(club, 26)}</div>
    <div class="fut-kit">${kitSvg(p.role === 'GK' ? club.gk : kit, 74, String(p.num))}</div>
    <div class="fut-name">${esc(p.name)}</div>
    <div class="fut-stats">${st.map(([k, v]) => `<span><b>${Math.min(99, Number(v))}</b> ${k}</span>`).join('')}</div>
  </div>`;
}

function clubPanel(club: Club, side: 'HOME' | 'AWAY', kit: Kit): string {
  const r = clubRatings(club);
  const stars = Math.max(1, Math.min(5, Math.round((r.ovr - 70) / 3.2 * 2) / 2));
  const starHtml = `<span class="on">${'★'.repeat(Math.floor(stars))}</span>${stars % 1 ? '<span class="half">★</span>' : ''}<span class="off">${'★'.repeat(5 - Math.ceil(stars))}</span>`;
  const top = [...club.players.slice(0, 11)].sort((a, b) => b.ovr - a.ovr).slice(0, 3);
  const bar = (k: string, v: number) => `<div class="rt"><span>${k}</span><em><i style="width:${(v - 50) * 2}%"></i></em><b>${v}</b></div>`;
  return `<div class="cp-side">${side}</div>
    <div class="cp-head"><button data-nav class="arrow" data-d="-1">◀</button>${badgeSvg(club, 92)}<button class="arrow" data-d="1">▶</button></div>
    <div class="cp-name">${club.name}</div>
    <div class="cp-meta">${club.stadium} · ${club.formation}</div>
    <div class="cp-stars">${starHtml}</div>
    <div class="cp-row"><div class="cp-kit">${kitSvg(kit, 86)}</div><div class="cp-rt">${bar('ATT', r.att)}${bar('MID', r.mid)}${bar('DEF', r.def)}${bar('OVR', r.ovr)}</div></div>
    <div class="cp-cards">${top.map((p) => playerCard(p, club, kit)).join('')}</div>`;
}

function teamSelect(): void {
  const s = screen(
    `<h1>Choose your teams</h1>
    <div class="fb-teams"><div class="cp" data-side="0"></div><div class="vs">VS</div><div class="cp" data-side="1"></div></div>
    <div class="fb-bar">
      <button data-back class="ghost">← Back</button>
      <label>Half length <select data-k="half">${HALVES.map(([v, l]) => `<option value="${v}" ${v === profile.half ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Difficulty <select data-k="difficulty">${DIFFS.map(([v, l]) => `<option value="${v}" ${v === profile.difficulty ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <button data-nav class="go">Next ▶</button>
    </div>`,
    'teams',
  );
  const ids = CLUBS.map((c) => c.id);
  if (!CLUB[profile.home]) profile.home = ids[0]!;
  if (!CLUB[profile.away] || profile.away === profile.home) profile.away = ids.find((i) => i !== profile.home)!;
  const draw = () => {
    const kits = kitsFor(CLUB[profile.home]!, CLUB[profile.away]!);
    for (const side of [0, 1] as const) {
      const el = s.querySelector(`[data-side="${side}"]`) as HTMLElement;
      el.innerHTML = clubPanel(CLUB[side ? profile.away : profile.home]!, side ? 'AWAY' : 'HOME', kits[side]);
      el.querySelectorAll<HTMLElement>('.arrow').forEach((b) =>
        b.addEventListener('click', () => {
          const key = side ? 'away' : 'home';
          const other = side ? profile.home : profile.away;
          let i = ids.indexOf(profile[key]);
          do i = (i + Number(b.dataset.d) + ids.length) % ids.length;
          while (ids[i] === other);
          profile[key] = ids[i]!;
          save();
          draw();
        }),
      );
      el.querySelector('[data-nav]')!.addEventListener('navx', (e) => (el.querySelector(`.arrow[data-d="${(e as CustomEvent).detail}"]`) as HTMLElement).click());
    }
  };
  draw();
  s.querySelector('[data-back]')!.addEventListener('click', mainMenu);
  s.querySelector<HTMLSelectElement>('[data-k=half]')!.addEventListener('change', (e) => {
    profile.half = Number((e.target as HTMLSelectElement).value);
    save();
  });
  s.querySelector<HTMLSelectElement>('[data-k=difficulty]')!.addEventListener('change', (e) => {
    profile.difficulty = (e.target as HTMLSelectElement).value as Profile['difficulty'];
    save();
  });
  s.querySelector('.go')!.addEventListener('click', controllerSelect);
}

// ---------------------------------------------------------------- controller select (FC style: push your pad left / right)

function controllerSelect(): void {
  const devices = (): DeviceId[] => [...connectedPads().map((i) => `pad${i}` as DeviceId), 'kb1', 'kb2'];
  const side = new Map<DeviceId, -1 | 0 | 1>();
  const first = devices()[0]!;
  side.set(first, -1);
  const s = screen(
    `<h1>Select sides</h1>
    <div class="fb-ctl-head"><div>${badgeSvg(CLUB[profile.home]!, 54)}<b>${CLUB[profile.home]!.name}</b></div><div>CPU</div><div>${badgeSvg(CLUB[profile.away]!, 54)}<b>${CLUB[profile.away]!.name}</b></div></div>
    <div class="fb-ctl"></div>
    <p class="hint">Push left / right on your controller (or the arrows) to pick a side. Nobody on a side = the CPU plays it. Up to 4 per side.</p>
    <div class="fb-bar"><button data-back class="ghost">← Back</button><button data-nav class="go">Kick-Off ▶</button></div>`,
    'ctl',
  );
  const list = s.querySelector('.fb-ctl') as HTMLElement;
  let prev = new Map<DeviceId, number>();
  const draw = () => {
    list.innerHTML = devices()
      .map((d, k) => {
        const v = side.get(d) ?? 0;
        return `<div class="ctl-row" data-d="${d}"><div class="ctl-slot">${v === -1 ? `<span class="tok" style="--c:${HUMAN_COLORS[k]}">${deviceName(d)}</span>` : ''}</div><div class="ctl-slot mid"><button class="arrow" data-m="-1">◀</button>${v === 0 ? `<span class="tok idle">${deviceName(d)}</span>` : ''}<button class="arrow" data-m="1">▶</button></div><div class="ctl-slot">${v === 1 ? `<span class="tok" style="--c:${HUMAN_COLORS[k]}">${deviceName(d)}</span>` : ''}</div></div>`;
      })
      .join('');
    list.querySelectorAll<HTMLElement>('.ctl-row').forEach((row) =>
      row.querySelectorAll<HTMLElement>('.arrow').forEach((b) =>
        b.addEventListener('click', () => {
          const d = row.dataset.d as DeviceId;
          side.set(d, Math.max(-1, Math.min(1, (side.get(d) ?? 0) + Number(b.dataset.m))) as -1 | 0 | 1);
          draw();
        }),
      ),
    );
  };
  draw();
  // Each device moves its own token.
  const poll = window.setInterval(() => {
    if (!document.body.contains(list)) return clearInterval(poll);
    let changed = false;
    const now = new Map<DeviceId, number>();
    for (const d of devices()) {
      const p = readDevice(d);
      const x = Math.abs(p.sx) > 0.6 ? Math.sign(p.sx) : 0;
      now.set(d, x);
      if (x && x !== prev.get(d)) {
        const cur = side.get(d) ?? 0;
        const next = Math.max(-1, Math.min(1, cur + x)) as -1 | 0 | 1;
        const count = [...side.entries()].filter(([k, v]) => k !== d && v === next).length;
        if (next === 0 || count < 4) side.set(d, next);
        changed = true;
      }
    }
    prev = now;
    if (changed) draw();
  }, 40);
  s.querySelector('[data-back]')!.addEventListener('click', () => {
    clearInterval(poll);
    teamSelect();
  });
  s.querySelector('.go')!.addEventListener('click', () => {
    clearInterval(poll);
    const locals = [...side.entries()].filter(([, v]) => v !== 0).map(([d, v]) => ({ device: d, team: (v === -1 ? 0 : 1) as 0 | 1 }));
    void startLocal(locals);
  });
}

// ---------------------------------------------------------------- settings / controls

function settings(back: () => void): void {
  const opt = <T extends string | number>(k: keyof Profile, list: Array<[T, string]>) => `<select data-k="${k}">${list.map(([v, l]) => `<option value="${v}" ${profile[k] === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const s = screen(
    `<h1>Settings</h1>
    <div class="fb-form">
      <label>Half length ${opt('half', HALVES)}</label>
      <label>Difficulty ${opt('difficulty', DIFFS)}</label>
      <label>Camera ${opt('camera', [
        ['broadcast', 'Broadcast (default)'],
        ['tele', 'Tele broadcast (wide)'],
        ['end', 'End to end'],
      ] as Array<[CameraMode, string]>)}</label>
      <label>Camera zoom <input type="range" min="0.75" max="1.4" step="0.05" data-k="zoom" value="${profile.zoom}"></label>
      <label>Commentary <input type="checkbox" data-k="commentary" ${profile.commentary ? 'checked' : ''}></label>
      <label>Volume <input type="range" min="0" max="1" step="0.05" data-k="volume" value="${profile.volume}"></label>
    </div>
    <div class="fb-bar"><button data-back data-nav class="ghost">← Back</button></div>`,
  );
  s.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-k]').forEach((el) =>
    el.addEventListener('change', () => {
      const k = el.dataset.k as keyof Profile;
      const v = el instanceof HTMLInputElement && el.type === 'checkbox' ? el.checked : el instanceof HTMLInputElement && el.type === 'range' ? Number(el.value) : k === 'half' ? Number(el.value) : el.value;
      (profile as unknown as Record<string, unknown>)[k] = v;
      audio.commentary = profile.commentary;
      audio.setVolume(profile.volume);
      if (game) {
        game.view.cameraMode = profile.camera;
        game.view.zoom = profile.zoom;
      }
      save();
    }),
  );
  s.querySelector('[data-back]')!.addEventListener('click', back);
}

const CONTROLS: Array<[string, string, string]> = [
  ['Move', 'Left stick', 'WASD · Arrows'],
  ['Sprint', 'R2', 'Left Shift · Right Shift'],
  ['Short pass / Header', '✕', 'J · ,'],
  ['Shoot (hold = power)', '○', 'K · .'],
  ['Through ball', '△', 'L · /'],
  ['Lob pass / Cross', '□', 'I · ;'],
  ['Finesse shot', 'R1 + ○', 'U + K'],
  ['Chip shot / Lofted through', 'L1 + ○ / L1 + △', 'O + K / O + L'],
  ['Knock-on', 'R3 / flick R-stick ↑', 'E · N'],
  ['Defending: contain (jockey)', 'hold ✕', 'hold J'],
  ['Defending: standing tackle', '○', 'K'],
  ['Defending: slide tackle', '□', 'I'],
  ['Switch player (nearest to the ball)', 'L1', 'Q · M'],
  ['Keeper with the ball: throw / kick out', '✕ · △ / ○ · □', 'J · L / K · I'],
  ['Keeper with the ball: drop it to your feet', 'R3', 'E · N'],
  ['Pause', 'OPTIONS', 'Esc · Backspace'],
];
function controls(back: () => void): void {
  const s = screen(
    `<h1>Controls</h1><p class="hint">FC "Classic" layout. Hold a button to add power (watch the bar over your player); aim with the stick. Passes go to the team-mate you aim at.</p>
    <table class="fb-ctrls"><tr><th></th><th>PS4 / PS5</th><th>Keyboard (P1 · P2)</th></tr>${CONTROLS.map(([a, b, c]) => `<tr><td>${a}</td><td>${b}</td><td>${c}</td></tr>`).join('')}</table>
    <div class="fb-bar"><button data-back data-nav class="ghost">← Back</button></div>`,
  );
  s.querySelector('[data-back]')!.addEventListener('click', back);
}

// ---------------------------------------------------------------- the match

interface LocalPlayer {
  device: DeviceId;
  team: 0 | 1;
}

/** Turn a stick (screen space) into a pitch direction for the current camera. */
function toPitch(view: MatchView, sx: number, sy: number): [number, number] {
  const d = new THREE.Vector3();
  view.camera.getWorldDirection(d);
  const l = Math.hypot(d.x, d.z) || 1;
  const fx = d.x / l;
  const fz = d.z / l;
  return [sx * -fz + sy * fx, sx * fx + sy * fz];
}
function padToInput(view: MatchView, p: Pad): Input {
  const [mx, mz] = toPitch(view, p.sx, p.sy);
  return { mx, mz, sprint: p.sprint, pass: p.pass, shoot: p.shoot, through: p.through, lob: p.lob, finesse: p.finesse, chip: p.chip, switch: p.switch, skill: p.skill };
}

let game: Game | null = null;

class Game {
  readonly view: MatchView;
  readonly hud: Hud;
  private raf = 0;
  private last = performance.now();
  private acc = 0;
  paused = false;
  /** Recent frames for replays: [sim time, packed frame]. */
  private history: Array<[number, Float32Array]> = [];
  private goalAt = -1;
  private goalEnd = 1;
  private replayT = -1;
  private lastShotAt = -10;
  private frame: Frame | null = null;
  private stats: [TeamStats, TeamStats] | null = null;
  private goals: Array<{ team: 0 | 1; p: number; minute: number; own: boolean }> = [];
  private ended = false;
  private prevPause = false;
  private prevSkip = false;
  private resizeObs: () => void;
  /** Online: frames from the server and our estimate of its clock. */
  private netFrames: Frame[] = [];
  private serverClock = 0;
  private serverAt = 0;
  private sentAt = 0;

  constructor(
    readonly clubs: [Club, Club],
    readonly kits: [Kit, Kit],
    readonly sim: MatchSim | null,
    readonly locals: LocalPlayer[],
    readonly humanNames: string[],
    readonly net: FootballNet | null = null,
    readonly myHuman = -1,
  ) {
    menuActive = false;
    ui.innerHTML = '';
    this.view = new MatchView(clubs, kits);
    this.view.cameraMode = profile.camera;
    this.view.zoom = profile.zoom;
    this.hud = new Hud(ui, clubs, kits, humanNames);
    this.resizeObs = () => this.resize();
    window.addEventListener('resize', this.resizeObs);
    this.resize();
    audio.resume();
    audio.startCrowd();
    audio.say(LINES.kickoff(clubs[0].name, clubs[1].name, clubs[0].stadium), true);
    this.raf = requestAnimationFrame((t) => this.loop(t));
  }

  playerName(i: number): string {
    const p = this.clubs[i < 11 ? 0 : 1].players[i % 11];
    return p?.name ?? '';
  }

  private resize(): void {
    const r = getRenderer();
    const w = window.innerWidth;
    const h = window.innerHeight;
    r.setSize(w, h, false);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    this.view.camera.aspect = w / h;
    this.view.camera.fov = w / h < 1.4 ? 38 : 30;
    this.view.camera.updateProjectionMatrix();
    this.view.camera.userData.w = w;
    this.view.camera.userData.h = h;
  }

  private loop(now: number): void {
    this.raf = requestAnimationFrame((t) => this.loop(t));
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    // Pause / skip (any local device).
    const pads = this.locals.length ? this.locals.map((l) => readDevice(l.device)) : [readKeyboard('kb1'), ...connectedPads().map((i) => readPad(i)!).filter(Boolean)];
    const pause = pads.some((p) => p.pause);
    if (pause && !this.prevPause && !this.ended) this.togglePause();
    this.prevPause = pause;
    const skip = pads.some((p) => p.pass || p.shoot);
    if (this.sim) this.stepLocal(dt, skip && !this.prevSkip);
    else this.stepOnline(now);
    this.prevSkip = skip;
    const f = this.currentFrame();
    if (!f) return;
    // Excitement: the ball near a goal, a goal just scored.
    const dGoal = PITCH.HL - Math.abs(f.ball.x);
    let ex = f.phase === 'play' ? Math.max(0, 1 - dGoal / 35) * (Math.abs(f.ball.z) < 22 ? 1 : 0.5) : 0.1;
    if (f.phase === 'goal') ex = 1;
    audio.setExcitement(ex);
    this.view.update(f, this.paused ? 0 : dt, now / 1000, ex);
    this.hud.update(f, this.view, dt, this.replayT >= 0, (i) => this.playerName(i));
    getRenderer().render(this.view.scene, this.view.camera);
  }

  // ---- local

  private stepLocal(dt: number, skip: boolean): void {
    const sim = this.sim!;
    if (this.paused || this.ended) return;
    if (skip && sim.phase === 'goal' && sim.phaseT > 1.5) sim.skipGoal();
    if (skip && sim.phase === 'halftime' && sim.phaseT > 1.5) sim.phaseT = 99;
    this.acc += dt;
    const inputs = new Map<string, Input>();
    while (this.acc >= TICK) {
      this.acc -= TICK;
      inputs.clear();
      for (const l of this.locals) inputs.set(l.device, padToInput(this.view, readDevice(l.device)));
      sim.step(inputs);
      if (Math.round(sim.time / TICK) % 2 === 0) this.record(writeFrame(sim));
      const ev = sim.events.splice(0);
      if (ev.length) this.onEvents(ev, sim.time);
    }
    this.stats = sim.stats;
    this.goals = sim.goals;
    this.frame = readFrame(writeFrame(sim));
  }

  // ---- online

  netFrame(data: Float32Array): void {
    const f = readFrame(data);
    this.record(data);
    this.netFrames.push(f);
    if (this.netFrames.length > 30) this.netFrames.shift();
    this.serverClock = f.time;
    this.serverAt = performance.now();
  }
  netEvents(ev: MatchEvent[]): void {
    this.onEvents(ev, this.serverClock);
  }
  netStats(stats: [TeamStats, TeamStats], goals: Game['goals']): void {
    this.stats = stats;
    this.goals = goals;
  }

  private stepOnline(now: number): void {
    // Send our controls (pitch space) every frame.
    if (this.net && now - this.sentAt > 15) {
      this.sentAt = now;
      const kb = readKeyboard('kb1');
      const kb2 = readKeyboard('kb2');
      const pads = connectedPads().map((i) => readPad(i)!).filter(Boolean);
      const all = [kb, kb2, ...pads];
      const stick = all.find((p) => Math.hypot(p.sx, p.sy) > 0.1) ?? kb;
      const [x, z] = toPitch(this.view, stick.sx, stick.sy);
      let b = 0;
      for (const [k, bit] of Object.entries(INPUT_BITS)) if (all.some((p) => p[k as keyof Pad])) b |= bit;
      this.net.input({ x: Math.round(x * 1000) / 1000, z: Math.round(z * 1000) / 1000, b });
    }
    // Draw ~100 ms behind the server, interpolating.
    const fs = this.netFrames;
    if (!fs.length) return;
    const t = this.serverClock + (now - this.serverAt) / 1000 - 0.1;
    let a = fs[0]!;
    let b = fs[fs.length - 1]!;
    for (let i = 0; i < fs.length - 1; i++) {
      if (fs[i]!.time <= t && fs[i + 1]!.time >= t) {
        a = fs[i]!;
        b = fs[i + 1]!;
        break;
      }
    }
    this.frame = b.time > a.time ? lerpFrame(a, b, (t - a.time) / (b.time - a.time)) : b;
  }

  // ---- replays

  private record(data: Float32Array): void {
    this.history.push([data[0]!, data.slice()]);
    const cut = data[0]! - 12;
    while (this.history.length && this.history[0]![0] < cut) this.history.shift();
  }

  private frameAt(t: number): Frame | null {
    const h = this.history;
    if (!h.length) return null;
    for (let i = 0; i < h.length - 1; i++) {
      if (h[i]![0] <= t && h[i + 1]![0] >= t) {
        const a = readFrame(h[i]![1]);
        const b = readFrame(h[i + 1]![1]);
        return lerpFrame(a, b, (t - a.time) / Math.max(1e-6, b.time - a.time));
      }
    }
    return readFrame(h[h.length - 1]![1]);
  }

  private currentFrame(): Frame | null {
    const live = this.frame;
    if (!live) return null;
    // Goal: celebrate (follow the scorer), then the replay from behind the goal.
    if (live.phase === 'goal' && this.goalAt >= 0) {
      const since = live.time - this.goalAt;
      if (since > 2.6 && since < GOAL_PAUSE - 0.3) {
        if (this.replayT < 0) this.replayT = 0;
        this.replayT += 1 / 60 / 1; // advanced per rendered frame below
        const rt = this.goalAt - 5.5 + (since - 2.6) * 0.8;
        if (rt > this.goalAt + 1.2) {
          this.endReplay(live);
          return live;
        }
        const f = this.frameAt(rt);
        if (f) {
          const end = this.goalEnd;
          this.view.cinematic = {
            pos: new THREE.Vector3(end * (PITCH.HL + 11), 3.2, f.ball.z * 0.35 + (f.ball.z > 0 ? -7 : 7)),
            look: new THREE.Vector3(f.ball.x, Math.max(0.6, f.ball.y * 0.6), f.ball.z),
          };
          return f;
        }
      } else if (since <= 2.6) {
        const sc = live.players.find((p) => p.state === 'celebrate');
        if (sc) this.view.cinematic = { pos: new THREE.Vector3(sc.x - Math.sign(sc.x) * 7, 3.4, sc.z + 6), look: new THREE.Vector3(sc.x, 1.2, sc.z) };
      } else this.endReplay(live);
      return live;
    }
    if (this.view.cinematic) this.endReplay(live);
    return live;
  }

  private endReplay(live: Frame): void {
    this.replayT = -1;
    this.view.cinematic = null;
    if (this.sim && live.phase === 'goal') this.sim.skipGoal();
  }

  // ---- events → sound, banners, commentary

  private onEvents(ev: MatchEvent[], time: number): void {
    const name = (i: number) => this.playerName(i);
    const teamOf = (i: number) => (i < 11 ? 0 : 1);
    const cam = this.view.camera.position;
    for (const e of ev) {
      switch (e.k) {
        case 'kick': {
          const p = this.frame?.players[e.p];
          audio.kick(Math.max(0.25, e.power), p ? Math.hypot(p.x - cam.x, p.z - cam.z) : 40);
          if (e.type === 'shot' || e.type === 'finesse' || e.type === 'chip' || e.type === 'header' || e.type === 'penalty') this.lastShotAt = time;
          break;
        }
        case 'goal': {
          this.goalAt = time;
          const end = this.frame ? Math.sign(this.frame.ball.x || 1) : 1;
          this.goalEnd = end;
          this.view.stadium.bulge(end);
          const club = this.clubs[e.team];
          const forHuman = this.locals.some((l) => l.team === e.team) || (this.net && this.humanTeam() === e.team);
          audio.goal(forHuman || (!this.locals.length && !this.net) || e.team === 0);
          this.hud.show(`<div class="g1">GOAL!</div><div class="g2">${badgeSvg(club, 44)} ${esc(e.own ? `${name(e.scorer)} (OG)` : name(e.scorer))} ${e.minute}'</div>`, 3.2, 'goal');
          this.hud.tick(`⚽ ${esc(name(e.scorer))} ${e.minute}'${e.assist >= 0 ? ` <small>assist ${esc(name(e.assist))}</small>` : ''}`, 6);
          audio.say(e.own ? LINES.ownGoal(name(e.scorer)) : LINES.goal(name(e.scorer), club.name), true);
          break;
        }
        case 'save':
          audio.say(e.catch ? LINES.catch(name(e.gk)) : LINES.save(name(e.gk)), !e.catch);
          if (!e.catch) audio.ooh();
          break;
        case 'post':
          audio.post();
          audio.say(LINES.post(), true);
          break;
        case 'tackle':
          if (e.won && Math.random() < 0.3) audio.say(LINES.tackle(name(e.p)));
          break;
        case 'foul':
          if (e.card) {
            this.hud.tick(`<span class="card ${e.card}"></span> ${esc(name(e.by))} <small>${this.clubs[teamOf(e.by)].short}</small>`, 5);
            audio.say(e.card === 'red' ? LINES.red(name(e.by)) : LINES.yellow(name(e.by)), true);
          } else if (!e.penalty) audio.say(LINES.foul(name(e.by)));
          if (e.penalty) {
            this.hud.show('<div class="g1 small">PENALTY</div>', 2.4);
            audio.say(LINES.penalty(), true);
            audio.cheer();
          }
          break;
        case 'offside':
          this.hud.show('<div class="g1 small">OFFSIDE</div>', 1.8);
          audio.say(LINES.offside());
          break;
        case 'whistle':
          audio.whistle(e.long);
          break;
        case 'out':
          if (e.kind === 'goalkick' && time - this.lastShotAt < 3) {
            audio.ooh();
            audio.say(LINES.miss());
          }
          if (e.kind === 'corner') audio.say(LINES.corner());
          break;
        case 'half':
          if (e.half === 1) {
            const score = this.frame?.score ?? [0, 0];
            audio.say(LINES.half(this.clubs[0].name, this.clubs[1].name, score[0], score[1]), true);
            setTimeout(() => this.showStats('Half time'), 600);
          } else {
            this.hud.overlay.innerHTML = '';
            audio.say(LINES.secondHalf(), true);
          }
          break;
        case 'full':
          audio.fullTime();
          setTimeout(() => this.fullTime(), 900);
          break;
        case 'chance':
          break;
      }
    }
  }

  private humanTeam(): 0 | 1 | -1 {
    const f = this.frame;
    if (!f || this.myHuman < 0) return -1;
    return f.humans[this.myHuman]?.team ?? -1;
  }

  private showStats(title: string): void {
    const f = this.frame;
    if (!f || !this.stats) return;
    this.hud.overlay.innerHTML = this.hud.statsHtml(title, f.score, this.stats, this.goals, (i) => this.playerName(i)) + (this.sim ? '<p class="hint center">Press ✕ / J to continue</p>' : '');
  }

  private fullTime(): void {
    if (this.ended) return;
    this.ended = true;
    const f = this.frame!;
    audio.say(LINES.full(this.clubs[0].name, this.clubs[1].name, f.score[0], f.score[1]), true);
    this.showStats('Full time');
    const bar = document.createElement('div');
    bar.className = 'fb-bar center';
    bar.innerHTML = this.net ? `<button data-nav class="go">Back to lobby</button>` : `<button data-nav class="go">Rematch</button><button data-nav class="ghost">Main menu</button>`;
    this.hud.overlay.querySelector('.fb-stats')!.appendChild(bar);
    menuActive = true;
    const [a, b] = bar.querySelectorAll('button');
    if (this.net) a!.addEventListener('click', () => this.quit(false));
    else {
      a!.addEventListener('click', () => {
        const locals = this.locals;
        this.dispose();
        void startLocal(locals);
      });
      b!.addEventListener('click', () => this.quit());
    }
  }

  togglePause(): void {
    if (this.hud.overlay.querySelector('.fb-pause')) {
      this.hud.overlay.innerHTML = '';
      this.paused = false;
      menuActive = false;
      return;
    }
    this.paused = !!this.sim;
    menuActive = true;
    menuFocus = 0;
    this.hud.overlay.innerHTML = `<div class="fb-pause"><h2>${this.sim ? 'Paused' : 'Menu'}</h2>
      <button data-nav data-a="resume">Resume</button>
      <button data-nav data-a="stats">Match facts</button>
      <button data-nav data-a="cam">Camera: <span>${profile.camera}</span></button>
      <button data-nav data-a="comm">Commentary: <span>${profile.commentary ? 'On' : 'Off'}</span></button>
      <button data-nav data-a="controls">Controls</button>
      <button data-nav data-a="quit" class="ghost">${this.net ? 'Leave match' : 'Quit match'}</button></div>`;
    const o = this.hud.overlay;
    o.querySelector('[data-a=resume]')!.addEventListener('click', () => this.togglePause());
    o.querySelector('[data-a=stats]')!.addEventListener('click', () => {
      this.togglePause();
      this.showStats('Match facts');
      setTimeout(() => {
        if (!this.ended) this.hud.overlay.innerHTML = '';
      }, 6000);
    });
    o.querySelector('[data-a=cam]')!.addEventListener('click', (e) => {
      const modes: CameraMode[] = ['broadcast', 'tele', 'end'];
      profile.camera = modes[(modes.indexOf(profile.camera) + 1) % modes.length]!;
      this.view.cameraMode = profile.camera;
      save();
      (e.currentTarget as HTMLElement).querySelector('span')!.textContent = profile.camera;
    });
    o.querySelector('[data-a=comm]')!.addEventListener('click', (e) => {
      profile.commentary = !profile.commentary;
      audio.commentary = profile.commentary;
      save();
      (e.currentTarget as HTMLElement).querySelector('span')!.textContent = profile.commentary ? 'On' : 'Off';
    });
    o.querySelector('[data-a=controls]')!.addEventListener('click', () => {
      o.innerHTML = `<div class="fb-pause wide"><table class="fb-ctrls"><tr><th></th><th>PS4 / PS5</th><th>Keyboard</th></tr>${CONTROLS.map(([a, b, c]) => `<tr><td>${a}</td><td>${b}</td><td>${c}</td></tr>`).join('')}</table><button data-nav data-a="back">Back</button></div>`;
      o.querySelector('[data-a=back]')!.addEventListener('click', () => {
        o.innerHTML = '';
        this.togglePause();
      });
    });
    o.querySelector('[data-a=quit]')!.addEventListener('click', () => this.quit());
  }

  quit(toMenu = true): void {
    const net = this.net;
    this.dispose();
    if (net && toMenu) {
      void net.leave();
      mainMenu();
    } else if (net) lobbyScreen(net);
    else mainMenu();
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resizeObs);
    audio.stopCrowd();
    this.hud.dispose();
    this.view.dispose();
    getRenderer().clear();
    if (game === this) game = null;
  }
}

async function loading(text: string): Promise<void> {
  screen(`<div class="fb-loading"><div class="ball"></div><div>${text}</div></div>`);
  await Promise.all([loadPlayerModel(), audio.init()]);
}

async function startLocal(locals: LocalPlayer[]): Promise<void> {
  await loading('Walking out of the tunnel…');
  const home = CLUB[profile.home]!;
  const away = CLUB[profile.away]!;
  const sim = new MatchSim({ home: home.id, away: away.id, halfSeconds: profile.half, difficulty: profile.difficulty });
  for (const l of locals) sim.addHuman(l.device, l.team);
  game = new Game([home, away], kitsFor(home, away), sim, locals, locals.length > 1 ? locals.map((_, i) => `P${i + 1}`) : []);
  (window as unknown as { __fb: Game }).__fb = game;
}

// ---------------------------------------------------------------- online

let net: FootballNet | null = null;

function onlineMenu(): void {
  const s = screen(
    `<h1>Online · LAN</h1>
    <div class="fb-form">
      <label>Your name <input data-k="name" maxlength="16" value="${esc(profile.name)}" placeholder="Player"></label>
      <div class="fb-row"><button data-nav data-a="create" class="go">Create match</button><button data-nav data-a="quick">Quick match</button></div>
      <div class="fb-row"><input data-k="code" maxlength="8" placeholder="Room code" class="code"><button data-nav data-a="join">Join</button></div>
      <p class="status hint"></p>
    </div>
    <p class="hint">1 v 1 up to 4 v 4: every human steers one player on their side; the rest of the XI is AI. LAN: run the arcade's LAN server and open its address on each machine.</p>
    <div class="fb-bar"><button data-back class="ghost">← Back</button></div>`,
  );
  const status = s.querySelector('.status') as HTMLElement;
  const nameEl = s.querySelector('[data-k=name]') as HTMLInputElement;
  const go = async (fn: (n: FootballNet, name: string) => Promise<void>) => {
    profile.name = nameEl.value.trim().slice(0, 16);
    save();
    status.textContent = 'Connecting…';
    net = new FootballNet();
    try {
      await fn(net, profile.name || 'Player');
      lobbyScreen(net);
    } catch (e) {
      status.textContent = `Couldn't connect: ${(e as Error).message ?? e}`;
      net = null;
    }
  };
  s.querySelector('[data-a=create]')!.addEventListener('click', () => void go((n, nm) => n.create(nm)));
  s.querySelector('[data-a=quick]')!.addEventListener('click', () => void go((n, nm) => n.quick(nm)));
  s.querySelector('[data-a=join]')!.addEventListener('click', () => {
    const code = (s.querySelector('[data-k=code]') as HTMLInputElement).value;
    if (code.trim()) void go((n, nm) => n.join(code, nm));
  });
  s.querySelector('[data-back]')!.addEventListener('click', mainMenu);
}

function lobbyScreen(n: FootballNet): void {
  menuActive = true;
  const s = screen(`<h1>Match lobby</h1><div class="fb-lobby"></div><div class="fb-bar"><button data-back class="ghost">← Leave</button><button data-nav data-a="side">Switch side</button><button data-nav data-a="start" class="go">Kick-Off ▶</button></div><p class="status hint center"></p>`, 'lobby');
  const box = s.querySelector('.fb-lobby') as HTMLElement;
  const status = s.querySelector('.status') as HTMLElement;
  const draw = (l: FbLobby) => {
    if (!document.body.contains(box)) return;
    const host = l.hostId === n.sessionId;
    const sel = (k: 'home' | 'away') => `<select data-k="${k}" ${host ? '' : 'disabled'}>${CLUBS.map((c) => `<option value="${c.id}" ${l.config[k] === c.id ? 'selected' : ''}>${c.name}</option>`).join('')}</select>`;
    const side = (team: 0 | 1) => {
      const club = CLUB[team ? l.config.away : l.config.home]!;
      return `<div class="lb-side">${badgeSvg(club, 64)}${sel(team ? 'away' : 'home')}<ul>${l.players
        .filter((p) => p.team === team)
        .map((p) => `<li>${p.id === l.hostId ? '👑 ' : ''}${esc(p.name)}${p.id === n.sessionId ? ' <em>(you)</em>' : ''}${p.connected ? '' : ' <em>…</em>'}</li>`)
        .join('')}</ul><small>${FB_MAX_PER_TEAM - l.players.filter((p) => p.team === team).length} free · rest AI</small></div>`;
    };
    box.innerHTML = `<div class="lb-code">Room code <b>${l.code}</b>${l.lan ? ' · LAN' : ''}</div>
      <div class="lb-sides">${side(0)}<div class="vs">VS</div>${side(1)}</div>
      <div class="fb-row center">
        <label>Half <select data-k="half" ${host ? '' : 'disabled'}>${HALVES.map(([v, t]) => `<option value="${v}" ${l.config.half === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label>CPU level <select data-k="difficulty" ${host ? '' : 'disabled'}>${DIFFS.map(([v, t]) => `<option value="${v}" ${l.config.difficulty === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      </div>`;
    box.querySelectorAll<HTMLSelectElement>('select[data-k]').forEach((el) => el.addEventListener('change', () => n.config({ [el.dataset.k!]: el.dataset.k === 'half' ? Number(el.value) : el.value })));
    (s.querySelector('[data-a=start]') as HTMLElement).style.display = host && l.phase === 'lobby' ? '' : 'none';
    status.textContent = l.phase === 'playing' ? 'Match in progress…' : host ? 'You are the host: pick the clubs and kick off.' : 'Waiting for the host to kick off…';
  };
  n.onLobby = (l) => {
    if (!game) draw(l);
  };
  if (n.lobby) draw(n.lobby);
  n.onError = (m) => (status.textContent = m);
  n.onClosed = (r) => {
    game?.dispose();
    net = null;
    mainMenu();
    if (r) alert(r);
  };
  n.onBegin = (b) => void beginOnline(n, b);
  s.querySelector('[data-a=side]')!.addEventListener('click', () => {
    const me = n.lobby?.players.find((p) => p.id === n.sessionId);
    n.team(me?.team === 0 ? 1 : 0);
  });
  s.querySelector('[data-a=start]')!.addEventListener('click', () => n.start());
  s.querySelector('[data-back]')!.addEventListener('click', () => {
    void n.leave();
    net = null;
    mainMenu();
  });
}

async function beginOnline(n: FootballNet, b: FbBegin): Promise<void> {
  if (game) game.dispose();
  await loading('Teams are lining up…');
  const home = CLUB[b.config.home]!;
  const away = CLUB[b.config.away]!;
  const me = b.humans.findIndex((h) => h.id === n.sessionId);
  game = new Game([home, away], kitsFor(home, away), null, [], b.humans.map((h) => h.name), n, me);
  const g = game;
  n.onFrame = (f) => g.netFrame(f);
  n.onEvents = (e) => g.netEvents(e);
  n.onStats = (s) => g.netStats(s.stats as [TeamStats, TeamStats], s.goals);
  n.onLobby = (l) => {
    if (l.phase === 'lobby' && game === g) {
      g.dispose();
      lobbyScreen(n);
    }
  };
}

mainMenu();
