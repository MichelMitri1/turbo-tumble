import assert from 'node:assert/strict';
import { BattleEngine } from '../client/src/arena/engine.ts';
import { CARDS, CARD_MAP, RESEARCHED_CARD_IDS, getCard } from '../client/src/arena/cards.ts';

assert.equal(CARDS.length, 123, 'researched roster count changed');
assert.equal(CARD_MAP.size, CARDS.length, 'duplicate card ids');
assert.deepEqual([...new Set(RESEARCHED_CARD_IDS)], RESEARCHED_CARD_IDS, 'roster ids must be unique');
for (const card of CARDS) {
  assert(card.cost >= 1 && card.cost <= 9, `${card.name}: invalid elixir`);
  assert(card.mechanics.length > 0, `${card.name}: missing mechanic`);
  assert(card.color && card.accent, `${card.name}: missing visual identity`);
}

const battle = new BattleEngine();
for (let i=0;i<120;i++) battle.step();
assert.equal(battle.phase, 'battle', 'countdown should enter battle');
const before=battle.blue.elixir;
assert(battle.play({type:'play',team:'blue',cardId:'knight',x:5,y:21}), 'valid deployment rejected');
assert.equal(battle.blue.elixir,before-getCard('knight').cost,'elixir not deducted');
assert.equal(battle.blue.hand.length,4,'hand did not cycle');
assert(!battle.play({type:'play',team:'blue',cardId:battle.blue.hand[0]!,x:5,y:8}),'troop entered enemy territory');

battle.blue.elixir=0;
for(let i=0;i<84;i++)battle.step();
assert(battle.blue.elixir>.9&&battle.blue.elixir<1.1,'normal elixir regeneration incorrect');
battle.time=121;battle.blue.elixir=0;
for(let i=0;i<42;i++)battle.step();
assert(battle.blue.elixir>.9&&battle.blue.elixir<1.1,'double elixir regeneration incorrect');
battle.time=181;battle.blue.elixir=0;
for(let i=0;i<28;i++)battle.step();
assert(battle.blue.elixir>.9&&battle.blue.elixir<1.1,'triple elixir regeneration incorrect');

const king=battle.entities.find(e=>e.team==='blue'&&e.towerRole==='king')!;
assert.equal(king.active,false,'king starts active');
battle.red.hand[0]='fireball';battle.red.elixir=10;
assert(battle.play({type:'play',team:'red',cardId:'fireball',x:9,y:27}),'king activation spell rejected');
assert.equal(battle.entities.find(e=>e.id===king.id)?.active,true,'king did not activate after damage');

for (const card of CARDS) {
  const test = new BattleEngine([card.id,'knight','archers','giant','fireball','minions','zap','cannon']);
  for(let i=0;i<120;i++)test.step();
  test.debug.infiniteElixir=true;
  assert(test.play({type:'play',team:'blue',cardId:card.id,x:5,y:card.type==='spell'?10:21}),`${card.name}: debug spawn failed`);
}

console.log(`Arena checks passed: ${CARDS.length} cards, cycling, territory, x1/x2/x3 elixir, king activation, debug spawn.`);
