import { createStore, produce, reconcile } from 'solid-js/store';
import { createSignal } from 'solid-js';

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

function setOpt(id, fields) { setOptimistic((m) => ({ ...m, [id]: { ...(m[id] || {}), ...fields, _t: Date.now() } })); }
function clearOpt(id) { setOptimistic((m) => { const n = { ...m }; delete n[id]; return n; }); }
function bump(id, n) { setPending((m) => ({ ...m, [id]: Math.max(0, (m[id] || 0) + n) })); }

// ---- auth / backend base (shared secret: the password IS the API bearer token) ----
export const auth = { base: localStorage.getItem('gw_url') || '', token: localStorage.getItem('gw_token') || '' };
const H = () => (auth.token ? { Authorization: 'Bearer ' + auth.token } : {});
const U = (p) => (auth.base || '') + p;
const jpost = (p, b) => fetch(U(p), { method: 'POST', headers: { 'content-type': 'application/json', ...H() }, body: JSON.stringify(b) });
export async function login(base, token) {
  const r = await fetch((base || '') + '/api/health', { headers: token ? { Authorization: 'Bearer ' + token } : {} });
  if (!r.ok) throw new Error(r.status === 401 ? 'Wrong password' : `Can’t reach gateway (${r.status})`);
  auth.base = base || ''; auth.token = token || '';
  localStorage.setItem('gw_url', auth.base); localStorage.setItem('gw_token', auth.token);
  setState('status', 'loading'); connect();
}
export function logout() { localStorage.removeItem('gw_token'); auth.token = ''; if (es) es.close(); setState('status', 'needauth'); }

// ---- SSE connection (auto-reconnect; polling fallback for buffering proxies) ----
let es, pollTimer, sseTimer;
export async function connect() {
  try {
    const r = await fetch(U('/api/health'), { headers: H() });
    if (r.status === 401) return setState('status', 'needauth');
    if (!r.ok) throw new Error('bad');
  } catch {
    if (!auth.token && !auth.base) return setState('status', 'needauth');
    setState('status', 'reconnecting'); setTimeout(connect, 4000); return;
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
  es.addEventListener('controller', (e) => { const c = JSON.parse(e.data); setState('status', c.connected ? 'live' : 'reconnecting'); if (c.controller) setState('controller', c.controller); });
  es.onerror = () => { if (!gotSnap && !pollTimer) startPolling(); else setState('status', 'reconnecting'); };
  // proxies (e.g. Cloudflare quick tunnels) may buffer SSE; if no snapshot arrives, fall back to polling
  sseTimer = setTimeout(() => { if (!gotSnap) { try { es.close(); } catch {} startPolling(); } }, 3500);
}

function applySnapshot(s) {
  setState('home', reconcile(s.home));
  setState('config', reconcile(s.config));
  setState('controller', s.controller);
  setState('status', s.connected === false ? 'reconnecting' : 'live');
  setState('byId', reconcile(Object.fromEntries(s.devices.map((d) => [d.id, d])), { merge: true }));
}
async function startPolling() {
  if (pollTimer) return;
  const tick = async () => { try { const r = await fetch(U('/api/snapshot'), { headers: H() }); if (r.ok) applySnapshot(await r.json()); } catch {} };
  await tick();
  pollTimer = setInterval(tick, 2500);
}

// ---- commands: optimistic + pending + timeout/error ----
async function send(id, body, optFields, label) {
  if (optFields) setOpt(id, optFields);
  bump(id, 1);
  const timer = setTimeout(() => { clearOpt(id); toast(`${label} timed out`); }, 5000);
  try {
    const r = await jpost('/api/command', { id, ...body });
    if (!r.ok) { clearOpt(id); toast(`${label} failed`); }
  } catch { clearOpt(id); toast(`${label} failed — offline?`); }
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
  // optimistic for onOff actions
  for (const a of actions) if (a.kind === 'onOff') setOpt(a.id, { onByEp: { [a.ep]: a.on } });
  try { await jpost('/api/scene', { actions }); }
  catch { toast('Scene failed'); }
}

export { toast };
