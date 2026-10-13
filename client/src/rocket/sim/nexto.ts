import { NO_CONTROLS, type Car, type Controls } from './car';
import { BOOST_PADS } from './constants';
import type { World } from './world';

/**
 * Nexto — the RLGym-trained Rocket League bot by Rolv-Arild & co. (github.com/Rolv-Arild/Necto,
 * CC BY-NC-SA 4.0), running in plain TypeScript: its policy network (an attention "perceiver" over
 * the ball, cars and boost pads, ~445k weights from public/assets/nexto/nexto.bin, exported by
 * tools/nexto-export.py) and its observation builder, picking one of 90 control sets every 8 ticks.
 */

const D = 128;
const HEADS = 4;
const HD = D / HEADS;
const SCALE = Math.sqrt(HD);

/** The network's weights (PyTorch layout: Linear weight = [out][in], row-major). */
interface Weights {
  table: Float32Array; // 90 × 8 action table
  q0w: Float32Array; q0b: Float32Array; q2w: Float32Array; q2b: Float32Array;
  k0w: Float32Array; k0b: Float32Array; k2w: Float32Array; k2b: Float32Array;
  blocks: Array<{
    inW: Float32Array; inB: Float32Array; outW: Float32Array; outB: Float32Array;
    l1w: Float32Array; l1b: Float32Array; l2w: Float32Array; l2b: Float32Array;
    n1w: Float32Array; n1b: Float32Array; n2w: Float32Array; n2b: Float32Array; n3w: Float32Array; n3b: Float32Array;
  }>;
  /** Action embeddings (90 × 32), precomputed from the table through the output MLP. */
  actEmb: Float32Array;
  embW: Float32Array; embB: Float32Array;
}

let W: Weights | null = null;

/** Load the exported weights (call once: the client fetches the file, the server / tools read it from disk). */
export function setNextoWeights(flat: Float32Array): void {
  let o = 0;
  const take = (n: number) => {
    const a = flat.subarray(o, o + n);
    o += n;
    return a;
  };
  const table = take(90 * 8);
  const q0w = take(128 * 32), q0b = take(128), q2w = take(128 * 128), q2b = take(128);
  const k0w = take(128 * 24), k0b = take(128), k2w = take(128 * 128), k2b = take(128);
  const blocks: Weights['blocks'] = [];
  for (let b = 0; b < 2; b++)
    blocks.push({
      inW: take(384 * 128), inB: take(384), outW: take(128 * 128), outB: take(128),
      l1w: take(512 * 128), l1b: take(512), l2w: take(128 * 512), l2b: take(128),
      n1w: take(128), n1b: take(128), n2w: take(128), n2b: take(128), n3w: take(128), n3b: take(128),
    });
  const o0w = take(32 * 8), o0b = take(32), o2w = take(32 * 32), o2b = take(32), o4w = take(32 * 32), o4b = take(32);
  const embW = take(32 * 128), embB = take(32);
  if (o !== flat.length) throw new Error(`nexto weights: expected ${o} floats, got ${flat.length}`);
  // Action embeddings never change: run the table through the output MLP once.
  const actEmb = new Float32Array(90 * 32);
  const h1 = new Float32Array(32), h2 = new Float32Array(32), h3 = new Float32Array(32);
  for (let a = 0; a < 90; a++) {
    linear(table.subarray(a * 8, a * 8 + 8), o0w, o0b, h1, 8, 32, true);
    linear(h1, o2w, o2b, h2, 32, 32, true);
    linear(h2, o4w, o4b, h3, 32, 32, true);
    actEmb.set(h3, a * 32);
  }
  W = { table, q0w, q0b, q2w, q2b, k0w, k0b, k2w, k2b, blocks, actEmb, embW, embB };
  for (let a = 0; a < 90; a++) {
    BOOSTS[a] = table[a * 8 + 6]! > 0 ? 1 : 0;
    MIRROR[a] = a;
    for (let b = 0; b < 90; b++) {
      let same = true;
      for (let k = 0; k < 8; k++) if (table[b * 8 + k]! !== table[a * 8 + k]! * (k === 1 || k === 3 || k === 4 ? -1 : 1) && !(table[a * 8 + k] === 0 && table[b * 8 + k] === 0)) same = false;
      if (same) {
        MIRROR[a] = b;
        break;
      }
    }
  }
}

