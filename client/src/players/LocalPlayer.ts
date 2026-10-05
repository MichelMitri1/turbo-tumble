import { createEmptyInput, type PlayerInput } from '@shared/types/input';
import type { InputSource } from '../input/InputManager';
import type { KartEntity } from '../vehicles/KartEntity';
import type { ChaseCamera } from '../rendering/ChaseCamera';
import type { Hud } from '../ui/Hud';
import type { ViewportRect } from '../rendering/ViewportLayout';

/**
 * A human player on this machine: their device(s), racer, camera, HUD and viewport.
 * `netId` is the racer id (online: `sessionId:seat`, so one client may host several).
 */
export class LocalPlayer {
  readonly input: PlayerInput = createEmptyInput();
  viewport: ViewportRect = { x: 0, y: 0, width: 1, height: 1 };
  /** Seconds since this player finished (results appear after a beat). */
  finishedFor = 0;
  resultsShown = false;
  /** Online: a reset (R / View) waiting to be sent with the next input. */
  resetRequested = false;

  constructor(
    readonly slot: number,
    readonly netId: string,
    readonly racerIndex: number,
    readonly source: InputSource,
    /** Rebound when a race restarts. */
    public kart: KartEntity,
    readonly camera: ChaseCamera,
    readonly hud: Hud,
  ) {}

  takeReset(): boolean {
    const r = this.resetRequested;
    this.resetRequested = false;
    return r;
  }

  get label(): string {
    return `P${this.slot + 1}`;
  }
}
