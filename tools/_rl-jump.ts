import { World } from '../client/src/rocket/sim/world';
import { NO_CONTROLS, type Controls } from '../client/src/rocket/sim/car';
const mk = () => { const w = new World([{ id: 1, name: 'A', team: 0, bot: false, body: 'octane' }], 300, 3); w.phase = 'play'; w.ball.pos.set(3000, 3000, 93); return w; };
const ctl = (o: Partial<Controls>) => new Map([[1, { ...NO_CONTROLS, ...o }]]);
let w = mk(); let car = w.cars[0]!; car.place(0, 0, 0, 100);
for (let i = 0; i < 60; i++) w.step(ctl({}));
console.log('rest z', car.pos.z.toFixed(2));
let maxZ = 0;
for (let i = 0; i < 200; i++) { w.step(ctl({ jump: i < 24 })); if (i < 30 && i % 3 === 0) console.log(i, 'z', car.pos.z.toFixed(1), 'vz', car.vel.z.toFixed(0), 'contacts', car.numContacts, 'jumping', car.isJumping); maxZ = Math.max(maxZ, car.pos.z); }
console.log('full jump apex', maxZ.toFixed(0));
w = mk(); car = w.cars[0]!; car.place(0, 0, 0, 100); for (let i = 0; i < 60; i++) w.step(ctl({}));
maxZ = 0; for (let i = 0; i < 300; i++) { w.step(ctl({ jump: i < 24 || (i > 30 && i < 34) })); maxZ = Math.max(maxZ, car.pos.z); }
console.log('double jump apex', maxZ.toFixed(0), 'doubleJumped', car.hasDoubleJumped);
w = mk(); car = w.cars[0]!; car.place(0, 0, Math.PI / 2, 100); for (let i = 0; i < 300; i++) w.step(ctl({ throttle: 1 })); console.log('throttle 2.5s speed', car.speed.toFixed(0)); for (let i = 0; i < 360; i++) w.step(ctl({ throttle: 1 })); console.log('throttle 5.5s speed', car.speed.toFixed(0), 'pos y', car.pos.y.toFixed(0));
// Ball hit straight on at ~1400 + boost
w = mk(); w.ball.pos.set(0, 0, 93.15); car = w.cars[0]!; car.place(0, -2000, Math.PI / 2, 100);
let hit = false; for (let i = 0; i < 360 && !hit; i++) { w.step(ctl({ throttle: 1, boost: true })); hit = w.events.some((e) => e.k === 'touch'); w.events.length = 0; }
const carSpeed = car.speed; for (let i = 0; i < 3; i++) w.step(ctl({}));
console.log('hit at car speed', carSpeed.toFixed(0), '→ ball speed', w.ball.vel.length().toFixed(0), 'dir', w.ball.vel.clone().normalize().toArray().map((v) => v.toFixed(2)).join(','), '(RL: ~1.6-2x car speed)');