export const nextoReady = (): boolean => W !== null;

/** y = W·x + b (optionally ReLU). Four accumulators: lets the JIT keep several multiply-adds in flight. */
function linear(x: Float32Array, w: Float32Array, b: Float32Array, y: Float32Array, nIn: number, nOut: number, relu: boolean, xo = 0, yo = 0): void {
  const n4 = nIn & ~3;
  for (let i = 0; i < nOut; i++) {
    let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
    const r = i * nIn;
    let j = 0;
    for (; j < n4; j += 4) {
      s0 += w[r + j]! * x[xo + j]!;
      s1 += w[r + j + 1]! * x[xo + j + 1]!;
      s2 += w[r + j + 2]! * x[xo + j + 2]!;
      s3 += w[r + j + 3]! * x[xo + j + 3]!;
    }
    let s = b[i]! + s0 + s1 + s2 + s3;
    for (; j < nIn; j++) s += w[r + j]! * x[xo + j]!;
    y[yo + i] = relu && s < 0 ? 0 : s;
  }
}

function layerNorm(x: Float32Array, g: Float32Array, b: Float32Array, y: Float32Array, n: number, xo = 0, yo = 0): void {
  let mean = 0;
  for (let i = 0; i < n; i++) mean += x[xo + i]!;
  mean /= n;
  let v = 0;
  for (let i = 0; i < n; i++) {
    const d = x[xo + i]! - mean;
    v += d * d;
  }
  const inv = 1 / Math.sqrt(v / n + 1e-5);
  for (let i = 0; i < n; i++) y[yo + i] = (x[xo + i]! - mean) * inv * g[i]! + b[i]!;
}

// Scratch buffers (one inference at a time).
const MAX_E = 48;
const sQ = new Float32Array(D), sQ2 = new Float32Array(D), sQn = new Float32Array(D);
const sKV1 = new Float32Array(MAX_E * D), sKV = new Float32Array(MAX_E * D), sKVn = new Float32Array(MAX_E * D);
const sK = new Float32Array(MAX_E * D), sV = new Float32Array(MAX_E * D);
const sQp = new Float32Array(D), sAtt = new Float32Array(D), sAo = new Float32Array(D), sH = new Float32Array(512), sF = new Float32Array(D);
const sScore = new Float32Array(MAX_E), sEmb = new Float32Array(32);

