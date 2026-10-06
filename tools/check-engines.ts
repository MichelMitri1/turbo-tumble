/** Audio-only drivetrain checks; no browser or sound device required. */
import assert from 'node:assert/strict';
import { EngineDynamics } from '../client/src/audio/EngineDynamics';
import { ENGINE_PROFILES, engineLabel } from '../client/src/audio/EngineProfiles';
for (const profile of ENGINE_PROFILES) {
  const engine = new EngineDynamics(profile.tuning);
  const idle = { speed01: 0, throttle: 0, freeRev: true, stunned: false };
  for (let i = 0; i < 60; i++) engine.update(idle, 1 / 60);
  assert(Math.abs(engine.rpm - profile.tuning.idle) < 1);
  for (let i = 0; i < 90; i++) engine.update({ ...idle, throttle: 1 }, 1 / 60);
  assert(engine.rpm > profile.tuning.redline * 0.9, 'throttle must rev at zero road speed');
  engine.update(idle, 1 / 60);
  assert(engine.lift > 0, 'lifting from high RPM triggers overrun');
  for (let i = 0; i < 180; i++) engine.update(idle, 1 / 60);
  assert(engine.rpm < profile.tuning.idle + 10, 'release returns to idle');
  let shifts = 0;
  let prev = engine.gear;
  for (let i = 0; i < 600; i++) {
    engine.update({ speed01: i / 550, throttle: 1, freeRev: false, stunned: false }, 1 / 60);
    if (prev !== engine.gear) shifts++;
    prev = engine.gear;
    assert(Number.isFinite(engine.rpm) && engine.rpm <= profile.tuning.redline);
  }
  assert(shifts >= 3 && engine.gear === profile.tuning.gears);
  for (let i = 0; i < 90; i++) engine.update({ ...idle, throttle: 1, stunned: true }, 1 / 60);
  assert(engine.rpm < profile.tuning.idle, 'stun bogs down the engine');
  const label = engineLabel(profile);
  assert(profile.samples?.length ? label.includes('real recording') && Boolean(profile.recordedFrom) : label.endsWith('-inspired'), 'labels must say whether the sound is a real recording');
  console.log(`✓ ${profile.id}: idle, stationary revs, release, ${shifts} shifts, redline, stun and source label`);
}
