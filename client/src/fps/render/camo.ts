import * as THREE from 'three';

/**
 * Weapon camos, CoD-style: base camos unlock with kills on that weapon, then
 * the mastery camos (Gold → Platinum → Diamond → Dark Matter).
 * Rendered with a triplanar shader in object space (the gun models have no UVs).
 */
export interface Camo {
  id: string;
  name: string;
  kills: number;
  mastery?: boolean;
  /** Pattern id in the shader. */
  pattern: number;
  c1: string;
  c2: string;
  c3: string;
  metal: number;
  rough: number;
}

export const CAMOS: Camo[] = [
  { id: 'none', name: 'Factory', kills: 0, pattern: -1, c1: '#000', c2: '#000', c3: '#000', metal: 0, rough: 0 },
  { id: 'woodland', name: 'Woodland', kills: 5, pattern: 0, c1: '#3b4a2a', c2: '#6b5a3a', c3: '#1e2418', metal: 0.05, rough: 0.8 },
  { id: 'desert', name: 'Desert', kills: 10, pattern: 0, c1: '#c2a878', c2: '#8e7650', c3: '#e0cfa8', metal: 0.05, rough: 0.8 },
  { id: 'urban', name: 'Urban', kills: 20, pattern: 0, c1: '#6e7378', c2: '#3a3e42', c3: '#a9adb0', metal: 0.05, rough: 0.75 },
  { id: 'digital', name: 'Digital', kills: 30, pattern: 1, c1: '#4a5a6a', c2: '#26303a', c3: '#7d8e9e', metal: 0.05, rough: 0.7 },
  { id: 'tiger', name: 'Tiger', kills: 45, pattern: 2, c1: '#d98a2a', c2: '#141010', c3: '#f0b050', metal: 0.05, rough: 0.6 },
  { id: 'redtiger', name: 'Red Tiger', kills: 60, pattern: 2, c1: '#b8141e', c2: '#120808', c3: '#e83a3a', metal: 0.1, rough: 0.5 },
  { id: 'cherry', name: 'Cherry Blossom', kills: 80, pattern: 3, c1: '#f2d6dc', c2: '#e05a86', c3: '#5a2a3a', metal: 0.05, rough: 0.55 },
  { id: 'gold', name: 'Gold', kills: 100, mastery: true, pattern: 4, c1: '#ffcf4a', c2: '#c48a12', c3: '#fff2b0', metal: 1, rough: 0.22 },
  { id: 'platinum', name: 'Platinum', kills: 150, mastery: true, pattern: 4, c1: '#e8ecf0', c2: '#9aa4ae', c3: '#ffffff', metal: 1, rough: 0.16 },
  { id: 'diamond', name: 'Diamond', kills: 225, mastery: true, pattern: 5, c1: '#bfe8ff', c2: '#7a6aff', c3: '#ffffff', metal: 0.6, rough: 0.05 },
  { id: 'darkmatter', name: 'Dark Matter', kills: 320, mastery: true, pattern: 6, c1: '#2a0a4a', c2: '#c040ff', c3: '#0a0010', metal: 0.5, rough: 0.2 },
];
export const CAMO = Object.fromEntries(CAMOS.map((c) => [c.id, c])) as Record<string, Camo>;

/** Shared clock for animated camos. */
export const camoTime = { value: 0 };

