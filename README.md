# 🏍️ RideStop — Petrol, Food & Stays for Riders | Pune

A client-side Web GIS app for riders in Pune. It takes your location (via browser geolocation, address search, or a map click) and shows the stops that matter on a ride — petrol pumps, ATMs, food/dhabas, hotels & stays, repair and tyre shops, EV charging, plus hospitals, police, and parking for safety — on an interactive map, scoped to the Pune metropolitan area.

## Rider categories
- ⛽ Petrol Pumps
- 🏧 ATMs
- 🍽️ Restaurants & Dhabas
- 🏨 Hotels & Stays
- ☕ Tea & Coffee Stalls
- 🔧 Bike/Vehicle Repair
- 🛞 Tyre & Puncture Shops
- 🔌 EV Charging
- 🏥 Hospitals
- 🚓 Police
- 🅿️ Parking

Default view opens with Petrol Pumps, ATMs, Restaurants & Dhabas, and Hotels & Stays active — toggle any of the others on as needed.

## Tech stack
All free, key-less web services — no backend, build step, or API key required. It's a static site.

- **Leaflet.js** — interactive map rendering, with 2 switchable basemaps (Streets, Satellite).
- **Browser Geolocation API** — "My Location" one-shot fix, and "📡 Live" continuous tracking (`watchPosition`).
- **Nominatim** (OpenStreetMap) — address search with live autocomplete suggestions, and reverse geocoding for the current location. Results are bounded to the Pune metropolitan area (`countrycodes=in` + a Pune viewbox, `bounded=1`).
- **Overpass API** (OpenStreetMap, 4 mirrors raced in parallel — whichever answers first wins) — live query for nearby points of interest by category and radius.
- **OSRM** (routing.openstreetmap.de) — turn-by-turn directions, used both for the 🧭 **Best Route** destination search and for routing to any nearby result, with distance and ETA. Defaults to the **🏍️ Ride** profile (motorable roads), with Cycling and Walking also available.
- **Open-Meteo** — current weather at your location (useful before heading out).
- **Open-Elevation** — elevation above sea level at your location.
- **MQTT over WebSockets, via HiveMQ's public broker** — powers 🤝 **Ride Together**, relaying live location between everyone on the same Ride Code. No account or server of our own required.

## Run it locally

Any static file server works. For example:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000` in your browser.

(Opening `index.html` directly via `file://` will *not* work for geolocation in most browsers — serve it over `http://localhost` instead.)

## How to use
The sidebar is split into three tabs — **🗺️ Explore**, **🧭 Routes**, and **🆘 Safety** — so related features are grouped instead of one long scroll.

1. Click **My Location** to use your device's GPS/network location (allow the permission prompt), search a place in the top bar (suggestions appear as you type — use ↑/↓ + Enter or click one), or click anywhere on the map to set the search origin. **📡 Live** keeps the marker following you in real time, useful while actually riding.
2. Once a location is set, the **Location Info** panel shows its address, current weather, and elevation.
3. **Explore tab** — toggle the categories you care about and click **Find Nearby** (always a fixed 2 km radius, kept simple on purpose). Matching stops appear as markers on the map and as a distance-sorted list in the sidebar. Click a result's 🧭 button to draw a route to it (🏍️ Ride / 🚴 Cycling / 🚶 Walking, chosen above the results list). **⚡ Quick Find Nearest** skips the list entirely and jumps straight to the single closest match for one category — useful when you just need the nearest petrol pump *now*.
4. **Routes tab — 🧭 Best Route**: search any destination in Pune and hit **Get Best Route** for the fastest route there from your current location, drawn on the map with distance and ETA — no need to look it up as a "nearby place" first.
5. **Routes tab — ⛽ Fuel Range Calculator**: enter how far you can still ride before refuelling (a 5–100 km slider) and it searches for petrol pumps actually within that reach, rather than just listing the nearest ones regardless of distance — answers "can I actually get there?" instead of "what's closest?".
6. **Safety tab — 🆘 Emergency SOS**: save an emergency contact's name/phone once; the always-visible 🆘 button on the map then sends them your current location via WhatsApp (or a call) with one tap.
7. **Safety tab — 🤝 Ride Together**: enter a Ride Code (or generate one with 🎲), optionally your name, and hit **Start Sharing**. Send the same code to whoever you're riding with — once they also start sharing, you'll each see the other's live position on the map (🏍️ pink marker), with distance and last-update time in the sidebar. Hit **Stop Sharing** when you're done.
8. **🔗 Copy Shareable Link** (Explore tab, once a location is set) puts a URL on your clipboard that reopens the app at the same location and categories — handy for sharing a rest stop with riding buddies.
9. Switch basemaps (Streets/Satellite) from the layers control on the map's top-right. A scale bar and a live lat/lon readout (bottom-right) are also on the map at all times.

## Customizing categories
Categories and their OpenStreetMap tag mappings live in the `CATEGORIES` array at the top of [script.js](script.js). Add a new entry (id, label, singular fallback name, emoji icon, and one or more `key=value` OSM tag filters) to introduce a new stop type — e.g. `{ id: "helmet", label: "Helmet/Gear Shops", singular: "Gear Shop", icon: "🪖", filters: ["shop=motorcycle_accessories"] }`.

## Notes / limits
- Search and suggestions are hard-restricted to the Pune metropolitan area (`PUNE_VIEWBOX` in [script.js](script.js)); to widen or relocate that, change the viewbox (and `PUNE_CENTER`/`PUNE_DEFAULT_ZOOM`) or drop the `countrycodes`/`viewbox`/`bounded` params in `puneGeocodeUrl()` entirely.
- The "Ride" directions profile uses OSRM's car routing (motorable roads) as the closest free approximation to two-wheeler routing — there's no dedicated motorcycle profile on the public OSRM mirrors.
- Overpass and OSRM's public endpoints are free but rate-limited/best-effort; for heavy production use, consider self-hosting Overpass/OSRM or caching results.
- Repair shops, tyre shops, and EV charging points are less consistently mapped in OpenStreetMap than petrol pumps or restaurants — results for those categories will vary more by area.
- **Ride Together is not private.** It relays location over HiveMQ's public, no-login MQTT broker — anyone who knows (or guesses) your Ride Code can subscribe to it and see the shared location. Use a code that isn't easily guessable, and only share it with people you're actually riding with. It's also best-effort: the public broker has no uptime guarantee, and background/minimized browser tabs (especially on mobile) may get their location-publish timer throttled by the OS/browser, delaying updates until the tab is active again. For anything safety-critical, this needs a real authenticated backend, not a public demo relay.
