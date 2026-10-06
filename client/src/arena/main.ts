import './styles.css';
import { CARDS, AI_DECKS, DEFAULT_DECK, RARITY_COLORS, getCard, modelsFor } from './cards';
import { BattleEngine, type BattleEvent } from './engine';
import { ArenaAI, type AIDifficulty } from './ai';
import { ArenaScene } from './arena3d';
import { ArenaAudio } from './audio';
import { preload } from './assets';
import { hydratePortraits, renderAll } from './portraits';
import { bindFullscreenButton, installFullscreenKey } from '../ui/fullscreen';
import { CrownfallNet } from './net/online';
import { applySnapshot, toServer, type Snapshot } from './net/codec';
import type { CfLobbyView, CfStart } from './net/protocol';
import type { CardDefinition, Vec2 } from './types';

const DECK_KEY = 'crownfall-deck-v2';
const DIFF_KEY = 'crownfall-difficulty';
const SOUND_KEY = 'crownfall-muted';
const TOWER_MODELS = ['p-castle-tower-square-base', 'p-castle-tower-square-mid-windows', 'p-castle-tower-square-top', 'p-castle-tower-hexagon-base', 'p-castle-tower-hexagon-mid', 'p-castle-tower-hexagon-top', 'c-elf', 'c-knight-golden-male', 'p-tower-weapon-cannon'];

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, v: string): void {
    try {
      localStorage.setItem(key, v);
    } catch {
      /* ignore */
    }
  },
};

const root = document.getElementById('game')!;
root.innerHTML = `
<div class="cf-shell">
  <div class="cf-stage" id="stage"></div>
  <div class="cf-topbar">
    <a class="cf-chip-btn" href="/">← Arcade</a>
    <div class="cf-topbar__right">
      <button class="cf-chip-btn" id="sound">♫ Sound</button>
      <button class="cf-chip-btn" id="fullscreen"></button>
    </div>
  </div>

  <section class="cf-menu" id="menu">
    <div class="cf-menu__panel">
      <div class="cf-logo"><span class="cf-display cf-logo__top">CROWNFALL</span><span class="cf-display cf-logo__bottom">ARENA</span></div>
      <p class="cf-tag">Build a deck · command the lanes · take their crowns</p>
      <div class="cf-deckrow" id="deck-preview"></div>
      <div class="cf-avg" id="deck-avg"></div>
      <div class="cf-diff" id="difficulty">
        <button data-diff="easy">Easy</button><button data-diff="normal">Normal</button><button data-diff="hard">Hard</button>
      </div>
      <button class="cf-button cf-button--go" id="battle"><span class="cf-display">BATTLE!</span></button>
      <button class="cf-button cf-button--online" id="open-online">🌐 Online · LAN <small>1v1 vs a friend</small></button>
      <button class="cf-button" id="open-builder">Build Deck <small>${CARDS.length} cards</small></button>
    </div>
  </section>

  <section class="cf-hud hidden" id="hud">
    <div class="cf-hud__top">
      <div class="cf-player red"><div class="cf-player__name cf-display" id="rival-name">RIVAL</div><div class="cf-crowns" id="red-crowns"></div></div>
      <div class="cf-timer"><small id="timer-label">TIME LEFT</small><b class="cf-display" id="timer">3:00</b><em id="mult"></em></div>
    </div>
    <div class="cf-banner" id="banner"></div>
    <div class="cf-count cf-display" id="count"></div>
    <div class="cf-hud__bottom">
      <div class="cf-player blue"><div class="cf-crowns" id="blue-crowns"></div><div class="cf-player__name cf-display">YOU</div></div>
      <div class="cf-hand-panel" id="hand-panel">
        <div class="cf-next"><small>NEXT</small><div id="next"></div></div>
        <div class="cf-hand" id="hand"></div>
        <div class="cf-elixir">
          <div class="cf-elixir__drop cf-display" id="elixir-num">5</div>
          <div class="cf-elixir__bar"><div class="cf-elixir__fill" id="elixir-fill"></div><div class="cf-elixir__ticks">${'<i></i>'.repeat(9)}</div></div>
        </div>
      </div>
    </div>
    <div class="cf-drag hidden" id="drag"></div>
  </section>

  <section class="cf-builder hidden" id="builder">
    <div class="cf-builder__panel">
      <header class="cf-builder__head">
        <h2 class="cf-display">BUILD YOUR DECK</h2>
        <div class="cf-builder__stats"><b id="b-count">8/8</b><span id="b-avg">Avg 0.0</span></div>
        <button class="cf-chip-btn" id="b-random">🎲 Random</button>
        <button class="cf-chip-btn" id="b-close">✕</button>
      </header>
      <div class="cf-deckrow cf-deckrow--slots" id="b-deck"></div>
      <div class="cf-builder__filters">
        <input id="b-search" placeholder="Search cards…" />
        <div class="cf-seg" id="b-type"><button data-v="" class="on">All</button><button data-v="troop">Troops</button><button data-v="building">Buildings</button><button data-v="spell">Spells</button></div>
        <div class="cf-seg" id="b-rarity"><button data-v="" class="on">Any</button><button data-v="Common">Common</button><button data-v="Rare">Rare</button><button data-v="Epic">Epic</button><button data-v="Legendary">Legendary</button><button data-v="Champion">Champion</button></div>
      </div>
      <div class="cf-builder__body">
        <div class="cf-grid" id="b-grid"></div>
        <aside class="cf-info" id="b-info"></aside>
      </div>
      <footer class="cf-builder__foot"><span>Tap a card to add or remove it · 8 cards</span><button class="cf-button cf-button--go" id="b-save"><span class="cf-display">SAVE DECK</span></button></footer>
    </div>
  </section>

  <section class="cf-result hidden" id="result">
    <div class="cf-result__panel">
      <div class="cf-result__crowns" id="r-crowns"></div>
      <h2 class="cf-display" id="r-title">VICTORY!</h2>
      <p id="r-sub"></p>
      <div class="cf-result__btns"><button class="cf-button cf-button--go" id="r-again"><span class="cf-display">REMATCH</span></button><button class="cf-button" id="r-menu">Menu</button></div>
    </div>
  </section>

  <section class="cf-online hidden" id="online">
    <div class="cf-online__panel">
      <h2 class="cf-display" id="o-title">ONLINE</h2>
      <p class="cf-online__sub" id="o-sub">Battle a friend anywhere</p>
      <div class="cf-online__lan hidden" id="o-lan"><small>OTHER LAPTOPS OPEN</small><b id="o-lan-url"></b></div>
      <div id="o-connect">
        <label class="cf-online__field"><small>YOUR NAME</small><input id="o-name" maxlength="16" spellcheck="false" /></label>
        <div class="cf-online__choices">
          <div><button class="cf-button cf-button--go" id="o-create"><span class="cf-display">CREATE ROOM</span></button><p>Private — share the code</p></div>
          <div><button class="cf-button" id="o-quick">Quick match</button><p id="o-quick-blurb">Battle whoever is waiting</p></div>
          <div class="cf-online__join"><input id="o-code" maxlength="4" placeholder="CODE" spellcheck="false" autocapitalize="characters" /><button class="cf-button" id="o-join">Join</button></div>
        </div>
      </div>
      <div class="hidden" id="o-lobby">
        <div class="cf-online__code"><small>ROOM CODE</small><b class="cf-display" id="o-code-big">----</b><button class="cf-chip-btn" id="o-copy">Copy invite link</button></div>
        <div class="cf-online__players" id="o-players"></div>
        <p class="cf-online__wait" id="o-wait">Waiting for an opponent…</p>
      </div>
      <p class="cf-online__status" id="o-status"></p>
      <div class="cf-online__foot"><button class="cf-chip-btn" id="o-back">← Back</button><span id="o-server"></span></div>
    </div>
  </section>

  <section class="cf-loading hidden" id="loading"><div class="cf-display">ENTERING THE ARENA…</div><div class="cf-loading__bar"><i id="load-fill"></i></div></section>
</div>`;

