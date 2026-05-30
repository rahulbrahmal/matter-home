// Multi-admin commission: open a window on HA for a device, then commission it into matter-server.
// Usage: HA_TOKEN=... node commission.mjs <ha_device_id> [ms_ws_url]
//   ms_ws_url default ws://172.30.2.3:5580/ws
import { ws as haWs } from './lib.mjs';

const HA_DEVICE_ID = process.argv[2];
const MS_URL = process.argv[3] || 'ws://172.30.2.3:5580/ws';
if (!HA_DEVICE_ID) { console.error('need HA device_id'); process.exit(1); }

// --- minimal matter-server WS client (message_id/command/args + event push) ---
function msConnect(url) {
  const sock = new WebSocket(url);
  let id = 0; const pending = new Map(); let info = null;
  const ready = new Promise((res, rej) => {
    sock.addEventListener('error', (e) => rej(new Error('matter-server WS error: ' + (e.message || e))));
    sock.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.message_id && pending.has(m.message_id)) { pending.get(m.message_id)(m); pending.delete(m.message_id); return; }
      if (m.event) { console.log(`   [ms event] ${m.event}`, JSON.stringify(m.data).slice(0, 120)); return; }
      if (!info && m.sdk_version) { info = m; res(m); }
    });
  });
  const cmd = (command, args = {}) => new Promise((res, rej) => {
    const message_id = String(++id); pending.set(message_id, (m) => m.error_code != null ? rej(new Error(`${command}: [${m.error_code}] ${m.details}`)) : res(m.result));
    sock.send(JSON.stringify({ message_id, command, args }));
  });
  return { ready, cmd, close: () => sock.close() };
}

console.log('1) HA: open commissioning window for', HA_DEVICE_ID);
const ha = await haWs();
let codes;
for (const args of [{ device_id: HA_DEVICE_ID }, { node_id: 9 }]) {
  const r = await ha.call('matter/open_commissioning_window', args);
  if (r.success) { codes = r.result; break; }
  console.log('   tried', JSON.stringify(args), '->', r.error?.message || r.error?.code);
}
ha.close();
if (!codes) { console.error('Could not open commissioning window'); process.exit(1); }
console.log('   got codes:', { manual: codes.setup_manual_code, qr: codes.setup_qr_code });

console.log('2) matter-server: connect', MS_URL);
const ms = msConnect(MS_URL);
const si = await ms.ready;
console.log('   connected:', si.sdk_version, 'fabric', si.fabric_id);
await ms.cmd('start_listening');

console.log('3) matter-server: commission_with_code (network_only) — this can take 30-90s...');
const code = codes.setup_qr_code || codes.setup_manual_code;
const node = await ms.cmd('commission_with_code', { code, network_only: true });
console.log('   COMMISSIONED as node_id', node?.node_id, 'available:', node?.available);

console.log('4) verify nodes + fabrics');
const nodes = await ms.cmd('get_nodes', {});
console.log('   matter-server now has', nodes.length, 'node(s):', nodes.map((n) => n.node_id).join(','));
try {
  const fabrics = await ms.cmd('get_matter_fabrics', { node_id: node.node_id });
  console.log('   fabrics on the device now:', JSON.stringify(fabrics));
} catch (e) { console.log('   (get_matter_fabrics:', e.message, ')'); }
ms.close(); process.exit(0);
