/**
 * The padel court to FIP regulations (metres): 20 × 10 m, net at z = 0 (88 cm in the middle, 92 cm
 * at the posts), service lines 6.95 m from the net. Back walls: 3 m of glass + 1 m of mesh on top.
 * Side walls: from each back wall, 2 m of 3 m glass then 2 m of 2 m glass (each topped by 1 m of
 * mesh), then 3 m mesh fencing the rest of the way to the net.
 *
 * Axes: x across the court (−5 … 5), z along it (team 0 plays the z < 0 half), y up.
 */

export const COURT = {
  halfW: 5,
  halfL: 10,
  serviceLine: 6.95,
  netCenter: 0.88,
  netPost: 0.92,
  /** Players can't get closer to the net than this (their side). */
  netGap: 0.35,
} as const;

export type Material = 'glass' | 'mesh';

/** A wall panel: the plane `axis = at` (normal pointing into the court), spanning `from…to` along the other horizontal axis and `y0…y1` up. */
export interface Panel {
  axis: 'x' | 'z';
  at: number;
  normal: 1 | -1;
  from: number;
  to: number;
  y0: number;
  y1: number;
  mat: Material;
}

/** Every panel of the cage (both ends, both sides). */
export const PANELS: Panel[] = (() => {
  const out: Panel[] = [];
  for (const s of [-1, 1] as const) {
    const back = s * COURT.halfL;
    // Back wall: glass 3 m, mesh to 4 m.
    out.push({ axis: 'z', at: back, normal: (-s) as 1 | -1, from: -COURT.halfW, to: COURT.halfW, y0: 0, y1: 3, mat: 'glass' });
    out.push({ axis: 'z', at: back, normal: (-s) as 1 | -1, from: -COURT.halfW, to: COURT.halfW, y0: 3, y1: 4, mat: 'mesh' });
    for (const side of [-1, 1] as const) {
      const x = side * COURT.halfW;
      const n = (-side) as 1 | -1;
      const span = (a: number, b: number): [number, number] => (s > 0 ? [a, b] : [-b, -a]);
      // First 2 m from the back: 3 m glass + 1 m mesh.
      let [f, t] = span(8, 10);
      out.push({ axis: 'x', at: x, normal: n, from: f, to: t, y0: 0, y1: 3, mat: 'glass' });
      out.push({ axis: 'x', at: x, normal: n, from: f, to: t, y0: 3, y1: 4, mat: 'mesh' });
      // Next 2 m: 2 m glass + 1 m mesh.
      [f, t] = span(6, 8);
      out.push({ axis: 'x', at: x, normal: n, from: f, to: t, y0: 0, y1: 2, mat: 'glass' });
      out.push({ axis: 'x', at: x, normal: n, from: f, to: t, y0: 2, y1: 3, mat: 'mesh' });
      // The rest, to the net: 3 m mesh.
      [f, t] = span(0, 6);
      out.push({ axis: 'x', at: x, normal: n, from: f, to: t, y0: 0, y1: 3, mat: 'mesh' });
    }
  }
  return out;
})();

/** Net height at x (it sags 4 cm from post to centre). */
export function netHeight(x: number): number {
  const u = Math.min(1, Math.abs(x) / COURT.halfW);
  return COURT.netCenter + (COURT.netPost - COURT.netCenter) * u * u;
}

/** Which team's half a z is in. */
export const sideOf = (z: number): 0 | 1 => (z < 0 ? 0 : 1);
/** Sign of a team's half (team 0 at z < 0). */
export const sideSign = (team: 0 | 1): -1 | 1 => (team === 0 ? -1 : 1);

/**
 * The service box a serve must land in: the receiver's half, between the net and the service line,
 * on the diagonal from the server. `serverX` sign picks the server's side (right = +x for team 0).
 */
export function serviceBox(server: 0 | 1, serverX: number): { x0: number; x1: number; z0: number; z1: number } {
  const recv = (1 - server) as 0 | 1;
  const zs = sideSign(recv);
  // Diagonal: the server on +x serves to the receiver's −x box (cross court).
  const xs = serverX >= 0 ? -1 : 1;
  const x0 = xs > 0 ? 0 : -COURT.halfW;
  const x1 = xs > 0 ? COURT.halfW : 0;
  const z0 = zs > 0 ? 0 : -COURT.serviceLine;
  const z1 = zs > 0 ? COURT.serviceLine : 0;
  return { x0, x1, z0, z1 };
}
