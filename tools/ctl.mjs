#!/usr/bin/env node
// matterctl — read & control your Matter fleet via Home Assistant.
// Reads are always safe. Control commands are DRY-RUN unless you pass --apply.
//
//   node ctl.mjs rooms                         list areas + device counts
//   node ctl.mjs bridges                       list Matter bridge nodes (status + fabrics)
//   node ctl.mjs list [filters]                list entities (--area X, --domain light, --on, --off, --unavailable, --grep TEXT)
//   node ctl.mjs get <entity_id>               full state + attributes
//   node ctl.mjs on|off|toggle <target> [--apply]      light/switch (target = entity_id or name)
//   node ctl.mjs bri <target> <0-100> [--apply]        set brightness %
//   node ctl.mjs cover <target> open|close|stop|<0-100> [--apply]
//   node ctl.mjs climate <target> <temp> [--apply]     set thermostat target temp
import { ws, getStates, callService, buildModel, isMatter } from './lib.mjs';

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const positional = argv.filter((a, i) => !a.startsWith('--') && !(argv[i - 1] && argv[i - 1].startsWith('--') && !['--on', '--off', '--unavailable', '--apply'].includes(argv[i - 1])));
const cmd = positional[0];

async function loadModel() {
  const conn = await ws();
  const reg = await conn.registries();
  conn.close();
  const m = buildModel(reg);
  const matterDevIds = new Set(reg.devices.filter(isMatter).map((d) => d.id));
  // entity_id -> {device, area, matter}
  const entMeta = {};
  for (const e of reg.entities) {
    const dev = reg.devices.find((d) => d.id === e.device_id);
    entMeta[e.entity_id] = { device: dev, area: dev?.area_id ? m.areaName[dev.area_id] : null, matter: matterDevIds.has(e.device_id), name: e.original_name || e.name, devName: dev ? (dev.name_by_user || dev.name) : null };
  }
  return { reg, m, entMeta, matterDevIds };
}

function fmtState(s) { return s.state + (s.attributes?.unit_of_measurement ? ' ' + s.attributes.unit_of_measurement : ''); }

async function resolveTarget(target, domains) {
  // entity_id directly, else fuzzy match by friendly name across given domains
  const states = await getStates();
  if (target.includes('.')) { const s = states.find((x) => x.entity_id === target); if (!s) throw new Error('No such entity: ' + target); return s.entity_id; }
  const t = target.toLowerCase();
  const cands = states.filter((s) => domains.includes(s.entity_id.split('.')[0]) && (s.attributes?.friendly_name || '').toLowerCase().includes(t));
  if (cands.length === 0) throw new Error(`No ${domains.join('/')} entity matching "${target}"`);
  if (cands.length > 1) { console.error(`Ambiguous "${target}":`); cands.slice(0, 10).forEach((c) => console.error('   ', c.entity_id, '·', c.attributes?.friendly_name)); throw new Error('Be more specific or use the entity_id.'); }
  return cands[0].entity_id;
}

async function doService(domain, service, data, label) {
  if (!APPLY) { console.log(`DRY-RUN  would call ${domain}.${service}  ${JSON.stringify(data)}   (${label})`); console.log('         re-run with --apply to execute.'); return; }
  await callService(domain, service, data);
  console.log(`OK  ${domain}.${service}  ${JSON.stringify(data)}   (${label})`);
}

