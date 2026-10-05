import { Vector3, type Mesh, type Scene } from 'three';
import type { PhysicsWorld } from '@shared/physics/PhysicsWorld';
import { RaceSimulation, type RacerSetup } from '@shared/race/RaceSimulation';
import { ITEMS } from '@shared/items/ItemTypes';
import type { PlayerInput } from '@shared/types/input';
import type { AssetLoader } from '../assets/AssetLoader';
import { CHASE_CAMERA, tuningForViewport } from '../config/camera';
import { getCharacter, getKartBody } from '../config/roster';
import type { InputManager } from '../input/InputManager';
import { ItemViews } from '../items/ItemViews';
import { LocalPlayer } from '../players/LocalPlayer';
import { ChaseCamera } from '../rendering/ChaseCamera';
import type { ViewRender } from '../rendering/Renderer';
import { computeViewports, tvViewport, type ViewportRect } from '../rendering/ViewportLayout';
import type { TrackRuntime } from '../tracks/TrackBuilder';
import { Hud, formatTime, type ResultRow } from '../ui/Hud';
import type { MinimapDot } from '../ui/Minimap';
import { KartEntity } from '../vehicles/KartEntity';
import { buildKartRig } from '../vehicles/KartModelFactory';
import { KartView } from '../vehicles/KartView';
import type { Effects } from '../vfx/Effects';
import { GhostPlayer, GhostRecorder, GhostStore, type GhostRun } from './Ghost';
import { RacePresenter } from './RacePresenter';
import type { SessionConfig } from './SessionConfig';
import type { RaceStartMessage } from '@shared/net/Protocol';
import type { NetClient } from '../net/NetClient';
import { NetRaceSync, type NetStats } from '../net/NetRaceSync';
import type { GameAudio } from '../audio/GameAudio';
import { RaceAudio } from '../audio/RaceAudio';

export interface SessionDeps {
  scene: Scene;
  physics: PhysicsWorld;
  assets: AssetLoader;
  track: TrackRuntime;
  fx: Effects;
  icons: Record<string, string>;
  ui: HTMLElement;
  input: InputManager;
  audio: GameAudio;
}

const SPECTATOR_SWITCH = 9;

/** An online race: the room connection and the server's race description. */
export interface OnlineRace {
  net: NetClient;
  start: RaceStartMessage;
}

/**
 * One race: simulation, karts, items, local players (camera + HUD each) or a
 * spectator camera for attract mode, plus Time Trial ghost/records.
 */
export class RaceSession {
  readonly race: RaceSimulation;
  readonly karts: KartEntity[];
  readonly players: LocalPlayer[] = [];
  readonly spectator: ChaseCamera | null = null;
  private readonly focusCache: Vector3[] = [];
  private readonly itemViews: ItemViews;
  private readonly presenter: RacePresenter;
  private readonly pending: RaceSimulation['events'] = [];
  private readonly inputs: Array<PlayerInput | null>;
  private spectateIndex = 0;
  private readonly tvRect: ViewportRect | null;
  private spectateTimer = SPECTATOR_SWITCH;
  /** Online races: prediction / interpolation against the server. */
  readonly sync: NetRaceSync | null = null;
  /** Online menu open over the live race: local players coast. */
  suppressInput = false;
  readonly audio: RaceAudio;
  // Time Trial.
  private recorder: GhostRecorder | null = null;
  private ghost: GhostPlayer | null = null;
  private record: GhostRun | null = null;
  newRecord = false;