const audio = new ArenaAudio();
audio.setMuted(store.get(SOUND_KEY) === '1');
let deck = BattleEngine.loadDeck();
let difficulty = (store.get(DIFF_KEY) as AIDifficulty) || 'normal';

// ============================================================================ cards UI

function cardHtml(id: string, opts: { mini?: boolean; cost?: number; cls?: string } = {}): string {
  const c = getCard(id);
  const [a, b] = RARITY_COLORS[c.rarity];
  return `<div class="cf-card ${c.rarity.toLowerCase()} ${opts.mini ? 'mini' : ''} ${opts.cls ?? ''}" data-card="${id}" style="--ra:${a};--rb:${b}">
    <img data-portrait="${id}" alt="" draggable="false" />
    <i class="cf-card__cost">${opts.cost ?? c.cost}</i>
    <span class="cf-card__name">${c.name}</span>
  </div>`;
}

function avg(ids: string[]): number {
  return ids.length ? ids.reduce((s, id) => s + getCard(id).cost, 0) / ids.length : 0;
}

function renderMenuDeck(): void {
  $('#deck-preview').innerHTML = deck.map((id) => cardHtml(id, { mini: true })).join('');
  $('#deck-avg').innerHTML = `Average elixir <b>${avg(deck).toFixed(1)}</b>`;
  hydratePortraits($('#deck-preview'));
  for (const b of document.querySelectorAll<HTMLButtonElement>('#difficulty button')) b.classList.toggle('on', b.dataset.diff === difficulty);
}

// ---------------------------------------------------------------- deck builder

const filter = { q: '', type: '', rarity: '' };
let infoCard: string | null = null;

function openBuilder(): void {
  $('#builder').classList.remove('hidden');
  renderBuilder();
}

