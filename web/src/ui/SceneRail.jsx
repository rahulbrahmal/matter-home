// Scene pill rail (spec §1.2d, tap-safety): All On/All Off filtered out UI-side (store.js untouched —
// builtinScenes targets every light/switch/outlet incl. Water Pump/Heater); remaining whole-house
// pills (Cool, Cozy) are hold-to-run with a visible fill + snapshot undo via fireScene.
import { For, Show, createSignal } from 'solid-js';
import { builtinScenes } from '../store.js';
import { fireScene } from '../model.js';
import { Icon, useHold } from './bits.jsx';

const SCENE_ICONS = { 'all-off': 'moon', 'all-on': 'bulb', cool: 'snowflake', cozy: 'flame' }; // store icons are emoji; we render SVG
const HIDDEN_SCENES = ['all-on', 'all-off']; // blast-radius: can energize the water heater / kill everything

function ScenePill(props) {
  const s = () => props.scene;
  const h = useHold(() => props.fire(s()));
  return (
    <button class="pill scene-pill holdable" title={s().sub}
      aria-label={h.armed() ? 'Press again to confirm' : s().name}
      classList={{ run: props.running, pending: props.running, holding: h.holding(), armed: h.armed() }}
      {...h.props}>
      <span class="hold-fill" /><Icon name={SCENE_ICONS[s().id] || 'bolt'} size={15} /> {s().name}
      <Show when={h.hint()}><span class="hold-tip">Hold</span></Show>
    </button>
  );
}

export function SceneRail(props) {
  const [running, setRunning] = createSignal(null);
  const scenes = () => (props.scenes ?? builtinScenes())
    .filter((s) => !HIDDEN_SCENES.includes(s.id) && !/^all\s+(on|off)$/i.test(s.name || ''));
  const fire = async (s) => { setRunning(s.id);
    try { await fireScene(s); } finally { setTimeout(() => setRunning((r) => (r === s.id ? null : r)), 1200); } };
  return (
    <div class="scene-rail">
      <For each={scenes()}>{(s) => <ScenePill scene={s} running={running() === s.id} fire={fire} />}</For>
    </div>
  );
}
