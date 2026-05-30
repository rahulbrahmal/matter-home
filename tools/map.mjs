// Build a device -> TYPE -> ROOM map. Surfaces every naming/label signal HA holds,
// so we can see how much room info exists vs. must be supplied.
import { ws, isMatter, isMatterNode, matterDeviceRef, buildModel } from './lib.mjs';
const conn = await ws();
const reg = await conn.registries();
conn.close();
const { areaName, stateOf, entsByDev } = buildModel(reg);

const md = reg.devices.filter(isMatter).filter((d) => !isMatterNode(d)); // child accessories
const nodeNum = (d) => { const p = d.via_device_id ? reg.devices.find((x) => x.id === d.via_device_id) : d; return ((matterDeviceRef(p) || '').match(/-0*([0-9A-Fa-f]+?)(?:-|$)/) || [])[1]; };

// device "type" from its entity domains + model
const typeOf = (d) => {
  const ents = entsByDev[d.id] || [];
  const domains = new Set(ents.map((e) => e.entity_id.split('.')[0]));
  const t = [];
  if (domains.has('light')) t.push('light/switch');
  if (domains.has('climate')) t.push('thermostat/AC');
  if (domains.has('cover')) t.push('cover/shade');
  if (domains.has('fan')) t.push('fan');
  if (ents.some((e) => /temperature/i.test(e.entity_id))) t.push('temp');
  if (ents.some((e) => /humidity/i.test(e.entity_id))) t.push('humidity');
  if (ents.some((e) => /power|energy|current/i.test(e.entity_id))) t.push('energy-meter');
  if (domains.has('event')) t.push('button');
  return [...new Set(t)].join('+') || d.model;
};

let withRoom = 0, withCustom = 0;
const rows = md.map((d) => {
  const area = d.area_id ? areaName[d.area_id] : null;
  const custom = d.name_by_user && d.name_by_user !== d.name ? d.name_by_user : null;
  if (area) withRoom++;
  if (custom) withCustom++;
  return { node: '0x' + nodeNum(d), model: d.model, name: d.name_by_user || d.name, custom, area, type: typeOf(d) };
});

console.log('node  type                         room            name (custom?)');
console.log('----  ---------------------------  --------------  ----------------------------------');
for (const r of rows.sort((a, b) => (a.node + a.type).localeCompare(b.node + b.type)))
  console.log(`${r.node.padEnd(5)} ${r.type.padEnd(28)} ${(r.area || '—').padEnd(15)} ${r.name}${r.custom ? '  *custom*' : ''}`);

// type histogram
const hist = {};
for (const r of rows) hist[r.type] = (hist[r.type] || 0) + 1;
console.log('\n=== device-type counts ===');
for (const [t, c] of Object.entries(hist).sort((a, b) => b[1] - a[1])) console.log(`${String(c).padStart(3)}  ${t}`);
console.log(`\nrooms assigned: ${withRoom}/${rows.length}   custom names: ${withCustom}/${rows.length}`);
process.exit(0);
