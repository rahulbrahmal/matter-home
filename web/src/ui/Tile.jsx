// Circuit tiles (spec §2.2): 2-up 174x64 Tile (tap-anywhere toggle, long-press = detail; optional
// `name` prop = display override, e.g. Rooms.jsx room-prefix shortener — detail sheet keeps u.name),
// full-width DimmerTile (throttled inline slider), FanChip (3-detent in sheet), EssentialChip (live watts).
import { view } from '../store.js';
import { openSheet } from '../router.js';
import { Icon, pressHandlers, throttle, fmtW, introIndex, usePop } from './bits.jsx';

const iconFor = (u) => u.role === 'fan' || u.role === 'exhaust' ? 'fan' : u.role === 'appliance' ? 'plug' : 'bulb';
const detail = (u) => openSheet({ t: 'light', unit: u });

/* ---------------- Tile: one binary circuit, 64px, no inner power button ---------------- */
export function Tile(props) {
  const u = () => props.unit;
  const ei = introIndex(props.i);            // initial-load stagger slot (null after first paint)
  const [pop, kick] = usePop();              // icon spring on toggle (§3)
  const sub = () => props.sub ?? (u().on() ? (u().dimmable && u().level() != null ? `On · ${u().level()}%` : 'On') : 'Off');
  return (
    <button class="tile" aria-pressed={u().on()} aria-busy={u().pending()} style={ei != null ? { '--i': ei } : undefined}
      classList={{ on: u().on(), pending: u().pending(), unreachable: view(u().id)?.reachable === false, 'tile-enter': ei != null }}
      {...pressHandlers({ tap: () => { kick(); u().toggle(); }, hold: () => detail(u()) })}>
      <span class="tile-ico" classList={{ pop: pop() }}><Icon name={props.icon || iconFor(u())} /></span>
      <span class="tile-meta"><span class="tile-name">{props.name ?? u().name}</span><span class="tile-sub num">{sub()}</span></span>
    </button>
  );
}

/* ---------------- DimmerTile: full-width hero (Baby's dimmer, Study ceiling) ---------------- */
export function DimmerTile(props) {
  const u = () => props.unit;
  const ei = introIndex(props.i);
  const [pop, kick] = usePop();
  const lvl = () => u().level();
  const setT = throttle((v) => u().setLevel(v), 150); // onInput throttled; onChange = final commit
  return (
    <div class="tile dimmer-tile" aria-busy={u().pending()} style={ei != null ? { '--i': ei } : undefined}
      classList={{ on: u().on(), pending: u().pending(), 'tile-enter': ei != null }}>
      <button class="dim-main" aria-pressed={u().on()}
        {...pressHandlers({ tap: () => { kick(); u().toggle(); }, hold: () => detail(u()) })}>
        <span class="tile-ico" classList={{ pop: pop() }}><Icon name="bulb" /></span>
        <span class="tile-meta"><span class="tile-name">{u().name}</span><span class="tile-sub num">{u().on() ? `On · ${lvl() ?? '–'}%` : 'Off'}</span></span>
      </button>
      <input class="dim-slider" type="range" min="1" max="100" value={lvl() ?? 50} aria-label={`${u().name} brightness`}
        onInput={(e) => setT(+e.currentTarget.value)} onChange={(e) => u().setLevel(+e.currentTarget.value)} />
    </div>
  );
}

/* ---------------- FanChip: tile geometry, fan icon; 3-detent speed lives in the sheet ---------------- */
export function FanChip(props) {
  const u = () => props.unit;
  const speed = () => { const l = u().level(); return l == null ? '' : l <= 40 ? ' · Low' : l <= 75 ? ' · Med' : ' · High'; };
  return <Tile unit={props.unit} i={props.i} name={props.name} icon="fan" sub={u().on() ? `On${u().dimmable ? speed() : ''}` : 'Off'} />;
}

/* ---------------- EssentialChip: 44px pill, live watts, amber when on ---------------- */
export function EssentialChip(props) {
  const u = () => props.unit;
  const ei = introIndex(props.i);
  const w = () => props.watts !== undefined ? props.watts : u().watts?.();
  return (
    <button class="chip ess-chip" aria-pressed={u().on()} aria-busy={u().pending()} style={ei != null ? { '--i': ei } : undefined}
      classList={{ on: u().on(), pending: u().pending(), 'tile-enter': ei != null }}
      onClick={() => u().toggle()}>
      <Icon name={props.icon || (u().role === 'appliance' ? 'plug' : 'bulb')} size={16} />
      <span>{props.label || u().name}<span class="num">{u().on() && w() != null ? ` · ${fmtW(w())}` : ''}</span></span>
    </button>
  );
}
