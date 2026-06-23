// Room pages (spec §1.3, §2.2): horizontal scroll-snap pager, one full-screen page per room,
// vertical scroll inside; scrollend (IntersectionObserver fallback) syncs the route via a
// replaceState so swiping never grows the back stack. Bottom chip rail with a leading Home chip.
import { Show, For, createEffect, createMemo, onMount, onCleanup } from 'solid-js';
import { rooms, roomOff, runUndoable, snapUnits } from '../model.js';
import { route, go } from '../router.js';
import { Tile, DimmerTile, FanChip } from '../ui/Tile.jsx';
import { ClimateCard } from '../ui/ClimateTile.jsx';
import { WindowsTile } from '../ui/WindowsTile.jsx';
import { SectionHead, Skeletons } from '../ui/bits.jsx';
import RoomRail from '../ui/RoomRail.jsx';

// section mini-master: only the units in the room's master/off scope (no fans/exhausts).
// Stays ONE-TAP — navigating into the room established intent — but gains a snapshot-undo toast.
const secOff = (title, room, units) => { const us = units.filter((u) => room.lights.includes(u));
  return runUndoable(title, us.flatMap((u) => u.actions(false)), snapUnits(us)); };

// name shortener (proportions, pairs with the 410–480px 3-col grid): inside its own page the room
// prefix is noise — 'Master Bedroom Light 4' → 'Light 4'. Display-only; detail sheets keep u.name.
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const short = (u) => u.room && u.name.replace(new RegExp(`^${esc(u.room)}\\s+`, 'i'), '') || u.name;

function Page(props) {
  const r = props.room;
  const multi = r.lightSections.length > 1;
  return (
    <section class="page" data-room={r.id} aria-label={r.name}>
      <header class="page-head"><h2>{r.name}</h2><Show when={r.floor}><span class="muted">{r.floor}</span></Show></header>
      <Show when={r.climate}><ClimateCard group={r.climate} i={0} /></Show>
      <Show when={r.coverGroups.length}><WindowsTile groups={r.coverGroups} room={r.name} i={0} /></Show>
      <Show when={r.hero}><DimmerTile unit={r.hero} i={0} /></Show>
      <For each={r.lightSections}>{(s) => (<>
        <SectionHead title={multi ? s.room : 'Lights'} count={s.units.length || null}
          onOff={s.units.some((u) => u.on()) ? () => secOff(`${multi ? s.room : r.name} lights off`, r, s.units) : null} />
        <div class="grid2">
          <For each={s.units}>{(u, i) => <Tile unit={u} i={i()} name={short(u)} />}</For>
          <For each={s.fans}>{(u, i) => <FanChip unit={u} i={i()} name={short(u)} />}</For>
        </div>
      </>)}</For>
      <Show when={r.fans.length}>
        <SectionHead title={r.fans.length > 1 ? 'Fans' : 'Fan'} />
        <div class="grid2"><For each={r.fans}>{(u, i) => <FanChip unit={u} i={i()} name={short(u)} />}</For></div>
      </Show>
      <Show when={r.bathroom}>
        <SectionHead title={r.bathroom.name} count={r.bathroom.units.length}
          onOff={r.bathroom.units.some((u) => u.on() && r.lights.includes(u)) ? () => secOff(`${r.bathroom.name} lights off`, r, r.bathroom.units) : null} />
        <div class="grid2"><For each={r.bathroom.units}>{(u, i) => <Tile unit={u} i={i()} name={short(u)} />}</For></div>
      </Show>
      <footer class="page-foot">
        <button class="pill off-pill" onClick={() => roomOff(r)}>Turn off {r.name}</button>
      </footer>
    </section>
  );
}

export default function Rooms() {
  let pager;
  const activeId = () => route().room;
  const idx = createMemo(() => Math.max(0, rooms().findIndex((r) => r.id === activeId())));
  const sync = (id) => { if (id && id !== activeId()) go('/room/' + id, { replace: true }); };

  onMount(() => {
    if ('onscrollend' in window) {
      const onEnd = () => sync(rooms()[Math.round(pager.scrollLeft / Math.max(1, pager.clientWidth))]?.id);
      pager.addEventListener('scrollend', onEnd);
      onCleanup(() => pager.removeEventListener('scrollend', onEnd));
    } else {
      const io = new IntersectionObserver((es) => { for (const e of es) if (e.intersectionRatio > 0.6) sync(e.target.dataset.room); },
        { root: pager, threshold: 0.6 });
      createEffect(() => { rooms(); queueMicrotask(() => { io.disconnect(); [...pager.children].forEach((p) => io.observe(p)); }); });
      onCleanup(() => io.disconnect());
    }
  });
  let first = true; // initial / deep-link positioning is instant; chip taps glide
  createEffect(() => {
    const page = rooms().length && pager?.children[idx()];
    if (!page) return;
    if (Math.abs(pager.scrollLeft - page.offsetLeft) > 2) pager.scrollTo({ left: page.offsetLeft, behavior: first ? 'auto' : 'smooth' });
    first = false;
  });

  return (
    <div class="rooms">
      <div class="pager" ref={pager}>
        <Show when={rooms().length} fallback={<div class="page"><Skeletons class="grid2" n={6} /></div>}>
          <For each={rooms()}>{(r) => <Page room={r} />}</For>
        </Show>
      </div>
      <RoomRail rooms={rooms()} active={activeId()} dock="flex" />
    </div>
  );
}
