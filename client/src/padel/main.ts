import * as THREE from 'three';
import './styles.css';
import { bindFullscreenButton, installFullscreenKey } from '../ui/fullscreen';
import { MatchSim, TICK, type Input, type MatchEvent, type PlayerDef } from './sim/match';
import { readFrame, writeFrame, lerpFrame, type Frame } from './sim/snapshot';
import { LEVELS, type Level } from './sim/ai';
import { RACKETS, RACKET, headHalfWidth, HEAD_L, HANDLE_L, type Racket } from './sim/rackets';
import { COURTS, COURT_BY_ID } from './render/court';
import { MatchView, type ViewPlayer } from './render/view';
import { loadPlayerModel, SKINS, HAIRS, type Look } from './render/players';
import { Hud } from './hud';
import { PadelAudio } from './audio';
import { SwingInput } from './input';
import { CameraInput, CAM_COLORS, type Accuracy } from './camera/camera';
import type { RacketCal, Smoothing } from './camera/armtrack';
import type { Hand } from './camera/swing';
import type { LiveArm } from './sim/arm';
import { PadelNet } from './net/online';
import { PD_MAX_PER_TEAM, type PdBegin, type PdLobby, type PdConfig } from './net/protocol';

/**
 * Padel: 2 v 2 (or 1 v 1) on a regulation glass court, against bots, online or over the LAN. Swing with
 * the mouse — the stroke's direction and speed are the shot — and auto-move gets you to the ball.
 */
interface Profile {
  name: string;
  racket: string;
  court: string;
  mode: 1 | 2;
  partner: Level;
  opp: Level;
  games: 4 | 6;
  sets: 1 | 3;
  golden: boolean;
  sens: number;
  auto: boolean;
  volume: number;
  /** Camera play: people in front of the camera, their racket hands, sensitivity, model. */
  camPlayers: 1 | 2;
  camHands: [Hand, Hand];
  camSens: number;
  camAcc: Accuracy;
  /** Hand tracking for the racket's angle (more accurate, a little more work). */
  camHandTrack: boolean;
  /** Motion smoothing: responsive … smooth. */
  camSmooth: Smoothing;
  /** Per player: the calibrated racket-in-hand. */
  camCal: [RacketCal | null, RacketCal | null];
  name2: string;
  /** Swing with the camera online too. */
  camOnline: boolean;
  /** Camera play style: your arm drives theirs 1:1 (motion), or swings are read as gestures. */
  camStyle: 'motion' | 'gesture';
  /** Motion play: how close the racket must come to the ball. */
  camAssist: 'easy' | 'normal' | 'real';
}
const PROFILE_KEY = 'padel:profile';
const profile: Profile = (() => {
  const d: Profile = { name: 'Player', racket: 'tempest', court: 'blue', mode: 2, partner: 'intermediate', opp: 'intermediate', games: 4, sets: 1, golden: true, sens: 1, auto: true, volume: 0.8, camPlayers: 1, camHands: ['right', 'right'], camSens: 1, camAcc: 'auto', camHandTrack: true, camSmooth: 'balanced', camCal: [null, null], name2: 'Player 2', camOnline: false, camStyle: 'motion', camAssist: 'normal' };
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
    /* private mode */
  }
};

const root = document.getElementById('game')!;
root.innerHTML = `<canvas class="pd-canvas"></canvas><div class="pd-ui"></div><button class="pd-fs" title="Fullscreen (Ctrl+F)">⛶</button>`;
const canvas = root.querySelector('canvas') as HTMLCanvasElement;
const ui = root.querySelector('.pd-ui') as HTMLDivElement;
bindFullscreenButton(root.querySelector('.pd-fs') as HTMLButtonElement, ['⛶', '⛶']);
installFullscreenKey();
const audio = new PadelAudio();
audio.setVolume(profile.volume);
const swing = new SwingInput(canvas);
swing.settings = { sens: profile.sens, auto: profile.auto };
const camera = new CameraInput();
if (import.meta.env.DEV) (window as unknown as { __padelCam: unknown }).__padelCam = camera;
const applyCamera = () => {
  camera.detectors.forEach((d, i) => {
    d.hand = profile.camHands[i] ?? 'right';
    d.sens = profile.camSens;
  });
  camera.arms.forEach((a, i) => (a.cal = profile.camCal[i] ?? null));
  camera.smoothing = profile.camSmooth;
  if (camera.running) camera.handsChanged();
};
applyCamera();
/** People swinging with the camera in the current / last local match (0 = mouse). */
let camCount: 0 | 1 | 2 = 0;

