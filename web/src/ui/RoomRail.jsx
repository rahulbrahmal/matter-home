import { For, Show, createEffect } from 'solid-js';
import { go } from '../router.js';
import { state } from '../store.js';
import { Icon } from './bits.jsx';

export default function RoomRail(props) {
  let rail;
  createEffect(() => {
    props.active;
    props.rooms.length;
    queueMicrotask(() => {
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      rail?.querySelector('.active')?.scrollIntoView({
        inline: 'center',
        block: 'nearest',
        behavior: reduce ? 'auto' : 'smooth',
      });
    });
  });

  const loading = () => state.status === 'loading' && !props.rooms.length;

  return (
    <nav class="chip-rail" classList={{ 'home-dock': props.dock === 'fixed' }} aria-label="Rooms" ref={rail}>
      <button class="chip rail-chip" classList={{ active: props.active === 'home' }}
        aria-current={props.active === 'home' ? 'page' : undefined}
        onClick={() => go('/')} aria-label="Home"><Icon name="home" size={16} /></button>
      <Show when={!loading()} fallback={
        <For each={[0, 1, 2]}>{() => <span class="rail-chip skeleton" aria-hidden="true" />}</For>
      }>
        <For each={props.rooms}>{(r) => (
          <button class="chip rail-chip" classList={{ active: r.id === props.active, lit: r.counts.on() > 0 }}
            aria-current={r.id === props.active ? 'page' : undefined}
            onClick={() => go('/room/' + r.id)}>{r.name}</button>)}</For>
      </Show>
    </nav>
  );
}
