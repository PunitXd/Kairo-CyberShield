// Vite config for the Kairo console.
//
// Dev: `npm run dev -w frontend` serves on localhost:5173 and proxies the API
// and the realtime socket to the Defender on :7070. The Host header is kept
// (changeOrigin: false), so the Defender's localhost-only check still applies.
// Prod (Oct 20 task 5): `vite build` output is copied into
// backend/defender/public and served by the Defender itself.

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const DEFENDER = 'http://localhost:7070';

export default defineConfig({
  plugins: [react()],
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: DEFENDER, changeOrigin: false },
      '/socket.io': { target: DEFENDER, changeOrigin: false, ws: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
