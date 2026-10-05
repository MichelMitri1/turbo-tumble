import { BufferGeometry, Color, Float32BufferAttribute, Fog, Line, LineBasicMaterial, PMREMGenerator, Scene, Vector3 } from 'three';
import { computeRacingLine } from '@shared/track/RacingLine';
import { initPhysics, PhysicsWorld } from '@shared/physics/PhysicsWorld';
import { getTrack } from '@shared/tracks/registry';
import { getCup } from '@shared/tracks/cups';
import { GrandPrixState } from '@shared/race/GrandPrix';
import type { SkyDefinition } from '@shared/types/track';
import { AssetLoader } from '../assets/AssetLoader';
import type { GraphicsSettings } from '../config/graphics';
import { CHARACTERS, KART_BODIES, getCharacter } from '../config/roster';
import { GameLoop } from '../core/GameLoop';
import { InputManager } from '../input/InputManager';
import { Lighting } from '../rendering/Lighting';
import { setTextureAnisotropy } from '../rendering/ProceduralTextures';
import { Renderer } from '../rendering/Renderer';
import { Sky } from '../rendering/Sky';
import { loadTrack, type TrackRuntime } from '../tracks/TrackBuilder';
import { DebugOverlay, type DebugSnapshot } from '../ui/DebugOverlay';
import { GrandPrixPanel, type GpRow } from '../ui/GrandPrixPanel';
import { MainMenu, type MenuChoice } from '../ui/MainMenu';
import { JoinScreen } from '../ui/JoinScreen';
import { ControlsPanel } from '../ui/ControlsPanel';
import { PauseMenu } from '../ui/PauseMenu';
import { renderItemIcons } from '../items/IconStudio';
import { Effects } from '../vfx/Effects';
import { RaceSession, type OnlineRace, type SessionDeps } from './RaceSession';
import { buildRacerSetups, normalizeSession, type PlayerSetup, type SessionConfig } from './SessionConfig';
import { OnlineFlow } from './OnlineFlow';
import { GameAudio } from '../audio/GameAudio';
import { el } from '../ui/dom';

export interface GameOptions {
  trackId: string;
  graphics: GraphicsSettings;
  /** Start straight into a session (dev links); otherwise show the main menu. */
  initialSession: SessionConfig | null;
}

export type LoadProgress = (fraction: number, label: string) => void;

type Flow = 'menu' | 'racing' | 'gp-standings' | 'gp-final' | 'online';

/**
 * Top-level app: renderer, physics, track and loop. Runs one RaceSession at a
 * time (attract mode behind the menu, or a player race) and the mode flow
 * between races (Single Race, Grand Prix, Time Trial).
 */
export class Game {
  readonly scene = new Scene();
  readonly input = new InputManager();
  readonly assets = new AssetLoader();
  readonly physics = new PhysicsWorld();
  readonly audio = new GameAudio();
  private soundHint!: HTMLElement;
  readonly renderer: Renderer;
  session!: RaceSession;
  /** HUD icons rendered from the item models (public for dev tooling). */
  icons: Record<string, string> = {};
  private track!: TrackRuntime;
  private lighting!: Lighting;
  private fx!: Effects;
  private debug!: DebugOverlay;
  private pause!: PauseMenu;
  private menu!: MainMenu;
  private join!: JoinScreen;
  private controls!: ControlsPanel;
  private online!: OnlineFlow;
  private lastChoice: MenuChoice | null = null;
  private pendingChoice: MenuChoice | null = null;
  private gpPanel!: GrandPrixPanel;
  private gp: GrandPrixState | null = null;
  private flow: Flow = 'menu';
  private lastConfig: SessionConfig | null = null;
  private readonly loop: GameLoop;
  private time = 0;
  private seed = 1;

  private constructor(
    canvas: HTMLCanvasElement,
    private readonly ui: HTMLElement,
    private readonly options: GameOptions,
  ) {
    this.renderer = new Renderer(canvas, options.graphics);
    setTextureAnisotropy(Math.min(8, this.renderer.maxAnisotropy));
    this.loop = new GameLoop({
      frameStart: (dt) => this.frameStart(dt),
      tick: (dt) => this.session.tick(dt),
      render: (alpha, dt) => this.render(alpha, dt),
    });
  }

  static async create(canvas: HTMLCanvasElement, ui: HTMLElement, options: GameOptions, onProgress: LoadProgress): Promise<Game> {
    await initPhysics();
    const game = new Game(canvas, ui, options);
    await game.load(onProgress);
    return game;
  }

