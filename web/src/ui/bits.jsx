// Shared primitives (spec §2.2): inline-SVG Icon set (no emoji), Toggle, Toasts,
// Skeletons, SectionHead — plus the press/throttle/format/motion helpers every tile shares.
import { Show, For, createSignal, createEffect, onCleanup } from 'solid-js';

/* ---------------- icons: 24x24 stroke set, rendered via innerHTML so one def serves many ---------------- */
const I = {
  bulb: '<path d="M9.5 18h5M10.5 21h3M12 3a6 6 0 0 0-3.9 10.6c.6.5.9 1.3.9 2.1v.3h6v-.3c0-.8.3-1.6.9-2.1A6 6 0 0 0 12 3z"/>',
  fan: '<circle cx="12" cy="12" r="1.6"/><path d="M12 10.4c0-4 1.2-6.9 3-6.9 1.6 0 2.6 1.8 1 4.1-1.2 1.7-4 2.8-4 2.8zm1.6 1.6c4 0 6.9 1.2 6.9 3 0 1.6-1.8 2.6-4.1 1-1.7-1.2-2.8-4-2.8-4zM12 13.6c0 4-1.2 6.9-3 6.9-1.6 0-2.6-1.8-1-4.1 1.2-1.7 4-2.8 4-2.8zm-1.6-1.6c-4 0-6.9-1.2-6.9-3 0-1.6 1.8-2.6 4.1-1 1.7 1.2 2.8 4 2.8 4z"/>',
  snowflake: '<path d="M12 2v20M3.3 7l17.4 10M20.7 7L3.3 17M12 2l-2 2.5M12 2l2 2.5M12 22l-2-2.5M12 22l2-2.5"/>',
  blind: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 8h16M4 13h16M15 17.5h.01"/>',
  droplet: '<path d="M12 3s6 6.4 6 10.2A6 6 0 0 1 6 13.2C6 9.4 12 3 12 3z"/>',
  power: '<path d="M12 3v8M6.2 6.8a8 8 0 1 0 11.6 0"/>',
  plug: '<path d="M9 2.5v5M15 2.5v5M6.5 7.5h11l-.8 4.6a5 5 0 0 1-9.4 0zM12 16.5V21"/>',
  bolt: '<path d="M13 2 4.5 13.5h6L11 22l8.5-11.5h-6z"/>',
  flame: '<path d="M12 3c1.2 3.4-3.5 5-3.5 8.7a3.5 3.5 0 0 0 7 0c0-1-.4-1.9-.4-1.9 1.9 1.1 3.4 3 3.4 5.4A6.5 6.5 0 1 1 5.5 15C5.5 10.4 10 8.5 12 3z"/>',
  waves: '<path d="M3 8c2-2 4-2 6 0s4 2 6 0 4-2 6 0M3 16c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/>',
  stairs: '<path d="M3 20h4.5v-4.5H12V11h4.5V6.5H21"/>',
  thermo: '<path d="M10 4a2 2 0 1 1 4 0v9.3a4.5 4.5 0 1 1-4 0z"/>',
  home: '<path d="M3 11.2 12 3l9 8.2M5.5 9.5V21h13V9.5"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5z"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9L6.6 20l1-6.1L3.2 9.5l6.1-.9z"/>',
  user: '<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20.5c1.6-3.8 4.6-5.5 7.5-5.5s5.9 1.7 7.5 5.5"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="1.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  'chevron-up': '<path d="m6 15 6-6 6 6"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'chevron-right': '<path d="m9 6 6 6-6 6"/>',
};
export function Icon(props) {
  return <svg class={'icon' + (props.class ? ' ' + props.class : '')} width={props.size || 20} height={props.size || 20}
    viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true" innerHTML={I[props.name] || I.bulb} />;
}

/* ---------------- helpers ---------------- */
// throttle for slider onInput (≥150ms between sends, trailing call kept; pair with onChange for the final commit)
export function throttle(fn, ms = 150) {
  let last = 0, t;
  return (...a) => {
    const now = Date.now(); clearTimeout(t);
    if (now - last >= ms) { last = now; fn(...a); }
    else t = setTimeout(() => { last = Date.now(); fn(...a); }, ms - (now - last));
  };
}
export const fmtW = (p) => p == null ? null : p >= 1000 ? (p / 1000).toFixed(1) + ' kW' : Math.round(p) + ' W';

