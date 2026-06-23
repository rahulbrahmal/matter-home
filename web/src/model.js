// Redesign data model (spec §1). Additive for now: home.js still drives the old UI.
//  - circuits: one unit per named gang; duplicate names on one device FUSE (fan-out cmd, state = OR)
//  - roles (regex on gang name, not device.type) drive grouping + what "Lights off" may touch
//  - climate groups: AC + its AC-Power switch(es) + hub-bound sensor (+ zone powers for Living Area)
//  - rooms: curated Room[] incl. the Living Area zone and the synthetic Outdoor room
import { createRoot, createMemo } from 'solid-js';
import { state, view, cmd, pendingVisible, runScene, setToasts } from './store.js';

export const ZONES = [{ name: 'Living Area', rooms: ['Kitchen & Dining', 'Lounge', 'TV Area'] }];
const isLight = (t) => ['light', 'switch', 'outlet'].includes(t);
export const isAcPower = (d) => isLight(d.type) && /ac\s*power/i.test(d.name || '');
// is the AC effectively powered? (all its power switches on)
export function acPowered(group) {
  if (!group.powers.length) return true;
  return group.powers.every((p) => view(p.id)?.state.on?.some((o) => o.on));
}

/* ---------------- roles ---------------- */
const ROLES = [
  [/relay/i, 'relay-hidden'],
  [/^spare$/i, 'spare-hidden'],
  [/staircase circuit/i, 'circuit-master'],   // Essentials Staircase chip + hidden drawer, never a peer light
  [/^fan$/i, 'fan'],
  [/exhaust/i, 'exhaust'],
  [/vanity|shower|bathroom/i, 'bathroom'],
  [/external/i, 'external'],
  [/closet|cupboard|store room/i, 'utility-light'],
  [/^(main light|dining lights|landing lights|overhead lights|ceiling light|wall dimmer|guest bedroom hall)$/i, 'primary-light'],
];
const APPLIANCES = ['Water Pump', 'Water Heater'];
export const roleOf = (name) =>
  APPLIANCES.includes(name) ? 'appliance'
  : /ac\s*power/i.test(name) ? 'ac-power'
  : ROLES.find(([re]) => re.test(name))?.[1] || 'accent-light';

const HEROES = new Set(['3:54ef4410011cd438:7', '7:54ef4410011cd712:5']); // Baby's dimmer + Study ceiling: full-width DimmerTile
const HIDDEN_ROLES = ['relay-hidden', 'spare-hidden', 'circuit-master'];
const LIGHT_ROLES = ['primary-light', 'accent-light', 'utility-light', 'bathroom', 'external']; // room master/counts
const OFF_ROLES = ['primary-light', 'accent-light', 'utility-light', 'bathroom'];               // global Lights off whitelist (§1.4)
const RANK = { 'primary-light': 0, 'accent-light': 1, external: 2, 'utility-light': 3, bathroom: 4, exhaust: 5 };
const byRank = (a, b) => (RANK[a.role] ?? 9) - (RANK[b.role] ?? 9);

/* ---------------- circuits (units) ---------------- */
const epOn = (id, ep) => !!view(id)?.state.on?.find((o) => o.ep === ep)?.on;
function mkUnit(d, eps, name) {
  const ids = eps.map((ep) => ({ id: d.id, ep }));
  const u = {
    key: `${d.id}:${eps.join('+')}`, id: d.id, ids, name, room: d.room,
    role: roleOf(name), dimmable: !!d.caps?.level, hidden: !!d.hidden,
    on: () => ids.some((t) => epOn(t.id, t.ep)),                 // fused state = OR
    online: () => view(d.id)?.state.online !== false,            // false only when the gateway flags the node offline
    pending: () => ids.some((t) => pendingVisible(t.id)),
    level: () => view(d.id)?.state.brightness,
    watts: () => view(d.id)?.state.power,
    setLevel: (v) => cmd.level(d.id, v),
    actions: (on) => ids.map((t) => ({ id: t.id, kind: 'onOff', ep: t.ep, on })),
    toggle: () => { const on = !u.on(); ids.forEach((t) => cmd.toggle(t.id, t.ep, on)); }, // fan-out
  };
  return u;
}
export function explodeUnits(devices) {
  const units = [];
  for (const d of devices) {
    if (!isLight(d.type) || isAcPower(d)) continue;
    const eps = d.caps?.onOff || []; // structural — doesn't recompute on toggle
    if (eps.length <= 1) { if (eps.length) units.push(mkUnit(d, eps, d.name)); continue; }
    const byName = new Map(); // duplicate gang names on one device → one fused circuit
    eps.forEach((ep, i) => { const n = d.gangs?.[ep] || `${d.name} ${i + 1}`; byName.set(n, [...(byName.get(n) || []), ep]); });
    for (const [n, list] of byName) units.push(mkUnit(d, list, n));
  }
  return units;
}