  constructor(
    private readonly deps: SessionDeps,
    readonly config: SessionConfig,
    setups: RacerSetup[],
    seed: number,
    online: OnlineRace | null = null,
  ) {
    const def = deps.track.def;
    const start = online?.start;
    this.race = new RaceSimulation(
      start
        ? {
            laps: start.settings.laps,
            checkpoints: start.checkpoints,
            racers: start.racers,
            itemsEnabled: start.settings.items,
            difficulty: start.settings.difficulty,
            catchUp: start.catchUp,
            seed: start.seed,
            countdown: start.countdown,
          }
        : {
            laps: config.laps,
            checkpoints: def.checkpointCount,
            racers: setups,
            itemsEnabled: config.items,
            difficulty: config.mode === 'attract' ? 'hard' : config.difficulty,
            catchUp: config.mode === 'race' || config.mode === 'grandprix',
            seed,
            countdown: config.mode === 'attract' ? 0.5 : 4,
          },
      deps.physics,
      deps.track.path,
    );
    this.karts = this.race.racers.map((r) => {
      const view = new KartView(buildKartRig(deps.assets, getKartBody(r.kartId), getCharacter(r.characterId)));
      deps.scene.add(view.root, view.contactShadow);
      const k = new KartEntity(r, view, deps.physics);
      k.interpolate(1);
      return k;
    });
    this.inputs = this.race.racers.map(() => null);
    if (online) this.sync = new NetRaceSync(online.net, online.start, this.race, this.karts);
    this.itemViews = new ItemViews(this.race, deps.fx);
    deps.fx.skids.clear();
    deps.scene.add(this.itemViews.root);

    // Local players (humans are the last racers in the setup list unless reordered).
    const timeTrial = config.mode === 'timetrial';
    config.players.forEach((p, slot) => {
      const racerIndex = this.sync ? this.sync.seats[slot]! : this.race.racers.findIndex((r) => r.id === `p${slot + 1}`);
      const camera = new ChaseCamera(tuningForViewport(16 / 9, config.players.length), deps.physics);
      const many = config.players.length;
      const hud = new Hud(deps.ui, deps.icons, deps.track.path, { standings: !timeTrial && many <= 2, minimap: true, timer: true, hint: many === 1 });
      const netId = online ? this.race.racers[racerIndex]!.id : `local:${slot}`;
      const player = new LocalPlayer(slot, netId, racerIndex, deps.input.createSource(p.device), this.karts[racerIndex]!, camera, hud);
      camera.snap(player.kart.chase);
      this.players.push(player);
    });
    // Attract mode, or the spare quarter in 3-player split-screen, gets a TV camera.
    this.tvRect = this.players.length === 0 ? { x: 0, y: 0, width: 1, height: 1 } : tvViewport(this.players.length);
    if (this.tvRect) {
      this.spectator = new ChaseCamera({ ...CHASE_CAMERA, distance: 9, height: 5.2, fov: 60 }, deps.physics);
      this.spectator.snap(this.karts[0]!.chase);
    }

    this.audio = new RaceAudio(deps.audio, {
      race: this.race,
      karts: this.karts,
      players: this.players,
      spectator: this.spectator?.camera ?? null,
      quiet: config.mode === 'attract',
      music: def.music,
    });

    const gantry = deps.track.root.getObjectByName('start-gantry');
    this.presenter = new RacePresenter(this.race, this.players, this.karts, deps.fx, (gantry?.userData.startLights as Mesh[] | undefined) ?? []);

    if (timeTrial && this.players[0]) this.setupTimeTrial();
  }

  private setupTimeTrial(): void {
    this.recorder = new GhostRecorder();
    this.record = GhostStore.load(this.config.trackId, this.config.laps);
    if (this.record) {
      const rig = buildKartRig(this.deps.assets, getKartBody(this.record.kartId), getCharacter(this.record.characterId));
      this.ghost = new GhostPlayer(this.record, rig.root);
      this.deps.scene.add(rig.root);
    }
  }

  /** Lay viewports out for the canvas size. */
  layout(width: number, height: number): void {
    const rects = computeViewports(this.players.length, this.config.split);
    this.players.forEach((p, i) => {
      p.viewport = rects[i]!;
      const aspect = (p.viewport.width * width) / Math.max(1, p.viewport.height * height);
      p.camera.tuning = tuningForViewport(aspect, this.players.length);
      p.camera.setAspect(aspect);
      p.hud.layout(p.viewport);
    });
    if (this.spectator && this.tvRect) this.spectator.setAspect((this.tvRect.width * width) / Math.max(1, this.tvRect.height * height));
  }

  get views(): ViewRender[] {
    const views: ViewRender[] = this.players.map((p) => ({ camera: p.camera.camera, rect: p.viewport }));
    if (this.spectator && this.tvRect) views.push({ camera: this.spectator.camera, rect: this.tvRect });
    return views;
  }

  /** Points the shadow frustum must cover (just ahead of each local view). */
  focusPoints(): Vector3[] {
    const karts = this.players.length ? this.players.map((p) => p.kart) : [this.karts[this.spectateIndex]!];
    return karts.map((k, i) => (this.focusCache[i] ??= new Vector3()).copy(k.render.position).addScaledVector(k.chase.forward, karts.length > 1 ? 10 : 25));
  }

