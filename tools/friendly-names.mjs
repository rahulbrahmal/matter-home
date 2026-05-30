// Generate human-friendly names ("{Room} {Function} [n]") into device-map.json (field `name`),
// replacing technical model names. Disambiguates duplicates within a room.
import { readFileSync, writeFileSync } from 'node:fs';
const MAP = new URL('./device-map.json', import.meta.url);
const rows = JSON.parse(readFileSync(MAP, 'utf8'));

function category(model = '', type = '') {
  const m = model.toLowerCase();
  if (type === 'thermostat' || m.includes('air condition')) return 'AC';
  if (m.includes('curtain')) return 'Curtain';
  if (m.includes('roller') || m.includes('shade') || m.includes('blind')) return 'Blind';
  if (type === 'cover') return 'Cover';
  if (m.includes('temp') || m.includes('humid') || type === 'sensor') return 'Climate Sensor';
  if (m.includes('dimmer')) return 'Dimmer';
  if (m.includes('20a') || m.includes('relay') || type === 'outlet') return 'Switch';
  if (m.includes('wall switch') || type === 'light' || type === 'switch') return 'Light';
  return 'Device';
}

// group by room+category to assign indices
const groups = {};
for (const r of rows) { r._cat = category(r.model, r.type); const key = `${r.room || 'Home'}|${r._cat}`; (groups[key] ??= []).push(r); }
for (const [key, list] of Object.entries(groups)) {
  const [room, cat] = key.split('|');
  const base = room === 'Home' ? cat : `${room} ${cat}`;
  list.forEach((r, i) => { r.name = list.length > 1 ? `${base} ${i + 1}` : base; });
}
for (const r of rows) delete r._cat;
writeFileSync(MAP, JSON.stringify(rows, null, 2));
console.log(`Named ${rows.length} devices. Sample:`);
for (const r of rows.slice(0, 14)) console.log(`  ${r.serial.slice(-6)}  ${r.model.padEnd(30)} -> ${r.name}`);
const cats = {}; for (const r of rows) { const c = category(r.model, r.type); cats[c] = (cats[c] || 0) + 1; }
console.log('categories:', JSON.stringify(cats));
