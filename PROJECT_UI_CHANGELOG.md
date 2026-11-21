# RideStop — UI/UX Changelog

This file documents the UI/UX redesign pass described in the project's
"MASTER PROMPT" (premium UI, smooth vanilla-JS/CSS motion, simple
viva-explainable code, on top of the existing Leaflet Web GIS). It's a
record of **what changed, why, and what stayed the same** — written so the
work is easy to explain to a supervisor and easy to pick back up later.

Stack is unchanged throughout: plain HTML + CSS + vanilla JavaScript +
Leaflet, loaded via CDN `<script>`/`<link>` tags. **No build tooling, no
framework, no new dependencies were added at any point.**

## 1. Why the redesign happened

The original app was functionally complete (search, nearby-POI lookup,
directions, fuel range, Ride Together, SOS) but the UI had three concrete
problems:

1. **Visually flat/default-looking** — default system font, no motion, no
   visual hierarchy between the brand header and the rest of the page.
2. **Sidebar clutter** — all 8 feature panels (Categories, Quick Find,
   Location Info, Results, Best Route, Fuel Range, SOS, Ride Together)
   stacked in one long scroll, so related features (e.g. safety tools) were
   mixed in with unrelated ones (e.g. search results).
3. **Accessibility gaps** — icon-only buttons (🔍, 🎯, 📡, 🎲…) had only a
   `title` tooltip, which isn't reliably announced by screen readers, and
   the only keyboard-focus cue on text inputs was a subtle border-color
   change.

## 2. What changed

### Visual design
- Swapped the default system font for **Inter** (Google Fonts), a widely
  used professional UI typeface — one `<link>` + one CSS variable
  (`--font-family`), applied everywhere.
- Introduced a small, consistent set of CSS custom properties in `:root`
  (`--bg`, `--panel`, `--accent`, `--accent-2`, `--danger`, `--radius`, …)
  so the whole dark theme can be retuned from one place instead of
  hunting down individual color values.
- Added a glassmorphism top bar (`backdrop-filter: blur()`) with a subtle
  animated diagonal-streak background (`.topbar-fx`, `@keyframes
  speed-lines`) and a slow gradient shimmer on the "Ride stop" title
  (`@keyframes text-shimmer`) — both decorative, both skip under
  `prefers-reduced-motion`.
- Added a soft vignette + brightness/contrast filter on the Leaflet tile
  layer so the (bright, light) default OpenStreetMap tiles don't clash
  with the app's dark theme.
- Restyled Leaflet's own controls (basemap switcher, popups, and — new in
  this pass — the scale bar) to match the dark theme instead of using
  their default light-grey styling.

### Structure: sidebar tabs
Split the sidebar's 8 panels into **3 tabs** — Explore (categories, quick
find, location info, results), Routes (best route, fuel range), Safety
(SOS, Ride Together) — with a sliding highlight pill behind the active
tab (`updateSidebarTabIndicator()` in `script.js`, pure CSS
`left`/`width` transition, no animation library). This was a direct fix
for the "doesn't look good" / cluttered-sidebar feedback: every panel
still exists and works exactly as before, they're just grouped instead of
all visible at once.

### Motion
All motion is CSS keyframes or CSS transitions, triggered by toggling a
class in vanilla JS — no animation library:
- Sidebar panels fade/slide in, staggered, each time a tab becomes active
  (`@keyframes panel-enter`).
- Result-list rows and map markers "drop in" with a slight overshoot
  (`@keyframes result-item-in`, `@keyframes marker-drop`).
- Category chips "pop" when selected (`@keyframes chip-select`).
- The user's own location dot gently pulses to read as "live"
  (`@keyframes live-pulse`); a Ride Together friend's SOS marker pulses
  red (`@keyframes sos-pulse`).
- Floating overlays (loader, route bar, suggestions, SOS toast) pop in
  rather than snapping onto screen (`@keyframes pop-in` /
  `pop-in-left` / `pop-in-bottom`).
- Numbers (e.g. result count) count up instead of jumping
  (`animateCountUp()` in `script.js`, plain `requestAnimationFrame`).
