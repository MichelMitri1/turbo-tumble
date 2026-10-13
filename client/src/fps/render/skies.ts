import * as THREE from 'three';

/**
 * Photographed skies (Poly Haven "puresky" HDRIs, tone-mapped to 2k LDR by tools/fps-realism.mjs).
 * `sunAz` / `sunEl`: where the sun is in the image (radians: u = az / 2π, v from the top), so the
 * sky can be turned to put it where the map's sunlight comes from. `horizon`: the fog colour.
 */
export type SkyName = 'day' | 'dusk' | 'overcast' | 'night' | 'snow';
export const SKY_SCAN: Record<SkyName, { sunAz: number; sunEl: number; horizon: string; grade: [number, number, number] }> = {
  day: { sunAz: 3.7364, sunEl: 0.8344, horizon: '#bec1cc', grade: [1, 1, 1] },
  dusk: { sunAz: 3.8023, sunEl: 0.0368, horizon: '#958d89', grade: [1.08, 0.96, 0.9] },
  overcast: { sunAz: 3.6623, sunEl: 0.4065, horizon: '#9ea2a8', grade: [0.98, 1, 1.02] },
  night: { sunAz: 4.9228, sunEl: 1.4757, horizon: '#535654', grade: [0.55, 0.68, 1.05] },
  snow: { sunAz: 3.8977, sunEl: 0.2994, horizon: '#b1b1ae', grade: [0.98, 1, 1.03] },
};

const textures = new Map<SkyName, THREE.Texture>();
const loading = new Map<SkyName, Promise<THREE.Texture | null>>();

export function loadSky(name: SkyName): Promise<THREE.Texture | null> {
  let p = loading.get(name);
  if (!p) {
    p = new THREE.TextureLoader()
      .loadAsync(`/assets/fps/sky/${name}.webp`)
      .then((t) => {
        t.mapping = THREE.EquirectangularReflectionMapping;
        t.colorSpace = THREE.SRGBColorSpace;
        t.generateMipmaps = false;
        t.minFilter = THREE.LinearFilter;
        textures.set(name, t);
        return t;
      })
      .catch(() => null);
    loading.set(name, p);
  }
  return p;
}

export function skyTexture(name: SkyName): THREE.Texture | undefined {
  return textures.get(name);
}

/** The horizon colour, graded like the dome (sRGB hex). */
export function skyHorizon(name: SkyName): THREE.Color {
  const s = SKY_SCAN[name];
  const c = new THREE.Color(s.horizon);
  return c.setRGB(c.r * s.grade[0], c.g * s.grade[1], c.b * s.grade[2]);
}

/**
 * A sky dome showing the photo as-is (no tone mapping or fog), turned so its sun sits at
 * `sunDir`'s compass bearing. Drawn first, behind everything.
 */
export function skyDome(name: SkyName, sunDir: THREE.Vector3): THREE.Mesh | null {
  const tex = textures.get(name);
  if (!tex) return null;
  const s = SKY_SCAN[name];
  // Bearing of the map's sun in the dome's convention: atan2(x, −z).
  const want = Math.atan2(sunDir.x, -sunDir.z);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    toneMapped: false,
    uniforms: { map: { value: tex }, turn: { value: s.sunAz - want }, grade: { value: new THREE.Vector3(...s.grade) } },
    // Direction from the eye (the dome is far bigger than any map, so there's no visible parallax).
    vertexShader: 'varying vec3 vDir; void main(){ vDir = (modelMatrix * vec4(position, 1.0)).xyz - cameraPosition; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vDir; uniform sampler2D map; uniform float turn; uniform vec3 grade;
      void main(){
        vec3 d = normalize(vDir);
        float u = fract((atan(d.x, -d.z) + turn) / 6.28318530718);
        // Below the horizon: hold the horizon row (the ground and fog cover it anyway).
        float v = 0.5 + asin(clamp(max(d.y, 0.004), -1.0, 1.0)) / 3.14159265359;
        vec3 c = texture2D(map, vec2(u, v)).rgb * grade;
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(500, 48, 24), mat);
  m.renderOrder = -1000;
  m.frustumCulled = false;
  return m;
}

/** Image-based lighting from the sky (PMREM), for reflections and soft fill on the scanned surfaces. */
export function skyEnvironment(renderer: THREE.WebGLRenderer, name: SkyName): THREE.Texture | null {
  const tex = textures.get(name);
  if (!tex) return null;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(tex).texture;
  pmrem.dispose();
  return env;
}
