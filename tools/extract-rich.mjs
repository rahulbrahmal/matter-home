// Deep per-device extraction: capabilities, gang endpoints, FixedLabel/UserLabel (part names),
// thermostat ranges, sensor extras. Informs the redesign's components + groupings.
const URL = process.env.MS || 'ws://localhost:5580/ws';
const ws = new WebSocket(URL); let id = 0; const p = new Map();
const cmd = (c, a = {}) => new Promise((res, rej) => { const m = String(++id); p.set(m, r => r.error_code != null ? rej(new Error(r.details)) : res(r.result)); ws.send(JSON.stringify({ message_id: m, command: c, args: a })); });
const A = (e, c, at) => `${e}/${c}/${at}`;

ws.addEventListener('message', async (ev) => {
  const m = JSON.parse(ev.data);
  if (m.message_id && p.has(m.message_id)) { p.get(m.message_id)(m); p.delete(m.message_id); return; }
  if (!m.sdk_version) return;
  const nodes = await cmd('get_nodes', {});
  const out = {};
  for (const node of nodes) {
    const a = node.attributes || {}; const N = node.node_id;
    const eps = [...new Set(Object.keys(a).map(k => +k.split('/')[0]))].sort((x, y) => x - y);
    const clustersOf = (e) => [...new Set(Object.keys(a).filter(k => k.startsWith(e + '/')).map(k => +k.split('/')[1]))];
    const parts = (e) => (a[A(e, 29, 3)] || []).map(Number);
    const labelList = (e, cl) => (a[A(e, cl, 0)] || []).map(l => `${l.label || l['0'] || ''}=${l.value || l['1'] || ''}`).join(',');
    for (const e of eps) {
      const cl = clustersOf(e);
      if (!(cl.includes(57) || cl.includes(6) || cl.includes(258) || cl.includes(513))) continue;
      const serial = a[A(e, 57, 15)] || a[A(e, 40, 15)];
      const label = a[A(e, 57, 5)] || a[A(e, 40, 5)];
      if (!serial && !cl.includes(6) && !cl.includes(258) && !cl.includes(513)) continue;
      const rec = { node: N, ep: e, label, serial, clusters: cl, parts: parts(e) };
      if (cl.includes(6)) rec.onOff = a[A(e, 6, 0)];
      if (cl.includes(8)) rec.level = a[A(e, 8, 0)];
      if (cl.includes(258)) rec.coverPct = a[A(e, 258, 14)] ?? a[A(e, 258, 11)];
      if (cl.includes(513)) rec.thermo = { temp: a[A(e, 513, 0)], cool: a[A(e, 513, 17)], heat: a[A(e, 513, 18)], mode: a[A(e, 513, 28)], minCool: a[A(e, 513, 22)], maxCool: a[A(e, 513, 23)] };
      if (cl.includes(1026)) rec.temp = a[A(e, 1026, 0)];
      if (cl.includes(1029)) rec.humidity = a[A(e, 1029, 0)];
      if (cl.includes(47)) rec.battery = a[A(e, 47, 12)];
      const fixed = labelList(e, 64), user = labelList(e, 65);
      if (fixed) rec.fixedLabel = fixed; if (user) rec.userLabel = user;
      (out[N] ??= []).push(rec);
    }
  }
  // summary
  console.log('=== gang/multi-endpoint devices (onOff endpoints under a bridged parent) ===');
  for (const [N, recs] of Object.entries(out)) {
    const bridged = recs.filter(r => r.serial && r.label);
    for (const b of bridged) {
      const childOnOff = recs.filter(r => b.parts.includes(r.ep) && r.clusters.includes(6));
      if (childOnOff.length > 1) console.log(`  node ${N} "${b.label}" -> ${childOnOff.length} gangs: eps[${childOnOff.map(c => c.ep).join(',')}] fixed[${b.fixedLabel || childOnOff.map(c => c.fixedLabel).filter(Boolean).join('|') || '-'}]`);
    }
  }
  console.log('\n=== any FixedLabel/UserLabel present anywhere? ===');
  const withLabels = Object.values(out).flat().filter(r => r.fixedLabel || r.userLabel);
  console.log(withLabels.length ? withLabels.map(r => `node${r.node}/ep${r.ep}: fixed[${r.fixedLabel}] user[${r.userLabel}]`).join('\n') : '(none — devices do not expose endpoint labels)');
  console.log('\n=== thermostat ranges (for dial design) ===');
  for (const r of Object.values(out).flat().filter(r => r.thermo)) console.log(`  node${r.node} "${r.label}": temp=${r.thermo.temp/100} cool=${r.thermo.cool/100} mode=${r.thermo.mode} range=[${(r.thermo.minCool??600)/100}..${(r.thermo.maxCool??3200)/100}]`);
  ws.close(); process.exit(0);
});
ws.addEventListener('error', e => { console.log('err', e.message); process.exit(1); });
setTimeout(() => process.exit(2), 12000);
