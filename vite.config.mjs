import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// In production the app is loaded via Electron `loadFile` over the file:// protocol.
// Vite's default base ('/') emits ABSOLUTE asset URLs (/assets/...), which resolve to
// the filesystem ROOT under file:// → 404 → blank window. base:'./' makes them
// relative to index.html so they load. We also strip the `crossorigin` attribute Vite
// puts on the module/preload tags: under the opaque file:// origin it can trigger a
// CORS block on the module scripts (another route to a blank screen).
const stripCrossorigin = {
  name: 'strip-crossorigin-for-file-protocol',
  transformIndexHtml(html) {
    return html.replace(/\s+crossorigin(?:=("|')[^"']*\1)?/g, '');
  }
};

export default defineConfig({
  root: '.',
  base: './',
  plugins: [react(), tailwindcss(), stripCrossorigin],
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), 'src/renderer')
    }
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
