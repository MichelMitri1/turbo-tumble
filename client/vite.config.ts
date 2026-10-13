import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * MediaPipe's WebAssembly runtime (Padel's camera swings) is ~13 MB a file, so it isn't committed:
 * it's served from node_modules at /mediapipe/ in dev and copied into the build.
 */
function mediapipeWasm(): Plugin {
  const dirs = ['../node_modules/@mediapipe/tasks-vision/wasm', './node_modules/@mediapipe/tasks-vision/wasm'].map((d) => fileURLToPath(new URL(d, import.meta.url)));
  const dir = () => dirs.find((d) => existsSync(d)) ?? dirs[0]!;
  const FILES = ['vision_wasm_internal.js', 'vision_wasm_internal.wasm', 'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm'];
  return {
    name: 'mediapipe-wasm',
    configureServer(server) {
      server.middlewares.use('/mediapipe/', (req, res, next) => {
        const name = (req.url ?? '').split('?')[0]!.replace(/^\//, '');
        if (!FILES.includes(name)) return next();
        res.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        res.end(readFileSync(join(dir(), name)));
      });
    },
    generateBundle() {
      for (const f of FILES) this.emitFile({ type: 'asset', fileName: `mediapipe/${f}`, source: readFileSync(join(dir(), f)) });
    },
  };
}

export default defineConfig({
  plugins: [mediapipeWasm()],
  // Workers as ES modules in the build too (as in dev): Padel's pose worker.
  worker: { format: 'es' },
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('../shared/src', import.meta.url)) },
  },
  server: { port: 5173, host: true, fs: { allow: ['..'] } },
  // The main chunk is ~5 MB, mostly Rapier's inlined WebAssembly (revisit in Phase 8).
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 6000,
    // One page per game, plus the arcade hub at /. New games add their page here.
    rollupOptions: {
      input: {
        hub: fileURLToPath(new URL('./index.html', import.meta.url)),
        'turbo-tumble': fileURLToPath(new URL('./turbo-tumble/index.html', import.meta.url)),
        'arena-crown': fileURLToPath(new URL('./arena-crown/index.html', import.meta.url)),
        'kitten-kaboom': fileURLToPath(new URL('./kitten-kaboom/index.html', import.meta.url)),
        boostball: fileURLToPath(new URL('./boostball/index.html', import.meta.url)),
        'last-card': fileURLToPath(new URL('./last-card/index.html', import.meta.url)),
        arba3meyeh: fileURLToPath(new URL('./arba3meyeh/index.html', import.meta.url)),
        'corner-pocket': fileURLToPath(new URL('./corner-pocket/index.html', import.meta.url)),
        'zero-hour': fileURLToPath(new URL('./zero-hour/index.html', import.meta.url)),
        jackaroo: fileURLToPath(new URL('./jackaroo/index.html', import.meta.url)),
        matchday: fileURLToPath(new URL('./matchday/index.html', import.meta.url)),
        starfall: fileURLToPath(new URL('./starfall/index.html', import.meta.url)),
        'starfall-3d': fileURLToPath(new URL('./starfall-3d/index.html', import.meta.url)),
        velora: fileURLToPath(new URL('./velora/index.html', import.meta.url)),
        padel: fileURLToPath(new URL('./padel/index.html', import.meta.url)),
      },
    },
  },
});
