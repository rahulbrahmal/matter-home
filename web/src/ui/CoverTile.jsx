// One top-level tile PER cover rail (Sheers / Shades / Blackouts…): tap = open/close-all for
// that rail's motors (one synced state), long-press/chevron = that rail's detail sheet.
import { pendingVisible, runScene } from '../store.js';
import { openSheet } from '../router.js';
import { Icon, pressHandlers, introIndex } from './bits.jsx';

export function CoverTile(props) {
  const g = () => props.group;
  const ei = introIndex(props.i);
  const pct = () => g().pct() ?? 0;
  const pending = () => g().members.some((m) => pendingVisible(m.id));
  const sub = () => { const p = pct(); return (p <= 2 ? 'Closed' : p >= 98 ? 'Open' : `Partly open · ${p}%`) + ` · ${g().members.length} motors`; };
  const open = () => openSheet({ t: 'covers', group: g(), room: props.room });
  const tap = () => runScene(g().actions(pct() > 5 ? 'close' : 'open')); // one batched scene per rail
  return (
    <div class="tile windows-tile" role="button" tabindex="0" aria-label={`${g().name}, ${sub()}`} aria-busy={pending()}
      style={ei != null ? { '--i': ei } : undefined} classList={{ on: pct() > 5, pending: pending(), 'tile-enter': ei != null }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(); } }}
      {...pressHandlers({ tap, hold: open })}>
      <span class="tile-ico"><Icon name="blind" /></span>
      <span class="tile-meta"><span class="tile-name">{g().name}</span><span class="tile-sub num">{sub()}</span></span>
      <button class="ctile-more" aria-label={`${g().name} details`} onClick={(e) => { e.stopPropagation(); open(); }}><Icon name="chevron-right" size={16} /></button>
      <div class="pos-bar" style={{ width: pct() + '%' }} />
    </div>
  );
}