// commit haptic (only on commit — never on hold-start/cancel): vibrate where supported;
// iOS fallback = clicking a hidden <input type=checkbox switch> (system tick on 17.4+)
export function haptic() {
  try {
    if (navigator.vibrate) return navigator.vibrate([12, 60, 12]);
    const el = Object.assign(document.createElement('input'), { type: 'checkbox' });
    el.setAttribute('switch', ''); el.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.append(el); el.click(); el.remove();
  } catch {}
}

/* ---------------- hold-to-commit (tap-safety) ----------------
   pointerdown → 80ms intent timer (scroll touchdowns never flash) → visual fill + JS commit timer
   (CSS fill is purely visual). >tolPx move / pointercancel / pointerleave cancels; the post-commit
   synthetic click and all bare clicks are swallowed — a quick tap shows only a transient 'Hold' hint.
   Keyboard: Enter/Space arms ('Press again to confirm', 3s auto-disarm), second press commits. */
let guardT = 0;
export const holdGuard = () => Date.now() - guardT < 400; // a hold gesture just happened — don't navigate
export function useHold(commit, { ms = 600, intent = 80, tolPx = 10 } = {}) {
  const [holding, setHolding] = createSignal(false);
  const [hint, setHint] = createSignal(false);
  const [armed, setArmed] = createSignal(false);
  let iT, cT, hT, aT, x0, y0, down = false;
  const stop = () => { clearTimeout(iT); clearTimeout(cT); setHolding(false); };
  const cancel = () => { if (!down) return; down = false; guardT = Date.now(); stop(); };
  const fire = () => { down = false; guardT = Date.now(); stop(); setHint(false); haptic(); commit(); };
  onCleanup(() => [iT, cT, hT, aT].forEach(clearTimeout));
  return {
    holding, hint, armed,
    props: {
      onPointerDown: (e) => { if (e.button > 0) return; down = true; guardT = Date.now(); x0 = e.clientX; y0 = e.clientY;
        stop(); iT = setTimeout(() => { setHolding(true); cT = setTimeout(fire, ms); }, intent); },
      onPointerMove: (e) => { if (down && Math.hypot(e.clientX - x0, e.clientY - y0) > tolPx) cancel(); },
      onPointerUp: () => { if (!down) return; cancel();                       // released early: teach via hint
        setHint(true); clearTimeout(hT); hT = setTimeout(() => setHint(false), 1300); },
      onPointerCancel: cancel, onPointerLeave: cancel,
      onContextMenu: (e) => e.preventDefault(),
      onClick: (e) => { e.preventDefault(); e.stopPropagation();
        if (e.detail) return;                                                 // pointer clicks swallowed
        if (armed()) { clearTimeout(aT); setArmed(false); haptic(); commit(); }
        else { setArmed(true); clearTimeout(aT); aT = setTimeout(() => setArmed(false), 3000); } },
    },
  };
}

// tap-anywhere + long-press(400ms, cancel on >8px move) + contextmenu → detail (spec §2.2 Tile)
export function pressHandlers({ tap, hold }) {
  let t, x0, y0, held = false;
  const cancel = () => clearTimeout(t);
  return {
    onPointerDown: (e) => { held = false; x0 = e.clientX; y0 = e.clientY; cancel();
      if (hold) t = setTimeout(() => { held = true; navigator.vibrate?.(10); hold(); }, 400); },
    onPointerMove: (e) => { if (Math.hypot(e.clientX - x0, e.clientY - y0) > 8) cancel(); },
    onPointerUp: cancel, onPointerLeave: cancel, onPointerCancel: cancel,
    onClick: (e) => { if (held) { held = false; e.preventDefault(); e.stopPropagation(); return; } tap?.(e); },
    onContextMenu: hold ? (e) => { e.preventDefault(); cancel(); hold(); } : undefined,
  };
}

