// Gateway: matter-server -> enriched model (+ HA home structure + user customizations) ->
// SSE event stream + command API + config persistence + static SPA host.
import http from 'node:http';
import { readFile, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { MatterClient } from './matter-client.mjs';
import { makeStore, ingestNode, applyAttr, setAvailable, buildDevices, deviceState, deviceForEndpoint } from './model.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MS_URL = process.env.MS_URL || 'ws://localhost:5580/ws';
const PORT = Number(process.env.PORT || 8788);
const WEB_DIST = join(HERE, '..', 'web', 'dist');
const TOOLS = process.env.DATA_DIR || join(HERE, '..', 'tools');
const DEVICE_MAP = process.env.DEVICE_MAP || join(TOOLS, 'device-map.json');
const HOME_FILE = process.env.HOME_FILE || join(TOOLS, 'home.json');
const CONFIG_FILE = process.env.CONFIG_FILE || join(HERE, 'config.json');
const TOKEN = process.env.GW_TOKEN || '';                 // shared secret: FE password == API bearer token
if (!TOKEN) console.warn('WARNING: GW_TOKEN not set — API is UNAUTHENTICATED (dev only).');

const readJson = (p, fb) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fb; } };

// ---- base mappings (HA-derived, by serial) + home structure ----
let rooms = Object.fromEntries((readJson(DEVICE_MAP, []) || []).map((r) => [r.serial, { room: r.room || null, floor: r.floor || null, type: r.type, name: r.name || null }]));
const home = readJson(HOME_FILE, { floors: [], areas: [] });

// ---- user customizations (persisted) ----
let config = readJson(CONFIG_FILE, { devices: {}, groups: [], rooms: {}, gangs: {}, scenes: [] });
config.gangs ??= {}; config.scenes ??= [];
const saveConfig = () => { try { writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2)); } catch (e) { console.error('config save', e.message); } };

// ---- live model ----
const store = makeStore();
let devices = [];
const rebuild = () => { devices = buildDevices(store, rooms); };

function withOverrides(d) {
  const o = config.devices[d.id] || {};
  return { id: d.id, serial: d.serial, type: o.type || d.type,
    name: o.name || d.name, baseName: d.name,
    room: o.room !== undefined ? o.room : d.room, floor: d.floor,
    favorite: !!o.favorite, hidden: !!o.hidden, order: o.order ?? null, gangs: config.gangs[d.id] || {},
    caps: { onOff: d.caps.onOff, level: d.caps.level != null, cover: d.caps.cover != null, thermostat: d.caps.thermostat != null, temp: d.caps.temp != null, humidity: d.caps.humidity != null, power: d.caps.power != null },
    state: deviceState(store, d) };
}
const snapshot = () => ({ controller: client.info?.sdk_version || null, connected: client.connected,
  home, config, devices: devices.map(withOverrides) });

