import * as THREE from 'three';
import { HANDLE_L, HEAD_L, RACKET_T, headHalfWidth, type Racket } from '../sim/rackets';

/**
 * A padel racket mesh at regulation size: the head outline for its shape, extruded 38 mm with a
 * rounded rim, drilled with ~50 holes of 13 mm, the face printed with the design, a bridge into the
 * throat and a taped handle with a wrist cord loop. Origin at the butt of the handle, +y up the racket,
 * face normal ±z.
 */
const cache = new Map<string, THREE.Group>();

function outline(r: Racket, inset: number, steps = 64): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= steps; i++) {
    const y = (i / steps) * HEAD_L;
    pts.push(new THREE.Vector2(Math.max(0.004, headHalfWidth(r.shape, y) - inset), y));
  }
  for (let i = steps; i >= 0; i--) {
    const y = (i / steps) * HEAD_L;
    pts.push(new THREE.Vector2(-Math.max(0.004, headHalfWidth(r.shape, y) - inset), y));
  }
  return pts;
}

/** The face print: base colour, sweeping accent bands, the name. */
function faceTexture(r: Racket): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 300;
  const g = c.getContext('2d')!;
  const [base, accent, trim] = r.colors;
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 300);
  g.fillStyle = accent;
  g.beginPath();
  g.moveTo(0, 300);
  g.bezierCurveTo(80, 190, 150, 210, 256, 80);
  g.lineTo(256, 140);
  g.bezierCurveTo(160, 250, 90, 240, 0, 340);
  g.fill();
  g.fillStyle = trim;
  g.globalAlpha = 0.85;
  g.beginPath();
  g.moveTo(0, 60);
  g.bezierCurveTo(70, 40, 160, 90, 256, 30);
  g.lineTo(256, 44);
  g.bezierCurveTo(160, 104, 70, 54, 0, 74);
  g.fill();
  g.globalAlpha = 1;
  g.save();
  g.translate(128, 175);
  g.rotate(-Math.PI / 2);
  g.font = 'italic 900 34px "Barlow Condensed", "Arial Narrow", sans-serif';
  g.textAlign = 'center';
  g.fillStyle = trim;
  g.fillText(r.name.split(' ')[0]!.toUpperCase(), 0, 12);
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function racketMesh(r: Racket): THREE.Group {
  const hit = cache.get(r.id);
  if (hit) return hit.clone();
  const group = new THREE.Group();
  const [base, accent, trim] = r.colors;
  // Head: outline with drilled holes, extruded.
  const shape = new THREE.Shape(outline(r, 0));
  const holes: THREE.Path[] = [];
  const hr = 0.0065;
  for (let y = 0.075; y < HEAD_L - 0.03; y += 0.026) {
    const half = headHalfWidth(r.shape, y) - 0.03;
    const row = Math.round((y - 0.075) / 0.026);
    for (let x = -half + ((row % 2) * 0.013); x <= half; x += 0.026) {
      const p = new THREE.Path();
      p.absarc(x, y, hr, 0, Math.PI * 2, false);
      holes.push(p);
    }
  }
  shape.holes = holes;
  const depth = RACKET_T - 0.012;
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 3, curveSegments: 6 });
  geo.translate(0, 0, -depth / 2);
  // Face UVs: the shape's x / y over the print.
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + 0.13) / 0.26, pos.getY(i) / HEAD_L);
  const face = new THREE.MeshStandardMaterial({ map: faceTexture(r), roughness: 0.35, metalness: 0.15 });
  const rim = new THREE.MeshStandardMaterial({ color: trim, roughness: 0.3, metalness: 0.4 });
  const head = new THREE.Mesh(geo, [face, rim]);
  head.position.y = HANDLE_L;
  head.castShadow = true;
  group.add(head);
  // Frame edge band (a slightly proud rim around the outline).
  const band = new THREE.Shape(outline(r, -0.004));
  band.holes = [new THREE.Path(outline(r, 0.006))];
  const bandGeo = new THREE.ExtrudeGeometry(band, { depth: RACKET_T + 0.002, bevelEnabled: false, curveSegments: 6 });
  bandGeo.translate(0, 0, -(RACKET_T + 0.002) / 2);
  const bandMesh = new THREE.Mesh(bandGeo, new THREE.MeshStandardMaterial({ color: accent, roughness: 0.25, metalness: 0.5 }));
  bandMesh.position.y = HANDLE_L;
  group.add(bandMesh);
  // Handle: grip tape, end cap, and the wrist cord.
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.017, HANDLE_L, 10), new THREE.MeshStandardMaterial({ color: '#f1f1f1', roughness: 0.9 }));
  grip.position.y = HANDLE_L / 2;
  group.add(grip);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.012, 12), new THREE.MeshStandardMaterial({ color: base, roughness: 0.4 }));
  cap.position.y = 0.006;
  group.add(cap);
  const cord = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.003, 6, 16), new THREE.MeshStandardMaterial({ color: accent, roughness: 0.8 }));
  cord.position.set(0, -0.03, 0);
  group.add(cord);
  cache.set(r.id, group);
  return group.clone();
}