let renderer: THREE.WebGLRenderer | null = null;
function getRenderer(): THREE.WebGLRenderer {
  if (renderer) return renderer;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
function screen(html: string, cls = ''): HTMLDivElement {
  ui.innerHTML = `<div class="pd-screen ${cls}">${html}</div>`;
  return ui.firstElementChild as HTMLDivElement;
}

/** The racket's silhouette as SVG (its real outline). */
function racketSvg(r: Racket, w = 64): string {
  const sc = w / 0.3;
  const pts: string[] = [];
  const N = 40;
  for (let i = 0; i <= N; i++) {
    const y = (i / N) * HEAD_L;
    pts.push(`${(0.15 + headHalfWidth(r.shape, y)) * sc},${(HEAD_L - y) * sc}`);
  }
  for (let i = N; i >= 0; i--) {
    const y = (i / N) * HEAD_L;
    pts.push(`${(0.15 - headHalfWidth(r.shape, y)) * sc},${(HEAD_L - y) * sc}`);
  }
  const H = (HEAD_L + HANDLE_L) * sc;
  const holes: string[] = [];
  for (let y = 0.075; y < HEAD_L - 0.03; y += 0.03)
    for (let x = -(headHalfWidth(r.shape, y) - 0.03); x <= headHalfWidth(r.shape, y) - 0.03; x += 0.03) holes.push(`<circle cx="${(0.15 + x) * sc}" cy="${(HEAD_L - y) * sc}" r="${0.006 * sc}" fill="rgba(0,0,0,.35)"/>`);
  return `<svg viewBox="0 0 ${0.3 * sc} ${H}" width="${w}" height="${(H * w) / (0.3 * sc)}"><rect x="${0.15 * sc - 0.016 * sc}" y="${HEAD_L * sc - 2}" width="${0.032 * sc}" height="${HANDLE_L * sc}" rx="3" fill="#eee"/><polygon points="${pts.join(' ')}" fill="${r.colors[0]}" stroke="${r.colors[1]}" stroke-width="3"/><path d="M ${0.02 * sc} ${0.16 * sc} Q ${0.15 * sc} ${0.08 * sc} ${0.28 * sc} ${0.2 * sc}" stroke="${r.colors[1]}" stroke-width="6" fill="none" opacity=".9"/>${holes.join('')}</svg>`;
}

// ------------------------------------------------------------------ menus

function mainMenu(): void {
  game?.stop();
  game = null;
  camera.stop();
  const el = screen(
    `<div class="pd-logo">PADEL<span>·</span></div>
     <div class="pd-tag">Regulation glass court · 2 v 2 · swing with your mouse</div>
     <div class="pd-menu">
       <button class="pd-btn primary" data-go="play">▶ PLAY <small>vs bots</small></button>
       <button class="pd-btn cam" data-go="camera">📷 CAMERA PLAY <small>swing a real racket</small></button>
       <button class="pd-btn" data-go="online">🌐 ONLINE <small>with friends · LAN</small></button>
       <button class="pd-btn" data-go="how">❓ HOW TO PLAY</button>
       <button class="pd-btn" data-go="settings">⚙ SETTINGS</button>
       <a class="pd-btn ghost" href="/">← ARCADE</a>
     </div>`,
    'menu',
  );
  el.querySelector('[data-go=play]')!.addEventListener('click', setup);
  el.querySelector('[data-go=camera]')!.addEventListener('click', cameraScreen);
  el.querySelector('[data-go=online]')!.addEventListener('click', onlineMenu);
  el.querySelector('[data-go=how]')!.addEventListener('click', () => howTo(mainMenu));
  el.querySelector('[data-go=settings]')!.addEventListener('click', () => settings(mainMenu));
}

function seg<T extends string | number>(id: string, items: Array<[T, string]>, value: T): string {
  return `<div class="pd-seg" id="${id}">${items.map(([v, l]) => `<button data-v="${v}" class="${v === value ? 'on' : ''}">${l}</button>`).join('')}</div>`;
}
function bindSeg<T extends string | number>(el: HTMLElement, id: string, set: (v: T) => void, num = false): void {
  el.querySelectorAll(`#${id} button`).forEach((b) =>
    b.addEventListener('click', () => {
      el.querySelectorAll(`#${id} button`).forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      const v = (b as HTMLElement).dataset.v!;
      set((num ? Number(v) : v) as T);
      save();
    }),
  );
}
const LEVEL_ITEMS = (Object.keys(LEVELS) as Level[]).map((l) => [l, LEVELS[l].name.toUpperCase()] as [Level, string]);

function courtPicker(): string {
  return `<div class="pd-courts">${COURTS.map((c) => `<button class="pd-court ${c.id === profile.court ? 'on' : ''}" data-court="${c.id}" style="--turf:${c.turf};--accent:${c.accent}"><i></i><b>${c.name}</b><small>${c.indoor ? 'Indoor club' : 'Outdoor'}</small></button>`).join('')}</div>`;
}
function racketPicker(): string {
  const bar = (v: number) => `<span class="pd-bar"><i style="width:${Math.round(v * 100)}%"></i></span>`;
  return `<div class="pd-rackets">${RACKETS.map((r) => `<button class="pd-racket ${r.id === profile.racket ? 'on' : ''}" data-racket="${r.id}">${racketSvg(r, 54)}<div><b>${r.name}</b><small>${r.shape} · ${r.weight} g</small><div class="pd-stats">POWER ${bar(r.power)} CONTROL ${bar(r.control)} SWEET SPOT ${bar(r.sweet)}</div><p>${r.blurb}</p></div></button>`).join('')}</div>`;
}
function bindPickers(el: HTMLElement): void {
  el.querySelectorAll('[data-court]').forEach((b) =>
    b.addEventListener('click', () => {
      el.querySelectorAll('[data-court]').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      profile.court = (b as HTMLElement).dataset.court!;
      save();
    }),
  );
  el.querySelectorAll('[data-racket]').forEach((b) =>
    b.addEventListener('click', () => {
      el.querySelectorAll('[data-racket]').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      profile.racket = (b as HTMLElement).dataset.racket!;
      save();
    }),
  );
}

function setup(): void {
  const el = screen(
    `<h2>MATCH SETUP</h2>
     <div class="pd-grid">
       <div>
         <label>MODE</label>${seg('s-mode', [[2, '2 v 2 · DOUBLES'], [1, '1 v 1']], profile.mode)}
         <label>YOUR PARTNER</label>${seg('s-partner', LEVEL_ITEMS, profile.partner)}
         <label>OPPONENTS</label>${seg('s-opp', LEVEL_ITEMS, profile.opp)}
         <label>MATCH</label>${seg('s-len', [['4-1', 'SHORT · 1 SET TO 4'], ['6-1', '1 SET'], ['6-3', 'BEST OF 3']], `${profile.games}-${profile.sets}`)}
         <label>DEUCE</label>${seg('s-golden', [['1', 'GOLDEN POINT'], ['0', 'ADVANTAGE']], profile.golden ? '1' : '0')}
         <label>COURT</label>${courtPicker()}
       </div>
       <div><label>YOUR RACKET</label>${racketPicker()}</div>
     </div>
     <div class="pd-row-end"><button class="pd-btn ghost" data-back>BACK</button><button class="pd-btn primary" data-start>START MATCH</button></div>`,
    'setup',
  );
  bindSeg<number>(el, 's-mode', (v) => (profile.mode = v as 1 | 2), true);
  bindSeg<Level>(el, 's-partner', (v) => (profile.partner = v));
  bindSeg<Level>(el, 's-opp', (v) => (profile.opp = v));
  bindSeg<string>(el, 's-len', (v) => {
    const [g, s] = v.split('-').map(Number);
    profile.games = g as 4 | 6;
    profile.sets = s as 1 | 3;
  });
  bindSeg<string>(el, 's-golden', (v) => (profile.golden = v === '1'));
  bindPickers(el);
  el.querySelector('[data-back]')!.addEventListener('click', mainMenu);
  el.querySelector('[data-start]')!.addEventListener('click', () => void startLocal(0));
}

// ------------------------------------------------------------------ camera play

function cameraScreen(): void {
  const hands = (i: number) => seg(`c-hand${i}`, [['right', 'RIGHT-HANDED'], ['left', 'LEFT-HANDED'], ['auto', 'EITHER']], profile.camHands[i]!);
  const calRow = (i: number) => `<div class="pd-calrow"><button class="pd-btn small" data-cal="${i}">🎯 CALIBRATE RACKET</button><span id="c-cal${i}">${profile.camCal[i] ? 'Calibrated ✓' : 'Hold it straight up, face to the screen, then click'}</span></div>`;
  const el = screen(
    `<h2>📷 CAMERA PLAY</h2>
     <p class="pd-note">Hold a real racket (or anything racket-sized) and swing it at the screen. Auto-move runs you to the ball; you play the shots.</p>
     <div class="pd-camgrid">
       <div class="pd-camvisual">
         <div class="pd-camview"><canvas id="c-view" width="640" height="480"></canvas><div class="pd-camstat" id="c-stat">Starting the camera…</div><div class="pd-caminfo" id="c-info"></div></div>
         <figure class="pd-calguide">
           <img src="/assets/padel/calibration-example.webp" width="768" height="512" alt="Calibration pose: face the camera with your racket beside your shoulder, handle vertical, racket head above your hand, and its broad face pointing toward the camera." />
           <figcaption><b>MATCH THIS POSE TO CALIBRATE</b><ol><li>Point the racket <strong>straight up</strong>, with its broad face toward the camera.</li><li>Keep your <strong>gripping hand and wrist visible</strong>, beside your body.</li><li>Click <strong>CALIBRATE RACKET</strong> and hold still for <strong>2 seconds</strong>.</li></ol><span>Left-handed? Use the same pose with your left hand.</span></figcaption>
         </figure>
       </div>
       <div>
         <label>STYLE</label>${seg('c-style', [['motion', '1:1 MOTION · YOUR ARM IS THEIR ARM'], ['gesture', 'SWING GESTURES']], profile.camStyle)}
         <label>1:1 HIT ASSIST</label>${seg('c-assist', [['easy', 'EASY · BIG SWEET SPOT'], ['normal', 'NORMAL'], ['real', 'REAL RACKET SIZE']], profile.camAssist)}
         <label>PEOPLE IN FRONT OF THE CAMERA</label>${seg('c-n', [[1, '1 · YOU + A BOT PARTNER'], [2, '2 · TEAMMATES']], profile.camPlayers)}
         <div class="pd-camp" id="c-p0"><b style="color:${CAM_COLORS[0]}">P1</b> <span class="pd-camname">${esc(profile.name)}</span> — stands on the right (as you see yourself), plays the right side ${hands(0)}${calRow(0)}<div class="pd-cammeter"><i></i><span></span></div></div>
         <div class="pd-camp" id="c-p1"><b style="color:${CAM_COLORS[1]}">P2</b> <input id="c-name2" maxlength="16" value="${esc(profile.name2)}"> — stands on the left, plays the left side ${hands(1)}${calRow(1)}<div class="pd-cammeter"><i></i><span></span></div></div>
         <label>SWING SENSITIVITY <input id="c-sens" type="range" min="0.5" max="2.5" step="0.05" value="${profile.camSens}"><output>${profile.camSens.toFixed(2)}×</output></label>
         <label>TRACKING MODEL</label>${seg('c-acc', [['auto', 'AUTO'], ['precise', 'PRECISE'], ['fast', 'FAST']], profile.camAcc)}
         <label>HAND TRACKING (THE RACKET'S ANGLE)</label>${seg('c-ht', [['1', 'ON · ACCURATE'], ['0', 'OFF · LIGHTER']], profile.camHandTrack ? '1' : '0')}
         <label>MOTION</label>${seg('c-smooth', [['responsive', 'MOST RESPONSIVE'], ['balanced', 'BALANCED'], ['smooth', 'SMOOTHEST']], profile.camSmooth)}
         <label>OPPONENTS</label>${seg('c-opp', LEVEL_ITEMS, profile.opp)}
         <label>ONE PERSON: YOUR PARTNER</label>${seg('c-partner', LEVEL_ITEMS, profile.partner)}
       </div>
     </div>
     <ul class="pd-camtips">
       <li>Stand <b>2–3 m back</b> so your <b>head to hips and both arms</b> are in the picture. Light in front of you, not behind.</li>
       <li><b>1:1 MOTION</b>: your player's arm and racket follow the camera's estimate of your movement — the ball is hit when <i>that racket</i> meets it. Racket speed is power, the way it's moving is the direction. Hold it still in the way for a block.</li>
       <li><b>Power</b> = how fast you swing. <b>Direction</b> = where your hand is going as you hit: sweep across your body for cross court, push through at the screen to go straight.</li>
       <li>Swing <b>up from low</b> for a lob. Ball high above you? Swing from over your head for a smash.</li>
       <li>Swing as the ball reaches you — a little early is fine, the game waits for the ball. Try practice swings now: watch the meters.</li>
     </ul>
     <div class="pd-row-end"><button class="pd-btn ghost" data-back>BACK</button><button class="pd-btn primary" data-start>START MATCH</button></div>`,
    'camera',
  );
  const view = el.querySelector('#c-view') as HTMLCanvasElement;
  const ctx = view.getContext('2d')!;
  const stat = el.querySelector('#c-stat') as HTMLDivElement;
  const showP2 = () => ((el.querySelector('#c-p1') as HTMLElement).style.display = profile.camPlayers === 2 ? '' : 'none');
  showP2();
  const restart = () => {
    stat.textContent = 'Loading the pose model…';
    camera
      .start(profile.camPlayers, profile.camAcc, profile.camHandTrack)
      .then(() => (stat.textContent = ''))
      .catch((e: Error) => (stat.textContent = e.name === 'NotAllowedError' ? 'Camera blocked — allow it in the address bar and try again.' : `Camera error: ${e.message}`));
  };
  bindSeg<number>(
    el,
    'c-n',
    (v) => {
      profile.camPlayers = v as 1 | 2;
      showP2();
      restart();
    },
    true,
  );
  for (const i of [0, 1])
    bindSeg<Hand>(el, `c-hand${i}`, (v) => {
      profile.camHands[i] = v;
      profile.camCal[i] = null;
      camera.arms[i]!.reset(true);
      applyCamera();
    });
  bindSeg<'motion' | 'gesture'>(el, 'c-style', (v) => (profile.camStyle = v));
  bindSeg<'easy' | 'normal' | 'real'>(el, 'c-assist', (v) => (profile.camAssist = v));
  bindSeg<string>(el, 'c-ht', (v) => {
    profile.camHandTrack = v === '1';
    restart();
  });
  bindSeg<Smoothing>(el, 'c-smooth', (v) => {
    profile.camSmooth = v;
    applyCamera();
  });
  el.querySelectorAll('[data-cal]').forEach((b) =>
    b.addEventListener('click', () => {
      const i = Number((b as HTMLElement).dataset.cal);
      const label = el.querySelector(`#c-cal${i}`) as HTMLElement;
      const tr = camera.arms[i]!;
      if (!tr.handSeen) {
        label.textContent = profile.camHandTrack ? "Can't see your racket hand — face the camera, hand in view" : 'Turn hand tracking on to calibrate';
        return;
      }
      label.textContent = 'Hold racket upright, face to screen, and stay still for 2 seconds…';
      tr.calibrate((ok) => {
        if (ok) {
          profile.camCal[i] = tr.cal;
          save();
        }
        label.textContent = ok ? 'Calibrated ✓' : 'Keep your hand visible and still for 2 seconds — try again';
      });
    }),
  );
  bindSeg<Accuracy>(el, 'c-acc', (v) => {
    profile.camAcc = v;
    restart();
  });
  bindSeg<Level>(el, 'c-opp', (v) => (profile.opp = v));
  bindSeg<Level>(el, 'c-partner', (v) => (profile.partner = v));
  const sens = el.querySelector('#c-sens') as HTMLInputElement;
  sens.addEventListener('input', () => {
    profile.camSens = Number(sens.value);
    applyCamera();
    el.querySelector('#c-sens + output')!.textContent = `${profile.camSens.toFixed(2)}×`;
    save();
  });
  const name2 = el.querySelector('#c-name2') as HTMLInputElement;
  name2.addEventListener('input', () => {
    profile.name2 = name2.value.trim().slice(0, 16) || 'Player 2';
    save();
  });
  restart();
  // Live preview + practice meters until we leave this screen.
  const shownAt = performance.now();
  const info = el.querySelector('#c-info') as HTMLElement;
  const meters = [0, 1].map((i) => el.querySelector(`#c-p${i} .pd-cammeter`) as HTMLDivElement);
  const loop = () => {
    if (!view.isConnected) return;
    requestAnimationFrame(loop);
    camera.draw(ctx, view.width, view.height);
    for (let i = 0; i < 2; i++) {
      camera.take(i); // practice swings: shown, not kept
      const d = camera.detectors[i]!;
      const m = meters[i]!;
      const bar = m.querySelector('i') as HTMLElement;
      const txt = m.querySelector('span') as HTMLElement;
      bar.style.width = `${Math.min(100, (d.speed / (6 / d.sens)) * 100)}%`;
      const age = (performance.now() - d.lastAt) / 1000;
      const l = d.last;
      txt.textContent = !camera.sees(i) ? 'NOT IN VIEW' : l && age < 3 ? `${l.lob ? 'LOB · ' : ''}${Math.round(l.power * 100)}% · ${aimWord(l.dx)} · ${l.speed.toFixed(1)} m/s` : 'Take a practice swing';
      m.classList.toggle('hit', !!l && age < 0.4);
    }
    if (camera.running && camera.fps > 0) info.textContent = `${Math.round(camera.fps)} fps · ${camera.ms.toFixed(0)} ms · ${camera.model} · ${camera.mode}${profile.camHandTrack ? (camera.arms[0]!.handSeen ? ' · hand ✓' : ' · hand –') : ''}`;
    // Slow tracking warning (once the camera's been up a couple of seconds).
    if (camera.running && performance.now() - shownAt > 2500 && (!stat.textContent || stat.dataset.slow)) {
      const slow = camera.fps > 0 && camera.fps < 18;
      stat.textContent = slow ? `Tracking at ${Math.round(camera.fps)} fps — try FAST tracking, hand tracking off, more light, or close other tabs.` : '';
      stat.dataset.slow = slow ? '1' : '';
    }
  };
  loop();
  el.querySelector('[data-back]')!.addEventListener('click', () => {
    camera.stop();
    mainMenu();
  });
  el.querySelector('[data-start]')!.addEventListener('click', () => {
    save();
    void startLocal(profile.camPlayers);
  });
}

/** Player `i`'s live arm with the hit assist applied. */
function liveArm(i: number): LiveArm | null {
  const a = camera.arm(i);
  return a ? { ...a, reach: { easy: 1.5, normal: 1.15, real: 0.9 }[profile.camAssist] } : null;
}

/** A stroke's direction in words (as the hitter sees it). */
function aimWord(dx: number): string {
  return dx < -0.35 ? '◀ LEFT' : dx > 0.35 ? 'RIGHT ▶' : '▲ STRAIGHT';
}

function howTo(back: () => void): void {
  const el = screen(
    `<h2>HOW TO PLAY</h2>
     <div class="pd-how">
       <div><h3>🖱 SWING</h3><p>Click the court to grab the mouse. <b>Move the mouse to swing</b> — the stroke is the shot:</p>
       <ul><li><b>Direction</b>: straight up the screen hits down the court; angle it left or right to go across.</li>
       <li><b>Speed</b>: a flick is a soft touch (a <i>chiquita</i> that dips at their feet), a whip is a power drive.</li>
       <li><b>Hold the right button</b> (or Shift) while you swing for a <b>lob</b> over players at the net.</li>
       <li>Ball high above you? Your swing becomes an <b>overhead</b>: hard = <b>smash</b>, medium = <b>bandeja</b>, angled = <b>víbora</b>.</li>
       <li><b>Timing</b>: swing as the ball arrives. Early pulls it across, late pushes it the other way.</li></ul></div>
       <div><h3>🏃 MOVE</h3><p><b>Auto-move</b> (on by default) runs you to the ball — you just swing. Take over any time with <b>WASD</b> / arrows (or the left stick).</p>
       <h3>📷 CAMERA PLAY</h3><p>Swing a <b>real racket</b> at your webcam (one or two of you). Speed is power; the way your hand travels at the hit is where it goes; up from low is a lob.</p>
       <h3>🎮 CONTROLLER</h3><p>Flick the <b>right stick</b> to swing (the flick is the stroke), <b>RT</b> for a lob, left stick to move.</p></div>
       <div><h3>📏 THE RULES</h3><ul>
       <li>Serve <b>underhand</b>, bounced, below the waist, <b>cross court</b> into the box. It may hit the glass after bouncing — not the fence.</li>
       <li>The ball must <b>bounce on their side first</b>. After that it can come off the glass and they can still play it.</li>
       <li>Into their glass before the bounce, into the net, two bounces, or hitting a player: point lost.</li>
       <li>Bounce it out of the cage (over the glass — <i>por tres</i>) and the point is yours.</li>
       <li>Scoring like tennis: 15, 30, 40, game. Six games a set, tie-break at 6–6. Golden point decides deuce.</li></ul></div>
     </div>
     <div class="pd-row-end"><button class="pd-btn primary" data-back>GOT IT</button></div>`,
    'how',
  );
  el.querySelector('[data-back]')!.addEventListener('click', back);
}

function settings(back: () => void): void {
  const el = screen(
    `<h2>SETTINGS</h2>
     <div class="pd-form">
       <label>NAME <input id="o-name" maxlength="16" value="${esc(profile.name)}"></label>
       <label>SWING SENSITIVITY <input id="o-sens" type="range" min="0.4" max="2.5" step="0.05" value="${profile.sens}"><output>${profile.sens.toFixed(2)}×</output></label>
       <label>AUTO-MOVE ${seg('o-auto', [['1', 'ON'], ['0', 'OFF']], profile.auto ? '1' : '0')}</label>
       <label>VOLUME <input id="o-vol" type="range" min="0" max="1" step="0.05" value="${profile.volume}"></label>
     </div>
     <div class="pd-row-end"><button class="pd-btn primary" data-back>DONE</button></div>`,
    'settings',
  );
  const name = el.querySelector('#o-name') as HTMLInputElement;
  name.addEventListener('input', () => {
    profile.name = name.value.trim().slice(0, 16) || 'Player';
    save();
  });
  const sens = el.querySelector('#o-sens') as HTMLInputElement;
  sens.addEventListener('input', () => {
    profile.sens = Number(sens.value);
    swing.settings.sens = profile.sens;
    el.querySelector('output')!.textContent = `${profile.sens.toFixed(2)}×`;
    save();
  });
  bindSeg<string>(el, 'o-auto', (v) => {
    profile.auto = v === '1';
    swing.settings.auto = profile.auto;
  });
  const vol = el.querySelector('#o-vol') as HTMLInputElement;
  vol.addEventListener('input', () => {
    profile.volume = Number(vol.value);
    audio.setVolume(profile.volume);
    save();
  });
  el.querySelector('[data-back]')!.addEventListener('click', back);
}

// ------------------------------------------------------------------ the match

const BOT_NAMES = ['Lebrón', 'Tapia', 'Galán', 'Coello', 'Navarro', 'Stupa', 'Chingotto', 'Yanguas', 'Paquito', 'Bela', 'Lima', 'Sanyo', 'Belasteguín', 'Di Nenno', 'Garrido', 'Ruiz'];
/** Shirts (one per partner) and shorts for each team. */
const KITS: Array<[string, string, string]> = [
  ['#2f7bff', '#14b8a6', '#0e1a33'],
  ['#ff5a3c', '#c2185b', '#1f0f0b'],
];
function lookFor(team: 0 | 1, i: number, seed: number): Look {
  const [a, b, shorts] = KITS[team]!;
  return { shirt: i % 2 ? b : a, shorts, socks: '#f2f2f2', shoes: ['#ffffff', '#111111', '#e8ff3a', '#3dd1ff'][(seed + i) % 4]!, skin: SKINS[(seed * 7 + i * 3) % SKINS.length]!, hair: HAIRS[(seed * 5 + i) % HAIRS.length]! };
}

interface GameOpts {
  defs: PlayerDef[];
  /** Which player this browser controls (and a second, camera player 2, in local camera play). */
  me: string;
  me2?: string;
  /** Swing with the camera. */
  cam: boolean;
  court: string;
  names: [string, string];
  online: PadelNet | null;
  sim: MatchSim | null;
}

let game: Game | null = null;

class Game {
  private readonly view: MatchView;
  private readonly hud: Hud;
  private raf = 0;
  private last = performance.now();
  private acc = 0;
  private paused = false;
  private frame: Frame;
  private overT = 0;
  private readonly myIndex: number;
  private readonly myTeam: 0 | 1;
  private readonly frames: Array<{ at: number; f: Frame }> = [];
  private rallyHits = 0;
  private readonly pip: HTMLCanvasElement | null = null;
  /** Camera 1:1 motion play (live arms). */
  private readonly motion: boolean;
  private lastStroke: { s: import('./sim/match').Stroke; at: number } | null = null;

  constructor(private readonly o: GameOpts) {
    this.myIndex = o.defs.findIndex((d) => d.id === o.me);
    this.myTeam = o.defs[this.myIndex]?.team ?? 0;
    const players: ViewPlayer[] = o.defs.map((d, i) => ({ look: lookFor(d.team, d.slot, i), racket: RACKET[d.racket] ?? RACKETS[0]!, human: d.id === o.me || d.id === o.me2, team: d.team }));
    this.view = new MatchView(COURT_BY_ID[o.court] ?? COURTS[0]!, players);
    this.view.side = this.myTeam;
    this.motion = o.cam && profile.camStyle === 'motion';
    this.view.close = this.motion;
    const i2 = o.me2 ? o.defs.findIndex((d) => d.id === o.me2) : -1;
    if (i2 >= 0) this.view.players[i2]!.trailColor = CAM_COLORS[1]!;
    this.view.snapCamera();
    ui.innerHTML = '';
    this.hud = new Hud(ui, o.names);
    if (o.cam) {
      // The camera picture-in-picture: see yourself (and your skeleton) while you play.
      this.pip = document.createElement('canvas');
      this.pip.className = 'pd-pip';
      this.pip.width = 256;
      this.pip.height = 192;
      this.hud.el.appendChild(this.pip);
    }
    this.frame = o.sim ? readFrame(writeFrame(o.sim)) : readFrame(new Float32Array(30 + o.defs.length * 10));
    swing.enabled = true;
    addEventListener('resize', this.resize);
    addEventListener('keydown', this.onKey);
    document.addEventListener('pointerlockchange', this.onLock);
    this.resize();
    audio.crowdOn(true);
    this.raf = requestAnimationFrame(this.loop);
    if (import.meta.env.DEV) (window as unknown as { __padel: unknown }).__padel = this;
  }

  private resize = (): void => {
    const r = getRenderer();
    r.setSize(innerWidth, innerHeight, false);
    this.view.setAspect(innerWidth / innerHeight);
  };

  /** Esc releases the mouse (the browser eats that key press): treat losing the lock mid-match as pause. */
  private wasLocked = false;
  private lockPausedAt = 0;
  private onLock = (): void => {
    if (this.wasLocked && !swing.locked && !this.paused && this.frame.phase !== 'over') {
      this.pause();
      this.lockPausedAt = performance.now();
    }
    this.wasLocked = swing.locked;
  };

  private onKey = (e: KeyboardEvent): void => {
    if (e.code === 'Escape' && performance.now() - this.lockPausedAt < 300) return;
    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (this.paused) this.resume();
      else this.pause();
    }
  };

  private pause(): void {
    this.paused = true;
    swing.enabled = false;
    document.exitPointerLock?.();
    const el = document.createElement('div');
    el.className = 'pd-pause';
    el.innerHTML = `<div class="pd-panel"><h2>PAUSED</h2><button class="pd-btn primary" data-r>RESUME</button><button class="pd-btn" data-h>HOW TO PLAY</button><button class="pd-btn" data-s>SETTINGS</button><button class="pd-btn ghost" data-q>QUIT MATCH</button></div>`;
    ui.appendChild(el);
    el.querySelector('[data-r]')!.addEventListener('click', () => this.resume());
    el.querySelector('[data-q]')!.addEventListener('click', () => {
      void this.o.online?.leave();
      mainMenu();
    });
    const sub = (fn: (back: () => void) => void) => () => {
      const keep = ui.innerHTML;
      void keep;
      fn(() => {
        ui.innerHTML = '';
        this.hud.el.remove();
        ui.appendChild(this.hud.el);
        this.pause();
      });
    };
    el.querySelector('[data-h]')!.addEventListener('click', sub(howTo));
    el.querySelector('[data-s]')!.addEventListener('click', sub(settings));
  }

  private resume(): void {
    ui.querySelector('.pd-pause')?.remove();
    if (!ui.contains(this.hud.el)) {
      ui.innerHTML = '';
      ui.appendChild(this.hud.el);
    }
    this.paused = false;
    swing.enabled = true;
    this.last = performance.now();
  }

  /** Online: a frame from the server. */
  onFrame(f: Float32Array): void {
    this.frames.push({ at: performance.now(), f: readFrame(f) });
    if (this.frames.length > 8) this.frames.shift();
  }

  /** Online: events from the server. */
  onEvents(ev: MatchEvent[]): void {
    for (const e of ev) this.event(e);
  }

  private loop = (now: number): void => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const sim = this.o.sim;
    const net = this.o.online;
    if (!this.paused) {
      const mv = swing.move();
      const cam = this.o.cam;
      const stroke = swing.take() ?? (cam ? camera.take(0) : null);
      const stroke2 = cam && this.o.me2 ? camera.take(1) : null;
      for (const st of [stroke, stroke2]) if (st) this.lastStroke = { s: st, at: performance.now() };
      const auto = cam || swing.settings.auto;
      if (sim) {
        this.acc += dt;
        let first = true;
        while (this.acc >= TICK) {
          this.acc -= TICK;
          const inputs = new Map<string, Input>([[this.o.me, { mx: mv.mx, mz: mv.mz, stroke: first ? stroke : null, auto, arm: this.motion ? liveArm(0) : null }]]);
          if (this.o.me2) inputs.set(this.o.me2, { mx: 0, mz: 0, stroke: first ? stroke2 : null, auto: true, arm: this.motion ? liveArm(1) : null });
          first = false;
          sim.step(inputs);
          for (const e of sim.events) this.event(e);
          sim.events.length = 0;
        }
        this.frame = readFrame(writeFrame(sim));
      } else if (net) {
        net.input({ mx: mv.mx, mz: mv.mz, auto }, stroke, this.motion ? liveArm(0) : null);
        this.frame = this.interpolated();
      }
    }
    if (this.pip) camera.draw(this.pip.getContext('2d')!, this.pip.width, this.pip.height);
    const me = this.frame.players[this.myIndex];
    const me2 = this.o.me2 ? this.frame.players[this.o.defs.findIndex((d) => d.id === this.o.me2)] : undefined;
    const fz = me ? (me2 ? (Math.abs(me.z) > Math.abs(me2.z) ? me.z : me2.z) : me.z) : 0;
    this.view.update(this.frame, dt, me ? (me2 ? (me.x + me2.x) / 2 : me.x) : 0, fz);
    const serverTeam = (this.o.defs[this.frame.server]?.team ?? 0) as 0 | 1;
    const label = (t: 0 | 1) => {
      const a = this.frame.points[t];
      const b = this.frame.points[1 - t]!;
      if (this.frame.tiebreak) return String(a);
      if (a >= 3 && b >= 3) return a > b ? 'AD' : '40';
      return ['0', '15', '30', '40'][Math.min(3, a)]!;
    };
    const ls = this.lastStroke;
    this.hud.update(this.frame, dt, ls?.s ?? swing.last, (performance.now() - (ls?.at ?? swing.lastAt)) / 1000, serverTeam, label);
    const server = this.o.defs[this.frame.server]?.id;
    const myServe = this.frame.phase === 'serve' && (server === this.o.me || server === this.o.me2);
    let hint = '';
    if (this.o.cam) {
      const lost = [0, ...(this.o.me2 ? [1] : [])].filter((i) => !camera.sees(i));
      hint = lost.length ? `Can't see ${lost.map((i) => `P${i + 1}`).join(' & ')} — step back into the camera` : myServe ? `${this.o.me2 && server === this.o.me2 ? 'P2' : this.o.me2 ? 'P1' : 'Your'} serve — ${this.motion ? 'swing through the ball' : 'swing your racket'}!` : '';
    } else hint = !swing.locked ? 'Click the court to grab the mouse · move the mouse to swing' : myServe ? 'Your serve — swing the mouse!' : '';
    this.hud.setHint(this.paused ? '' : hint);
    getRenderer().render(this.view.scene, this.view.camera);
    if (this.frame.phase === 'over') {
      this.overT += dt;
      if (this.overT > 3 && !this.paused) this.end();
    }
  };

  /** Online: render a little in the past, between the two frames around that moment. */
  private interpolated(): Frame {
    const fr = this.frames;
    if (fr.length === 0) return this.frame;
    const delay = this.o.online?.lan ? 30 : 70;
    const t = performance.now() - delay;
    for (let i = fr.length - 1; i > 0; i--) {
      const a = fr[i - 1]!;
      const b = fr[i]!;
      if (a.at <= t && t <= b.at) return lerpFrame(a.f, b.f, (t - a.at) / Math.max(1, b.at - a.at));
    }
    return fr[fr.length - 1]!.f;
  }

  private event(e: MatchEvent): void {
    const defs = this.o.defs;
    switch (e.k) {
      case 'hit':
        this.rallyHits++;
        audio.hit(e.power, e.shot === 'smash' || e.shot === 'bandeja' || e.shot === 'vibora');
        this.hud.shotName(e.shot, e.power);
        if (e.shot === 'smash' && e.power > 0.9) this.view.shakeCamera(0.6);
        break;
      case 'whiff':
        audio.swish();
        break;
      case 'swing':
        if (defs[e.p]?.id === this.o.me && e.kind !== 'serve') audio.swish();
        break;
      case 'bounce':
        audio.bounce(e.speed);
        this.view.mark(e.x, 0, e.z, null);
        break;
      case 'wall':
        if (e.mat === 'glass') {
          audio.glass(e.speed);
          this.view.court.flashGlass(e.x, e.y, e.z);
          this.view.mark(e.x, e.y, e.z, Math.abs(e.z) > 9.9 ? 'z' : 'x');
        } else audio.mesh(e.speed);
        break;
      case 'net':
        audio.net(e.speed);
        this.view.court.shakeNet(Math.min(1, e.speed / 15));
        break;
      case 'fault':
        this.hud.callout(e.second ? 'DOUBLE FAULT' : 'FAULT', e.why === 'fence' ? 'Off the fence after the bounce' : e.why === 'out' ? 'Out of the box' : e.why === 'net' ? 'Into the net' : 'Into the glass', 1.4);
        break;
      case 'let':
        this.hud.callout('LET', 'Off the net — serve again', 1.4);
        break;
      case 'point': {
        const ours = e.team === this.myTeam;
        this.hud.pointCall(this.o.names[e.team], e.why, ours);
        if (ours) audio.applause(this.rallyHits > 8);
        else if (this.rallyHits > 6) audio.groan();
        this.rallyHits = 0;
        break;
      }
      case 'game':
        setTimeout(() => this.hud.callout('GAME', this.o.names[e.team], 1.8), 1300);
        break;
      case 'set':
        setTimeout(() => this.hud.callout('SET', this.o.names[e.team], 2), 1500);
        break;
      case 'match':
        setTimeout(() => this.hud.callout('GAME, SET & MATCH', this.o.names[e.team], 3), 1600);
        audio.applause(true);
        break;
    }
  }

  private end(): void {
    this.paused = true;
    swing.enabled = false;
    document.exitPointerLock?.();
    const f = this.frame;
    const won = f.winner === this.myTeam;
    const sets = f.history.map((h) => `${h[0]}–${h[1]}`).join(' · ');
    const el = document.createElement('div');
    el.className = 'pd-pause';
    el.innerHTML = `<div class="pd-panel end"><div class="pd-result ${won ? 'win' : 'lose'}">${won ? 'VICTORY' : 'DEFEAT'}</div><div class="pd-final">${esc(this.o.names[0])} <b>${sets}</b> ${esc(this.o.names[1])}</div><button class="pd-btn primary" data-a>${this.o.online ? 'BACK TO LOBBY' : 'PLAY AGAIN'}</button><button class="pd-btn ghost" data-m>MAIN MENU</button></div>`;
    ui.appendChild(el);
    el.querySelector('[data-a]')!.addEventListener('click', () => {
      if (this.o.online) {
        this.stop();
        lobbyScreen(this.o.online);
      } else void startLocal(camCount);
    });
    el.querySelector('[data-m]')!.addEventListener('click', () => {
      void this.o.online?.leave();
      mainMenu();
    });
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    removeEventListener('resize', this.resize);
    removeEventListener('keydown', this.onKey);
    document.removeEventListener('pointerlockchange', this.onLock);
    swing.enabled = false;
    document.exitPointerLock?.();
    audio.crowdOn(false);
    this.hud.dispose();
    this.view.dispose();
  }
}

