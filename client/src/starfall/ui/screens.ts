import { COLORS, type Action } from '../sim/game';
import type { SfView } from '../sim/view';
import type { MapDef } from '../sim/maps';
import { bean, beanIcon, deadBody } from '../render/art';
import { ICON } from './icons';
import type { Audio } from '../audio';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const icon = (color: number, dead = false, size = 64, ghost = false) => beanIcon(COLORS[color]![1], COLORS[color]![2], dead, size, ghost);

/** "Shhhhh!" then your role, with the line-up. */
export function reveal(root: HTMLElement, v: SfView, done: () => void): () => void {
  const me = v.players[v.me]!;
  const el = document.createElement('div');
  el.className = 'reveal';
  el.innerHTML = `<h1 class="disp shh">Shhhhh!</h1><img src="${icon(me.color, false, 220)}" style="width:200px">`;
  root.appendChild(el);
  const t = setTimeout(() => {
    const imp = me.impostor;
    const team = imp ? [me, ...v.partners.map((id) => v.players[id]!)] : [me, ...v.players.filter((p) => p.id !== me.id).slice(0, 6)];
    // Me in front, the others fanned out behind.
    const order = team.slice(1).reduce<typeof team>((a, p, i) => (i % 2 ? [p, ...a] : [...a, p]), [me]);
    const n = v.impostors;
    el.innerHTML = `<h1 class="disp ${imp ? 'imp' : 'crew'}">${imp ? 'Impostor' : 'Crewmate'}</h1>
      <p>${imp ? (v.partners.length ? 'Your fellow impostor' + (v.partners.length > 1 ? 's' : '') + ' are in red.' : 'Kill the crew. Don’t get caught.') : `There ${n === 1 ? 'is' : 'are'} <b>${n} Impostor${n === 1 ? '' : 's'}</b> among us`}</p>
      <div class="line">${order.map((p) => `<img class="${p === me ? 'front' : ''}" src="${icon(p.color, false, 160)}">`).join('')}</div>
      <div class="glow" style="background:radial-gradient(ellipse at 50% 100%, ${imp ? '#ff1f1f66' : '#3fd8ff55'}, transparent 70%)"></div>`;
  }, 1800);
  const t2 = setTimeout(() => {
    el.remove();
    done();
  }, 5600);
  return () => {
    clearTimeout(t);
    clearTimeout(t2);
    el.remove();
  };
}

/** "DEAD BODY REPORTED" / "EMERGENCY MEETING". */
export function splash(root: HTMLElement, v: SfView, reason: 'body' | 'button', caller: number, body: number): () => void {
  const el = document.createElement('div');
  el.className = 'splash';
  const c = v.players[caller];
  el.innerHTML =
    reason === 'body'
      ? `<div class="band"><img src="${icon(body, true, 160)}"><h1 class="disp">DEAD BODY REPORTED</h1><img src="${icon(c?.color ?? 0, false, 160)}"></div>`
      : `<div class="band em"><img src="${icon(c?.color ?? 0, false, 160)}"><h1 class="disp">EMERGENCY MEETING!</h1><div style="width:110px">${ICON.emergency}</div></div>`;
  root.appendChild(el);
  const t = setTimeout(() => el.remove(), 2400);
  return () => {
    clearTimeout(t);
    el.remove();
  };
}

/** The victim's view of being killed. */
export function killAnim(root: HTMLElement, killer: number, victim: number): void {
  const el = document.createElement('div');
  el.className = 'killanim';
  el.innerHTML = `<div class="stage"><img src="${icon(killer, false, 200)}" style="transform:scaleX(1)"><img class="victim" src="${icon(victim, false, 200)}" style="transform:scaleX(-1)"></div>`;
  root.appendChild(el);
  setTimeout(() => el.remove(), 1700);
}

