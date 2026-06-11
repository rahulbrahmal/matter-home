// Home room card (spec §1.2e): 358x64 row — glyph · name · "n of m on · temp" · trailing
// 44px master toggle (OFF = batched roomOff snapshot, ON = roomRestore last-on / primaries).
import { go } from '../router.js';
import { roomOff, roomRestore } from '../model.js';
import { Icon, Toggle, introIndex, holdGuard } from './bits.jsx';

const GLYPHS = { outdoor: 'home', 'guest-room': 'moon' };

export function RoomCard(props) {
  const r = () => props.room;
  const ei = introIndex(props.i);
  const on = () => r().counts.on();
  const sub = () => { const t = r().climate?.temp();
    return `${on()} of ${r().counts.lights} on${t != null ? ` · ${t}°` : ''}`; };
  const visit = () => { if (holdGuard()) return; go(`/room/${r().id}`); }; // a hold straddling toggle/card never navigates
  return (
    <div class="room-card" role="button" tabindex="0" style={ei != null ? { '--i': ei } : undefined}
      classList={{ lit: on() > 0, 'tile-enter': ei != null }}
      onClick={visit} onKeyDown={(e) => { if (e.target !== e.currentTarget) return; // toggle's own arm-and-confirm
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); visit(); } }}>
      <span class="room-glyph"><Icon name={GLYPHS[r().id] || 'bulb'} /></span>
      <span class="room-meta"><span class="room-name">{r().name}</span><span class="room-sub num">{sub()}</span></span>
      <Toggle hold checked={on() > 0} pending={r().lights.some((u) => u.pending())} label={`${r().name} lights`}
        onChange={(v) => (v ? roomRestore(r()) : roomOff(r()))} />
    </div>
  );
}
