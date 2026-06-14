import { createStore, produce, reconcile } from 'solid-js/store';
import { createEffect, createRoot, createSignal } from 'solid-js';

// ---- central state: connection, home structure, devices, customizations, async overlays ----
export const [state, setState] = createStore({
  status: 'loading',          // loading | live | reconnecting | offline
  controller: null,
  home: { floors: [], areas: [] },
  config: { devices: {}, groups: [], rooms: {} },
  byId: {},                   // id -> device (with .state)
});
export const [toasts, setToasts] = createSignal([]);
const [optimistic, setOptimistic] = createSignal({}); // id -> { fields..., _t }
const [pending, setPending] = createSignal({});       // id -> count of inflight

export const isPending = (id) => (pending()[id] || 0) > 0;

function toast(msg, kind = 'error') {
  const t = { id: Math.random().toString(36).slice(2), msg, kind };
  setToasts((a) => [...a, t]);
  setTimeout(() => setToasts((a) => a.filter((x) => x.id !== t.id)), 3200);
}

const CONN_GRACE = 1000;
const connTracker = createRoot(() => {
  const [bar, setBar] = createSignal({ show: false, kind: null });
  let graceTimer, visible = false, kind = null, toastOnRecovery = false;

  createEffect(() => {
    const s = state.status;
    clearTimeout(graceTimer);

    if (s === 'reconnecting' || s === 'offline') {
      if (visible) {
        kind = s;
        setBar({ show: true, kind });
      } else {
        graceTimer = setTimeout(() => {
          if (state.status !== s) return;
          visible = true;
          kind = s;
          toastOnRecovery = true;
          setBar({ show: true, kind });
        }, CONN_GRACE);
      }
      return;
    }

    if (s === 'live' && visible && toastOnRecovery) toast('Reconnected', 'ok');
    visible = false;
    kind = null;
    toastOnRecovery = false;
    setBar({ show: false, kind: null });
  });
  return { bar };
});
export const connBar = () => connTracker.bar();

// merge optimistic overlay over the authoritative device state
export function view(id) {
  const d = state.byId[id]; if (!d) return null;
  const o = optimistic()[id];
  if (!o) return d;
  const st = { ...d.state };
  if (o.onByEp && st.on) st.on = st.on.map((e) => (o.onByEp[e.ep] != null ? { ...e, on: o.onByEp[e.ep] } : e));
  for (const k of ['brightness', 'coverPct']) if (o[k] != null) st[k] = o[k];
  if (o.climate) st.climate = { ...st.climate, ...o.climate };
  return { ...d, state: st };
}

const PENDING_SHOW_DELAY = 200;
const PENDING_MIN_VISIBLE = 350;
const OPT_MAX_SETTLE = 4000; // > polling interval (2500ms), so snapshots reconcile before fallback clears
const CMD_TIMEOUT = 5000;

let optSeq = 0;
const optTimers = new Map();
const nextOptToken = () => ++optSeq;

