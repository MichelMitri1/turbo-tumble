/**
 * Snapshot / input codec checks against a real headless race:
 *  - own-kart (full) state round-trips to float32 precision, every field
 *  - restoring a decoded own state and replaying the same inputs reproduces the
 *    authoritative trajectory (the property client reconciliation relies on)
 *  - snapshot sizes / bandwidth
 *
 *   npx tsx tools/net-codec-test.ts
 */
import { initPhysics, PhysicsWorld } from '../shared/src/physics/PhysicsWorld';
import { getTrack } from '../shared/src/tracks/registry';
import { TrackPath } from '../shared/src/track/TrackPath';
import { TerrainField } from '../shared/src/track/TerrainField';
import { buildTrackColliders } from '../shared/src/track/TrackColliders';
import { RaceSimulation } from '../shared/src/race/RaceSimulation';
import { cpuField, humanSetup } from '../shared/src/roster/Roster';
import { FIXED_DT } from '../shared/src/constants/simulation';
import { ByteWriter } from '../shared/src/net/ByteBuffer';
import { decodeSnapshot, encodeSnapshotCommon, encodeSnapshotOwn } from '../shared/src/net/Snapshot';
import { KART_FULL } from '../shared/src/net/StateCodec';
import { packInput, unpackInput } from '../shared/src/net/InputCodec';
import { createEmptyInput, type PlayerInput } from '../shared/src/types/input';
import { createKartState, type KartState } from '../shared/src/vehicles/KartState';
import { KartSimulation } from '../shared/src/vehicles/KartSimulation';
import { Vector3 } from 'three';

let failures = 0;
const check = (ok: boolean, msg: string): void => {
  if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗'} ${msg}`);
};

// Input codec.
{
  const out = createEmptyInput();
  let worst = 0;
  for (let i = 0; i < 2000; i++) {
    const inp: PlayerInput = { throttle: Math.random(), brake: Math.random(), steer: Math.random() * 2 - 1, drift: Math.random() < 0.5, item: Math.random() < 0.5 };
    const reset = Math.random() < 0.1;
    const r = unpackInput(packInput(inp, reset), out);
    worst = Math.max(worst, Math.abs(out.throttle - inp.throttle), Math.abs(out.brake - inp.brake), Math.abs(out.steer - inp.steer));
    if (r !== reset || out.drift !== inp.drift || out.item !== inp.item) worst = 99;
  }
  check(worst < 0.005, `input codec round-trip (max error ${worst.toFixed(4)})`);
  unpackInput(packInput({ throttle: 1, brake: 0, steer: 0, drift: false, item: false }, false), out);
  check(out.steer === 0 && out.throttle === 1, 'neutral steer decodes to exactly 0');
}

await initPhysics();
const def = getTrack('sunny-circuit');
const track = new TrackPath(def);
const terrain = new TerrainField(track, def.terrain);
const physics = new PhysicsWorld();
buildTrackColliders(physics, track, terrain.buildMesh());

const racers = [...cpuField(7), humanSetup('p1', 'Tester', 'pip', 'lagoon')];
const race = new RaceSimulation({ laps: 3, checkpoints: def.checkpointCount, itemsEnabled: true, difficulty: 'hard', catchUp: false, seed: 11, countdown: 0.1, racers }, physics, track);
const me = race.racers.length - 1;
const inputs: Array<PlayerInput | null> = race.racers.map(() => null);

// Run 25 s (the "human" is AI-driven via null input) so items, drifts and boosts are live.
for (let t = 0; t < 60 * 25; t++) race.step(inputs, FIXED_DT);

const common = new ByteWriter();
encodeSnapshotCommon(common, race, 1234);
const full = new ByteWriter();
full.bytes(common.view8());
encodeSnapshotOwn(full, race, 777, [me]);
const bytes = full.toBytes();
const snap = decodeSnapshot(bytes, race.pickups.boxes.length, race.pickups.coins.length);
check(snap.tick === 1234 && snap.ack === 777 && snap.own.length === 1 && snap.own[0]!.index === me, 'header / ack / own section');
check(snap.racers.length === race.racers.length, `racer count ${snap.racers.length}`);
check(snap.entities.length === race.items.entities.list.filter((e) => !e.dead).length, `entities ${snap.entities.length}`);

// Every full-layout field round-trips (to float32).
const src = race.racers[me]!.state as unknown as Record<string, unknown>;
const dst = snap.own[0]!.kart as unknown as Record<string, unknown>;
const bad: string[] = [];
for (const key of Object.keys(createKartState())) {
  if (!(key in KART_FULL)) bad.push(`${key} (missing from layout)`);
  const a = src[key];
  const b = dst[key];
  if (a instanceof Vector3) {
    if ((a as Vector3).distanceTo(b as Vector3) > 1e-3) bad.push(key);
  } else if (typeof a === 'number') {
    if (Math.abs(a - (b as number)) > Math.max(1e-4, Math.abs(a) * 1e-6)) bad.push(`${key} ${a} vs ${String(b)}`);
  } else if (a !== b) bad.push(key);
}
check(bad.length === 0, `own kart state round-trips${bad.length ? ': ' + bad.join(', ') : ''}`);
const rem = snap.racers[3]!.kart;
const real = race.racers[3]!.state;
check(rem.position.distanceTo(real.position) < 1e-3 && rem.forward.distanceTo(real.forward) < 1e-3, 'remote kart pose');
check(
  snap.racers.every((s, i) => s.progress.position === race.racers[i]!.progress.position),
  'positions',
);

// Replay determinism: restore the decoded state into a twin kart and replay 120 ticks of
// recorded inputs alongside the authoritative kart (static world only).
{
  const auth = race.racers[me]!;
  const twinState = createKartState();
  const twin = new KartSimulation(twinState, auth.sim.stats, physics, track);
  const copyState = (from: KartState, to: KartState): void => {
    for (const [k, v] of Object.entries(from)) {
      if (v instanceof Vector3) ((to as unknown as Record<string, Vector3>)[k]!).copy(v);
      else (to as unknown as Record<string, unknown>)[k] = v;
    }
  };
  copyState(snap.own[0]!.kart, twinState);
  const recorded: PlayerInput[] = [];
  const steer = (t: number): number => Math.sin(t * 0.05) * 0.8;
  let maxErr = 0;
  for (let t = 0; t < 120; t++) {
    const raw: PlayerInput = { throttle: 1, brake: 0, steer: steer(t), drift: t % 50 > 30, item: false };
    const q = createEmptyInput();
    unpackInput(packInput(raw, false), q);
    recorded.push(q);
    auth.sim.step(q, FIXED_DT);
    twin.step(q, FIXED_DT);
    maxErr = Math.max(maxErr, auth.state.position.distanceTo(twinState.position));
  }
  check(maxErr < 0.05, `replay from decoded state tracks authority over 2 s (max drift ${maxErr.toFixed(4)} m)`);
  twin.dispose();
}

const ownBytes = bytes.length - common.offset;
console.log(`snapshot: common ${common.offset} B (${race.racers.length} racers, ${snap.entities.length} entities) + own ${ownBytes} B`);
console.log(`bandwidth @30 Hz ≈ ${(((common.offset + ownBytes) * 30) / 1024).toFixed(1)} KiB/s per client`);
process.exit(failures ? 1 : 0);