/* ---------------- motion helpers (spec §3) ---------------- */
// INITIAL-LOAD-ONLY stagger: the first tile to mount opens a ~900ms window (covers 12×18ms
// delays + the 320ms animation); anything mounted after it — route changes, filters, data
// deltas — returns null and gets no entry animation. Call once at component setup (non-reactive).
let introT = null, introOver = false;
export function introIndex(i) {
  if (introOver || i == null) return null;
  introT ??= setTimeout(() => { introOver = true; }, 900);
  return Math.min(i, 12);
}

// icon spring on toggle (1 → 1.15 → 1): returns [pop(), kick]; re-kick restarts the animation
export function usePop() {
  const [on, setOn] = createSignal(false);
  let t;
  return [on, () => { setOn(false); requestAnimationFrame(() => setOn(true)); clearTimeout(t); t = setTimeout(() => setOn(false), 420); }];
}

// number tween: rAF lerp ~300ms decel (§3 "Numbers"); snaps on first value, '–' when null
export function Num(props) {
  const [d, setD] = createSignal(props.value);
  let raf;
  createEffect((prev) => {
    const to = props.value;
    cancelAnimationFrame(raf);
    if (to == null || Number.isNaN(+to)) { setD(to); return to; }
    if (prev == null || Number.isNaN(+prev)) { setD(+to); return to; }
    const from = +prev, t0 = performance.now();
    const step = (now) => { const k = Math.min(1, (now - t0) / 300);
      setD(from + (+to - from) * (1 - (1 - k) ** 3));
      if (k < 1) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    return to;
  }, props.value);
  onCleanup(() => cancelAnimationFrame(raf));
  const dp = () => props.dp ?? Math.min(1, (String(props.value).split('.')[1] || '').length);
  return <span class="num">{d() == null || Number.isNaN(+d()) ? '–' : (+d()).toFixed(dp())}</span>;
}

/* ---------------- Toggle: 52x32 sprung switch; optional hold = press-and-hold-to-commit ---------------- */
export function Toggle(props) {
  const h = props.hold ? useHold(() => props.onChange?.(!props.checked), props.hold === true ? {} : props.hold) : null;
  return (
    <button type="button" class="tgl" role="switch" aria-checked={!!props.checked}
      aria-label={h?.armed() ? 'Press again to confirm' : props.label}
      aria-busy={!!props.pending}
      classList={{ on: !!props.checked, pending: !!props.pending, holdable: !!h, holding: !!h?.holding(), armed: !!h?.armed() }}
      {...(h ? h.props : { onClick: (e) => { e.stopPropagation(); props.onChange?.(!props.checked); } })}>
      <Show when={h}><span class="hold-fill" /></Show>
      <span class="tgl-thumb" />
      <Show when={h?.hint()}><span class="hold-tip">Hold</span></Show>
    </button>
  );
}

/* ---------------- Toasts / Skeletons ---------------- */
export function Toasts(props) {
  return <div class="toasts" role="status"><For each={props.items}>{(t) => (
    <div class="toast" classList={{ [t.kind]: !!t.kind }}>{t.msg}
      <Show when={t.action}><button class="toast-act" onClick={() => t.action.fn()}>{t.action.label}</button></Show>
    </div>)}</For></div>;
}
export function Skeletons(props) {
  return <div class={props.class || 'grid2'}>{Array.from({ length: props.n ?? 8 }).map(() => <div class="skeleton" />)}</div>;
}

/* ---------------- SectionHead: title · count, ambient readout, optional mini-master ---------------- */
export function SectionHead(props) {
  return (
    <div class="sec-row">
      <h3 class="sec-title">{props.title}<Show when={props.count != null}><span class="sec-count num"> {props.count}</span></Show></h3>
      <Show when={props.ambient}><span class="sec-ambient num">{props.ambient}</span></Show>
      <Show when={props.onOff}><button class="mini-master" aria-label={`Turn off ${props.title}`} onClick={props.onOff}>Off</button></Show>
    </div>
  );
}
