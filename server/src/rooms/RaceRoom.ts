import { Room, ServerError, type Client } from '@colyseus/core';
import { FIXED_DT, MAX_RACERS } from '../../../shared/src/constants/simulation';
import {
  DEFAULT_ROOM_SETTINGS,
  MAX_ONLINE_HUMANS,
  MAX_ROOM_CLIENTS,
  MAX_SEATS_PER_CLIENT,
  Msg,
  ONLINE_COUNTDOWN,
  PROTOCOL_VERSION,
  RECONNECT_SECONDS,
  RESULTS_SECONDS,
  SNAPSHOT_EVERY_TICKS,
  sanitizeSettings,
  type CreateOptions,
  type JoinOptions,
  type RaceEndMessage,
  type RaceStartMessage,
  type RoomSettings,
  type SeatChoice,
} from '../../../shared/src/net/Protocol';
import { GP_POINTS } from '../../../shared/src/race/GrandPrix';
import { cpuField, humanSetup, characterEntry } from '../../../shared/src/roster/Roster';
import { getTrack } from '../../../shared/src/tracks/registry';
import type { RacerSetup } from '../../../shared/src/race/RaceSimulation';
import { claimRoomCode, releaseRoomCode } from '../matchmaking/RoomCodes';
import { ServerRace } from '../race/ServerRace';
import { LobbyState, Member, Seat } from '../state/LobbyState';
import { LAN_MODE } from '../lan';
import { FastLane } from '../fastlane';

const MAX_STEPS_PER_UPDATE = 5;
/** On a LAN bandwidth is free, so every tick goes out — remote karts can then be drawn closer to now. */
const SNAPSHOT_EVERY = LAN_MODE ? 1 : SNAPSHOT_EVERY_TICKS;