function mergeOpt(prev = {}, fields = {}, t) {
  return {
    ...prev,
    ...fields,
    onByEp: fields.onByEp ? { ...(prev.onByEp || {}), ...fields.onByEp } : prev.onByEp,
    climate: fields.climate ? { ...(prev.climate || {}), ...fields.climate } : prev.climate,
    _t: t,
  };
}
function hasOptFields(o) {
  return !!(o?.onByEp && Object.keys(o.onByEp).length)
    || o?.brightness != null || o?.coverPct != null
    || !!(o?.climate && Object.keys(o.climate).length);
}
function cancelOptTimer(id) {
  const t = optTimers.get(id);
  if (t) clearTimeout(t);
  optTimers.delete(id);
}
function setOpt(id, fields) {
  if (!fields) return null;
  const t = nextOptToken();
  setOptimistic((m) => ({ ...m, [id]: mergeOpt(m[id], fields, t) }));
  return t;
}
function clearOpt(id) {
  cancelOptTimer(id);
  setOptimistic((m) => { const n = { ...m }; delete n[id]; return n; });
}
function clearOptIf(id, t) {
  if (t == null || optimistic()[id]?._t !== t) return;
  clearOpt(id);
}
function scheduleOptFallback(id, t) {
  if (t == null) return;
  cancelOptTimer(id);
  optTimers.set(id, setTimeout(() => clearOptIf(id, t), OPT_MAX_SETTLE));
}
function reconcileOpt(id) {
  const o = optimistic()[id], d = state.byId[id];
  if (!o || !d?.state) return;
  let changed = false;
  const next = { ...o };

  if (next.onByEp) {
    const remaining = { ...next.onByEp };
    for (const ep of Object.keys(remaining)) {
      const actual = d.state.on?.find((x) => String(x.ep) === String(ep))?.on;
      if (actual === remaining[ep]) { delete remaining[ep]; changed = true; }
    }
    if (Object.keys(remaining).length) next.onByEp = remaining; else delete next.onByEp;
  }
  for (const k of ['brightness', 'coverPct']) {
    if (next[k] != null && d.state[k] === next[k]) { delete next[k]; changed = true; }
  }
  if (next.climate) {
    const remaining = { ...next.climate };
    for (const k of Object.keys(remaining)) {
      if (d.state.climate?.[k] === remaining[k]) { delete remaining[k]; changed = true; }
    }
    if (Object.keys(remaining).length) next.climate = remaining; else delete next.climate;
  }

  if (!changed) return;
  if (hasOptFields(next)) setOptimistic((m) => ({ ...m, [id]: next }));
  else clearOpt(id);
}
function bump(id, n) {
  setPending((m) => {
    const v = Math.max(0, (m[id] || 0) + n);
    const next = { ...m };
    if (v) next[id] = v; else delete next[id];
    return next;
  });
}

const pendingTracker = createRoot(() => {
  const [visible, setVisible] = createSignal({});
  const showTimers = new Map();
  const hideTimers = new Map();
  let prev = {};

  createEffect(() => {
    const cur = pending();
    const vis = visible();
    const ids = new Set([...Object.keys(prev), ...Object.keys(cur), ...Object.keys(vis)]);
    const now = Date.now();
    for (const id of ids) {
      const active = (cur[id] || 0) > 0;
      const shownAt = vis[id];

      if (active) {
        const h = hideTimers.get(id);
        if (h) { clearTimeout(h); hideTimers.delete(id); }
        if (!shownAt && !showTimers.has(id)) {
          showTimers.set(id, setTimeout(() => {
            showTimers.delete(id);
            if ((pending()[id] || 0) > 0) setVisible((m) => ({ ...m, [id]: Date.now() }));
          }, PENDING_SHOW_DELAY));
        }
      } else {
        const s = showTimers.get(id);
        if (s) { clearTimeout(s); showTimers.delete(id); }
        if (shownAt && !hideTimers.has(id)) {
          hideTimers.set(id, setTimeout(() => {
            hideTimers.delete(id);
            if ((pending()[id] || 0) === 0) setVisible((m) => { const n = { ...m }; delete n[id]; return n; });
          }, Math.max(0, PENDING_MIN_VISIBLE - (now - shownAt))));
        }
      }
    }
    prev = cur;
  });
  return { visible };
});
export const pendingVisible = (id) => !!pendingTracker.visible()[id];

// ---- auth / backend base (shared secret: the password IS the API bearer token) ----
export const auth = { base: localStorage.getItem('gw_url') || '', token: localStorage.getItem('gw_token') || '' };
const H = () => (auth.token ? { Authorization: 'Bearer ' + auth.token } : {});
const U = (p) => (auth.base || '') + p;
const jpost = (p, b, signal) => fetch(U(p), { method: 'POST', headers: { 'content-type': 'application/json', ...H() }, body: JSON.stringify(b), signal });
export async function login(base, token) {
  const r = await fetch((base || '') + '/api/health', { headers: token ? { Authorization: 'Bearer ' + token } : {} });
  if (!r.ok) throw new Error(r.status === 401 ? 'Wrong password' : `Can’t reach gateway (${r.status})`);
  auth.base = base || ''; auth.token = token || '';
  localStorage.setItem('gw_url', auth.base); localStorage.setItem('gw_token', auth.token);
  setState('status', 'loading'); connect();
}
export function logout() { localStorage.removeItem('gw_token'); auth.token = ''; if (es) es.close(); setState('status', 'needauth'); }