function renderBuilder(): void {
  const slots = Array.from({ length: 8 }, (_, i) => (deck[i] ? cardHtml(deck[i]!, { mini: true, cls: 'in-deck' }) : `<div class="cf-card empty mini"><span>${i + 1}</span></div>`));
  $('#b-deck').innerHTML = slots.join('');
  $('#b-count').textContent = `${deck.length}/8`;
  $('#b-avg').textContent = `Avg ${avg(deck).toFixed(1)} elixir`;
  ($('#b-save') as HTMLButtonElement).disabled = deck.length !== 8;
  const list = CARDS.filter((c) => (!filter.q || c.name.toLowerCase().includes(filter.q)) && (!filter.type || c.type === filter.type) && (!filter.rarity || c.rarity === filter.rarity)).sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name));
  $('#b-grid').innerHTML = list.map((c) => cardHtml(c.id, { cls: deck.includes(c.id) ? 'chosen' : '' })).join('');
  hydratePortraits($('#builder'));
  renderInfo(infoCard ?? deck[0] ?? 'knight');
}

function renderInfo(id: string): void {
  infoCard = id;
  const c = getCard(id);
  const stat = (k: string, v: string | number) => `<div><small>${k}</small><b>${v}</b></div>`;
  const speed = { none: '—', slow: 'Slow', medium: 'Medium', fast: 'Fast', veryFast: 'Very fast' }[c.speed];
  const targets = { ground: 'Ground', air: 'Air', all: 'Air & ground', buildings: 'Buildings' }[c.targets];
  const stats =
    c.type === 'spell'
      ? [stat('Damage', c.spell!.damage || '—'), stat('Radius', c.spell!.radius), stat('Tower damage', c.spell!.towerDamage ? `${Math.round(c.spell!.towerDamage * 100)}%` : '—'), c.spell!.duration ? stat('Duration', `${c.spell!.duration}s`) : '']
      : [
          stat('Hitpoints', c.hp + (c.abilities.shield ? ` +${c.abilities.shield}🛡` : '')),
          c.damage ? stat('Damage', c.damage) : '',
          c.damage ? stat('Hit speed', `${c.hitSpeed}s`) : '',
          c.type === 'troop' ? stat('Speed', speed) : stat('Lifetime', `${c.lifetime ?? 30}s`),
          c.damage ? stat('Range', c.range <= 1.6 ? 'Melee' : c.range) : '',
          c.damage ? stat('Targets', targets) : '',
          c.count > 1 ? stat('Count', `×${c.count}`) : '',
        ];
  $('#b-info').innerHTML = `${cardHtml(id)}<h3 class="cf-display">${c.name}</h3><p class="cf-info__rar" style="color:${RARITY_COLORS[c.rarity][0]}">${c.rarity} ${c.type}</p><p>${c.blurb}</p><div class="cf-info__stats">${stats.join('')}</div>`;
  hydratePortraits($('#b-info'));
}

function toggleCard(id: string): void {
  const i = deck.indexOf(id);
  if (i >= 0) deck.splice(i, 1);
  else if (deck.length < 8) deck.push(id);
  else {
    audio.error();
    return;
  }
  audio.play();
  renderBuilder();
}

$('#builder').addEventListener('click', (e) => {
  const card = (e.target as HTMLElement).closest<HTMLElement>('.cf-card[data-card]');
  if (!card) return;
  const id = card.dataset.card!;
  if (card.closest('#b-info')) return;
  renderInfo(id);
  toggleCard(id);
});
$('#builder').addEventListener('pointerover', (e) => {
  const card = (e.target as HTMLElement).closest<HTMLElement>('#b-grid .cf-card[data-card]');
  if (card && card.dataset.card !== infoCard) renderInfo(card.dataset.card!);
});
$<HTMLInputElement>('#b-search').addEventListener('input', (e) => {
  filter.q = (e.target as HTMLInputElement).value.toLowerCase();
  renderBuilder();
});
for (const [sel, key] of [['#b-type', 'type'], ['#b-rarity', 'rarity']] as const) {
  $(sel).addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!b) return;
    filter[key] = b.dataset.v ?? '';
    for (const x of $(sel).querySelectorAll('button')) x.classList.toggle('on', x === b);
    renderBuilder();
  });
}
$('#b-random').addEventListener('click', () => {
  const pool = [...CARDS].sort(() => Math.random() - 0.5);
  const pick = (pred: (c: CardDefinition) => boolean, n: number) => pool.filter((c) => pred(c) && !deck.includes(c.id)).slice(0, n).map((c) => c.id);
  deck = [];
  deck.push(...pick((c) => c.type === 'troop' && (c.targets === 'buildings' || c.cost >= 5), 1));
  deck.push(...pick((c) => c.type === 'spell' && (c.spell?.damage ?? 0) > 300, 1));
  deck.push(...pick((c) => c.type === 'spell' && (c.spell?.damage ?? 0) <= 300, 1));
  deck.push(...pick((c) => c.type === 'troop' && c.targets === 'all', 2));
  deck.push(...pick((c) => c.type === 'building' || c.cost <= 3, 3 - 0));
  deck = deck.slice(0, 8);
  while (deck.length < 8) deck.push(...pick(() => true, 8 - deck.length));
  renderBuilder();
});
$('#b-close').addEventListener('click', () => {
  deck = BattleEngine.loadDeck();
  $('#builder').classList.add('hidden');
  renderMenuDeck();
});
$('#b-save').addEventListener('click', () => {
  if (deck.length !== 8) return;
  store.set(DECK_KEY, JSON.stringify(deck));
  $('#builder').classList.add('hidden');
  renderMenuDeck();
});

