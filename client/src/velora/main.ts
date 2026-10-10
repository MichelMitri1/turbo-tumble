import './styles.css';
import { assets, type PersonModel } from './assets';
import { physics } from './physics';
import { Game, type SaveData } from './game';
import { buildCity } from './world/city';
import { VeloraNet } from './net/online';

/**
 * Velora — title screen: pick who you play as (or continue), load the city, go.
 */

const app = document.querySelector<HTMLDivElement>('#app')!;
const HEROES: Array<{ model: PersonModel; name: string; tag: string }> = [
  { model: 'hoodie', name: 'Marcus', tag: 'Grew up on Grove St. Wants out — and up.' },
  { model: 'suit', name: 'Victor', tag: 'Retired. Rich. Bored. Very, very bored.' },
  { model: 'worker2', name: 'Dale', tag: 'Runs a "trucking business" out of the port.' },
];

let save: SaveData | null = null;
try {
  save = JSON.parse(localStorage.getItem('velora:save') ?? 'null') as SaveData | null;
} catch {
  save = null;
}

let pick: PersonModel = save?.model ?? 'hoodie';
app.innerHTML = `<div class="v-title">
  <div class="v-title-bg"></div>
  <div class="v-title-inner">
    <h1 class="v-logo">VELORA</h1>
    <p class="v-sub">An open city. Your rules.</p>
    <div class="v-heroes">${HEROES.map((h) => `<button class="v-hero ${h.model === pick ? 'on' : ''}" data-m="${h.model}"><b>${h.name}</b><small>${h.tag}</small></button>`).join('')}</div>
    <div class="v-actions">
      ${save ? `<button class="v-btn" id="cont">Continue <small>$${save.cash.toLocaleString()}</small></button>` : ''}
      <button class="v-btn v-btn--go" id="new">${save ? 'New game' : 'Play'}</button>
    </div>
    <div class="v-online">
      <h3>VELORA ONLINE</h3>
      <small id="v-status">Checking the server…</small>
      <div class="row2"><input id="v-name" maxlength="16" placeholder="Your name"></div>
      <div class="row2"><button class="v-btn v-btn--go" id="v-create">Create Session</button><button class="v-btn" id="v-quick">Quick Join</button></div>
      <div class="row2"><input id="v-code" maxlength="6" placeholder="Session code" style="text-transform:uppercase"><button class="v-btn" id="v-join">Join</button></div>
    </div>
    <div class="v-load"><i></i><span>Loading Velora City…</span></div>
    <div class="v-howto">WASD move · Shift sprint · F steal / exit cars · RMB aim · LMB shoot · Tab weapon wheel · E shops · M map · Esc pause · Controller supported</div>
    <a class="v-back" href="/">← Arcade</a>
  </div>
</div>`;
app.querySelectorAll<HTMLButtonElement>('.v-hero').forEach((b) => {
  b.onclick = () => {
    pick = b.dataset.m as PersonModel;
    app.querySelectorAll('.v-hero').forEach((x) => x.classList.toggle('on', x === b));
  };
});

const bar = app.querySelector('.v-load i') as HTMLElement;
const label = app.querySelector('.v-load span') as HTMLElement;
const ready = (async () => {
  await assets.load((f) => (bar.style.width = `${Math.round(f * 90)}%`));
  const city = buildCity({ ...assets.manifest.kits, fps: assets.fpsBounds });
  await physics.init(city);
  bar.style.width = '100%';
  label.textContent = 'Ready';
})();

async function go(useSave: boolean, net: VeloraNet | null = null): Promise<void> {
  label.textContent = 'Loading Velora City…';
  await ready;
  if (!useSave) {
    try {
      localStorage.removeItem('velora:save');
    } catch {
      /* storage optional */
    }
  }
  app.innerHTML = '';
  const game = new Game(app, pick, useSave ? save : null, net);
  (window as unknown as { __velora: Game }).__velora = game;
  if (net) game.goOnline();
  game.start();
}
(app.querySelector('#new') as HTMLElement).onclick = () => void go(false);
app.querySelector('#cont')?.addEventListener('click', () => void go(true));

// ---------------------------------------------------------------- online
const nameIn = app.querySelector('#v-name') as HTMLInputElement;
const codeIn = app.querySelector('#v-code') as HTMLInputElement;
const status = app.querySelector('#v-status') as HTMLElement;
try {
  nameIn.value = localStorage.getItem('velora:name') ?? '';
} catch {
  /* storage optional */
}
const playerName = () => {
  const n = nameIn.value.trim().slice(0, 16) || `Player${Math.floor(100 + Math.random() * 900)}`;
  try {
    localStorage.setItem('velora:name', n);
  } catch {
    /* storage optional */
  }
  return n;
};
async function online(how: (n: VeloraNet) => Promise<unknown>): Promise<void> {
  const net = new VeloraNet();
  status.textContent = 'Connecting…';
  try {
    await how(net);
    status.textContent = `Joined session ${net.welcome?.code ?? ''}`;
    await go(!!save, net);
  } catch (e) {
    status.textContent = e instanceof Error ? e.message : 'Could not connect.';
  }
}
(app.querySelector('#v-create') as HTMLElement).onclick = () => void online((n) => n.create(playerName(), pick));
(app.querySelector('#v-quick') as HTMLElement).onclick = () => void online((n) => n.quick(playerName(), pick));
(app.querySelector('#v-join') as HTMLElement).onclick = () => void online((n) => n.join(codeIn.value, playerName(), pick));
void new VeloraNet().probe().then((p) => {
  status.textContent = p.ok ? (p.lan?.length ? `LAN server ready — friends open http://${p.lan[0]}:2567/velora/` : 'Server ready: create a session and share the code, or quick join.') : 'The game server is offline — start it to play online or on LAN.';
});
// ?join=CODE links straight into a session.
const qs = new URLSearchParams(location.search);
if (qs.get('join')) {
  codeIn.value = qs.get('join')!;
}