/** The voting tablet: discuss, vote, see the results; chat on the side. */
export class MeetingUI {
  readonly el: HTMLDivElement;
  private cards: HTMLElement;
  private timer: HTMLElement;
  private title: HTMLElement;
  private chatEl: HTMLElement;
  private log: HTMLElement;
  private dot: HTMLElement;
  private pick: number | null = null;
  private key = '';
  private chatN = 0;
  private chatOpen = false;

  constructor(root: HTMLElement, private me: number, private act: (a: Action) => void, private audio: Audio) {
    this.el = document.createElement('div');
    this.el.className = 'ov';
    this.el.innerHTML = `<div class="tablet">
      <h2 class="disp">Who Is The Impostor?</h2>
      <button class="iconbtn chatbtn">${ICON.chat}<i class="hidden"></i></button>
      <div class="cards"></div>
      <div class="bottom"><div class="skip"></div><span class="timer"></span></div>
      <div class="chat hidden"><div class="log"></div><form><input maxlength="120" placeholder="Type here…" autocomplete="off"><button>Send</button></form></div>
    </div>`;
    root.appendChild(this.el);
    const $ = (s: string) => this.el.querySelector(s) as HTMLElement;
    this.cards = $('.cards');
    this.timer = $('.timer');
    this.title = $('h2');
    this.chatEl = $('.chat');
    this.log = $('.log');
    this.dot = $('.chatbtn i');
    $('.chatbtn').onclick = () => this.toggleChat();
    const input = $('input') as HTMLInputElement;
    $('form').onsubmit = (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (text) this.act({ k: 'chat', text });
      input.value = '';
    };
    input.addEventListener('keydown', (e) => e.stopPropagation());
  }

  toggleChat(force?: boolean): void {
    this.chatOpen = force ?? !this.chatOpen;
    this.chatEl.classList.toggle('hidden', !this.chatOpen);
    if (this.chatOpen) {
      this.dot.classList.add('hidden');
      (this.chatEl.querySelector('input') as HTMLInputElement).focus();
    }
  }
  get chatting(): boolean {
    return this.chatOpen;
  }

