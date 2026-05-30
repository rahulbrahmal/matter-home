import { Show, For, createSignal, createMemo } from 'solid-js';
import { view, cmd, isPending, saveDevice, saveGang, acSetMode, togglePower, state } from './store.js';
import { acPowered } from './home.js';

const modeName = (m) => ({ 0: 'Off', 1: 'Auto', 3: 'Cooling', 4: 'Heating' }[m] ?? '–');
const lightIcon = (n) => /fan|exhaust/i.test(n) ? '🌀' : /drop|pendant|chandel/i.test(n) ? '🪔' : '💡';

/* ---------------- Light unit tile (one per named gang / single switch) ---------------- */
export function LightTile(props) {
  const u = () => props.unit;
  const dev = () => view(u().id);
  const o = () => dev()?.state.on?.find((x) => x.ep === u().ep);
  const on = () => !!o()?.on;
  const bri = () => dev()?.state.brightness;
  const toggle = (e) => { e?.stopPropagation?.(); cmd.toggle(u().id, u().ep, !on()); };
  const tap = () => props.edit ? props.onOpen({ t: 'light', ...u() }) : toggle();
  return (
    <div class="card" role="button" classList={{ on: on(), pending: isPending(u().id) }} onClick={tap}>
      <div class="card-top">
        <span class="c-ico">{lightIcon(u().name)}</span>
        <span class="c-meta"><span class="c-name">{u().name}</span><span class="c-sub">{on() ? (u().dimmable && bri() != null ? `On · ${bri()}%` : 'On') : 'Off'}</span></span>
        <button class="power" classList={{ on: on() }} onClick={toggle}>⏻</button>
      </div>
      <Show when={u().dimmable && on()}>
        <div class="card-foot" onClick={(e) => e.stopPropagation()}>
          <input class="slider" type="range" min="1" max="100" value={bri() ?? 50} onInput={(e) => cmd.level(u().id, +e.currentTarget.value)} />
        </div>
      </Show>
    </div>
  );
}

/* ---------------- Consolidated climate card (AC + AC-Power + humidity) ---------------- */
export function ClimateCard(props) {
  const g = () => props.group;
  const ac = () => view(g().ac.id);
  const cl = () => ac()?.state.climate || {};
  const hum = () => g().sensor ? view(g().sensor.id)?.state.humidity : null;
  const on = () => (cl().mode ?? 0) !== 0;
  const name = () => ac()?.name === 'AC' ? 'Air Conditioner' : ac()?.name;
  return (
    <div class="card climate-card" role="button" classList={{ on: on() }} onClick={() => props.onOpen({ t: 'climate', group: g() })}>
      <div class="card-top">
        <span class="c-ico">❄️</span>
        <span class="c-meta"><span class="c-name">{name()}</span>
          <span class="c-sub">{modeName(cl().mode)}<Show when={!acPowered(g())}> · ⚡ power off</Show><Show when={g().powers.length > 1}> · {g().powers.length} zones</Show></span></span>
      </div>
      <div class="card-foot climate-mini">
        <span class="t">{cl().localTemp ?? '–'}<small>°</small></span>
        <span class="set"><Show when={hum() != null}>💧 {hum()}%<br /></Show>set <b>{cl().cool ?? '–'}°</b></span>
      </div>
    </div>
  );
}

/* ---------------- Cover tile ---------------- */
export function CoverTile(props) {
  const d = () => view(props.id);
  const st = () => d()?.state || {};
  const open = () => (st().coverPct ?? 0) > 0;
  return (
    <div class="card" role="button" classList={{ on: open() }} onClick={() => props.onOpen({ t: 'cover', id: props.id })}>
      <div class="card-top"><span class="c-ico">🪟</span>
        <span class="c-meta"><span class="c-name">{d()?.name}</span><span class="c-sub">{st().coverPct != null ? `${st().coverPct}% open` : 'Shade'}</span></span></div>
      <div class="card-foot" onClick={(e) => e.stopPropagation()}>
        <div class="cover-ctl"><button onClick={() => cmd.cover(props.id, 'open')}>▲</button><button onClick={() => cmd.cover(props.id, 'stop')}>■</button><button onClick={() => cmd.cover(props.id, 'close')}>▼</button></div>
      </div>
    </div>
  );
}

