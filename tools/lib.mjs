// Shared Home Assistant client (WebSocket for registries/diagnostics, REST for service calls).
// Config via env: HA_URL (default http://192.168.68.81:8123), HA_TOKEN (required).
import { readFileSync } from 'node:fs';

export const HA_URL = process.env.HA_URL || 'http://192.168.68.81:8123';
export function token() {
  if (process.env.HA_TOKEN) return process.env.HA_TOKEN;
  try { return readFileSync(new URL('./.token', import.meta.url), 'utf8').trim(); } catch {}
  throw new Error('Set HA_TOKEN env var (or create matter-home-tools/.token).');
}

// ---- WebSocket API ----
export async function ws() {
  const TOKEN = token();
  const url = HA_URL.replace(/^http/, 'ws') + '/api/websocket';
  const sock = new WebSocket(url);
  let id = 0; const pending = new Map();
  await new Promise((res, rej) => {
    sock.addEventListener('error', (e) => rej(new Error('WS error: ' + (e.message || e))));
    sock.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.type === 'auth_required') sock.send(JSON.stringify({ type: 'auth', access_token: TOKEN }));
      else if (m.type === 'auth_ok') res();
      else if (m.type === 'auth_invalid') rej(new Error('HA auth invalid'));
      else if (m.type === 'result' && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    });
  });
  const call = (type, extra = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); sock.send(JSON.stringify({ id: i, type, ...extra })); });
  return {
    call,
    async registries() {
      const [areas, devices, entities, states] = await Promise.all([
        call('config/area_registry/list'), call('config/device_registry/list'),
        call('config/entity_registry/list'), call('get_states'),
      ]);
      return { areas: areas.result || [], devices: devices.result || [], entities: entities.result || [], states: states.result || [] };
    },
    async nodeDiagnostics(device_id) { const r = await call('matter/node_diagnostics', { device_id }); return r.success ? r.result : { error: r.error }; },
    close: () => sock.close(),
  };
}

// ---- REST API (service calls / states) ----
async function rest(path, opts = {}) {
  const r = await fetch(HA_URL + path, { ...opts, headers: { Authorization: 'Bearer ' + token(), 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${path}: ${await r.text()}`);
  const t = await r.text(); return t ? JSON.parse(t) : null;
}
export const getStates = () => rest('/api/states');
export const getState = (eid) => rest('/api/states/' + encodeURIComponent(eid));
export const callService = (domain, service, data) => rest(`/api/services/${domain}/${service}`, { method: 'POST', body: JSON.stringify(data) });

// ---- Shared model helpers ----
export const isMatter = (d) => (d.identifiers || []).some((i) => i[0] === 'matter');
export const matterDeviceRef = (d) => ((d.identifiers || []).find((i) => /deviceid_/.test(i[1])) || [])[1] || null;
// root/bridge nodes = matter device that is itself a node (MatterNodeDevice id) or has no parent bridge
export const isMatterNode = (d) => isMatter(d) && ((d.identifiers || []).some((i) => /MatterNodeDevice/.test(i[1])) || !d.via_device_id);

export function buildModel({ areas, devices, entities, states }) {
  const areaName = Object.fromEntries(areas.map((a) => [a.area_id, a.name]));
  const stateOf = Object.fromEntries(states.map((s) => [s.entity_id, s]));
  const devName = Object.fromEntries(devices.map((d) => [d.id, d.name_by_user || d.name]));
  const entsByDev = {};
  for (const e of entities) (entsByDev[e.device_id] ??= []).push(e);
  return { areaName, stateOf, devName, entsByDev };
}
