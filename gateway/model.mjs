// Translate matter-server nodes (raw endpoint/cluster/attribute) into a clean, room-grouped
// device model with live state. Recompute-per-update keeps it robust and simple.

// cluster ids
const C = { DESCRIPTOR: 29, BRIDGED: 57, BASIC: 40, ONOFF: 6, LEVEL: 8, COVER: 258, THERMO: 513, TEMP: 1026, HUM: 1029, POWER: 144 };
const A = (ep, cl, at) => `${ep}/${cl}/${at}`;

export function makeStore() { return { nodes: new Map() }; } // node_id -> {attributes, available}

export function ingestNode(store, node) {
  store.nodes.set(node.node_id, { attributes: { ...(node.attributes || {}) }, available: node.available !== false });
}
export function setAvailable(store, node_id, available) { const n = store.nodes.get(node_id); if (n) n.available = available; }
export function applyAttr(store, node_id, path, value) {
  const n = store.nodes.get(node_id); if (!n) return; n.attributes[path] = value;
}

// --- discover devices (bridged accessories + standalone functional endpoints) ---
export function buildDevices(store, rooms = {}) {
  const devices = [];
  for (const [nodeId, n] of store.nodes) {
    const attrs = n.attributes;
    const eps = [...new Set(Object.keys(attrs).map((k) => +k.split('/')[0]))].sort((a, b) => a - b);
    const parts = (ep) => (attrs[A(ep, C.DESCRIPTOR, 3)] || []).map(Number);
    const typesOf = (ep) => (attrs[A(ep, C.DESCRIPTOR, 0)] || []).map((d) => Number(d['0'] ?? d[0]));
    const clustersOf = (ep) => [...new Set(Object.keys(attrs).filter((k) => k.startsWith(ep + '/')).map((k) => +k.split('/')[1]))];

    // a "device" = endpoint carrying BridgedDeviceBasicInformation; fallback: root with functional clusters
    const deviceEps = eps.filter((ep) => clustersOf(ep).includes(C.BRIDGED));
    if (deviceEps.length === 0) {
      const fnEps = eps.filter((ep) => [C.ONOFF, C.LEVEL, C.COVER, C.THERMO].some((c) => clustersOf(ep).includes(c)));
      deviceEps.push(...fnEps);
    }
    for (const D of deviceEps) {
      const owned = new Set([D]);
      const walk = (ep) => parts(ep).forEach((p) => { if (!owned.has(p)) { owned.add(p); walk(p); } });
      walk(D);
      const ownedEps = [...owned];
      const has = (cl) => ownedEps.find((ep) => clustersOf(ep).includes(cl));
      const serial = attrs[A(D, C.BRIDGED, 15)] || attrs[A(D, C.BASIC, 15)] || null;
      const label = rooms[serial]?.name || attrs[A(D, C.BRIDGED, 5)] || attrs[A(D, C.BASIC, 5)] || `node ${nodeId} ep ${D}`;
      const onOffEps = ownedEps.filter((ep) => clustersOf(ep).includes(C.ONOFF));
      const caps = {
        onOff: onOffEps,
        level: has(C.LEVEL) || null,
        cover: has(C.COVER) || null,
        thermostat: has(C.THERMO) || null,
        temp: has(C.TEMP) || null,
        humidity: has(C.HUM) || null,
        power: has(C.POWER) || null,
      };
      const type = rooms[serial]?.type || inferType(typesOf(D), caps);
      devices.push({
        id: `${nodeId}:${serial || D}`, nodeId, endpoint: D, ownedEps, serial,
        name: label, type, room: rooms[serial]?.room || null, floor: rooms[serial]?.floor || null, caps,
      });
    }
  }
  return devices;
}

function inferType(types, caps) {
  if (caps.thermostat) return 'thermostat';
  if (caps.cover) return 'cover';
  if (caps.temp || caps.humidity) return 'sensor';
  if (caps.onOff.length && caps.power) return 'outlet';
  if (caps.onOff.length && caps.level) return 'light';
  if (caps.onOff.length) return 'switch';
  return 'other';
}

// --- derive live state for a device from the store ---
export function deviceState(store, dev) {
  const n = store.nodes.get(dev.nodeId); const a = n?.attributes || {};
  const s = { online: !!n?.available };
  if (dev.caps.onOff.length) s.on = dev.caps.onOff.map((ep) => ({ ep, on: !!a[A(ep, C.ONOFF, 0)] }));
  if (dev.caps.level != null) { const lv = a[A(dev.caps.level, C.LEVEL, 0)]; if (lv != null) s.brightness = Math.round((Number(lv) / 254) * 100); }
  if (dev.caps.cover != null) { const p = a[A(dev.caps.cover, C.COVER, 14)] ?? a[A(dev.caps.cover, C.COVER, 11)]; if (p != null) s.coverPct = a[A(dev.caps.cover, C.COVER, 14)] != null ? Math.round(Number(p) / 100) : Number(p); }
  if (dev.caps.thermostat != null) {
    const t = dev.caps.thermostat;
    s.climate = {
      localTemp: cTemp(a[A(t, C.THERMO, 0)]), cool: cTemp(a[A(t, C.THERMO, 17)]), heat: cTemp(a[A(t, C.THERMO, 18)]),
      mode: a[A(t, C.THERMO, 28)],
    };
  }
  if (dev.caps.temp != null) s.temp = cTemp(a[A(dev.caps.temp, C.TEMP, 0)]);
  if (dev.caps.humidity != null) { const h = a[A(dev.caps.humidity, C.HUM, 0)]; if (h != null) s.humidity = Math.round(Number(h) / 100); }
  if (dev.caps.power != null) { const w = a[A(dev.caps.power, C.POWER, 8)]; if (w != null) s.power = Math.round(Number(w) / 1000); }
  return s;
}
const cTemp = (v) => (v == null ? null : Math.round(Number(v) / 10) / 10);

// which device owns an updated endpoint (for targeted deltas)
export function deviceForEndpoint(devices, nodeId, ep) {
  return devices.find((d) => d.nodeId === nodeId && d.ownedEps.includes(Number(ep))) || null;
}
