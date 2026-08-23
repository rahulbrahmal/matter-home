// Bottom sheet (spec §2.2): history-aware via router.openSheet/closeSheet (back gesture closes),
// drag-to-dismiss with 1:1 follow + velocity, stays mounted while closing for the exit animation,
// focus trap + Escape + scroll lock, payload-KEYED bodies (fixes the stale-props bug).
import { Show, For, createSignal, createEffect, onCleanup } from 'solid-js';
import { state, view, cmd, pendingVisible, runScene, acSetMode, togglePower, saveDevice, saveGang } from '../store.js';
import { acPowered, hideUnit } from '../model.js';
import { sheet, closeSheet } from '../router.js';
import { Icon, Toggle, throttle, fmtW, Num } from './bits.jsx';
import { modeName } from './ClimateTile.jsx';

/* ---------------- generic Sheet: children is (payload) => body ---------------- */
export function Sheet(props) {
  const [held, setHeld] = createSignal(null);    // payload kept while closing → real exit animation
  const [closing, setClosing] = createSignal(false);
  const [drag, setDrag] = createSignal(null);    // px of 1:1 finger follow, null = at rest
  let el, origin, closeT, pressed = false, y0 = 0, t0 = 0;

  createEffect(() => {
    const p = props.open;
    if (p) {
      clearTimeout(closeT); setClosing(false); setDrag(null); setHeld(() => p);
      origin = document.activeElement;
      queueMicrotask(() => el?.focus());
    } else if (held()) {
      setClosing(true);
      closeT = setTimeout(() => { setHeld(null); setClosing(false); setDrag(null); }, 340);
      origin?.focus?.();                          // return focus to the opener
    }
  });
  createEffect(() => { document.body.style.overflow = held() && !closing() ? 'hidden' : ''; }); // scroll lock
  onCleanup(() => { document.body.style.overflow = ''; clearTimeout(closeT); });

  const onKey = (e) => {
    if (e.key === 'Escape') return props.onClose();
    if (e.key !== 'Tab') return;                  // minimal focus trap: cycle within the sheet
    const f = el.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
    else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
  };
  // drag-to-dismiss: only from the top of the inner scroll; sliders own their drag
  const down = (e) => { if (el.scrollTop > 4 || e.target.closest('input,select,textarea')) return;
    pressed = true; y0 = e.clientY; t0 = performance.now(); };
  const move = (e) => { if (!pressed) return; const dy = e.clientY - y0;
    if (drag() == null && dy < 8) return;
    if (drag() == null) el.setPointerCapture?.(e.pointerId);
    setDrag(Math.max(0, dy)); };
  const up = (e) => { if (!pressed) return; pressed = false;
    const dy = drag(); if (dy == null) return;
    const v = dy / Math.max(1, performance.now() - t0);          // px/ms since press
    if (dy > el.offsetHeight * 0.25 || v > 0.5) props.onClose(); // travel or velocity dismiss
    setDrag(null); };                                            // else spring back via CSS

  return (
    <Show when={held()}>
      <div class="scrim" classList={{ closing: closing() }} onClick={props.onClose}>
        <div class="sheet" role="dialog" aria-modal="true" tabindex="-1" ref={el}
          classList={{ closing: closing(), dragging: drag() != null, tall: held()?.snap === 'tall' }}
          style={drag() != null ? { transform: `translateY(${drag()}px)`, transition: 'none' } : undefined}
          onClick={(e) => e.stopPropagation()} onKeyDown={onKey}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          <div class="grip" />
          <button class="sheet-close" aria-label="Close" onClick={props.onClose}><Icon name="x" size={16} /></button>
          <Show when={held()} keyed>{(p) => props.children(p)}</Show>
        </div>
      </div>
    </Show>
  );
}

/* ---------------- host: reads the router's sheet() signal, picks the body ---------------- */
export function SheetHost() {
  return (
    <Sheet open={sheet()} onClose={closeSheet}>{(p) =>
      p.t === 'climate' ? <ClimateDetail group={p.group} />
      : p.t === 'windows' ? <WindowsDetail groups={p.groups} room={p.room} />
      : p.t === 'light' ? <LightDetail unit={p.unit} />
      : p.body ? p.body(p) : null
    }</Sheet>
  );
}

function Head(props) {
  return <div class="sheet-head"><span class="c-ico"><Icon name={props.icon} size={24} /></span>
    <div style={{ flex: 1, 'min-width': 0 }}><div class="sheet-title">{props.title}</div><div class="c-sub">{props.sub}</div></div>
    <Show when={props.onId}><button class="ghost" onClick={props.onId} aria-label="Identify device">◎</button></Show></div>;
}

