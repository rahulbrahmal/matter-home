// Derive the logical home structure from raw devices:
//  - zones merge several rooms into one area (shared AC, separate zone switches, consolidated blinds)
//  - each named light/gang becomes its own unit ("what you're touching")
//  - AC consolidates its "AC Power" switch(es) + room humidity sensor (no duplicate tiles)
import { view } from './store.js';

export const ZONES = [{ name: 'Living Area', rooms: ['Kitchen & Dining', 'Lounge', 'TV Area'] }];
const isLight = (t) => ['light', 'switch', 'outlet'].includes(t);
export const isAcPower = (d) => isLight(d.type) && /ac\s*power/i.test(d.name || '');

export function buildAreas(devices) {
  const zoneOf = {}; ZONES.forEach((z) => z.rooms.forEach((r) => (zoneOf[r] = z.name)));
  const byArea = {};
  for (const d of devices) { const room = d.room || 'Unassigned'; const area = zoneOf[room] || room; (byArea[area] ??= { name: area, rooms: new Set(), devs: [] }); byArea[area].devs.push(d); if (d.room) byArea[area].rooms.add(d.room); }

  return Object.values(byArea).map((a) => {
    const acs = a.devs.filter((d) => d.type === 'thermostat');
    const powers = a.devs.filter(isAcPower);
    const sensors = a.devs.filter((d) => d.type === 'sensor');
    const covers = a.devs.filter((d) => d.type === 'cover');
    const lightDevs = a.devs.filter((d) => isLight(d.type) && !isAcPower(d));

    const lights = [];
    for (const d of lightDevs) {
      const eps = d.caps?.onOff || []; // structural (stable) — NOT live state, so this doesn't recompute on toggle
      if (eps.length > 1) eps.forEach((ep, i) => lights.push({ key: `${d.id}:${ep}`, id: d.id, ep, name: d.gangs?.[ep] || `${d.name} ${i + 1}`, dimmable: false, room: d.room }));
      else if (eps.length === 1) lights.push({ key: `${d.id}:${eps[0]}`, id: d.id, ep: eps[0], name: d.name, dimmable: !!d.caps?.level, room: d.room });
    }
    // climate group: pair each AC with the room's powers + sensor; share within zone
    const climate = acs.map((ac) => ({
      ac, powers: powers.filter((p) => !p.room || !ac.room || p.room === ac.room || a.rooms.size > 1), sensor: sensors.find((s) => s.room === ac.room) || sensors[0],
    }));
    // standalone sensors only if no AC swallows them
    const looseSensors = acs.length ? [] : sensors;
    return { name: a.name, rooms: [...a.rooms], floor: a.devs.find((d) => d.floor)?.floor, climate, lights, covers, sensors: looseSensors, count: a.devs.length };
  });
}

// is the AC effectively powered? (all its power switches on)
export function acPowered(group) {
  if (!group.powers.length) return true;
  return group.powers.every((p) => view(p.id)?.state.on?.some((o) => o.on));
}
