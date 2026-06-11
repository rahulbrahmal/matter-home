// Home (spec §1.2): essentials chips → climate rail → scene rail → room cards.
// (Live stats moved into the App.jsx greeting — proportions merge.)
// NOT an all-device grid — every circuit lives ≤2 taps away via the room cards.
import { Show, For, createMemo } from 'solid-js';
import { state } from '../store.js';
import { rooms, climateRail, essentials, lightsOff, lightsOffActions } from '../model.js';
import { EssentialChip } from '../ui/Tile.jsx';
import { ClimateTile } from '../ui/ClimateTile.jsx';
import { RoomCard } from '../ui/RoomCard.jsx';
import { SceneRail } from '../ui/SceneRail.jsx';
import { Icon, Skeletons, introIndex, useHold } from '../ui/bits.jsx';

export default function Home() {
  const ess = createMemo(essentials);
  return (
    <Show when={state.status !== 'loading' || rooms().length} fallback={<Skeletons class="room-cards" n={7} />}>
      {/* a. essentials: heater · pump · staircase · global lights-off · favorites */}
      <div class="ess-row">
        <Show when={ess().heater}><EssentialChip unit={ess().heater} label="Heater" icon="flame" i={0} /></Show>
        <Show when={ess().pump}><EssentialChip unit={ess().pump} label="Pump" icon="droplet" i={1} /></Show>
        <Show when={ess().staircase}><EssentialChip unit={ess().staircase} icon="stairs" i={2} /></Show>
        {(() => { const ei = introIndex(3); const h = useHold(lightsOff); return ( // whole-house off: hold-gated
          <button class="chip ess-chip holdable" title={`${lightsOffActions().length} circuits`}
            aria-label={h.armed() ? 'Press again to confirm' : 'Lights off'}
            classList={{ 'tile-enter': ei != null, holding: h.holding(), armed: h.armed() }}
            style={ei != null ? { '--i': ei } : undefined} {...h.props}>
            <span class="hold-fill" /><Icon name="moon" size={16} /><span>Lights off</span>
            <Show when={h.hint()}><span class="hold-tip">Hold</span></Show></button>); })()}
        <For each={ess().favorites}>{(u, i) => <EssentialChip unit={u} icon="star" i={i() + 4} />}</For>
      </div>

      {/* b. climate rail: 5 tiles, fixed order, snap-scroll */}
      <div class="clim-rail"><For each={climateRail()}>{(g, i) => <ClimateTile group={g} i={i()} />}</For></div>

      {/* c. scene pill rail */}
      <SceneRail />

      {/* d. room cards, curated order from model.js */}
      <div class="room-cards"><For each={rooms()}>{(r, i) => <RoomCard room={r} i={i()} />}</For></div>
    </Show>
  );
}