  get allHumansSawResults(): boolean {
    return this.players.length > 0 && this.players.every((p) => p.resultsShown);
  }

  resetPlayer(p: LocalPlayer): void {
    if (this.race.phase === 'countdown') return;
    if (this.sync) {
      // Online: the reset travels with the input so server and prediction agree.
      p.resetRequested = true;
      return;
    }
    p.kart.reset();
    p.kart.interpolate(1);
    p.camera.snap(p.kart.chase);
  }

  // ---------------------------------------------------------------- per tick

  tick(dt: number): void {
    for (const p of this.players) {
      p.source.read(p.input);
      if (this.suppressInput) Object.assign(p.input, { throttle: 0, brake: 0, steer: 0, drift: false, item: false });
      this.inputs[p.racerIndex] = p.input;
    }
    if (this.sync) {
      this.sync.tick(
        this.players.map((p) => p.input),
        this.players.map((p) => p.takeReset()),
      );
      return;
    }
    for (const k of this.karts) k.beforeTick();
    this.race.step(this.inputs, dt);
    for (const k of this.karts) k.afterTick();
    this.itemViews.afterTick();
    this.pending.push(...this.race.events);

    if (this.recorder) {
      const me = this.players[0]!.kart.racer;
      if (this.race.events.some((e) => e.type === 'go')) {
        // Time Trial starts with a Fizz Six-Pack.
        me.slot.item = 'fizz3';
        me.slot.uses = ITEMS.fizz3.uses;
      }
      if (this.race.phase !== 'countdown' && !me.progress.finished) this.recorder.record(me.state, dt);
      if (this.race.events.some((e) => e.type === 'finish' && e.racer === me.index)) this.finishTimeTrial();
    }
  }

  private finishTimeTrial(): void {
    const me = this.players[0]!.kart.racer;
    const time = me.progress.finishTime;
    if (!this.record || time < this.record.time) {
      const run = this.recorder!.finish({ trackId: this.config.trackId, laps: this.config.laps, time, lapTimes: [...me.progress.lapTimes], characterId: me.characterId, kartId: me.kartId });
      GhostStore.save(run);
      this.newRecord = true;
      this.players[0]!.hud.banner('NEW RECORD!', 'gold');
    }
  }

  // ---------------------------------------------------------------- per frame

  render(alpha: number, dt: number): void {
    const fx = this.deps.fx;
    if (this.sync) {
      this.sync.frame(dt);
      this.sync.drainEvents(this.pending);
      this.itemViews.afterTick();
    }
    this.audio.handle(this.pending);
    this.presenter.handle(this.pending);
    this.pending.length = 0;

    this.updateThreats();
    const countdown = this.race.phase === 'countdown';
    for (const k of this.karts) {
      k.view.countdown = countdown;
      k.decayCorrection(dt);
      k.interpolate(alpha);
      const ev = k.frameEvents;
      if (ev.landed > 2) k.view.land(ev.landed);
      if (ev.landed > 6) fx.landingDust(k.render.position, ev.landed, k.state.surface);
      if (ev.wallHit > 3) {
        k.view.bump(ev.wallHit);
        fx.wallSparks(k.render.position, k.chase.forward, ev.wallHit);
      }
      if (ev.driftStageUp) fx.driftStageFlash(k.render.position, ev.driftStageUp);
      if (ev.respawned) fx.respawnBeam(k.render.position);
      if (ev.miniTurbo) {
        k.view.kick(ev.miniTurbo);
        fx.miniTurbo(k.render.position, ev.miniTurbo);
      }
      const timed = k.racer.slot.timer > 0 ? k.racer.slot.timedItem : null;
      k.view.setAccessory(timed);
      k.view.update(k.render, k.state, dt);
      if (dt > 0) fx.kart(k.racer.index, k.render, k.state, dt);
    }

    for (const p of this.players) {
      const ev = p.kart.frameEvents;
      if (ev.respawned) p.camera.snap(p.kart.chase);
      else {
        if (ev.landed > 4) p.camera.kickLanding(ev.landed);
        if (ev.wallHit > 4) p.camera.addTrauma(Math.min(0.55, ev.wallHit / 22));
        if (ev.miniTurbo) p.camera.addTrauma(0.08 * ev.miniTurbo);
        if (dt > 0 || this.race.phase === 'countdown') p.camera.update(p.kart.chase, Math.max(dt, 0));
      }
      this.updateHud(p, dt);
    }
    if (this.spectator) this.updateSpectator(dt);
    this.audio.frame(dt);
    for (const k of this.karts) k.clearFrameEvents();

    this.itemViews.render(this.sync ? 1 : alpha, dt);
    this.ghost?.update(this.race.time);
  }

