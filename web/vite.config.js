import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

// Build ID = <git short sha>.<epoch ms, base36> — unique per build (even local rebuilds with
// uncommitted changes), debuggable via the sha. Computed ONCE at config load so the app bundle
// (via define) and dist/sw.js (via the closeBundle stamp below) always carry the same id.
const sha = (() => { try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return 'nogit'; } })();
const BUILD_ID = `${sha}.${Date.now().toString(36)}`;

// PAGES_BASE is set by the GitHub Pages workflow to '/<repo>/'. Defaults to '/' for gateway-served builds.
export default defineConfig({
  base: process.env.PAGES_BASE || '/',
  plugins: [solid(), {
    name: 'sw-build-id',
    // public/ is copied verbatim (no define transforms), so stamp sw.js after the bundle is written.
    closeBundle() {
      const p = new URL('./dist/sw.js', import.meta.url);
      try { writeFileSync(p, readFileSync(p, 'utf8').replace('__BUILD_ID__', BUILD_ID)); } catch {}
    },
  }],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  server: { proxy: { '/api': 'http://localhost:8788' } },
  build: { outDir: 'dist', emptyOutDir: true },
});
