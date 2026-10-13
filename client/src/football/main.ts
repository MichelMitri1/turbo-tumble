import * as THREE from 'three';
import './styles.css';
import { bindFullscreenButton, installFullscreenKey } from '../ui/fullscreen';
import { CLUBS, CLUB, FORMATIONS, clubRatings, kitsFor, type Club, type FormationId, type Kit, type PlayerDef } from './sim/data';
import { MatchSim, CELEBRATE_T, PITCH, SHOT_KICKS, TICK, VAR_T, TRICKS, type Input, type Lineup, type MatchEvent, type TeamStats } from './sim/match';
import { CPU_LEVELS, CPU_PROFILE } from './sim/difficulty';
import { readFrame, writeFrame, lerpFrame, type Frame } from './sim/snapshot';
import { MatchView, HUMAN_COLORS, type CameraMode } from './render/view';
import { loadPlayerModel } from './render/players';
import { Hud, badgeSvg, kitSvg } from './hud';
import { MatchAudio, LINES } from './audio';
import { installKeys, readDevice, connectedPads, deviceName, readKeyboard, readPad, SKILL_GUIDE, equipSkill, getEquippedSkill, type DeviceId, type Pad } from './input';
import { SKILL_SETS } from './sim/skills';
import { MatchRecording, ReplayViewer, savedReplays, saveReplay, type ReplayData } from './replay';
import { TrainingSession, TRAINING_PACKS, trainingBest, type TrainingOptions } from './training';
import { FootballNet } from './net/online';
import { INPUT_BITS, TRICK_SHIFT, FB_MAX_PER_TEAM, type FbBegin, type FbLobby, type FbConfig } from './net/protocol';

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
  /** Graphics: auto adapts the resolution to hold the frame rate. */
  graphics: 'auto' | 'high' | 'balanced' | 'performance';
  home: string;
  away: string;
  /** Team management: saved line-up per club. */
  squads: Record<string, Lineup>;
}
const PROFILE_KEY = 'matchday:profile';
const profile: Profile = (() => {
  const d: Profile = { name: '', half: 180, difficulty: 'pro', camera: 'broadcast', zoom: 1, commentary: true, volume: 0.8, home: 'nbu', away: 'val', graphics: 'auto', squads: {} };
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
const DIFFS: Array<[FbConfig['difficulty'], string]> = CPU_LEVELS.map((level) => [level, CPU_PROFILE[level].label]);
const cpuDetail = (level: FbConfig['difficulty']) => `<small class="fb-cpu-detail" data-cpu-detail>${CPU_PROFILE[level].detail}</small>`;

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
/**
 * Render resolution: never the full Retina panel (that's 7+ million pixels through an HDR chain) —
 * a pixel budget per graphics level, times a dynamic scale that drops when frames run long.
 */
let perfScale = 1;
function pixelRatio(): number {
  const dpr = window.devicePixelRatio || 1;
  const q = profile.graphics;
  const [cap, budget] = q === 'high' ? [1.5, 3.6e6] : q === 'balanced' ? [1.25, 2.4e6] : q === 'performance' ? [1, 1.4e6] : [1.5, 3.2e6];
  const pr = Math.min(dpr, cap, Math.sqrt(budget / Math.max(1, window.innerWidth * window.innerHeight)));
  return Math.max(0.5, pr * (q === 'auto' ? perfScale : 1));
}
function viewQuality(): 'high' | 'balanced' | 'performance' {
  return profile.graphics === 'auto' ? 'high' : profile.graphics;
}

function getRenderer(): THREE.WebGLRenderer {
  if (renderer) return renderer;
  // (The HDR chain renders into its own multisampled target: the canvas's own MSAA would only be wasted bandwidth.)
  renderer = new THREE.WebGLRenderer({ canvas, antialias: profile.graphics === 'performance', powerPreference: 'high-performance' });
  renderer.setPixelRatio(pixelRatio());
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
function screen(html: string, cls = ''): HTMLDivElement {
  menuActive = true;
  ui.innerHTML = `<div class="fb-screen ${cls} ${backdrop ? 'glass' : ''}">${html}</div>`;
  menuFocus = 0;
  return ui.firstElementChild as HTMLDivElement;
}

// ---------------------------------------------------------------- menu backdrop: a live match in the stadium

interface Backdrop {
  sim: MatchSim;
  view: MatchView;
  raf: number;
  last: number;
  acc: number;
  size?: () => void;
}
let backdrop: Backdrop | null = null;
let backdropWanted = false;
async function startBackdrop(): Promise<void> {
  backdropWanted = true;
  if (backdrop || game) return;
  try {
    await loadPlayerModel();
  } catch {
    return;
  }
  if (backdrop || game || !backdropWanted) return;
  const home = CLUB[profile.home] ?? CLUBS[0]!;
  const away = CLUB[profile.away] ?? CLUBS[1]!;
  const sim = new MatchSim({ home: home.id, away: away.id === home.id ? CLUBS.find((c) => c.id !== home.id)!.id : away.id, halfSeconds: 900, difficulty: 'world' });
  const view = new MatchView(sim.clubs, kitsFor(sim.clubs[0], sim.clubs[1]));
  const bd: Backdrop = { sim, view, raf: 0, last: performance.now(), acc: 0 };
  backdrop = bd;
  ui.querySelector('.fb-screen')?.classList.add('glass');
  const size = () => {
    const r = getRenderer();
    const w = window.innerWidth;
    const h = window.innerHeight;
    r.setPixelRatio(pixelRatio());
    r.setSize(w, h, false);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    view.quality = viewQuality();
    view.camera.aspect = w / h;
    view.setLens(40);
    view.resize(w, h, r.getPixelRatio());
  };
  size();
  bd.size = size;
  window.addEventListener('resize', size);
  const loop = (now: number) => {
    if (backdrop !== bd) return;
    bd.raf = requestAnimationFrame(loop);
    const dt = Math.max(0, Math.min(0.1, (now - bd.last) / 1000));
    bd.last = now;
    bd.acc += dt;
    const none = new Map<string, Input>();
    while (bd.acc >= TICK) {
      bd.acc -= TICK;
      sim.step(none);
      sim.events.length = 0;
      if (sim.phase === 'goal') sim.skipGoal();
    }
    // A slow orbit on the play, low and close: the menu sits over a living stadium.
    const b = sim.ball;
    const a = now / 1000 * 0.06;
    view.cinematic = { pos: new THREE.Vector3(b.x + Math.cos(a) * 26, 7.5, b.z + Math.sin(a) * 26), look: new THREE.Vector3(b.x, 1.2, b.z), fov: 32 };
    view.update(readFrame(writeFrame(sim)), dt, now / 1000, 0.4);
    view.render(getRenderer());
  };
  bd.raf = requestAnimationFrame(loop);
}
function stopBackdrop(): void {
  backdropWanted = false;
  const bd = backdrop;
  if (!bd) return;
  backdrop = null;
  cancelAnimationFrame(bd.raf);
  if (bd.size) window.removeEventListener('resize', bd.size);
  bd.view.dispose();
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
    menuFocus %= btns.length;
    if (y && y !== prevNav.y) {
      menuFocus = (menuFocus + y + btns.length) % btns.length;
      btns[menuFocus]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    if (x && x !== prevNav.x) {
      const el = btns[menuFocus];
      el?.dispatchEvent(new CustomEvent('navx', { detail: x }));
    }
    btns.forEach((e, i) => e.classList.toggle('focus', i === menuFocus && pads.length > 0));
    if (pads.length && document.activeElement !== btns[menuFocus]) btns[menuFocus]?.focus({ preventScroll: true });
    if (a && !prevNav.a) btns[menuFocus]?.click();
  }
  if (b && !prevNav.b) ui.querySelector<HTMLElement>('[data-back]')?.click();
  prevNav = { x, y, a, b };
}
setInterval(menuNav, 50);

// ---------------------------------------------------------------- main menu

function mainMenu(): void {
  menuActive = true;
  void startBackdrop();
  const s = screen(
    `<div class="fb-title"><div class="logo">MATCHDAY<span>27</span></div><div class="sub">Eleven-a-side football · ${CLUBS.length} clubs · FC-style controls</div></div>
    <div class="fb-menu">
      <button data-nav data-a="kickoff" class="big">⚽ Kick-Off</button>
      <button data-nav data-a="online">🌐 Online · LAN</button>
      <button data-nav data-a="training">🏟 Training centre</button>
      <button data-nav data-a="replays">⏪ Replay theatre</button>
      <button data-nav data-a="settings">⚙️ Settings</button>
      <button data-nav data-a="squad">📋 Team management</button>
      <button data-nav data-a="controls">🎮 Controls</button>
      <button data-nav data-a="skills">🪄 Skill moves</button>
      <button data-nav data-a="fs">⛶ Fullscreen</button>
      <a data-nav href="/" class="btn ghost">← Arcade</a>
    </div>`,
    'home',
  );
  s.querySelector('[data-a=kickoff]')!.addEventListener('click', () => teamSelect());
  s.querySelector('[data-a=online]')!.addEventListener('click', () => onlineMenu());
  s.querySelector('[data-a=training]')!.addEventListener('click', trainingMenu);
  s.querySelector('[data-a=replays]')!.addEventListener('click', () => void replayLibrary());
  s.querySelector('[data-a=settings]')!.addEventListener('click', () => settings(mainMenu));
  s.querySelector('[data-a=controls]')!.addEventListener('click', () => controls(mainMenu));
  s.querySelector('[data-a=skills]')!.addEventListener('click', () => skills(mainMenu));
  s.querySelector('[data-a=squad]')!.addEventListener('click', () => teamManagement(0, mainMenu));
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
      <div class="fb-cpu-setting"><label>Difficulty <select data-k="difficulty">${DIFFS.map(([v, l]) => `<option value="${v}" ${v === profile.difficulty ? 'selected' : ''}>${l}</option>`).join('')}</select></label>${cpuDetail(profile.difficulty)}</div>
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
    s.querySelector<HTMLElement>('[data-cpu-detail]')!.textContent = CPU_PROFILE[profile.difficulty].detail;
    save();
  });
  s.querySelector('.go')!.addEventListener('click', controllerSelect);
  const bar = s.querySelector('.fb-bar')!;
  const tm = document.createElement('button');
  tm.dataset.nav = '';
  tm.textContent = '📋 Team management';
  bar.insertBefore(tm, bar.querySelector('.go'));
  tm.addEventListener('click', () => teamManagement(0, teamSelect));
}

// ---------------------------------------------------------------- team management

const MENTALITY: Array<[number, string]> = [
  [-1, 'Ultra defensive'],
  [-0.5, 'Defensive'],
  [0, 'Balanced'],
  [0.5, 'Attacking'],
  [1, 'All-out attack'],
];
/** The saved line-up for a club (or its default: its own formation, the first eleven). */
function lineupFor(c: Club): Lineup {
  const s = profile.squads?.[c.id];
  const ok = s && FORMATIONS[s.formation] && s.xi.length === 11 && new Set(s.xi).size === 11 && s.xi.every((i) => i >= 0 && i < c.players.length);
  return ok ? { formation: s.formation, xi: [...s.xi], mentality: s.mentality ?? 0 } : { formation: c.formation, xi: c.players.slice(0, 11).map((_, i) => i), mentality: 0 };
}
/** How well a player fits a slot (his own position, the same line, or out of position). */
function fit(natural: string, slot: string): 'ok' | 'near' | 'off' {
  if (natural === slot) return 'ok';
  const line = (r: string) => (r === 'GK' ? 0 : ['CB', 'LB', 'RB'].includes(r) ? 1 : ['CDM', 'CM', 'CAM', 'LM', 'RM'].includes(r) ? 2 : 3);
  return line(natural) === line(slot) || (['LM', 'RM', 'CAM'].includes(natural) && line(slot) === 3) || (['LW', 'RW'].includes(natural) && ['LM', 'RM', 'CAM'].includes(slot)) ? 'near' : 'off';
}
function teamManagement(side: 0 | 1, back: () => void): void {
  const club = CLUB[side ? profile.away : profile.home]!;
  const lu = lineupFor(club);
  let pick: { kind: 'xi' | 'bench'; i: number } | null = null;
  const s = screen(
    `<h1>Team management</h1>
    <div class="tm-tabs"><button data-nav data-side="0" class="${side === 0 ? 'on' : ''}">${badgeSvg(CLUB[profile.home]!, 26)} ${CLUB[profile.home]!.name}</button><button data-nav data-side="1" class="${side === 1 ? 'on' : ''}">${badgeSvg(CLUB[profile.away]!, 26)} ${CLUB[profile.away]!.name}</button></div>
    <div class="tm-opts"><label>Formation <select data-k="formation">${(Object.keys(FORMATIONS) as FormationId[]).map((f) => `<option ${f === lu.formation ? 'selected' : ''}>${f}</option>`).join('')}</select></label>
      <label>Mentality <select data-k="mentality">${MENTALITY.map(([v, l]) => `<option value="${v}" ${v === lu.mentality ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <span class="tm-ovr"></span></div>
    <div class="tm-body"><div class="tm-pitch"></div><div class="tm-bench"><h3>Substitutes</h3><div class="tm-subs"></div><p class="hint">Pick a player, then another to swap them (starter ↔ starter or ↔ sub). Red = out of position.</p></div></div>
    <div class="fb-bar"><button data-back data-nav class="ghost">← Done</button><button data-nav data-a="reset">Reset to default</button></div>`,
    'tm',
  );
  const persist = () => {
    profile.squads = { ...(profile.squads ?? {}), [club.id]: { formation: lu.formation, xi: [...lu.xi], mentality: lu.mentality } };
    save();
  };
  const card = (p: PlayerDef, slotRole: string | null, kind: 'xi' | 'bench', i: number) => {
    const f = slotRole ? fit(p.role, slotRole) : 'ok';
    const on = pick && pick.kind === kind && pick.i === i;
    return `<button data-nav class="tm-card ${f} ${on ? 'pick' : ''}" data-kind="${kind}" data-i="${i}">${slotRole ? `<em>${slotRole}</em>` : ''}<b>${p.ovr}</b><span>${p.num} ${esc(p.name)}</span><small>${p.role}</small></button>`;
  };
  const draw = () => {
    const slots = FORMATIONS[lu.formation];
    const pitch = s.querySelector('.tm-pitch') as HTMLElement;
    // The pitch drawn attacking upwards: slot x (−1 own goal … 1) → top, z (left … right) → left.
    pitch.innerHTML = slots
      .map((sl, k) => `<div class="tm-slot" style="left:${50 + sl.z * 42}%;top:${92 - ((sl.x + 1) / 1.1) * 84}%">${card(club.players[lu.xi[k]!]!, sl.role, 'xi', k)}</div>`)
      .join('');
    const bench = club.players.map((_, i) => i).filter((i) => !lu.xi.includes(i));
    (s.querySelector('.tm-subs') as HTMLElement).innerHTML = bench.map((i) => card(club.players[i]!, null, 'bench', i)).join('');
    const xi = lu.xi.map((i) => club.players[i]!);
    (s.querySelector('.tm-ovr') as HTMLElement).innerHTML = `Team OVR <b>${Math.round(xi.reduce((a, p) => a + p.ovr, 0) / 11)}</b>`;
    s.querySelectorAll<HTMLElement>('.tm-card').forEach((b) =>
      b.addEventListener('click', () => {
        const me = { kind: b.dataset.kind as 'xi' | 'bench', i: Number(b.dataset.i) };
        if (!pick) pick = me;
        else if (pick.kind === me.kind && pick.i === me.i) pick = null;
        else {
          if (pick.kind === 'xi' && me.kind === 'xi') [lu.xi[pick.i], lu.xi[me.i]] = [lu.xi[me.i]!, lu.xi[pick.i]!];
          else if (pick.kind !== me.kind) {
            const slot = pick.kind === 'xi' ? pick.i : me.i;
            lu.xi[slot] = pick.kind === 'bench' ? pick.i : me.i;
          }
          pick = null;
          persist();
        }
        draw();
      }),
    );
  };
  draw();
  s.querySelector<HTMLSelectElement>('[data-k=formation]')!.addEventListener('change', (e) => {
    lu.formation = (e.target as HTMLSelectElement).value as FormationId;
    persist();
    draw();
  });
  s.querySelector<HTMLSelectElement>('[data-k=mentality]')!.addEventListener('change', (e) => {
    lu.mentality = Number((e.target as HTMLSelectElement).value);
    persist();
  });
  s.querySelectorAll<HTMLElement>('[data-side]').forEach((b) => b.addEventListener('click', () => teamManagement(Number(b.dataset.side) as 0 | 1, back)));
  s.querySelector('[data-a=reset]')!.addEventListener('click', () => {
    const squads = { ...(profile.squads ?? {}) };
    delete squads[club.id];
    profile.squads = squads;
    save();
    teamManagement(side, back);
  });
  s.querySelector('[data-back]')!.addEventListener('click', back);
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
      <div class="fb-cpu-setting"><label>Difficulty ${opt('difficulty', DIFFS)}</label>${cpuDetail(profile.difficulty)}</div>
      <label>Camera ${opt('camera', [
        ['broadcast', 'Broadcast (default)'],
        ['tele', 'Tele broadcast (wide)'],
        ['end', 'End to end'],
      ] as Array<[CameraMode, string]>)}</label>
      <label>Camera zoom <input type="range" min="0.75" max="1.4" step="0.05" data-k="zoom" value="${profile.zoom}"></label>
      <label>Graphics ${opt('graphics', [
        ['auto', 'Auto (holds 60 fps)'],
        ['high', 'High'],
        ['balanced', 'Balanced'],
        ['performance', 'Performance'],
      ] as Array<[Profile['graphics'], string]>)}</label>
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
      if (k === 'difficulty') s.querySelector<HTMLElement>('[data-cpu-detail]')!.textContent = CPU_PROFILE[profile.difficulty].detail;
      audio.commentary = profile.commentary;
      audio.setVolume(profile.volume);
      if (game) {
        if (k === 'difficulty' && game.sim) game.sim.opts.difficulty = profile.difficulty;
        game.resizeNow();
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
  ['Pass / Header', '✕', 'J · ,'],
  ['Shoot (hold = power) · volley · header', '○', 'K · .'],
  ['Through ball', '△', 'L · /'],
  ['Lob pass / Cross', '□', 'I · ;'],
  ['Finesse shot', 'R1 + ○', 'U + K'],
  ['Chip shot / Lofted through', 'L1 + ○ / L1 + △', 'O + K / O + L'],
  ['Power shot (long wind-up)', 'R1 + L1 + ○', 'U + O + K'],
  ['Overhead kick', '○ as a high ball drops, back to goal', 'K · .'],
  ['Skill moves', 'Right-stick combos (see Skill moves)', '1–6 · 7 8 9 0 - ='],
  ['Knock-on', 'R3 / flick R-stick ↑', 'E · N'],
  ['Defending: cut out their pass', 'hold ✕ while it travels', 'hold J'],
  ['Defending: contain (jockey)', 'hold ✕', 'hold J'],
  ['Defending: standing tackle', '○', 'K'],
  ['Defending: slide tackle', '□', 'I'],
  ['Defending: team-mate press', 'hold R1', 'hold U'],
  ['Defending: keeper rushes out', 'hold △', 'hold L'],
  ['Defending a free kick: wall jumps', '△ (as it\'s struck)', 'L'],
  ['Switch player (nearest to the ball)', 'L1', 'Q · M'],
  ['Keeper with the ball: throw (hold ✕ = long throw)', '✕ · △', 'J · L'],
  ['Keeper with the ball: kick it long (hold = further)', '○ · □', 'K · I'],
  ['Keeper with the ball: drop it to your feet', 'R3', 'E · N'],
  ['Free kick / penalty / corner: change taker', 'hold L2 + ◀ ▶', 'hold F + A D · hold Enter + ← →'],
  ['Facing a penalty: keeper dives', 'R-stick ← / → (leave it = stay)', 'Z / C · [ / ]'],
  ['Pause', 'OPTIONS', 'Esc · Backspace'],
];
function skillsHtml(): string {
  return `<p class="hint">100 playable moves · five sets of 20. Equip a move, then press <b>T (P1) / B (P2)</b> or <b>L2 + R3</b>. Your normal right-stick combos still work.</p>
    <nav class="fb-skill-tabs">${SKILL_SETS.map((s) => `<button data-nav data-skill-tier="${s.stars}" class="${s.stars === 1 ? 'selected' : ''}">${'★'.repeat(s.stars)}<small>20 moves</small></button>`).join('')}</nav>
    ${SKILL_SETS.map((s) => `<div class="fb-skill-set" data-tier="${s.stars}" ${s.stars === 1 ? '' : 'hidden'}>${s.moves.map((m) => `<article class="fb-skill-card ${m.id === getEquippedSkill() ? 'equipped' : ''}" data-skill="${m.id}"><b>${m.name}</b><p>${m.description}</p><div><button data-nav data-equip="${m.id}">${m.id === getEquippedSkill() ? '✓ Equipped' : 'Equip'}</button><button data-nav data-practice="${m.id}">Practice ▶</button></div></article>`).join('')}</div>`).join('')}
    <details><summary>Classic right-stick controls</summary><table class="fb-ctrls skills"><tr><th>Skill</th><th>Right stick</th><th>Keys (P1 · P2)</th></tr>${SKILL_GUIDE.map(([n, rs, k]) => `<tr><td>${n}</td><td>${rs}</td><td>${k}</td></tr>`).join('')}</table></details>`;
}
function bindSkills(host: HTMLElement, practice: (id: number) => void): void {
  host.querySelectorAll<HTMLElement>('[data-skill-tier]').forEach((b) => b.onclick = () => {
    host.querySelectorAll<HTMLElement>('[data-tier]').forEach((s) => s.hidden = s.dataset.tier !== b.dataset.skillTier);
    host.querySelectorAll<HTMLElement>('[data-skill-tier]').forEach((t) => t.classList.toggle('selected', t === b));
    menuFocus = [...ui.querySelectorAll<HTMLElement>('[data-nav]')].filter((e) => e.offsetParent !== null).indexOf(b);
  });
  host.querySelectorAll<HTMLElement>('[data-equip]').forEach((b) => b.onclick = () => {
    equipSkill(Number(b.dataset.equip));
    try { localStorage.setItem('matchday:equipped-skill', String(getEquippedSkill())); } catch { /* optional */ }
    host.querySelectorAll<HTMLElement>('[data-equip]').forEach((e) => e.textContent = Number(e.dataset.equip) === getEquippedSkill() ? '✓ Equipped' : 'Equip');
    host.querySelectorAll<HTMLElement>('[data-skill]').forEach((c) => c.classList.toggle('equipped', Number(c.dataset.skill) === getEquippedSkill()));
  });
  host.querySelectorAll<HTMLElement>('[data-practice]').forEach((b) => b.onclick = () => practice(Number(b.dataset.practice)));
}
function skills(back: () => void): void {
  const s = screen(`<h1>Skill moves</h1>${skillsHtml()}<div class="fb-bar"><button data-back data-nav class="ghost">← Back</button></div>`);
  s.querySelector('[data-back]')!.addEventListener('click', back);
  bindSkills(s, (id) => { equipSkill(id); void startTraining({ mode: 'skill', skillId: id }); });
}

function trainingMenu(): void {
  const s = screen(`<h1>Training centre</h1><p class="hint">Your match controls, an untimed pitch, and repeatable exercises with scores.</p>
    <div class="fb-training-menu"><button data-nav data-free class="training-card"><b>Free training</b><span>Open pitch · keeper · instant reset · free kicks and penalties</span></button>
    ${TRAINING_PACKS.map((p) => `<button data-nav class="training-card" data-pack="${p.id}"><b>${p.name}</b><span>${p.detail}</span><small>Best score ${trainingBest(p.id).toLocaleString()}</small></button>`).join('')}
    <button data-nav data-skills class="training-card"><b>Skill sets</b><span>1–5 stars · 20 moves in each set · equip and practice</span></button></div><button data-nav data-back class="ghost">← Main menu</button>`);
  s.querySelector('[data-free]')!.addEventListener('click', () => void startTraining({ mode: 'free', setup: 'open' }));
  s.querySelectorAll<HTMLElement>('[data-pack]').forEach((b) => b.onclick = () => void startTraining({ mode: 'pack', pack: b.dataset.pack as TrainingOptions['pack'] }));
  s.querySelector('[data-skills]')!.addEventListener('click', () => skills(trainingMenu));
  s.querySelector('[data-back]')!.addEventListener('click', mainMenu);
}
async function startTraining(options: TrainingOptions): Promise<void> {
  game?.dispose();
  await loading('Setting up the training pitch…');
  const home = CLUB[profile.home]!, away = CLUB[profile.away]!;
  const sim = new MatchSim({ home: home.id, away: away.id, halfSeconds: 900, difficulty: profile.difficulty, training: true });
  const device = connectedPads()[0] !== undefined ? `pad${connectedPads()[0]}` as DeviceId : 'kb1';
  sim.addHuman(device, 0);
  const training = new TrainingSession(sim, options);
  game = new Game([home, away], kitsFor(home, away), sim, [{ device, team: 0 }], [], null, -1, training);
  (window as unknown as { __fb: Game }).__fb = game;
}
let theatre: ReplayViewer | null = null;
async function replayLibrary(): Promise<void> {
  stopBackdrop();
  const s = screen('<h1>Replay theatre</h1><p class="hint">Loading saved matches…</p>');
  let replays: ReplayData[] = [];
  try { replays = await savedReplays(); } catch { /* storage may be disabled */ }
  if (!s.isConnected) return;
  s.innerHTML = `<h1>Replay theatre</h1><p class="hint">The last three matches are saved on this device. Replay any moment, from kickoff to the final whistle.</p>
    <div class="fb-training-menu">${replays.map((r, i) => { const f = readFrame(r.frames.at(-1)!); return `<button data-nav class="training-card" data-replay="${i}"><b>${CLUB[r.home]!.short} ${f.score[0]}–${f.score[1]} ${CLUB[r.away]!.short}</b><span>${new Date(r.date).toLocaleString()} · ${r.complete ? 'Full match' : 'Recorded so far'}</span><small>${Math.round((f.time - r.frames[0]![0]!) / 60)} minutes · ${r.events.length} event markers</small></button>`; }).join('') || '<p>Play a match first. Replays are also available from the match options while you play.</p>'}</div><button data-nav data-back class="ghost">← Main menu</button>`;
  s.querySelector('[data-back]')!.addEventListener('click', mainMenu);
  s.querySelectorAll<HTMLElement>('[data-replay]').forEach((b) => b.onclick = () => {
    const data = replays[Number(b.dataset.replay)]!;
    void loading('Opening the replay…').then(() => {
      ui.innerHTML = ''; menuActive = false;
      theatre = new ReplayViewer(data, ui, getRenderer(), () => { theatre = null; void replayLibrary(); });
      (window as unknown as { __fbReplay: ReplayViewer }).__fbReplay = theatre;
    });
  });
}

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
  // L2 held: left / right on the stick or d-pad (screen space) steps through the set-piece takers.
  return { mx, mz, sprint: p.sprint, pass: p.pass, shoot: p.shoot, through: p.through, lob: p.lob, finesse: p.finesse, chip: p.chip, switch: p.switch, skill: p.skill, l2: p.l2, tkNext: p.l2 && p.sx > 0.6, tkPrev: p.l2 && p.sx < -0.6, trick: p.trick, dive: diveFor(view, p) };
}
/** Right stick left / right on screen → the keeper's dive across the goal (pitch z sign). */
function diveFor(view: MatchView, p: Pad): number {
  if (!p.rx) return 0;
  return Math.sign(toPitch(view, Math.sign(p.rx), 0)[1]);
}

let game: Game | null = null;

class Game {
  readonly recording: MatchRecording;
  private manualReplay: ReplayViewer | null = null;
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
  /** Pre-match broadcast intro: seconds in (−1 = over). */
  private introT = 0;
  /** Which part of the goal sequence is on screen (celebration, replay angles): for the stinger wipes. */
  private goalSeg = -1;
  private goalTeam: 0 | 1 = 0;
  /** The VAR review on screen: the incident to replay and its lines. */
  private foulPresentation: { since: number; by: number; card: 'yellow' | 'red' | null; shown: boolean } | null = null;
  private varView: { at: number; ax: number; dx: number; az: number; what: 'offside' | 'penalty'; since: number; decided: boolean } | null = null;

  constructor(
    readonly clubs: [Club, Club],
    readonly kits: [Kit, Kit],
    readonly sim: MatchSim | null,
    readonly locals: LocalPlayer[],
    readonly humanNames: string[],
    readonly net: FootballNet | null = null,
    readonly myHuman = -1,
    readonly training: TrainingSession | null = null,
  ) {
    menuActive = false;
    ui.innerHTML = '';
    // Who actually plays in each slot (team management can change the XI).
    this.defs = sim ? sim.players.map((p) => p.def) : [...clubs[0].players.slice(0, 11), ...clubs[1].players.slice(0, 11)];
    this.recording = new MatchRecording(clubs[0].id, clubs[1].id, kits, this.defs);
    if (sim && !training) this.recording.record(writeFrame(sim), true);
    this.view = new MatchView(clubs, kits, this.defs);
    this.view.cameraMode = profile.camera;
    this.view.zoom = profile.zoom;
    this.hud = new Hud(ui, clubs, kits, humanNames);
    this.hud.defs = this.defs;
    this.resizeObs = () => this.resize();
    window.addEventListener('resize', this.resizeObs);
    this.resize();
    audio.resume();
    audio.startCrowd();
    audio.say(LINES.kickoff(clubs[0].name, clubs[1].name, clubs[0].stadium), true);
    this.hud.intro(clubs, kits, sim ? 'Press ✕ / J to skip' : '');
    if (training) {
      this.introT = -1; this.hud.introOut();
      training.mount(this.view.scene, ui, () => { this.dispose(); trainingMenu(); }, () => { this.paused = true; this.hud.overlay.innerHTML = `<div class="fb-pause wide">${skillsHtml()}<button data-nav data-return>Back to training</button></div>`; menuActive = true; bindSkills(this.hud.overlay, (id) => { this.dispose(); equipSkill(id); void startTraining({ mode: 'skill', skillId: id }); }); this.hud.overlay.querySelector('[data-return]')!.addEventListener('click', () => { this.hud.overlay.innerHTML = ''; this.paused = false; menuActive = false; }); });
    }
    this.raf = requestAnimationFrame((t) => this.loop(t));
  }

  readonly defs: PlayerDef[];
  playerName(i: number): string {
    return this.defs[i]?.name ?? '';
  }

  resizeNow(): void {
    this.resize();
  }
  private resize(): void {
    const r = getRenderer();
    const w = window.innerWidth;
    const h = window.innerHeight;
    r.setPixelRatio(pixelRatio());
    r.setSize(w, h, false);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    this.view.quality = viewQuality();
    this.view.camera.aspect = w / h;
    this.view.setLens(w / h < 1.4 ? 38 : 30);
    this.view.resize(w, h, r.getPixelRatio());
    this.view.camera.userData.w = w;
    this.view.camera.userData.h = h;
  }

  /** Frame-time average and when the resolution was last adjusted (auto graphics). */
  private frameMs = 16.7;
  private perfAt = 0;

  private loop(now: number): void {
    this.raf = requestAnimationFrame((t) => this.loop(t));
    const raw = now - this.last;
    if (raw > 0 && raw < 200) this.frameMs += (raw - this.frameMs) * 0.05;
    if (profile.graphics === 'auto' && now - this.perfAt > 1500) {
      // Hold ~60 fps: shave the resolution while frames run long, give it back when there's headroom.
      this.perfAt = now;
      const before = perfScale;
      if (this.frameMs > 18.5) perfScale = Math.max(0.55, perfScale - 0.1);
      else if (this.frameMs < 13 && perfScale < 1) perfScale = Math.min(1, perfScale + 0.05);
      if (perfScale !== before) this.resize();
    }
    const dt = Math.max(0, Math.min(0.1, (now - this.last) / 1000));
    this.last = now;
    if (this.paused && this.training && !this.training.completed && !this.hud.overlay.childElementCount) this.paused = false;
    if (this.manualReplay) { if (this.net && now - this.sentAt > 50) { this.sentAt = now; this.net.input({ x: 0, z: 0, b: 0 }); } return; }
    // Pause / skip (any local device).
    const pads = this.locals.length ? this.locals.map((l) => readDevice(l.device)) : [readKeyboard('kb1'), ...connectedPads().map((i) => readPad(i)!).filter(Boolean)];
    const pause = pads.some((p) => p.pause);
    if (pause && !this.prevPause && !this.ended) this.togglePause();
    this.prevPause = pause;
    const skip = pads.some((p) => p.pass || p.shoot);
    const pressed = skip && !this.prevSkip;
    if (this.training) this.training.controllerReset(pads.some((p) => p.chip && p.finesse && !p.shoot && !p.pass && !p.through));
    this.prevSkip = skip;
    if (this.introT >= 0) {
      // The broadcast opens: fly over the ground, line-ups, then down to the kick-off.
      this.introT += this.paused ? 0 : dt;
      const INTRO = this.sim ? 8.5 : 3;
      if ((pressed && this.introT > 0.4) || this.introT >= INTRO) this.endIntro();
      else {
        if (!this.sim) this.stepOnline(now);
        else if (!this.frame) this.frame = readFrame(writeFrame(this.sim));
        const f0 = this.frame;
        if (f0) {
          this.introCam(this.introT, INTRO);
          this.view.update(f0, dt, now / 1000, 0.35);
          this.hud.update(f0, this.view, dt, true, (i) => this.playerName(i));
          this.view.render(getRenderer());
        }
        return;
      }
    }
    if (this.sim) this.stepLocal(dt, pressed);
    else this.stepOnline(now);
    const f = this.currentFrame();
    if (!f) return;
    // Excitement: the ball near a goal, a goal just scored.
    const dGoal = PITCH.HL - Math.abs(f.ball.x);
    let ex = f.phase === 'play' ? Math.max(0, 1 - dGoal / 35) * (Math.abs(f.ball.z) < 22 ? 1 : 0.5) : 0.1;
    if (f.phase === 'goal') ex = 1;
    audio.setExcitement(ex);
    this.view.stadium.netReplay = f !== this.frame ? this.recording.data.events
      .filter((e) => e.net && f.time >= e.time && f.time - e.time < 5)
      .map((e) => ({ end: e.net!.end, impact: { time: e.time, x: e.net!.x, y: e.net!.y, z: e.net!.z, strength: e.net!.strength ?? 0.8 } })) : null;
    this.view.update(f, this.paused ? 0 : dt * this.replaySpeed, now / 1000, ex);
    // (Replays show the old picture, but the scoreboard stays live.)
    const live = this.frame;
    const hf = live && f !== live ? { ...f, score: live.score, clock: live.clock, half: live.half } : f;
    this.hud.update(hf, this.view, dt, this.replayT >= 0 || (live?.phase === 'var' && f !== live), (i) => this.playerName(i));
    this.view.render(getRenderer());
  }

  /** A restart sequence (kick-off, goal kick) has the camera. */
  private restartCam = false;
  /** Slow motion during replays (animation clips play at the same rate as the frames). */
  private replaySpeed = 1;

  private endIntro(): void {
    this.introT = -1;
    this.view.cinematic = null;
    this.view.bars = 0;
    this.hud.introOut();
    this.view.snap();
  }

  /** Intro camera: a high orbit of the ground, a sweep down the halfway line, into the broadcast position. */
  private introCam(t: number, total: number): void {
    const v = this.view;
    v.bars = 1;
    const k = t / total;
    if (k < 0.45) {
      // Inside the bowl, under the roofline, sweeping round the stands.
      const a = 0.6 + k * 2.4;
      const r = 70 - k * 30;
      v.cinematic = { pos: new THREE.Vector3(Math.cos(a) * r, 26 - k * 18, Math.sin(a) * r * 0.62), look: new THREE.Vector3(0, 2, 0), fov: 42, snap: t < 0.05 };
    } else if (k < 0.8) {
      const u = (k - 0.45) / 0.35;
      v.cinematic = { pos: new THREE.Vector3(-30 + u * 26, 9 - u * 6, PITCH.HW + 6 - u * 12), look: new THREE.Vector3(-2 + u * 2, 1, u * 2), fov: 30 - u * 6, snap: Math.abs(k - 0.45) < 0.01 };
    } else {
      v.cinematic = { pos: new THREE.Vector3(0, 22, PITCH.HW + 11), look: new THREE.Vector3(0, 0, -3), fov: 30 };
    }
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
      this.training?.beforeStep();
      if (this.training?.completed) { this.paused = true; break; }
      for (const l of this.locals) inputs.set(l.device, padToInput(this.view, readDevice(l.device)));
      sim.step(inputs);
      if (Math.round(sim.time / TICK) % 2 === 0) this.record(writeFrame(sim));
      const ev = sim.events.splice(0);
      if (this.training) { for (const e of ev) if (e.k === 'net') this.view.stadium.netImpact(e); this.training.update(ev); }
      else if (ev.length) this.onEvents(ev, sim.time);
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
      if (all.some((p) => p.l2 && p.sx > 0.6)) b |= INPUT_BITS.tkNext;
      if (all.some((p) => p.l2 && p.sx < -0.6)) b |= INPUT_BITS.tkPrev;
      const dive = all.map((p) => diveFor(this.view, p)).find((d) => d) ?? 0;
      if (dive < 0) b |= INPUT_BITS.diveL;
      if (dive > 0) b |= INPUT_BITS.diveR;
      b |= (all.find((p) => p.trick)?.trick ?? 0) << TRICK_SHIFT;
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
    if (!this.training) this.recording.record(data);
    this.history.push([data[0]!, data.slice()]);
    const cut = data[0]! - 34;
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
    if (this.training) {
      const tr = this.training;
      this.view.bars = 0;
      if (tr.camera === 'follow' && live.phase === 'play') {
        const p = live.players[live.humans[0]?.p ?? tr.hero.i]!;
        const x = p.x * 0.8 + live.ball.x * 0.2, z = p.z * 0.8 + live.ball.z * 0.2;
        // Fixed behind the attacking direction: movement stays stable through a skill's turn.
        this.view.cinematic = { pos: new THREE.Vector3(x - live.dir0 * 10, 6.5, z + 3), look: new THREE.Vector3(x + live.dir0 * 3, 0.8, z), fov: 52, snap: !this.view.cinematic };
      } else { this.view.cinematic = null; this.view.cameraMode = tr.camera === 'follow' ? 'end' : tr.camera; }
      return live;
    }
    this.replaySpeed = 1;
    // VAR: freeze on the moment (the pass / the contact), lines across the pitch, from the gantry.
    if (live.phase === 'var' && this.varView) {
      this.foulPresentation = null;
      const v = this.varView;
      const t = live.time - v.since;
      this.replayT = -1;
      this.goalSeg = -1;
      this.view.bars = 1;
      if (t > 0.8 && !v.decided) {
        const f = this.frameAt(v.at);
        if (f) {
          this.view.varLines = { a: v.ax, d: v.dx, az: v.az };
          const side = v.az > 0 ? 1 : -1;
          // Looking straight along the lines, high up, slowly pushing in.
          const push = Math.min(1, (t - 0.8) / 4);
          this.view.cinematic = { pos: new THREE.Vector3(v.dx, 15 - push * 5, v.az + side * (24 - push * 8)), look: new THREE.Vector3(v.dx, 0, v.az * 0.8), fov: 34 - push * 8, snap: t < 0.85 };
          return f;
        }
      }
      this.view.varLines = null;
      this.view.cinematic = null;
      return live;
    }
    if (this.view.varLines) this.view.varLines = null;
    // The referee warns or books the offender before the taker places the ball.
    const foul = this.foulPresentation;
    if (foul && live.time - foul.since < (foul.card ? 4 : 2.8) && live.phase !== 'goal') {
      const r = this.view.refs.list[0]!;
      const by = live.players[foul.by]!;
      this.view.refs.presentFoul(by.x, by.z, foul.card, live.time - foul.since);
      if (foul.card && !foul.shown && live.time - foul.since >= 1.2) {
        foul.shown = true;
        this.hud.card(foul.card, this.clubs[foul.by < 11 ? 0 : 1], this.playerName(foul.by), foul.card === 'red' && by.yellow >= 2);
      }
      const dx = by.x - r.x, dz = by.z - r.z, separation = Math.hypot(dx, dz) || 1;
      const x = (r.x + by.x) / 2, z = (r.z + by.z) / 2;
      const distance = Math.max(6, separation * 0.65 / (Math.tan(THREE.MathUtils.degToRad(25)) * this.view.camera.aspect));
      this.view.bars = 1;
      const first = !this.view.cinematic;
      this.view.cinematic = { pos: new THREE.Vector3(x - dz / separation * distance, 2.8 + separation * 0.08, z + dx / separation * distance), look: new THREE.Vector3(x, 1, z), fov: 50, snap: first };
      return live;
    }
    if (foul) {
      this.foulPresentation = null;
      this.view.refs.clearFoul();
      if (live.restart === 'free') this.view.refs.freeKick(live.restartTeam === 0 ? live.dir0 : -live.dir0);
      this.view.cinematic = null;
      this.view.bars = 0;
      this.view.snap();
    }
    if (live.phase === 'stop' && (live.restart === 'free' || live.restart === 'penalty') && live.players[live.taker]?.state === 'place') {
      const b = live.ball, s = live.restartTeam === 0 ? live.dir0 : -live.dir0;
      this.view.bars = 0.6;
      this.view.cinematic = { pos: new THREE.Vector3(b.x - s * 3.6, 1.7, b.z + 2.6), look: new THREE.Vector3(b.x - s * 0.4, 0.65, b.z), fov: 43, snap: !this.view.cinematic };
      this.restartCam = true;
      return live;
    }
    // Goal: the celebration up close, then the replay from two angles in slow motion.
    if (live.phase === 'goal' && this.goalAt >= 0) {
      const since = live.time - this.goalAt;
      const A0 = CELEBRATE_T;
      const A = { from: -2.4, to: 0.3, speed: 0.6 };
      const B = { from: -1.25, to: 0.25, speed: 0.5 };
      const B0 = A0 + (A.to - A.from) / A.speed;
      const B1 = B0 + (B.to - B.from) / B.speed;
      const seg = since < A0 ? 0 : since < B0 ? 1 : since < B1 ? 2 : 3;
      if (seg !== this.goalSeg) {
        if (seg > 0) this.hud.stinger(this.clubs[this.goalTeam]);
        this.goalSeg = seg;
      }
      this.view.bars = seg < 3 ? 1 : 0;
      if (seg === 0) {
        // Close on the scorer: a long lens just ahead of him, then round him as he poses.
        const sc = live.players.find((p) => p.state === 'celebrate');
        if (sc) {
          const fx = Math.cos(sc.face);
          const fz = -Math.sin(sc.face);
          const ahead = sc.t > 4.4 ? 7 : 5;
          const orbit = Math.max(0, 4.4 - sc.t) * 0.35;
          const ox = fx * Math.cos(orbit) - fz * Math.sin(orbit);
          const oz = fz * Math.cos(orbit) + fx * Math.sin(orbit);
          this.view.cinematic = { pos: new THREE.Vector3(sc.x + ox * ahead, 1.5, sc.z + oz * ahead + 1.5), look: new THREE.Vector3(sc.x, sc.t < 4.4 ? 0.9 : 1.2, sc.z), fov: 26, snap: since < 0.05 };
        } else {
          const b = live.ball;
          this.view.cinematic = { pos: new THREE.Vector3(b.x * 0.8, 6, b.z + 16), look: new THREE.Vector3(b.x, 1, b.z), fov: 28 };
        }
        return live;
      }
      if (seg === 1 || seg === 2) {
        if (this.replayT < 0) this.replayT = 0;
        const S = seg === 1 ? A : B;
        const rt = this.goalAt + S.from + (since - (seg === 1 ? A0 : B0)) * S.speed;
        const f = this.frameAt(rt);
        if (f) {
          this.replaySpeed = S.speed;
          const end = this.goalEnd;
          const b = f.ball;
          if (seg === 1) {
            // Low, behind the goal: the ball coming at the lens and into the net.
            this.view.cinematic = { pos: new THREE.Vector3(end * (PITCH.HL + 9), 2.4, b.z * 0.35 + (b.z > 0 ? -6 : 6)), look: new THREE.Vector3(b.x, Math.max(0.6, b.y * 0.6), b.z), fov: 32, snap: Math.abs(since - A0) < 0.05 };
          } else {
            // Tight tracking shot from the side on a long lens.
            this.view.cinematic = { pos: new THREE.Vector3(b.x - end * 7, 2.2, b.z + (b.z > 0 ? -11 : 11)), look: new THREE.Vector3(b.x, Math.max(0.7, b.y), b.z), fov: 17, snap: Math.abs(since - B0) < 0.05 };
          }
          return f;
        }
      }
      this.endReplay(live);
      return live;
    }
    // Restarts get their moment: the kick-off (low behind the kicker, rising to the gantry) and the goal kick.
    const kickoffLen = live.clock === 0 || live.clock === 45 * 60 ? 3.0 : 1.8;
    if (live.phase === 'kickoff' && live.restart === 'kickoff' && live.phaseT < kickoffLen) {
      const s = live.restartTeam === 0 ? live.dir0 : -live.dir0;
      const u = live.phaseT / kickoffLen;
      const e = u * u * (3 - 2 * u);
      this.view.bars = u < 0.8 ? 1 : 0;
      this.view.cinematic = { pos: new THREE.Vector3(-s * (7 - e * 5), 1.6 + e * 11, 2.5 + e * 22), look: new THREE.Vector3(s * 6 * (1 - e), 1 - e, 0), fov: 34 - e * 4, snap: live.phaseT < 0.05 };
      this.restartCam = true;
      return live;
    }
    if (live.phase === 'stop' && live.restart === 'goalkick' && live.phaseT < 1.7) {
      // Pitch-side, looking back at the keeper placing the ball, pushing in.
      const b = live.ball;
      const sx = Math.sign(b.x) || 1;
      const u = live.phaseT / 1.7;
      this.view.bars = 1;
      this.view.cinematic = { pos: new THREE.Vector3(b.x - sx * (12 - u * 3), 3.6 - u * 0.8, b.z * 0.4 + (b.z >= 0 ? -7 : 7)), look: new THREE.Vector3(b.x + sx * 1.5, 0.8, b.z), fov: 30, snap: live.phaseT < 0.05 };
      this.restartCam = true;
      return live;
    }
    if (this.restartCam) {
      // Ease back to the broadcast camera (no hard cut).
      this.restartCam = false;
      this.view.cinematic = null;
      this.view.bars = 0;
      return live;
    }
    if (this.view.cinematic) this.endReplay(live);
    return live;
  }

  private endReplay(live: Frame): void {
    this.replayT = -1;
    this.goalSeg = -1;
    this.view.cinematic = null;
    this.view.bars = 0;
    if (this.sim && live.phase === 'goal') this.sim.skipGoal();
  }

  // ---- events → sound, banners, commentary

  private onEvents(ev: MatchEvent[], time: number): void {
    this.recording.events(ev, time);
    const name = (i: number) => this.playerName(i);
    const teamOf = (i: number) => (i < 11 ? 0 : 1);
    const cam = this.view.camera.position;
    for (const e of ev) {
      switch (e.k) {
        case 'net': this.view.stadium.netImpact(e); break;
        case 'kick': {
          const p = this.frame?.players[e.p];
          audio.kick(Math.max(0.25, e.power), p ? Math.hypot(p.x - cam.x, p.z - cam.z) : 40);
          if (SHOT_KICKS.has(e.type)) this.lastShotAt = time;
          if (e.type === 'power') this.view.kick(0.35 + e.power * 0.3);
          else if ((e.type === 'shot' || e.type === 'penalty') && e.power > 0.85) this.view.kick(0.25);
          break;
        }
        case 'goal': {
          this.goalAt = time;
          this.goalTeam = e.team;
          const end = this.frame ? Math.sign(this.frame.ball.x || 1) : 1;
          this.goalEnd = end;
          const club = this.clubs[e.team];
          const kit = this.kits[e.team];
          this.view.stadium.celebrate(end, kit.shirt, kit.trim === kit.shirt ? '#ffffff' : kit.trim);
          this.view.kick(1);
          this.view.flashScreen(0.55);
          this.view.refs.goal();
          const forHuman = this.locals.some((l) => l.team === e.team) || (this.net && this.humanTeam() === e.team);
          audio.goal(forHuman || (!this.locals.length && !this.net) || e.team === 0);
          this.hud.goal(club, kit, e.own ? `${name(e.scorer)} (OG)` : name(e.scorer), e.minute, e.assist >= 0 && !e.own ? name(e.assist) : '');
          this.hud.tick(`⚽ ${esc(name(e.scorer))} ${e.minute}'${e.assist >= 0 ? ` <small>assist ${esc(name(e.assist))}</small>` : ''}`, 6);
          audio.say(e.own ? LINES.ownGoal(name(e.scorer)) : LINES.goal(name(e.scorer), club.name), true);
          break;
        }
        case 'save':
          audio.say(e.catch ? LINES.catch(name(e.gk)) : LINES.save(name(e.gk)), !e.catch);
          if (!e.catch) audio.ooh();
          break;
        case 'post':
          this.view.kick(0.6);
          audio.post();
          audio.say(LINES.post(), true);
          break;
        case 'tackle':
          if (e.won && Math.random() < 0.3) audio.say(LINES.tackle(name(e.p)));
          break;
        case 'foul': {
          const live = this.sim ? readFrame(writeFrame(this.sim)) : this.frame;
          const fp = live?.players[e.on];
          const by = live?.players[e.by];
          this.foulPresentation = { since: time, by: e.by, card: e.card, shown: false };
          if (e.penalty) this.view.refs.penalty(fp ? Math.sign(fp.x) * (PITCH.HL - PITCH.SPOT) : 0);
          else this.view.refs.freeKick(teamOf(e.on) === 0 ? (this.frame?.dir0 ?? 1) : -(this.frame?.dir0 ?? 1));
          // The fouler protests (arms out), the fouled man goes down.
          this.view.players[e.by]?.gesture({ outR: 0.55, outL: 0.55, fwdR: 0.45, fwdL: 0.45, elbR: 0.5, elbL: 0.5 }, 1.8);
          if (e.card) {
            if (by) this.view.refs.approach(by.x, by.z, 3.8);
            this.hud.tick(`<span class="card ${e.card}"></span> ${esc(name(e.by))} <small>${this.clubs[teamOf(e.by)].short}</small>`, 5);
            audio.say(e.card === 'red' ? LINES.red(name(e.by)) : LINES.yellow(name(e.by)), true);
          } else {
            if (by) this.view.refs.warning(by.x, by.z);
            this.hud.warning(this.clubs[teamOf(e.by)], name(e.by));
            audio.say(`${name(e.by)} gets a warning from the referee.`, true);
          }
          if (e.penalty) {
            this.hud.show('<div class="g1 small">PENALTY</div>', 2.4);
            audio.say(LINES.penalty(), true);
            audio.cheer();
          }
          break;
        }
        case 'offside':
          this.view.refs.offside(this.frame?.players[e.p]?.x ?? 0);
          this.hud.show('<div class="g1 small">OFFSIDE</div>', 1.8);
          audio.say(LINES.offside());
          break;
        case 'whistle':
          this.view.refs.whistle();
          audio.whistle(e.long);
          break;
        case 'out': {
          const fb = this.frame?.ball;
          if (fb) {
            if (e.kind === 'corner') this.view.refs.corner(Math.sign(fb.x) * PITCH.HL, Math.sign(fb.z || 1) * PITCH.HW);
            else if (e.kind === 'goalkick') this.view.refs.goalKick(Math.sign(fb.x) * (PITCH.HL - 5));
          }
          if (e.kind === 'goalkick' && time - this.lastShotAt < 3) {
            audio.ooh();
            audio.say(LINES.miss());
          }
          if (e.kind === 'corner') audio.say(LINES.corner());
          break;
        }
        case 'restart':
          if (e.kind === 'free') {
            this.view.refs.freeKick(e.team === 0 ? (this.frame?.dir0 ?? 1) : -(this.frame?.dir0 ?? 1));
            this.hud.strap('FREE KICK', 'PLACE THE BALL · AIM · SHOOT OR PASS', this.clubs[e.team], null, 2);
          }
          if (e.kind === 'throw' && this.frame) this.view.refs.throwIn(this.frame.ball.x, e.team === 0 ? this.frame.dir0 : -this.frame.dir0);
          if (e.kind === 'kickoff') {
            this.view.refs.kickoffReady();
            // The kick-off strap: both crests, which half (or the score after a goal).
            const f = this.frame;
            const startHalf = !f || f.clock === 0 || f.clock === 45 * 60;
            const sub = !f || f.clock === 0 ? `${this.clubs[0].short} v ${this.clubs[1].short} · FIRST HALF` : f.clock === 45 * 60 ? 'SECOND HALF' : `${this.clubs[0].short} ${f.score[0]} - ${f.score[1]} ${this.clubs[1].short}`;
            this.hud.strap('KICK-OFF', sub, this.clubs[0], this.clubs[1], startHalf ? 2.6 : 1.6);
          }
          if (e.kind === 'goalkick') this.hud.strap('GOAL KICK', this.clubs[e.team].name.toUpperCase(), this.clubs[e.team], null, 1.5);
          break;
        case 'added':
          this.hud.strap(`+${e.mins}`, `ADDED TIME · ${e.mins} MINUTE${e.mins > 1 ? 'S' : ''}`, this.clubs[0], this.clubs[1], 2.4);
          audio.say(`The fourth official's board is up: ${e.mins} added minute${e.mins > 1 ? 's' : ''}.`);
          break;
        case 'trick':
          this.hud.tick(`🪄 ${esc(name(e.p))} <small>${TRICKS[e.trick] ?? ''}</small>`, 1.6);
          break;
        case 'var': {
          if (e.stage === 'check') {
            this.varView = { at: e.at, ax: e.ax, dx: e.dx, az: e.az, what: e.what, since: time, decided: false };
            this.hud.varBanner('check', e.what, e.what === 'offside' ? `${this.clubs[e.team].name} goal under review` : 'Was the contact inside the box?');
            this.view.refs.varCheck(VAR_T - 1.2);
            audio.say(e.what === 'offside' ? 'The VAR is having a look at this one…' : 'VAR checking whether that was inside the area.', true);
          } else {
            const over = e.stage === 'overturn';
            if (this.varView) this.varView.decided = true;
            this.view.refs.varDecision();
            const detail = e.what === 'offside' ? `${over ? 'Offside' : 'Onside'} by ${Math.abs(e.ax - e.dx).toFixed(2)} m` : over ? 'Contact was ' + (Math.abs(e.ax) > PITCH.HL - PITCH.BOX_D ? 'inside the area' : 'outside the area') : 'On-field decision stands';
            this.hud.varBanner(e.stage, e.what, detail);
            if (e.what === 'offside') {
              if (over) {
                audio.ooh();
                audio.say('No goal! The VAR rules it out for offside.', true);
              } else {
                audio.cheer();
                audio.say('The goal stands!', true);
              }
            }
            setTimeout(() => (this.varView = null), 400);
          }
          break;
        }
        case 'half':
          if (e.half === 1) this.view.refs.endHalf();
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
          this.view.refs.endHalf();
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
    if (this.sim) this.recording.record(writeFrame(this.sim), true);
    void saveReplay(this.recording.snapshot()).catch(() => this.hud.tick('Replay storage unavailable · replay remains available in this match', 4));
    const f = this.frame!;
    audio.say(LINES.full(this.clubs[0].name, this.clubs[1].name, f.score[0], f.score[1]), true);
    this.showStats('Full time');
    const bar = document.createElement('div');
    bar.className = 'fb-bar center';
    bar.innerHTML = this.net ? `<button data-nav class="go">Back to lobby</button>` : `<button data-nav class="go">Rematch</button><button data-nav class="ghost">Main menu</button>`;
    this.hud.overlay.querySelector('.fb-stats')!.appendChild(bar);
    menuActive = true;
    const [a, b] = bar.querySelectorAll('button');
    const replay = document.createElement('button'); replay.dataset.nav = ''; replay.textContent = '⏪ Watch full match'; bar.append(replay);
    replay.onclick = () => this.openReplay();
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
    if (this.training) { this.trainingOptions(); return; }
    this.hud.overlay.innerHTML = `<div class="fb-pause"><h2>${this.sim ? 'Paused' : 'Menu'}</h2>
      <button data-nav data-a="resume">Resume</button>
      <button data-nav data-a="stats">Match facts</button>
      <button data-nav data-a="replay">⏪ Replay match</button>
      <button data-nav data-a="cam">Camera: <span>${profile.camera}</span></button>
      <button data-nav data-a="comm">Commentary: <span>${profile.commentary ? 'On' : 'Off'}</span></button>
      <button data-nav data-a="controls">Controls</button>
      <button data-nav data-a="skills">Skill moves</button>
      <button data-nav data-a="quit" class="ghost">${this.net ? 'Leave match' : 'Quit match'}</button></div>`;
    const o = this.hud.overlay;
    o.querySelector('[data-a=replay]')?.addEventListener('click', () => this.openReplay());
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
    o.querySelector('[data-a=skills]')!.addEventListener('click', () => {
      o.innerHTML = `<div class="fb-pause wide">${skillsHtml()}<button data-nav data-a="back">Back</button></div>`;
      bindSkills(o, (id) => { this.dispose(); equipSkill(id); void startTraining({ mode: 'skill', skillId: id }); });
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
    else if (this.training) trainingMenu();
    else mainMenu();
  }

  private trainingOptions(): void {
    menuFocus = 0;
    const tr = this.training!, o = this.hud.overlay;
    o.innerHTML = `<div class="fb-pause"><h2>Training options</h2><button data-nav data-a="resume">Resume training</button>
      <button data-nav data-tr="camera">Camera: ${tr.camera}</button>${tr.options.mode === 'free' ? `<button data-nav data-tr="setup">Situation: ${tr.options.setup ?? 'open'}</button><button data-nav data-tr="mates">Teammates: ${tr.teammates}</button><button data-nav data-tr="defenders">Defenders: ${tr.opponents}</button>` : ''}
      <button data-nav data-a="reset">Reset ball / exercise</button>${tr.options.mode === 'skill' ? '<button data-nav data-a="demo">Demonstrate skill</button>' : ''}<button data-nav data-a="skills">Skill sets</button><button data-nav data-back data-a="resume">Back to pitch</button><button data-nav data-a="quit">Training menu</button></div>`;
    o.querySelectorAll('[data-a=resume]').forEach((b) => b.addEventListener('click', () => this.togglePause()));
    o.querySelectorAll<HTMLElement>('[data-tr]').forEach((b) => {
      const adjust = (step: number) => { tr.adjust(b.dataset.tr as 'camera' | 'setup' | 'mates' | 'defenders', step); b.textContent = b.dataset.tr === 'camera' ? `Camera: ${tr.camera}` : b.dataset.tr === 'setup' ? `Situation: ${tr.options.setup}` : b.dataset.tr === 'mates' ? `Teammates: ${tr.teammates}` : `Defenders: ${tr.opponents}`; };
      b.onclick = () => adjust(1); b.addEventListener('navx', (e) => adjust((e as CustomEvent<number>).detail));
    });
    o.querySelector('[data-a=reset]')!.addEventListener('click', () => { tr.reset(); this.togglePause(); });
    o.querySelector('[data-a=demo]')?.addEventListener('click', () => { tr.reset(); tr.demo(); this.togglePause(); });
    o.querySelector('[data-a=skills]')!.addEventListener('click', () => {
      o.innerHTML = `<div class="fb-pause wide">${skillsHtml()}<button data-nav data-back>Back to training options</button></div>`;
      menuFocus = 0;
      bindSkills(o, (id) => { this.dispose(); equipSkill(id); void startTraining({ mode: 'skill', skillId: id }); });
      o.querySelector('[data-back]')!.addEventListener('click', () => this.trainingOptions());
    });
    o.querySelector('[data-a=quit]')!.addEventListener('click', () => this.quit());
  }

  openReplay(): void {
    if (this.manualReplay || this.training) return;
    if (this.sim) this.recording.record(writeFrame(this.sim), true);
    const data = this.recording.snapshot();
    if (data.frames.length < 2) { this.hud.tick('Play a few seconds first to record the match', 2); return; }
    this.paused = !!this.sim; menuActive = false; this.hud.overlay.innerHTML = ''; ui.classList.add('is-replay');
    this.manualReplay = new ReplayViewer(data, ui, getRenderer(), () => {
      this.manualReplay = null; ui.classList.remove('is-replay'); this.acc = 0; this.view.cameraMode = profile.camera;
      this.view.zoom = profile.zoom; this.view.cinematic = null; this.view.snap(); this.goalSeg = -1; this.resize();
      if (this.ended) { this.ended = false; this.fullTime(); } else this.togglePause();
    }, this.view);
    (window as unknown as { __fbReplay: ReplayViewer }).__fbReplay = this.manualReplay;
  }

  dispose(): void {
    this.manualReplay?.close(false); this.manualReplay = null; ui.classList.remove('is-replay');
    this.training?.dispose();
    if (!this.training && this.recording.data.frames.length > 1) void saveReplay(this.recording.snapshot()).catch(() => {});
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
  stopBackdrop();
  screen(`<div class="fb-loading"><div class="ball"></div><div>${text}</div></div>`);
  await Promise.all([loadPlayerModel(), audio.init()]);
}

async function startLocal(locals: LocalPlayer[]): Promise<void> {
  await loading('Walking out of the tunnel…');
  const home = CLUB[profile.home]!;
  const away = CLUB[profile.away]!;
  const sim = new MatchSim({ home: home.id, away: away.id, halfSeconds: profile.half, difficulty: profile.difficulty, lineups: [lineupFor(home), lineupFor(away)] });
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
        <div class="fb-cpu-setting"><label>CPU level <select data-k="difficulty" ${host ? '' : 'disabled'}>${DIFFS.map(([v, t]) => `<option value="${v}" ${l.config.difficulty === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>${cpuDetail(l.config.difficulty)}</div>
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

try { equipSkill(Number(localStorage.getItem('matchday:equipped-skill') ?? 3)); } catch { /* optional */ }
mainMenu();
