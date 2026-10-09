import { Group, PerspectiveCamera, Scene } from 'three';
import type { PhysicsWorld } from '@shared/physics/PhysicsWorld';
import { initPhysics } from '@shared/physics/PhysicsWorld';
import { getCup } from '@shared/tracks/cups';
import { GrandPrixState } from '@shared/race/GrandPrix';
import { AssetLoader } from '../assets/AssetLoader';
import type { GraphicsSettings } from '../config/graphics';
import { CHARACTERS, KART_BODIES, getCharacter } from '../config/roster';
import { GameLoop } from '../core/GameLoop';
import { InputManager } from '../input/InputManager';
import { setTextureAnisotropy } from '../rendering/ProceduralTextures';
import { Renderer } from '../rendering/Renderer';
import type { TrackRuntime } from '../tracks/TrackBuilder';
import { LoadingScreen } from '../ui/LoadingScreen';
import { World } from './World';
import { GarageScreen } from '../ui/GarageScreen';
import { getTrack } from '@shared/tracks/registry';
import { DebugOverlay, type DebugSnapshot } from '../ui/DebugOverlay';
import { GrandPrixPanel, type GpRow } from '../ui/GrandPrixPanel';
import { MainMenu, type MenuChoice } from '../ui/MainMenu';
import { JoinScreen } from '../ui/JoinScreen';
import { ControlsPanel } from '../ui/ControlsPanel';
import { PauseMenu } from '../ui/PauseMenu';
import { renderItemIcons } from '../items/IconStudio';
import { MODEL_KEYS, createItemModel } from '../items/ItemModels';
import { buildKartRig } from '../vehicles/KartModelFactory';
import { KartView } from '../vehicles/KartView';
import { Effects } from '../vfx/Effects';
import { RaceSession, type OnlineRace, type SessionDeps } from './RaceSession';
import { buildRacerSetups, normalizeSession, type PlayerSetup, type SessionConfig } from './SessionConfig';
import { OnlineFlow } from './OnlineFlow';
import { Podium } from './Podium';
import { GP_POINTS } from '@shared/race/GrandPrix';
import { GameAudio } from '../audio/GameAudio';
import { el } from '../ui/dom';

export interface GameOptions {
  trackId: string;
  graphics: GraphicsSettings;
  /** Start straight into a session (dev links); otherwise show the main menu. */
  initialSession: SessionConfig | null;
}

export type LoadProgress = (fraction: number, label: string) => void;

type Flow = 'menu' | 'racing' | 'gp-standings' | 'gp-final' | 'race-podium' | 'online';

/**
 * Top-level app: renderer, physics, track and loop. Runs one RaceSession at a
 * time (attract mode behind the menu, or a player race) and the mode flow
 * between races (Single Race, Grand Prix, Time Trial).
 */
export class Game {
  readonly scene = new Scene();
  readonly input = new InputManager();
  readonly assets = new AssetLoader();
  readonly audio = new GameAudio();
  private soundHint!: HTMLElement;
  readonly renderer: Renderer;
  session!: RaceSession;
  /** HUD icons rendered from the item models (public for dev tooling). */
  icons: Record<string, string> = {};
  private world!: World;
  /** Bumps when a track load supersedes an older one. */
  private loadToken = 0;
  private fx!: Effects;
  private debug!: DebugOverlay;
  private pause!: PauseMenu;
  private menu!: MainMenu;
  private join!: JoinScreen;
  private controls!: ControlsPanel;
  private online!: OnlineFlow;
  private garage!: GarageScreen;
  private lastChoice: MenuChoice | null = null;
  private pendingChoice: MenuChoice | null = null;
  private gpPanel!: GrandPrixPanel;
  private podium!: Podium;
  private gp: GrandPrixState | null = null;
  /** Grid order the current Grand Prix race started with (kept for restarts). */
  private gpGrid: readonly string[] | undefined;
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

  private get track(): TrackRuntime {
    return this.world.track;
  }

  get physics(): PhysicsWorld {
    return this.world.physics!;
  }

