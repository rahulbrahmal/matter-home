// Guaranteed update delivery: every deploy reaches every installed PWA on next foreground.
// Silent auto-update (sw.js keeps skipWaiting + clients.claim) -> one reload -> green toast.
// Loop-proof by construction (BUILD is fixed per deployed build) + three runtime guards below.
import { toast } from './store.js';

const FLAG = 'pwa-updated';     // set just before the update reload; read after to show the toast
const BRAKE = 'pwa-reload-at';  // timestamp brake: refuse reloads <10s apart

export function initPWA() {
  console.log('[home] build', __BUILD_ID__);
  if (sessionStorage.getItem(FLAG)) { sessionStorage.removeItem(FLAG); toast('Updated to the latest version', 'ok'); }
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;

  // Guard 1: very first install — claim() fires controllerchange on a previously-uncontrolled page.
  let hadController = !!navigator.serviceWorker.controller;
  let refreshing = false; // guard 2: exactly one reload per update
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) { hadController = true; return; }
    if (refreshing) return;
    if (Date.now() - (+sessionStorage.getItem(BRAKE) || 0) < 10000) return; // guard 3: 10s brake
    refreshing = true;
    sessionStorage.setItem(BRAKE, String(Date.now()));
    sessionStorage.setItem(FLAG, '1');
    location.reload();
  });

  window.addEventListener('load', () => {
    // updateViaCache:'none' so an HTTP-cached sw.js (e.g. Pages max-age=600) can't delay detection.
    navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js', { updateViaCache: 'none' }).then((reg) => {
      const check = () => reg.update().catch(() => {});
      check(); // boot
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); }); // iOS standalone resume — the workhorse
      setInterval(check, 15 * 60 * 1000); // long-lived foreground sessions
    }).catch(() => {});
  });
}