// ============================================================================ battle

interface Session {
  engine: BattleEngine;
  scene: ArenaScene;
  ais: ArenaAI[];
  attract: boolean;
  /** Online: the connection, whether the board is mirrored, and the last snapshot time. */
  net?: CrownfallNet;
  flip?: boolean;
  snapAt?: number;
  snapElixir?: number;
  battleId?: number;
  opponent?: string;
}
let session: Session | null = null;
let last = performance.now();
let selected: string | null = null;
let dragging = false;
let dragMoved = false;
let pointer: { x: number; y: number } | null = null;
let lastCount = -1;

async function startSession(attract: boolean): Promise<void> {
  const blueDeck = attract ? AI_DECKS[Math.floor(Math.random() * AI_DECKS.length)]! : deck;
  const engine = new BattleEngine(blueDeck);
  if (attract) {
    engine.countdown = 0.1;
  }
  const names = modelsFor([...engine.blue.deck, ...engine.red.deck]);
  if (!attract) {
    $('#loading').classList.remove('hidden');
    const fill = $('#load-fill');
    await preload([...names, ...TOWER_MODELS], (d, t) => (fill.style.width = `${(d / t) * 100}%`));
    $('#loading').classList.add('hidden');
  } else {
    void preload([...TOWER_MODELS, ...names]);
  }
  session?.scene.dispose();
  const scene = new ArenaScene(engine, $('#stage'));
  scene.onEvent = (ev) => onEvent(ev, engine, attract);
  const ais = [new ArenaAI(engine, 'red', attract ? 'normal' : difficulty)];
  if (attract) ais.push(new ArenaAI(engine, 'blue', 'normal'));
  session = { engine, scene, ais, attract };
  lastCount = -1;
  selected = null;
  last = performance.now();
  if (!attract) renderHand();
}

function frame(now: number): void {
  requestAnimationFrame(frame);
  const s = session;
  if (!s) return;
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (s.net) {
    // Online: the server runs the battle; smooth the elixir bar between snapshots.
    const e = s.engine;
    if ((e.phase === 'battle' || e.phase === 'overtime') && s.snapAt) e.blue.elixir = Math.min(10, (s.snapElixir ?? 0) + ((now - s.snapAt) / 1000 / 2.8) * e.multiplier);
  } else {
    s.engine.update(dt);
    for (const ai of s.ais) ai.update(dt * s.engine.debug.speed);
  }
  if (!s.attract) {
    // Bottom hand (portrait): keep the arena above it. Side hand (landscape): full height.
    const hand = $('#hand-panel').getBoundingClientRect();
    const centred = hand.left < innerWidth / 2 && hand.right > innerWidth / 2;
    s.scene.setReserve(centred ? 96 : 12, centred ? innerHeight - hand.top + 6 : 12);
  } else s.scene.setReserve(12, 12);
  s.scene.render();
  if (s.attract) {
    // The menu battle restarts itself.
    if (s.engine.phase === 'ended' && s.engine.units.every((u) => !u.dead || u.kind === 'tower' || u.deadFor > 2)) void startSession(true);
    return;
  }
  if (s.engine.phase === 'battle' || s.engine.phase === 'overtime') audio.tickMusic(dt, s.engine.multiplier > 1 ? 1 : 0);
  updateHud(s.engine);
  updatePlacement();
}

let handKey = '';
function updateHud(e: BattleEngine): void {
  const key = `${e.blue.hand.join()}|${e.blue.next}|${selected}`;
  if (key !== handKey) {
    handKey = key;
    renderHand();
  }
  const left = Math.max(0, e.timeLeft);
  $('#timer').textContent = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
  $('#timer-label').textContent = e.phase === 'overtime' ? 'OVERTIME' : 'TIME LEFT';
  $('#timer').parentElement!.classList.toggle('urgent', left < 30 && e.phase !== 'countdown');
  const m = e.multiplier;
  $('#mult').textContent = m > 1 ? `${m}× ELIXIR` : '';
  const el = e.blue.elixir;
  $('#elixir-num').textContent = String(Math.floor(el));
  $('#elixir-fill').style.width = `${el * 10}%`;
  const crowns = (n: number) => [0, 1, 2].map((i) => `<i class="${i < n ? 'on' : ''}">♛</i>`).join('');
  const bc = crowns(e.blue.crowns);
  const rc = crowns(e.red.crowns);
  if ($('#blue-crowns').innerHTML !== bc) $('#blue-crowns').innerHTML = bc;
  if ($('#red-crowns').innerHTML !== rc) $('#red-crowns').innerHTML = rc;
  for (const c of document.querySelectorAll<HTMLElement>('#hand .cf-card')) {
    const cost = e.costOf('blue', getCard(c.dataset.card!));
    c.classList.toggle('poor', cost > el);
    c.style.setProperty('--charge', `${Math.min(1, el / cost) * 100}%`);
  }
  // Countdown.
  const n = e.phase === 'countdown' ? Math.ceil(e.countdown) : 0;
  if (n !== lastCount) {
    lastCount = n;
    const el2 = $('#count');
    el2.textContent = n > 0 ? String(n) : '';
    el2.classList.remove('pop');
    void el2.offsetWidth;
    if (n > 0) {
      el2.classList.add('pop');
      audio.countdown(n);
    }
  }
}

