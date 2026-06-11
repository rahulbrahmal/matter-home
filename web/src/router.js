// Hash router (spec §4 step 2): two routes — '#/' Home, '#/room/<id>' — plus a single
// history-aware sheet layer: back gesture closes the sheet first, then navigates.
import { createSignal } from 'solid-js';

const parse = () => {
  const m = (location.hash || '').match(/^#\/room\/(.+)$/);
  return m ? { name: 'room', room: decodeURIComponent(m[1]) } : { name: 'home' };
};

const [route, setRoute] = createSignal(parse(), { equals: (a, b) => a.name === b.name && a.room === b.room });
const [sheet, setSheet] = createSignal(null); // payload for the SheetHost, null = closed
export { route, sheet };

export function go(path, opts) {
  const h = path.startsWith('#') ? path : '#' + path;
  if (sheet()) { setSheet(null); if (history.state?.sheet) history.replaceState(null, ''); } // scrub the sheet entry
  if (location.hash === h) return;
  if (opts?.replace) { history.replaceState(history.state, '', h); setRoute(parse()); } // pager swipes don't grow the back stack
  else location.hash = h;
}

export function openSheet(payload) {
  if (!sheet()) history.pushState({ sheet: 1 }, ''); // one entry per sheet stack; back pops it
  setSheet(payload);
}

export function closeSheet() {
  if (!sheet()) return;
  if (history.state?.sheet) history.back(); // popstate clears the signal, keeping the stack clean
  else setSheet(null);
}

window.addEventListener('popstate', (e) => { if (!e.state?.sheet) setSheet(null); }); // back: close sheet, route untouched
window.addEventListener('hashchange', () => { setSheet(null); setRoute(parse()); });  // then (or directly): navigate

if (history.state?.sheet) history.replaceState(null, ''); // reload mid-sheet: nothing to restore