/* ---------------- Climate dial ---------------- */
function Dial(props) {
  const MIN = 16, MAX = 30, R = 100, C = 2 * Math.PI * R, SWEEP = 0.75;
  const frac = () => Math.min(1, Math.max(0, ((props.set ?? MIN) - MIN) / (MAX - MIN)));
  return (
    <div class="dial-wrap"><div class="dial">
      <svg width="230" height="230" viewBox="0 0 230 230">
        <circle cx="115" cy="115" r={R} fill="none" stroke="var(--surface-3)" stroke-width="14" stroke-linecap="round" stroke-dasharray={`${C * SWEEP} ${C}`} />
        <circle cx="115" cy="115" r={R} fill="none" stroke="var(--accent)" stroke-width="14" stroke-linecap="round" stroke-dasharray={`${C * SWEEP * frac()} ${C}`} style={{ transition: 'stroke-dasharray .3s var(--ease)' }} />
      </svg>
      <div class="center"><span class="cur-mode">{modeName(props.mode)}</span><span class="set-t">{props.set ?? '–'}°</span><span class="now-t">now {props.now ?? '–'}°</span></div>
    </div>
      <div class="dial-steps"><button onClick={() => props.onSet((props.set ?? 24) - 0.5)}>−</button><button onClick={() => props.onSet((props.set ?? 24) + 0.5)}>+</button></div>
    </div>
  );
}

/* ---------------- Detail sheet (handles light | climate | cover) ---------------- */
export function DetailSheet(props) {
  const open = () => props.open;
  return (
    <Show when={open()}>
      <div class="scrim" onClick={props.onClose}>
        <div class="sheet" onClick={(e) => e.stopPropagation()}>
          <div class="grip" />
          <Show when={open().t === 'climate'}>{ClimateDetail({ group: open().group, close: props.onClose })}</Show>
          <Show when={open().t === 'cover'}>{CoverDetail({ id: open().id })}</Show>
          <Show when={open().t === 'light'}>{LightDetail({ unit: open(), close: props.onClose })}</Show>
        </div>
      </div>
    </Show>
  );
}

function Head(props) {
  return <div class="sheet-head"><span class="c-ico">{props.icon}</span>
    <div style={{ flex: 1 }}><div class="sheet-title">{props.title}</div><div class="c-sub">{props.sub}</div></div>
    <Show when={props.onId}><button class="ghost" onClick={props.onId}>◎</button></Show></div>;
}

function ClimateDetail(props) {
  const g = props.group; const ac = () => view(g.ac.id); const cl = () => ac()?.state.climate || {};
  const hum = () => g.sensor ? view(g.sensor.id)?.state.humidity : null;
  const sub = () => [ac()?.room, ac()?.floor].filter(Boolean).join(' · ') + (g.powers.length > 1 ? ` · ${g.powers.length} zones` : '');
  return (<>
    <Head icon="❄️" title={ac().name === 'AC' ? 'Air Conditioner' : ac().name} sub={sub()} onId={() => cmd.identify(g.ac.id)} />
    <div class="sheet-body">
      <Show when={!acPowered(g)}><div class="power-warn">⚡ Mains power is off — the AC won’t start until its AC&nbsp;Power switch is on. Choosing a mode will switch it on first.</div></Show>
      <Dial set={cl().cool} now={cl().localTemp} mode={cl().mode} onSet={(v) => cmd.climate(g.ac.id, 'cool', v)} />
      <div class="seg"><For each={[['Off', 0], ['Cool', 3], ['Auto', 1], ['Heat', 4]]}>{([l, m]) => (
        <button classList={{ sel: (cl().mode ?? 0) === m }} onClick={() => acSetMode(g.ac.id, g.powers, m)}>{l}</button>)}</For></div>
      <Show when={g.powers.length}>
        <div class="block"><label>AC Power {g.powers.length > 1 ? '· zones' : ''}</label>
          <div class="gang-rows"><For each={g.powers}>{(p) => {
            const pon = () => view(p.id)?.state.on?.some((o) => o.on);
            return <div class="gang-row"><span class="gr-name">{p.name}</span><button class="power" classList={{ on: pon() }} onClick={() => togglePower(p, !pon())}>⏻</button></div>;
          }}</For></div></div>
      </Show>
      <div class="row" style={{ gap: '20px', color: 'var(--muted)', 'font-weight': 600 }}>
        <span>🌡 {cl().localTemp ?? '–'}°</span><Show when={hum() != null}><span>💧 {hum()}%</span></Show>
      </div>
    </div>
  </>);
}