  private async load(onProgress: LoadProgress): Promise<void> {
    const def = getTrack(this.options.trackId);
    this.scene.background = new Color(def.sky.horizon);
    this.scene.fog = new Fog(new Color(def.sky.fogColor), def.sky.fogNear, def.sky.fogFar);
    this.lighting = new Lighting(this.scene, def.lighting, this.options.graphics);
    this.renderer.setExposure(def.lighting.exposure);
    this.scene.add(new Sky(def.sky, this.lighting.sunDirection).mesh);
    this.bakeEnvironment(def.sky, this.lighting.sunDirection);

    // The whole roster (menus can pick any combination).
    const kartModels = new Set<string>([...CHARACTERS.map((c) => c.model), ...KART_BODIES.map((k) => k.model)]);
    await this.assets.loadModels(kartModels, (d, t) => onProgress(0.05 * (d / Math.max(1, t)), 'Fuelling karts'));

    this.track = await loadTrack(def, { assets: this.assets, physics: this.physics, graphics: this.options.graphics }, (f, label) =>
      onProgress(0.05 + f * 0.85, label),
    );
    this.scene.add(this.track.root);

    onProgress(0.93, 'Stocking item boxes');
    this.icons = renderItemIcons();
    this.fx = new Effects();
    this.scene.add(this.fx.root);

    this.debug = new DebugOverlay(this.ui, this.scene, this.physics, [this.track.terrainCollider]);
    this.pause = new PauseMenu(this.ui, {
      resume: () => this.setPaused(false),
      reset: () => this.session.players.forEach((p) => this.session.resetPlayer(p)),
      restart: () => this.restart(),
      quit: () => (this.flow === 'online' ? void this.online.leave() : this.showMenu()),
      toggleDebug: () => this.debug.toggle(),
    });
    this.menu = new MainMenu(
      this.ui,
      (choice) => this.startFromMenu(choice),
      () => {
        this.menu.setOpen(false);
        this.controls.setOpen(true);
      },
    );
    this.join = new JoinScreen(this.ui, this.input, (players) => {
      const choice = this.pendingChoice;
      this.pendingChoice = null;
      if (!players || !choice) this.menu.setOpen(true);
      else this.launch(choice, players);
    }, (name) => this.audio.ui(name));
    this.controls = new ControlsPanel(this.ui, this.input, this.audio.engine, () => this.menu.setOpen(true));
    this.gpPanel = new GrandPrixPanel(this.ui);
    this.online = new OnlineFlow(this.ui, {
      startRace: (race, players) => this.startOnlineRace(race, players),
      showLobbyBackdrop: () => this.showOnlineBackdrop(),
      exitToMenu: () => this.showMenu(),
      inRace: () => this.flow === 'online',
    });
    window.addEventListener('resize', () => this.layout());
    this.addRacingLineDebug();
    this.soundHint = el('div', 'tt-sound-hint', '🔈 Click or press any key to turn on sound');
    this.ui.appendChild(this.soundHint);

    const inviteCode = new URLSearchParams(location.search).get('room');
    if (this.options.initialSession) this.startSession(this.options.initialSession);
    else if (inviteCode) {
      // Invite link: straight to the online screen with the code filled in.
      this.showMenu();
      this.menu.setOpen(false);
      this.online.open([{ character: 'bix', kart: 'comet', device: { kind: 'any' } }], {}, inviteCode);
    } else this.showMenu();
    onProgress(1, 'Ready!');
  }