/** The policy: query (32) and entities (n × 24) → logits for the 90 actions (written to `logits`). */
export function nextoForward(q: Float32Array, kv: Float32Array, n: number, logits: Float32Array): void {
  const w = W!;
  // Preprocess the query and the entities.
  linear(q, w.q0w, w.q0b, sQ2, 32, D, true);
  linear(sQ2, w.q2w, w.q2b, sQ, D, D, true);
  for (let e = 0; e < n; e++) {
    linear(kv, w.k0w, w.k0b, sKV1, 24, D, true, e * 24, e * D);
    linear(sKV1, w.k2w, w.k2b, sKV, D, D, true, e * D, e * D);
  }
  for (const b of w.blocks) {
    // Multi-head attention: query = norm1(q), keys / values = norm2(kv).
    layerNorm(sQ, b.n1w, b.n1b, sQn, D);
    for (let e = 0; e < n; e++) layerNorm(sKV, b.n2w, b.n2b, sKVn, D, e * D, e * D);
    linear(sQn, b.inW, b.inB, sQp, D, D, false);
    const kW = b.inW.subarray(D * D, 2 * D * D), kB = b.inB.subarray(D, 2 * D);
    const vW = b.inW.subarray(2 * D * D, 3 * D * D), vB = b.inB.subarray(2 * D, 3 * D);
    for (let e = 0; e < n; e++) {
      linear(sKVn, kW, kB, sK, D, D, false, e * D, e * D);
      linear(sKVn, vW, vB, sV, D, D, false, e * D, e * D);
    }
    for (let h = 0; h < HEADS; h++) {
      const ho = h * HD;
      let max = -Infinity;
      for (let e = 0; e < n; e++) {
        let s = 0;
        for (let i = 0; i < HD; i++) s += sQp[ho + i]! * sK[e * D + ho + i]!;
        s /= SCALE;
        sScore[e] = s;
        if (s > max) max = s;
      }
      let sum = 0;
      for (let e = 0; e < n; e++) {
        const x = Math.exp(sScore[e]! - max);
        sScore[e] = x;
        sum += x;
      }
      for (let i = 0; i < HD; i++) {
        let s = 0;
        for (let e = 0; e < n; e++) s += sScore[e]! * sV[e * D + ho + i]!;
        sAtt[ho + i] = s / sum;
      }
    }
    linear(sAtt, b.outW, b.outB, sAo, D, D, false);
    for (let i = 0; i < D; i++) sQ[i] = sQ[i]! + sAo[i]!;
    // Feed-forward: q += linear2(relu(linear1(norm3(q)))).
    layerNorm(sQ, b.n3w, b.n3b, sQn, D);
    linear(sQn, b.l1w, b.l1b, sH, D, 512, true);
    linear(sH, b.l2w, b.l2b, sF, 512, D, false);
    for (let i = 0; i < D; i++) sQ[i] = sQ[i]! + sF[i]!;
  }
  // Output: relu → 32-d embedding, dotted with each action's embedding.
  for (let i = 0; i < D; i++) if (sQ[i]! < 0) sQ[i] = 0;
  linear(sQ, w.embW, w.embB, sEmb, D, 32, false);
  for (let a = 0; a < 90; a++) {
    let s = 0;
    for (let i = 0; i < 32; i++) s += w.actEmb[a * 32 + i]! * sEmb[i]!;
    logits[a] = s;
  }
}

/** Action `a` of the 90 as controls (throttle, steer, pitch, yaw, roll, jump, boost, handbrake). */
export function nextoAction(a: number): readonly number[] {
  return Array.from(W!.table.subarray(a * 8, a * 8 + 8));
}

// ------------------------------------------------------------------ observation

/** Nexto's boost pad order (by y, then x) → our pad index (same 34 spots). */
const NX_PADS: Array<[number, number, number]> = [
  [0, -4240, 70], [-1792, -4184, 70], [1792, -4184, 70], [-3072, -4096, 73], [3072, -4096, 73], [-940, -3308, 70], [940, -3308, 70],
  [0, -2816, 70], [-3584, -2484, 70], [3584, -2484, 70], [-1788, -2300, 70], [1788, -2300, 70], [-2048, -1036, 70], [0, -1024, 70],
  [2048, -1036, 70], [-3584, 0, 73], [-1024, 0, 70], [1024, 0, 70], [3584, 0, 73], [-2048, 1036, 70], [0, 1024, 70], [2048, 1036, 70],
  [-1788, 2300, 70], [1788, 2300, 70], [-3584, 2484, 70], [3584, 2484, 70], [0, 2816, 70], [-940, 3310, 70], [940, 3308, 70],
  [-3072, 4096, 73], [3072, 4096, 73], [-1792, 4184, 70], [1792, 4184, 70], [0, 4240, 70],
];
const PAD_MAP = NX_PADS.map(([x, y]) => {
  let best = 0;
  BOOST_PADS.forEach((p, i) => {
    if (Math.hypot(p.x - x, p.y - y) < Math.hypot(BOOST_PADS[best]!.x - x, BOOST_PADS[best]!.y - y)) best = i;
  });
  return best;
});

