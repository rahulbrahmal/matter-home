// Home (spec §1.2): essentials chips → climate rail → status strip → scene rail → room cards.
// NOT an all-device grid — every circuit lives ≤2 taps away via the room cards.
import { Show, For, createMemo } from 'solid-js';
import { state } from '../store.js';
import { rooms, climateRail, essentials, homeStats, lightsOff, lightsOffActions } from '../model.js';
import { EssentialChip } from '../ui/Tile.jsx';
import { ClimateTile } from '../ui/ClimateTile.jsx';
import { RoomCard } from '../ui/RoomCard.jsx';
import { SceneRail } from '../ui/SceneRail.jsx';
import { Icon, Skeletons, Num, introIndex } from '../ui/bits.jsx';

export default function Home() {
  const ess = createMemo(essentials);
  const stats = createMemo(homeStats);
  return (
    <Show when={state.status !== 'loading' || rooms().length} fallback={<Skeletons class="room-cards" n={7} />}>
      {/* a. essentials: heater · pump · staircase · global lights-off · favorites */}
      <div class="ess-row">
        <Show when={ess().heater}><EssentialChip unit={ess().heater} label="Heater" icon="flame" i={0} /></Show>
        <Show when={ess().pump}><EssentialChip unit={ess().pump} label="Pump" icon="droplet" i={1} /></Show>
        <Show when={ess().staircase}><EssentialChip unit={ess().staircase} icon="stairs" i={2} /></Show>
        {(() => { const ei = introIndex(3); return (
          <button class="chip ess-chip" title={`${lightsOffActions().length} circuits`} onClick={lightsOff}
            classList={{ 'tile-enter': ei != null }} style={ei != null ? { '--i': ei } : undefined}>
            <Icon name="moon" size={16} /><span>Lights off</span></button>); })()}
        <For each={ess().favorites}>{(u, i) => <EssentialChip unit={u} icon="star" i={i() + 4} />}</For>
      </div>

      {/* b. climate rail: 5 tiles, fixed order, snap-scroll */}
      <div class="clim-rail"><For each={climateRail()}>{(g, i) => <ClimateTile group={g} i={i()} />}</For></div>

      {/* c. status strip (read-only) */}
      <div class="status-strip num"><Num value={stats().lightsOn} /> of {stats().lights} lights on{stats().avgTemp != null ? ` · ${stats().avgTemp}° avg` : ''}</div>

      {/* d. scene pill rail */}
      <SceneRail />

      {/* e. room cards, curated order from model.js */}
      <div class="room-cards"><For each={rooms()}>{(r, i) => <RoomCard room={r} i={i()} />}</For></div>
    </Show>
  );
}