function renderHand(): void {
  const e = session!.engine;
  $('#hand').innerHTML = e.blue.hand.map((id, i) => cardHtml(id, { cost: e.costOf('blue', getCard(id)), cls: `${id === selected ? 'selected' : ''} slot-${i}` })).join('');
  $('#next').innerHTML = cardHtml(e.blue.next, { mini: true });
  hydratePortraits($('#hud'));
}

function banner(text: string, tone = 'gold'): void {
  const b = $('#banner');
  b.textContent = text;
  b.className = `cf-banner cf-display ${tone}`;
  void b.offsetWidth;
  b.classList.add('show');
}

function onEvent(ev: BattleEvent, e: BattleEngine, attract: boolean): void {
  if (attract) return;
  switch (ev.type) {
    case 'play':
      if (ev.team === 'blue') audio.play();
      break;
    case 'deploy': {
      const c = getCard(ev.card);
      if (c.cost >= 2 || c.type === 'building') audio.deploy(c.cost >= 6);
      break;
    }
    case 'attack': {
      const u = e.unit(ev.unitId);
      if (!u) break;
      if (u.card.projectile || u.kind === 'tower') audio.shoot(u.card.projectile ?? (u.role === 'king' ? 'cannonball' : 'arrow'));
      else audio.melee();
      break;
    }
    case 'splash':
      if (['fireball', 'bomb', 'rocket', 'land', 'firework'].includes(ev.kind)) audio.boom(ev.radius);
      if (ev.kind === 'zap' || ev.kind === 'lightning') audio.zap();
      break;
    case 'zap':
      audio.zap();
      break;
    case 'death':
      if (ev.kind !== 'tower') audio.death();
      break;
    case 'tower':
      audio.tower(ev.team === 'red');
      banner(ev.team === 'blue' ? (ev.role === 'king' ? 'KING DOWN!' : 'CROWN!') : 'TOWER LOST', ev.team === 'blue' ? 'gold' : 'pink');
      break;
    case 'elixir':
      if (ev.team === 'blue') audio.elixir();
      break;
    case 'heal':
      audio.heal();
      break;
    case 'announce':
      if (ev.text === 'VICTORY!' || ev.text === 'DEFEAT' || ev.text === 'DRAW') {
        setTimeout(() => showResult(e), 1800);
        audio.victory(ev.text === 'VICTORY!');
      } else audio.announce();
      banner(ev.text, ev.tone);
      break;
    default:
      break;
  }
}

function showResult(e: BattleEngine): void {
  const win = e.winner === 'blue';
  $('#r-title').textContent = e.winner === 'draw' ? 'DRAW' : win ? 'VICTORY!' : 'DEFEAT';
  $('#r-title').className = `cf-display ${win ? 'gold' : e.winner === 'draw' ? '' : 'pink'}`;
  $('#r-crowns').innerHTML = `<div class="blue">${'<i>♛</i>'.repeat(e.blue.crowns)}${'<i class="off">♛</i>'.repeat(3 - e.blue.crowns)}</div><span>vs</span><div class="red">${'<i>♛</i>'.repeat(e.red.crowns)}${'<i class="off">♛</i>'.repeat(3 - e.red.crowns)}</div>`;
  const clock = `${Math.floor(e.time / 60)}:${String(Math.floor(e.time % 60)).padStart(2, '0')}`;
  const online = session?.net;
  $('#r-sub').textContent = online ? `vs ${session?.opponent ?? 'opponent'} · ${clock} · ${Math.round(e.blue.elixirSpent)} elixir spent` : `${difficulty[0]!.toUpperCase()}${difficulty.slice(1)} rival · ${clock} · ${Math.round(e.blue.elixirSpent)} elixir spent`;
  const again = $<HTMLButtonElement>('#r-again');
  again.disabled = false;
  again.innerHTML = '<span class="cf-display">REMATCH</span>';
  $('#result').classList.remove('hidden');
}

// ---------------------------------------------------------------- input

function tileAt(x: number, y: number): Vec2 | null {
  return session?.scene.screenToTile(x, y) ?? null;
}

function overHand(x: number, y: number): boolean {
  const r = $('#hand-panel').getBoundingClientRect();
  return x > r.left - 8 && x < r.right + 8 && y > r.top - 8 && y < r.bottom + 8;
}

function updatePlacement(): void {
  const s = session;
  if (!s) return;
  const drag = $('#drag');
  if (!selected || !pointer || (dragging && overHand(pointer.x, pointer.y))) {
    s.scene.setPlacement(selected && !dragging ? selected : null, null, false);
    if (dragging && pointer && selected) {
      drag.classList.remove('hidden');
      drag.style.transform = `translate(${pointer.x}px, ${pointer.y}px)`;
    } else drag.classList.add('hidden');
    return;
  }
  drag.classList.add('hidden');
  const t = tileAt(pointer.x, pointer.y);
  if (!t) return;
  const snapped = { x: Math.round(t.x * 2) / 2, y: Math.round(t.y * 2) / 2 };
  s.scene.setPlacement(selected, snapped, s.engine.canPlay('blue', selected, snapped.x, snapped.y));
}