  /** Drivers glance back at projectiles closing in from behind. */
  private updateThreats(): void {
    const entities = this.race.items.entities.list;
    for (const k of this.karts) {
      const p = k.render.position;
      const fwd = k.chase.forward;
      let threat = false;
      let side = 1;
      for (const e of entities) {
        if (e.dead || e.attach !== 'none' || e.owner === k.racer.index) continue;
        if (e.kind !== 'seeker' && e.kind !== 'crown' && e.kind !== 'puck' && e.kind !== 'fireball') continue;
        const rx = e.position.x - p.x;
        const rz = e.position.z - p.z;
        const dist = Math.hypot(rx, rz);
        if (dist > 24 || dist < 0.5) continue;
        const ahead = (rx * fwd.x + rz * fwd.z) / dist;
        const closing = -(rx * e.velocity.x + rz * e.velocity.z) / dist;
        if (ahead < -0.3 && closing > 5) {
          threat = true;
          // Right-hand side relative to heading: look over that shoulder.
          side = rx * -fwd.z + rz * fwd.x > 0 ? -1 : 1;
          break;
        }
      }
      k.view.setThreat(threat, side);
    }
  }

  private updateSpectator(dt: number): void {
    this.spectateTimer -= dt;
    if (this.spectateTimer <= 0) {
      this.spectateTimer = SPECTATOR_SWITCH;
      // Prefer someone in the thick of it: a random racer from the front half.
      const front = this.race.standings().slice(0, Math.ceil(this.karts.length / 2));
      this.spectateIndex = front[Math.floor(Math.random() * front.length)]!.index;
      this.spectator!.snap(this.karts[this.spectateIndex]!.chase);
    }
    if (dt > 0) this.spectator!.update(this.karts[this.spectateIndex]!.chase, dt);
  }

  private updateHud(p: LocalPlayer, dt: number): void {
    const r = this.race.racers[p.racerIndex]!;
    const slot = r.slot;
    const timedDef = slot.timedItem ? ITEMS[slot.timedItem] : null;
    p.hud.update(dt, {
      position: r.progress.position,
      racerCount: this.race.racers.length,
      lap: r.progress.lap,
      laps: this.race.config.laps,
      coins: r.state.coins,
      item: slot.item,
      uses: slot.uses,
      roulette: slot.roulette,
      timed: timedDef && slot.timer > 0 ? slot.timer / (timedDef.duration ?? 1) : -1,
      ink: r.state.inkTimer,
      wrongWay: r.progress.wrongWay && !r.progress.finished,
      speedFx: this.speedFx(r),
    });
    const shownTime = r.progress.finished ? r.progress.finishTime : Math.max(0, this.race.time);
    const currentLap = !r.progress.finished && r.progress.lap >= 1 ? Math.max(0, this.race.time - r.progress.lapStartTime) : null;
    p.hud.updateTimer(shownTime, r.progress.lapTimes, currentLap, this.record?.time ?? null);
    p.hud.updateStandings(
      this.race.standings().map((o) => ({ id: o.id, name: o.name, color: getCharacter(o.characterId).color, position: o.progress.position, me: o.index === r.index })),
    );
    p.hud.drawMinimap(this.minimapDots(r.index));

    if ((r.progress.finished || this.sync?.end) && !p.resultsShown) {
      p.finishedFor += dt;
      // Finish shot: swing round to watch the driver celebrate (or sulk).
      if (r.progress.finished && p.finishedFor > 0.9) p.camera.finishMode = true;
      if (p.finishedFor > 2.5) {
        p.hud.showResults(this.resultRows(p.racerIndex), this.resultsHint());
        p.resultsShown = true;
      }
    } else if (p.resultsShown && this.config.mode !== 'timetrial') {
      // Keep standings live while CPUs finish.
      p.finishedFor += dt;
      if (p.finishedFor % 1 < dt) p.hud.showResults(this.resultRows(p.racerIndex), this.resultsHint());
    }
  }

