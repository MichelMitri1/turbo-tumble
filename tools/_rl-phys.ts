import { arenaDistance } from '../client/src/rocket/sim/arena';
import { World } from '../client/src/rocket/sim/world';
import { NO_CONTROLS, type Controls } from '../client/src/rocket/sim/car';
// SDF sanity
const pts: Array<[string, number, number, number, number]> = [['floor centre z=100', 0, 0, 100, 100], ['side wall', 4000, 0, 1000, 96], ['back wall', 0, -5000, 1000, 120], ['ceiling', 0, 0, 2000, 44], ['in goal', 0, 5500, 300, 300], ['corner plane', 3000, 4964, 1000, 0], ['ramp floor near wall', 4000, 0, 10, -1]];
for (const [n, x, y, z, exp] of pts) console.log(n.padEnd(22), arenaDistance(x, y, z).toFixed(1), 'expect≈', exp);
// Driving test
const w = new World([{ id: 1, name: 'A', team: 0, bot: false, body: 'octane' }], 300, 3);
const car = w.cars[0]!;
car.place(0, -3000, Math.PI / 2, 100);
w.phase = 'play';
const ctl = (o: Partial<Controls>) => new Map([[1, { ...NO_CONTROLS, ...o }]]);
const run = (sec: number, o: Partial<Controls>, log = '') => { for (let i = 0; i < sec * 120; i++) w.step(ctl(o)); if (log) console.log(log.padEnd(26), 'pos', car.pos.toArray().map((v) => v.toFixed(0)).join(','), 'speed', car.speed.toFixed(0), 'fwd', car.forwardSpeed.toFixed(0), 'contacts', car.numContacts, 'up', car.up.toArray().map((v) => v.toFixed(2)).join(','), 'boost', car.boost.toFixed(1)); };
run(1, {}, 'settle 1s');
run(1, { throttle: 1 }, 'throttle 1s');
run(2, { throttle: 1 }, 'throttle 3s (cap 1410)');
run(1.5, { throttle: 1, boost: true }, 'boost 1.5s (→2300)');
run(2, { throttle: 0 }, 'coast 2s');
car.place(0, 0, 0, 100); w.ball.pos.set(0, 3000, 93); 
run(0.5, {}, 'reset');
run(1, { throttle: 1, steer: 1 }, 'turn right 1s');
car.place(0, 0, 0, 100);
run(0.3, {});
let maxZ = 0; for (let i = 0; i < 240; i++) { w.step(ctl({ jump: i < 24 })); maxZ = Math.max(maxZ, car.pos.z); }
console.log('full jump apex z', maxZ.toFixed(0), '(RL ≈ 240)');
car.place(0, 0, 0, 100); run(0.3, {});
maxZ = 0; for (let i = 0; i < 300; i++) { w.step(ctl({ jump: i < 24 || (i > 30 && i < 34) })); maxZ = Math.max(maxZ, car.pos.z); }
console.log('double jump apex z', maxZ.toFixed(0), '(RL ≈ 480)');
car.place(0, 0, 0, 100); run(0.3, {}); run(1.5, { throttle: 1 });
const v0 = car.speed; for (let i = 0; i < 6; i++) w.step(ctl({ throttle: 1, jump: true })); for (let i = 0; i < 6; i++) w.step(ctl({ throttle: 1 })); for (let i = 0; i < 3; i++) w.step(ctl({ throttle: 1, jump: true, pitch: -1 }));
run(0.4, { throttle: 1, pitch: -1 }, 'front flip'); console.log('  speed before flip', v0.toFixed(0), 'after', car.speed.toFixed(0), '(RL ≈ +500)');
// Wall drive: drive into side wall at speed.
car.place(3000, 0, 0, 100); run(0.2, {}); run(2.5, { throttle: 1, boost: true }, 'drive into wall'); run(1, { throttle: 1 }, 'on wall?');
// Ball hit
const w2 = new World([{ id: 1, name: 'A', team: 0, bot: false, body: 'octane' }], 300, 3); w2.phase = 'play';
const c2 = w2.cars[0]!; c2.place(0, -1500, Math.PI / 2, 100);
for (let i = 0; i < 240 && w2.ball.vel.length() < 1; i++) w2.step(new Map([[1, { ...NO_CONTROLS, throttle: 1, boost: true }]]));
console.log('ball after hit: speed', w2.ball.vel.length().toFixed(0), 'car speed', c2.speed.toFixed(0), 'vel', w2.ball.vel.toArray().map((v) => v.toFixed(0)).join(','));
