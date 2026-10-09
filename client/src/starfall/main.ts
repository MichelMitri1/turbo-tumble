import './styles.css';
import { Audio } from './audio';
import { BOT_NAMES, LocalLink, OnlineLink, type Link } from './link';
import { StarfallNet } from './net/online';
import { SF_MAX, type SfLobby } from './net/protocol';
import { beanIcon } from './render/art';
import { WorldRenderer, type DrawOpts } from './render/world';
import { World3D } from './render3d/world3d';
import { COLORS, DEFAULT_CONFIG, KILL_RANGE, REPORT_RANGE, USE_RANGE, type Action, type Config, type Event } from './sim/game';
import { buildMap, MAP, MAPS, type BuiltMap, type SabotageKind, type Spot } from './sim/maps';
import type { PView, SfView } from './sim/view';
import { ICON } from './ui/icons';
import { CamsUI, MapOverlay, VitalsUI } from './ui/mapview';
import { makePanel, type Panel, type PanelInfo } from './ui/panels';
import { EjectUI, MeetingUI, killAnim, overScreen, reveal, splash } from './ui/screens';

/**
 * Starfall: the social-deduction game on a spaceship, a sky HQ and an ice planet.
 * Menus (vs bots, online / LAN), and the game screen: world, HUD, task panels, meetings.
 */

const app = document.querySelector<HTMLDivElement>('#app')!;
/** The 3D page (/starfall-3d/) draws the same game with the 3D renderer. */
const VIEW3D = document.body.dataset.view === '3d';
const audio = new Audio();
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const icon = (c: number, size = 64) => beanIcon(COLORS[c]![1], COLORS[c]![2], false, size);

// ---------------------------------------------------------------- saved settings

interface Saved {
  name: string;
  color: number;
  cfg: Config;
  players: number;
  role: 'random' | 'crew' | 'impostor';
  volume: number;
}
const saved: Saved = { name: 'Crewmate', color: 0, cfg: { ...DEFAULT_CONFIG }, players: 10, role: 'random', volume: 0.5 };
try {
  const s = JSON.parse(localStorage.getItem('starfall:v2') ?? '{}') as Partial<Saved>;
  if (typeof s.name === 'string') saved.name = s.name.slice(0, 12);
  if (typeof s.color === 'number' && COLORS[s.color]) saved.color = s.color;
  if (s.cfg && typeof s.cfg === 'object') saved.cfg = { ...DEFAULT_CONFIG, ...s.cfg };
  if (!MAP[saved.cfg.map]) saved.cfg.map = 'vanguard';
  if (typeof s.players === 'number') saved.players = Math.max(4, Math.min(SF_MAX, s.players));
  if (s.role === 'crew' || s.role === 'impostor' || s.role === 'random') saved.role = s.role;
  if (typeof s.volume === 'number') saved.volume = Math.max(0, Math.min(1, s.volume));
} catch {
  /* storage optional */
}
audio.volume = saved.volume;
const save = () => {
  try {
    localStorage.setItem('starfall:v2', JSON.stringify(saved));
  } catch {
    /* storage optional */
  }
};

// ---------------------------------------------------------------- menus

const STEPS: Array<{ k: keyof Config; label: string; min: number; max: number; step: number; fmt: (v: number) => string }> = [
  { k: 'impostors', label: 'Impostors', min: 1, max: 3, step: 1, fmt: String },
  { k: 'killCooldown', label: 'Kill Cooldown', min: 10, max: 60, step: 2.5, fmt: (v) => `${v}s` },
  { k: 'crewVision', label: 'Crewmate Vision', min: 1.375, max: 16.5, step: 1.375, fmt: (v) => `${(v / 5.5).toFixed(2)}x` },
  { k: 'impostorVision', label: 'Impostor Vision', min: 1.375, max: 16.5, step: 1.375, fmt: (v) => `${(v / 5.5).toFixed(2)}x` },
  { k: 'emergencies', label: 'Emergency Meetings', min: 0, max: 9, step: 1, fmt: String },
  { k: 'discussion', label: 'Discussion Time', min: 0, max: 120, step: 15, fmt: (v) => `${v}s` },
  { k: 'voting', label: 'Voting Time', min: 15, max: 300, step: 15, fmt: (v) => `${v}s` },
  { k: 'commonTasks', label: 'Common Tasks', min: 0, max: 2, step: 1, fmt: String },
  { k: 'longTasks', label: 'Long Tasks', min: 0, max: 3, step: 1, fmt: String },
  { k: 'shortTasks', label: 'Short Tasks', min: 0, max: 5, step: 1, fmt: String },
];
const TOGGLES: Array<{ k: 'confirmEjects' | 'anonymousVotes' | 'visualTasks'; label: string }> = [
  { k: 'confirmEjects', label: 'Confirm Ejects' },
  { k: 'anonymousVotes', label: 'Anonymous Votes' },
  { k: 'visualTasks', label: 'Visual Tasks' },
];

function settingsHtml(cfg: Config, edit: boolean): string {
  return `<div class="settings">${STEPS.map((s) => `<div class="setting"><span>${s.label}</span><div class="stepper"><button data-k="${s.k}" data-d="-1" ${edit ? '' : 'disabled'}>−</button><b>${s.fmt(cfg[s.k] as number)}</b><button data-k="${s.k}" data-d="1" ${edit ? '' : 'disabled'}>+</button></div></div>`).join('')}
    ${TOGGLES.map((t) => `<div class="setting"><span>${t.label}</span><div class="seg" style="width:120px"><button data-t="${t.k}" data-v="1" class="${cfg[t.k] ? 'on' : ''}" ${edit ? '' : 'disabled'}>On</button><button data-t="${t.k}" data-v="0" class="${cfg[t.k] ? '' : 'on'}" ${edit ? '' : 'disabled'}>Off</button></div></div>`).join('')}</div>`;
}
function bindSettings(root: HTMLElement, cfg: Config, change: (patch: Partial<Config>) => void): void {
  root.querySelectorAll<HTMLButtonElement>('.stepper button').forEach((b) => {
    b.onclick = () => {
      const s = STEPS.find((x) => x.k === b.dataset.k)!;
      const v = Math.round(((cfg[s.k] as number) + s.step * Number(b.dataset.d)) * 1000) / 1000;
      audio.play('click');
      change({ [s.k]: Math.max(s.min, Math.min(s.max, v)) } as Partial<Config>);
    };
  });
  root.querySelectorAll<HTMLButtonElement>('[data-t]').forEach((b) => {
    b.onclick = () => {
      audio.play('click');
      change({ [b.dataset.t!]: b.dataset.v === '1' } as Partial<Config>);
    };
  });
}

/** Little previews of each map for the map picker. */
const previews = new Map<string, { map: BuiltMap; world: WorldRenderer }>();
function drawPreview(c: HTMLCanvasElement, id: string): void {
  let p = previews.get(id);
  if (!p) {
    const map = buildMap(MAP[id]!);
    previews.set(id, (p = { map, world: new WorldRenderer(map) }));
  }
  const W = (c.width = c.clientWidth * 2 || 560);
  const H = (c.height = c.clientHeight * 2 || 350);
  const b = p.map.def.bounds;
  const s = Math.min(W / (b[2] - b[0]), H / (b[3] - b[1])) * 0.95;
  const empty: SfView = { me: 0, map: id, cfg: DEFAULT_CONFIG, time: 0, phase: 'play', phaseT: 0, players: [], bodies: [], tasks: [], progress: 0, killCd: 0, ventCd: 0, vent: -1, emergencies: 0, emergencyCd: 0, sabotageCd: 0, impostors: 1, partners: [], doors: [], doorCd: {}, sabotage: null, holding: -1, meeting: null, lastEject: null, winner: '', why: '' };
  p.world.draw(c.getContext('2d')!, W, H, empty, 0, { cx: (b[0] + b[2]) / 2, cy: (b[1] + b[3]) / 2, scale: s, eye: null, ghosts: false, tasks: [], alerts: [], names: false });
}
function mapsHtml(sel: string, edit: boolean): string {
  return `<div class="maps">${MAPS.map((m) => `<button class="mapcard ${m.id === sel ? 'on' : ''}" data-map="${m.id}" ${edit ? '' : 'disabled'}><canvas></canvas><b>${m.name}</b><small>${m.tagline}</small></button>`).join('')}</div>`;
}
function bindMaps(root: HTMLElement, change: (id: string) => void): void {
  root.querySelectorAll<HTMLButtonElement>('.mapcard').forEach((b) => {
    requestAnimationFrame(() => drawPreview(b.querySelector('canvas')!, b.dataset.map!));
    b.onclick = () => {
      audio.play('click');
      change(b.dataset.map!);
    };
  });
}
function colorsHtml(sel: number, taken: number[] = []): string {
  return `<div class="colors">${COLORS.map((_, i) => `<button data-c="${i}" class="${i === sel ? 'on' : ''} ${taken.includes(i) && i !== sel ? 'taken' : ''}" title="${COLORS[i]![0]}"><img src="${icon(i, 48)}"></button>`).join('')}</div>`;
}

