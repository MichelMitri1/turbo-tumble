/**
 * Crownfall sanity checks (`npm run check:arena`): roster shape, a model per card,
 * cycling, territory, elixir rates, king activation, siege vs towers, and a debug
 * spawn of every card.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { BattleEngine } from '../client/src/arena/engine.ts';
import { CARDS, CARD_MAP, getCard, modelsFor } from '../client/src/arena/cards.ts';

(globalThis as unknown as { localStorage: unknown }).localStorage = { getItem: () => null, setItem: () => undefined };

assert.equal(CARDS.length, 122, 'roster count changed');
assert.equal(new Set(CARDS.map((c) => c.id)).size, CARDS.length, 'duplicate card ids');
const manifest = JSON.parse(readFileSync(new URL('../client/public/assets/arena/models/manifest.json', import.meta.url), 'utf8')) as Record<string, unknown>;
const natureDir = new URL('../client/public/assets/environment/nature/', import.meta.url);
for (const card of CARDS) {
  assert(card.cost >= 1 && card.cost <= 10, `${card.name}: invalid elixir ${card.cost}`);
  for (const k of ['hp', 'damage', 'hitSpeed', 'firstHit', 'range', 'sight', 'radius', 'mass', 'deployTime'] as const) assert(Number.isFinite(card[k]), `${card.name}: ${k} not finite`);
  assert(card.visual?.model, `${card.name}: no model`);
  for (const m of modelsFor([card.id])) {
    const ok = m.startsWith('nature:') ? existsSync(new URL(`${m.slice(7)}.glb`, natureDir)) : m in manifest;
    assert(ok, `${card.name}: missing model ${m}`);
  }
  if (card.type === 'spell') assert(card.spell && Number.isFinite(card.spell.radius) && Number.isFinite(card.spell.damage), `${card.name}: bad spell`);
}
for (const c of CARD_MAP.values()) for (const s of [c.abilities.spawn, c.abilities.deathSpawn, c.spell?.spawn]) if (s) assert(CARD_MAP.has(s.card), `${c.id}: spawns unknown ${s.card}`);

const start = (deck?: string[]) => {
  const b = new BattleEngine(deck ?? ['knight', 'archers', 'giant', 'fireball', 'imps', 'valkyrie', 'goblin-hut', 'zap'], undefined, 1);
  for (let i = 0; i < 120; i++) b.step();
  return b;
};
const battle = start();
assert.equal(battle.phase, 'battle', 'countdown should enter battle');
battle.blue.elixir = 10;
const anyTroop = battle.blue.hand.find((h) => getCard(h).type !== 'spell')!;
assert(battle.play({ team: 'blue', cardId: anyTroop, x: 5, y: 21 }), 'valid deployment rejected');
assert.equal(battle.blue.elixir, 10 - getCard(anyTroop).cost, 'elixir not deducted');
assert.equal(battle.blue.hand.length, 4, 'hand did not cycle');
assert(!battle.blue.hand.includes(anyTroop), 'played card still in hand');
const troop = battle.blue.hand.find((h) => getCard(h).type === 'troop' && !getCard(h).abilities.burrow);
if (troop) assert(!battle.play({ team: 'blue', cardId: troop, x: 5, y: 8 }), 'troop entered enemy territory');

const rate = (time: number, ticks: number) => {
  battle.time = time;
  battle.blue.elixir = 0;
  for (let i = 0; i < ticks; i++) battle.step();
  return battle.blue.elixir;
};
assert(Math.abs(rate(10, 84) - 1) < 0.1, 'x1 elixir regeneration incorrect');
assert(Math.abs(rate(121, 42) - 1) < 0.1, 'x2 elixir regeneration incorrect');
battle.phase = 'overtime';
assert(Math.abs(rate(181, 28) - 1) < 0.1, 'x3 elixir regeneration incorrect');

// King activation by a spell on the king.
const k = start();
const king = k.units.find((u) => u.team === 'blue' && u.role === 'king')!;
assert.equal(king.active, false, 'king starts active');
k.red.hand[0] = 'fireball';
k.red.elixir = 10;
assert(k.play({ team: 'red', cardId: 'fireball', x: 9, y: 29.5 }), 'king activation spell rejected');
for (let i = 0; i < 60; i++) k.step();
assert.equal(king.active, true, 'king did not activate after damage');

// Siege at the river reaches the princess tower.
const s = start();
s.blue.hand[0] = 'crossbow-turret';
s.blue.elixir = 10;
assert(s.play({ team: 'blue', cardId: 'crossbow-turret', x: 3.5, y: 17.6 }), 'x-bow rejected');
const tower = s.units.find((u) => u.team === 'red' && u.role === 'left')!;
for (let i = 0; i < 30 * 10; i++) s.step();
assert(tower.hp < tower.maxHp - 300, 'siege never hit the tower');

// Every card can be played (debug spawn) without crashing a few seconds of sim.
for (const c of CARDS) {
  const t = start();
  t.debug.infiniteElixir = true;
  t.blue.hand[0] = c.id;
  if (c.spell?.mirror) t.blue.lastPlayed = 'knight';
  assert(t.play({ team: 'blue', cardId: c.id, x: 5, y: c.type === 'spell' && c.id !== 'sky-drop' ? 10 : 21 }), `${c.name}: debug spawn failed`);
  for (let i = 0; i < 90; i++) t.step();
  for (const u of t.units) assert(Number.isFinite(u.x + u.y + u.hp), `${c.name}: NaN after spawn`);
}

console.log(`Arena checks passed: ${CARDS.length} cards with models, cycling, territory, x1/x2/x3 elixir, king activation, siege, debug spawn.`);
