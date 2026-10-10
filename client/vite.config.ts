import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
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
        'cage-kings': fileURLToPath(new URL('./cage-kings/index.html', import.meta.url)),
        starfall: fileURLToPath(new URL('./starfall/index.html', import.meta.url)),
        'starfall-3d': fileURLToPath(new URL('./starfall-3d/index.html', import.meta.url)),
        velora: fileURLToPath(new URL('./velora/index.html', import.meta.url)),
      },
    },
  },
});