function screen(html: string): HTMLElement {
  app.innerHTML = `<div class="menu">${html}</div><div class="topbar"><a class="chip" href="/">← Arcade</a></div>`;
  return app.querySelector('.menu')!;
}

function home(): void {
  const m = screen(`
    <div class="logo"><img src="${icon(saved.color, 240)}" alt=""><h1 class="disp">STAR<span>FALL</span>${VIEW3D ? '<em>3D</em>' : ''}</h1></div>
    <p class="tag">Crewmates do tasks · Impostors sabotage · Nobody trusts anybody</p>
    <div class="panel">
      <div class="big-btns">
        <button class="btn btn--go" id="local">Play vs Bots<small>4–15 players · 3 maps</small></button>
        <button class="btn btn--blue" id="online">Online / LAN<small>friends + bots fill seats</small></button>
      </div>
      <div class="actions"><button class="btn btn--ghost btn--sm" id="how">How to Play</button><button class="btn btn--ghost btn--sm" id="opts">Sound</button></div>
    </div>`);
  (m.querySelector('#local') as HTMLElement).onclick = localSetup;
  (m.querySelector('#online') as HTMLElement).onclick = () => onlineMenu();
  (m.querySelector('#how') as HTMLElement).onclick = howTo;
  (m.querySelector('#opts') as HTMLElement).onclick = () => soundMenu(home);
}

function soundMenu(back: () => void): void {
  const m = screen(`<div class="panel"><h2 class="disp">Sound</h2><div class="row"><label>Volume</label><input id="vol" type="range" min="0" max="1" step="0.05" value="${saved.volume}"></div><div class="actions"><button class="btn" id="back">Done</button></div></div>`);
  (m.querySelector('#vol') as HTMLInputElement).oninput = (e) => {
    saved.volume = Number((e.target as HTMLInputElement).value);
    audio.volume = saved.volume;
    audio.play('click');
    save();
  };
  (m.querySelector('#back') as HTMLElement).onclick = back;
}

function howTo(): void {
  const m = screen(`<div class="panel panel--wide"><h2 class="disp">How to Play</h2>
    <div class="howto">
      <div><h3>Crewmates</h3><p>Finish your tasks around the ship (yellow on your map) to fill the task bar. Report bodies, call emergency meetings, talk it out and vote the impostors off. Dead? Keep doing tasks as a ghost.</p></div>
      <div><h3>Impostors</h3><p>Blend in, fake tasks, kill when nobody’s looking. Hop through vents, shut doors, cut the lights and sabotage the reactor or oxygen — if the crew can’t fix it in time, you win.</p></div>
      <div><h3>Keyboard & mouse</h3><p><kbd>WASD</kbd> move (or hold the mouse) · <kbd>E</kbd>/<kbd>Space</kbd> use · <kbd>R</kbd> report · <kbd>Q</kbd> kill · <kbd>V</kbd> vent · <kbd>Tab</kbd> map / sabotage · <kbd>Esc</kbd> close / pause</p></div>
      <div><h3>Controller</h3><p>Left stick move · <kbd>A</kbd> use · <kbd>Y</kbd> report · <kbd>X</kbd> kill · <kbd>RB</kbd> vent · <kbd>View</kbd> map · <kbd>B</kbd> close · in tasks the stick moves a cursor and <kbd>A</kbd> clicks.</p></div>
      <div><h3>Sabotages</h3><p>Reactor / seismic: two people hold both hand scanners at once. Oxygen: enter the code at both keypads. Lights: flip all five switches up. Comms: tune the dial.</p></div>
      <div><h3>Meetings</h3><p>Discuss, then vote (or skip). Most votes is ejected; ties and skips eject nobody. Bots talk too — ask them “where were you?”, or call someone out by name or colour.</p></div>
    </div><div class="actions"><button class="btn" id="back">Got it</button></div></div>`);
  (m.querySelector('#back') as HTMLElement).onclick = home;
}

