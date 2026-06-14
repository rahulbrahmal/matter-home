// Climate tiles (spec §1.2b, §2.2): rail ClimateTile 240x96 + full-width room ClimateCard.
// 5-state machine on top of acSetMode/acPowered: off / powering / on(cooling) / idle / poweroff(amber).
import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import { view, acSetMode, pendingVisible } from '../store.js';
import { acPowered } from '../model.js';
import { openSheet } from '../router.js';
import { Icon, pressHandlers, fmtW, introIndex, Num } from './bits.jsx';

export const modeName = (m) => ({ 0: 'Off', 1: 'Auto', 3: 'Cooling', 4: 'Heating' }[m] ?? '–');

// shared state machine; tap is always the safe sequenced action (§1.4)
function useClim(g) {
  const [powering, setPowering] = createSignal(null); // requested mode while mains/compressor confirmation settles
  let capT;
  const mode = () => g.mode();
  const st = () => powering() ? 'powering'
    : mode() !== 0 ? (acPowered(g) ? 'on' : 'poweroff')   // poweroff = the Bedroom Hallway trap (amber)
    : acPowered(g) ? 'idle' : 'off';
  const watts = () => view(g.ac.id)?.state.power;
  const seq = (m) => {
    clearTimeout(capT);
    setPowering(m);
    capT = setTimeout(() => setPowering(null), 8000);
    acSetMode(g.ac.id, g.powers, m);
  };
  createEffect(() => {
    const target = powering();
    if (!target) return;
    if (acPowered(g) && mode() === target) { clearTimeout(capT); setPowering(null); }
  });
  onCleanup(() => clearTimeout(capT));
  const tap = () => { const s = st(); if (s === 'powering') return;
    s === 'on' ? acSetMode(g.ac.id, g.powers, 0)          // off = mode 0; mains stays on → Idle
    : seq(s === 'poweroff' ? mode() : 3); };              // one tap re-sequences the trap; else power → cool
  const label = () => { const s = st(), w = fmtW(watts());
    return s === 'powering' ? 'Powering…'
      : s === 'poweroff' ? 'Power off'
      : s === 'on' ? `${modeName(mode())} → ${g.setpoint() ?? '–'}°${w ? ` · ${w}` : ''}`
      : s === 'idle' ? `Idle${w ? ` · ${w}` : ''}` : 'Off'; };
  const pending = () => pendingVisible(g.ac.id) || g.powers.some((p) => pendingVisible(p.id));
  return { st, tap, label, pending };
}
const openDetail = (g) => openSheet({ t: 'climate', group: g, snap: 'tall' });
const key = (fn) => (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } };

/* ---------------- rail tile 240x96: tap = sequenced on/off; long-press/chevron = dial sheet ---------------- */
export function ClimateTile(props) {
  const g = props.group, c = useClim(g);
  const ei = introIndex(props.i);
  return (
    <div class="ctile" role="button" tabindex="0" aria-label={`${g.room} climate`} style={ei != null ? { '--i': ei } : undefined}
      aria-busy={c.pending()}
      classList={{ on: c.st() === 'on', breathing: c.st() === 'powering', warn: c.st() === 'poweroff', pending: c.pending(), 'tile-enter': ei != null }}
      onKeyDown={key(c.tap)} {...pressHandlers({ tap: c.tap, hold: () => openDetail(g) })}>
      <div class="ctile-top">
        <span class="tile-ico"><Icon name="snowflake" /></span>
        <span class="ctile-name">{g.room}</span>
        <button class="ctile-more" aria-label={`${g.room} details`} onClick={(e) => { e.stopPropagation(); openDetail(g); }}><Icon name="chevron-down" size={16} /></button>
      </div>
      <div class="ctile-foot">
        <span class="ctile-temp"><Num value={g.temp()} /><small>°</small></span>
        <Show when={c.st() === 'poweroff'} fallback={<span class="ctile-sub num">{c.label()}</span>}>
          <span class="badge warn">Power off</span>
        </Show>
      </div>
    </div>
  );
}

/* ---------------- room page card, full-width x84: power circle = sequenced toggle; elsewhere = sheet ---------------- */
export function ClimateCard(props) {
  const g = props.group, c = useClim(g);
  const ei = introIndex(props.i);
  const sub = () => [c.label(), g.hum() != null ? `${g.hum()}%` : null, g.zones ? `${g.zones.length} zones` : null].filter(Boolean).join(' · ');
  return (
    <div class="ccard" role="button" tabindex="0" style={ei != null ? { '--i': ei } : undefined}
      aria-busy={c.pending()}
      classList={{ on: c.st() === 'on', warn: c.st() === 'poweroff', pending: c.pending(), 'tile-enter': ei != null }}
      onClick={() => openDetail(g)} onKeyDown={key(() => openDetail(g))}>
      <span class="tile-ico"><Icon name="snowflake" /></span>
      <span class="tile-meta"><span class="tile-name">{g.zones ? 'Air Conditioner' : `${g.room} AC`}</span><span class="tile-sub num">{sub()}</span></span>
      <span class="ccard-temp"><Num value={g.temp()} /><small>°</small></span>
      <button class="power ccard-power" aria-label={`${g.room} AC power`} aria-pressed={c.st() === 'on'}
        aria-busy={c.pending()}
        classList={{ on: c.st() === 'on', breathing: c.st() === 'powering' }}
        onClick={(e) => { e.stopPropagation(); c.tap(); }}><Icon name="power" size={18} /></button>
    </div>
  );
}
