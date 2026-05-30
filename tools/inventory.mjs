// Export the full Matter inventory as JSON + human-readable Markdown.
// Usage: HA_TOKEN=... node inventory.mjs   ->  writes inventory.json and inventory.md
import { writeFileSync } from 'node:fs';
import { ws, isMatter, isMatterNode, matterDeviceRef, buildModel } from './lib.mjs';

const conn = await ws();
const reg = await conn.registries();
const { areaName, stateOf, devName, entsByDev } = buildModel(reg);

const matterDevices = reg.devices.filter(isMatter);
const nodes = reg.devices.filter(isMatterNode);

// fabric diagnostics for each root/bridge node
const diag = {};
for (const n of nodes) diag[n.id] = await conn.nodeDiagnostics(n.id);
conn.close();

const nodeNum = (d) => { const m = (matterDeviceRef(d) || '').match(/-0*([0-9A-Fa-f]+?)(?:-|$)/); return m ? m[1] : '?'; };
// stable label per bridge node, disambiguating the identically-named hubs
const nodeLabel = (d) => `node 0x${nodeNum(d)} · ${d.model}${diag[d.id]?.available === false ? ' (OFFLINE)' : ''}`;
const bridgeLabelById = Object.fromEntries(nodes.map((n) => [n.id, nodeLabel(n)]));

const entSummary = (devId) => (entsByDev[devId] || []).map((e) => {
  const s = stateOf[e.entity_id];
  return { entity_id: e.entity_id, domain: e.entity_id.split('.')[0], name: e.original_name || e.name, state: s?.state ?? null, unit: s?.attributes?.unit_of_measurement };
});
const isUnavailable = (e) => e.state === 'unavailable';

const devicesOut = matterDevices.map((d) => {
  const ents = entSummary(d.id);
  const d2 = diag[d.id];
  return {
    name: d.name_by_user || d.name, id: d.id,
    manufacturer: d.manufacturer, model: d.model, sw_version: d.sw_version, hw_version: d.hw_version,
    area: d.area_id ? areaName[d.area_id] : null,
    matter_ref: matterDeviceRef(d),
    bridge: d.via_device_id ? (bridgeLabelById[d.via_device_id] || devName[d.via_device_id]) : null,
    bridge_id: d.via_device_id || null,
    node_label: isMatterNode(d) ? nodeLabel(d) : undefined,
    is_node: isMatterNode(d),
    diagnostics: d2 && !d2.error ? { available: d2.available, node_type: d2.node_type, network: d2.network_type, mac: d2.mac_address,
      fabrics: (d2.active_fabrics || []).map((f) => ({ vendor: f.vendor_name, label: f.fabric_label, vendor_id: f.vendor_id, index: f.fabric_index })) } : undefined,
    entities: ents, unavailable: ents.filter(isUnavailable).length, total: ents.length,
  };
});

const out = {
  generated_at_note: 'snapshot (timestamp omitted)',
  controller: { type: 'Home Assistant', fabric: '29E929390D9CEFEB', vendor: 'Open Home Foundation (vid 4939)' },
  totals: { devices: matterDevices.length, entities: devicesOut.reduce((a, d) => a + d.total, 0), unavailable_entities: devicesOut.reduce((a, d) => a + d.unavailable, 0), nodes: nodes.length, offline_nodes: devicesOut.filter((d) => d.is_node && d.diagnostics?.available === false).length },
  nodes: devicesOut.filter((d) => d.is_node),
  devices: devicesOut,
};
writeFileSync(new URL('./inventory.json', import.meta.url), JSON.stringify(out, null, 2));

// ---- Markdown ----
const L = [];
L.push('# Matter Home Inventory', '');
L.push(`- Controller: **Home Assistant** (fabric \`29E9…\`, vid 4939)`);
L.push(`- ${out.totals.devices} devices · ${out.totals.entities} entities (${out.totals.unavailable_entities} unavailable) · ${out.totals.nodes} bridge/root nodes (${out.totals.offline_nodes} offline)`, '');
L.push('## Bridge / root nodes & fabric membership', '');
L.push('| Node | Model | Online | Network | MAC | Fabrics |');
L.push('|---|---|---|---|---|---|');
for (const n of out.nodes) {
  const dg = n.diagnostics || {};
  const fabs = (dg.fabrics || []).map((f) => f.vendor.replace(' (Open Home Foundation)', '') + (f.label ? ` (${f.label})` : '')).join(', ') || '—';
  L.push(`| 0x${(n.matter_ref.match(/-0*([0-9A-Fa-f]+?)(?:-|$)/) || [])[1] || '?'} | ${n.model || ''} | ${dg.available ? '✅' : '❌ OFFLINE'} | ${dg.network || ''} | ${dg.mac || ''} | ${fabs} |`);
}
L.push('', '## Devices by bridge', '');
const byBridge = {};
for (const d of out.devices.filter((x) => !x.is_node)) (byBridge[d.bridge || '(root nodes)'] ??= []).push(d);
// order bridges by node id
for (const b of Object.keys(byBridge).sort()) {
  const list = byBridge[b];
  L.push(`### ${b}  _(${list.length} child devices)_`, '');
  for (const d of list) L.push(`- **${d.name}** — ${d.model} · ${d.area || 'no area'}${d.unavailable ? ` · ⚠️ ${d.unavailable}/${d.total} unavailable` : ''}`);
  L.push('');
}
writeFileSync(new URL('./inventory.md', import.meta.url), L.join('\n'));
console.log(`Wrote inventory.json and inventory.md — ${out.totals.devices} devices, ${out.totals.nodes} nodes (${out.totals.offline_nodes} offline), ${out.totals.unavailable_entities}/${out.totals.entities} entities unavailable.`);
