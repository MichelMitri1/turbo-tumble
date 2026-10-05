import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('../shared/src', import.meta.url)) },
  },
  server: { port: 5173, host: true, fs: { allow: ['..'] } },
  // The main chunk is ~5 MB, mostly Rapier's inlined WebAssembly (revisit in Phase 8).
  build: { target: 'es2022', chunkSizeWarningLimit: 6000 },
});
