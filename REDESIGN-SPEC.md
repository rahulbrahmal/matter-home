Repo verified (file list and line counts match the analyses). Below is the merged spec.

# Matter-Home Mobile-First Redesign — Unified Spec

Authoritative spec, merged from the groupings / mobile-ux / code audits. Baseline verified: `/Users/rahulbrahmal/Developer/matter-home/web/` builds green (41.9 kB JS / 17.3 kB CSS); source-of-truth device data in `/tmp/home-snapshot.json` (54 devices). All paths absolute.

## Conflict resolutions (decided, not optional)

| Conflict | Decision | Why |
|---|---|---|
| Room bottom-sheet (groupings) vs Rooms pager+tabs (mobile-ux/code) | **Full-screen Room pages in a horizontal scroll-snap pager, hash-routed (`#/room/<id>`)**. Bottom sheets are reserved exclusively for device detail (climate dial, Windows group, dimmer). | One sheet layer max; back-gesture works via router; sheets-on-sheets is complexity. |
| 3-tab bar (mobile-ux) / Home-Rooms-Edit tabs (code) vs two-level nav (groupings) | **No app-mode tab bar.** Two routes only: `#/` (Home) and `#/room/<id>`. Mobile Home and Room pages share a persistent `RoomRail` room switcher (leading Home chip + room chips), while ≥768px keeps Home unchanged and Room pages use the left rail. Scenes = pill rail on Home. Global edit mode is deleted. | Simplicity still wins: the persistent rail is a room switcher for orientation and thumb navigation, not Home/Rooms/Edit app tabs. |
| Full-width LightRow (code) vs 2-up 64px tiles (mobile-ux) | **2-up 174×64 tiles** for all binary circuits. Full-width fixed-height DimmerTile only for the two hero dimmers (Baby's Room, Study ceiling). | Halves scroll depth; tap-anywhere-to-toggle is the fastest on/off. |
| 1 Windows tile (groupings) vs 2 cover tiles (mobile-ux) | **ONE Windows tile**, internally composed of two derived groups (Curtains, Shades) from `groupCovers()`. | "Close the living room" = 2 taps for 8 motors. |
| Favorites grid (mobile-ux) vs curated essentials (groupings) | **Essentials chip row = 4 fixed chips + any user-favorited circuits appended.** No separate favorites grid. | The persisted `favorite` flag gets a surface without a new section. |
| store.js sequencing helpers (groupings) vs store.js untouched (code) | **store.js untouched.** `acSetMode` already does power-before-AC sequencing (1600 ms energize delay). Last-on snapshots live in `model.js` + localStorage; group ops use the existing batched `runScene`. | Keep what works. |

**Kept verbatim:** `store.js` (SSE + poll fallback, `reconcile` deltas, optimistic `view()` overlay, pending counters, `acSetMode`, `saveDevice/saveGang`, batched `runScene`), the gateway API, the Login/auth flow, `index.jsx`, `vite.config.js`, the warm-dark token palette (`--accent: #ff7a42`, Plus Jakarta Sans), and the Dial component (ported, not rewritten).

---

## 1) Information architecture & groupings

### 1.0 Vocabulary
- **Circuit** — the control unit = one gang endpoint (e.g. `6:158d008b317948:18` "Main Light"), not the physical device. Multi-gang devices are exploded. Duplicate-named gangs on one device are **fused** into one circuit (TV Area `4:158d008b3d6a53` eps 77+78 are both "Drop Lights" → one toggle, command fans out to both eps, state = OR).
- **Role** — per-circuit classification (regex on gang name, see §4 step 1) that drives grouping, master-toggle membership, and what "Lights off" may touch: `primary-light`, `accent-light`, `fan`, `exhaust`, `bathroom`, `external`, `utility-light`, `ac-power`, `relay` (hidden), `spare` (hidden), `appliance`, `sensor` (consumed). Roles, never `device.type`, drive behavior — fans/heaters/pumps are mistyped as `light` in the data.
- **Climate group** — thermostat + its AC Power switch(es) + its sensor, one tile. Sensor binding = hub prefix (`2:`→Master, `3:`→Baby's, `4:`→Living Area, `7:`→Study). Verified: sensor temps equal AC localTemp in all three cases.

### 1.1 Navigation: exactly two levels
- **`#/` Home** — essentials chips → climate rail → room cards. NOT an all-device grid.
- **`#/room/<id>` Room page** — one per room, in a swipeable pager with a bottom chip rail.
- **Detail sheets** (history-aware, back-gesture closes them) for: climate dial, Windows group, dimmer detail, circuit settings.

Tap budget: top-5 daily actions = 1 tap; any of the ~38 real light circuits ≤ 2 taps; individual cover motors and hidden relays = 3 taps (deliberately).

### 1.2 Home composition (top → bottom)

**a. Essentials chips** (horizontal row, 44 px tall):
| Chip | Binds | Display |
|---|---|---|
| Water Heater | `4:54ef441000ef6d5a` | "Heater · 2.9 kW" live watts; amber when on |
| Water Pump | `4:54ef441000ef76cd` | "Pump · 590 W" |
| Staircase | `6:158d008b317906:8` + `6:158d008b31798c:28` fused | on = both on |
| Lights off | global action via one batched `runScene` | turns off every `*-light` + `bathroom` circuit house-wide; NEVER touches `ac-power`, `appliance`, `fan`, `exhaust`, hidden |
| (+ user favorites) | any circuit with `favorite: true` | appended as chips |

**b. Climate rail** (horizontal snap-scroll, 5 tiles, fixed order; attention badges float but tiles never reorder). Tap = sequenced on/off; long-press or expand = dial sheet. States: **Off / Powering… / Cooling → 16° · 1.3 kW / Idle / "Power off" warning (amber)**.

1. **Living Area** — AC `4:54ef447599da`; zone powers Kitchen `4:54ef441000ef7826`, TV `4:54ef441000dd681f`, Lounge `4:54ef441000dd6d19`; sensor `4:54ef441001189b5d` (27.9° / 54%). Sheet shows three zone chips. AC-on with all zones off auto-opens all three.
2. **Master Bedroom** — AC `2:54ef4475a0f5` + power `2:54ef441000ef6b8b` + sensor `2:54ef441000a95774` (20.3° / 51%). Sheet adds secondary **Closet AC** toggle `2:54ef441000ef7866`.
3. **Baby's Room** — AC `3:54ef44756a2e` + power `3:54ef441000ef6ddc` + sensor `3:54ef441000a9498a` (24.8° / 49%).
4. **Study** — AC `7:54ef4475a9f2` + power `7:54ef441000ef774f` + sensor `7:54ef441000a94f99` (29.5° / 51%).
5. **Bedroom Hallway** — AC `6:54ef44757371` + power `6:54ef441000ef6c4a`, no sensor (use AC localTemp). Snapshot shows the live trap: cooling 18° but mains OFF → amber "Power off" badge, one tap re-sequences.

**c. Status strip** — read-only: "n lights on · avg temp". (A tappable "What's on" sheet is future work, not v1.)

**d. Scene pill rail** — 44 px pills, existing scenes via batched `runScene`.

**e. Room cards** (vertical list, 358×64: name · "n of m lights on · temp" · trailing 44 px master toggle). Order: **Living Area, Master Bedroom, Baby's Room, Study, Bedroom Hallway, Guest Room, Outdoor**. Pool/Entry/Balcony/Driveway fold into Outdoor; Utilities never gets a card (lives in Essentials). Master toggle: OFF = batched scene of all light-role circuits (fans/exhausts/relays/appliances excluded); ON = restore last-on snapshot (localStorage), fallback = the room's `primary-light` circuits.

### 1.3 Room pages — exact contents (names verbatim from snapshot)

**Living Area** (= Kitchen & Dining + Lounge + TV Area, exactly as `ZONES` in home.js)
1. Climate card (full-width; zone chips Kitchen/Lounge/TV inline).
2. **Windows tile** — primary action: open-all/close-all with % progress; sub-label from mixed state ("Partly open" — snapshot: Curtain 1 = 100%, Shade 1 = 34%, rest ~0). Sheet: master Open/Stop/Close (44 px segments) + two group rows — **Curtains**: `4:54ef441000a7e5b1`, `4:54ef441000a7e671`, `4:54ef441000a7e714`, `4:54ef441000a7e988`; **Shades**: `4:54ef4410006bc736`, `4:54ef44100077f75d`, `4:54ef441000d4cc1c`, `4:54ef441000e74aa3` — each row Open/Stop/Close + position slider; per-motor rows one level deeper.
3. **Kitchen & Dining — lights** (sub-header + mini-master): Main Light `4:54ef441000eec6d4:18` (primary), Dining Lights `4:54ef441000edf7b6:23` (primary), Bar Light `4:158d0008d8ac9e:62` (accent).
4. **Lounge — lights**: Landing Lights `4:54ef441000ede7ac:20` (primary), Landing Dimmer `4:54ef4410011e222c:32` (dimmer). **Fan chip** `4:54ef4410011cfb5b:29` — dimmer-as-fan, fan icon, 3-detent speed (33/66/100; snapshot: on, 37%).
5. **TV Area — lights**: Wall Dimmer `4:54ef4410011cf549:26` (primary, dimmer), Drop Lights `4:158d008b3d6a53:77+78` (FUSED, one tile). **Fan chip** `4:158d008b614248:82`.
6. **Guest Bathroom** (sub-cluster, mini-master on lights only): Guest Bathroom Hall `4:54ef441000aedae1:55`, Bathroom Vanity `:56`, Shower Lights & Exhaust `:57` (exhaust-containing circuit excluded from global Lights off).
- Hidden → Settings drawer: Relay `4:54ef441000eec6d4:17`, Relay `4:54ef441000edf7b6:24`, Dining Relay `4:54ef441000ede7ac:21`, Spare `4:158d008b614248:83`.

**Master Bedroom**
1. Climate card (incl. Closet AC secondary toggle).
2. Lights (master): Main Light `6:158d008b317948:18` (primary), Drop Light `2:54ef441000aed275:15`, Entrance Light `6:158d008b317948:17`, Closet Light `2:54ef441000aed275:13` (utility).
3. Fan chip `2:54ef441000aed275:14`.
4. Bathroom sub-cluster: Bathroom Light `6:158d008b317a7f:23`, Bathroom Exhaust `:22` (separate toggle; excluded from mini-master and global Lights off).

**Baby's Room**
1. Climate card.
2. **Hero DimmerTile** `3:54ef4410011cd438:7` — full-width, inline slider, resumes last brightness (snapshot 44%). The 2 a.m. control; outranks the main light here.
3. Lights (master): Main Light `3:158d008b614311:20` (primary), Drop Light `:21`, Entrance Light `3:54ef441000c59852:14`, Cupboard Light `3:158d008b3d67b3:26` (utility).
4. Fan chip `3:158d008b3d67b3:25`.
5. Bathroom sub-cluster: Bathroom Vanity `3:54ef441000c59852:13`, Bathroom Shower `:15`.

**Study**
1. Climate card.
2. **Hero DimmerTile**: Ceiling Light `7:54ef4410011cd712:5` (primary, dimmer).
3. Lights (master): Overhead Lights `7:54ef441000c58e13:15` (primary), Drop Light `:16`, Closet `7:158d008b614274:22` (utility).
4. Fan chip `7:158d008b614274:21`.
- External `7:54ef441000c58e13:14` renders in **Outdoor**, not here.

**Bedroom Hallway**
1. Climate card (with the "Power off" re-sequence affordance).
2. Lights (master): Main Light `6:158d008b61355b:13` (primary), Sofa Light `:12`, Store Room Light `6:158d008b317906:7` (utility).
- Staircase Circuit (Master) `6:158d008b317906:8` → Essentials Staircase chip + hidden drawer; never a peer light.

**Guest Room** (no AC; small card near bottom)
1. Lights (master): Guest Bedroom Hall `6:54ef441000aed23a:32` (primary), Guest Vanity Mirror `:33`, Guest Bathroom & Exhaust `:34` (bathroom role; excluded from global Lights off — contains the exhaust).

**Outdoor** (synthetic)
1. Balcony (mini-master): Lights 1 `4:54ef441000c593a7:65`, Lights 2 `:66`, External Light `:67`.
2. Entry: Landing Light `4:158d008afdba47:52`.
3. Study External `7:54ef441000c58e13:14`.
4. Pool (mini-master): Side Light `6:158d008b31798c:27`, Staircase Light `:28`.
5. Driveway: slot reserved for `4:158d008b61357a` (2× "Aqara Wall Switch D1", room:null) → until assigned it lives in Settings → **Needs setup** with an "Assign to Driveway?" suggestion.

**Never rendered as tiles:** Climate Sensors 1/2/3 (`2:54ef441000a95774`, `3:54ef441000a9498a`, `4:54ef441001189b5d`) — consumed by climate groups; loose sensor readings render in section headers as ambient "24.5° 58%" text.

### 1.4 Safety rules
1. **AC sequencing**: ON = power switch(es) on → wait for `power > 0` or ~1.6 s (existing `acSetMode` delay) → mode cool. OFF = mode 0; mains stays on, tile shows "Idle · 1 W". Raw AC Power toggles never appear outside the climate sheet.
2. **Global Lights off** is role-whitelisted; explicitly excludes `ac-power`, `appliance`, `fan`, `exhaust`, hidden circuits.
3. Fused gangs: identical gang names on one device = one circuit; command fan-out; state = OR.
4. Dimmer gesture: tap = toggle at last level; drag/long-press = slider. Fan dimmers snap 33/66/100.

---

## 2) Layout & components

### 2.1 Breakpoints (mobile-first)
| | 390 (primary) | 768 | 1200+ |
|---|---|---|---|
| Shell | single column | centered 640 px content; room chip rail becomes a left rail (240 px) listing rooms | left rail 256 px; Home room cards 2-col; room page tile grid wider |
| Page padding | 16 px | 24 px | 32 px |
| Tile columns | 2 (`repeat(auto-fill, minmax(148px, 1fr))`) | 3 | 4–5 |
| Grid gap | 10 px | 10 px | 12 px |
| Climate card / hero dimmer / Windows tile | `grid-column: 1 / -1` below 600 px | `span 2` | `span 2` |
| Bottom padding | Home reserves 72 px + `env(safe-area-inset-bottom)` for the persistent room rail; Room pages reserve via the docked rail | 60 px | 60 px |

Tile heights are **fixed** — no min-height growth, no layout shift ever.

One-hand reach map (390×844): top 25% = read-only (greeting, status, headers); middle = tile grid (tap-to-toggle tolerates imprecision); bottom 30% = chip rail, per-room "Turn off" pill (bottom-right). Nothing tapped more than once a day lives in the top 25%. All tap targets ≥ 44 px (visuals may be 36 px inside a padded 44 px hit area).

### 2.2 Component list (all under `web/src/ui/` unless noted)

| Component | Props | Geometry @390 | Behavior |
|---|---|---|---|
| `Tile` (replaces LightTile) | `{ unit, sub?, icon }` where `unit = {key, ids[], name, role, dimmable, on(), pending()}` | 174×64, radius 16, 36 px icon circle, name 13px/650 one-line ellipsis, state 11px muted ("On · 80%") | Renders `<button aria-pressed>`. Tap anywhere = toggle (fan-out for fused). Long-press 400 ms (pointerdown timer, cancel on >8 px move, `navigator.vibrate?.(10)`) + `contextmenu` = detail sheet. No inner power button, no inline slider. Off = surface+line border; on = accent gradient, ink `#1a0d05`; pending = shimmer; unreachable = 42% opacity. |
| `DimmerTile` | `{ unit }` | full-width ×64, fixed height, always-visible inline slider | Tap left zone = toggle at last level; slider: track 10 px, thumb 28 px, 44 px hit-height; `onInput` throttled 150 ms + final `onChange` commit (fixes gateway spam at components.jsx:26/162). Used ONLY for Baby's dimmer + Study Ceiling Light. |
| `FanChip` | `{ unit, dimmable }` | Tile geometry, fan icon | Tap = toggle; dimmable fans get a 3-detent slider (33/66/100) in sheet. |
| `ClimateTile` (rail) | `{ group }` = `{ac, powers[], sensor, zones?}` | 240×96 snap-scroll card | Tap = sequenced on/off via existing `acSetMode`; long-press/chevron = climate sheet. 5-state machine: Off / Powering… (breathing accent) / Cooling → setpoint · live W / Idle / amber "Power off" badge (one tap re-sequences). |
| `ClimateCard` (room page) | `{ group }` | full-width ×84: 36 px icon, name 14px/700, sub "Cooling · set 24° · 58% (· 3 zones)", right: temp 26px/800 + 44 px power circle | Power circle = sequenced toggle; tap elsewhere = sheet (ported Dial, mode segments, zone/closet AC Power rows with 44 px toggles, temp/humidity readouts). |
| `WindowsTile` | `{ groups: [{name, members[], pct()}] }` | full-width ×64 | Tap = open-all/close-all toggle; long-press/chevron = sheet: master Open/Stop/Close (44 px), Curtains row + Shades row (group slider + Open/Stop/Close each), per-motor 56 px rows one level deeper. Group ops = one batched `runScene`. Animated position bar while moving. |
| `RoomCard` (Home) | `{ room }` | 358×64: glyph, name 14px/700, sub "3 on · 24.5°", trailing 44 px master toggle | Row tap = `go('#/room/<id>')`; toggle = batched off / last-on restore. |
| `EssentialChip` | `{ unit, watts? }` | 44 px pill | Live watts label; amber when on. |
| `SceneRail` | `{ scenes }` | 44 px pills, radius 22 | `runScene`; running = accent fill + shimmer. |
| `SectionHead` (`ui/bits.jsx`) | `{ title, count, ambient?, onOff? }` | 12 px muted, tabular-nums | Mini-master pill 44 px right-aligned; ambient sensor readout text. |
| `Toggle` (`ui/bits.jsx`) | `{ checked, onChange, pending }` | 52×32, `role="switch" aria-checked`, sprung thumb | Shimmer while `isPending`. |
| `Sheet` (`ui/Sheet.jsx`) | `{ open, onClose, snap? }` | max-width 520, radius 28 top, snap points 62%/92dvh (climate) | History-aware (router pushes state; back gesture closes). Drag-to-dismiss 1:1 finger follow; dismiss at >25% travel or velocity >0.5 px/ms, else spring-back 280 ms. 44 px close button. Stays mounted through closing state for exit animation. Focus trap, Escape, scroll lock, return focus to origin. Content order: live controls first; admin (rename / favorite / hide) in a `Settings` `<details>` disclosure LAST. Bodies rendered via `<Show keyed>` — fixes the stale-props bug at components.jsx:97-99. |
| `RoomRail` (mobile Home + room pages; left rail ≥768 only on room pages) | `{ rooms, active, dock }` | docked above safe area on mobile; chips 44 px visual / 52 px hit, radius 18, 10 px gap; leading Home chip | Home chip can be active; active chip auto-scrolls into view; 6 px accent dot when room has anything on; reduced-motion uses instant scroll. |
| Views: `views/Home.jsx`, `views/Rooms.jsx` | — | Rooms = `scroll-snap-type: x mandatory` pager, pages `flex: 0 0 100%`, vertical scroll inside; `scrollend` (IntersectionObserver fallback) syncs route + rail | Page order: ClimateCard → WindowsTile → hero DimmerTile → light sections w/ sub-headers → fan chip → bathroom sub-cluster → footer "Turn off <room>" pill (44 px, bottom-right). |

Scroll budgets (must hold): Home ≤ 2 screens; worst room page (Living Area ≈ 890 px) ≤ 1.3 screens; today's All view is ~6,500 px — that page ceases to exist.

Icons: small inline-SVG set in `ui/bits.jsx`; no emoji.

---

## 3) Motion system

Tokens in `styles/tokens.css`:
```css
--dur-1: 120ms;  --dur-2: 200ms;  --dur-3: 320ms;
--ease: cubic-bezier(.2,.8,.2,1);
--ease-sheet: cubic-bezier(.32,.72,0,1);   /* iOS sheet curve */
--spring: cubic-bezier(.34,1.56,.64,1);
```

| Event | Animation | Duration / curve / class |
|---|---|---|
| Tile toggle | bg/color crossfade + icon scale 1→1.15→1 | 200ms `--ease` / 350ms `--spring`; `.tile`, `.tile.on` |
| Tile press | `scale(.97)` | 120ms ease-out; `.tile:active` |
| Initial load ONLY | fade + 8 px rise, stagger first 12 tiles, 18 ms steps via `style={{'--i': index()}}` (use `<For>`'s `index()` scoped per section — replaces the broken global `gi++` at App.jsx:52/100 whose delays reached seconds) | 300ms `--ease`; `.tile-enter`, `animation-delay: calc(min(var(--i),12) * 18ms)` |
| Route / filter / pager change | NO entry animation (kills the 450 ms replay-on-filter bug); pager uses native scroll-snap momentum; chip indicator slides | — |
| Sheet open/close | translateY rise/fall + scrim fade 200 ms; exit animation real (sheet stays mounted while closing) | 320ms `--ease-sheet`; `.sheet`, `.sheet.closing`, `.scrim` |
| Sheet drag | 1:1 finger follow; spring-back 280 ms | — |
| Toggle thumb | transform spring | 350ms `--spring` |
| Climate "Powering…" | breathing accent opacity loop | 1.6s ease-in-out infinite; `.breathing` |
| Cover moving | position bar width transition | 400ms linear, updated per poll; `.pos-bar` |
| Numbers (temp, watts, counts) | tween via CSS `@property`/counter or rAF lerp | 300ms `--ease`; `.num` (tabular-nums kept) |
| Pending command | existing shimmer (keep) | 1.1s loop |

```css
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 80ms !important; transition-duration: 80ms !important; }
  .tile-enter, .breathing { animation: none; }
  /* opacity-only; all transforms disabled */
}
```
Touch: `touch-action: pan-y` on draggable rows/sliders; `pan-x` on the pager track.

---

## 4) Implementation plan (file-by-file, each step builds green)

Target tree:
```
web/src/
  index.jsx              (unchanged except step 7 CSS path)
  store.js               (UNCHANGED — the contract)
  model.js               (NEW, replaces home.js)
  router.js              (NEW, ~40-line hash router)
  App.jsx                (REWRITTEN shell)
  views/Home.jsx  views/Rooms.jsx
  ui/bits.jsx  ui/Sheet.jsx  ui/Tile.jsx  ui/ClimateTile.jsx  ui/WindowsTile.jsx  ui/RoomCard.jsx  ui/SceneRail.jsx
  styles/index.css  tokens.css  base.css  shell.css  controls.css  views.css  sheet.css
```

**Step 0 — delete dead code.** `git rm web/src/tiles.jsx` (imported nowhere; references CSS classes that no longer exist; exports duplicate DetailSheet/Skeletons/Toasts). Prune orphaned CSS from `styles.css`: `.gangs`/`.gang` pills, `.customize`, `.row select`. Green because nothing imports it (verified by the audit).

**Step 1 — `model.js` replaces `home.js`.** Keep `ZONES`, `isAcPower`, `acPowered`. Add: (a) ROLE regex table — `/relay/i`→relay-hidden, `/^spare$/i`→spare-hidden, `/staircase circuit/i`→circuit-master, `/^fan$/i`→fan, `/exhaust/i`→exhaust, `/vanity|shower|bathroom/i`→bathroom, `/external/i`→external, `/closet|cupboard|store room/i`→utility, `/^(main light|dining lights|landing lights|overhead lights|ceiling light|wall dimmer|guest bedroom hall)$/i`→primary, else accent; appliance override list: Water Pump, Water Heater. (b) Sensor-by-hub-prefix climate binding (fixes the 3 room:null Climate Sensors). (c) Gang fusion for duplicate names. (d) `groupCovers()` — strip trailing ` \d+` → Curtains/Shades groups, pct = mean. (e) `buildRooms()` → `Room[] { id, name, floor, climate, lightSections[{room, units[]}], coverGroups, bathroom, fans, hidden, counts }` incl. the synthetic Outdoor room and per-source-room sections inside Living Area. (f) Module-level `createRoot` memos: `rooms()`, `roomById(id)`, `homeStats()`. (g) `lastOn` snapshot helpers (localStorage) + `roomOff(room)` / `roomRestore(room)` built on `runScene`. Switch imports in `App.jsx`/`components.jsx` from `./home` → `./model`; delete `home.js`. Pure refactor; visuals identical.

**Step 2 — `router.js`.** `route()` signal from `location.hash` (`#/` → home, `#/room/<id>` → rooms); `go(path)`; `openSheet(payload)` does `history.pushState({sheet:1})`; `popstate` closes sheet if open, else navigates. Replace `nav`/`floor` signals in App with `route()`. Back gesture now closes sheet → returns Home → exits. Visuals unchanged; the most important mobile fix lands early and testably.

**Step 3 — add `ui/` primitives (additive).** `ui/bits.jsx` (Icon SVG set, Toggle, Toasts, Skeletons, SectionHead), `ui/Sheet.jsx` (generic sheet + LightDetail/ClimateDetail/WindowsDetail bodies; **port Dial here from components.jsx**), `ui/Tile.jsx` (Tile, DimmerTile, FanChip, EssentialChip), `ui/ClimateTile.jsx` (rail tile + room ClimateCard, 5-state machine on top of `acSetMode`/`acPowered`), `ui/WindowsTile.jsx`, `ui/RoomCard.jsx`, `ui/SceneRail.jsx`. Old components.jsx still drives the UI; build stays green.

**Step 4 — the cutover.** Add `views/Home.jsx` (essentials chips, climate rail, status strip, SceneRail, RoomCard list) and `views/Rooms.jsx` (scroll-snap pager + RoomChipRail + per-room page composition per §1.3/§2.2). Rewrite `App.jsx` to shell-only: Login gate (kept nearly verbatim) → Header (greeting 22px/800, 40 px avatar → Settings sheet with the **Power & circuits** drawer and **Needs setup** drawer) → route switch → SheetHost → Toasts → reconnect banner. App no longer imports components.jsx. This step also retires: the dead `gi++` stagger, the double `buildAreas` memos (App.jsx:36-43), the N-sequential-command `turnOff` (App.jsx:51 → batched `runScene`), the no-op scroll-to-top nav button, and the global edit mode.

**Step 5 — delete `components.jsx`.** Nothing imports it after step 4 (Dial already ported in step 3).

**Step 6 — CSS split + motion pass.** Split `styles.css` → `styles/*` per the tree; point `index.jsx` at `styles/index.css`. Keep `:root` warm-dark tokens verbatim; add motion tokens + reduced-motion (§3); fix `.climate-card { grid-column: span 2 }` → `1 / -1` below 600 px; implement tile/sheet/pager classes; `env(safe-area-inset-*)` on rail and sheet.

**Step 7 — a11y + polish.** `role="switch"`/`aria-pressed` everywhere, keyboard handlers + `tabindex` on all interactives (fixes div-role=button gaps), visible 2 px accent focus rings, 44 px audit pass (power circles 40→44, cover buttons 32→44, slider hit-heights 44), slider throttle verification, optional `manifest.json` + iOS meta in `index.html`.

**store.js change budget: zero.** Optional later (not required): a `sceneRunning` signal for scene-button feedback.

### Acceptance (resident test)
- "Cool the bedroom": 1 tap (Master climate tile), power-before-compressor sequenced automatically.
- Bedroom Hallway trap (thermostat cooling, mains off): amber badge on Home, 1 tap fixes.
- "Baby's dimmer at 2 a.m.": Home → Baby's Room → hero slider = 2 taps, thumb-reachable.
- "Close the living room windows": Living Area → Windows tile = 2 taps for 8 motors.
- "Is the heater on?": answered on Home in watts, 0 taps.
- "All lights off leaving the house": 1 chip; provably cannot touch AC mains, heater, pump, fans, or a running bathroom exhaust.
- Android/iOS back gesture closes the sheet, then returns Home — never exits the app mid-task.
- Home ≤ 2 screens, any room ≤ 1.3 screens at 390×844 (vs ~8 today); every real light circuit ≤ 2 taps.
