import { Show, For, createSignal } from 'solid-js';
import { view, cmd, isPending, saveDevice, state } from './store.js';

export const ICON = { light: '\u{1F4A1}', switch: '\u{1F518}', outlet: '\u{1F50C}', thermostat: '❄️', cover: '\u{1FA9F}', sensor: '\u{1F4C8}', other: '•' };
const anyOn = (st) => st.on?.some((o) => o.on);

// ---------- Tile ----------
export function DeviceTile(props) {
  const d = () => view(props.id);
  const st = () => d()?.state || {};
  const type = () => d()?.type;
  const shortName = () => { const n = d()?.name || '', r = d()?.room; return (!props.showRoom && r && n.startsWith(r + ' ')) ? n.slice(r.length + 1) : n; };
  const single = () => st().on && st().on.length === 1;
  const active = () => (type() === 'cover' ? (st().coverPct ?? 0) > 0 : type() === 'thermostat' ? (st().climate?.mode ?? 0) !== 0 : anyOn(st()));
  const openDetail = (e) => { e.stopPropagation(); props.onOpen(props.id); };
  const tileClick = () => { if (single()) cmd.toggle(props.id, st().on[0].ep, !st().on[0].on); else props.onOpen(props.id); };

  return (
    <div class="tile" role="button" tabindex="0" style={{ '--i': props.i ?? 0 }}
      classList={{ on: active(), off: st().online !== false && !active(), unreachable: st().online === false, pending: isPending(props.id) }}
      data-type={type()} onClick={tileClick}>
      <div class="tile-top">
        <span class="tile-icon">{ICON[type()] || ICON.other}</span>
        <div class="tile-meta">
          <span class="tile-name">{shortName()}</span>
          <span class="tile-sub">
            <Show when={props.showRoom && d()?.room}>{d().room} · </Show>
            <Show when={st().online === false} fallback={subLabel(type(), st())}>Unreachable</Show>
          </span>
        </div>
        <Show when={props.edit}><span class="fav-star" classList={{ set: d()?.favorite }}
          onClick={(e) => { e.stopPropagation(); saveDevice(props.id, { favorite: !d().favorite }); }}>{d()?.favorite ? '★' : '☆'}</span></Show>
        <button class="chev" onClick={openDetail} title="Details">›</button>
      </div>

      <div class="tile-ctl" onClick={(e) => e.stopPropagation()}>
        <Show when={st().on && st().on.length > 1}>
          <div class="gangs">
            <For each={st().on}>{(o, i) => (
              <button class="gang" classList={{ on: o.on }} onClick={() => cmd.toggle(props.id, o.ep, !o.on)}>{i() + 1}</button>
            )}</For>
          </div>
        </Show>
        <Show when={st().brightness != null && active()}>
          <input class="mini-slider" type="range" min="1" max="100" value={st().brightness}
            onInput={(e) => cmd.level(props.id, +e.currentTarget.value)} />
        </Show>
        <Show when={type() === 'cover'}>
          <div class="cover-row">
            <button onClick={() => cmd.cover(props.id, 'open')}>▲</button>
            <button onClick={() => cmd.cover(props.id, 'stop')}>■</button>
            <button onClick={() => cmd.cover(props.id, 'close')}>▼</button>
          </div>
        </Show>
        <Show when={type() === 'thermostat'}>
          <div class="thermo-row">
            <button onClick={() => cmd.climate(props.id, 'cool', (st().climate?.cool ?? 24) - 0.5)}>−</button>
            <b>{st().climate?.cool ?? '–'}°</b>
            <button onClick={() => cmd.climate(props.id, 'cool', (st().climate?.cool ?? 24) + 0.5)}>+</button>
          </div>
        </Show>
      </div>
    </div>
  );
}

function subLabel(type, st) {
  if (type === 'thermostat') return `${st.climate?.localTemp ?? '–'}° now`;
  if (type === 'sensor') return [st.temp != null && `${st.temp}°`, st.humidity != null && `${st.humidity}%`].filter(Boolean).join('  ');
  if (type === 'cover') return st.coverPct != null ? `${st.coverPct}% open` : 'Cover';
  if (st.on) { const n = st.on.filter((o) => o.on).length; const out = st.on.length > 1 ? `${n}/${st.on.length} on` : (n ? 'On' : 'Off'); return st.power ? `${out} · ${st.power} W` : out; }
  return '';
}

