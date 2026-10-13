/** Shared goalkeeper geometry for the save pose, reach checks and held ball. */
export const KEEPER_DIVE_TIME = 1.15;
export const KEEPER_SAVE_HEIGHT = 2.8;
export const GLOVE_PALM_REACH = 0.13;
export const GLOVE_LENGTH = 0.29;
export interface KeeperPoint { x: number; y: number; z: number }
export interface KeeperShape {
  x: number; z: number; face: number; state: string; t: number;
  dive: { dz: number; dy: number } | null;
}
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
export const keeperHeight = (physical: number) => 1.8 + (physical - 70) * 0.004;

/** Sampled from the snapshot's remaining time, including paused/reverse replays. */
export function keeperDivePose(t: number, dz: number, dy: number, face: number, height: number): { roll: number; lift: number } {
  const age = clamp(KEEPER_DIVE_TIME - t, 0, KEEPER_DIVE_TIME);
  const takeoff = Math.sin(clamp(age / 0.18, 0, 1) * Math.PI / 2);
  const targetY = dy * KEEPER_SAVE_HEIGHT;
  const side = Math.sign(dz * Math.cos(face));
  const tilt = (targetY < 0.5 ? 1.42 : targetY > 1.7 ? 0.95 : 1.15) * Math.abs(dz);
  const land = clamp((age - 0.55) / 0.3, 0, 1);
  const roll = side * (tilt * takeoff * (1 - land) + 1.45 * Math.abs(dz) * land);
  const jump = clamp(targetY - height * 0.77 * Math.cos(tilt) - 0.27, 0, 1.05);
  return { roll, lift: 0.07 + jump * takeoff * (1 - land) };
}

export function keeperGeometry(gk: KeeperShape, height: number): { shoulders: [KeeperPoint, KeeperPoint]; hip: KeeperPoint; feet: KeeperPoint; reach: number } {
  const pose = gk.state === 'dive' && gk.dive ? keeperDivePose(gk.t, gk.dive.dz, gk.dive.dy, gk.face, height) : { roll: 0, lift: 0 };
  const yaw = gk.face + Math.PI / 2, cr = Math.cos(pose.roll), sr = Math.sin(pose.roll);
  const point = (x: number, y: number, z: number): KeeperPoint => {
    const rx = cr * x - sr * y;
    return { x: gk.x + Math.cos(yaw) * rx + Math.sin(yaw) * z, y: sr * x + cr * y + pose.lift,
      z: gk.z - Math.sin(yaw) * rx + Math.cos(yaw) * z };
  };
  // Proportions measured from the footballer rig, including the glove palm.
  return { shoulders: [point(height * 0.085, height * 0.77, height * 0.05), point(-height * 0.085, height * 0.77, height * 0.05)],
    hip: point(0, height * 0.46, height * 0.025), feet: point(0, 0.15, 0), reach: height * 0.23 + GLOVE_PALM_REACH + GLOVE_LENGTH / 2 };
}

/** Ball cradled between the gloves, rather than dribbled at a diving keeper's feet. */
export function keeperGrip(gk: KeeperShape, height: number): KeeperPoint {
  if (gk.state !== 'dive') return { x: gk.x + Math.cos(gk.face) * 0.35, y: 1.1, z: gk.z - Math.sin(gk.face) * 0.35 };
  const [a, b] = keeperGeometry(gk, height).shoulders;
  return { x: (a.x + b.x) / 2 + Math.cos(gk.face) * 0.22, y: Math.max(0.15, (a.y + b.y) / 2 - 0.08),
    z: (a.z + b.z) / 2 - Math.sin(gk.face) * 0.22 + (gk.dive?.dz ?? 0) * 0.16 };
}

function segmentSphere(from: KeeperPoint, to: KeeperPoint, centre: KeeperPoint, radius: number): number | null {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const x = from.x - centre.x, y = from.y - centre.y, z = from.z - centre.z;
  const c = x * x + y * y + z * z - radius * radius;
  if (c <= 0) return 0;
  const a = dx * dx + dy * dy + dz * dz;
  if (a < 1e-10) return null;
  const b = x * dx + y * dy + z * dz, d = b * b - a * c;
  if (d < 0) return null;
  const t = (-b - Math.sqrt(d)) / a;
  return t >= 0 && t <= 1 ? t : null;
}

/** Swept contact prevents a fast shot jumping past the gloves between ticks. */
export function keeperContact(gk: KeeperShape, height: number, from: KeeperPoint, to: KeeperPoint, ballRadius: number): { point: KeeperPoint; hands: boolean } | null {
  const geo = keeperGeometry(gk, height);
  let first = Infinity, hands = false;
  const test = (p: KeeperPoint, r: number, gloves: boolean) => {
    const t = segmentSphere(from, to, p, r + ballRadius);
    if (t !== null && t < first) { first = t; hands = gloves; }
  };
  for (const p of geo.shoulders) test(p, geo.reach, true);
  // Torso/leg blocks are physical saves too, including low shots straight at him.
  const chest = { x: (geo.shoulders[0].x + geo.shoulders[1].x) / 2, y: (geo.shoulders[0].y + geo.shoulders[1].y) / 2,
    z: (geo.shoulders[0].z + geo.shoulders[1].z) / 2 };
  for (const [a, b] of [[geo.feet, geo.hip], [geo.hip, chest]]) for (let i = 0; i <= 4; i++) {
    const k = i / 4;
    test({ x: a!.x + (b!.x - a!.x) * k, y: a!.y + (b!.y - a!.y) * k, z: a!.z + (b!.z - a!.z) * k }, 0.22, false);
  }
  if (!Number.isFinite(first)) return null;
  return { point: { x: from.x + (to.x - from.x) * first, y: from.y + (to.y - from.y) * first,
    z: from.z + (to.z - from.z) * first }, hands };
}