// Entity feature layout (24): is self / mate / opp / ball / boost, pos(3), vel(3), forward(3), up(3), angvel(3),
// boost, demolished, on ground, has flip. The query adds the previous action (8).
const POS = 5, VEL = 8, FW = 11, UP = 14, ANG = 17, BOOST = 20, DEMO = 21, GROUND = 22, FLIP = 23;
const NORM = [1, 1, 1, 1, 1, 2300, 2300, 2300, 2300, 2300, 2300, 1, 1, 1, 1, 1, 1, 5.5, 5.5, 5.5, 1, 1, 1, 1];

/** Build the observation for `car` into `q` (32) and `kv` (n × 24); returns n. Orange sees the field turned round. */
export function nextoObs(w: World, car: Car, prevAction: readonly number[], q: Float32Array, kv: Float32Array, misread?: Float32Array, mirror = false): number {
  const inv = car.team === 1 ? -1 : 1;
  /** Mirrored left-right view (x negated, spin y / z negated) for the averaged decision. */
  const mx = mirror ? -1 : 1;
  const players = [car, ...w.cars.filter((c) => c !== car && c.team === car.team), ...w.cars.filter((c) => c.team !== car.team)];
  kv.fill(0);
  let e = 0;
  const put = (k: number, x: number, y: number, z: number) => {
    kv[e * 24 + k] = MX * mx * x * inv;
    kv[e * 24 + k + 1] = y * inv;
    kv[e * 24 + k + 2] = z;
  };
  /** Angular velocity (an axial vector: a mirror would flip y and z instead). */
  const spin = (x: number, y: number, z: number) => {
    kv[e * 24 + ANG] = x * inv;
    kv[e * 24 + ANG + 1] = MX * mx * y * inv;
    kv[e * 24 + ANG + 2] = MX * mx * z;
  };
  for (const c of players) {
    const o = e * 24;
    kv[o + 0] = c === car ? 1 : 0;
    kv[o + (c.team === car.team ? 1 : 2)] = 1;
    put(POS, c.pos.x, c.pos.y, c.pos.z);
    put(VEL, c.vel.x, c.vel.y, c.vel.z);
    put(FW, c.forward.x, c.forward.y, c.forward.z);
    put(UP, c.up.x, c.up.y, c.up.z);
    spin(c.angVel.x, c.angVel.y, c.angVel.z);
    kv[o + BOOST] = c.boost / 100;
    kv[o + DEMO] = c.demolished ? 1 : 0;
    kv[o + GROUND] = c.onGround ? 1 : 0;
    kv[o + FLIP] = !c.hasFlipped && !c.hasDoubleJumped && (c.onGround || c.airTimeSinceJump < 1.25) ? 1 : 0;
    e++;
  }
  const b = w.ball;
  const mr = misread;
  kv[e * 24 + 3] = 1;
  put(POS, b.pos.x + (mr?.[0] ?? 0), b.pos.y + (mr?.[1] ?? 0), Math.max(92, b.pos.z + (mr?.[2] ?? 0)));
  put(VEL, b.vel.x + (mr?.[3] ?? 0), b.vel.y + (mr?.[4] ?? 0), b.vel.z + (mr?.[5] ?? 0));
  spin(b.angVel.x, b.angVel.y, b.angVel.z);
  e++;
  for (let i = 0; i < 34; i++) {
    const [x, y, z] = NX_PADS[i]!;
    const o = e * 24;
    kv[o + 4] = 1;
    put(POS, x, y, z);
    kv[o + BOOST] = z > 72 ? 1 : 0.12;
    kv[o + DEMO] = w.pads[PAD_MAP[i]!]!.timer <= 0 ? 1 : 0;
    e++;
  }
  // Normalise; the query is our own (absolute) features plus the last action.
  for (let i = 0; i < e; i++) for (let k = 0; k < 24; k++) kv[i * 24 + k] = kv[i * 24 + k]! / NORM[k]!;
  for (let k = 0; k < 24; k++) q[k] = kv[k]!;
  for (let k = 0; k < 8; k++) q[24 + k] = prevAction[k]! * (mirror && (k === 1 || k === 3 || k === 4) ? -1 : 1);
  // Everything else relative to us: positions minus ours, x / y rotated into our heading.
  const fx = q[FW]!, fy = q[FW + 1]!;
  const th = Math.atan2(fx, fy);
  const ct = Math.cos(th), st = Math.sin(th);
  for (let i = 0; i < e; i++) {
    const o = i * 24;
    for (let k = 0; k < 3; k++) kv[o + POS + k] = kv[o + POS + k]! - q[POS + k]!;
    for (const s of [POS, VEL, FW, UP, ANG]) {
      const x = kv[o + s]!, y = kv[o + s + 1]!;
      kv[o + s] = ct * x - st * y;
      kv[o + s + 1] = st * x + ct * y;
    }
  }
  return e;
}

