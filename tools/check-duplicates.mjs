// Are offline bridges stale duplicates? Compare child-device serials offline vs online.
import { ws, isMatterNode, buildModel } from './lib.mjs';
const conn = await ws();
const reg = await conn.registries();
const nodes = reg.devices.filter(isMatterNode);
const status = {};
for (const n of nodes) { const d = await conn.nodeDiagnostics(n.id); status[n.id] = d.available; }
conn.close();

const serialOf = (d) => (d.identifiers || []).filter((i) => i[0] === 'matter' && /serial_/.test(i[1])).map((i) => i[1].replace('matter', '').replace(/^,?serial_/, 'serial_'))[0]
  || ((d.identifiers || []).find((i) => /serial_/.test(i[1])) || [])[1];
const nodeRef = (d) => (((d.identifiers || []).find((i) => /deviceid_/.test(i[1])) || [])[1] || '').match(/-0*([0-9A-Fa-f]+?)(?:-|$)/)?.[1];

// map serial -> list of {node, online, model, name}
const bySerial = {};
for (const d of reg.devices) {
  const s = serialOf(d); if (!s) continue;
  const parent = d.via_device_id ? reg.devices.find((x) => x.id === d.via_device_id) : d;
  const node = nodeRef(parent) || nodeRef(d);
  (bySerial[s] ??= []).push({ node, online: status[parent?.id], model: d.model, name: d.name_by_user || d.name });
}

let dupes = 0;
console.log('Serials present under BOTH an offline and an online bridge (= stale duplicate):\n');
for (const [s, list] of Object.entries(bySerial)) {
  const nodesSeen = [...new Set(list.map((x) => x.node))];
  if (nodesSeen.length > 1) {
    dupes++;
    console.log(`${s}  -> nodes ${nodesSeen.map((n) => '0x' + n).join(', ')}  (${list[0].model})`);
  }
}
console.log(`\n${dupes} child devices appear under multiple bridge nodes.`);
// also: do offline bridges share a serial with online bridges (same physical hub re-commissioned)?
process.exit(0);