- **Every animation above is disabled under `prefers-reduced-motion:
  reduce`** via one global media query, rather than special-cased per
  rule.

Two earlier motion ideas were explicitly tried and then **rolled back** at
the user's request, because they read as unusual/distracting rather than
professional:
- A bike-shaped marker for the rider's own location → reverted to a plain
  pulsing dot.
- A bike icon animated along the drawn route (ghost-rider) → removed
  entirely.

### Accessibility (this pass)
- Added `aria-label` to every icon-only control that previously relied
  only on a `title` tooltip: search/locate/live buttons, the 🏍️/🚴/🚶
  travel-mode toggle, the ride-code 🎲 generator, the route-bar ✕ close
  button, the 🆘 SOS button, and the per-result 🧭 directions button
  (built dynamically in `renderResults()`).
- Added `aria-pressed` to the three travel-mode buttons, kept in sync
  with the visible `.active` class in the existing click handler, so
  screen readers announce which mode is currently selected.
- Strengthened the keyboard-focus indicator on `#place-search` and every
  `.text-input` from a border-color change alone to a border-color change
  **plus a visible glow ring** (`box-shadow: 0 0 0 3px rgba(56,189,248,.25)`,
  matching `--accent-2`).
- (Semantic landmarks — `<header>`, `<aside>`, `<main>`,
  `role="tablist"` on the sidebar tabs — were already in place from an
  earlier pass and were verified, not re-done.)

### Classic GIS reference tools (new)
- Added Leaflet's built-in **scale bar** (`L.control.scale()`, metric
  only), bottom-right of the map, restyled to match the dark theme.
- Added a **live lat/lon coordinate readout** under the cursor
  (`map.on("mousemove", …)`), shown as a small pill directly above the
  scale bar. Hidden under 640px width, where there isn't room for it
  without crowding the SOS button.

### Simplifications (kept from the immediately preceding session, carried
forward and preserved by this pass — listed here for completeness)
- Removed the "Coverage Gaps" feature entirely (it made the heaviest,
  slowest Overpass queries and added UI complexity for limited rider
  value).
- Removed the bike-riding-route animation.
- Removed the adjustable search-radius slider on "Find Nearby" in favor
  of a fixed, clearly-labeled 2 km default (`DEFAULT_SEARCH_RADIUS_METERS`
  in `script.js`) — one less control to explain, and "what's near me
  right now" doesn't really need to be adjustable.

## 3. Files touched

| File | What changed |
|---|---|
| `index.html` | `aria-label`/`aria-pressed` additions; new `#coord-readout` element; cache-busting version bump. |
| `style.css` | Focus-ring glow; scale-bar dark theme; `.coord-readout` styling + its mobile media query. (Design tokens, tab system, motion keyframes, and Leaflet dark theming were added in earlier passes within this same redesign effort and are described above for completeness.) |
| `script.js` | `initMap()`: added `L.control.scale()` and the `mousemove`/`mouseout` coordinate-readout listeners; mode-toggle click handler now also sets `aria-pressed`; `renderResults()`'s dynamic directions button now carries an `aria-label`. |

No HTML elements, functions, or data were removed or fabricated — every
visual/motion change sits on top of the existing, unchanged GIS logic
(Nominatim search, Overpass nearby-POI search, OSRM routing, Fuel Range
Calculator, Quick Find, Ride Together, SOS).

## 4. Dependencies

**Zero new dependencies.** Still exactly: Leaflet (CDN), mqtt.js (CDN),
Google Fonts "Inter" (CDN stylesheet). No npm, no bundler, no framework.

## 5. Testing performed

- Loaded the app from a local static file server (`python -m http.server`)
  in the in-app browser pane and confirmed **zero console errors**.
- Visually verified (screenshots) the dark-themed scale bar and the
  coordinate readout at desktop width, including hovering the map to
  confirm the readout updates live.
- Verified the new focus-ring glow by focusing the search input and
  zooming into a screenshot of the result.