function tryPlay(x: number, y: number): boolean {
  const s = session;
  if (!s || !selected) return false;
  const t = tileAt(x, y);
  if (!t) return false;
  const snapped = { x: Math.round(t.x * 2) / 2, y: Math.round(t.y * 2) / 2 };
  if (s.net && s.engine.canPlay('blue', selected, snapped.x, snapped.y)) {
    const at = toServer(snapped.x, snapped.y, Boolean(s.flip));
    s.net.play(selected, at.x, at.y);
    // Optimistic: spend the elixir and cycle the card now; the next snapshot confirms (or corrects) it.
    const e = s.engine;
    const cost = e.costOf('blue', getCard(selected));
    s.snapElixir = Math.max(0, (s.snapElixir ?? e.blue.elixir) - cost);
    e.blue.elixir = Math.max(0, e.blue.elixir - cost);
    const slot = e.blue.hand.indexOf(selected);
    if (slot >= 0) {
      e.blue.hand = [...e.blue.hand];
      e.blue.hand[slot] = e.blue.next;
    }
    // Instant feedback while the server confirms.
    const w = { x: snapped.x - 9, z: snapped.y - 16 };
    s.scene.rings.add(w.x, w.z, 0.2, 1.4, '#8fd0ff', 0.4);
    audio.play();
    selected = null;
    s.scene.setPlacement(null, null, false);
    return true;
  }
  if (!s.net && s.engine.play({ team: 'blue', cardId: selected, x: snapped.x, y: snapped.y })) {
    selected = null;
    s.scene.setPlacement(null, null, false);
    renderHand();
    return true;
  }
  audio.error();
  const card = document.querySelector<HTMLElement>(`#hand .cf-card[data-card="${selected}"]`);
  card?.classList.remove('nope');
  void card?.offsetWidth;
  card?.classList.add('nope');
  return false;
}

$('#hand').addEventListener('pointerdown', (e) => {
  const card = (e.target as HTMLElement).closest<HTMLElement>('.cf-card');
  if (!card || !session || session.attract) return;
  e.preventDefault();
  const id = card.dataset.card!;
  const wasSelected = selected === id;
  selected = id;
  dragging = true;
  dragMoved = false;
  pointer = { x: e.clientX, y: e.clientY };
  $('#drag').innerHTML = cardHtml(id);
  hydratePortraits($('#drag'));
  for (const c of document.querySelectorAll('#hand .cf-card')) c.classList.toggle('selected', (c as HTMLElement).dataset.card === id);
  if (wasSelected) card.dataset.reselect = '1';
});
addEventListener('pointermove', (e) => {
  pointer = { x: e.clientX, y: e.clientY };
  if (dragging) dragMoved = true;
});
addEventListener('pointerup', (e) => {
  if (!session || session.attract) return;
  if (dragging) {
    dragging = false;
    $('#drag').classList.add('hidden');
    if (dragMoved && !overHand(e.clientX, e.clientY)) tryPlay(e.clientX, e.clientY);
    return;
  }
  if (selected && (e.target as HTMLElement).classList.contains('cf-canvas')) tryPlay(e.clientX, e.clientY);
});
addEventListener('keydown', (e) => {
  if (!session || session.attract) return;
  const n = Number(e.key);
  if (n >= 1 && n <= 4) {
    selected = session.engine.blue.hand[n - 1] ?? null;
    renderHand();
  }
  if (e.key === 'Escape') {
    selected = null;
    renderHand();
  }
});

// ---------------------------------------------------------------- menu wiring

async function enterBattle(): Promise<void> {
  if (deck.length !== 8) return openBuilder();
  $('#menu').classList.add('hidden');
  $('#result').classList.add('hidden');
  await startSession(false);
  $('#rival-name').textContent = 'RIVAL';
  $('#hud').classList.remove('hidden');
}

function toMenu(): void {
  if (online.net) {
    void online.net.leave();
    online.net = null;
  }
  $('#rival-name').textContent = 'RIVAL';
  $('#online').classList.add('hidden');
  $('#hud').classList.add('hidden');
  $('#result').classList.add('hidden');
  $('#menu').classList.remove('hidden');
  renderMenuDeck();
  void startSession(true);
}

