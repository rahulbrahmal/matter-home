// Minimal PWA service worker.
// - BUILD is stamped by the sw-build-id vite plugin (closeBundle) — a new deploy = new bytes here,
//   which is what makes the browser's SW update check fire and roll the cache.
// - /api/* is NEVER touched (auth, SSE streaming, live commands go straight to network).
// - Hashed build assets (/assets/*) are cache-first (immutable).
// - Navigations are network-first with a cached app-shell fallback (offline open still renders).
const BUILD = '__BUILD_ID__';
const CACHE = 'matter-home-' + BUILD;
const SHELL = ['./', 'manifest.json', 'icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k.startsWith('matter-home-') && k !== CACHE).map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.includes('/api/')) return; // network only

  if (url.pathname.includes('/assets/')) {
    e.respondWith(
      caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      }))
    );
    return;
  }

  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('./', copy)); }
        return res;
      }).catch(() => caches.match('./'))
    );
  }
});
