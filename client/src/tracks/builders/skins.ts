import type { KitId } from '../kits';

/** Kits each theme's obstacle skins (hazards, movers) draw from. */
export const THEME_KITS: Record<string, KitId[]> = {
  marsh: ['graveyard'],
  factory: ['factory'],
  snow: ['holiday'],
  beach: ['pirate'],
  tropical: ['pirate'],
};

/**
 * Kit models dressing the static road obstacles per theme (collision stays the
 * shared cylinder). `tall` lets a model exceed the collision height a little.
 */
export const HAZARD_SKINS: Record<string, Array<{ kit: KitId; name: string; tall?: number }>> = {
  marsh: [{ kit: 'graveyard', name: 'gravestone-cross', tall: 1.3 }, { kit: 'graveyard', name: 'pumpkin-carved' }],
  factory: [{ kit: 'factory', name: 'box-large' }, { kit: 'factory', name: 'box-small' }],
  snow: [{ kit: 'holiday', name: 'snowman', tall: 1.5 }],
  beach: [{ kit: 'pirate', name: 'barrel' }, { kit: 'pirate', name: 'crate' }],
  tropical: [{ kit: 'pirate', name: 'barrel' }, { kit: 'pirate', name: 'crate' }],
};
