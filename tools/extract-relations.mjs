// Pull HA per-entity custom names (the "exact spot" names) mapped to (serial, endpoint),
// + per-room device breakdown (ACs, 20A power switches w/ wattage, lights, covers, sensors).
import { ws, isMatter, matterDeviceRef, buildModel } from './lib.mjs';
const c = await ws();
const reg = await c.registries();
const areas = (await c.call('config/area_registry/list')).result || [];
c.close();
const { areaName, stateOf } = buildModel(reg);
const serialOf = (d) => (((d.identifiers || []).find((i) => /serial_/.test(i[1])) || [])[1] || '').replace('serial_', '');
const md = reg.devices.filter(isMatter);
const devBy = Object.fromEntries(md.map((d) => [d.id, d]));

// entity -> (serial, endpoint, name)
const names = []; // {serial, ep, domain, name, original, friendly, model, room}
for (const e of reg.entities) {
  const dev = devBy[e.device_id]; if (!dev) continue;
  const serial = serialOf(dev); if (!serial) continue;
  // unique_id: {fabric}-{node}-{devEp}-{onOffEp}-MatterLight-6-0  (or Thermostat/Cover etc.)
  const m = (e.unique_id || '').match(/-(\d+)-(\d+)-Matter(Light|OnOffPlugin|Thermostat|Cover|WindowCovering)/);
  const ep = m ? +m[2] : null;
  const st = stateOf[e.entity_id];
  const friendly = st?.attributes?.friendly_name;
  const domain = e.entity_id.split('.')[0];
  if (!['light', 'switch', 'cover', 'climate'].includes(domain)) continue;
  names.push({ serial, ep, domain, name: e.name, original: e.original_name, friendly, model: dev.model, room: dev.area_id ? areaName[dev.area_id] : null });
}

console.log('=== entities WITH a user-set custom name (the exact-spot names) ===');
const custom = names.filter((n) => n.name);
console.log(`${custom.length} of ${names.length} have a custom entity name`);
for (const n of custom.slice(0, 40)) console.log(`  serial ${n.serial.slice(-6)} ep${n.ep ?? '-'} [${n.domain}] "${n.name}"  (model ${n.model})`);

console.log('\n=== friendly_names (fallback if no custom) for lights/switches ===');
for (const n of names.filter((n) => n.domain === 'light').slice(0, 30)) console.log(`  ${n.serial.slice(-6)} ep${n.ep ?? '-'}: name="${n.name || ''}" friendly="${n.friendly || ''}" orig="${n.original || ''}"`);

// per-room device breakdown (from live gateway is better, but use HA here)
console.log('\n=== 20A / Dual-relay (wattage) devices by room ===');
for (const d of md.filter((x) => /20A|Dual Relay/i.test(x.model || ''))) {
  console.log(`  ${serialOf(d).slice(-6)} "${d.model}" room=${d.area_id ? areaName[d.area_id] : '-'}`);
}
console.log('\n=== ACs by room ===');
for (const d of md.filter((x) => /Air Cond/i.test(x.model || ''))) console.log(`  ${serialOf(d).slice(-6)} room=${d.area_id ? areaName[d.area_id] : '-'}`);
console.log('\n=== covers by room ===');
for (const d of md.filter((x) => /Curtain|Roller|Shade/i.test(x.model || ''))) console.log(`  ${serialOf(d).slice(-6)} "${d.model}" room=${d.area_id ? areaName[d.area_id] : '-'}`);
process.exit(0);
