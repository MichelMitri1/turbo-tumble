import * as THREE from 'three';
import { CLUB, type Kit, type PlayerDef } from './sim/data';
import { readFrame, lerpFrame, type Frame } from './sim/snapshot';
import { PITCH, type MatchEvent } from './sim/match';
import { MatchView } from './render/view';
import { connectedPads, readPad } from './input';

export interface ReplayData {
  id: string;
  date: number;
  home: string;
  away: string;
  kits: [Kit, Kit];
  defs: PlayerDef[];
  frames: Float32Array[];
  events: Array<{ time: number; label: string; foul?: { by: number; card: 'yellow' | 'red' | null }; net?: { end: number; x: number; y: number; z: number; strength?: number } }>;
  complete: boolean;
}

/** Fifteen snapshots per second for the entire match, independent of goal replays. */
export class MatchRecording {
  readonly data: ReplayData;
  constructor(home: string, away: string, kits: [Kit, Kit], defs: PlayerDef[]) {
    this.data = { id: `match-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, date: Date.now(), home, away, kits, defs, frames: [], events: [], complete: false };
  }
  record(frame: Float32Array, force = false): void {
    const last = this.data.frames.at(-1);
    if (last && frame[0]! <= last[0]!) return;
    if (force || !last || frame[0]! - last[0]! >= 1 / 15 - 0.001) this.data.frames.push(frame.slice());
  }
  events(events: MatchEvent[], time: number): void {
    for (const e of events) {
      const label = e.k === 'net' ? 'Net impact' : e.k === 'goal' ? 'Goal' : e.k === 'half' ? `Half ${e.half}` : e.k === 'full' ? 'Full time' : e.k === 'save' ? 'Save' : e.k === 'foul' ? 'Foul' : e.k === 'kick' && ['shot', 'finesse', 'power', 'chip', 'penalty', 'bicycle'].includes(e.type) ? 'Shot' : '';
      if (label) this.data.events.push({ time: e.k === 'net' ? e.time : time, label: e.k === 'foul' ? `Foul · ${e.card ?? 'warning'}` : label,
        ...(e.k === 'foul' ? { foul: { by: e.by, card: e.card } } : {}),
        ...(e.k === 'net' ? { net: { end: e.end, x: e.x - e.end * PITCH.HL, y: e.y, z: e.z, strength: e.strength } } : {}),
      });
      if (e.k === 'full') this.data.complete = true;
    }
  }
  snapshot(): ReplayData {
    return { ...this.data, frames: this.data.frames.slice(), events: this.data.events.slice() };
  }
}

/** Binary search: seeking at kickoff remains fast even at the end of a long match. */
export function replayFrame(data: ReplayData, time: number): Frame | null {
  const fs = data.frames;
  if (!fs.length) return null;
  if (time <= fs[0]![0]!) return readFrame(fs[0]!);
  if (time >= fs.at(-1)![0]!) return readFrame(fs.at(-1)!);
  let lo = 0, hi = fs.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >>> 1;
    if (fs[mid]![0]! <= time) lo = mid;
    else hi = mid;
  }
  const a = readFrame(fs[lo]!), b = readFrame(fs[hi]!);
  return lerpFrame(a, b, (time - a.time) / (b.time - a.time));
}

async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('matchday-replays', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('matches', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export async function savedReplays(): Promise<ReplayData[]> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const req = db.transaction('matches').objectStore('matches').getAll();
      req.onsuccess = () => resolve((req.result as ReplayData[]).sort((a, b) => b.date - a.date));
      req.onerror = () => reject(req.error);
    });
  } finally { db.close(); }
}
export async function saveReplay(data: ReplayData): Promise<void> {
  if (data.frames.length < 2) return;
  const old = await savedReplays();
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('matches', 'readwrite'), store = tx.objectStore('matches');
      store.put(data);
      for (const r of old.filter((r) => r.id !== data.id).slice(2)) store.delete(r.id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

const stamp = (seconds: number) => `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
type Camera = 'broadcast' | 'tele' | 'end' | 'follow' | 'ball' | 'orbit' | 'tactical';

/** A manual viewer. It only reads recorded frames; it never changes the match. */
export class ReplayViewer {
  readonly view: MatchView;
  time: number;
  playing = false;
  speed = 1;
  camera: Camera = 'follow';
  target = -1;
  private yaw = 0.7;
  private elevation = 0.45;
  private distance = 12;
  private raf = 0;
  private last = performance.now();
  private ownView: boolean;
  private root: HTMLElement;
  private keys = new Set<string>();
  private prevPad = { play: false, close: false, next: false, camera: false };
  private drag: { x: number; y: number } | null = null;
  private snap = true;
  private start: number;
  private end: number;
  private showingFoul = false;
  constructor(readonly data: ReplayData, ui: HTMLElement, private renderer: THREE.WebGLRenderer, private closeCallback: () => void, view?: MatchView) {
    this.view = view ?? new MatchView([CLUB[data.home]!, CLUB[data.away]!], data.kits, data.defs);
    this.ownView = !view;
    this.start = data.frames[0]?.[0] ?? 0;
    this.end = data.frames.at(-1)?.[0] ?? 0;
    this.time = this.start;
    this.root = document.createElement('section');
    this.root.className = 'fb-replay-screen';
    this.root.innerHTML = `<div class="rp-top"><div><b>FULL MATCH REPLAY</b><span data-score></span></div><button data-close>← Back</button></div>
      <div class="rp-drag" aria-label="Drag to orbit the replay camera"></div>
      <div class="rp-panel"><div class="rp-seek"><span data-time></span><input data-timeline type="range" min="${this.start}" max="${this.end}" step="0.0167" value="${this.start}" aria-label="Replay timeline"><span>${stamp(this.end - this.start)}</span></div>
      <div class="rp-controls"><button data-step="-5" title="Back five seconds">−5s</button><button data-step="-0.0667" title="Previous frame">❮</button><button data-play>▶ Play</button><button data-step="0.0667" title="Next frame">❯</button><button data-step="5" title="Forward five seconds">+5s</button>
      <label>Speed<select data-speed>${[-2, -1, 0.25, 0.5, 1, 2, 4].map((v) => `<option value="${v}" ${v === 1 ? 'selected' : ''}>${v < 0 ? 'Reverse ' : ''}${Math.abs(v)}×</option>`).join('')}</select></label>
      <label>Camera<select data-camera>${[['follow', 'Player follow'], ['ball', 'Ball follow'], ['orbit', 'Orbit'], ['broadcast', 'Broadcast'], ['tele', 'Wide broadcast'], ['end', 'Behind goal'], ['tactical', 'Tactical']].map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
      <label>Follow<select data-target><option value="-1">Ball carrier</option>${data.defs.map((p, i) => `<option value="${i}">${i < 11 ? CLUB[data.home]!.short : CLUB[data.away]!.short} · ${p.num} ${escape(p.name)}</option>`).join('')}</select></label>
      <label>Zoom<input data-zoom type="range" min="4" max="35" value="12" aria-label="Camera distance"></label><button data-reset>Reset camera</button></div>
      <div class="rp-events">${data.events.map((e, i) => `<button data-event="${i}">${escape(e.label)} · ${stamp(e.time - this.start)}</button>`).join('') || '<span>No events yet · every recorded moment is on the timeline</span>'}</div>
      <small>Space / ✕ play · ← → / L-stick seek · ↑ ↓ change speed · C / □ camera · R-stick / drag orbit · wheel zoom · Esc / ○ back</small></div>`;
    ui.append(this.root);
    this.root.querySelector('[data-close]')!.addEventListener('click', () => this.close());
    this.root.querySelector('[data-play]')!.addEventListener('click', () => this.playing = !this.playing);
    this.root.querySelectorAll<HTMLElement>('[data-step]').forEach((b) => b.onclick = () => { this.playing = false; this.seek(this.time + Number(b.dataset.step)); });
    this.root.querySelector<HTMLInputElement>('[data-timeline]')!.oninput = (e) => { this.playing = false; this.seek(Number((e.target as HTMLInputElement).value)); };
    this.root.querySelector<HTMLSelectElement>('[data-speed]')!.onchange = (e) => this.speed = Number((e.target as HTMLSelectElement).value);
    this.root.querySelector<HTMLSelectElement>('[data-camera]')!.onchange = (e) => { this.camera = (e.target as HTMLSelectElement).value as Camera; this.snap = true; };
    this.root.querySelector<HTMLSelectElement>('[data-target]')!.onchange = (e) => { this.target = Number((e.target as HTMLSelectElement).value); this.snap = true; };
    this.root.querySelector<HTMLInputElement>('[data-zoom]')!.oninput = (e) => this.distance = Number((e.target as HTMLInputElement).value);
    this.root.querySelector('[data-reset]')!.addEventListener('click', () => { this.yaw = 0.7; this.elevation = 0.45; this.distance = 12; this.root.querySelector<HTMLInputElement>('[data-zoom]')!.value = '12'; this.snap = true; });
    this.root.querySelectorAll<HTMLElement>('[data-event]').forEach((b) => b.onclick = () => { this.playing = false; this.seek(data.events[Number(b.dataset.event)]!.time - 2); });
    const drag = this.root.querySelector<HTMLElement>('.rp-drag')!;
    drag.onpointerdown = (e) => { this.drag = { x: e.clientX, y: e.clientY }; drag.setPointerCapture(e.pointerId); };
    drag.onpointermove = (e) => { if (this.drag) { this.yaw += (e.clientX - this.drag.x) * 0.008; this.elevation = Math.max(0.12, Math.min(1.3, this.elevation + (e.clientY - this.drag.y) * 0.005)); this.drag = { x: e.clientX, y: e.clientY }; } };
    drag.onpointerup = drag.onpointercancel = () => this.drag = null;
    drag.addEventListener('wheel', (e) => { e.preventDefault(); this.distance = Math.max(4, Math.min(35, this.distance + e.deltaY * 0.015)); this.root.querySelector<HTMLInputElement>('[data-zoom]')!.value = String(this.distance); }, { passive: false });
    window.addEventListener('keydown', this.keyDown, true);
    window.addEventListener('keyup', this.keyUp, true);
    window.addEventListener('resize', this.resize);
    this.resize();
    this.root.querySelector<HTMLButtonElement>('[data-play]')!.focus();
    this.raf = requestAnimationFrame(this.loop);
  }
  private keyDown = (e: KeyboardEvent) => {
    if (e.code !== 'Escape' && (e.target as HTMLElement)?.matches('select,input')) return;
    if (!['Space', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyC'].includes(e.code)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    this.keys.add(e.code);
    if (!e.repeat && e.code === 'Space') this.playing = !this.playing;
    if (!e.repeat && e.code === 'Escape') this.close();
    if (!e.repeat && e.code === 'KeyC') this.cycleCamera();
    if (!e.repeat && (e.code === 'ArrowUp' || e.code === 'ArrowDown')) {
      const speeds = [-2, -1, 0.25, 0.5, 1, 2, 4];
      this.speed = speeds[Math.max(0, Math.min(speeds.length - 1, speeds.indexOf(this.speed) + (e.code === 'ArrowUp' ? 1 : -1)))]!;
    }
  };
  private keyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
  private cycleCamera(): void {
    const modes: Camera[] = ['follow', 'ball', 'orbit', 'broadcast', 'tele', 'end', 'tactical'];
    this.camera = modes[(modes.indexOf(this.camera) + 1) % modes.length]!;
    this.root.querySelector<HTMLSelectElement>('[data-camera]')!.value = this.camera;
    this.snap = true;
  }
  private resize = () => {
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.view.camera.aspect = innerWidth / innerHeight;
    this.view.setLens(38);
    this.view.resize(innerWidth, innerHeight, this.renderer.getPixelRatio());
    this.view.camera.userData.w = innerWidth; this.view.camera.userData.h = innerHeight;
  };
  seek(time: number): void { this.time = Math.max(this.start, Math.min(this.end, time)); this.snap = true; }
  private loop = (now: number) => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    const pad = connectedPads().map(readPad).find(Boolean);
    if (pad) {
      if (pad.pass && !this.prevPad.play) this.playing = !this.playing;
      if ((pad.shoot || pad.pause) && !this.prevPad.close) { this.close(); return; }
      if (pad.lob && !this.prevPad.camera) this.cycleCamera();
      if (pad.through && !this.prevPad.next) { this.target = (this.target + 2) % 23 - 1; this.root.querySelector<HTMLSelectElement>('[data-target]')!.value = String(this.target); }
      if (Math.abs(pad.sx) > 0.2) { this.playing = false; this.seek(this.time + pad.sx * dt * 12); }
      this.yaw += pad.rx * dt * 1.8;
      this.elevation = Math.max(0.12, Math.min(1.3, this.elevation + pad.ry * dt));
      this.prevPad = { play: pad.pass, close: pad.shoot || pad.pause, next: pad.through, camera: pad.lob };
    }
    if (this.keys.has('ArrowLeft') || this.keys.has('ArrowRight')) { this.playing = false; this.seek(this.time + (this.keys.has('ArrowRight') ? 1 : -1) * dt * 10); }
    if (this.playing) { this.time = Math.max(this.start, Math.min(this.end, this.time + dt * this.speed)); if (this.time === this.end || this.time === this.start) this.playing = false; }
    const f = replayFrame(this.data, this.time);
    if (!f) return;
    this.view.stadium.netReplay = this.data.events.filter((e) => e.net && this.time >= e.time && this.time - e.time < 5).map((e) => ({ end: e.net!.end, impact: { time: e.time, x: e.net!.x, y: e.net!.y, z: e.net!.z, strength: e.net!.strength ?? 0.8 } }));
    const incident = this.data.events.find((e) => e.foul && e.time <= this.time && this.time - e.time < (e.foul.card ? 4 : 2.8));
    if (incident?.foul) {
      const offender = f.players[incident.foul.by]!;
      this.view.refs.presentFoul(offender.x, offender.z, incident.foul.card, this.time - incident.time);
      this.showingFoul = true;
    } else if (this.showingFoul) { this.view.refs.clearFoul(); this.showingFoul = false; }
    const p = f.players[this.target < 0 ? f.ball.owner : this.target];
    const ball = this.camera === 'ball' || this.camera === 'orbit' && this.target < 0;
    const x = ball ? f.ball.x : p?.x ?? f.ball.x, z = ball ? f.ball.z : p?.z ?? f.ball.z;
    this.view.bars = 0;
    this.view.zoom = this.distance / 12;
    this.view.varLines = null;
    if (['broadcast', 'tele', 'end'].includes(this.camera)) { this.view.cinematic = null; this.view.cameraMode = this.camera as 'broadcast' | 'tele' | 'end'; }
    else {
      const a = this.camera === 'follow' ? -(p?.face ?? 0) + Math.PI + this.yaw - 0.7 : this.yaw;
      const tactical = this.camera === 'tactical';
      const d = tactical ? 75 * this.view.zoom : this.distance;
      this.view.cinematic = { pos: new THREE.Vector3(x + Math.cos(a) * d * Math.cos(this.elevation), tactical ? 65 * this.view.zoom : 1.3 + d * Math.sin(this.elevation), z + Math.sin(a) * d * Math.cos(this.elevation)), look: new THREE.Vector3(x, ball ? Math.max(0.6, f.ball.y) : 1.1, z), fov: tactical ? 50 : 48, snap: this.snap };
    }
    this.view.update(f, this.playing ? dt * Math.abs(this.speed) : this.snap ? 1 / 15 : 0, f.time, 0.3, dt);
    this.view.render(this.renderer); this.snap = false;
    this.root.querySelector<HTMLInputElement>('[data-timeline]')!.value = String(this.time);
    this.root.querySelector('[data-time]')!.textContent = stamp(this.time - this.start);
    this.root.querySelector('[data-play]')!.textContent = this.playing ? '❚❚ Pause' : '▶ Play';
    this.root.querySelector<HTMLSelectElement>('[data-speed]')!.value = String(this.speed);
    this.root.querySelector('[data-score]')!.textContent = `${CLUB[this.data.home]!.short} ${f.score[0]}–${f.score[1]} ${CLUB[this.data.away]!.short} · ${f.half === 1 ? '1st' : '2nd'} half · ${Math.floor(f.clock / 60)}′`;
  };
  close(notify = true): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.keyDown, true); window.removeEventListener('keyup', this.keyUp, true); window.removeEventListener('resize', this.resize);
    this.root.remove(); this.view.cinematic = null; this.view.bars = 0; this.view.stadium.netReplay = null; this.view.snap();
    if (this.ownView) this.view.dispose();
    if (notify) this.closeCallback();
  }
}