  private async load(onProgress: LoadProgress): Promise<void> {
    // The whole roster (menus can pick any combination).
    const kartModels = new Set<string>([...CHARACTERS.map((c) => c.model), ...KART_BODIES.map((k) => k.model)]);
    await this.assets.loadModels(kartModels, (d, t) => onProgress(0.05 * (d / Math.max(1, t)), 'Fuelling karts'));

    this.world = new World(this.scene, this.renderer, this.assets, this.options.graphics);
    await this.world.load(this.options.trackId, (f, label) => onProgress(0.05 + f * 0.85, label));

    onProgress(0.93, 'Stocking item boxes');
    this.icons = renderItemIcons();
    this.fx = new Effects();
    this.scene.add(this.fx.root);
    onProgress(0.96, 'Polishing paintwork');
    await this.warmup();

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
      (kart) => this.audio.previewEngine(kart),
    );
    this.join = new JoinScreen(this.ui, this.input, (players) => {
      const choice = this.pendingChoice;
      this.pendingChoice = null;
      if (!players || !choice) this.menu.setOpen(true);
      else this.launch(choice, players);
    }, (name) => this.audio.ui(name), (kart) => this.audio.previewEngine(kart));
    this.garage = new GarageScreen(this.ui, this.assets, (kart) => this.audio.previewEngine(kart));
    this.controls = new ControlsPanel(this.ui, this.input, this.audio.engine, () => this.menu.setOpen(true));
    this.gpPanel = new GrandPrixPanel(this.ui, () => this.advance());
    this.podium = new Podium(this.assets);
    this.online = new OnlineFlow(this.ui, {
      startRace: (race, players) => this.startOnlineRace(race, players),
      showLobbyBackdrop: () => this.showOnlineBackdrop(),
      exitToMenu: () => this.showMenu(),
      inRace: () => this.flow === 'online',
    });
    window.addEventListener('resize', () => this.layout());
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F5') {
        e.preventDefault();
        this.world.toggleRacingLine();
      }
    });
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
    this.primeFirstFrame();
    onProgress(1, 'Ready!');
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
    if (cfg.mode === 'grandprix' && !this.gp) this.gp = new GrandPrixState(getCup(this.lastChoice?.cupId ?? 'sunny-cup'), buildRacerSetups(cfg).map((s) => s.id));
    if (cfg.mode === 'grandprix' && this.gp) {
      this.gp.beginRace();
      this.gpGrid = gridOrder;
    }
    this.session?.dispose();
    this.session = new RaceSession(this.deps(), cfg, buildRacerSetups(cfg, gridOrder), this.seed++);
    this.renderer.setMirror(cfg.mirror ?? false);
    if (cfg.mode !== 'attract') {
      this.lastConfig = cfg;
      this.flow = 'racing';
      this.menu.setOpen(false);
    }
    this.gpPanel.hide();
    this.podium.hide();
    this.ui.classList.remove('tt-podium-on');
    if (this.pause.open) this.setPaused(false);
    this.layout();
  }

  private showMenu(): void {
    this.gp = null;
    this.pause.setOnline(false);
    this.flow = 'menu';
    this.startSession({ mode: 'attract', trackId: this.world.trackId!, laps: 99, items: true, difficulty: 'hard', racerCount: 8, players: [], split: 'horizontal' });
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
    // Single player: pick racer + kart in the garage.
    this.menu.setOpen(false);
    this.garage.show(choice.character, choice.kart, (pick) => {
      if (!pick) {
        this.menu.setOpen(true);
        return;
      }
      this.menu.setRacer(pick.character, pick.kart);
      const picked = { ...choice, ...pick };
      this.lastChoice = picked;
      this.launch(picked, [{ character: pick.character, kart: pick.kart, device: { kind: 'any' } }]);
    });
  }

  // ---------------------------------------------------------------- tracks

  private loading: Promise<void> = Promise.resolve();

  /**
   * Make `trackId` the loaded track: stops the loop, frees the current race,
   * shows a loading screen while the track builds. Loads are queued.
   */
  private ensureTrack(trackId: string, ready?: () => void): Promise<void> {
    const job = this.loading.then(async () => {
      if (this.world.trackId === trackId) {
        ready?.();
        return;
      }
      const token = ++this.loadToken;
      this.loop.stop();
      this.session?.dispose();
      const name = getTrack(trackId).name;
      const screen = new LoadingScreen(this.ui);
      screen.progress(0, `Driving to ${name}…`);
      try {
        await this.world.load(trackId, (f, label) => screen.progress(f, `${name} · ${label}`));
        screen.progress(1, `${name} · Polishing paintwork`);
        await this.warmup();
      } catch (e) {
        screen.hide();
        throw e;
      }
      if (token !== this.loadToken) {
        screen.hide();
        return;
      }
      this.debug.setWorld(this.physics, [this.track.terrainCollider]);
      this.fx.skids.clear();
      // Start the race and draw its first frame while the loading screen still covers it.
      ready?.();
      screen.hide();
      this.loop.start();
    });
    this.loading = job.catch((e) => console.error('[track] load failed', e));
    return job;
  }

  /**
   * Compile every shader a race can need — track, karts, each item model, effect
   * meshes — and draw one frame, all behind the loading screen. Without this the
   * first countdown frame and each first-seen item stall on shader compiles.
   */
  private async warmup(): Promise<void> {
    const path = this.track.path;
    const cam = new PerspectiveCamera(60, this.renderer.size.width / this.renderer.size.height, 0.3, 2400);
    const from = path.frameAtSplineDistance(path.startDistance - 14);
    cam.position.copy(from.position).addScaledVector(from.up, 5);
    cam.lookAt(path.frameAtSplineDistance(path.startDistance + 6).position);
    cam.updateMatrixWorld();
    const temp = new Group();
    const ahead = cam.getWorldDirection(from.tangent.clone());
    temp.position.copy(cam.position).addScaledVector(ahead, 14);
    temp.quaternion.copy(cam.quaternion);
    MODEL_KEYS.forEach((key, i) => {
      const o = createItemModel(key);
      o.position.set(((i % 8) - 3.5) * 1.6, Math.floor(i / 8) * 1.6 - 2, 0);
      temp.add(o);
    });
    const kart = new KartView(buildKartRig(this.assets, KART_BODIES[0]!, CHARACTERS[0]!));
    kart.root.position.set(0, -4, -2);
    kart.warmupLooks();
    temp.add(kart.root);
    this.fx.warmup();
    this.scene.add(temp);
    try {
      await this.renderer.gl.compileAsync(this.scene, cam);
    } catch (e) {
      console.warn('[warmup] compileAsync failed', e);
    }
    this.world.lighting.fit([temp.position]);
    this.renderer.render(this.scene, [{ camera: cam, rect: { x: 0, y: 0, width: 1, height: 1 } }]);
    this.scene.remove(temp);
    kart.dispose();
  }

  /** Load the session's track if needed, then start it. */
  private async startOn(cfg: SessionConfig, gridOrder?: readonly string[]): Promise<void> {
    await this.ensureTrack(cfg.trackId, () => {
      this.startSession(cfg, gridOrder);
      this.primeFirstFrame();
    });
  }

  /**
   * Draw the session's first frame now (new karts' textures, name tags, shadow
   * casters…) so that cost lands behind the loading screen, not on the countdown.
   */
  private primeFirstFrame(): void {
    this.session.render(1, 0);
    this.world.lighting.fit(this.session.focusPoints());
    this.renderer.render(this.scene, this.session.views);
  }

  private launch(choice: MenuChoice, players: SessionConfig['players']): void {
    if (choice.mode === 'online') {
      this.menu.setOpen(false);
      this.online.open(players, { trackId: choice.trackId, laps: choice.laps, items: choice.items, difficulty: choice.difficulty, racerCount: choice.racers });
      return;
    }
    const cfg: SessionConfig = {
      mode: choice.mode,
      trackId: choice.trackId,
      laps: choice.laps,
      items: choice.items,
      difficulty: choice.difficulty,
      racerCount: choice.racers,
      players,
      split: choice.split,
      speedClass: choice.speedClass,
      mirror: choice.mirror,
    };
    if (choice.mode === 'grandprix') {
      cfg.laps = 3;
      const cup = getCup(choice.cupId);
      const ids = buildRacerSetups(normalizeSession(cfg)).map((s) => s.id);
      this.gp = new GrandPrixState(cup, ids);
      cfg.trackId = this.gp.trackId;
    }
    this.menu.setOpen(false);
    void this.startOn(cfg);
  }

  // ---------------------------------------------------------------- online

  private async startOnlineRace(race: OnlineRace, players: PlayerSetup[]): Promise<void> {
    const s = race.start.settings;
    // The countdown is long enough to build the track if it's a new one.
    await this.ensureTrack(s.trackId, () => {
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
      this.renderer.setMirror(false);
      this.flow = 'online';
      this.menu.setOpen(false);
      this.gpPanel.hide();
      this.podium.hide();
      this.ui.classList.remove('tt-podium-on');
      this.pause.setOnline(true);
      if (this.pause.open) this.setPaused(false);
      this.layout();
      this.primeFirstFrame();
    });
  }

  /** Between online races: the attract race runs behind the lobby. */
  private showOnlineBackdrop(): void {
    if (this.pause.open) this.setPaused(false);
    this.pause.setOnline(false);
    this.flow = 'menu';
    this.startSession({ mode: 'attract', trackId: this.world.trackId!, laps: 99, items: true, difficulty: 'hard', racerCount: 8, players: [], split: 'horizontal' });
    this.audio.menuMusic();
  }

  private restart(): void {
    if (!this.lastConfig || this.flow === 'online') return;
    if (this.gp) {
      // Restart only this track, on the same grid, without the points of the abandoned run.
      this.gp.rollback();
      void this.startOn({ ...this.lastConfig, trackId: this.gp.trackId }, this.gpGrid);
      return;
    }
    this.startSession(this.lastConfig);
  }

  /** The 3D trophy ceremony for these racer ids (1st, 2nd, 3rd). */
  private showPodium(ids: readonly string[]): void {
    const racers = new Map(this.session.race.racers.map((r) => [r.id, r]));
    const top = ids.slice(0, 3).flatMap((id) => {
      const r = racers.get(id);
      return r ? [{ characterId: r.characterId, kartId: r.kartId }] : [];
    });
    this.renderer.setMirror(false);
    this.podium.show(top);
    this.ui.classList.add('tt-podium-on');
    this.audio.sfx.play('crowdCheer', { intensity: 1 });
  }

  /** Enter/Ⓐ after the results screen. */
  private advance(): void {
    const cfg = this.lastConfig!;
    if (cfg.mode !== 'grandprix' || !this.gp) {
      // Single race: a human on the podium gets the ceremony first.
      const order = this.session.finishingOrder();
      const humanTop3 = order.slice(0, 3).some((id) => id.startsWith('p'));
      if (cfg.mode === 'race' && this.flow === 'racing' && humanTop3) {
        this.flow = 'race-podium';
        this.showPodium(order);
        const racers = new Map(this.session.race.racers.map((r) => [r.id, r]));
        const rows: GpRow[] = order.map((id, i) => {
          const r = racers.get(id)!;
          return { id, name: r.name, color: getCharacter(r.characterId).color, points: GP_POINTS[i] ?? 0, plus: 0, me: !r.isAI };
        });
        this.gpPanel.show(getTrack(cfg.trackId).name, 'Race results · points', rows, 'Enter / Ⓐ — race again · Esc — menu', true);
        return;
      }
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
        this.showPodium(standings.map((e) => e.id));
        this.gpPanel.show(`${gp.cup.name} Results`, best === 1 && cfg.players.length === 1 ? 'Champion!' : `${who} ${ord}`, this.gpRows(false), 'Enter / Ⓐ — main menu', true);
      } else {
        gp.nextRace();
        this.gpPanel.hide();
        void this.startOn({ ...cfg, trackId: gp.trackId }, gp.standings().map((e) => e.id));
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
    const touchPlay = (this.flow === 'racing' || this.flow === 'online') && !this.paused && !this.garage.open && !this.gpPanel.open && !this.menu.open;
    this.input.touch.setActive(touchPlay && this.input.connectedGamepads().length === 0);
    if (this.renderer.resize()) this.layout();
    const nav = this.input.menuNav();
    this.menuSounds(nav);
    if (this.input.keyboard.wasPressed('KeyM')) this.audio.toggleMute();
    this.soundHint.classList.toggle('is-open', this.audio.engine.available && !this.audio.engine.running && !this.audio.engine.settings.muted);

    if (this.join.open) {
      this.join.update();
    } else if (this.garage.open) {
      this.garage.handle(nav, this.input.keyboard.wasPressed('Escape'));
    } else if (this.online.screen.open) {
      this.online.handle(nav, this.input.keyboard.wasPressed('Escape'));
    } else if (this.controls.open) {
      this.controls.handle(nav);
    } else if (this.menu.open) {
      this.menu.handle(nav);
    } else if (this.gpPanel.open) {
      if (nav.confirm) this.advance();
      else if (this.flow === 'race-podium' && (nav.back || this.input.keyboard.wasPressed('Escape'))) this.showMenu();
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
    const menus = this.garage.open || this.controls.open || this.online.screen.open || this.menu.open || this.gpPanel.open || this.pause.open;
    if (!menus) return;
    if (nav.up || nav.down) this.audio.ui('uiMove');
    else if ((nav.left || nav.right) && !this.join.open) this.audio.ui('uiChange');
    if (nav.confirm) this.audio.ui('uiConfirm');
    else if (nav.back || this.input.keyboard.wasPressed('Escape')) this.audio.ui('uiBack');
  }

  private render(alpha: number, dt: number): void {
    if (this.podium.open) {
      this.podium.render(this.renderer, dt);
      this.debug.update(dt, () => this.debugSnapshot());
      this.input.endFrame();
      return;
    }
    this.session.render(this.loop.paused ? 1 : alpha, dt);
    this.fx.update(dt);
    this.track.update(dt, this.time, this.session.race.time);
    this.world.lighting.fit(this.session.focusPoints());
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
    return `online ${client?.code ?? ''} · ${net.status} · rtt ${net.rtt.toFixed(0)} ms${lag}\n  snaps ${net.snapshotsPerSec.toFixed(0)}/s · ${net.kibPerSec.toFixed(1)} KiB/s · interp ${net.interpMs.toFixed(0)} ms · unacked ${net.unacked} · corr ${(net.correction * 100).toFixed(1)} cm\n  ${base}`;
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
