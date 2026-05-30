// Generate an editable device map keyed by stable Matter serial: type pre-filled, room blank.
// Carries across controllers (serial is stable), so room assignment is done once.
import { writeFileSync } from 'node:fs';
import { ws, isMatter, isMatterNode, matterDeviceRef, buildModel } from './lib.mjs';
const conn = await ws();
const reg = await conn.registries();
const nodes = reg.devices.filter(isMatterNode);
const online = {};
for (const n of nodes) online[n.id] = (await conn.nodeDiagnostics(n.id)).available;
conn.close();
const { entsByDev } = buildModel(reg);

const serialOf = (d) => (((d.identifiers || []).find((i) => /serial_/.test(i[1])) || [])[1] || '').replace('serial_', '');
const nodeNum = (d) => { const p = d.via_device_id ? reg.devices.find((x) => x.id === d.via_device_id) : d; return '0x' + (((matterDeviceRef(p) || '').match(/-0*([0-9A-Fa-f]+?)(?:-|$)/) || [])[1] || '?'); };
const typeOf = (d) => { const ents = entsByDev[d.id] || []; const dom = new Set(ents.map((e) => e.entity_id.split('.')[0]));
  if (dom.has('cover')) return 'cover';
  if (dom.has('climate')) return 'thermostat';
  if (ents.some((e) => /humidity/i.test(e.entity_id)) || ents.some((e) => /temperature/i.test(e.entity_id))) return 'sensor';
  if (dom.has('light')) return 'light';
  return 'other'; };

const md = reg.devices.filter(isMatter).filter((d) => !isMatterNode(d));
const rows = md.map((d) => ({ serial: serialOf(d), bridge: nodeNum(d), bridge_online: !!online[d.via_device_id], model: d.model, type: typeOf(d), room: '' }))
  .sort((a, b) => (a.bridge + a.type).localeCompare(b.bridge + b.type));

writeFileSync(new URL('./device-map.json', import.meta.url), JSON.stringify(rows, null, 2));
const csv = ['serial,bridge,bridge_online,type,model,room', ...rows.map((r) => `${r.serial},${r.bridge},${r.bridge_online},${r.type},"${r.model}",`)].join('\n');
writeFileSync(new URL('./device-map.csv', import.meta.url), csv + '\n');
console.log(`Wrote device-map.json and device-map.csv — ${rows.length} devices (room column blank, ready to fill).`);
console.log(`Online (mappable now): ${rows.filter((r) => r.bridge_online).length}   Offline bridges: ${rows.filter((r) => !r.bridge_online).length}`);