  /** F5 toggles the computed racing line (colour = target speed, red slow → green fast). */
  private addRacingLineDebug(): void {
    const path = this.track.path;
    const line = computeRacingLine(path);
    const pos: number[] = [];
    const col: number[] = [];
    const c = new Color();
    for (let i = 0; i <= path.samples.length; i++) {
      const k = i % path.samples.length;
      const s = path.samples[k]!;
      const p = s.position.clone().addScaledVector(s.right, line.lateral[k]!).addScaledVector(s.up, 0.3);
      pos.push(p.x, p.y, p.z);
      const t = Math.min(1, Math.max(0, (line.speed[k]! - 20) / 15));
      c.setRGB(1 - t, t, 0.2);
      col.push(c.r, c.g, c.b);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new Float32BufferAttribute(col, 3));
    const mesh = new Line(g, new LineBasicMaterial({ vertexColors: true, depthTest: false }));
    mesh.visible = false;
    mesh.renderOrder = 998;
    this.scene.add(mesh);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F5') {
        e.preventDefault();
        mesh.visible = !mesh.visible;
      }
    });
  }

  /** Image-based lighting from the sky so materials pick up sky/ground bounce. */
  private bakeEnvironment(skyDef: SkyDefinition, sun: Vector3): void {
    const pmrem = new PMREMGenerator(this.renderer.gl);
    const envScene = new Scene();
    envScene.add(new Sky(skyDef, sun).mesh);
    this.scene.environment = pmrem.fromScene(envScene, 0, 0.1, 3000).texture;
    this.scene.environmentIntensity = 0.55;
    pmrem.dispose();
  }

  start(): void {
    this.loop.start();
  }

  // ---------------------------------------------------------------- sessions & flow

  private deps(): SessionDeps {
    return {
      scene: this.scene,
      physics: this.physics,
      assets: this.assets,
      track: this.track,
      fx: this.fx,
      icons: this.icons,
      ui: this.ui,
      input: this.input,
      audio: this.audio,
    };
  }

  startSession(config: SessionConfig, gridOrder?: readonly string[]): void {
    const cfg = normalizeSession(config);
    // Dev links (?mode=grandprix) start a cup without going through the menu.
    if (cfg.mode === 'grandprix' && !this.gp) this.gp = new GrandPrixState(getCup('sunny-cup'), buildRacerSetups(cfg).map((s) => s.id));
    this.session?.dispose();
    this.session = new RaceSession(this.deps(), cfg, buildRacerSetups(cfg, gridOrder), this.seed++);
    if (cfg.mode !== 'attract') {
      this.lastConfig = cfg;
      this.flow = 'racing';
      this.menu.setOpen(false);
    }
    this.gpPanel.hide();
    if (this.pause.open) this.setPaused(false);
    this.layout();
  }

  private showMenu(): void {
    this.gp = null;
    this.pause.setOnline(false);
    this.flow = 'menu';
    this.startSession({ mode: 'attract', trackId: this.options.trackId, laps: 99, items: true, difficulty: 'hard', racerCount: 8, players: [], split: 'horizontal' });
    this.menu.setOpen(true);
    this.audio.menuMusic();
  }

  private startFromMenu(choice: MenuChoice): void {
    this.lastChoice = choice;
    if (choice.players > 1) {
      // Multiplayer: everyone claims a device and picks a racer first.
      this.pendingChoice = choice;
      this.menu.setOpen(false);
      this.join.show(choice.players, choice.character, choice.kart);
      return;
    }
    this.launch(choice, [{ character: choice.character, kart: choice.kart, device: { kind: 'any' } }]);
  }

  private launch(choice: MenuChoice, players: SessionConfig['players']): void {
    if (choice.mode === 'online') {
      this.menu.setOpen(false);
      this.online.open(players, { laps: choice.laps, items: choice.items, difficulty: choice.difficulty, racerCount: 8 });
      return;
    }
    const cfg: SessionConfig = {
      mode: choice.mode,
      trackId: this.options.trackId,
      laps: choice.laps,
      items: choice.items,
      difficulty: choice.difficulty,
      racerCount: 8,
      players,
      split: choice.split,
    };
    if (choice.mode === 'grandprix') {
      cfg.laps = 3;
      const cup = getCup('sunny-cup');
      const ids = buildRacerSetups(normalizeSession(cfg)).map((s) => s.id);
      this.gp = new GrandPrixState(cup, ids);
      cfg.trackId = this.gp.trackId;
    }
    this.startSession(cfg);
  }

  // ---------------------------------------------------------------- online

  private startOnlineRace(race: OnlineRace, players: PlayerSetup[]): void {
    const s = race.start.settings;
    const cfg: SessionConfig = {
      mode: 'online',
      trackId: s.trackId,
      laps: s.laps,
      items: s.items,
      difficulty: s.difficulty,
      racerCount: race.start.racers.length,
      players,
      split: this.lastChoice?.split ?? 'horizontal',
    };
    this.session?.dispose();
    this.session = new RaceSession(this.deps(), cfg, race.start.racers, race.start.seed, race);
    this.flow = 'online';
    this.menu.setOpen(false);
    this.gpPanel.hide();
    this.pause.setOnline(true);
    if (this.pause.open) this.setPaused(false);
    this.layout();
  }

  /** Between online races: the attract race runs behind the lobby. */
  private showOnlineBackdrop(): void {
    if (this.pause.open) this.setPaused(false);
    this.pause.setOnline(false);
    this.flow = 'menu';
    this.startSession({ mode: 'attract', trackId: this.options.trackId, laps: 99, items: true, difficulty: 'hard', racerCount: 8, players: [], split: 'horizontal' });
    this.audio.menuMusic();
  }

  private restart(): void {
    if (!this.lastConfig || this.flow === 'online') return;
    if (this.gp) this.gp = new GrandPrixState(this.gp.cup, buildRacerSetups(this.lastConfig).map((s) => s.id));
    this.startSession(this.lastConfig);
  }

  /** Enter/Ⓐ after the results screen. */
  private advance(): void {
    const cfg = this.lastConfig!;
    if (cfg.mode !== 'grandprix' || !this.gp) {
      this.startSession(cfg);
      return;
    }
    const gp = this.gp;
    if (this.flow === 'racing') {
      gp.award(this.session.finishingOrder());
      this.flow = 'gp-standings';
      this.audio.ui('uiConfirm');
      this.gpPanel.show(gp.cup.name, `Race ${gp.raceIndex + 1} of ${gp.raceCount} — standings`, this.gpRows(true), gp.isLastRace ? 'Enter / Ⓐ — trophy ceremony' : 'Enter / Ⓐ — next race');
    } else if (this.flow === 'gp-standings') {
      if (gp.isLastRace) {
        this.flow = 'gp-final';
        const standings = gp.standings();
        const best = standings.findIndex((e) => e.id.startsWith('p')) + 1;
        const who = cfg.players.length > 1 ? `Best player: ${this.session.race.racers.find((r) => r.id === standings[best - 1]!.id)!.name} —` : 'You finished';
        const ord = best === 1 ? '1st' : best === 2 ? '2nd' : best === 3 ? '3rd' : `${best}th`;
        this.gpPanel.show(`${gp.cup.name} Results`, best === 1 && cfg.players.length === 1 ? 'Champion! 🏆' : `${who} ${ord}`, this.gpRows(false), 'Enter / Ⓐ — main menu', true);
      } else {
        gp.nextRace();
        this.startSession({ ...cfg, trackId: gp.trackId }, gp.standings().map((e) => e.id));
      }
    } else {
      this.showMenu();
    }
  }

  private gpRows(withPlus: boolean): GpRow[] {
    const racers = new Map(this.session.race.racers.map((r) => [r.id, r]));
    return this.gp!.standings().map((e) => {
      const r = racers.get(e.id)!;
      return { id: e.id, name: r.name, color: getCharacter(r.characterId).color, points: e.points, plus: withPlus ? e.lastAwarded : 0, me: !r.isAI };
    });
  }

  private layout(): void {
    this.renderer.resize();
    const { width, height } = this.renderer.size;
    this.session?.layout(width, height);
  }

  private setPaused(paused: boolean): void {
    // Online races can't stop the clock: the menu opens over the live race.
    this.loop.paused = paused && this.flow !== 'online';
    this.pause.setOpen(paused);
    this.session.suppressInput = paused && this.flow === 'online';
    this.session.audio.setPaused(paused);
  }

  private get paused(): boolean {
    return this.pause.open;
  }

  // ---------------------------------------------------------------- loop

  private frameStart(dt: number): void {
    this.input.update();
    if (this.renderer.resize()) this.layout();
    const nav = this.input.menuNav();
    this.menuSounds(nav);
    if (this.input.keyboard.wasPressed('KeyM')) this.audio.toggleMute();
    this.soundHint.classList.toggle('is-open', this.audio.engine.available && !this.audio.engine.running && !this.audio.engine.settings.muted);

    if (this.join.open) {
      this.join.update();
    } else if (this.online.screen.open) {
      this.online.handle(nav, this.input.keyboard.wasPressed('Escape'));
    } else if (this.controls.open) {
      this.controls.handle(nav);
    } else if (this.menu.open) {
      this.menu.handle(nav);
    } else if (this.gpPanel.open) {
      if (nav.confirm) this.advance();
    } else {
      const pausePressed = this.session.players.some((p) => p.source.pressed('pause'));
      if (pausePressed) {
        // Esc on the results screen goes back to the menu.
        if (this.session.allHumansSawResults && !this.paused && this.flow === 'racing' && !this.gp) this.showMenu();
        else this.setPaused(!this.paused);
      } else if (this.paused) {
        if (nav.up) this.pause.move(-1);
        if (nav.down) this.pause.move(1);
        if (nav.confirm) this.pause.activate();
        if (nav.back) this.setPaused(false);
      } else {
        for (const p of this.session.players) if (p.source.pressed('reset')) this.session.resetPlayer(p);
        if (this.session.allHumansSawResults && nav.confirm && this.flow !== 'online') this.advance();
      }
    }
    this.time += this.loop.paused ? 0 : dt;
  }

  /** Navigation blips for whichever menu is open. */
  private menuSounds(nav: ReturnType<InputManager['menuNav']>): void {
    const menus = this.controls.open || this.online.screen.open || this.menu.open || this.gpPanel.open || this.pause.open;
    if (!menus) return;
    if (nav.up || nav.down) this.audio.ui('uiMove');
    else if ((nav.left || nav.right) && !this.join.open) this.audio.ui('uiChange');
    if (nav.confirm) this.audio.ui('uiConfirm');
    else if (nav.back || this.input.keyboard.wasPressed('Escape')) this.audio.ui('uiBack');
  }

  private render(alpha: number, dt: number): void {
    this.session.render(this.loop.paused ? 1 : alpha, dt);
    this.fx.update(dt);
    this.track.update(dt, this.time);
    this.lighting.fit(this.session.focusPoints());
    this.renderer.render(this.scene, this.session.views);
    this.debug.update(dt, () => this.debugSnapshot());
    this.input.endFrame();
  }

  /** Dev helper: drop player `slot` onto the track at a lap distance (console / smoke tests). */
  debugTeleport(lapDistance: number, slot = 0, lateral = 0): void {
    const p = this.session.players[slot];
    if (!p) return;
    const frame = this.track.path.anchorToWorld({ distance: lapDistance, lateral, height: 0.5 });
    p.kart.racer.sim.placeAt(frame.position, frame.tangent);
    p.kart.beforeTick();
    p.kart.interpolate(1);
    p.camera.snap(p.kart.chase);
  }

  /** Back-compat for dev tooling: the active session's players / race. */
  get players(): RaceSession['players'] {
    return this.session.players;
  }

  get race(): RaceSession['race'] {
    return this.session.race;
  }

  private networkLine(): string {
    const race = this.session.race;
    const base = `${race.phase} t=${race.time.toFixed(1)} · items ${race.items.entities.list.length}`;
    const net = this.session.netStats;
    const client = this.online.client;
    if (!net) return `${client?.room ? `online lobby ${client.code} · rtt ${client.rtt.toFixed(0)} ms · ` : 'offline · '}${this.session.config.mode} · ${base}`;
    const lag = client?.lag.delay ? ` (sim +${(client.lag.delay * 2).toFixed(0)} ms)` : '';
    return `online ${client?.code ?? ''} · ${net.status} · rtt ${net.rtt.toFixed(0)} ms${lag}\n  snaps ${net.snapshotsPerSec.toFixed(0)}/s · ${net.kibPerSec.toFixed(1)} KiB/s · unacked ${net.unacked} · corr ${(net.correction * 100).toFixed(1)} cm\n  ${base}`;
  }

  private debugSnapshot(): DebugSnapshot {
    const info = this.renderer.info;
    const path = this.track.path;
    const race = this.session.race;
    return {
      fps: 1000 / this.loop.frameMs,
      frameMs: this.loop.frameMs,
      ticks: this.loop.lastTicks,
      drawCalls: info.calls,
      triangles: info.triangles,
      gamepads: this.input.connectedGamepads().map((g) => `#${g.index} ${g.id.slice(0, 28)} (${g.mapping || 'non-standard'})`),
      network: this.networkLine(),
      players: this.session.players.map((p) => {
        const r = race.racers[p.racerIndex]!;
        const s = r.state;
        const loc = path.locate(s.position, s.trackIndex, 4);
        const i = p.input;
        return {
          label: p.label,
          device: p.source.describe(),
          speed: s.forwardSpeed,
          position: s.position,
          grounded: s.grounded,
          surface: s.surface,
          steer: s.steer,
          trackIndex: s.trackIndex,
          lapDistance: path.lapDistance(loc.splineDistance),
          lateral: loc.lateral,
          input: `thr ${i.throttle.toFixed(2)} brk ${i.brake.toFixed(2)} str ${i.steer.toFixed(2)}${i.drift ? ' DRIFT' : ''}${i.item ? ' ITEM' : ''}`,
          race: `P${r.progress.position} lap ${r.progress.lap} cp ${r.progress.nextCheckpoint} · drift ${s.drifting ? `stage ${s.driftStage} (${s.driftCharge.toFixed(1)}s)` : '-'} · boost ${s.boostTimer.toFixed(1)} · item ${r.slot.item ?? '-'}`,
        };
      }),
    };
  }
}
