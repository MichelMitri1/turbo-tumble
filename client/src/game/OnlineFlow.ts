import { Msg, type LobbyStateView, type RaceStartMessage, type RoomSettings, type SeatChoice } from '@shared/net/Protocol';
import type { MenuNav } from '../input/InputManager';
import type { ConnectionStatus, NetClient } from '../net/NetClient';
import { defaultServerUrl } from '../net/serverUrl';
import { OnlineScreen } from '../ui/OnlineScreen';
import { el } from '../ui/dom';
import type { OnlineRace } from './RaceSession';
import type { PlayerSetup } from './SessionConfig';

function friendlyError(msg: string): string {
  if (/not found/i.test(msg)) return 'No room with that code — check it and try again.';
  if (/locked/i.test(msg)) return 'That room is mid-race — try again when the race ends (about a minute).';
  if (/full|maxClients/i.test(msg)) return 'That room is full.';
  return msg;
}

/** What the online flow needs from the game. */
export interface OnlineHost {
  /** Start racing (the screen is already hidden). */
  startRace(race: OnlineRace, players: PlayerSetup[]): void;
  /** Back from a race to the lobby (attract backdrop). */
  showLobbyBackdrop(): void;
  /** Leave online play entirely. */
  exitToMenu(): void;
  /** Is an online race session currently shown? */
  inRace(): boolean;
}

/**
 * Online mode controller: owns the connection, drives the online screens and
 * hands races to the game. One room at a time.
 */
export class OnlineFlow {
  readonly screen: OnlineScreen;
  private net: NetClient | null = null;
  private players: PlayerSetup[] = [];
  private settings: Partial<RoomSettings> = {};
  private offs: Array<() => void> = [];
  private lastPhase = 'lobby';
  private raceId = 0;
  private readonly toast: HTMLElement;
  private toastTimer = 0;

  constructor(
    ui: HTMLElement,
    private readonly host: OnlineHost,
  ) {
    const url = defaultServerUrl();
    this.screen = new OnlineScreen(
      ui,
      {
        create: (name) => void this.connect(name, (net, seats) => net.create(name, seats, this.settings, 'private')),
        quickMatch: (name) => void this.connect(name, (net, seats) => net.quickMatch(name, seats, this.settings)),
        join: (name, code) => void this.connect(name, (net, seats) => net.join(code, name, seats)),
        back: () => (this.screen.view === 'lobby' ? void this.leave() : this.close()),
        ready: (ready) => this.net?.send(Msg.Ready, { ready }),
        settings: (change) => this.net?.send(Msg.Settings, change),
        start: () => this.net?.send(Msg.StartRace),
      },
      url.replace(/^wss?:\/\//, ''),
    );
    this.toast = el('div', 'tt-net-toast');
    ui.appendChild(this.toast);
  }

  get connected(): boolean {
    return this.net?.room != null;
  }

  get client(): NetClient | null {
    return this.net;
  }

  /** Show the online screen for these local players (from the menu / join screen). */
  open(players: PlayerSetup[], settings: Partial<RoomSettings>, code = ''): void {
    this.players = players;
    this.settings = settings;
    this.screen.setStatus(players.length > 1 ? `${players.length} players on this screen will race in split-screen.` : '');
    this.screen.showConnect(code);
    this.screen.setOpen(true);
  }

  handle(nav: MenuNav, escape: boolean): void {
    this.screen.handle(nav, escape);
  }

  private seats(): SeatChoice[] {
    return this.players.map((p) => ({ character: p.character, kart: p.kart }));
  }

  private async connect(name: string, how: (net: NetClient, seats: SeatChoice[]) => Promise<void>): Promise<void> {
    if (this.net?.room) return;
    this.screen.setBusy(true);
    this.screen.setStatus('Connecting…');
    // The networking SDK is only downloaded once someone actually goes online.
    let net: NetClient | null = null;
    try {
      const { NetClient } = await import('../net/NetClient');
      net = this.net = new NetClient();
      if (!(await net.probe())) {
        throw new Error(`Can't reach the game server at ${net.url}. Is it running? (\`npm run dev\` starts it)`);
      }
      await how(net, this.seats());
      this.wire(net);
      this.screen.setStatus(`Joined room ${net.code}${name ? ` as ${name}` : ''}.`);
      this.screen.showLobby();
      const view = net.lobby();
      if (view) this.onState(view);
    } catch (err) {
      console.warn('[online] connect failed', err);
      void net?.leave();
      this.net = null;
      const msg = err instanceof Error ? err.message : String(err);
      this.screen.setStatus(friendlyError(msg), 'error');
    } finally {
      this.screen.setBusy(false);
    }
  }

  private wire(net: NetClient): void {
    this.lastPhase = 'lobby';
    this.offs.push(
      net.onStateChange((v) => this.onState(v)),
      net.on<RaceStartMessage>(Msg.RaceStart, (start) => this.onRaceStart(net, start)),
      net.on<string>(Msg.Notice, (text) => {
        this.screen.setStatus(text);
        this.showToast(text);
      }),
    );
    net.onStatus = (s, reason) => this.onStatus(s, reason);
  }

  private onState(v: LobbyStateView): void {
    const net = this.net;
    if (!net) return;
    this.screen.updateLobby(v, net.sessionId);
    // A race just wrapped up: back to the lobby.
    if (v.phase === 'lobby' && this.lastPhase !== 'lobby' && this.host.inRace()) {
      this.host.showLobbyBackdrop();
      this.screen.showLobby();
      this.screen.setOpen(true);
      this.screen.setStatus('Ready up for the next race!');
    }
    this.lastPhase = v.phase;
  }

  private onRaceStart(net: NetClient, start: RaceStartMessage): void {
    // A reconnect re-sends the race we are already in.
    if (start.raceId === this.raceId && this.host.inRace()) return;
    this.raceId = start.raceId;
    this.screen.setOpen(false);
    this.host.startRace({ net, start }, this.players);
  }

  private onStatus(s: ConnectionStatus, reason?: string): void {
    if (s === 'reconnecting') this.showToast('Connection lost — reconnecting…', 0);
    else if (s === 'connected') this.showToast('Reconnected!');
    else if (s === 'closed' && this.net) {
      // Dropped for good (server gone, kicked, reconnection window expired).
      this.cleanup();
      this.showToast(reason ?? 'Disconnected from the room');
      if (this.host.inRace()) this.host.showLobbyBackdrop();
      this.screen.showConnect();
      this.screen.setStatus(reason ? `Disconnected: ${reason}` : 'Disconnected from the room.', 'error');
      this.screen.setOpen(true);
    }
  }

  private showToast(text: string, seconds = 3): void {
    clearTimeout(this.toastTimer);
    this.toast.textContent = text;
    this.toast.classList.add('is-open');
    if (seconds > 0) this.toastTimer = window.setTimeout(() => this.toast.classList.remove('is-open'), seconds * 1000);
  }

  private cleanup(): void {
    for (const off of this.offs) off();
    this.offs = [];
    if (this.net) this.net.onStatus = null;
    this.net = null;
    this.raceId = 0;
  }

  /** Leave the room and go back to the connect screen. */
  async leave(): Promise<void> {
    const net = this.net;
    this.cleanup();
    if (this.host.inRace()) this.host.showLobbyBackdrop();
    this.screen.showConnect();
    this.screen.setStatus('Left the room.');
    this.screen.setOpen(true);
    await net?.leave();
  }

  /** Close online play (back to the main menu). */
  close(): void {
    const net = this.net;
    this.cleanup();
    void net?.leave();
    this.screen.setOpen(false);
    this.host.exitToMenu();
  }
}