- Resized the pane to mobile width (375×812) and walked through all
  three sidebar tabs (Explore, Routes, Safety) — no overlap or overflow
  found; confirmed the coordinate readout correctly hides under 640px
  while the SOS button and scale bar remain visible and un-overlapped.

## 6. Known limitations (honestly disclosed)

- **Automated browser testing couldn't exercise everything.** Features
  that depend on `navigator.geolocation` (Locate Me, Live tracking),
  `navigator.clipboard` (Copy Invite Link), or a live MQTT broker
  connection (Ride Together) were verified by code review and, in earlier
  sessions, by direct math/computed-style checks and manual two-tab
  testing — not by a fresh end-to-end automated run in this pass.
- **Ride Together has no privacy/authentication** — it uses a public MQTT
  relay (HiveMQ's public broker) with no login. This is called out
  directly in the app's own UI (the "⚠️ Uses a public relay…" hint) and
  is a known, accepted trade-off for a project of this scope, not an
  oversight.
- **Overpass/Nominatim/OSRM are free public community servers.** They can
  be slow or occasionally unavailable; the app mitigates this (racing
  multiple Overpass mirrors with `Promise.any()`) but can't eliminate it.

## 7. Geographic scope: Pune, not all of India

After the redesign pass above, the app's search/geocoding scope was
narrowed from all of India to the Pune metropolitan area:

- `PUNE_VIEWBOX`, `PUNE_CENTER` (`[18.5204, 73.8567]`), and
  `PUNE_DEFAULT_ZOOM` (12) replace the former India-wide constants in
  `script.js`; the map now opens centered on Pune instead of zoomed out
  over the whole country.
- `indiaGeocodeUrl()` was renamed to `puneGeocodeUrl()`, and its Nominatim
  request now uses `bounded=1` against the Pune viewbox — place search,
  both autocomplete dropdowns, and Best Route destination search all
  reject results outside Pune rather than just deprioritizing them.
- All user-facing text (search placeholders, status/error messages, the
  page title) and all three documentation files were updated from
  "India" to "Pune" to match.
- **Why**: OpenStreetMap's mapping density varies a lot across India —
  bounding every search to one well-mapped metro area keeps "Find
  Nearby"/Quick Find/Fuel Range results consistently rich for a live demo,
  instead of occasionally landing in a sparsely-mapped area and returning
  few or no results. Verified live post-change: a Nominatim search for
  "Kothrud" correctly resolved inside Pune, and a Find Nearby search
  there returned 108 real places from Overpass.
- No feature logic changed — this is a scope/config change (which
  viewbox, which center point) on top of the same search/geocode/routing
  pipeline described above.

## 8. New feature: 🧪 Access tab (Walking Access Pilot)

A genuinely new RideStop feature, added for the WebGIS Experiential
Learning assignment this repo also contains: a fourth sidebar tab
("🧪 Access") that loads the assignment's coverage-hexagon and
healthcare-services layers onto RideStop's own Leaflet map, and lets a
click anywhere on the map draw a real walking-time isochrone and list
the nearest healthcare services by actual walking time — backed by the
same PostGIS + pgRouting + FastAPI stack the assignment's own `client/`
uses, called directly from `script.js` (`runPilotIsochrone()`,
`runPilotNearest()`, `PILOT_ROUTING_API`, `PILOT_FEATURESERV`).

**Honestly scoped, not silently broken elsewhere:** this tab only works
for the Kothrud, Pune pilot dataset and only when the project's local
Docker stack is running (`pg_featureserv` on :9000, the routing API on
:8020) — unlike the rest of RideStop, it doesn't call Overpass/OSRM
live, so it can't work "anywhere in India" the way Find Nearby or Best
Route do. The tab's own panel text says this explicitly, and the load
button fails with a clear message (not a silent blank map) if the local
stack isn't up.

**One small, deliberate behavior change:** a map click now does one of
two things depending on which tab is open — sets the rider's location
(every other tab, unchanged) or runs the isochrone/nearest analysis
(Access tab only). The switch is a single `pilotModeActive` flag checked
inside the existing map click handler, set by `switchSidebarTab()` —
every other tab's click behavior is untouched.