// ---- SSE connection (auto-reconnect; polling fallback for buffering proxies) ----
let es, pollTimer, sseTimer, connFails = 0;
function markLive() { connFails = 0; setState('status', 'live'); }
function markDisconnected() { setState('status', ++connFails >= 3 ? 'offline' : 'reconnecting'); }
export async function connect() {
  try {
    const r = await fetch(U('/api/health'), { headers: H() });
    if (r.status === 401) return setState('status', 'needauth');
    if (!r.ok) throw new Error('bad');
    connFails = 0;
  } catch {
    if (!auth.token && !auth.base) return setState('status', 'needauth');
    markDisconnected(); setTimeout(connect, 4000); return;
  }
  if (es) es.close();
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  let gotSnap = false;
  es = new EventSource(U('/api/stream') + (auth.token ? '?token=' + encodeURIComponent(auth.token) : ''));
  es.addEventListener('snapshot', (e) => { gotSnap = true; clearTimeout(sseTimer); applySnapshot(JSON.parse(e.data)); });
  es.addEventListener('delta', (e) => {
    const d = JSON.parse(e.data);
    if (state.byId[d.id]) setState('byId', d.id, reconcile(d, { merge: true })); else setState('byId', d.id, d);
    clearOpt(d.id);
  });
  es.addEventListener('controller', (e) => { const c = JSON.parse(e.data); c.connected ? markLive() : markDisconnected(); if (c.controller) setState('controller', c.controller); });
  es.onerror = () => { if (!gotSnap && !pollTimer) startPolling(); else markDisconnected(); };
  // proxies (e.g. Cloudflare quick tunnels) may buffer SSE; if no snapshot arrives, fall back to polling
  sseTimer = setTimeout(() => { if (!gotSnap) { try { es.close(); } catch {} startPolling(); } }, 3500);
}

function applySnapshot(s) {
  setState('home', reconcile(s.home));
  setState('config', reconcile(s.config));
  setState('controller', s.controller);
  s.connected === false ? markDisconnected() : markLive();
  setState('byId', reconcile(Object.fromEntries(s.devices.map((d) => [d.id, d])), { merge: true }));
  for (const id of Object.keys(optimistic())) reconcileOpt(id);
}
async function startPolling() {
  if (pollTimer) return;
  const tick = async () => {
    try {
      const r = await fetch(U('/api/snapshot'), { headers: H() });
      if (r.status === 401) return setState('status', 'needauth');
      if (r.ok) applySnapshot(await r.json()); else markDisconnected();
    } catch { markDisconnected(); }
  };
  await tick();
  pollTimer = setInterval(tick, 2500);
}

// ---- commands: optimistic + pending + timeout/error ----
async function send(id, body, optFields, label) {
  const myT = optFields ? setOpt(id, optFields) : null;
  bump(id, 1);
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, CMD_TIMEOUT);
  try {
    const r = await jpost('/api/command', { id, ...body }, ctrl.signal);
    if (!r.ok) { clearOptIf(id, myT); toast(`${label} failed`); }
    else scheduleOptFallback(id, myT);
  } catch { clearOptIf(id, myT); toast(timedOut ? `${label} timed out` : `${label} failed — offline?`); }
  finally { clearTimeout(timer); bump(id, -1); }
}

export const cmd = {
  toggle: (id, ep, on) => send(id, { kind: 'onOff', ep, on }, { onByEp: { [ep]: on } }, on ? 'Turn on' : 'Turn off'),
  level: (id, value) => send(id, { kind: 'level', value }, { brightness: value }, 'Set brightness'),
  cover: (id, action, value) => send(id, { kind: 'cover', action, value }, value != null ? { coverPct: value } : null, 'Cover'),
  climate: (id, field, value) => send(id, { kind: 'climate', field, value }, { climate: { [field]: value } }, 'Set temperature'),
  mode: (id, value) => send(id, { kind: 'mode', value }, { climate: { mode: value } }, 'Set mode'),
  identify: (id) => send(id, { kind: 'identify' }, null, 'Identify'),
};