  update(v: SfView): void {
    const m = v.meeting;
    if (!m) return;
    const me = v.players[this.me]!;
    const canVote = m.stage === 'vote' && me.alive && !m.voted.includes(this.me);
    this.title.textContent = m.stage === 'results' ? 'Voting Results' : 'Who Is The Impostor?';
    this.timer.textContent = m.stage === 'discuss' ? `Voting Begins In: ${Math.ceil(m.t)}s` : m.stage === 'vote' ? `Voting Ends In: ${Math.ceil(m.t)}s` : `Proceeding In: ${Math.ceil(m.t)}s`;
    // Chat.
    for (; this.chatN < m.chat.length; this.chatN++) {
      const c = m.chat[this.chatN]!;
      const p = v.players[c.id]!;
      const row = document.createElement('div');
      row.className = `msg ${c.ghost ? 'ghost' : ''} ${c.id === this.me ? 'mine' : ''}`;
      row.innerHTML = `<img src="${icon(p.color, false, 48, c.ghost)}"><div><b style="color:${COLORS[p.color]![2]}">${esc(p.name)}</b>${esc(c.text)}</div>`;
      this.log.appendChild(row);
      this.log.scrollTop = this.log.scrollHeight;
      if (!this.chatOpen) this.dot.classList.remove('hidden');
      this.audio.play('chat');
    }
    const key = JSON.stringify([m.stage, m.voted, m.votes, this.pick, canVote, v.players.map((p) => p.alive)]);
    if (key === this.key) return;
    this.key = key;
    const votesFor = (id: number) => m.votes.filter(([, t]) => t === id).map(([voter]) => voter);
    const tally = (id: number) => (m.stage === 'results' ? `<div class="tally">${votesFor(id).map((voter) => `<img src="${voter >= 0 ? icon(v.players[voter]!.color, false, 40) : beanIcon('#9aa3ad', '#6b7480', false, 40)}">`).join('')}</div>` : '');
    this.cards.innerHTML = v.players
      .map((p) => {
        const dead = !p.alive;
        const imp = p.impostor && me.impostor;
        const sel = this.pick === p.id && canVote && !dead;
        // A div, not a button: the ✓ / ✕ buttons inside it would otherwise be pushed out of the card.
        return `<div class="card ${dead ? 'dead' : ''} ${p.id === this.me ? 'me' : ''} ${imp ? 'imp' : ''} ${!canVote || dead ? 'off' : ''} ${sel ? 'sel' : ''}" data-id="${p.id}">
          <img class="av" src="${icon(p.color, false, 64)}">
          <span class="nm">${esc(p.name)}</span>
          ${m.caller === p.id ? `<span class="meg" title="Called the meeting">📢</span>` : ''}
          ${m.voted.includes(p.id) && m.stage !== 'results' ? '<span class="voted">I VOTED</span>' : ''}
          ${tally(p.id)}
          ${sel ? '<span class="confirm"><button class="yes btn btn--sm btn--green">✓</button><button class="no btn btn--sm btn--go">✕</button></span>' : ''}
          ${dead ? '<span class="x">✕</span>' : ''}
        </div>`;
      })
      .join('');
    const skip = this.el.querySelector('.skip') as HTMLElement;
    const skipSel = this.pick === -1 && canVote;
    skip.innerHTML = `<button class="btn btn--sm ${skipSel ? 'focus' : ''}" ${canVote ? '' : 'disabled'}>Skip Vote</button>${skipSel ? '<span class="confirm"><button class="yes btn btn--sm btn--green">✓</button><button class="no btn btn--sm btn--go">✕</button></span>' : ''}${m.stage === 'results' ? `<span style="font-weight:900">Skipped:</span>${tally(-1)}` : ''}`;
    this.cards.querySelectorAll<HTMLElement>('.card:not(.off)').forEach((b) => {
      const id = Number(b.dataset.id);
      b.onclick = () => {
        if (this.pick === id) return;
        this.pick = id;
        this.audio.play('click');
        this.key = '';
        this.update(v);
      };
      b.querySelector('.yes')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.vote(id);
      });
      b.querySelector('.no')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.pick = null;
        this.key = '';
        this.update(v);
      });
    });
    const sb = skip.querySelector('.btn') as HTMLButtonElement;
    sb.onclick = () => {
      this.pick = -1;
      this.key = '';
      this.update(v);
    };
    skip.querySelector('.yes')?.addEventListener('click', () => this.vote(-1));
    skip.querySelector('.no')?.addEventListener('click', () => {
      this.pick = null;
      this.key = '';
      this.update(v);
    });
  }

  private vote(id: number): void {
    this.act({ k: 'vote', target: id });
    this.audio.play('vote');
    this.pick = null;
    this.key = '';
  }

  dispose(): void {
    this.el.remove();
  }
}

/** The ejection: drifting off into space / falling through the clouds / into the lava. */
export class EjectUI {
  readonly el: HTMLDivElement;
  private c: HTMLCanvasElement;
  private p: HTMLParagraphElement;
  private t = 0;
  private full: string;
  private stars = Array.from({ length: 200 }, () => [Math.random(), Math.random(), 0.3 + Math.random()]);

  private remain = '';

  constructor(root: HTMLElement, private v: SfView, private theme: MapDef['theme'], left: number) {
    this.el = document.createElement('div');
    this.el.className = 'eject';
    this.el.innerHTML = '<canvas></canvas><p class="disp"></p>';
    root.appendChild(this.el);
    this.c = this.el.querySelector('canvas')!;
    this.p = this.el.querySelector('p')!;
    this.full = v.lastEject?.text ?? 'No one was ejected.';
    if (v.cfg.confirmEjects) this.remain = `${left} Impostor${left === 1 ? '' : 's'} remain${left === 1 ? 's' : ''}.`;
  }