/* ---------------- covers: strip trailing numbers → Curtains/Shades groups, pct = mean ---------------- */
export function groupCovers(covers) {
  const by = {};
  for (const c of covers) (by[(c.name || 'Cover').replace(/\s+\d+$/, '')] ??= []).push(c);
  return Object.keys(by).sort().map((base) => { const members = by[base].sort((a, b) => (a.name || '').localeCompare(b.name || '')); return {
    name: base.endsWith('s') ? base : base + 's', members,
    pct: () => { const ps = members.map((m) => view(m.id)?.state.coverPct).filter((p) => p != null); return ps.length ? Math.round(ps.reduce((a, b) => a + b, 0) / ps.length) : null; },
    actions: (action, value) => members.map((m) => ({ id: m.id, kind: 'cover', action, value })),
  }; });
}

/* ---------------- climate groups: sensor bound by hub/node prefix (room:null sensors) ---------------- */
function buildClimate(devices, zoneOf) {
  const sensors = devices.filter((d) => d.type === 'sensor');
  return devices.filter((d) => d.type === 'thermostat').map((ac) => {
    const sensor = sensors.find((s) => s.id.startsWith(ac.id.split(':')[0] + ':')) || null;
    const zone = zoneOf[ac.room];
    const rooms = zone ? ZONES.find((z) => z.name === zone).rooms : [ac.room];
    const acp = devices.filter((d) => isAcPower(d) && rooms.includes(d.room));
    const powers = acp.filter((d) => /^ac power$/i.test(d.name));
    return {
      ac, powers, sensor, room: zone || ac.room,
      zones: zone ? powers.map((p) => ({ name: (p.room || '').split(' ')[0], power: p })) : null, // Kitchen / TV / Lounge chips
      secondary: acp.filter((d) => !/^ac power$/i.test(d.name)), // e.g. Closet AC Power — sheet-only toggle
      mode: () => view(ac.id)?.state.climate?.mode ?? 0,
      setpoint: () => view(ac.id)?.state.climate?.cool,
      temp: () => (sensor ? view(sensor.id)?.state.temp : null) ?? view(ac.id)?.state.climate?.localTemp,
      hum: () => (sensor ? view(sensor.id)?.state.humidity : null),
    };
  });
}