function localSetup(): void {
  const cfg = saved.cfg;
  const draw = () => {
    const m = screen(`<div class="panel panel--wide">
      <h2 class="disp">Play vs Bots</h2>
      <div class="row"><label>Name</label><input id="name" maxlength="12" value="${esc(saved.name)}"></div>
      <div class="row"><label>Colour</label>${colorsHtml(saved.color)}</div>
      ${mapsHtml(cfg.map, true)}
      <div class="row"><label>Players</label><div class="seg" id="players">${[4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((n) => `<button data-n="${n}" class="${saved.players === n ? 'on' : ''}">${n}</button>`).join('')}</div></div>
      <div class="row"><label>Your role</label><div class="seg" id="role">${(['random', 'crew', 'impostor'] as const).map((r) => `<button data-r="${r}" class="${saved.role === r ? 'on' : ''}">${r === 'random' ? 'Random' : r === 'crew' ? 'Crewmate' : 'Impostor'}</button>`).join('')}</div></div>
      ${settingsHtml(cfg, true)}
      <div class="actions"><button class="btn" id="back">Back</button><button class="btn btn--go" id="go" style="font-size:26px">Start ▶</button></div>
    </div>`);
    const name = m.querySelector('#name') as HTMLInputElement;
    name.oninput = () => {
      saved.name = name.value.replace(/[^\p{L}\p{N} _.\-!?']/gu, '').slice(0, 12);
      save();
    };
    m.querySelectorAll<HTMLButtonElement>('[data-c]').forEach((b) => (b.onclick = () => ((saved.color = Number(b.dataset.c)), save(), draw())));
    m.querySelectorAll<HTMLButtonElement>('[data-n]').forEach((b) => (b.onclick = () => ((saved.players = Number(b.dataset.n)), save(), draw())));
    m.querySelectorAll<HTMLButtonElement>('[data-r]').forEach((b) => (b.onclick = () => ((saved.role = b.dataset.r as Saved['role']), save(), draw())));
    bindMaps(m, (id) => ((cfg.map = id), save(), draw()));
    bindSettings(m, cfg, (p) => (Object.assign(cfg, p), save(), draw()));
    (m.querySelector('#back') as HTMLElement).onclick = home;
    (m.querySelector('#go') as HTMLElement).onclick = startLocal;
  };
  draw();
}

function startLocal(): void {
  const n = saved.players;
  const free = [...COLORS.keys()].filter((c) => c !== saved.color).sort(() => Math.random() - 0.5);
  const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
  const people = [{ name: saved.name || 'Crewmate', color: saved.color, bot: false }, ...Array.from({ length: n - 1 }, (_, i) => ({ name: names[i]!, color: free[i]!, bot: true }))];
  const link = new LocalLink(saved.cfg, people, { role: saved.role });
  new Session(link, { again: startLocal, quit: localSetup });
}

// ---------------------------------------------------------------- online

let net: StarfallNet | null = null;

function onlineMenu(msg = ''): void {
  if (net) void net.leave();
  net = null;
  const m = screen(`<div class="panel">
    <h2 class="disp">Online / LAN</h2>
    <p class="sub">Play with friends — empty seats become bots</p>
    <div class="row"><label>Name</label><input id="name" maxlength="12" value="${esc(saved.name)}"></div>
    <div class="row"><label>Colour</label>${colorsHtml(saved.color)}</div>
    <div class="big-btns"><button class="btn btn--go" id="create">Create Room<small>private code</small></button><button class="btn btn--blue" id="quick">Quick Match<small>public lobby</small></button></div>
    <div class="row"><label>Join code</label><div style="display:flex;gap:8px"><input id="code" maxlength="6" placeholder="ABCDEF" style="flex:1;text-transform:uppercase"><button class="btn btn--sm" id="join">Join</button></div></div>
    <p class="hint" id="status">${esc(msg) || 'Checking the server…'}</p>
    <div class="actions"><button class="btn btn--sm" id="back">Back</button></div></div>`);
  const name = m.querySelector('#name') as HTMLInputElement;
  name.oninput = () => {
    saved.name = name.value.replace(/[^\p{L}\p{N} _.\-!?']/gu, '').slice(0, 12);
    save();
  };
  m.querySelectorAll<HTMLButtonElement>('[data-c]').forEach((b) => (b.onclick = () => ((saved.color = Number(b.dataset.c)), save(), onlineMenu(msg))));
  const status = m.querySelector('#status') as HTMLElement;
  const go = async (fn: (n: StarfallNet) => Promise<void>) => {
    status.textContent = 'Connecting…';
    const n = new StarfallNet();
    n.onLobby = (l) => lobby(n, l);
    n.onBegin = (b) => {
      session?.dispose();
      new Session(new OnlineLink(n, b.me, b.map), { quit: () => onlineMenu(), lobby: () => n.lobby && lobby(n, n.lobby) });
    };
    n.onError = (e) => toast(e);
    n.onClosed = (reason) => {
      if (net === n) {
        net = null;
        session?.dispose();
        onlineMenu(reason ?? 'Disconnected.');
      }
    };
    try {
      net = n;
      await fn(n);
    } catch (e) {
      net = null;
      status.textContent = e instanceof Error ? e.message : 'Could not connect.';
    }
  };
  (m.querySelector('#create') as HTMLElement).onclick = () => void go((n) => n.create(saved.name, saved.color));
  (m.querySelector('#quick') as HTMLElement).onclick = () => void go((n) => n.quick(saved.name, saved.color));
  (m.querySelector('#join') as HTMLElement).onclick = () => void go((n) => n.join((m.querySelector('#code') as HTMLInputElement).value, saved.name, saved.color));
  (m.querySelector('#back') as HTMLElement).onclick = () => {
    net = null;
    home();
  };
  if (!msg)
    void new StarfallNet().probe().then((p) => {
      status.textContent = p.ok ? (p.lan?.length ? `LAN server ready · others join at ${p.lan.map((ip) => `${ip}`).join(' / ')}` : 'Server ready.') : 'The game server is offline — start it to play online or on LAN.';
    });
}

function lobby(n: StarfallNet, l: SfLobby): void {
  if (session) return; // a game is on screen; the lobby shows after it
  const host = n.sessionId === l.hostId;
  const cfg = l.config;
  const total = l.players.length + cfg.bots;
  const m = screen(`<div class="panel panel--wide">
    <p class="sub">Room code${l.lan ? ' · LAN' : ''}</p><div class="code">${l.code}</div>
    <div class="roster">${l.players.map((p) => `<div class="${p.connected ? '' : 'off'}"><img src="${icon(p.color, 48)}">${esc(p.name)}${p.id === l.hostId ? ' <em>HOST</em>' : ''}</div>`).join('')}${Array.from({ length: cfg.bots }, () => `<div class="off"><img src="${beanIcon('#9aa3ad', '#6b7480', false, 48)}">Bot</div>`).join('')}</div>
    <div class="row"><label>Your colour</label>${colorsHtml(l.players.find((p) => p.id === n.sessionId)?.color ?? 0, l.players.map((p) => p.color))}</div>
    ${mapsHtml(cfg.map, host)}
    <div class="row"><label>Bots</label><div class="stepper"><button id="bm" ${host ? '' : 'disabled'}>−</button><b>${cfg.bots}</b><button id="bp" ${host ? '' : 'disabled'}>+</button><span class="hint">${total} / ${SF_MAX} players</span></div></div>
    ${settingsHtml(cfg, host)}
    <div class="actions"><button class="btn" id="leave">Leave</button>${host ? `<button class="btn btn--go" id="start" ${total < 4 ? 'disabled' : ''} style="font-size:26px">Start ▶</button>` : '<span class="hint">Waiting for the host to start…</span>'}</div>
  </div>`);
  m.querySelectorAll<HTMLButtonElement>('[data-c]').forEach((b) => (b.onclick = () => ((saved.color = Number(b.dataset.c)), save(), n.look(saved.name, saved.color))));
  bindMaps(m, (id) => n.config({ map: id }));
  bindSettings(m, cfg, (p) => n.config(p));
  const bm = m.querySelector('#bm') as HTMLButtonElement;
  const bp = m.querySelector('#bp') as HTMLButtonElement;
  bm.onclick = () => n.config({ bots: cfg.bots - 1 });
  bp.onclick = () => n.config({ bots: cfg.bots + 1 });
  (m.querySelector('#leave') as HTMLElement).onclick = () => onlineMenu();
  (m.querySelector('#start') as HTMLElement | null)?.addEventListener('click', () => n.start());
}

let toastEl: HTMLElement | null = null;
let toastT = 0;
function toast(text: string, secs = 2.2, color = '#fff'): void {
  if (!toastEl || !toastEl.isConnected) {
    toastEl = document.createElement('div');
    toastEl.className = 'toast disp off';
    toastEl.style.zIndex = '70';
    toastEl.style.position = 'fixed';
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = text;
  toastEl.style.color = color;
  toastEl.classList.remove('off');
  toastT = secs;
}

// ---------------------------------------------------------------- the game screen

let session: Session | null = null;

type UseTarget =
  | { kind: 'task'; task: number; at: Spot }
  | { kind: 'sab'; sab: SabotageKind; station: number; at: Spot }
  | { kind: 'button' | 'admin' | 'cams' | 'vitals'; at: Spot }
  | null;

const SAB_TEXT: Record<SabotageKind, string> = { reactor: 'Reactor Meltdown', o2: 'Oxygen Depleted', lights: 'Fix Lights', comms: 'Comms Sabotaged', seismic: 'Seismic Stabilizers' };

class Session {
  private canvas: HTMLCanvasElement;
  private world: WorldRenderer;
  private world3d: World3D | null = null;
  private hud: HTMLElement;
  private layer: HTMLElement;
  private raf = 0;
  private last = performance.now();
  private t = 0;
  private keys = new Set<string>();
  private mouse: { x: number; y: number } | null = null;
  /** First person (3D page): where you're looking. */
  private yaw = 0;
  private pitch = -0.12;
  private touchLook: { id: number; x: number; y: number } | null = null;
  private joy: [number, number] = [0, 0];
  private pad = { prev: [] as boolean[], cursor: [300, 300] as [number, number], lastAxis: [0, 0] };
  private visR = 5;
  private disposed = false;
  // UI pieces.
  private panel: { p: Panel; el: HTMLElement; canvas: HTMLCanvasElement; task: number; cursor: HTMLElement } | null = null;
  private overlay: { kind: 'map' | 'sabotage' | 'admin' | 'cams' | 'vitals'; ui: MapOverlay | CamsUI | VitalsUI } | null = null;
  private meeting: MeetingUI | null = null;
  private eject: EjectUI | null = null;
  private ejectLeft = 0;
  private over: HTMLElement | null = null;
  private pause: HTMLElement | null = null;
  private stopReveal: (() => void) | null = null;
  private stopSplash: (() => void) | null = null;
  private meetingAt = 0;
  private ventsOpen = new Map<number, number>();
  private phase = '';
  private hudKey = '';
  private onKey = (e: KeyboardEvent) => this.key(e, true);
  private onKeyUp = (e: KeyboardEvent) => this.key(e, false);
  private onResize = () => this.resize();

  constructor(private link: Link, private opts: { again?: () => void; quit: () => void; lobby?: () => void }) {
    session = this;
    if (import.meta.env.DEV) (window as unknown as { __sf: Session }).__sf = this;
    app.innerHTML = '<canvas id="scene"></canvas><div class="hud"></div><div class="layer"></div>';
    this.canvas = app.querySelector('#scene')!;
    this.hud = app.querySelector('.hud')!;
    this.layer = app.querySelector('.layer')!;
    this.world = new WorldRenderer(link.map);
    if (VIEW3D) {
      this.world3d = new World3D(link.map, app);
      this.canvas.classList.add('over3d');
    }
    this.buildHud();
    link.onEvents = (e) => this.events(e);
    link.onError = (m) => {
      if (m !== 'Not now.') toast(m, 1.6, '#ffd2d2');
    };
    addEventListener('keydown', this.onKey);
    addEventListener('keyup', this.onKeyUp);
    addEventListener('resize', this.onResize);
    addEventListener('blur', () => this.keys.clear());
    this.canvas.addEventListener('pointerdown', (e) => {
      if (VIEW3D) {
        // First person: click to grab the mouse; on touch, drag to look.
        if (e.pointerType === 'mouse') {
          if (this.canLook()) void Promise.resolve(this.canvas.requestPointerLock?.()).catch(() => undefined);
        } else this.touchLook = { id: e.pointerId, x: e.clientX, y: e.clientY };
        return;
      }
      if (e.pointerType === 'mouse' && e.button === 0) this.mouse = { x: e.clientX, y: e.clientY };
    });
    addEventListener('pointermove', (e) => {
      if (VIEW3D) {
        if (document.pointerLockElement === this.canvas) this.look(e.movementX * 0.0024, e.movementY * 0.0024);
        else if (this.touchLook && e.pointerId === this.touchLook.id) {
          this.look((e.clientX - this.touchLook.x) * 0.006, (e.clientY - this.touchLook.y) * 0.006);
          this.touchLook = { id: e.pointerId, x: e.clientX, y: e.clientY };
        }
        return;
      }
      if (this.mouse) this.mouse = { x: e.clientX, y: e.clientY };
    });
    addEventListener('pointerup', (e) => {
      this.mouse = null;
      if (this.touchLook?.id === e.pointerId) this.touchLook = null;
    });
    this.resize();
    this.raf = requestAnimationFrame(this.frame);
  }

  // ------------------------------------------------------------ HUD

  private buildHud(): void {
    const touch = matchMedia('(pointer: coarse)').matches;
    this.hud.innerHTML = `
      <div class="taskbox"><div class="taskbar"><i style="width:0"></i><span>TOTAL TASKS COMPLETED</span></div><button class="btn btn--sm tabbtn">Tasks</button><div class="tasklist"></div></div>
      <div class="topright"><button class="iconbtn" data-a="map" title="Map (Tab)">${ICON.map}</button><button class="iconbtn" data-a="menu" title="Menu (Esc)">${ICON.gear}</button></div>
      <div class="actions-hud">
        <button class="act" data-a="vent" title="Vent (V)">${ICON.vent}<span>VENT</span><b></b></button>
        <button class="act kill" data-a="kill" title="Kill (Q)">${ICON.kill}<span>KILL</span><b></b></button>
        <button class="act sab" data-a="sabotage" title="Sabotage (Tab)">${ICON.sabotage}<span>SABOTAGE</span><b></b></button>
        <button class="act" data-a="use" title="Use (E)">${ICON.use}<span>USE</span><b></b></button>
        <button class="act report" data-a="report" title="Report (R)">${ICON.report}<span>REPORT</span><b></b></button>
      </div>
      <div class="ventnav"></div>
      <div class="ghostnote hidden"></div>
      <div class="alert hidden"></div>
      ${VIEW3D ? '<div class="crosshair"></div><div class="lookhint hidden">Click to look around</div>' : ''}
      ${touch ? '<div class="joy"><i></i></div>' : ''}`;
    this.hud.querySelectorAll<HTMLElement>('[data-a]').forEach((b) => {
      b.onclick = () => this.command(b.dataset.a!);
    });
    const list = this.hud.querySelector('.tasklist') as HTMLElement;
    (this.hud.querySelector('.tabbtn') as HTMLElement).onclick = () => list.classList.toggle('collapsed');
    const joy = this.hud.querySelector('.joy') as HTMLElement | null;
    if (joy) {
      const knob = joy.querySelector('i') as HTMLElement;
      let id = -1;
      const set = (e: PointerEvent) => {
        const r = joy.getBoundingClientRect();
        let dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
        let dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
        const l = Math.hypot(dx, dy);
        if (l > 1) {
          dx /= l;
          dy /= l;
        }
        this.joy = [dx, dy];
        knob.style.transform = `translate(${dx * 45}px, ${dy * 45}px)`;
      };
      joy.addEventListener('pointerdown', (e) => {
        id = e.pointerId;
        joy.setPointerCapture(id);
        set(e);
      });
      joy.addEventListener('pointermove', (e) => e.pointerId === id && set(e));
      const end = () => {
        id = -1;
        this.joy = [0, 0];
        knob.style.transform = '';
      };
      joy.addEventListener('pointerup', end);
      joy.addEventListener('pointercancel', end);
    }
  }

  private get v(): SfView | null {
    return this.link.view;
  }
  private get mePos(): [number, number] {
    const v = this.v!;
    return this.link.pos(v.players[v.me]!);
  }

  /** What "Use" would do right now. */
  private useTarget(): UseTarget {
    const v = this.v;
    if (!v || v.phase !== 'play') return null;
    const me = v.players[v.me]!;
    const [x, y] = this.mePos;
    const d = (s: Spot) => Math.hypot(s.x - x, s.y - y);
    const def = this.link.map.def;
    let best: UseTarget = null;
    let bd = Infinity;
    const offer = (t: NonNullable<UseTarget>, range: number) => {
      const dd = d(t.at);
      if (dd <= range && dd < bd) {
        bd = dd;
        best = t;
      }
    };
    const s = v.sabotage;
    if (s && me.alive) {
      const spots = (def.sabotage as Record<string, Spot[] | undefined>)[s.kind] ?? [];
      spots.forEach((at, i) => {
        if ((s.kind === 'o2' || s.kind === 'comms') && s.done[i]) return;
        offer({ kind: 'sab', sab: s.kind, station: i, at }, USE_RANGE + 0.4);
      });
      if (best) return best;
    }
    if (!me.impostor)
      v.tasks.forEach((t, i) => {
        if (t.done) return;
        offer({ kind: 'task', task: i, at: t.spots[t.step]! }, USE_RANGE + 0.3);
      });
    if (best) return best;
    if (me.alive) {
      offer({ kind: 'button', at: def.button }, 2.4);
      if (def.admin) offer({ kind: 'admin', at: def.admin }, USE_RANGE + 0.6);
      if (def.security) offer({ kind: 'cams', at: def.security }, USE_RANGE + 0.6);
      if (def.vitalsAt) offer({ kind: 'vitals', at: def.vitalsAt }, USE_RANGE + 0.6);
    }
    return best;
  }
  private killTarget(): number {
    const v = this.v;
    if (!v || v.phase !== 'play') return -1;
    const me = v.players[v.me]!;
    if (!me.impostor || !me.alive || v.vent >= 0) return -1;
    const [x, y] = this.mePos;
    let best = -1;
    let bd = KILL_RANGE;
    for (const p of v.players) {
      if (p.id === v.me || !p.alive || p.hidden || p.impostor) continue;
      const [px, py] = this.link.pos(p);
      const dd = Math.hypot(px - x, py - y);
      if (dd <= bd && this.link.map.grid.sees(x, y, px, py)) {
        bd = dd;
        best = p.id;
      }
    }
    return best;
  }
  private reportTarget(): number {
    const v = this.v;
    if (!v || v.phase !== 'play' || !v.players[v.me]!.alive) return -1;
    const [x, y] = this.mePos;
    for (const b of v.bodies) if (Math.hypot(b.x - x, b.y - y) <= REPORT_RANGE - 0.2 && this.link.map.grid.sees(x, y, b.x, b.y)) return b.id;
    return -1;
  }
  private ventNear(): number {
    const v = this.v;
    if (!v || v.phase !== 'play') return -1;
    const me = v.players[v.me]!;
    if (!me.impostor || !me.alive) return -1;
    if (v.vent >= 0) return v.vent;
    const [x, y] = this.mePos;
    return this.link.map.def.vents.findIndex((vt) => Math.hypot(vt.x - x, vt.y - y) <= USE_RANGE);
  }

  private command(a: string): void {
    const v = this.v;
    if (!v) return;
    audio.play('click');
    switch (a) {
      case 'menu':
        return this.togglePause();
      case 'map':
        return this.openOverlay(v.players[v.me]!.impostor ? 'sabotage' : 'map');
      case 'sabotage':
        return this.openOverlay('sabotage');
      case 'kill': {
        const t = this.killTarget();
        if (t >= 0) this.link.act({ k: 'kill', target: t });
        return;
      }
      case 'report': {
        const b = this.reportTarget();
        if (b >= 0) this.link.act({ k: 'report', body: b });
        return;
      }
      case 'vent': {
        const i = this.ventNear();
        if (i < 0) return;
        this.link.act({ k: 'vent', op: v.vent >= 0 ? 'exit' : 'enter' });
        audio.play('vent');
        this.ventsOpen.set(i, 1);
        return;
      }
      case 'use':
        return this.use();
    }
  }

  private use(): void {
    const v = this.v!;
    if (v.vent >= 0) return this.command('vent');
    const t = this.useTarget();
    if (!t) {
      if (this.ventNear() >= 0) this.command('vent');
      return;
    }
    const me = v.players[v.me]!;
    const color = COLORS[me.color]!;
    switch (t.kind) {
      case 'task': {
        const task = v.tasks[t.task]!;
        const spot = task.spots[task.step]!;
        const next = task.spots[task.step + 1];
        const info: PanelInfo = { kind: spot.kind, label: spot.label, key: `${task.def}:${task.step}`, color: color[1], colorName: color[0].toUpperCase(), room: next ? this.link.map.roomAt(next.x, next.y) || 'Hallway' : undefined };
        return this.openPanel(info, t.task);
      }
      case 'sab': {
        const kind = t.sab === 'reactor' ? 'reactor-fix' : t.sab;
        return this.openPanel({ kind, label: SAB_TEXT[t.sab], key: `sab:${t.sab}`, station: t.station }, -1);
      }
      case 'button':
        return void this.link.act({ k: 'emergency' });
      case 'admin':
        return this.openOverlay('admin');
      case 'cams':
        return this.openOverlay('cams');
      case 'vitals':
        return this.openOverlay('vitals');
    }
  }

  // ------------------------------------------------------------ panels & overlays

  private openPanel(info: PanelInfo, task: number): void {
    this.closeAll();
    const el = document.createElement('div');
    el.className = 'ov';
    el.innerHTML = '<div class="mgame"><canvas width="600" height="600"></canvas><button class="closex">✕</button><div class="pcursor hidden"></div></div>';
    this.layer.appendChild(el);
    const canvas = el.querySelector('canvas')!;
    const dpr = Math.min(2, devicePixelRatio);
    canvas.width = canvas.height = Math.round(600 * dpr);
    const host = {
      done: () => {
        if (task >= 0) this.link.act({ k: 'task', task });
      },
      close: () => this.closePanel(),
      act: (a: Action) => this.link.act(a),
      sound: (s: Parameters<Audio['play']>[0]) => audio.play(s),
      view: () => this.link.view,
    };
    const p = makePanel(host, info);
    const cursor = el.querySelector('.pcursor') as HTMLElement;
    this.panel = { p, el, canvas, task, cursor };
    const at = (e: PointerEvent): [number, number] => {
      const r = canvas.getBoundingClientRect();
      return [((e.clientX - r.left) / r.width) * 600, ((e.clientY - r.top) / r.height) * 600];
    };
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      p.down(...at(e));
    });
    canvas.addEventListener('pointermove', (e) => p.move(...at(e)));
    canvas.addEventListener('pointerup', (e) => p.up(...at(e)));
    canvas.addEventListener('pointercancel', (e) => p.up(...at(e)));
    (el.querySelector('.closex') as HTMLElement).onclick = () => this.closePanel();
    el.addEventListener('pointerdown', (e) => {
      if (e.target === el) this.closePanel();
    });
    if (task >= 0) this.link.act({ k: 'busy', kind: info.kind as Exclude<PanelInfo['kind'], 'lights' | 'o2' | 'reactor-fix' | 'seismic' | 'comms'> });
    if (this.link instanceof OnlineLink) this.link.frozen = true;
    this.pad.cursor = [300, 300];
    audio.play('use');
  }

  private closePanel(): void {
    const pn = this.panel;
    if (!pn) return;
    pn.p.release();
    pn.el.remove();
    this.panel = null;
    if (pn.task >= 0 && this.v?.phase === 'play') this.link.act({ k: 'busy', kind: '' });
    if (this.link instanceof OnlineLink) this.link.frozen = false;
  }

  private openOverlay(kind: 'map' | 'sabotage' | 'admin' | 'cams' | 'vitals'): void {
    if (this.overlay?.kind === kind) return this.closeOverlay();
    this.closeAll();
    const v = this.v;
    if (!v || (v.phase !== 'play' && kind !== 'map')) return;
    const def = this.link.map.def;
    const close = () => this.closeOverlay();
    let ui: MapOverlay | CamsUI | VitalsUI;
    if (kind === 'cams')
      ui = new CamsUI(this.layer, def, (ctx, W, H, cam, v, t) => {
        const o = { eye: null, ghosts: false, tasks: [], alerts: [], pos: (p: PView) => this.link.pos(p) };
        if (this.world3d) this.world3d.renderCam(ctx, W, H, v, t, cam, o);
        else this.world.draw(ctx, W, H, v, t, { ...o, cx: cam.x, cy: cam.y, scale: Math.min(W / 14, H / 9), names: true });
      }, close);
    else if (kind === 'vitals') ui = new VitalsUI(this.layer, close);
    else ui = new MapOverlay(this.layer, def, kind, (a) => this.link.act(a), close);
    this.overlay = { kind, ui };
    if (this.link instanceof OnlineLink) this.link.frozen = kind !== 'map' && kind !== 'sabotage';
  }
  private closeOverlay(): void {
    this.overlay?.ui.dispose();
    this.overlay = null;
    if (this.link instanceof OnlineLink) this.link.frozen = !!this.panel;
  }
  private closeAll(): void {
    this.closePanel();
    this.closeOverlay();
  }

  private togglePause(): void {
    if (this.pause) {
      this.pause.remove();
      this.pause = null;
      if (this.link instanceof LocalLink) this.link.paused = false;
      return;
    }
    const el = document.createElement('div');
    el.className = 'ov';
    el.style.zIndex = '60';
    el.innerHTML = `<div class="panel pause"><h2 class="disp">${this.link.online ? 'Menu' : 'Paused'}</h2>
      <div class="row"><label>Volume</label><input type="range" min="0" max="1" step="0.05" value="${saved.volume}"></div>
      <button class="btn btn--green" data-p="resume">Resume</button><button class="btn" data-p="help">Controls</button><button class="btn btn--go" data-p="quit">${this.link.online ? 'Leave Game' : 'Quit to Menu'}</button></div>`;
    this.layer.appendChild(el);
    this.pause = el;
    if (this.link instanceof LocalLink) this.link.paused = true;
    (el.querySelector('input') as HTMLInputElement).oninput = (e) => {
      saved.volume = Number((e.target as HTMLInputElement).value);
      audio.volume = saved.volume;
      save();
    };
    el.querySelector<HTMLElement>('[data-p=resume]')!.onclick = () => this.togglePause();
    el.querySelector<HTMLElement>('[data-p=help]')!.onclick = () => toast('WASD move · E use · R report · Q kill · V vent · Tab map', 4);
    el.querySelector<HTMLElement>('[data-p=quit]')!.onclick = () => {
      this.dispose();
      if (this.link.online && net) {
        void net.leave();
        net = null;
      }
      this.opts.quit();
    };
  }

  // ------------------------------------------------------------ input

  private key(e: KeyboardEvent, down: boolean): void {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (down) this.keys.add(k);
    else this.keys.delete(k);
    if (!down || e.repeat) return;
    if (this.panel) {
      if (k === 'Escape') this.closePanel();
      else this.panel.p.key(e.key);
      return;
    }
    if (k === 'Tab') e.preventDefault();
    if (k === 'Escape') {
      if (this.overlay) return this.closeOverlay();
      if (this.meeting?.chatting) return this.meeting.toggleChat(false);
      return this.togglePause();
    }
    const v = this.v;
    if (!v) return;
    if (v.phase === 'meeting') {
      if (k === 'Enter' && this.meeting) this.meeting.toggleChat(true);
      return;
    }
    if (v.vent >= 0 && ['w', 'a', 's', 'd', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) {
      const dir: Record<string, [number, number]> = { w: [0, -1], ArrowUp: [0, -1], s: [0, 1], ArrowDown: [0, 1], a: [-1, 0], ArrowLeft: [-1, 0], d: [1, 0], ArrowRight: [1, 0] };
      return this.ventHop(this.toWorld(...dir[k]!));
    }
    if (k === 'e' || k === ' ') this.command('use');
    else if (k === 'q') this.command('kill');
    else if (k === 'r') this.command('report');
    else if (k === 'v') this.command('vent');
    else if (k === 'Tab' || k === 'm') this.command('map');
  }

  /** In a vent: hop to the linked vent most in that direction. */
  private ventHop(dir: [number, number]): void {
    const v = this.v!;
    const vents = this.link.map.def.vents;
    const cur = vents[v.vent];
    if (!cur) return;
    let best = -1;
    let bs = 0.3;
    for (const to of cur.links) {
      const t = vents[to]!;
      const l = Math.hypot(t.x - cur.x, t.y - cur.y) || 1;
      const s = ((t.x - cur.x) * dir[0] + (t.y - cur.y) * dir[1]) / l;
      if (s > bs) {
        bs = s;
        best = to;
      }
    }
    if (best >= 0) {
      this.link.act({ k: 'vent', op: 'move', to: best });
      audio.play('vent');
    }
  }

  private gamepad(dt: number): [number, number] {
    const g = navigator.getGamepads?.().find((x) => x && x.connected);
    if (!g) return [0, 0];
    const btn = (i: number) => !!g.buttons[i]?.pressed;
    const edge = (i: number) => btn(i) && !this.pad.prev[i];
    let ax = g.axes[0] ?? 0;
    let ay = g.axes[1] ?? 0;
    if (btn(14)) ax = -1;
    if (btn(15)) ax = 1;
    if (btn(12)) ay = -1;
    if (btn(13)) ay = 1;
    if (Math.hypot(ax, ay) < 0.2) ax = ay = 0;
    const out: [number, number] = [ax, ay];
    if (this.panel) {
      // A virtual cursor for the task panels.
      const c = this.pad.cursor;
      c[0] = Math.max(0, Math.min(600, c[0] + ax * 520 * dt));
      c[1] = Math.max(0, Math.min(600, c[1] + ay * 520 * dt));
      const cur = this.panel.cursor;
      cur.classList.remove('hidden');
      cur.style.left = `${(c[0] / 6).toFixed(2)}%`;
      cur.style.top = `${(c[1] / 6).toFixed(2)}%`;
      this.panel.p.move(c[0], c[1]);
      if (edge(0)) this.panel.p.down(c[0], c[1]);
      if (!btn(0) && this.pad.prev[0]) this.panel?.p.up(c[0], c[1]);
      if (edge(1)) this.closePanel();
      out[0] = out[1] = 0;
    } else {
      const v = this.v;
      if (v?.vent !== undefined && v.vent >= 0 && Math.hypot(ax, ay) > 0.7 && Math.hypot(this.pad.lastAxis[0]!, this.pad.lastAxis[1]!) < 0.7) this.ventHop(this.toWorld(ax, ay));
      // Right stick looks around (first person).
      if (VIEW3D) {
        const lx = Math.abs(g.axes[2] ?? 0) > 0.15 ? g.axes[2]! : 0;
        const ly = Math.abs(g.axes[3] ?? 0) > 0.15 ? g.axes[3]! : 0;
        this.look(lx * 2.6 * dt, ly * 1.8 * dt);
      }
      if (edge(0)) this.command('use');
      if (edge(2)) this.command('kill');
      if (edge(3)) this.command('report');
      if (edge(5)) this.command('vent');
      if (edge(8)) this.command('map');
      if (edge(9)) this.command('menu');
      if (edge(1)) {
        if (this.overlay) this.closeOverlay();
        else if (this.pause) this.togglePause();
      }
    }
    this.pad.lastAxis = [ax, ay];
    this.pad.prev = g.buttons.map((b) => b.pressed);
    return out;
  }

  private look(dx: number, dy: number): void {
    this.yaw += dx;
    this.pitch = Math.max(-1.25, Math.min(0.9, this.pitch - dy));
  }
  /** Mouse-look only while walking around (menus and panels need the cursor). */
  private canLook(): boolean {
    const v = this.v;
    return !!v && (v.phase === 'play' || v.phase === 'intro') && !this.panel && !this.overlay && !this.pause;
  }
  /** Screen-relative input (forward / right) → a direction on the map, in first person. */
  private toWorld(dx: number, dy: number): [number, number] {
    if (!VIEW3D) return [dx, dy];
    const f = -dy;
    const r = dx;
    return [Math.cos(this.yaw) * r + Math.sin(this.yaw) * f, Math.sin(this.yaw) * r - Math.cos(this.yaw) * f];
  }

  private steer(dt: number): void {
    let dx = 0;
    let dy = 0;
    const k = this.keys;
    if (k.has('a') || k.has('ArrowLeft')) dx -= 1;
    if (k.has('d') || k.has('ArrowRight')) dx += 1;
    if (k.has('w') || k.has('ArrowUp')) dy -= 1;
    if (k.has('s') || k.has('ArrowDown')) dy += 1;
    const [gx, gy] = this.gamepad(dt);
    dx += gx + this.joy[0];
    dy += gy + this.joy[1];
    if (VIEW3D) {
      [dx, dy] = this.toWorld(dx, dy);
      if (!this.canLook() && document.pointerLockElement) document.exitPointerLock();
    }
    if (this.mouse && !dx && !dy) {
      const mx = this.mouse.x - innerWidth / 2;
      const my = this.mouse.y - innerHeight / 2;
      const l = Math.hypot(mx, my);
      if (l > 20) {
        dx = mx / l;
        dy = my / l;
      }
    }
    const v = this.v;
    const blocked = !v || v.phase !== 'play' || !!this.panel || (!!this.overlay && this.overlay.kind !== 'map' && this.overlay.kind !== 'sabotage') || !!this.pause || v.vent >= 0;
    if (blocked) dx = dy = 0;
    this.link.steer(dx, dy);
  }

  // ------------------------------------------------------------ events & phases

  private events(evs: Event[]): void {
    const v = this.v;
    if (!v) return;
    for (const e of evs) {
      switch (e.k) {
        case 'kill':
          audio.play('kill');
          if (e.victim === v.me) {
            this.closeAll();
            killAnim(this.layer, v.players[e.killer]!.color, v.players[e.victim]!.color);
            setTimeout(() => toast('You are dead. Finish your tasks as a ghost!', 3), 1700);
          }
          break;
        case 'meeting':
          this.closeAll();
          audio.play(e.reason === 'body' ? 'report' : 'emergency');
          this.stopSplash?.();
          this.stopSplash = splash(this.layer, v, e.reason, e.caller, e.body);
          this.meetingAt = performance.now();
          break;
        case 'votes':
          audio.play('vote');
          break;
        case 'eject':
          this.ejectLeft = e.left;
          break;
        case 'sabotage': {
          audio.play('sabotage');
          const me = v.players[v.me]!;
          if (!me.impostor) toast(e.kind === 'lights' ? 'The lights are out!' : e.kind === 'comms' ? 'Comms sabotaged!' : `${SAB_TEXT[e.kind]}!`, 2.4, '#ff6b6b');
          break;
        }
        case 'fixed':
          audio.play('fixed');
          break;
        case 'doors':
          audio.play('door');
          break;
        case 'task':
          if (e.id === v.me) {
            audio.play(e.done ? 'task' : 'taskStep');
            if (e.done) toast('Task complete!', 1.4, '#7dff7d');
          }
          break;
        case 'vent': {
          const i = this.link.map.def.vents.findIndex((vt) => Math.hypot(vt.x - e.x, vt.y - e.y) < 0.5);
          if (i >= 0) this.ventsOpen.set(i, 1);
          if (e.id !== v.me) audio.play('vent');
          break;
        }
        case 'over':
          break;
      }
    }
  }

  private phaseChange(v: SfView): void {
    const ph = v.phase;
    if (ph === this.phase) return;
    const was = this.phase;
    this.phase = ph;
    if (ph === 'intro') {
      audio.play('reveal');
      this.stopReveal = reveal(this.layer, v, () => {
        this.stopReveal = null;
      });
    } else this.stopReveal?.();
    if (ph !== 'meeting') {
      this.meeting?.dispose();
      this.meeting = null;
    }
    if (ph === 'eject') {
      audio.play('eject');
      this.eject = new EjectUI(this.layer, v, this.link.map.def.theme, this.ejectLeft);
    } else if (was === 'eject') {
      this.eject?.dispose();
      this.eject = null;
    }
    if (ph === 'over') {
      this.closeAll();
      const me = v.players[v.me]!;
      audio.play((v.winner === 'impostor') === me.impostor ? 'win' : 'lose');
      const buttons = this.link.online
        ? [{ label: 'Back to Lobby', cls: 'btn--go', fn: () => (this.dispose(), this.opts.lobby?.()) }, { label: 'Leave', fn: () => (this.dispose(), this.opts.quit()) }]
        : [{ label: 'Play Again', cls: 'btn--go', fn: () => (this.dispose(), this.opts.again?.()) }, { label: 'Menu', fn: () => (this.dispose(), this.opts.quit()) }];
      this.over = overScreen(this.layer, v, buttons);
    }
  }

  // ------------------------------------------------------------ the frame

  private resize(): void {
    const dpr = Math.min(2, devicePixelRatio);
    this.canvas.width = Math.round(innerWidth * dpr);
    this.canvas.height = Math.round(innerHeight * dpr);
    this.world3d?.resize();
  }

  private frame = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.t += dt;
    if (toastT > 0) {
      toastT -= dt;
      if (toastT <= 0) toastEl?.classList.add('off');
    }
    this.steer(dt);
    this.link.tick(dt);
    const v = this.v;
    if (!v) return;
    this.phaseChange(v);
    for (const [i, o] of this.ventsOpen) {
      const n = o - dt * 2.5;
      if (n <= 0) this.ventsOpen.delete(i);
      else this.ventsOpen.set(i, n);
    }
    // Meeting tablet after the splash.
    if (v.phase === 'meeting' && !this.meeting && performance.now() - this.meetingAt > 2300) this.meeting = new MeetingUI(this.layer, v.me, (a) => this.link.act(a), audio);
    if (this.meeting) this.meeting.update(v);
    this.eject?.update(dt);
    // Panels that no longer make sense close themselves.
    if (this.panel && (v.phase !== 'play' || (!v.players[v.me]!.alive && this.panel.task < 0))) this.closePanel();
    if (this.panel) {
      this.panel.p.update(dt);
      const ctx = this.panel?.canvas.getContext('2d');
      if (ctx && this.panel) {
        const s = this.panel.canvas.width / 600;
        ctx.setTransform(s, 0, 0, s, 0, 0);
        ctx.clearRect(0, 0, 600, 600);
        this.panel.p.render(ctx);
      }
    }
    if (this.overlay && v.phase !== 'play') this.closeOverlay();
    this.draw(v, dt);
    this.updateHud(v);
  };

  private draw(v: SfView, dt: number): void {
    const ctx = this.canvas.getContext('2d')!;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const me = v.players[v.me]!;
    const [mx, my] = this.mePos;
    const dpr = Math.min(2, devicePixelRatio);
    const scale = Math.max(innerWidth / 19, innerHeight / 10.7) * dpr;
    const sab = v.sabotage;
    // Vision (lights shrink it for the crew; ghosts see everything).
    const target = !me.alive ? 40 : me.impostor ? v.cfg.impostorVision : sab?.kind === 'lights' ? v.cfg.crewVision * 0.25 : v.cfg.crewVision;
    this.visR += (target - this.visR) * Math.min(1, dt * 2.5);
    const tasks: Spot[] = !me.impostor ? v.tasks.filter((t) => !t.done).map((t) => t.spots[t.step]!) : [];
    const alerts: Spot[] = sab ? ((this.link.map.def.sabotage as Record<string, Spot[] | undefined>)[sab.kind] ?? []).filter((_, i) => !((sab.kind === 'o2' || sab.kind === 'comms') && sab.done[i])) : [];
    const use = this.useTarget();
    const local = this.link instanceof LocalLink ? null : (this.link as OnlineLink).self();
    const opts: DrawOpts = {
      cx: mx,
      cy: my - 0.4,
      scale,
      eye: me.alive ? { x: mx, y: my, r: this.visR } : null,
      ghosts: !me.alive,
      tasks: v.sabotage?.kind === 'comms' ? [] : tasks,
      alerts,
      target: this.killTarget(),
      ventGlow: v.vent < 0 ? this.ventNear() : -1,
      useGlow: use?.at ?? null,
      pos: (p: PView) => {
        if (local && p.id === v.me) {
          p.left = local.left;
          p.moving = local.moving;
        }
        return this.link.pos(p);
      },
      ventsOpen: this.ventsOpen,
      names: true,
    };
    if (this.world3d) {
      ctx.clearRect(0, 0, W, H);
      this.world3d.render(v, dt, this.t, [mx, my], { ...(opts as Required<Pick<DrawOpts, 'pos'>> & DrawOpts), fp: { yaw: this.yaw, pitch: this.pitch, low: v.vent >= 0 } });
    } else this.world.draw(ctx, W, H, v, this.t, opts);
    // Arrows to the sabotage stations at the screen edge.
    ctx.save();
    for (const a of alerts) {
      let sx = (a.x - mx) * scale + W / 2;
      let sy = (a.y - (my - 0.4)) * scale + H / 2;
      let ang: number;
      if (this.world3d) {
        // First person: on screen → no arrow; otherwise point by its bearing (up = ahead).
        const [px, py, front] = this.world3d.project(a.x, a.y, 0.5);
        sx = px * dpr;
        sy = py * dpr;
        if (front && sx > 40 && sx < W - 40 && sy > 40 && sy < H - 40) continue;
        const fx = Math.sin(this.yaw);
        const fy = -Math.cos(this.yaw);
        const bx = a.x - mx;
        const by = a.y - my;
        ang = Math.atan2(fx * by - fy * bx, fx * bx + fy * by) - Math.PI / 2;
      } else {
        if (sx > 40 && sx < W - 40 && sy > 40 && sy < H - 40) continue;
        ang = Math.atan2(sy - H / 2, sx - W / 2);
      }
      const r = Math.min(W / 2 - 50 * dpr, H / 2 - 50 * dpr) / Math.max(Math.abs(Math.cos(ang)) * (Math.min(W, H) / W), Math.abs(Math.sin(ang)) * (Math.min(W, H) / H));
      const ax = W / 2 + Math.cos(ang) * Math.min(r, W / 2 - 50 * dpr);
      const ay = H / 2 + Math.sin(ang) * Math.min(r, H / 2 - 50 * dpr);
      ctx.translate(ax, ay);
      ctx.rotate(ang);
      ctx.fillStyle = Math.sin(this.t * 8) > 0 ? '#ff3b3b' : '#ff9090';
      ctx.strokeStyle = '#0b0b14';
      ctx.lineWidth = 4 * dpr;
      ctx.beginPath();
      ctx.moveTo(26 * dpr, 0);
      ctx.lineTo(-14 * dpr, -18 * dpr);
      ctx.lineTo(-6 * dpr, 0);
      ctx.lineTo(-14 * dpr, 18 * dpr);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    ctx.restore();
    // Overlays that draw every frame.
    if (this.overlay?.ui instanceof MapOverlay) this.overlay.ui.update(v, { x: mx, y: my }, v.sabotage?.kind === 'comms' ? [] : tasks, alerts, this.t);
    else if (this.overlay?.ui instanceof CamsUI) this.overlay.ui.update(v, this.t);
    else if (this.overlay?.ui instanceof VitalsUI) this.overlay.ui.update(v);
    audio.siren(dt, !!sab && sab.t > 0 && v.phase === 'play');
  }

  private updateHud(v: SfView): void {
    const me = v.players[v.me]!;
    const hud = this.hud;
    const playing = v.phase === 'play' || v.phase === 'intro';
    hud.style.display = playing ? '' : 'none';
    if (!playing) return;
    const map = this.link.map;
    const sab = v.sabotage;
    // Task bar.
    const bar = hud.querySelector('.taskbar i') as HTMLElement;
    const label = hud.querySelector('.taskbar span') as HTMLElement;
    bar.style.width = `${(v.progress ?? 0) * 100}%`;
    label.textContent = v.progress === null ? 'COMMS SABOTAGED' : 'TOTAL TASKS COMPLETED';
    // Task list.
    const lines: string[] = [];
    if (sab) {
      const spots = (map.def.sabotage as Record<string, Spot[] | undefined>)[sab.kind] ?? [];
      const n = spots.length;
      const fixed = sab.kind === 'lights' ? sab.switches.filter(Boolean).length : sab.done.filter(Boolean).length;
      const total = sab.kind === 'lights' ? 5 : n;
      lines.push(`<div class="red">${SAB_TEXT[sab.kind]}${sab.t > 0 ? ` in ${Math.ceil(sab.t)}s` : ''}${sab.kind === 'reactor' || sab.kind === 'seismic' ? '' : ` (${fixed}/${total})`}</div>`);
      if (sab.kind === 'o2') lines.push(`<div class="red">Code: ${sab.code}</div>`);
    }
    if (me.impostor) {
      lines.push(`<div class="imp">${me.alive ? 'Sabotage and kill everyone.' : 'You are dead. You can still sabotage.'}</div><div class="imp">Fake Tasks:</div>`);
    } else if (!me.alive) lines.push('<div>You are dead. Finish your tasks!</div>');
    if (sab?.kind === 'comms' && !me.impostor) lines.push('<div class="red">Comms Sabotaged</div>');
    else
      for (const t of v.tasks) {
        const at = t.spots[Math.min(t.step, t.spots.length - 1)]!;
        const room = map.roomAt(at.x, at.y) || 'Hallway';
        const steps = t.spots.length > 1 ? ` (${t.done ? t.spots.length : t.step}/${t.spots.length})` : '';
        const name = t.spots.length > 1 && !t.done ? at.label : t.name;
        lines.push(`<div class="${t.done ? 'done' : t.step > 0 ? 'part' : ''}">${esc(room)}: ${esc(name)}${steps}</div>`);
      }
    const list = hud.querySelector('.tasklist') as HTMLElement;
    const html = lines.join('');
    if (list.innerHTML !== html) list.innerHTML = html;
    // Buttons.
    const use = this.useTarget();
    const kill = this.killTarget();
    const report = this.reportTarget();
    const vent = this.ventNear();
    const set = (a: string, show: boolean, on: boolean, num = '', lab?: string, svg?: string) => {
      const b = hud.querySelector(`[data-a="${a}"]`) as HTMLElement;
      b.style.display = show ? '' : 'none';
      b.classList.toggle('off', !on);
      (b.querySelector('b') as HTMLElement).textContent = num;
      if (lab) {
        const sp = b.querySelector('span') as HTMLElement;
        if (sp.textContent !== lab) {
          sp.textContent = lab;
          b.querySelector('svg')!.outerHTML = svg!;
        }
      }
    };
    const useLab = use?.kind === 'admin' ? ['ADMIN', ICON.admin] : use?.kind === 'cams' ? ['SECURITY', ICON.cams] : use?.kind === 'vitals' ? ['VITALS', ICON.vitals] : ['USE', ICON.use];
    const ventUse = !use && vent >= 0;
    set('use', true, !!use || ventUse || v.vent >= 0, '', useLab[0], useLab[1]);
    set('report', me.alive, report >= 0);
    set('kill', me.impostor && me.alive, kill >= 0 && v.killCd <= 0, v.killCd > 0 ? String(Math.ceil(v.killCd)) : '');
    set('vent', me.impostor && me.alive, vent >= 0);
    set('sabotage', me.impostor, true, '');
    const ghost = hud.querySelector('.ghostnote') as HTMLElement;
    ghost.classList.toggle('hidden', me.alive);
    const hint = hud.querySelector('.lookhint') as HTMLElement | null;
    hint?.classList.toggle('hidden', !!document.pointerLockElement || matchMedia('(pointer: coarse)').matches || !this.canLook());
    ghost.textContent = me.impostor ? 'You are a ghost — sabotage from the map.' : 'You are a ghost — you can go through walls.';
    (hud.querySelector('.alert') as HTMLElement).classList.toggle('hidden', !(sab && sab.t > 0));
    // Vent arrows.
    const nav = hud.querySelector('.ventnav') as HTMLElement;
    const key = `${v.vent}`;
    if (key !== this.hudKey) {
      this.hudKey = key;
      nav.innerHTML = '';
      const cur = map.def.vents[v.vent];
      if (cur)
        for (const to of cur.links) {
          const t = map.def.vents[to]!;
          const ang = Math.atan2(t.y - cur.y, t.x - cur.x);
          const b = document.createElement('button');
          b.textContent = '➜';
          b.style.left = `calc(50% + ${Math.cos(ang) * 130}px)`;
          b.style.top = `calc(50% + ${Math.sin(ang) * 130}px)`;
          b.style.transform = `translate(-50%, -50%) rotate(${ang}rad)`;
          b.onclick = () => {
            this.link.act({ k: 'vent', op: 'move', to });
            audio.play('vent');
          };
          nav.appendChild(b);
        }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.closeAll();
    this.stopReveal?.();
    this.stopSplash?.();
    this.meeting?.dispose();
    this.eject?.dispose();
    this.over?.remove();
    removeEventListener('keydown', this.onKey);
    removeEventListener('keyup', this.onKeyUp);
    removeEventListener('resize', this.onResize);
    this.link.steer(0, 0);
    this.link.dispose();
    this.world3d?.dispose();
    if (session === this) session = null;
  }
}

home();
