// Diagnose offline Matter bridge nodes: last-seen time + live ping via HA.
import { ws, isMatterNode, isMatter, matterDeviceRef, buildModel } from './lib.mjs';
const conn = await ws();
const reg = await conn.registries();
const { stateOf, entsByDev } = buildModel(reg);
const nodes = reg.devices.filter(isMatterNode);
const offline = [];
for (const n of nodes) { const d = await conn.nodeDiagnostics(n.id); if (d.available === false) offline.push({ n, d }); }

console.log(`Offline bridge nodes: ${offline.length}\n`);
for (const { n, d } of offline) {
  const ref = matterDeviceRef(n) || '';
  const node = (ref.match(/-0*([0-9A-Fa-f]+?)(?:-|$)/) || [])[1];
  // gather all entities under this bridge (its children + its own)
  const childDevs = reg.devices.filter((x) => x.via_device_id === n.id);
  const allEnts = [n, ...childDevs].flatMap((x) => entsByDev[x.id] || []);
  const times = allEnts.map((e) => stateOf[e.entity_id]?.last_changed).filter(Boolean).sort();
  const ping = await conn.call('matter/ping_node', { device_id: n.id });
  console.log(`• node 0x${node}  ${n.model}  mac=${d.mac_address}`);
  console.log(`   children=${childDevs.length}  entities=${allEnts.length}`);
  console.log(`   last_changed range: ${times[0] || '?'}  ..  ${times[times.length - 1] || '?'}`);
  console.log(`   ping_node: ${ping.success ? JSON.stringify(ping.result) : (ping.error?.message || 'failed')}`);
}
conn.close(); process.exit(0);