/* ---------------- rooms ---------------- */
const ROOM_ORDER = ['Living Area', 'Master Bedroom', "Baby's Room", 'Study', 'Bedroom Hallway', 'Guest Room', 'Outdoor'];
const OUTDOOR_ROOMS = ['Balcony', 'Entry', 'Pool', 'Driveway'];
const SECTION_ORDER = ['Kitchen & Dining', 'Lounge', 'TV Area', 'Balcony', 'Entry', 'Study', 'Pool', 'Driveway'];
const ord = (list) => (a, b) => (list.indexOf(a) + 1 || 99) - (list.indexOf(b) + 1 || 99);
const slug = (n) => n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function buildRooms(devices) {
  const zoneOf = {}; ZONES.forEach((z) => z.rooms.forEach((r) => (zoneOf[r] = z.name)));
  const climates = buildClimate(devices, zoneOf);
  const homeOf = (u) => (!u.room || u.role === 'appliance') ? null // appliances live in Essentials, Utilities never gets a card
    : (OUTDOOR_ROOMS.includes(u.room) || u.role === 'external') ? 'Outdoor' : zoneOf[u.room] || u.room;
  const byRoom = {}, coversBy = {};
  for (const u of explodeUnits(devices)) { const r = homeOf(u); if (r) (byRoom[r] ??= []).push(u); }
  for (const c of devices) if (c.type === 'cover' && c.room) (coversBy[zoneOf[c.room] || c.room] ??= []).push(c);

  const names = [...new Set([...Object.keys(byRoom), ...Object.keys(coversBy), ...climates.map((c) => c.room)])].sort(ord(ROOM_ORDER));
  return names.map((name) => {
    const us = byRoom[name] || [];
    const hidden = us.filter((u) => u.hidden || HIDDEN_ROLES.includes(u.role));
    const live = us.filter((u) => !hidden.includes(u));
    const fans = live.filter((u) => u.role === 'fan');
    const isZone = ZONES.some((z) => z.name === name); // multi-sub-room page (Living Area)
    const hero = live.find((u) => HEROES.has(u.key)) || null;
    const bathUnits = name === 'Guest Room' ? [] // Guest Room keeps its bathroom in the main list (§1.3)
      : live.filter((u) => ['bathroom', 'exhaust'].includes(u.role)).sort(byRank);
    const bathroom = bathUnits.length ? { name: name === 'Living Area' ? 'Guest Bathroom' : 'Bathroom', units: bathUnits } : null;
    const rest = live.filter((u) => u !== hero && !fans.includes(u) && !bathUnits.includes(u));
    const secs = {};
    for (const u of rest) (secs[u.room] ??= []).push(u);
    // zone pages have per-sub-room sections, so fans dock under the room they live in (Lounge / TV Area);
    // single-room pages keep one dedicated Fans section (a lone fan under a "Lights" header would mislabel it)
    const sectionFans = {};
    if (isZone) for (const f of fans) { (sectionFans[f.room] ??= []).push(f); secs[f.room] ??= []; }
    const lightSections = Object.keys(secs).sort(ord(SECTION_ORDER)).map((r) => ({ room: r, units: secs[r].sort(byRank), fans: (sectionFans[r] || []).sort(byRank) }));
    const roomFans = isZone ? [] : fans;
    const lights = [hero, ...rest, ...bathUnits].filter((u) => u && LIGHT_ROLES.includes(u.role)); // master/off scope: no fans/exhausts/hidden
    const climate = climates.find((c) => c.room === name) || null;
    return {
      id: slug(name), name, climate, hero, lightSections, bathroom, fans: roomFans, hidden, lights,
      floor: devices.find((d) => d.room && (zoneOf[d.room] || d.room) === name && d.floor)?.floor || null,
      coverGroups: groupCovers(coversBy[name] || []),
      counts: { lights: lights.length, on: () => lights.filter((u) => u.on()).length },
    };
  }).filter((r) => r.lights.length || r.climate || r.coverGroups.length || r.fans.length || r.lightSections.length || r.hidden.length);
}

/* ---------------- module-scoped memos ---------------- */
const M = createRoot(() => {
  const devices = createMemo(() => Object.values(state.byId));
  const units = createMemo(() => explodeUnits(devices()));
  const roomList = createMemo(() => buildRooms(devices()));
  const roomMap = createMemo(() => Object.fromEntries(roomList().map((r) => [r.id, r])));
  return { devices, units, roomList, roomMap };
});
export const rooms = M.roomList;
export const allUnits = M.units;
export const roomById = (id) => M.roomMap()[id];
export const climateRail = () => rooms().filter((r) => r.climate).map((r) => r.climate); // fixed rail order = room order

/* ---------------- essentials (§1.2a) ---------------- */
const SUGGEST = { '4:158d008b61357a': 'Driveway' }; // reserved Outdoor slot until assigned
export const needsSetup = () => M.devices().filter((d) => !d.room && d.type !== 'sensor' && !d.hidden)
  .map((d) => ({ device: d, suggest: SUGGEST[d.id] || null }));

export const essentials = () => {
  const us = M.units();
  const find = (n) => us.find((u) => u.name === n) || null;
  const stair = us.filter((u) => /staircase/i.test(u.name)); // Staircase Circuit (Master) + Staircase Light, fused across devices
  const staircase = stair.length ? {
    key: 'staircase', name: 'Staircase', role: 'fused', dimmable: false,
    ids: stair.flatMap((u) => u.ids),
    on: () => stair.every((u) => u.on()),               // chip is on only when BOTH are on
    pending: () => stair.some((u) => u.pending()),
    actions: (on) => stair.flatMap((u) => u.actions(on)),
    toggle: () => { const on = !stair.every((u) => u.on()); runScene(stair.flatMap((u) => u.actions(on))); },
  } : null;
  const favorites = us.filter((u) => state.byId[u.id]?.favorite && !u.hidden && !HIDDEN_ROLES.includes(u.role) && u.role !== 'appliance');
  return { heater: find('Water Heater'), pump: find('Water Pump'), staircase, favorites };
};

/* ---------------- snapshot undo (tap-safety): capture BEFORE the bulk runScene ----------------
   per-(id,ep) on-state via epOn + brightness for dimmables; inverse is just another runScene batch,
   so optimistic overlays + SSE reconciliation work unchanged. One-level: a new undo replaces the old. */
