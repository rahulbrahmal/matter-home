// Extract HA's home structure (floors/areas) + per-device room from ENTITY-level area_ids.
// Writes home.json (floors+areas) and back-fills room/floor into device-map.json (keyed by serial).
import { writeFileSync, readFileSync } from 'node:fs';
import { ws, isMatter, matterDeviceRef } from './lib.mjs';

const c = await ws();
const reg = await c.registries();
const areas = (await c.call('config/area_registry/list')).result || [];
const floors = (await c.call('config/floor_registry/list')).result || [];
c.close();

const areaById = Object.fromEntries(areas.map((a) => [a.area_id, a]));
const floorById = Object.fromEntries(floors.map((f) => [f.floor_id, f]));
const serialOf = (d) => (((d.identifiers || []).find((i) => /serial_/.test(i[1])) || [])[1] || '').replace('serial_', '');

const md = reg.devices.filter(isMatter);
const entsByDev = {}; for (const e of reg.entities) (entsByDev[e.device_id] ??= []).push(e);

// per device: dominant area from its entities (fallback device.area_id)
const rows = [];
for (const d of md) {
  const serial = serialOf(d); if (!serial) continue;
  const counts = {};
  for (const e of entsByDev[d.id] || []) { const a = e.area_id || null; if (a) counts[a] = (counts[a] || 0) + 1; }
  let areaId = d.area_id || Object.entries(counts).sort((x, y) => y[1] - x[1])[0]?.[0] || null;
  const area = areaId ? areaById[areaId] : null;
  const floor = area?.floor_id ? floorById[area.floor_id] : null;
  rows.push({ serial, room: area?.name || '', floor: floor?.name || '' });
}

// home structure (ordered)
const home = {
  floors: floors.map((f) => ({ id: f.floor_id, name: f.name, level: f.level ?? 0 })).sort((a, b) => a.level - b.level),
  areas: areas.map((a) => ({ id: a.area_id, name: a.name, floor: a.floor_id ? floorById[a.floor_id]?.name : null })),
};
writeFileSync(new URL('./home.json', import.meta.url), JSON.stringify(home, null, 2));

// merge room/floor into device-map.json
let map = []; try { map = JSON.parse(readFileSync(new URL('./device-map.json', import.meta.url))); } catch {}
const bySerial = Object.fromEntries(rows.map((r) => [r.serial, r]));
let filled = 0;
for (const row of map) { const r = bySerial[row.serial]; if (r && r.room) { row.room = r.room; row.floor = r.floor; filled++; } }
// add any serials not already present
for (const r of rows) if (!map.find((m) => m.serial === r.serial) && r.room) map.push({ serial: r.serial, room: r.room, floor: r.floor });
writeFileSync(new URL('./device-map.json', import.meta.url), JSON.stringify(map, null, 2));

const named = rows.filter((r) => r.room).length;
console.log(`home.json: ${home.floors.length} floors, ${home.areas.length} areas`);
console.log(`device rooms resolved: ${named}/${rows.length}; back-filled ${filled} into device-map.json`);
const byRoom = {}; for (const r of rows) if (r.room) byRoom[r.room] = (byRoom[r.room] || 0) + 1;
console.log('rooms:', JSON.stringify(byRoom));
process.exit(0);