function CoverDetail(props) {
  const d = () => view(props.id); const st = () => d()?.state || {};
  return (<>
    <Head icon="🪟" title={d().name} sub={[d().room, d().floor].filter(Boolean).join(' · ')} onId={() => cmd.identify(props.id)} />
    <div class="sheet-body">
      <div class="block"><label>Position · {st().coverPct ?? 0}%</label>
        <input type="range" min="0" max="100" value={st().coverPct ?? 0} onChange={(e) => cmd.cover(props.id, 'set', +e.currentTarget.value)} />
        <div class="seg" style={{ 'margin-top': '12px' }}><button onClick={() => cmd.cover(props.id, 'open')}>Open</button><button onClick={() => cmd.cover(props.id, 'stop')}>Stop</button><button onClick={() => cmd.cover(props.id, 'close')}>Close</button></div></div>
    </div>
  </>);
}

function LightDetail(props) {
  const u = props.unit; const dev = () => view(u.id);
  const multi = () => (dev()?.state.on || []).length > 1;
  const [name, setName] = createSignal(u.name);
  const saveName = () => multi() ? saveGang(u.id, u.ep, name()) : saveDevice(u.id, { name: name() });
  const on = () => dev()?.state.on?.find((x) => x.ep === u.ep)?.on;
  return (<>
    <Head icon={lightIcon(u.name)} title={u.name} sub={dev()?.room} />
    <div class="sheet-body">
      <div class="block"><label>Power</label><div class="seg">
        <button classList={{ sel: !on() }} onClick={() => cmd.toggle(u.id, u.ep, false)}>Off</button>
        <button classList={{ sel: on() }} onClick={() => cmd.toggle(u.id, u.ep, true)}>On</button></div></div>
      <Show when={u.dimmable}><div class="block"><label>Brightness · {dev()?.state.brightness ?? 0}%</label>
        <input type="range" min="1" max="100" value={dev()?.state.brightness ?? 50} onInput={(e) => cmd.level(u.id, +e.currentTarget.value)} /></div></Show>
      <div class="block"><label>Name {multi() ? '· this light' : ''}</label>
        <div class="row"><input class="text" value={name()} onInput={(e) => setName(e.currentTarget.value)} /><button class="ghost" onClick={saveName}>Save</button></div></div>
      <div class="row" style={{ 'justify-content': 'space-between' }}>
        <button class="ghost" classList={{ active: dev()?.favorite }} onClick={() => saveDevice(u.id, { favorite: !dev().favorite })}>{dev()?.favorite ? '★ Favorited' : '☆ Favorite'}</button>
        <button class="ghost" onClick={() => { saveDevice(u.id, { hidden: true }); props.close(); }}>Hide device</button></div>
    </div>
  </>);
}

export function Skeletons() { return <div class="grid">{Array.from({ length: 9 }).map(() => <div class="skeleton" />)}</div>; }
export function Toasts(props) { return <div class="toasts"><For each={props.items}>{(t) => <div class="toast">{t.msg}</div>}</For></div>; }
