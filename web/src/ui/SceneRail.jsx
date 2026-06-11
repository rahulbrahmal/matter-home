// Scene pill rail (spec §1.2d): 44px pills via the existing batched runScene;
// running = accent fill + shimmer for ~1.2s (store has no sceneRunning signal — local is fine).
import { For, createSignal } from 'solid-js';
import { builtinScenes, runScene } from '../store.js';
import { Icon } from './bits.jsx';

const SCENE_ICONS = { 'all-off': 'moon', 'all-on': 'bulb', cool: 'snowflake', cozy: 'flame' }; // store icons are emoji; we render SVG

export function SceneRail(props) {
  const [running, setRunning] = createSignal(null);
  const scenes = () => props.scenes ?? builtinScenes();
  const fire = async (s) => { setRunning(s.id);
    try { await runScene(s.actions()); } finally { setTimeout(() => setRunning((r) => (r === s.id ? null : r)), 1200); } };
  return (
    <div class="scene-rail">
      <For each={scenes()}>{(s) => (
        <button class="pill scene-pill" classList={{ run: running() === s.id, pending: running() === s.id }}
          title={s.sub} onClick={() => fire(s)}>
          <Icon name={SCENE_ICONS[s.id] || 'bolt'} size={15} /> {s.name}
        </button>
      )}</For>
    </div>
  );
}
