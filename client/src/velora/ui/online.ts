import type { Game } from '../game';

/**
 * Online overlays: the feed (joins, leaves, kills) top-left under the help box, text chat
 * (T to type, Enter to send) bottom-left above the radar, and the player list (hold Z).
 */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export class OnlineUI {
  private feedEl: HTMLDivElement;
  private chatEl: HTMLDivElement;
  private log: HTMLDivElement;
  private input: HTMLInputElement;
  private list: HTMLDivElement;
  typing = false;
  private listOpen = false;

  constructor(root: HTMLElement, private g: Game) {
    this.feedEl = document.createElement('div');
    this.feedEl.className = 'v-feed';
    this.chatEl = document.createElement('div');
    this.chatEl.className = 'v-chat';
    this.chatEl.innerHTML = '<div class="v-chatlog"></div><input class="hidden" maxlength="120" placeholder="Say something… (Enter to send, Esc to cancel)">';
    this.log = this.chatEl.querySelector('.v-chatlog')!;
    this.input = this.chatEl.querySelector('input')!;
    this.list = document.createElement('div');
    this.list.className = 'v-plist hidden';
    root.append(this.feedEl, this.chatEl, this.list);
    addEventListener('keydown', this.onKey, true);
    addEventListener('keyup', (e) => {
      if (e.code === 'KeyZ') this.showList(false);
    });
  }

  private onKey = (e: KeyboardEvent): void => {
    if (this.typing) {
      e.stopPropagation();
      if (e.code === 'Enter') {
        const t = this.input.value.trim();
        if (t) this.g.net?.chat(t);
        this.closeChat();
        e.preventDefault();
      } else if (e.code === 'Escape') {
        this.closeChat();
        e.preventDefault();
      }
      return;
    }
    if (e.code === 'KeyT' && !e.repeat && document.pointerLockElement) {
      e.preventDefault();
      e.stopPropagation();
      this.typing = true;
      this.input.classList.remove('hidden');
      this.input.value = '';
      this.chatEl.classList.add('open');
      setTimeout(() => this.input.focus(), 0);
    }
    if (e.code === 'KeyZ' && !e.repeat) this.showList(true);
  };

  private closeChat(): void {
    this.typing = false;
    this.input.blur();
    this.input.classList.add('hidden');
    this.chatEl.classList.remove('open');
  }

  feed(text: string, kind: string): void {
    const d = document.createElement('div');
    d.className = `v-feeditem ${kind}`;
    d.textContent = text;
    this.feedEl.appendChild(d);
    while (this.feedEl.children.length > 5) this.feedEl.firstElementChild!.remove();
    setTimeout(() => d.remove(), 7000);
    if (kind === 'kill') this.g.audio.blip('wanted');
  }

  chat(name: string, text: string, mine: boolean): void {
    const d = document.createElement('div');
    d.className = `v-chatline ${mine ? 'me' : ''}`;
    d.innerHTML = `<b>${esc(name)}</b> ${esc(text)}`;
    this.log.appendChild(d);
    while (this.log.children.length > 8) this.log.firstElementChild!.remove();
    d.dataset.t = String(performance.now());
    this.g.audio.blip('click');
  }

  listHtml(): string {
    const net = this.g.net;
    if (!net) return '';
    const rows = [...this.g.remotes.map.values()].map((r) => `<tr><td>${esc(r.label)}</td><td>${'★'.repeat(r.wanted)}</td><td>${r.kills}</td><td>${r.deaths}</td></tr>`);
    return `<table class="v-ptable"><tr><th>Player</th><th>Wanted</th><th>K</th><th>D</th></tr><tr class="me"><td>You</td><td>${'★'.repeat(this.g.police.level)}</td><td></td><td></td></tr>${rows.join('')}</table>`;
  }

  private showList(on: boolean): void {
    if (this.typing) return;
    this.listOpen = on;
    this.list.classList.toggle('hidden', !on);
    if (on) this.list.innerHTML = `<h3>VELORA ONLINE · ${this.g.net?.welcome?.code ?? ''}</h3>${this.listHtml()}`;
  }

  update(_dt: number): void {
    const now = performance.now();
    for (const d of [...this.log.children] as HTMLElement[]) d.classList.toggle('old', !this.typing && now - Number(d.dataset.t) > 9000);
    if (this.listOpen) this.showList(true);
  }
}