// ------------------------------------------------------------------ driver

/**
 * Frame conventions. Our sim keeps Rocket League's numbers (positions, velocities, spin) but is drawn
 * right-handed, so a positive steer turns the other way: positions go in as they are (MX = 1) and steer /
 * yaw / roll change sign coming out. (Mirroring x going in and keeping the signs works too — measured the same.)
 */
const MX = 1;
const CS = -1;
const CR = -1;

/**
 * How well a Nexto-driven car plays — the knobs that turn the GC-level policy into lower ranks:
 *   beta   Nexto's own randomness knob (1 = always its best action; lower samples worse ones more often)
 *   skip   ticks between decisions (Nexto: 8 → 15 a second)
 *   delay  reaction time: ticks before a decision takes effect
 *   misread  how wrong it reads the ball (uu, uu/s per 1000 of speed), drifting every half second
 *   air    chance a jump may turn into a boosted aerial (0 = never flies, 1 = always can)
 */
export interface NextoProfile {
  beta: number;
  skip: number;
  delay: number;
  misread: number;
  air: number;
  /** Average the decision over the real view and its mirror image (twice the cost, steadier choices). */
  mirror?: boolean;
}

/** Remembered per car between decisions. */
interface CarState {
  prev: number[];
  held: Controls;
  /** Decisions waiting out the reaction time. */
  queue: Array<{ at: number; c: Controls }>;
  /** This jump may fly (rolled at take-off). */
  airOK: boolean;
  wasGround: boolean;
  misread: Float32Array;
  misreadAt: number;
}

/** Drives cars with the Nexto policy: a decision every `skip` ticks per car (staggered), held in between. */
export class NextoDriver {
  private readonly cars = new Map<number, CarState>();
  private readonly q = new Float32Array(32);
  private readonly kv = new Float32Array(MAX_E * 24);
  private readonly logits = new Float32Array(90);
  private readonly logits2 = new Float32Array(90);
  private readonly logits3 = new Float32Array(90);
  private rng: number;

  constructor(
    private readonly world: World,
    readonly profile: NextoProfile = { beta: 1, skip: 8, delay: 0, misread: 0, air: 1 },
  ) {
    this.rng = (world.rng ^ 0x85ebca6b) >>> 0 || 1;
  }

  private rand(): number {
    this.rng = (Math.imul(this.rng, 1664525) + 1013904223) >>> 0;
    return this.rng / 4294967296;
  }

  private gauss(): number {
    return (this.rand() + this.rand() + this.rand() - 1.5) * 2;
  }

