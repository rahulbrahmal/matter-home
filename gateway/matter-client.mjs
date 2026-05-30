// Minimal BigInt-safe client for the matter-server WebSocket (message_id/command/args + push events).
import { EventEmitter } from 'node:events';

export class MatterClient extends EventEmitter {
  constructor(url) { super(); this.url = url; this._id = 0; this._pending = new Map(); this.info = null; this.connected = false; }

  connect() {
    return new Promise((resolve, reject) => {
      const sock = new WebSocket(this.url);
      this.sock = sock;
      const onErr = (e) => { if (!this.connected) reject(new Error('matter-server WS: ' + (e.message || e))); this.emit('disconnected'); };
      sock.addEventListener('error', onErr);
      sock.addEventListener('close', () => { this.connected = false; this.emit('disconnected'); });
      sock.addEventListener('message', (ev) => {
        const m = JSON.parse(ev.data);
        if (m.message_id != null && this._pending.has(m.message_id)) {
          const { res, rej } = this._pending.get(m.message_id); this._pending.delete(m.message_id);
          m.error_code != null ? rej(new Error(`[${m.error_code}] ${m.details}`)) : res(m.result);
          return;
        }
        if (m.event) { this.emit('event', m.event, m.data); this.emit(m.event, m.data); return; }
        if (!this.info && m.sdk_version) { this.info = m; this.connected = true; resolve(m); }
      });
    });
  }

  cmd(command, args = {}) {
    return new Promise((res, rej) => {
      const message_id = String(++this._id);
      this._pending.set(message_id, { res, rej });
      this.sock.send(JSON.stringify({ message_id, command, args }));
    });
  }

  startListening() { return this.cmd('start_listening'); }
  getNodes() { return this.cmd('get_nodes', {}); }
  getNode(node_id) { return this.cmd('get_node', { node_id }); }
  deviceCommand(node_id, endpoint_id, cluster_id, command_name, payload = {}) {
    return this.cmd('device_command', { node_id, endpoint_id, cluster_id, command_name, payload });
  }
  close() { this.sock?.close(); }
}