switch (cmd) {
  case 'rooms': {
    const { reg, m } = await loadModel();
    const counts = {};
    for (const d of reg.devices.filter(isMatter)) { const a = d.area_id ? m.areaName[d.area_id] : '(no area)'; counts[a] = (counts[a] || 0) + 1; }
    for (const [a, c] of Object.entries(counts).sort((x, y) => y[1] - x[1])) console.log(`${String(c).padStart(3)}  ${a}`);
    break;
  }
  case 'bridges': {
    const conn = await ws();
    const reg = await conn.registries();
    const nodes = reg.devices.filter((d) => isMatter(d) && ((d.identifiers || []).some((i) => /MatterNodeDevice/.test(i[1])) || !d.via_device_id));
    for (const n of nodes) {
      const d = await conn.nodeDiagnostics(n.id);
      const node = (((n.identifiers || []).find((i) => /deviceid_/.test(i[1])) || [])[1] || '').match(/-0*([0-9A-Fa-f]+?)(?:-|$)/)?.[1];
      const fabs = (d.active_fabrics || []).map((f) => f.vendor_name.replace(' (Open Home Foundation)', '') + (f.fabric_label ? `(${f.fabric_label})` : '')).join(', ');
      console.log(`0x${node}  ${d.available ? '✅' : '❌ OFFLINE'}  ${(n.model || '').padEnd(26)} ${d.network_type || ''}  [${fabs}]`);
    }
    conn.close();
    break;
  }
  case 'list': {
    const { entMeta } = await loadModel();
    const states = await getStates();
    const area = flag('--area'), domain = flag('--domain'), grep = flag('--grep');
    let rows = states.filter((s) => entMeta[s.entity_id]?.matter);
    if (domain) rows = rows.filter((s) => s.entity_id.startsWith(domain + '.'));
    if (area) rows = rows.filter((s) => (entMeta[s.entity_id]?.area || '').toLowerCase() === area.toLowerCase());
    if (argv.includes('--on')) rows = rows.filter((s) => s.state === 'on');
    if (argv.includes('--off')) rows = rows.filter((s) => s.state === 'off');
    if (argv.includes('--unavailable')) rows = rows.filter((s) => s.state === 'unavailable');
    if (grep) rows = rows.filter((s) => (s.attributes?.friendly_name || s.entity_id).toLowerCase().includes(grep.toLowerCase()));
    rows.sort((a, b) => a.entity_id.localeCompare(b.entity_id));
    for (const s of rows) console.log(`${fmtState(s).padEnd(10)} ${s.entity_id.padEnd(52)} ${(entMeta[s.entity_id]?.area || '-')}`);
    console.log(`\n${rows.length} entities`);
    break;
  }
  case 'get': {
    const s = (await getStates()).find((x) => x.entity_id === positional[1]);
    if (!s) { console.error('No such entity'); process.exit(1); }
    console.log(JSON.stringify(s, null, 2));
    break;
  }
  case 'on': case 'off': case 'toggle': {
    const eid = await resolveTarget(positional[1], ['light', 'switch', 'fan', 'climate']);
    const domain = eid.split('.')[0];
    const service = cmd === 'toggle' ? 'toggle' : `turn_${cmd}`;
    await doService(domain, service, { entity_id: eid }, eid);
    break;
  }
  case 'bri': {
    const eid = await resolveTarget(positional[1], ['light']);
    await doService('light', 'turn_on', { entity_id: eid, brightness_pct: Number(positional[2]) }, eid);
    break;
  }
  case 'cover': {
    const eid = await resolveTarget(positional[1], ['cover']);
    const arg = positional[2];
    if (arg === 'open') await doService('cover', 'open_cover', { entity_id: eid }, eid);
    else if (arg === 'close') await doService('cover', 'close_cover', { entity_id: eid }, eid);
    else if (arg === 'stop') await doService('cover', 'stop_cover', { entity_id: eid }, eid);
    else await doService('cover', 'set_cover_position', { entity_id: eid, position: Number(arg) }, eid);
    break;
  }
  case 'climate': {
    const eid = await resolveTarget(positional[1], ['climate']);
    await doService('climate', 'set_temperature', { entity_id: eid, temperature: Number(positional[2]) }, eid);
    break;
  }
  default:
    console.log(`matterctl — control your Matter fleet via Home Assistant\n
  rooms                         areas + Matter device counts
  bridges                       Matter bridge nodes (status + fabrics)
  list [--area X --domain light --on --off --unavailable --grep TEXT]
  get <entity_id>               full state + attributes
  on|off|toggle <target>        [--apply]   (target = entity_id or name)
  bri <target> <0-100>          [--apply]
  cover <target> open|close|stop|<pos>  [--apply]
  climate <target> <temp>       [--apply]

Reads are safe. Control commands are DRY-RUN unless --apply is given.
Env: HA_URL (default http://192.168.68.81:8123), HA_TOKEN (required).`);
}
process.exit(0);