// ---------- Detail sheet ----------
export function DetailSheet(props) {
  const d = () => view(props.id);
  const st = () => d()?.state || {};
  const [name, setName] = createSignal(d()?.name || '');
  const close = () => props.onClose();

  return (
    <Show when={d()}>
      <div class="sheet-backdrop" onClick={close}>
        <div class="sheet" onClick={(e) => e.stopPropagation()}>
          <div class="sheet-grip" />
          <div class="sheet-head">
            <span class="tile-icon big">{ICON[d().type]}</span>
            <div><div class="sheet-title">{d().name}</div><div class="tile-sub">{[d().room, d().floor].filter(Boolean).join(' · ') || 'Unassigned'}</div></div>
            <button class="ghost" onClick={() => cmd.identify(props.id)} title="Blink device">◎ Identify</button>
          </div>

          <div class="sheet-body">
            <Show when={st().on}>
              <div class="field"><label>Power</label>
                <div class="gangs wide"><For each={st().on}>{(o, i) => (
                  <button class="gang lg" classList={{ on: o.on }} onClick={() => cmd.toggle(props.id, o.ep, !o.on)}>{st().on.length > 1 ? `Gang ${i() + 1}` : (o.on ? 'On' : 'Off')}</button>
                )}</For></div>
              </div>
            </Show>
            <Show when={st().brightness != null}>
              <div class="field"><label>Brightness <b>{st().brightness}%</b></label>
                <input type="range" min="1" max="100" value={st().brightness} onInput={(e) => cmd.level(props.id, +e.currentTarget.value)} /></div>
            </Show>
            <Show when={st().climate}>
              <div class="field"><label>Temperature</label>
                <div class="big-climate"><span class="now">{st().climate.localTemp ?? '–'}°<small>current</small></span>
                  <div class="stepper"><button onClick={() => cmd.climate(props.id, 'cool', (st().climate.cool ?? 24) - 0.5)}>−</button>
                    <span>{st().climate.cool ?? '–'}°</span>
                    <button onClick={() => cmd.climate(props.id, 'cool', (st().climate.cool ?? 24) + 0.5)}>+</button></div></div>
                <div class="seg">
                  <For each={[['Off', 0], ['Cool', 3], ['Auto', 1], ['Heat', 4]]}>{([lbl, m]) => (
                    <button classList={{ sel: (st().climate.mode ?? 0) === m }} onClick={() => cmd.mode(props.id, m)}>{lbl}</button>
                  )}</For>
                </div></div>
            </Show>
            <Show when={d().type === 'cover'}>
              <div class="field"><label>Position {st().coverPct != null ? `${st().coverPct}%` : ''}</label>
                <input type="range" min="0" max="100" value={st().coverPct ?? 0} onChange={(e) => cmd.cover(props.id, 'set', +e.currentTarget.value)} />
                <div class="cover-row wide"><button onClick={() => cmd.cover(props.id, 'open')}>Open</button><button onClick={() => cmd.cover(props.id, 'stop')}>Stop</button><button onClick={() => cmd.cover(props.id, 'close')}>Close</button></div></div>
            </Show>
            <div class="readouts sheet-ro">
              <Show when={st().temp != null}><span>🌡 {st().temp}°</span></Show>
              <Show when={st().humidity != null}><span>💧 {st().humidity}%</span></Show>
              <Show when={st().power != null}><span>⚡ {st().power} W</span></Show>
            </div>

            <details class="customize"><summary>Customize</summary>
              <div class="field"><label>Name</label>
                <div class="row"><input value={name()} onInput={(e) => setName(e.currentTarget.value)} />
                  <button class="ghost" onClick={() => saveDevice(props.id, { name: name() })}>Save</button></div></div>
              <div class="field"><label>Room</label>
                <select onChange={(e) => saveDevice(props.id, { room: e.currentTarget.value })}>
                  <option value="">Unassigned</option>
                  <For each={state.home.areas}>{(a) => <option value={a.name} selected={a.name === d().room}>{a.name}</option>}</For>
                </select></div>
              <div class="row toggles-row">
                <button class="ghost" classList={{ active: d().favorite }} onClick={() => saveDevice(props.id, { favorite: !d().favorite })}>{d().favorite ? '★ Favorited' : '☆ Favorite'}</button>
                <button class="ghost" onClick={() => { saveDevice(props.id, { hidden: true }); close(); }}>Hide</button>
              </div>
              <div class="meta-line">{d().type} · serial {d().serial}</div>
            </details>
          </div>
        </div>
      </div>
    </Show>
  );
}

export function Skeletons() {
  return <div class="grid">{Array.from({ length: 8 }).map(() => <div class="tile skeleton" />)}</div>;
}

export function Toasts(props) {
  return <div class="toasts"><For each={props.items}>{(t) => <div class={`toast ${t.kind}`}>{t.msg}</div>}</For></div>;
}