$('#battle').addEventListener('click', () => void enterBattle());
$('#open-builder').addEventListener('click', openBuilder);
$('#deck-preview').addEventListener('click', openBuilder);
$('#r-again').addEventListener('click', () => {
  if (session?.net) {
    session.net.rematch(deck);
    const b = $<HTMLButtonElement>('#r-again');
    b.disabled = true;
    b.innerHTML = '<span class="cf-display">WAITING…</span>';
    return;
  }
  void enterBattle();
});
$('#r-menu').addEventListener('click', () => {
  void online.net?.leave();
  online.net = null;
  toMenu();
});
$('#difficulty').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!b) return;
  difficulty = b.dataset.diff as AIDifficulty;
  store.set(DIFF_KEY, difficulty);
  renderMenuDeck();
});
const soundBtn = $('#sound');
const syncSound = () => (soundBtn.textContent = audio.muted ? '🔇 Muted' : '♫ Sound');
soundBtn.addEventListener('click', () => {
  audio.setMuted(!audio.muted);
  store.set(SOUND_KEY, audio.muted ? '1' : '0');
  syncSound();
});
syncSound();
bindFullscreenButton($('#fullscreen'));
installFullscreenKey();

// ============================================================================ online

const NAME_KEY = 'crownfall-name';
const online: { net: CrownfallNet | null; lanUrl: string | null; pendingSnap: Snapshot | null; loading: boolean } = { net: null, lanUrl: null, pendingSnap: null, loading: false };
const oName = $<HTMLInputElement>('#o-name');
oName.value = store.get(NAME_KEY) || `Player${Math.floor(100 + Math.random() * 900)}`;
oName.addEventListener('change', () => store.set(NAME_KEY, oName.value.trim()));
const oCode = $<HTMLInputElement>('#o-code');
oCode.addEventListener('input', () => (oCode.value = oCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4)));

function oStatus(text: string, error = false): void {
  const el = $('#o-status');
  el.textContent = text;
  el.classList.toggle('error', error);
}

async function openOnline(code = ''): Promise<void> {
  if (deck.length !== 8) return openBuilder();
  $('#menu').classList.add('hidden');
  $('#online').classList.remove('hidden');
  $('#o-connect').classList.remove('hidden');
  $('#o-lobby').classList.add('hidden');
  if (code) oCode.value = code.toUpperCase().slice(0, 4);
  oStatus('');
  const probe = new CrownfallNet();
  $('#o-server').textContent = `Server: ${probe.url.replace(/^wss?:\/\//, '')}`;
  const info = await probe.probe();
  if (!info.ok) oStatus("Can't reach the game server. Run `npm run dev` (or `npm run lan` for home Wi-Fi).", true);
  if (info.lan?.length) {
    const local = /^(localhost|127\.)/.test(location.hostname);
    const ip = local ? info.lan[0] : location.hostname;
    online.lanUrl = `${location.protocol}//${ip}${location.port ? `:${location.port}` : ''}${location.pathname}`;
    $('#o-title').textContent = 'LAN PLAY';
    $('#o-sub').textContent = 'Same Wi-Fi · near-zero lag';
    $('#o-lan-url').textContent = online.lanUrl;
    $('#o-lan').classList.remove('hidden');
    $('#o-quick-blurb').textContent = 'Everyone on this Wi-Fi meets here';
  }
}

async function connect(how: (net: CrownfallNet, name: string) => Promise<void>): Promise<void> {
  if (online.net?.room) return;
  const name = oName.value.trim() || 'Player';
  store.set(NAME_KEY, name);
  oStatus('Connecting…');
  const net = new CrownfallNet();
  try {
    await how(net, name);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    oStatus(/not found/i.test(msg) ? 'No room with that code — check it and try again.' : /locked|full|maxClients/i.test(msg) ? 'That room is full or already battling.' : msg, true);
    return;
  }
  online.net = net;
  oStatus('');
  net.onLobby = renderLobby;
  net.onStart = (st) => void beginOnline(net, st);
  net.onSnap = (snap) => onSnap(net, snap);
  net.onNope = () => audio.error();
  net.onStatus = (st, reason) => {
    if (st === 'reconnecting') banner('RECONNECTING…', 'cyan');
    if (st === 'closed' && online.net === net) {
      online.net = null;
      if (session?.net === net && session.engine.phase !== 'ended') {
        banner('DISCONNECTED', 'pink');
        setTimeout(toMenu, 1500);
      } else if (!$('#online').classList.contains('hidden')) {
        oStatus(reason ?? 'Disconnected.', true);
        $('#o-connect').classList.remove('hidden');
        $('#o-lobby').classList.add('hidden');
      }
    }
  };
  $('#o-connect').classList.add('hidden');
  $('#o-lobby').classList.remove('hidden');
  $('#o-code-big').textContent = net.code;
  if (net.lobby) renderLobby(net.lobby);
}

function renderLobby(v: CfLobbyView): void {
  $('#o-code-big').textContent = v.code;
  const me = online.net?.sessionId;
  $('#o-players').innerHTML = [0, 1]
    .map((i) => {
      const p = v.players[i];
      if (!p) return '<div class="cf-online__player empty">Waiting for a challenger…</div>';
      return `<div class="cf-online__player ${p.sessionId === me ? 'me' : ''}"><b>${p.name}</b>${p.sessionId === me ? '<small>YOU</small>' : ''}${p.connected ? '' : '<small>reconnecting…</small>'}${v.phase === 'ended' && p.rematch ? '<small>ready for a rematch</small>' : ''}</div>`;
    })
    .join('');
  $('#o-wait').textContent = v.players.length < 2 ? 'Waiting for an opponent… share the code!' : v.phase === 'lobby' ? 'Get ready…' : '';
  // In a finished battle: show who wants a rematch / if the opponent left.
  if (session?.net === online.net && session && !$('#result').classList.contains('hidden')) {
    const them = v.players.find((p) => p.sessionId !== me);
    if (!them) $('#r-sub').textContent = 'Your opponent left the room.';
    else if (them.rematch) $('#r-sub').textContent = `${them.name} wants a rematch!`;
  }
}

