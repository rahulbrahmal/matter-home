// ONE Windows tile per room (spec §1.3 Living Area): tap = open/close-all for every motor
// in every derived group (Curtains + Shades), long-press/chevron = the Windows sheet.
import { runScene } from '../store.js';
import { openSheet } from '../router.js';
import { Icon, pressHandlers, introIndex } from './bits.jsx';

export function WindowsTile(props) {
  const ei = introIndex(props.i);
  const pct = () => { const ps = props.groups.map((g) => g.pct()).filter((p) => p != null);
    return ps.length ? Math.round(ps.reduce((a, b) => a + b, 0) / ps.length) : 0; };
  const motors = () => props.groups.reduce((n, g) => n + g.members.length, 0);
  const sub = () => { const p = pct(); return (p <= 2 ? 'Closed' : p >= 98 ? 'Open' : `Partly open · ${p}%`) + ` · ${motors()} motors`; };
  const open = () => openSheet({ t: 'windows', groups: props.groups, room: props.room });
  const tap = () => runScene(props.groups.flatMap((g) => g.actions(pct() > 5 ? 'close' : 'open'))); // one batched scene
  return (
    <div class="tile windows-tile" role="button" tabindex="0" aria-label={`Windows, ${sub()}`}
      style={ei != null ? { '--i': ei } : undefined} classList={{ on: pct() > 5, 'tile-enter': ei != null }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(); } }}
      {...pressHandlers({ tap, hold: open })}>
      <span class="tile-ico"><Icon name="blind" /></span>
      <span class="tile-meta"><span class="tile-name">Windows</span><span class="tile-sub num">{sub()}</span></span>
      <button class="ctile-more" aria-label="Window details" onClick={(e) => { e.stopPropagation(); open(); }}><Icon name="chevron-right" size={16} /></button>
      <div class="pos-bar" style={{ width: pct() + '%' }} />
    </div>
  );
}