const GLSL_NOISE = `
float c_hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float c_noise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(c_hash(i + vec3(0,0,0)), c_hash(i + vec3(1,0,0)), f.x), mix(c_hash(i + vec3(0,1,0)), c_hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(c_hash(i + vec3(0,0,1)), c_hash(i + vec3(1,0,1)), f.x), mix(c_hash(i + vec3(0,1,1)), c_hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float c_fbm(vec3 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 4; i++) { v += a * c_noise(p); p *= 2.03; a *= 0.5; } return v; }
vec3 camoColor(vec3 p, int pat, vec3 c1, vec3 c2, vec3 c3, float t, out float spark) {
  spark = 0.0;
  if (pat == 0) { // blotches
    float n = c_fbm(p * 1.6);
    float m = c_fbm(p * 2.7 + 7.3);
    vec3 col = mix(c1, c2, smoothstep(0.45, 0.5, n));
    return mix(col, c3, smoothstep(0.55, 0.6, m));
  }
  if (pat == 1) { // digital pixels
    vec3 q = floor(p * 6.0) / 6.0;
    float n = c_fbm(q * 1.8);
    float m = c_hash(floor(p * 6.0));
    vec3 col = mix(c1, c2, step(0.5, n));
    return mix(col, c3, step(0.82, m));
  }
  if (pat == 2) { // tiger stripes
    float s = sin(p.x * 7.0 + c_fbm(p * 2.0) * 6.0 + p.y * 2.0);
    vec3 col = mix(c1, c3, c_fbm(p * 3.0));
    return mix(col, c2, smoothstep(0.35, 0.55, s));
  }
  if (pat == 3) { // blossoms
    float n = c_fbm(p * 3.0);
    float petals = smoothstep(0.62, 0.66, c_noise(p * 6.0));
    vec3 col = mix(c1, c1 * 0.9, n);
    col = mix(col, c3, smoothstep(0.6, 0.62, c_fbm(p * 1.4 + 3.0)) * 0.6);
    return mix(col, c2, petals);
  }
  if (pat == 4) { // polished metal with a brushed pattern
    float b = c_noise(vec3(p.x * 40.0, p.y * 2.0, p.z * 2.0));
    float n = c_fbm(p * 2.0);
    return mix(mix(c2, c1, 0.6 + 0.4 * n), c3, b * 0.25);
  }
  if (pat == 5) { // diamond: faceted, iridescent, sparkling
    vec3 q = floor(p * 9.0);
    float f = c_hash(q);
    vec3 irid = 0.5 + 0.5 * cos(6.2831 * (f + vec3(0.0, 0.33, 0.67)) + t * 0.6);
    spark = step(0.985, c_hash(q + floor(t * 6.0))) * 2.5;
    return mix(c1, irid, 0.55) * (0.75 + 0.5 * f);
  }
  // dark matter: flowing purple galaxy
  float n = c_fbm(p * 1.5 + vec3(t * 0.25, -t * 0.15, t * 0.1));
  float m = c_fbm(p * 3.5 - vec3(t * 0.3));
  vec3 col = mix(c3, c1, n);
  col += c2 * pow(smoothstep(0.5, 0.95, m), 3.0) * 1.6;
  spark = step(0.993, c_hash(floor(p * 30.0) + floor(t * 4.0))) * 1.5;
  return col;
}
`;

const BODY = /^(main|maindark|mainlight|wood|darkwood|black|black2|grey|gray|plastic|green|brown)/i;

/** Apply a camo to a gun model (in place). */
export function applyCamo(gun: THREE.Object3D, camoId: string): void {
  const c = CAMO[camoId] ?? CAMO.none!;
  gun.traverse((n) => {
    const m = n as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const out = mats.map((src) => {
      const base = src as THREE.MeshStandardMaterial;
      const orig = (base.userData.orig as THREE.MeshStandardMaterial | undefined) ?? base;
      if (c.pattern < 0 || !BODY.test(orig.name)) return orig;
      const mat = orig.clone();
      mat.userData.orig = orig;
      mat.metalness = c.metal;
      mat.roughness = c.rough;
      const u = { c1: { value: new THREE.Color(c.c1) }, c2: { value: new THREE.Color(c.c2) }, c3: { value: new THREE.Color(c.c3) }, pat: { value: c.pattern }, ctime: camoTime };
      mat.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, u);
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vCamoP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvCamoP = position;');
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', `#include <common>\nvarying vec3 vCamoP;\nuniform vec3 c1; uniform vec3 c2; uniform vec3 c3; uniform int pat; uniform float ctime;\nfloat camoSpark;\n${GLSL_NOISE}`)
          .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb = camoColor(vCamoP, pat, c1, c2, c3, ctime, camoSpark);')
          .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * camoSpark + (pat == 6 ? diffuseColor.rgb * 0.35 : vec3(0.0));');
      };
      // Same GLSL for every camo (only uniforms differ), so one program serves them all.
      mat.customProgramCacheKey = () => 'camo';
      return mat;
    });
    m.material = Array.isArray(m.material) ? out : out[0]!;
  });
}

/** Local camo progression (kills per weapon), stored in localStorage. */
export const progress = {
  kills(): Record<string, number> {
    try {
      return JSON.parse(localStorage.getItem('zh:kills') ?? '{}') as Record<string, number>;
    } catch {
      return {};
    }
  },
  addKill(weapon: string): string | null {
    const k = progress.kills();
    const before = k[weapon] ?? 0;
    k[weapon] = before + 1;
    try {
      localStorage.setItem('zh:kills', JSON.stringify(k));
    } catch {
      /* ignore */
    }
    const unlocked = CAMOS.find((c) => c.kills > before && c.kills <= before + 1);
    return unlocked ? unlocked.name : null;
  },
};