  /** Speed lines kick in near top speed and on any boost. */
  private speedFx(r: { state: { forwardSpeed: number; boostTimer: number; rocketTimer: number; invincibleTimer: number }; sim: { stats: { maxSpeed: number } } }): number {
    const s = r.state;
    const near = Math.max(0, (s.forwardSpeed / r.sim.stats.maxSpeed - 0.9) * 5);
    const boost = s.rocketTimer > 0 ? 1 : s.boostTimer > 0 ? 0.75 : s.invincibleTimer > 0 ? 0.5 : 0;
    return Math.min(1, near * 0.45 + boost);
  }

  private minimapDots(me: number): MinimapDot[] {
    const dots: MinimapDot[] = [];
    for (const b of this.race.pickups.boxes) if (b.respawn <= 0) dots.push({ x: b.position.x, z: b.position.z, color: '#fff', kind: 'box' });
    for (const r of this.race.racers) {
      const isMe = r.index === me;
      const dot: MinimapDot = { x: r.state.position.x, z: r.state.position.z, color: getCharacter(r.characterId).color, kind: isMe ? 'me' : 'racer' };
      if (isMe) dot.dir = [r.state.forward.x, r.state.forward.z];
      dots.push(dot);
    }
    for (const e of this.race.items.entities.list) if (e.kind === 'crown' && !e.dead) dots.push({ x: e.position.x, z: e.position.z, color: '#2f6bff', kind: 'crown' });
    if (this.ghost?.model.visible) dots.push({ x: this.ghost.model.position.x, z: this.ghost.model.position.z, color: '#9fe6ff', kind: 'racer' });
    return dots;
  }

  private resultsHint(): string {
    if (this.sync) return this.sync.end ? 'Back to the lobby in a moment · Esc — menu' : 'Waiting for the other racers… · Esc — menu';
    switch (this.config.mode) {
      case 'grandprix':
        return 'Enter / Ⓐ — Grand Prix standings';
      case 'timetrial':
        return 'Enter / Ⓐ — try again · Esc — menu';
      default:
        return 'Enter / Ⓐ — race again · Esc — menu';
    }
  }

  private resultRows(me: number): ResultRow[] {
    if (this.config.mode === 'timetrial') {
      const p = this.race.racers[me]!.progress;
      const rows: ResultRow[] = p.lapTimes.map((t, i) => ({ position: i + 1, name: `Lap ${i + 1}${t === p.bestLap ? ' ★' : ''}`, time: formatTime(t), me: false }));
      rows.push({ position: p.lapTimes.length + 1, name: this.newRecord ? 'Total — NEW RECORD!' : 'Total', time: formatTime(p.finishTime), me: true });
      if (this.record && !this.newRecord) rows.push({ position: rows.length + 1, name: 'Record', time: formatTime(this.record.time), me: false });
      return rows.map((r) => ({ ...r, position: 0 })); // no placings in a solo run
    }
    const end = this.sync?.end;
    if (end) {
      const mine = this.race.racers[me]!.id;
      return end.rows.map((row) => ({ position: row.position, name: `${row.name}  +${row.points}`, time: row.finished ? formatTime(row.time) : 'DNF', me: row.id === mine }));
    }
    return this.race.standings().map((r) => ({
      position: r.progress.position,
      name: r.name,
      time: r.progress.finished ? formatTime(r.progress.finishTime) : `Lap ${Math.max(1, r.progress.lap)}`,
      me: r.index === me,
    }));
  }

  dispose(): void {
    const scene = this.deps.scene;
    this.sync?.dispose();
    this.audio.dispose();
    this.race.dispose();
    for (const k of this.karts) scene.remove(k.view.root, k.view.contactShadow);
    scene.remove(this.itemViews.root);
    if (this.ghost) scene.remove(this.ghost.model);
    for (const p of this.players) p.hud.dispose();
  }

  /** Online connection quality (null offline). */
  get netStats(): NetStats | null {
    return this.sync?.stats ?? null;
  }

  /** Finishing order (ids) for Grand Prix points. */
  finishingOrder(): string[] {
    return this.race.standings().map((r) => r.id);
  }
}