export const snapUnits = (units) => units.flatMap((u) => [
  ...u.ids.map((t) => ({ id: t.id, kind: 'onOff', ep: t.ep, on: epOn(t.id, t.ep) })),
  ...(u.dimmable && u.level() != null ? [{ id: u.id, kind: 'level', value: u.level() }] : []),
]);
let undoT;
function pushUndo(title, snapshot) {
  const dismiss = () => { clearTimeout(undoT); setToasts((a) => a.filter((x) => x.id !== 'undo')); };
  clearTimeout(undoT);
  setToasts((a) => [...a.filter((x) => x.id !== 'undo'),
    { id: 'undo', msg: title, kind: 'undo', action: { label: 'Undo', fn: () => { dismiss(); runScene(snapshot); } } }]);
  undoT = setTimeout(dismiss, 6000);
}
export function runUndoable(title, actions, snapshot) { const p = runScene(actions); pushUndo(title, snapshot); return p; }
// scene rail entry point: snapshot exactly what the scene touches (on-state, brightness, AC setpoints)
export function fireScene(scene) {
  const actions = scene.actions(), seen = new Set(), snap = [];
  for (const a of actions) {
    const k = `${a.id}:${a.kind}:${a.ep ?? a.field ?? ''}`;
    if (seen.has(k)) continue; seen.add(k);
    if (a.kind === 'onOff') snap.push({ id: a.id, kind: 'onOff', ep: a.ep, on: epOn(a.id, a.ep) });
    else if (a.kind === 'level') { const v = view(a.id)?.state.brightness; if (v != null) snap.push({ id: a.id, kind: 'level', value: v }); }
    else if (a.kind === 'climate') { const v = view(a.id)?.state.climate?.[a.field]; if (v != null) snap.push({ id: a.id, kind: 'climate', field: a.field, value: v }); }
  }
  return runUndoable(scene.name, actions, snap);
}

// global "Lights off": every *-light + bathroom circuit; NEVER ac-power/appliance/fan/exhaust/hidden
const offUnits = () => M.units().filter((u) => OFF_ROLES.includes(u.role) && !u.hidden);
export const lightsOffActions = () => offUnits().flatMap((u) => u.actions(false));
export const lightsOff = () => { const us = offUnits(); return runUndoable('All lights off', us.flatMap((u) => u.actions(false)), snapUnits(us)); };

/* ---------------- last-on snapshots + room master (one batched runScene each) ---------------- */
const lastKey = (room) => 'home:lastOn:' + room.id;
export const lastOn = {
  save: (room) => { try { localStorage.setItem(lastKey(room), JSON.stringify(room.lights.filter((u) => u.on()).map((u) => u.key))); } catch {} },
  load: (room) => { try { return JSON.parse(localStorage.getItem(lastKey(room)) || '[]'); } catch { return []; } },
};
export function roomOff(room) {
  if (room.lights.some((u) => u.on())) lastOn.save(room);
  runUndoable(`${room.name} off`, room.lights.flatMap((u) => u.actions(false)), snapUnits(room.lights));
}
export function roomRestore(room) {
  const keys = lastOn.load(room);
  let pick = room.lights.filter((u) => keys.includes(u.key));
  if (!pick.length) pick = room.lights.filter((u) => u.role === 'primary-light'); // fallback: the room's primaries
  if (!pick.length) pick = room.lights;
  runUndoable(`${room.name} on`, pick.flatMap((u) => u.actions(true)), snapUnits(pick));
}

// offline LIGHT circuits the gateway has flagged unreachable (peer-unreachable); drives the offline
// banner. Scoped to LIGHT_ROLES — the same definition the room cards count — so AC / AC-power / fans /
// sensors / appliances on an unreachable node don't show up here.
export const offlineLights = () => allUnits()
  .filter((u) => LIGHT_ROLES.includes(u.role) && !u.hidden && u.online?.() === false)
  .map((u) => ({ id: u.key, name: u.name, room: u.room || 'Unassigned' }))
  .sort((a, b) => a.room.localeCompare(b.room) || (a.name || '').localeCompare(b.name || ''));
export const offlineCount = () => offlineLights().length;

/* ---------------- home status strip ---------------- */
export function homeStats() {
  const rs = rooms();
  const temps = rs.map((r) => r.climate?.temp()).filter((t) => t != null);
  return {
    lights: rs.reduce((n, r) => n + r.counts.lights, 0),
    lightsOn: rs.reduce((n, r) => n + r.counts.on(), 0),
    avgTemp: temps.length ? +(temps.reduce((a, b) => a + b, 0) / temps.length).toFixed(1) : null,
  };
}