async function loading(text: string): Promise<void> {
  screen(`<div class="pd-loading"><div class="pd-logo small">PADEL</div><div class="pd-spin"></div><p>${text}</p></div>`, 'loading');
  await loadPlayerModel();
}

async function startLocal(cam: 0 | 1 | 2): Promise<void> {
  game?.stop();
  game = null;
  camCount = cam;
  void audio.init();
  await loading('Warming up…');
  if (cam) await camera.start(cam, profile.camAcc, profile.camHandTrack).catch(() => undefined);
  // Two at the camera: you're teammates in a doubles match.
  const mode = cam === 2 ? 2 : profile.mode;
  const defs: PlayerDef[] = [];
  const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
  const rk = () => RACKETS[Math.floor(Math.random() * RACKETS.length)]!.id;
  defs.push({ id: 'me', name: profile.name, team: 0, slot: 0, human: true, racket: profile.racket });
  if (cam === 2) defs.push({ id: 'me2', name: profile.name2, team: 0, slot: 1, human: true, racket: rk() });
  else if (mode === 2) defs.push({ id: 'p1', name: names[0]!, team: 0, slot: 1, human: false, racket: rk(), level: profile.partner });
  for (let s = 0; s < mode; s++) defs.push({ id: `o${s}`, name: names[1 + s]!, team: 1, slot: s as 0 | 1, human: false, racket: rk(), level: profile.opp });
  const sim = new MatchSim({ players: defs, format: { games: profile.games, sets: profile.sets, golden: profile.golden }, seed: (Math.random() * 1e9) | 0 });
  const t0 = defs.filter((d) => d.team === 0).map((d) => d.name);
  const t1 = defs.filter((d) => d.team === 1).map((d) => d.name);
  game = new Game({ defs, me: 'me', me2: cam === 2 ? 'me2' : undefined, cam: cam > 0, court: profile.court, names: [t0.join(' / '), t1.join(' / ')], online: null, sim });
}

