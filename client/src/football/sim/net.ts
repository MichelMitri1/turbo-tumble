/** A soft goal net, in coordinates measured backwards from the goal line. */
export interface NetDimensions { depth: number; halfWidth: number; height: number; radius: number }
export interface NetBall { x: number; y: number; z: number; vx: number; vy: number; vz: number }
export interface NetPocket {
  surface: number;
  x: number; y: number; z: number;
  nx: number; ny: number; nz: number;
  depth: number;
  weight: number;
}

function edgeWeight(u: number, v: number): number {
  return Math.sqrt(Math.max(0, Math.sin(Math.PI * Math.max(0, Math.min(1, u))) * Math.sin(Math.PI * Math.max(0, Math.min(1, v)))));
}

/** The same contact pocket drives the ball response and the visible woven cords. */
export function netPockets(b: Pick<NetBall, 'x' | 'y' | 'z'>, n: NetDimensions): NetPocket[] {
  if (b.x < n.radius || b.x > n.depth + 1.2 || Math.abs(b.z) > n.halfWidth + 1.2 || b.y > n.height + 1.2) return [];
  const pockets: NetPocket[] = [];
  const add = (surface: number, x: number, y: number, z: number, nx: number, ny: number, nz: number, depth: number, weight: number) => {
    if (depth > 0) pockets.push({ surface, x, y, z, nx, ny, nz, depth, weight });
  };
  add(1, n.depth, b.y, b.z, 1, 0, 0, b.x + n.radius - n.depth, edgeWeight((b.z / n.halfWidth + 1) / 2, b.y / n.height));
  for (const side of [-1, 1]) add(side < 0 ? 2 : 4, b.x, b.y, side * n.halfWidth, 0, 0, side,
    side * b.z + n.radius - n.halfWidth, edgeWeight(b.x / n.depth, b.y / n.height));
  add(8, b.x, n.height, b.z, 0, 1, 0, b.y + n.radius - n.height, edgeWeight((b.z / n.halfWidth + 1) / 2, b.x / n.depth));
  return pockets;
}

/** Spring tension and cloth damping absorb a shot over several ticks rather than
 * reversing it at an invisible wall. The caught ball then drops into the goal. */
export function cushionNet(b: NetBall, n: NetDimensions, dt: number): NetPocket[] {
  const pockets = netPockets(b, n);
  for (const p of pockets) {
    const compliance = 0.12 + p.weight * 0.88;
    const stretch = 0.9 * compliance;
    const speed = b.vx * p.nx + b.vy * p.ny + b.vz * p.nz;
    const tension = 65 / compliance, damping = 18 / Math.sqrt(compliance);
    // An implicit spring remains stable at tightly anchored corners as well.
    const normal = Math.max(-0.65, (speed - tension * p.depth * dt) / (1 + damping * dt));
    const grip = Math.exp(-dt * 5);
    b.vx = (b.vx - speed * p.nx) * grip + normal * p.nx;
    b.vy = (b.vy - speed * p.ny) * grip + normal * p.ny;
    b.vz = (b.vz - speed * p.nz) * grip + normal * p.nz;
    if (p.depth > stretch) {
      const excess = p.depth - stretch;
      b.x -= p.nx * excess; b.y -= p.ny * excess; b.z -= p.nz * excess;
      const outgoing = b.vx * p.nx + b.vy * p.ny + b.vz * p.nz;
      if (outgoing > 0) { b.vx -= outgoing * p.nx; b.vy -= outgoing * p.ny; b.vz -= outgoing * p.nz; }
    }
  }
  return pockets;
}