/* ---------------- climate dial (PORTED verbatim from components.jsx) ---------------- */
export function Dial(props) {
  const MIN = 16, MAX = 30, R = 100, C = 2 * Math.PI * R, SWEEP = 0.75;
  const frac = () => Math.min(1, Math.max(0, ((props.set ?? MIN) - MIN) / (MAX - MIN)));
  return (
    <div class="dial-wrap"><div class="dial">
      <svg width="230" height="230" viewBox="0 0 230 230">
        <circle cx="115" cy="115" r={R} fill="none" stroke="var(--surface-3)" stroke-width="14" stroke-linecap="round" stroke-dasharray={`${C * SWEEP} ${C}`} />
        <circle cx="115" cy="115" r={R} fill="none" stroke="var(--accent)" stroke-width="14" stroke-linecap="round" stroke-dasharray={`${C * SWEEP * frac()} ${C}`} style={{ transition: 'stroke-dasharray .3s var(--ease)' }} />
      </svg>
      <div class="center"><span class="cur-mode">{modeName(props.mode)}</span><span class="set-t"><Num value={props.set} />°</span><span class="now-t">now {props.now ?? '–'}°</span></div>
    </div>
      <div class="dial-steps"><button aria-label="Cooler" onClick={() => props.onSet((props.set ?? 24) - 0.5)}>−</button><button aria-label="Warmer" onClick={() => props.onSet((props.set ?? 24) + 0.5)}>+</button></div>
    </div>
  );
}

/* ---------------- light / fan circuit detail ---------------- */
export function LightDetail(props) {
  const u = props.unit;
  const dev = () => view(u.id);
  const lvl = () => dev()?.state.brightness;
  const multi = () => (state.byId[u.id]?.caps?.onOff || []).length > 1;
  const [name, setName] = createSignal(u.name);
  const saveName = () => multi() ? u.ids.forEach((t) => saveGang(t.id, t.ep, name())) : saveDevice(u.id, { name: name() });
  const setT = throttle((v) => u.setLevel(v), 150);
  const detent = () => { const l = lvl(); return l == null ? 0 : l <= 40 ? 33 : l <= 75 ? 66 : 100; };
  return (<>
    <Head icon={u.role === 'fan' || u.role === 'exhaust' ? 'fan' : 'bulb'} title={u.name}
      sub={[u.room, u.ids.length > 1 ? `${u.ids.length} circuits` : null].filter(Boolean).join(' · ')} onId={() => cmd.identify(u.id)} />
    <div class="sheet-body">
      <div class="block"><label>Power</label><div class="seg">
        <button classList={{ sel: !u.on() }} onClick={() => runScene(u.actions(false))}>Off</button>
        <button classList={{ sel: u.on() }} onClick={() => runScene(u.actions(true))}>On</button></div></div>
      <Show when={u.dimmable && u.role === 'fan'}>
        <div class="block"><label>Speed</label><div class="seg"><For each={[['Low', 33], ['Med', 66], ['High', 100]]}>{([l, v]) => (
          <button classList={{ sel: u.on() && detent() === v }} onClick={() => { if (!u.on()) runScene(u.actions(true)); u.setLevel(v); }}>{l}</button>)}</For></div></div>
      </Show>
      <Show when={u.dimmable && u.role !== 'fan'}>
        <div class="block"><label>Brightness · <span class="num">{lvl() ?? 0}%</span></label>
          <input type="range" min="1" max="100" value={lvl() ?? 50} aria-label={`${u.name} brightness`}
            onInput={(e) => setT(+e.currentTarget.value)} onChange={(e) => u.setLevel(+e.currentTarget.value)} /></div>
      </Show>
      <details class="settings"><summary>Settings</summary>
        <div class="block" style={{ 'margin-top': '14px' }}><label>Name{multi() ? ' · this circuit' : ''}</label>
          <div class="row"><input class="text" value={name()} onInput={(e) => setName(e.currentTarget.value)} /><button class="ghost" onClick={saveName}>Save</button></div></div>
        <div class="row" style={{ 'justify-content': 'space-between', 'margin-top': '14px' }}>
          <button class="ghost" classList={{ active: dev()?.favorite }} onClick={() => saveDevice(u.id, { favorite: !dev().favorite })}>
            <Icon name="star" size={14} /> {dev()?.favorite ? 'Favorited' : 'Favorite'}</button>
          <button class="ghost" onClick={() => { hideUnit(u); closeSheet(); }}>Hide</button></div>
      </details>
    </div>
  </>);
}

/* ---------------- climate detail: dial + modes + zone/closet power rows + readouts ---------------- */
function PowerRow(props) {
  const on = () => !!view(props.p.id)?.state.on?.some((o) => o.on);
  return <div class="gang-row"><span class="gr-name">{props.name}</span>
    <Toggle checked={on()} pending={pendingVisible(props.p.id)} label={props.name} onChange={(v) => togglePower(props.p, v)} /></div>;
}