// ------------------------------------------------------------------ online

function onlineMenu(): void {
  const el = screen(
    `<h2>ONLINE</h2>
     <p class="pd-note" id="o-status">Checking the server…</p>
     <div class="pd-form">
       <label>YOUR NAME <input id="o-name" maxlength="16" value="${esc(profile.name)}"></label>
       <label>SWING WITH</label>${seg('o-cam', [['0', '🖱 MOUSE'], ['1', '📷 CAMERA + REAL RACKET']], profile.camOnline ? '1' : '0')}
       <div class="pd-menu">
         <button class="pd-btn primary" data-c>CREATE A ROOM</button>
         <button class="pd-btn" data-q>QUICK MATCH</button>
         <label>JOIN WITH A CODE <input id="o-code" maxlength="8" placeholder="ABCD"></label>
         <button class="pd-btn" data-j>JOIN</button>
       </div>
     </div>
     <div class="pd-row-end"><button class="pd-btn ghost" data-back>BACK</button></div>`,
    'online',
  );
  const n = new PadelNet();
  void n.probe().then((p) => {
    const s = el.querySelector('#o-status');
    if (s) s.textContent = p.ok ? (p.lan ? `LAN server · friends on your network join at ${p.lan.map((a) => `http://${a}:${location.port || 80}/padel/`).join(' or ')}` : 'Server online.') : 'Server offline — start it to play online.';
  });
  const name = el.querySelector('#o-name') as HTMLInputElement;
  name.addEventListener('input', () => {
    profile.name = name.value.trim().slice(0, 16) || 'Player';
    save();
  });
  bindSeg<string>(el, 'o-cam', (v) => (profile.camOnline = v === '1'));
  const go = async (fn: () => Promise<void>) => {
    try {
      wire(n);
      await fn();
    } catch (e) {
      const s = el.querySelector('#o-status');
      if (s) s.textContent = `Couldn't connect: ${(e as Error).message}`;
    }
  };
  el.querySelector('[data-c]')!.addEventListener('click', () => void go(() => n.create(profile.name, profile.racket)));
  el.querySelector('[data-q]')!.addEventListener('click', () => void go(() => n.quick(profile.name, profile.racket)));
  el.querySelector('[data-j]')!.addEventListener('click', () => void go(() => n.join((el.querySelector('#o-code') as HTMLInputElement).value, profile.name, profile.racket)));
  el.querySelector('[data-back]')!.addEventListener('click', () => {
    void n.leave();
    mainMenu();
  });
}

function wire(n: PadelNet): void {
  n.onLobby = (l) => {
    if (!game) lobbyScreen(n, l);
  };
  n.onBegin = (b) => void beginOnline(n, b);
  n.onFrame = (f) => game?.onFrame(f);
  n.onEvents = (ev) => game?.onEvents(ev);
  n.onError = (msg) => alert(msg);
  n.onClosed = (reason) => {
    game?.stop();
    game = null;
    mainMenu();
    if (reason) alert(reason);
  };
}

function lobbyScreen(n: PadelNet, l: PdLobby | null = n.lobby): void {
  game?.stop();
  game = null;
  if (!l) return;
  const host = l.hostId === n.sessionId;
  const team = (t: 0 | 1) =>
    `<div class="pd-team t${t}"><h3>${t === 0 ? 'BLUE' : 'ORANGE'}</h3>${l.players
      .filter((p) => p.team === t)
      .map((p) => `<div class="pd-lp ${p.id === n.sessionId ? 'me' : ''}">${esc(p.name)}${p.id === l.hostId ? ' · HOST' : ''}${p.connected ? '' : ' · reconnecting'}</div>`)
      .join('')}${l.players.filter((p) => p.team === t).length < PD_MAX_PER_TEAM ? `<button class="pd-btn small" data-team="${t}">JOIN ${t === 0 ? 'BLUE' : 'ORANGE'}</button>` : ''}</div>`;
  const c = l.config;
  const el = screen(
    `<h2>ROOM <span class="pd-code">${l.code}</span></h2>
     <p class="pd-note">Share the code. Empty places are filled with bots.${l.lan ? ' (LAN)' : ''}</p>
     <div class="pd-teams">${team(0)}${team(1)}</div>
     ${
       host
         ? `<div class="pd-form"><label>MODE</label>${seg('l-mode', [[2, '2 v 2'], [1, '1 v 1']], c.mode)}<label>BOTS</label>${seg('l-lvl', LEVEL_ITEMS, c.level)}<label>MATCH</label>${seg('l-len', [['4-1', 'SHORT'], ['6-1', '1 SET'], ['6-3', 'BEST OF 3']], `${c.games}-${c.sets}`)}<label>COURT</label>${courtPicker()}</div>`
         : `<p class="pd-note">${c.mode} v ${c.mode} · bots ${LEVELS[c.level].name} · ${c.games === 4 ? 'short set' : c.sets === 3 ? 'best of 3' : '1 set'} · ${COURT_BY_ID[c.court]?.name ?? c.court}. Waiting for the host…</p>`
     }
     <div class="pd-row-end"><button class="pd-btn ghost" data-leave>LEAVE</button>${host ? '<button class="pd-btn primary" data-start>START MATCH</button>' : ''}</div>`,
    'lobby',
  );
  el.querySelectorAll('[data-team]').forEach((b) => b.addEventListener('click', () => n.team(Number((b as HTMLElement).dataset.team) as 0 | 1)));
  if (host) {
    bindSeg<number>(el, 'l-mode', (v) => n.config({ mode: v as 1 | 2 }), true);
    bindSeg<Level>(el, 'l-lvl', (v) => n.config({ level: v }));
    bindSeg<string>(el, 'l-len', (v) => {
      const [g, s] = v.split('-').map(Number);
      n.config({ games: g as 4 | 6, sets: s as 1 | 3 });
    });
    el.querySelectorAll('[data-court]').forEach((b) => b.addEventListener('click', () => n.config({ court: (b as HTMLElement).dataset.court! })));
    el.querySelector('[data-start]')!.addEventListener('click', () => n.start());
  }
  el.querySelector('[data-leave]')!.addEventListener('click', () => {
    void n.leave();
    mainMenu();
  });
}

async function beginOnline(n: PadelNet, b: PdBegin): Promise<void> {
  game?.stop();
  game = null;
  void audio.init();
  await loading('Walking on court…');
  const t0 = b.defs.filter((d) => d.team === 0).map((d) => d.name);
  const t1 = b.defs.filter((d) => d.team === 1).map((d) => d.name);
  if (profile.camOnline) await camera.start(1, profile.camAcc, profile.camHandTrack).catch(() => undefined);
  game = new Game({ defs: b.defs, me: n.sessionId, cam: profile.camOnline && camera.running, court: b.config.court, names: [t0.join(' / '), t1.join(' / ')], online: n, sim: null });
}

export type { PdConfig };
mainMenu();
