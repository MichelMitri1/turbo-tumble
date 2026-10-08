import type { Difficulty } from '@shared/ai/AIDifficulty';
import type { RacerSetup } from '@shared/race/RaceSimulation';
import type { SpeedClass } from '@shared/race/SpeedClass';
import { MAX_RACERS } from '@shared/constants/simulation';
import { cpuField, humanSetup } from '@shared/roster/Roster';
import type { DeviceAssignment } from '../input/InputManager';
import type { TwoPlayerSplit } from '../rendering/ViewportLayout';
import { getCharacter } from '../config/roster';

export type GameMode = 'race' | 'grandprix' | 'timetrial' | 'attract' | 'online';

export interface PlayerSetup {
  character: string;
  kart: string;
  device: DeviceAssignment;
}

export interface SessionConfig {
  mode: GameMode;
  trackId: string;
  laps: number;
  items: boolean;
  difficulty: Difficulty;
  /** Total racers including CPUs (ignored for Time Trial). */
  racerCount: number;
  players: PlayerSetup[];
  /** 2-player split orientation. */
  split: TwoPlayerSplit;
  /** Engine class (50/100/150/200cc), default 150. */
  speedClass?: SpeedClass;
  /** Mirror mode: the whole course is seen (and steered) flipped left↔right. */
  mirror?: boolean;
}

/** Mode-specific rules applied on top of the menu choices. */
export function normalizeSession(cfg: SessionConfig): SessionConfig {
  switch (cfg.mode) {
    case 'timetrial':
      return { ...cfg, items: false, racerCount: cfg.players.length };
    case 'attract':
      return { ...cfg, players: [], laps: 99, items: true, racerCount: 8, speedClass: 150, mirror: false };
    default:
      return cfg;
  }
}

/**
 * The field: CPUs with varied driver/kart combos, humans at the back of the grid.
 * `gridOrder` (racer ids, pole first) reorders the grid — used by Grand Prix.
 */
export function buildRacerSetups(cfg: SessionConfig, gridOrder?: readonly string[]): RacerSetup[] {
  const humans = cfg.players;
  const total = cfg.mode === 'timetrial' ? humans.length : Math.min(MAX_RACERS, Math.max(humans.length, cfg.racerCount));
  const out = cpuField(total - humans.length);
  humans.forEach((h, i) => {
    out.push(humanSetup(`p${i + 1}`, humans.length > 1 ? `P${i + 1} ${getCharacter(h.character).name}` : 'You', h.character, h.kart));
  });
  if (gridOrder) out.sort((a, b) => gridOrder.indexOf(a.id) - gridOrder.indexOf(b.id));
  return out;
}

export function characterColor(characterId: string): string {
  return getCharacter(characterId).color;
}