function inviteUrl(code: string): string {
  return `${online.lanUrl ?? location.origin + location.pathname}?room=${code}`;
}

async function beginOnline(net: CrownfallNet, st: CfStart): Promise<void> {
  const me = st.decks[st.seat];
  const them = st.decks[st.seat === 'blue' ? 'red' : 'blue'];
  const engine = new BattleEngine(me, them);
  online.loading = true;
  online.pendingSnap = null;
  $('#online').classList.add('hidden');
  $('#menu').classList.add('hidden');
  $('#result').classList.add('hidden');
  $('#loading').classList.remove('hidden');
  const fill = $('#load-fill');
  await preload([...modelsFor([...me, ...them]), ...TOWER_MODELS], (d, t) => (fill.style.width = `${(d / t) * 100}%`));
  // Wait for the first snapshot so towers and ids come from the server.
  for (let i = 0; i < 100 && !online.pendingSnap; i++) await new Promise((r) => setTimeout(r, 50));
  $('#loading').classList.add('hidden');
  if (online.net !== net) return toMenu();
  const flip = st.seat === 'red';
  if (online.pendingSnap) applySnapshot(engine, online.pendingSnap, flip);
  engine.events.length = 0;
  session?.scene.dispose();
  const scene = new ArenaScene(engine, $('#stage'));
  scene.onEvent = (ev) => onEvent(ev, engine, false);
  const opponent = flip ? st.names.blue : st.names.red;
  session = { engine, scene, ais: [], attract: false, net, flip, battleId: st.battleId, snapAt: performance.now(), snapElixir: engine.blue.elixir, opponent };
  online.loading = false;
  lastCount = -1;
  selected = null;
  handKey = '';
  $('#rival-name').textContent = opponent.toUpperCase();
  $('#hud').classList.remove('hidden');
  renderHand();
}

function onSnap(net: CrownfallNet, snap: Snapshot): void {
  const s = session;
  if (online.loading || !s || s.net !== net) {
    online.pendingSnap = snap;
    return;
  }
  const events = applySnapshot(s.engine, snap, Boolean(s.flip));
  s.engine.events.push(...events);
  s.snapAt = performance.now();
  s.snapElixir = s.engine.blue.elixir;
}

$('#open-online').addEventListener('click', () => void openOnline());
$('#o-create').addEventListener('click', () => void connect((net, name) => net.create(name, deck)));
$('#o-quick').addEventListener('click', () => void connect((net, name) => net.quickMatch(name, deck)));
$('#o-join').addEventListener('click', () => {
  if (oCode.value.length < 4) return oStatus('Room codes have 4 characters — ask your friend for theirs.', true);
  void connect((net, name) => net.join(oCode.value, name, deck));
});
oCode.addEventListener('keydown', (e) => e.key === 'Enter' && $('#o-join').click());
$('#o-copy').addEventListener('click', () => {
  const url = inviteUrl(online.net?.code ?? '');
  void navigator.clipboard?.writeText(url).then(
    () => oStatus('Invite link copied — send it to your friend!'),
    () => oStatus(url),
  );
});
$('#o-back').addEventListener('click', () => {
  void online.net?.leave();
  online.net = null;
  $('#online').classList.add('hidden');
  $('#menu').classList.remove('hidden');
});

// Dev hooks: ?debug (fast-forward, infinite elixir) and the portrait baker.
const q = new URLSearchParams(location.search);
(window as unknown as Record<string, unknown>).__arena = {
  get session() {
    return session;
  },
  renderAll: () => renderAll(CARDS.map((c) => c.id)),
  /** Dev: drop any card for either side, ignoring hand/elixir. */
  spawn(cardId: string, team: 'blue' | 'red', x: number, y: number) {
    const e = session?.engine;
    if (!e) return false;
    const p = e.player(team);
    p.hand[0] = cardId;
    p.elixir = 10;
    return e.play({ team, cardId, x, y });
  },
  cards: CARDS.map((c) => c.id),
};
if (q.has('debug')) addEventListener('keydown', (e) => {
  if (!session) return;
  if (e.key === 'i') session.engine.debug.infiniteElixir = !session.engine.debug.infiniteElixir;
  if (e.key === 'f') session.engine.debug.speed = session.engine.debug.speed === 1 ? 4 : 1;
});

renderMenuDeck();
void startSession(true);
requestAnimationFrame(frame);
if (q.has('battle')) void enterBattle();
if (q.get('room')) void openOnline(q.get('room')!);
console.info(`Crownfall: ${CARDS.length} cards`, DEFAULT_DECK.length);
