// Generate friendly names from the LIVE gateway model (correct type+room+baseName), write to device-map.json.
import { readFileSync, writeFileSync } from 'node:fs';
const GW = process.env.GW || 'http://localhost:8788';
const MAP = new URL('./device-map.json', import.meta.url);

function category(base = '', type = '') {
  const m = base.toLowerCase();
  if (type === 'thermostat' || m.includes('air condition') || m.includes('thermostat')) return 'AC';
  if (m.includes('curtain')) return 'Curtain';
  if (m.includes('roller') || m.includes('shade') || m.includes('blind')) return 'Blind';
  if (type === 'cover') return 'Blind';
  if (type === 'sensor' || m.includes('temp') || m.includes('humid')) return 'Climate Sensor';
  if (m.includes('dimmer')) return 'Dimmer';
  if (m.includes('20a') || m.includes('relay') || type === 'outlet') return 'Plug';
  if (m.includes('wall switch') || type === 'light' || type === 'switch') return 'Light';
  return 'Light';
}

const snap = await (await fetch(GW + '/api/snapshot')).json();
const devs = snap.devices.filter((d) => d.type !== 'other');
const groups = {};
for (const d of devs) { d._cat = category(d.baseName, d.type); (groups[`${d.room || 'Home'}|${d._cat}`] ??= []).push(d); }
const nameBySerial = {};
for (const [key, list] of Object.entries(groups)) {
  const [room, cat] = key.split('|');
  const base = room === 'Home' ? cat : `${room} ${cat}`;
  list.forEach((d, i) => { nameBySerial[d.serial] = list.length > 1 ? `${base} ${i + 1}` : base; });
}

let rows = JSON.parse(readFileSync(MAP, 'utf8'));
const haveSerials = new Set(rows.map((r) => r.serial));
for (const d of devs) if (!haveSerials.has(d.serial)) rows.push({ serial: d.serial, room: d.room || '', type: d.type });
for (const r of rows) if (nameBySerial[r.serial]) r.name = nameBySerial[r.serial];
writeFileSync(MAP, JSON.stringify(rows, null, 2));
console.log(`Named ${Object.keys(nameBySerial).length} live devices.`);
for (const d of devs.slice(0, 18)) console.log(`  ${(d.room || '-').padEnd(16)} ${d.baseName.padEnd(26)} -> ${nameBySerial[d.serial]}`);