// ---- customization persistence ----
export async function saveDevice(id, changes) {
  setState('config', 'devices', id, (c) => ({ ...(c || {}), ...changes })); // optimistic
  setState('byId', id, produce((d) => { if (changes.name !== undefined) d.name = changes.name || d.baseName; if (changes.room !== undefined) d.room = changes.room; if (changes.favorite !== undefined) d.favorite = changes.favorite; if (changes.hidden !== undefined) d.hidden = changes.hidden; }));
  try { await jpost('/api/config', { device: id, changes }); }
  catch { toast('Save failed'); }
}

// AC depends on its "AC Power" 20A switch: power must be ON before the AC starts.
export async function acSetMode(acId, powers, mode) {
  if (mode !== 0) {
    const off = powers.filter((p) => !view(p.id)?.state.on?.some((o) => o.on));
    for (const p of off) { const ep = view(p.id)?.state.on?.[0]?.ep; if (ep != null) cmd.toggle(p.id, ep, true); }
    if (off.length) await new Promise((r) => setTimeout(r, 1600)); // let the 20A energise before the AC
  }
  cmd.mode(acId, mode);
}
export const togglePower = (p, on) => { const ep = view(p.id)?.state.on?.[0]?.ep; if (ep != null) cmd.toggle(p.id, ep, on); };

export async function saveGang(id, ep, name) {
  setState('byId', id, 'gangs', ep, name); // optimistic
  try { await jpost('/api/config', { gang: { device: id, ep, name } }); }
  catch { toast('Save failed'); }
}

// ---- scenes ----
function optForAction(a) {
  if (a.kind === 'onOff') return { onByEp: { [a.ep]: a.on } };
  if (a.kind === 'level') return { brightness: a.value };
  if (a.kind === 'cover' && a.value != null) return { coverPct: a.value };
  if (a.kind === 'climate') return { climate: { [a.field]: a.value } };
  return null;
}
const lightTypes = ['light', 'switch', 'outlet'];
export function builtinScenes() {
  const devs = Object.values(state.byId);
  const lights = devs.filter((d) => lightTypes.includes(d.type) && !d.hidden && !/ac\s*power/i.test(d.name || ''));
  const dimmers = devs.filter((d) => d.type === 'light' && d.caps?.level && !d.hidden);
  const acs = devs.filter((d) => d.type === 'thermostat' && !d.hidden);
  const onActs = (on) => lights.flatMap((d) => (view(d.id)?.state.on || []).map((o) => ({ id: d.id, kind: 'onOff', ep: o.ep, on })));
  return [
    { id: 'all-off', name: 'All Off', icon: '🌙', sub: `${lights.length} lights`, actions: () => onActs(false) },
    { id: 'all-on', name: 'All On', icon: '☀️', sub: `${lights.length} lights`, actions: () => onActs(true) },
    { id: 'cool', name: 'Cool', icon: '❄️', sub: `${acs.length} ACs · 22°`, actions: () => acs.map((d) => ({ id: d.id, kind: 'climate', field: 'cool', value: 22 })) },
    { id: 'cozy', name: 'Cozy', icon: '🕯️', sub: `${dimmers.length} dimmers`, actions: () => dimmers.flatMap((d) => [...(view(d.id)?.state.on || []).map((o) => ({ id: d.id, kind: 'onOff', ep: o.ep, on: true })), { id: d.id, kind: 'level', value: 25 }]) },
  ];
}
export async function runScene(actions) {
  const touched = [], bumped = [];
  for (const a of actions) {
    const opt = optForAction(a);
    const t = opt ? setOpt(a.id, opt) : null;
    if (t != null) touched.push([a.id, t]);
    bump(a.id, 1); bumped.push(a.id);
  }
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, CMD_TIMEOUT);
  try {
    const r = await jpost('/api/scene', { actions }, ctrl.signal);
    if (!r.ok) {
      for (const [id, t] of touched) clearOptIf(id, t);
      toast('Scene failed');
    } else {
      for (const [id, t] of touched) scheduleOptFallback(id, t);
    }
  } catch {
    for (const [id, t] of touched) clearOptIf(id, t);
    toast(timedOut ? 'Scene timed out' : 'Scene failed');
  } finally {
    clearTimeout(timer);
    for (const id of bumped) bump(id, -1);
  }
}

export { toast };