export function ClimateDetail(props) {
  const g = props.group;
  const ac = () => view(g.ac.id);
  const cl = () => ac()?.state.climate || {};
  return (<>
    <Head icon="snowflake" title={ac()?.name === 'AC' ? `${g.room} AC` : ac()?.name}
      sub={[g.room, g.zones && `${g.zones.length} zones`].filter(Boolean).join(' · ')} onId={() => cmd.identify(g.ac.id)} />
    <div class="sheet-body">
      <Show when={!acPowered(g)}><div class="power-warn">Mains power is off — the AC won’t start until its AC&nbsp;Power switch is on. Choosing a mode switches it on first.</div></Show>
      <Dial set={cl().cool} now={g.temp() ?? cl().localTemp} mode={cl().mode} onSet={(v) => cmd.climate(g.ac.id, 'cool', v)} />
      <div class="seg"><For each={[['Off', 0], ['Cool', 3], ['Auto', 1], ['Heat', 4]]}>{([l, m]) => (
        <button classList={{ sel: (cl().mode ?? 0) === m }} onClick={() => acSetMode(g.ac.id, g.powers, m)}>{l}</button>)}</For></div>
      <Show when={g.powers.length || g.secondary?.length}>
        <div class="block"><label>{g.zones ? 'Zones' : 'AC Power'}</label>
          <div class="gang-rows">
            <For each={g.powers}>{(p) => <PowerRow p={p} name={g.zones ? (g.zones.find((z) => z.power === p)?.name || p.room) : p.name} />}</For>
            <For each={g.secondary || []}>{(p) => <PowerRow p={p} name={p.name} />}</For>
          </div></div>
      </Show>
      <div class="row readouts">
        <span class="num"><Icon name="thermo" size={15} /> {g.temp() ?? '–'}°</span>
        <Show when={g.hum() != null}><span class="num"><Icon name="droplet" size={15} /> {g.hum()}%</span></Show>
        <Show when={ac()?.state.power != null}><span class="num"><Icon name="bolt" size={15} /> {fmtW(ac().state.power)}</span></Show>
      </div>
    </div>
  </>);
}

/* ---------------- windows detail: master + group rows + per-motor rows one level deeper ---------------- */
function MotorRow(props) {
  const pct = () => view(props.m.id)?.state.coverPct;
  return (
    <div class="motor-row">
      <span class="gr-name">{props.m.name} <span class="c-sub num">{pct() ?? '–'}%</span></span>
      <div class="cover-ctl">
        <button aria-label={`Open ${props.m.name}`} onClick={() => cmd.cover(props.m.id, 'open')}><Icon name="chevron-up" size={14} /></button>
        <button aria-label={`Stop ${props.m.name}`} onClick={() => cmd.cover(props.m.id, 'stop')}><Icon name="stop" size={14} /></button>
        <button aria-label={`Close ${props.m.name}`} onClick={() => cmd.cover(props.m.id, 'close')}><Icon name="chevron-down" size={14} /></button>
      </div>
    </div>
  );
}

export function WindowsDetail(props) {
  const motors = () => props.groups.reduce((n, g) => n + g.members.length, 0);
  const all = (a, v) => runScene(props.groups.flatMap((g) => g.actions(a, v))); // one batched scene for 8 motors
  return (<>
    <Head icon="blind" title="Windows" sub={[props.room, `${motors()} motors`].filter(Boolean).join(' · ')} />
    <div class="sheet-body">
      <div class="block"><label>All windows</label>
        <div class="seg"><button onClick={() => all('open')}>Open</button><button onClick={() => all('stop')}>Stop</button><button onClick={() => all('close')}>Close</button></div></div>
      <For each={props.groups}>{(g) => (
        <div class="block">
          <label>{g.name} · <span class="num">{g.pct() ?? '–'}%</span></label>
          <input type="range" min="0" max="100" value={g.pct() ?? 0} aria-label={`${g.name} position`}
            onChange={(e) => runScene(g.actions('set', +e.currentTarget.value))} />
          <div class="seg" style={{ 'margin-top': '10px' }}>
            <button onClick={() => runScene(g.actions('open'))}>Open</button>
            <button onClick={() => runScene(g.actions('stop'))}>Stop</button>
            <button onClick={() => runScene(g.actions('close'))}>Close</button></div>
          <details class="motor-rows"><summary>Each motor</summary>
            <For each={g.members}>{(m) => <MotorRow m={m} />}</For></details>
        </div>
      )}</For>
    </div>
  </>);
}