function cleanName(raw: unknown, fallback: string): string {
  const name = String(raw ?? '')
    .replace(/[^\p{L}\p{N} _.\-!?']/gu, '')
    .trim()
    .slice(0, 16);
  return name || fallback;
}

function cleanSeats(raw: unknown): SeatChoice[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_SEATS_PER_CLIENT).map((s: Partial<SeatChoice>) => ({ character: String(s?.character ?? 'bix'), kart: String(s?.kart ?? 'comet') }));
}

/**
 * One online room: a lobby (code, members, settings, ready-up) that runs races.
 * Lobby state syncs through Colyseus schema; races stream binary snapshots.
 */
export class RaceRoom extends Room<{ state: LobbyState }> {
  override maxClients = MAX_ROOM_CLIENTS;
  override state = new LobbyState();
  private race: ServerRace | null = null;
  private accumulator = 0;
  private lane!: FastLane;
  private resultsTimer = 0;
  private raceId = 0;

  override onCreate(options: CreateOptions): void {
    this.roomId = claimRoomCode();
    const s = this.state;
    s.code = this.roomId;
    s.phase = 'lobby';
    s.hostId = '';
    s.raceCount = 0;
    this.applySettings(sanitizeSettings(options?.settings));
    void this.setPrivate(options?.visibility !== 'public');
    void this.setMetadata({ code: this.roomId, phase: 'lobby' });

    this.lane = new FastLane(this);
    this.lane.on(Msg.Input, (client, msg) => this.race?.receiveInput(client.sessionId, msg));
    this.onMessage(Msg.Ready, (client, msg: { ready?: boolean }) => {
      const m = s.members.get(client.sessionId);
      if (m && s.phase === 'lobby') m.ready = Boolean(msg?.ready);
    });
    this.onMessage(Msg.Settings, (client, msg: Partial<RoomSettings>) => {
      if (client.sessionId !== s.hostId || s.phase !== 'lobby') return;
      this.applySettings(sanitizeSettings(msg, this.settings));
    });
    this.onMessage(Msg.StartRace, (client) => {
      if (client.sessionId !== s.hostId) return;
      const error = this.startProblem();
      if (error) client.send(Msg.Notice, error);
      else this.startRace();
    });
    this.onMessage(Msg.Ping, (client, msg: { rtt?: number }) => {
      const m = s.members.get(client.sessionId);
      if (m) m.ping = Math.max(0, Math.min(9999, Math.round(Number(msg?.rtt) || 0)));
    });

    this.setSimulationInterval((dtMs) => this.update(dtMs / 1000), 1000 / 60);
    console.log(`[room ${this.roomId}] created (${options?.visibility ?? 'private'})`);
  }

  override onJoin(client: Client, options: JoinOptions): void {
    const s = this.state;
    if (options?.version !== PROTOCOL_VERSION) throw new ServerError(4000, 'Game version mismatch — refresh the page.');
    if (s.phase !== 'lobby') throw new ServerError(4001, 'A race is in progress — try again in a moment.');
    const seats = cleanSeats(options?.seats);
    if (!seats.length) throw new ServerError(4002, 'No players to join with.');
    if (this.humanCount() + seats.length > MAX_ONLINE_HUMANS) throw new ServerError(4003, `Room is full (${MAX_ONLINE_HUMANS} racers max).`);

    const name = cleanName(options?.name, `Racer ${client.sessionId.slice(0, 3)}`);
    const member = new Member();
    member.sessionId = client.sessionId;
    member.name = name;
    member.ready = false;
    member.connected = true;
    member.ping = 0;
    member.points = 0;
    seats.forEach((choice, k) => {
      const seat = new Seat();
      seat.name = seats.length > 1 ? `${name} ${k + 1}` : name;
      seat.character = characterEntry(choice.character).id;
      seat.kart = choice.kart;
      member.seats.push(seat);
    });
    s.members.set(client.sessionId, member);
    if (!s.hostId) s.hostId = client.sessionId;
    console.log(`[room ${this.roomId}] ${name} joined (${seats.length} seat${seats.length > 1 ? 's' : ''}), ${s.members.size} members`);
  }

  override async onDrop(client: Client): Promise<void> {
    const m = this.state.members.get(client.sessionId);
    if (m) m.connected = false;
    this.race?.setConnected(client.sessionId, false);
    console.log(`[room ${this.roomId}] ${m?.name ?? client.sessionId} dropped — holding seat ${RECONNECT_SECONDS}s`);
    await this.allowReconnection(client, RECONNECT_SECONDS);
  }

  override onReconnect(client: Client): void {
    const m = this.state.members.get(client.sessionId);
    if (m) m.connected = true;
    this.race?.setConnected(client.sessionId, true);
    // The client may have missed the race start while away.
    if (this.race && this.state.phase === 'racing') client.send(Msg.RaceStart, this.race.start);
    console.log(`[room ${this.roomId}] ${m?.name ?? client.sessionId} reconnected`);
  }

  override onLeave(client: Client): void {
    this.lane.drop(client.sessionId);
    const s = this.state;
    const m = s.members.get(client.sessionId);
    s.members.delete(client.sessionId);
    this.race?.setConnected(client.sessionId, false);
    console.log(`[room ${this.roomId}] ${m?.name ?? client.sessionId} left, ${s.members.size} members`);
    if (s.hostId === client.sessionId) {
      const next = [...s.members.keys()][0] ?? '';
      s.hostId = next;
      const nextName = next ? s.members.get(next)?.name : null;
      if (nextName) this.broadcast(Msg.Notice, `${m?.name ?? 'The host'} left — ${nextName} is now host`);
    }
    // Nobody left to race for: end it.
    if (this.race && ![...s.members.values()].some((x) => x.connected)) this.endRace();
  }

  override onDispose(): void {
    this.lane.dispose();
    this.race?.dispose();
    releaseRoomCode(this.roomId);
    console.log(`[room ${this.roomId}] disposed`);
  }

  // ---------------------------------------------------------------- lobby

  private get settings(): RoomSettings {
    const s = this.state;
    return { trackId: s.trackId, laps: s.laps, items: s.items, difficulty: s.difficulty as RoomSettings['difficulty'], racerCount: s.racerCount };
  }

  private applySettings(settings: RoomSettings): void {
    const s = this.state;
    s.trackId = settings.trackId || DEFAULT_ROOM_SETTINGS.trackId;
    s.laps = settings.laps;
    s.items = settings.items;
    s.difficulty = settings.difficulty;
    s.racerCount = settings.racerCount;
  }

  private humanCount(): number {
    let n = 0;
    this.state.members.forEach((m) => (n += m.seats.length));
    return n;
  }

  private startProblem(): string | null {
    const s = this.state;
    if (s.phase !== 'lobby') return 'A race is already running.';
    const waiting = [...s.members.values()].filter((m) => !m.ready && m.sessionId !== s.hostId);
    if (waiting.length) return `Waiting for ${waiting.map((m) => m.name).join(', ')} to ready up.`;
    return null;
  }

  private startRace(): void {
    const s = this.state;
    const settings = this.settings;
    const def = getTrack(settings.trackId);
    // Humans in join order; CPUs fill the grid ahead of them (humans start at the back, like offline).
    const humans: RacerSetup[] = [];
    const humanOwners: string[] = [];
    s.members.forEach((m) => {
      if (!m.connected) return;
      m.seats.forEach((seat, k) => {
        humans.push(humanSetup(`${m.sessionId}:${k}`, seat.name, seat.character, seat.kart));
        humanOwners.push(m.sessionId);
      });
    });
    const cpus = cpuField(Math.max(0, Math.min(MAX_RACERS, settings.racerCount) - humans.length));
    const start: RaceStartMessage = {
      raceId: ++this.raceId,
      seed: (Math.random() * 1e9) | 0,
      settings,
      checkpoints: def.checkpointCount,
      countdown: ONLINE_COUNTDOWN,
      catchUp: true,
      racers: [...cpus, ...humans],
      owners: [...cpus.map(() => ''), ...humanOwners],
    };
    this.race?.dispose();
    this.race = new ServerRace(start);
    this.accumulator = 0;
    s.phase = 'racing';
    s.raceCount++;
    void this.lock();
    void this.setMetadata({ code: this.roomId, phase: 'racing' });
    this.broadcast(Msg.RaceStart, start);
    console.log(`[room ${this.roomId}] race ${start.raceId}: ${humans.length} human(s) + ${cpus.length} CPU, ${settings.laps} laps`);
  }

  private endRace(): void {
    const race = this.race;
    const s = this.state;
    if (!race || s.phase !== 'racing') return;
    s.phase = 'results';
    this.resultsTimer = RESULTS_SECONDS;
    const owners = race.start.owners;
    const rows: RaceEndMessage['rows'] = race.sim.standings().map((r, i) => {
      const points = GP_POINTS[i] ?? 0;
      const owner = owners[r.index] ?? '';
      const member = owner ? s.members.get(owner) : undefined;
      if (member) member.points += points;
      return {
        id: r.id,
        name: r.name,
        sessionId: owner,
        characterId: r.characterId,
        position: r.progress.position,
        finished: r.progress.finished,
        time: r.progress.finished ? r.progress.finishTime : 0,
        points,
      };
    });
    this.broadcast(Msg.RaceEnd, { raceId: race.start.raceId, rows } satisfies RaceEndMessage);
    console.log(`[room ${this.roomId}] race ${race.start.raceId} over: ${rows.slice(0, 3).map((r) => r.name).join(', ')}…`);
  }

  private backToLobby(): void {
    const s = this.state;
    this.race?.dispose();
    this.race = null;
    s.phase = 'lobby';
    s.members.forEach((m) => (m.ready = false));
    void this.unlock();
    void this.setMetadata({ code: this.roomId, phase: 'lobby' });
  }

  // ---------------------------------------------------------------- loop

  private update(dt: number): void {
    const race = this.race;
    if (!race) return;
    this.accumulator = Math.min(this.accumulator + dt, FIXED_DT * MAX_STEPS_PER_UPDATE);
    while (this.accumulator >= FIXED_DT) {
      this.accumulator -= FIXED_DT;
      race.step();
      if (race.tick % SNAPSHOT_EVERY === 0) this.sendSnapshots(race);
    }
    if (this.state.phase === 'racing' && race.over) this.endRace();
    if (this.state.phase === 'results') {
      this.resultsTimer -= dt;
      if (this.resultsTimer <= 0) this.backToLobby();
    }
  }

  private sendSnapshots(race: ServerRace): void {
    if (race.events.length) {
      this.broadcast(Msg.Events, { t: race.tick, e: race.events.splice(0) });
    }
    race.encodeCommon();
    for (const client of this.clients) this.lane.sendBytes(client, Msg.Snapshot, race.packetFor(client.sessionId));
  }
}
