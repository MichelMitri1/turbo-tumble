import './ui/styles.css';
import { touchDevice } from './input/TouchControls';
import { Game, type GameOptions } from './game/Game';
import { DEFAULT_GRAPHICS } from './config/graphics';
import { LoadingScreen } from './ui/LoadingScreen';
import { installFullscreenKey } from './ui/fullscreen';
import type { DeviceAssignment } from './input/InputManager';
import type { GameMode, SessionConfig } from './game/SessionConfig';
import type { Difficulty } from '@shared/ai/AIDifficulty';
import type { SpeedClass } from '@shared/race/SpeedClass';

/**
 * Without parameters the game opens on the main menu. Dev links jump straight in:
 *   ?mode=race|grandprix|timetrial   ?cpu=easy|normal|hard   ?laps=3   ?items=0   ?racers=8
 *   ?char=pip  ?kart=lagoon  ?players=2..4 (P1 WASD, P2 arrows, P3/P4 pads)  ?split=vertical  ?lowgfx
 *   ?cc=50|100|150|200  ?mirror  ?intro=0 (skip the flyover)  ?debug (pause-menu debug overlay)
 */
function optionsFromUrl(): GameOptions {
  const q = new URLSearchParams(location.search);
  const graphics = { ...DEFAULT_GRAPHICS };
  if (touchDevice()) Object.assign(graphics, { shadowMapSize: 1024, maxPixelRatio: 1.25, decorDensity: 0.6, antialias: false });
  if (q.has('lowgfx')) Object.assign(graphics, { shadowMapSize: 1024, maxPixelRatio: 1, decorDensity: 0.5, antialias: false });
  const trackId = q.get('track') ?? 'sunny-circuit';

  let initialSession: SessionConfig | null = null;
  if (q.has('mode') || q.has('players')) {
    const count = Math.min(4, Math.max(1, Number(q.get('players') ?? 1)));
    const chars = ['bix', 'pip', 'zuzu', 'tuko'];
    const karts = ['comet', 'bubblegum', 'sunburst', 'lagoon'];
    const devices: DeviceAssignment[] =
      count === 1
        ? [{ kind: 'any' }]
        : [{ kind: 'keyboard', profile: 'left' }, { kind: 'keyboard', profile: 'right' }, { kind: 'gamepad', index: 0 }, { kind: 'gamepad', index: 1 }];
    initialSession = {
      mode: (q.get('mode') ?? 'race') as GameMode,
      trackId,
      laps: Math.max(1, Number(q.get('laps') ?? 3)),
      items: q.get('items') !== '0',
      difficulty: (q.get('cpu') ?? 'normal') as Difficulty,
      racerCount: Math.min(12, Math.max(1, Number(q.get('racers') ?? 8))),
      split: q.get('split') === 'vertical' ? 'vertical' : 'horizontal',
      speedClass: ([50, 100, 150, 200].includes(Number(q.get('cc'))) ? Number(q.get('cc')) : 150) as SpeedClass,
      mirror: q.has('mirror'),
      players: Array.from({ length: count }, (_, i) => ({
        character: i === 0 ? (q.get('char') ?? chars[0]!) : chars[i]!,
        kart: i === 0 ? (q.get('kart') ?? karts[0]!) : karts[i]!,
        device: devices[i]!,
      })),
    };
  }
  return { trackId, graphics, initialSession };
}

async function boot(): Promise<void> {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  const ui = document.getElementById('ui-root')!;
  const loading = new LoadingScreen(ui);
  try {
    // Fonts are used inside canvas textures (banners, billboards) — wait for them.
    await Promise.race([
      Promise.all([document.fonts.load('900 100px "Lilita One"'), document.fonts.load('900 30px "Nunito"')]),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
    const game = await Game.create(canvas, ui, optionsFromUrl(), (f, label) => loading.progress(f, label));
    (window as unknown as { __game?: Game }).__game = game;
    game.start();
    loading.hide();
    canvas.focus();
  } catch (err) {
    console.error(err);
    loading.error(`Failed to start: ${err instanceof Error ? err.message : String(err)}`);
  }
}

installFullscreenKey();
void boot();