  /** Controls for `car` this tick (deciding when its turn comes round). */
  controls(car: Car): Controls {
    const w = this.world;
    const P = this.profile;
    let st = this.cars.get(car.id);
    if (!st) {
      st = { prev: [0, 0, 0, 0, 0, 0, 0, 0], held: { ...NO_CONTROLS }, queue: [], airOK: true, wasGround: true, misread: new Float32Array(6), misreadAt: -1 };
      this.cars.set(car.id, st);
    }
    // A new jump: may this one become an aerial?
    if (st.wasGround && !car.onGround) st.airOK = P.air >= 1 || this.rand() < P.air;
    st.wasGround = car.onGround;
    if ((w.tickCount + car.id * 3) % P.skip === 0) {
      if (P.misread > 0 && w.tickCount >= st.misreadAt) {
        // Misjudging the ball: a read that drifts every half second (worse the faster it's going).
        st.misreadAt = w.tickCount + 60;
        const sp = w.ball.vel.length() / 1000;
        for (let k = 0; k < 3; k++) st.misread[k] = this.gauss() * P.misread;
        for (let k = 3; k < 6; k++) st.misread[k] = this.gauss() * P.misread * (0.5 + sp);
      }
      const n = nextoObs(w, car, st.prev, this.q, this.kv, P.misread > 0 ? st.misread : undefined);
      nextoForward(this.q, this.kv, n, this.logits);
      if (P.mirror) {
        // Ask again with the field mirrored and average, mapping each mirrored action back (steer / yaw / roll flip).
        this.logits2.set(this.logits);
        nextoObs(w, car, st.prev, this.q, this.kv, P.misread > 0 ? st.misread : undefined, true);
        nextoForward(this.q, this.kv, n, this.logits);
        for (let a = 0; a < 90; a++) this.logits3[a] = (this.logits2[a]! + this.logits[MIRROR[a]!]!) / 2;
        this.logits.set(this.logits3);
      }
      // No aerial this jump: boosting in the air is off the table.
      if (!car.onGround && !st.airOK) for (let a = 0; a < 90; a++) if (BOOSTS[a]) this.logits[a] = -Infinity;
      const best = this.pick(P.beta);
      const act = nextoAction(best);
      st.prev = act as number[];
      // Into our controls: steer, yaw and roll change sign (see MX / CS / CR).
      const c: Controls = { throttle: act[0]!, steer: CS * act[1]!, pitch: act[2]!, yaw: CS * act[3]!, roll: CR * act[4]!, jump: act[5]! > 0, boost: act[6]! > 0, handbrake: act[7]! > 0 };
      if (P.delay > 0) st.queue.push({ at: w.tickCount + P.delay, c });
      else st.held = c;
    }
    while (st.queue.length && st.queue[0]!.at <= w.tickCount) st.held = st.queue.shift()!.c;
    return st.held;
  }

  /** Nexto's action choice: argmax at beta 1, otherwise sampling with logits sharpened by log₃((1+β)/(1−β)). */
  private pick(beta: number): number {
    const L = this.logits;
    if (beta >= 1) {
      let best = 0;
      for (let a = 1; a < 90; a++) if (L[a]! > L[best]!) best = a;
      return best;
    }
    const k = Math.log((1 + beta) / (1 - beta)) / Math.log(3);
    let max = -Infinity;
    for (let a = 0; a < 90; a++) if (L[a]! > max) max = L[a]!;
    let sum = 0;
    for (let a = 0; a < 90; a++) {
      const x = L[a] === -Infinity ? 0 : Math.exp((L[a]! - max) * k);
      L[a] = x;
      sum += x;
    }
    let r = this.rand() * sum;
    for (let a = 0; a < 90; a++) {
      r -= L[a]!;
      if (r <= 0) return a;
    }
    return 89;
  }
}

/** Which of the 90 actions boost; each action's mirror image (steer / yaw / roll negated). Filled when the weights load. */
const BOOSTS = new Uint8Array(90);
const MIRROR = new Uint8Array(90);
