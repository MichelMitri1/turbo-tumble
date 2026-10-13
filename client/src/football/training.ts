import * as THREE from 'three';
import { MatchSim, PITCH, type MatchEvent, type Pl } from './sim/match';
import { SKILL_BY_ID } from './sim/skills';

export type TrainingPack = 'finishing' | 'passing' | 'dribbling' | 'setpieces';
export interface TrainingOptions { mode: 'free' | 'pack' | 'skill'; pack?: TrainingPack; skillId?: number; setup?: 'open' | 'free' | 'penalty' }
export const TRAINING_PACKS: Array<{ id: TrainingPack; name: string; detail: string }> = [
  { id: 'finishing', name: 'Finishing', detail: '20 angles and distances · beat the keeper' },
  { id: 'passing', name: 'Passing', detail: '20 targets · ground, through and lofted passes' },
  { id: 'dribbling', name: 'Dribbling', detail: '20 cone courses · touch every gate in order' },
  { id: 'setpieces', name: 'Set pieces', detail: '20 attempts · free kicks and penalties' },
];
export function trainingBest(id: string): number {
  try { return Number(JSON.parse(localStorage.getItem('matchday:training') ?? '{}')[id] ?? 0); } catch { return 0; }
}

export class TrainingSession {
  readonly markers = new THREE.Group();
  readonly hero: Pl;
  private receiver: Pl;
  private ui: HTMLElement | null = null;
  drill = 0;
  score = 0;
  completed = false;
  camera: 'follow' | 'broadcast' | 'end' = 'follow';
  private gate = 0;
  private gates: Array<{ x: number; z: number }> = [];
  private started = 0;
  private resetAt = 0;
  private skillAt = -1;
  private result = '';
  private resultWon = false;
  private label = '';
  private resetHeld = false;
  private passType = '';
  private mates = 0;
  private defenders = 0;
  get teammates(): number { return this.mates; }
  get opponents(): number { return this.defenders; }
  adjust(setting: 'camera' | 'setup' | 'mates' | 'defenders', step = 1): void {
    const cycle = <T,>(values: T[], value: T): T => values[(values.indexOf(value) + step + values.length) % values.length]!;
    if (setting === 'camera') this.camera = cycle(['follow', 'broadcast', 'end'], this.camera);
    else if (setting === 'setup') this.options.setup = cycle(['open', 'free', 'penalty'], this.options.setup ?? 'open');
    else if (setting === 'mates') this.mates = cycle([0, 1, 3], this.mates);
    else this.defenders = cycle([0, 1, 2], this.defenders);
    const select = this.ui?.querySelector<HTMLSelectElement>(setting === 'camera' ? '[data-training-camera]' : `[data-${setting}]`);
    if (select) select.value = String(setting === 'camera' ? this.camera : setting === 'setup' ? this.options.setup : setting === 'mates' ? this.mates : this.defenders);
    if (setting !== 'camera') this.reset();
  }
  constructor(readonly sim: MatchSim, readonly options: TrainingOptions) {
    sim.opts.training = true;
    this.hero = sim.players.find((p) => p.team === 0 && p.role === 'ST')!;
    this.receiver = sim.players.find((p) => p.team === 0 && p !== this.hero && p.role !== 'GK')!;
    this.reset();
  }
  mount(scene: THREE.Scene, parent: HTMLElement, quit: () => void, skills: () => void): void {
    scene.add(this.markers);
    this.ui = document.createElement('section'); this.ui.className = 'fb-training-hud';
    this.ui.innerHTML = `<div class="tr-info"><b data-title></b><span data-instruction></span><span data-progress></span><strong data-result></strong></div>
      <div class="tr-buttons"><button data-reset>↺ Reset ball · R</button>${this.options.mode === 'skill' ? '<button data-demo>Demonstrate move</button>' : ''}<select data-training-camera aria-label="Training camera"><option value="follow">Player follow</option><option value="broadcast">Broadcast</option><option value="end">Behind goal</option></select>${this.options.mode === 'free' ? '<select data-setup aria-label="Practice situation"><option value="open">Open play</option><option value="free">Free kick</option><option value="penalty">Penalty</option></select><select data-mates aria-label="Training teammates"><option value="0">No teammates</option><option value="1">1 teammate</option><option value="3">3 teammates</option></select><select data-defenders aria-label="Training defenders"><option value="0">Keeper only</option><option value="1">1 defender</option><option value="2">2 defenders</option></select>' : ''}<button data-skills>Skill sets</button><button data-quit>← Training menu</button></div>
      <small>Normal match controls · T / L2 + R3 equipped skill · R or L1 + R1 reset · Esc options</small>`;
    parent.append(this.ui);
    this.ui.querySelector('[data-reset]')!.addEventListener('click', () => this.reset());
    this.ui.querySelector('[data-demo]')?.addEventListener('click', () => { this.reset(); this.demo(); });
    this.ui.querySelector('[data-skills]')!.addEventListener('click', skills);
    this.ui.querySelector('[data-quit]')!.addEventListener('click', quit);
    this.ui.querySelector<HTMLSelectElement>('[data-training-camera]')!.onchange = (e) => this.camera = (e.target as HTMLSelectElement).value as typeof this.camera;
    this.ui.querySelector<HTMLSelectElement>('[data-setup]')?.addEventListener('change', (e) => { this.options.setup = (e.target as HTMLSelectElement).value as TrainingOptions['setup']; this.reset(); });
    this.ui.querySelector<HTMLSelectElement>('[data-mates]')?.addEventListener('change', (e) => { this.mates = Number((e.target as HTMLSelectElement).value); this.reset(); });
    this.ui.querySelector<HTMLSelectElement>('[data-defenders]')?.addEventListener('change', (e) => { this.defenders = Number((e.target as HTMLSelectElement).value); this.reset(); });
    window.addEventListener('keydown', this.key);
    this.draw();
  }
  private key = (e: KeyboardEvent) => { if (e.code === 'KeyR' && !(e.target as HTMLElement)?.matches('input,select') && !e.repeat) this.reset(); };
  controllerReset(held: boolean): void { if (held && !this.resetHeld) this.reset(); this.resetHeld = held; }
  demo(): void { if (this.options.skillId) this.sim.doTrick(this.hero, this.options.skillId, 0, 1); }
  private clearMarkers(): void {
    this.markers.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose()); else o.material.dispose(); } });
    this.markers.clear();
  }
  reset(): void {
    if (this.completed) { this.completed = false; this.drill = 0; this.score = 0; }
    const m = this.sim;
    m.resetPractice(); this.clearMarkers(); this.gates = []; this.gate = 0; this.result = ''; this.resetAt = 0; this.skillAt = -1; this.passType = ''; this.started = m.time;
    const h = m.humans[0]!;
    h.p = this.hero.i; this.hero.human = 0;
    this.hero.state = 'run'; this.hero.face = 0;
    const gk = m.gkOf(1); Object.assign(gk, { state: 'run', x: PITCH.HL - 2, z: 0, face: Math.PI, tx: PITCH.HL - 2, tz: 0 });
    let x = 25, z = 0;
    const pack = this.options.pack;
    if (pack === 'finishing') { x = PITCH.HL - (10 + (this.drill % 5) * 3); z = ((Math.floor(this.drill / 5) % 4) - 1.5) * 5; this.label = 'Score past the keeper. Aim with the stick; hold Shoot for power.'; }
    else if (pack === 'passing') {
      x = -18; z = (this.drill % 3 - 1) * 4;
      Object.assign(this.receiver, { state: 'run', x: x + 12 + this.drill % 5 * 3, z: z + (this.drill % 2 ? 1 : -1) * (6 + this.drill % 4 * 2), face: 0 });
      this.receiver.tx = this.receiver.x; this.receiver.tz = this.receiver.z;
      this.label = `${this.drill % 3 === 0 ? 'Ground pass (J / ✕)' : this.drill % 3 === 1 ? 'Through ball (L / △)' : 'Lob pass (I / □)'} to the highlighted teammate.`;
      this.ring(this.receiver.x, this.receiver.z, 1.6, '#19e07a');
    } else if (pack === 'dribbling') {
      x = -15; z = 0; gk.state = 'off';
      const count = 4 + Math.floor(this.drill / 5), spacing = 3.5 + this.drill % 3 * 0.4;
      this.gates = Array.from({ length: count }, (_, i) => ({ x: x + (i + 1) * spacing, z: (i % 2 ? -1 : 1) * (1.5 + this.drill % 5 * 0.3) }));
      this.gates.forEach((p, i) => { this.ring(p.x, p.z, 1.1, i === 0 ? '#19e07a' : '#00b4ff'); for (const side of [-1, 1]) { const cone = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.6, 12), new THREE.MeshStandardMaterial({ color: '#ff8b27', roughness: 0.8 })); cone.position.set(p.x, 0.3, p.z + side * 1.5); this.markers.add(cone); } });
      this.label = 'Carry the ball through each green gate in order. Keep close control.';
    } else if (pack === 'setpieces') { x = this.drill < 10 ? PITCH.HL - (19 + this.drill % 5 * 2) : PITCH.HL - 11; z = this.drill < 10 ? (this.drill % 2 ? 1 : -1) * (2 + this.drill % 5) : 0; this.label = this.drill < 10 ? 'Free kick: aim with the stick, then shoot. Try finesse or power.' : 'Penalty: place your shot away from the keeper.'; }
    else if (this.options.mode === 'skill') { x = 0; gk.state = 'off'; this.label = `${SKILL_BY_ID.get(this.options.skillId!)!.name} · T / L2 + R3. Complete the move, then gather the ball.`; }
    else this.label = 'Untimed practice. Dribble, shoot and try skills; the ball resets after goals or going out.';
    Object.assign(this.hero, { x, z, tx: x, tz: z, vx: 0, vz: 0 });
    if (this.options.mode === 'free') {
      m.players.filter((p) => p.team === 0 && p !== this.hero && p.role !== 'GK').slice(0, this.mates).forEach((p, i) => Object.assign(p, { state: 'run', x: x + (i % 2 ? -5 : 7), z: z + (i % 2 ? -1 : 1) * (7 + i * 3), tx: x + (i % 2 ? -5 : 7), tz: z + (i % 2 ? -1 : 1) * (7 + i * 3) }));
      m.players.filter((p) => p.team === 1 && p.role !== 'GK').slice(0, this.defenders).forEach((p, i) => Object.assign(p, { state: 'run', x: x + 6 + i * 4, z: z + (i % 2 ? -3 : 3), face: Math.PI }));
    }
    m.ball.x = x + 0.4; m.ball.z = z; m.ball.owner = this.hero.i; m.ball.lastTeam = 0; m.ball.lastPlayer = this.hero.i;
    m.gained(this.hero);
    const setup = pack === 'setpieces' ? this.drill < 10 ? 'free' : 'penalty' : this.options.setup;
    if (setup === 'free' || setup === 'penalty') m.practiceRestart(setup, setup === 'penalty' ? PITCH.HL - 11 : x, z);
    this.draw();
  }
  private ring(x: number, z: number, radius: number, color: string): void {
    const r = new THREE.Mesh(new THREE.RingGeometry(radius - 0.08, radius, 48), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }));
    r.rotation.x = -Math.PI / 2; r.position.set(x, 0.025, z); this.markers.add(r);
  }
  beforeStep(): void {
    if (this.options.pack === 'passing' && this.receiver.state === 'run') { this.receiver.tx = this.receiver.x; this.receiver.tz = this.receiver.z; this.receiver.tSprint = false; }
    if (this.resetAt && this.sim.time >= this.resetAt) {
      if (this.resultWon && this.options.mode === 'pack') { this.drill++; if (this.drill >= 20) { this.completed = true; this.resetAt = 0; this.draw(); return; } }
      this.reset();
    }
  }
  update(events: MatchEvent[]): void {
    if (this.completed) return;
    if (this.resetAt) { this.draw(); return; }
    for (const e of events) {
      if (e.k === 'kick' && e.p === this.hero.i) this.passType = e.type;
      if (e.k === 'trick' && e.p === this.hero.i && e.trick === this.options.skillId) this.skillAt = this.sim.time;
      if (e.k === 'goal') { this.finish(this.options.mode === 'free' || this.options.pack === 'finishing' || this.options.pack === 'setpieces', 'GOAL!'); break; }
      if ((e.k === 'out' || e.k === 'restart' && e.kind !== 'free' && e.kind !== 'penalty') && this.sim.time - this.started > 0.5) { this.finish(false, 'Out of play · try again'); break; }
      if (e.k === 'save' && this.options.mode !== 'free') { this.finish(false, 'Saved · try another angle'); break; }
      if (e.k === 'touch' && e.p === this.receiver.i && this.options.pack === 'passing' && this.sim.lastPass) {
        const want = this.drill % 3 === 0 ? 'pass' : this.drill % 3 === 1 ? 'through' : 'lob';
        this.finish(this.passType === want, this.passType === want ? 'PASS COMPLETE!' : `Use a ${want} pass for this exercise`); break;
      }
    }
    if (this.options.pack === 'dribbling' && this.sim.ball.owner === this.hero.i) {
      const target = this.gates[this.gate];
      if (target && Math.hypot(target.x - this.hero.x, target.z - this.hero.z) < 1.2) {
        const ring = this.markers.children[this.gate * 3] as THREE.Mesh;
        (ring.material as THREE.MeshBasicMaterial).color.set('#677485'); this.gate++;
        const next = this.markers.children[this.gate * 3] as THREE.Mesh | undefined;
        if (next) (next.material as THREE.MeshBasicMaterial).color.set('#19e07a');
        if (this.gate === this.gates.length) this.finish(true, 'COURSE COMPLETE!');
      }
    }
    if (this.options.mode === 'skill' && this.skillAt >= 0 && this.sim.time > this.skillAt + 1.8 && this.sim.ball.owner === this.hero.i && this.hero.state === 'run') this.finish(true, 'SKILL COMPLETE!');
    if (this.options.mode !== 'free' && this.sim.time - this.started > 35) this.finish(false, 'Time up · reset and try again');
    this.draw();
  }
  private finish(won: boolean, message: string): void {
    if (this.resetAt) return;
    this.resultWon = won; this.result = message;
    if (won) this.score += Math.max(100, Math.round(1000 - (this.sim.time - this.started) * 20));
    this.resetAt = this.sim.time + 2.2;
    if (won) {
      try { const scores = JSON.parse(localStorage.getItem('matchday:training') ?? '{}'); const key = this.options.pack ?? `skill-${this.options.skillId ?? 'free'}`; scores[key] = Math.max(scores[key] ?? 0, this.score); localStorage.setItem('matchday:training', JSON.stringify(scores)); } catch { /* optional persistence */ }
    }
    this.draw();
  }
  private draw(): void {
    if (!this.ui) return;
    this.ui.querySelector('[data-title]')!.textContent = this.completed ? 'PACK COMPLETE' : this.options.mode === 'free' ? 'FREE TRAINING' : this.options.mode === 'skill' ? 'SKILL PRACTICE' : `${this.options.pack!.toUpperCase()} · ${this.drill + 1} / 20`;
    this.ui.querySelector('[data-instruction]')!.textContent = this.completed ? 'All 20 exercises completed. Reset to restart the pack or choose another pack.' : this.label;
    this.ui.querySelector('[data-progress]')!.textContent = `Score ${this.score.toLocaleString()}${this.gates.length ? ` · Gates ${this.gate}/${this.gates.length}` : ''} · ${Math.floor(this.sim.time - this.started)}s`;
    this.ui.querySelector('[data-result]')!.textContent = this.result;
  }
  dispose(): void { if (this.ui) window.removeEventListener('keydown', this.key); this.ui?.remove(); this.markers.removeFromParent(); this.clearMarkers(); }
}