  update(dt: number): void {
    this.t += dt;
    const c = this.c;
    const W = (c.width = c.clientWidth * Math.min(2, devicePixelRatio));
    const H = (c.height = c.clientHeight * Math.min(2, devicePixelRatio));
    const ctx = c.getContext('2d')!;
    const th = this.theme;
    if (th === 'space') {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      for (const [x, y, z] of this.stars) {
        ctx.fillStyle = `rgba(255,255,255,${z! * 0.7})`;
        ctx.fillRect(((x! * W - this.t * 120 * z!) % W + W) % W, y! * H, z! * 3, z! * 3);
      }
    } else if (th === 'sky') {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#2c6fbf');
      g.addColorStop(1, '#b6dcff');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      for (const [x, y, z] of this.stars.slice(0, 24)) {
        ctx.beginPath();
        ctx.ellipse(x! * W, ((y! * H - this.t * 260 * z!) % H + H) % H, 120 * z!, 50 * z!, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.fillStyle = '#1a0d08';
      ctx.fillRect(0, 0, W, H);
      const g = ctx.createLinearGradient(0, H * 0.6, 0, H);
      g.addColorStop(0, '#ff7b2e');
      g.addColorStop(1, '#a3261b');
      ctx.fillStyle = g;
      ctx.fillRect(0, H * 0.72, W, H * 0.28);
    }
    const e = this.v.lastEject;
    const p = e && e.id >= 0 ? this.v.players[e.id] : null;
    if (p) {
      const col = COLORS[p.color]!;
      const s = Math.min(W, H) / 8;
      ctx.save();
      if (th === 'space') ctx.translate(-s * 2 + ((W + s * 4) * this.t) / 5.2, H / 2);
      else if (th === 'sky') ctx.translate(W / 2, -s + ((H + s * 2) * this.t) / 3);
      else ctx.translate(W / 2 - s * 3 + this.t * s * 1.2, H * 0.2 + Math.min(1, this.t / 2.5) ** 2 * H * 0.6);
      ctx.rotate(this.t * 2);
      ctx.scale(s, s);
      if (th === 'planet' && this.t > 2.5) deadBody(ctx, 0, 0.4, col[1], col[2]);
      else bean(ctx, 0, 0.4, col[1], col[2]);
      ctx.restore();
    }
    // Typed text.
    const n = Math.floor(Math.max(0, this.t - 0.6) * 22);
    const typed = this.full.slice(0, n);
    const rest = n > this.full.length + 10 ? this.remain : '';
    this.p.innerHTML = `${esc(typed)}${rest ? `<small>${esc(rest)}</small>` : ''}`;
  }

  dispose(): void {
    this.el.remove();
  }
}

/** Victory / Defeat. */
export function overScreen(root: HTMLElement, v: SfView, buttons: Array<{ label: string; cls?: string; fn: () => void }>): HTMLElement {
  const me = v.players[v.me]!;
  const won = (v.winner === 'impostor') === me.impostor;
  const winners = v.players.filter((p) => (v.winner === 'impostor' ? p.impostor : !p.impostor));
  const el = document.createElement('div');
  el.className = 'over';
  el.style.setProperty('--glow', won ? '#1f8fff66' : '#ff1f1f55');
  el.innerHTML = `<h1 class="disp ${won ? 'win' : 'lose'}">${won ? 'Victory' : 'Defeat'}</h1>
    <p>${esc(v.why)}</p>
    <div class="line">${winners.map((p) => `<figure><img src="${icon(p.color, false, 140, !p.alive)}">${esc(p.name)}</figure>`).join('')}</div>
    <div class="roles">${v.players.map((p) => `<span class="${p.impostor ? 'imp' : ''}">${esc(p.name)} · ${p.impostor ? 'Impostor' : 'Crewmate'}</span>`).join('')}</div>
    <div class="actions"></div>`;
  const act = el.querySelector('.actions')!;
  for (const b of buttons) {
    const btn = document.createElement('button');
    btn.className = `btn ${b.cls ?? ''}`;
    btn.textContent = b.label;
    btn.onclick = b.fn;
    act.appendChild(btn);
  }
  root.appendChild(el);
  return el;
}
