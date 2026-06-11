// Room pages (spec §1.3, §2.2): horizontal scroll-snap pager, one full-screen page per room,
// vertical scroll inside; scrollend (IntersectionObserver fallback) syncs the route via a
// replaceState so swiping never grows the back stack. Bottom chip rail with a leading Home chip.
import { Show, For, createEffect, createMemo, onMount, onCleanup } from 'solid-js';
import { runScene } from '../store.js';
import { rooms, roomOff } from '../model.js';
import { route, go } from '../router.js';
import { Tile, DimmerTile, FanChip } from '../ui/Tile.jsx';
import { ClimateCard } from '../ui/ClimateTile.jsx';
import { WindowsTile } from '../ui/WindowsTile.jsx';
import { SectionHead, Icon, Skeletons } from '../ui/bits.jsx';

// section mini-master: only the units that are in the room's master/off scope (no fans/exhausts)
const secOff = (room, units) => runScene(units.filter((u) => room.lights.includes(u)).flatMap((u) => u.actions(false)));

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
        <SectionHead title={multi ? s.room : 'Lights'} count={s.units.length}
          onOff={s.units.some((u) => u.on()) ? () => secOff(r, s.units) : null} />
        <div class="grid2"><For each={s.units}>{(u, i) => <Tile unit={u} i={i()} />}</For></div>
      </>)}</For>
      <Show when={r.fans.length}>
        <SectionHead title={r.fans.length > 1 ? 'Fans' : 'Fan'} />
        <div class="grid2"><For each={r.fans}>{(u, i) => <FanChip unit={u} i={i()} />}</For></div>
      </Show>
      <Show when={r.bathroom}>
        <SectionHead title={r.bathroom.name} count={r.bathroom.units.length}
          onOff={r.bathroom.units.some((u) => u.on() && r.lights.includes(u)) ? () => secOff(r, r.bathroom.units) : null} />
        <div class="grid2"><For each={r.bathroom.units}>{(u, i) => <Tile unit={u} i={i()} />}</For></div>
      </Show>
      <footer class="page-foot">
        <button class="pill off-pill" onClick={() => roomOff(r)}>Turn off {r.name}</button>
      </footer>
    </section>
  );
}

function RoomChipRail(props) {
  let rail;
  createEffect(() => { props.active; queueMicrotask(() =>
    rail?.querySelector('.active')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })); });
  return (
    <nav class="chip-rail" aria-label="Rooms" ref={rail}>
      <button class="chip rail-chip" onClick={() => go('/')} aria-label="Home"><Icon name="home" size={16} /></button>
      <For each={props.rooms}>{(r) => (
        <button class="chip rail-chip" classList={{ active: r.id === props.active, lit: r.counts.on() > 0 }}
          aria-current={r.id === props.active ? 'page' : undefined}
          onClick={() => go('/room/' + r.id)}>{r.name}</button>)}</For>
    </nav>
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
      <RoomChipRail rooms={rooms()} active={activeId()} />
    </div>
  );
}
