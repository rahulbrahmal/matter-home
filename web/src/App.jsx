// Shell only (spec §4 step 4): Login gate → header (greeting + avatar → Settings sheet) →
// route switch (#/ Home, #/room/<id> pager) → SheetHost → Toasts → reconnect banner.
// All grouping logic lives in model.js; all controls in ui/ + views/.
import { onMount, createSignal, createMemo, Show, For } from 'solid-js';
import { state, connect, login, auth, toasts, saveDevice, logout } from './store.js';
import { rooms, needsSetup } from './model.js';
import { route, openSheet } from './router.js';
import Home from './views/Home.jsx';
import Rooms from './views/Rooms.jsx';
import { SheetHost } from './ui/Sheet.jsx';
import { Toasts, Toggle, Icon } from './ui/bits.jsx';

const greet = () => { const h = new Date().getHours(); return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 22 ? 'Good evening' : 'Good night'; };

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

/* Settings sheet: Power & circuits (hidden relays/spares/circuit-masters) + Needs setup (room:null) */
function SettingsBody() {
  const hidden = createMemo(() => rooms().flatMap((r) => r.hidden.map((u) => ({ u, room: r.name }))));
  return (<>
    <div class="sheet-head"><span class="c-ico"><Icon name="user" size={24} /></span>
      <div style={{ flex: 1, 'min-width': 0 }}><div class="sheet-title">Settings</div>
        <div class="c-sub num">{Object.keys(state.byId).length} devices</div></div></div>
    <div class="sheet-body">
      <details class="settings"><summary>Power &amp; circuits</summary>
        <div class="gang-rows" style={{ 'margin-top': '14px' }}>
          <For each={hidden()}>{({ u, room }) => (
            <div class="gang-row"><span class="gr-name">{u.name}<span class="c-sub">{room}</span></span>
              <Show when={u.hidden}><button class="ghost" onClick={() => saveDevice(u.id, { hidden: false })}>Unhide</button></Show>
              <Toggle checked={u.on()} pending={u.pending()} label={u.name} onChange={() => u.toggle()} /></div>)}</For>
          <Show when={!hidden().length}><p class="muted">No hidden circuits.</p></Show>
        </div></details>
      <Show when={needsSetup().length}>
        <details class="settings" open><summary>Needs setup</summary>
          <div class="gang-rows" style={{ 'margin-top': '14px' }}>
            <For each={needsSetup()}>{(n) => (
              <div class="gang-row"><span class="gr-name">{n.device.name}<span class="c-sub">{n.device.id}</span></span>
                <Show when={n.suggest}><button class="ghost" onClick={() => saveDevice(n.device.id, { room: n.suggest })}>Assign to {n.suggest}?</button></Show>
              </div>)}</For>
          </div></details>
      </Show>
      <button class="ghost" style={{ 'align-self': 'flex-start' }} onClick={logout}>Sign out</button>
    </div>
  </>);
}

export default function App() {
  onMount(connect);
  return (
    <Show when={state.status !== 'needauth'} fallback={<><div class="ambient" /><Login /></>}>
      <div class="ambient" />
      <Show when={state.status === 'reconnecting'}><div class="banner">Reconnecting…</div></Show>
      <Show when={route().name === 'room'} fallback={
        <main class="main home-view">
          <header class="greeting">
            <div><p class="greet-line">{greet()}</p><h1>Welcome home</h1></div>
            <button class="avatar" aria-label="Settings" onClick={() => openSheet({ body: () => <SettingsBody /> })}><Icon name="user" size={19} /></button>
          </header>
          <Home />
        </main>
      }>
        <Rooms />
      </Show>
      <SheetHost />
      <Toasts items={toasts()} />
    </Show>
  );
}
