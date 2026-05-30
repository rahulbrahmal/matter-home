// Restore the user's exact HA entity names onto our gateway: per-gang names + single-device names,
// mapped by (serial, onOff endpoint). Idempotent — POSTs to gateway /api/config.
import { ws, isMatter, buildModel } from './lib.mjs';
const GW = process.env.GW || 'http://localhost:8788';

const c = await ws();
const reg = await c.registries();
c.close();
const { stateOf } = buildModel(reg);
const serialOf = (d) => (((d.identifiers || []).find((i) => /serial_/.test(i[1])) || [])[1] || '').replace('serial_', '');
const devBy = Object.fromEntries(reg.devices.filter(isMatter).map((d) => [d.id, d]));

// (serial, onOffEp) -> name  and  serial -> {climate, cover}
const byEp = {}; const byDevSingle = {};
for (const e of reg.entities) {
  const dev = devBy[e.device_id]; if (!dev) continue; const serial = serialOf(dev); if (!serial) continue;
  const nm = e.name || stateOf[e.entity_id]?.attributes?.friendly_name || e.original_name; if (!nm) continue;
  const domain = e.entity_id.split('.')[0];
  const m = (e.unique_id || '').match(/-(\d+)-(\d+)-Matter(Light|OnOffPlugin|Cover|WindowCovering)/);
  if ((domain === 'light' || domain === 'switch') && m) byEp[`${serial}:${+m[2]}`] = nm;
  if (domain === 'cover') byDevSingle[serial] = nm;
  if (domain === 'climate') byDevSingle[serial] = nm;
}

const snap = await (await fetch(GW + '/api/snapshot')).json();
let gangs = 0, devs = 0;
for (const d of snap.devices) {
  const eps = (d.state.on || []).map((o) => o.ep);
  if (eps.length > 1) {
    for (const ep of eps) { const nm = byEp[`${d.serial}:${ep}`]; if (nm) { await post({ gang: { device: d.id, ep, name: nm } }); gangs++; } }
  } else if (eps.length === 1) {
    const nm = byEp[`${d.serial}:${eps[0]}`]; if (nm) { await post({ device: d.id, changes: { name: nm } }); devs++; }
  } else if (d.type === 'thermostat' || d.type === 'cover') {
    const nm = byDevSingle[d.serial]; if (nm) { await post({ device: d.id, changes: { name: nm } }); devs++; }
  }
}
console.log(`Restored ${devs} device names + ${gangs} gang names from HA.`);
async function post(body) { await fetch(GW + '/api/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); }
