import { schema, t, type SchemaType } from '@colyseus/schema';

/**
 * Room state synced to every client with Colyseus schema (lobby only — race
 * traffic uses binary snapshots, see shared/src/net/Snapshot.ts). Field names
 * match LobbyStateView in shared/src/net/Protocol.ts.
 */
export const Seat = schema(
  {
    name: t.string(),
    character: t.string(),
    kart: t.string(),
  },
  'Seat',
);
export type Seat = SchemaType<typeof Seat>;

export const Member = schema(
  {
    sessionId: t.string(),
    name: t.string(),
    ready: t.boolean(),
    connected: t.boolean(),
    ping: t.uint16(),
    points: t.uint16(),
    seats: t.array(Seat),
  },
  'Member',
);
export type Member = SchemaType<typeof Member>;

export const LobbyState = schema(
  {
    code: t.string(),
    phase: t.string(),
    hostId: t.string(),
    trackId: t.string(),
    laps: t.uint8(),
    items: t.boolean(),
    difficulty: t.string(),
    racerCount: t.uint8(),
    raceCount: t.uint16(),
    members: t.map(Member),
  },
  'LobbyState',
);
export type LobbyState = SchemaType<typeof LobbyState>;
