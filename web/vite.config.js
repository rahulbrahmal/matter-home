import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

// PAGES_BASE is set by the GitHub Pages workflow to '/<repo>/'. Defaults to '/' for gateway-served builds.
export default defineConfig({
  base: process.env.PAGES_BASE || '/',
  plugins: [solid()],
  server: { proxy: { '/api': 'http://localhost:8788' } },
  build: { outDir: 'dist', emptyOutDir: true },
});
