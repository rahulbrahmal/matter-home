import { onMount, createSignal, createMemo, For, Show } from 'solid-js';
import { state, connect, login, auth, toasts, view, cmd, builtinScenes, runScene } from './store.js';
import { buildAreas, isAcPower } from './home.js';
import { LightTile, ClimateCard, CoverTile, DetailSheet, Skeletons, Toasts } from './components.jsx';

const greet = () => { const h = new Date().getHours(); return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 22 ? 'Good evening' : 'Good night'; };
const lit = (id, ep) => view(id)?.state.on?.find((o) => o.ep === ep)?.on;

function Login() {
  const [pw, setPw] = createSignal('');
  const [url, setUrl] = createSignal(auth.base || '');
  const [err, setErr] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const submit = async (e) => { e.preventDefault(); setBusy(true); setErr(''); try { await login(url().trim().replace(/\/$/, ''), pw().trim()); } catch (e) { setErr(e.message); } setBusy(false); };
  return (
    <div class="login"><form class="login-card" onSubmit={submit}>
      <div class="login-logo">🏠</div><h1>Home</h1><p class="muted">Enter your access password</p>
      <input class="text" type="password" placeholder="Password" value={pw()} onInput={(e) => setPw(e.currentTarget.value)} autofocus />
      <details class="login-adv"><summary>Gateway address</summary>
        <input class="text" type="text" placeholder="http://192.168.x.x:8788 (blank = this host)" value={url()} onInput={(e) => setUrl(e.currentTarget.value)} /></details>
      <Show when={err()}><div class="login-err">{err()}</div></Show>
      <button class="login-btn" disabled={busy()}>{busy() ? 'Connecting…' : 'Unlock'}</button>
    </form></div>
  );
}

export default function App() {
  onMount(connect);
  const [nav, setNav] = createSignal('all');
  const [floor, setFloor] = createSignal('All');
  const [edit, setEdit] = createSignal(false);
  const [open, setOpen] = createSignal(null);

  const all = createMemo(() => Object.values(state.byId));
  const visible = createMemo(() => all().filter((d) => edit() || !d.hidden));
  const areas = createMemo(() => {
    const order = state.home.areas.map((a) => a.name);
    let a = buildAreas(visible());
    if (nav() !== 'all') a = a.filter((x) => x.name === nav());
    else if (floor() !== 'All') a = a.filter((x) => x.floor === floor());
    return a.sort((x, y) => (x.name === 'Unassigned' ? 1 : y.name === 'Unassigned' ? -1 : (order.indexOf(x.rooms[0]) + 1 || 99) - (order.indexOf(y.rooms[0]) + 1 || 99)));
  });
  const allAreas = createMemo(() => buildAreas(visible()));

  const lightsOn = createMemo(() => all().filter((d) => ['light', 'switch', 'outlet'].includes(d.type) && !isAcPower(d))
    .reduce((n, d) => n + (view(d.id)?.state.on?.filter((o) => o.on).length || 0), 0));
  const climates = createMemo(() => all().map((d) => view(d.id)?.state.climate?.localTemp).filter((t) => t != null));
  const avgTemp = createMemo(() => climates().length ? (climates().reduce((a, b) => a + b, 0) / climates().length).toFixed(1) : null);
  const floors = createMemo(() => ['All', ...state.home.floors.map((f) => f.name)]);
  const areaOnCount = (a) => a.lights.filter((u) => lit(u.id, u.ep)).length;
  const turnOff = (a) => a.lights.forEach((u) => lit(u.id, u.ep) && cmd.toggle(u.id, u.ep, false));
  let gi = 0;

  return (
   <Show when={state.status !== 'needauth'} fallback={<div class="shell"><div class="ambient" /><Login /></div>}>
    <div class="shell">
      <div class="ambient" />
      <aside class="sidebar">
        <div class="side-brand"><span class="side-logo">🏠</span><b>Home</b></div>
        <button class="side-item" classList={{ active: nav() === 'all' }} onClick={() => setNav('all')}><span class="ico">◳</span> Dashboard</button>
        <div class="side-sec">Areas</div>
        <For each={allAreas()}>{(a) => (
          <button class="side-item" classList={{ active: nav() === a.name }} onClick={() => setNav(a.name)}><span class="ico">⬚</span> {a.name} <span class="count">{a.count}</span></button>
        )}</For>
      </aside>

      <main class="main">
        <Show when={state.status === 'reconnecting'}><div class="banner">Reconnecting…</div></Show>
        <header class="greeting">
          <div><p class="greet-line">{greet()}</p><h1>{nav() === 'all' ? 'Welcome home' : nav()}</h1></div>
          <div class="head-actions"><button class="icon-btn" classList={{ active: edit() }} onClick={() => setEdit(!edit())}>✎</button><span class="avatar">🙂</span></div>
        </header>

        <div class="summary-strip">
          <div class="stat live"><span class="si">💡</span><span><span class="big">{lightsOn()}</span> on</span></div>
          <Show when={avgTemp()}><div class="stat"><span class="si">🌡</span><span><span class="big">{avgTemp()}°</span> avg</span></div></Show>
          <div class="stat"><span class="si">⌂</span><span><span class="big">{all().length}</span> devices</span></div>
        </div>

        <div class="rail-head"><h2>Scenes</h2></div>
        <div class="scenes"><For each={builtinScenes()}>{(s) => (
          <button class="scene" onClick={() => runScene(s.actions())}><span class="scene-ico">{s.icon}</span>
            <div><div class="scene-name">{s.name}</div><div class="scene-sub">{s.sub}</div></div></button>)}</For></div>

        <Show when={nav() === 'all'}>
          <div class="chips"><For each={floors()}>{(f) => (
            <button class="chip" classList={{ active: floor() === f }} onClick={() => setFloor(f)}>{f.replace(' Level', '')}</button>)}</For></div>
        </Show>

        <Show when={state.status !== 'loading' || all().length} fallback={<Skeletons />}>
          <For each={areas()}>{(a) => (
            <section class="sec">
              <div class="sec-head"><h2>{a.name}</h2>
                <div class="meta">
                  <Show when={areaOnCount(a)}><span class="on-count">{areaOnCount(a)} on</span><button class="link" onClick={() => turnOff(a)}>Turn off</button></Show>
                  <span class="muted">{a.count}</span>
                </div></div>
              <div class="grid">
                <For each={a.climate}>{(g) => <ClimateCard group={g} onOpen={setOpen} />}</For>
                <For each={a.lights}>{(u) => <LightTile unit={u} edit={edit()} i={gi++} onOpen={setOpen} />}</For>
                <For each={a.covers}>{(d) => <CoverTile id={d.id} onOpen={setOpen} />}</For>
                <For each={a.sensors}>{(d) => <div class="card"><div class="card-top"><span class="c-ico">📡</span><span class="c-meta"><span class="c-name">{d.name}</span><span class="c-sub">{view(d.id)?.state.temp ?? '–'}° · {view(d.id)?.state.humidity ?? '–'}%</span></span></div></div>}</For>
              </div>
            </section>
          )}</For>
          <Show when={areas().every((a) => !a.count)}><p class="empty">Nothing here yet.</p></Show>
        </Show>
      </main>

      <nav class="bottom-nav">
        <button classList={{ active: nav() === 'all' }} onClick={() => { setNav('all'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>⌂</button>
        <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>✨</button>
        <button classList={{ active: edit() }} onClick={() => setEdit(!edit())}>✎</button>
      </nav>

      <DetailSheet open={open()} onClose={() => setOpen(null)} />
      <Toasts items={toasts()} />
    </div>
   </Show>
  );
}