// ---- SSE ----
const sseClients = new Set();
const broadcast = (event, data) => { const f = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`; for (const r of sseClients) r.write(f); };
const pushDevice = (d) => broadcast('delta', withOverrides(d));
const pushSnapshot = () => broadcast('snapshot', snapshot());

// Reachability: matter-server keeps reporting a node as `available` while it silently retries an
// unreachable peer, so commands abort but state still looks live. Treat a command abort as proof the
// node is offline; any later attribute push (subscription resumed) is proof it's back. Flips broadcast
// deltas so the SPA can show "Offline" instead of failing silently.
function markNodeReachability(nodeId, available) {
  const n = store.nodes.get(nodeId);
  if (!n || (n.available !== false) === available) return; // unknown node or no change
  setAvailable(store, nodeId, available);
  for (const d of devices.filter((x) => x.nodeId === nodeId)) pushDevice(d);
}
const UNREACHABLE_RE = /unreachable|aborted|EHOSTUNREACH|timeout|no address known/i;

// ---- matter-server connection (+ reconnect) ----
let client, reconnectTimer = null, booting = false;
// One retry in flight at a time: a single failed connect can emit 'disconnected' (error + close)
// AND reject boot()'s connectMatter() — without this guard each attempt fans out into 2-3 more,
// spawning MatterClients exponentially until the heap is exhausted (OOM).
function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => { reconnectTimer = null; boot(); }, 4000);
}
async function connectMatter() {
  if (client) { try { client.close(); } catch {} client.removeAllListeners(); } // drop the prior socket + its listeners
  client = new MatterClient(MS_URL);
  client.on('attribute_updated', (data) => {
    const [node_id, path] = data; applyAttr(store, node_id, path, data[2]);
    markNodeReachability(node_id, true); // a live attribute push proves the peer is reachable again
    const d = deviceForEndpoint(devices, node_id, path.split('/')[0]);
    if (d) pushDevice(d); // else: not a surfaced control attribute — ignore (avoids full re-render churn)
  });
  client.on('node_event', (data) => broadcast('matterEvent', data));
  // structural changes -> full snapshot; routine node updates -> targeted deltas only
  for (const ev of ['node_added', 'node_removed']) client.on(ev, async () => { try { await refreshAll(); pushSnapshot(); } catch {} });
  client.on('node_updated', async (node) => {
    try {
      if (node?.node_id == null) return;
      ingestNode(store, node.attributes ? node : await client.getNode(node.node_id)); rebuild();
      for (const d of devices.filter((x) => x.nodeId === node.node_id)) pushDevice(d);
    } catch {}
  });
  client.on('disconnected', () => { broadcast('controller', { connected: false }); scheduleReconnect(); });
  await client.connect();
  await client.startListening();
  await refreshAll();
  broadcast('controller', { connected: true, controller: client.info?.sdk_version });
  pushSnapshot();
}
async function refreshAll() {
  const nodes = await client.getNodes();
  for (const n of nodes) ingestNode(store, n.attributes ? n : await client.getNode(n.node_id));
  rebuild();
}

// ---- commands ----
async function runCommand(c) {
  const d = devices.find((x) => x.id === c.id); if (!d) throw new Error('unknown device ' + c.id);
  const N = d.nodeId;
  try {
    return await dispatchCommand(c, d, N);
  } catch (e) {
    if (UNREACHABLE_RE.test(e?.message || '')) markNodeReachability(N, false); // surface "Offline" to the SPA
    throw e; // still report the failure so the client toasts
  }
}
function dispatchCommand(c, d, N) {
  switch (c.kind) {
    case 'onOff': return client.deviceCommand(N, Number(c.ep), 6, c.on ? 'on' : 'off');
    case 'level': return client.deviceCommand(N, d.caps.level, 8, 'moveToLevelWithOnOff', { level: Math.max(1, Math.round((c.value / 100) * 254)), transitionTime: 2, optionsMask: 0, optionsOverride: 0 });
    case 'cover':
      if (c.action === 'open') return client.deviceCommand(N, d.caps.cover, 258, 'upOrOpen');
      if (c.action === 'close') return client.deviceCommand(N, d.caps.cover, 258, 'downOrClose');
      if (c.action === 'stop') return client.deviceCommand(N, d.caps.cover, 258, 'stopMotion');
      return client.deviceCommand(N, d.caps.cover, 258, 'goToLiftPercentage', { liftPercent100thsValue: Math.round(c.value * 100) });
    case 'climate': return client.cmd('write_attribute', { node_id: N, attribute_path: `${d.caps.thermostat}/513/${c.field === 'heat' ? 18 : 17}`, value: Math.round(c.value * 100) });
    case 'mode': return client.cmd('write_attribute', { node_id: N, attribute_path: `${d.caps.thermostat}/513/28`, value: c.value });
    case 'identify': return client.deviceCommand(N, d.endpoint, 3, 'identify', { identifyTime: 10 });
    default: throw new Error('unknown kind ' + c.kind);
  }
}

// ---- HTTP ----
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const body = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b ? JSON.parse(b) : {})); });
const sendJson = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

function serveStatic(req, res) {
  let p = req.url.split('?')[0]; if (p === '/') p = '/index.html';
  const file = join(WEB_DIST, p);
  readFile(file, (err, buf) => {
    if (err && (p === '/sw.js' || p === '/manifest.json')) // never SPA-fallback these: HTML would poison the SW update check
      return (res.writeHead(404, { 'content-type': 'text/plain' }), res.end('not found'));
    if (err) return readFile(join(WEB_DIST, 'index.html'), (e2, idx) => e2
      ? (res.writeHead(200, { 'content-type': 'text/plain' }), res.end('Gateway up. Build the SPA: cd web && npm run build'))
      : (res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-cache' }), res.end(idx)));
    // no-store + private: Cloudflare's edge respects these (plain no-cache still gets edge-cached
    // for default extensions like .js, which would serve a stale sw.js after deploys)
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream',
      'cache-control': p.includes('/assets/') ? 'max-age=31536000, immutable' : 'no-store, no-cache, private, must-revalidate' });
    res.end(buf);
  });
}

const authed = (req) => {
  if (!TOKEN) return true;
  if (req.headers['authorization'] === 'Bearer ' + TOKEN) return true;
  try { return new URL(req.url, 'http://x').searchParams.get('token') === TOKEN; } catch { return false; }
};

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  try {
    // CORS for the hosted (Pages) FE talking to a LAN gateway
    res.setHeader('access-control-allow-origin', req.headers.origin || '*');
    res.setHeader('access-control-allow-headers', 'authorization, content-type');
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    if (url.startsWith('/api/') && !authed(req)) return sendJson(res, 401, { error: 'unauthorized' });
    if (url === '/api/health') return sendJson(res, 200, { ok: true, devices: devices.length, controller: client?.info?.sdk_version || null });
    if (url === '/api/snapshot') return sendJson(res, 200, snapshot());
    if (url === '/api/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(`retry: 3000\nevent: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`);
      sseClients.add(res); req.on('close', () => sseClients.delete(res)); return;
    }
    if (url === '/api/command' && req.method === 'POST') { await runCommand(await body(req)); return sendJson(res, 200, { ok: true }); }
    if (url === '/api/scene' && req.method === 'POST') { const { actions = [] } = await body(req); await Promise.allSettled(actions.map(runCommand)); return sendJson(res, 200, { ok: true }); }
    if (url === '/api/config' && req.method === 'POST') {
      const patch = await body(req);
      if (patch.device) config.devices[patch.device] = { ...(config.devices[patch.device] || {}), ...patch.changes };
      if (patch.gang) config.gangs[patch.gang.device] = { ...(config.gangs[patch.gang.device] || {}), [patch.gang.ep]: patch.gang.name };
      if (patch.groups) config.groups = patch.groups;
      if (patch.rooms) config.rooms = { ...config.rooms, ...patch.rooms };
      if (patch.scenes) config.scenes = patch.scenes;
      saveConfig();
      const d = patch.device && devices.find((x) => x.id === patch.device); if (d) pushDevice(d); else pushSnapshot();
      return sendJson(res, 200, { ok: true });
    }
    serveStatic(req, res);
  } catch (e) { sendJson(res, 400, { error: e.message }); }
});

// ---- boot ----
async function boot() {
  if (booting) return; // collapse overlapping boots; the in-flight one resolves or reschedules
  booting = true;
  try { await connectMatter(); }
  catch (e) { console.error('matter connect failed, retrying:', e.message); scheduleReconnect(); }
  finally { booting = false; }
}
server.listen(PORT, () => console.log(`Gateway http://localhost:${PORT}`));
boot().then(() => console.log(`Connected; ${devices.length} devices, ${home.floors.length} floors, ${home.areas.length} areas`));
