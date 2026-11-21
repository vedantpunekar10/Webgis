/* ==========================================================
   RideStop — a rider-focused Web GIS for Pune
   Finds petrol pumps, food, stays, and repair/safety stops
   along the road, from wherever the rider currently is.
   Map: Leaflet + OpenStreetMap tiles
   Geocoding / place search: Nominatim (Pune-scoped)
   Nearby POIs: Overpass API
   Directions: OSRM
   ========================================================== */

// ---------- Category definitions ----------
// Curated for riders on the road: fuel, cash, food, and a place to stay, plus
// the repair/safety stops that matter on a long ride. Each category maps to
// one or more OSM tag filters (Overpass QL fragments). `singular` is used as
// the fallback display name for a POI that has no `name` tag in OSM.
const CATEGORIES = [
  { id: "fuel", label: "Petrol Pumps", singular: "Petrol Pump", icon: "⛽", filters: ["amenity=fuel"] },
  { id: "atm", label: "ATMs", singular: "ATM", icon: "🏧", filters: ["amenity=atm"] },
  { id: "restaurant", label: "Restaurants & Dhabas", singular: "Eatery", icon: "🍽️", filters: ["amenity=restaurant", "amenity=fast_food"] },
  { id: "stay", label: "Hotels & Stays", singular: "Stay", icon: "🏨", filters: ["tourism=hotel", "tourism=guest_house", "tourism=motel", "tourism=hostel"] },
  { id: "cafe", label: "Tea & Coffee Stalls", singular: "Tea Stall", icon: "☕", filters: ["amenity=cafe"] },
  { id: "repair", label: "Bike/Vehicle Repair", singular: "Repair Shop", icon: "🔧", filters: ["shop=motorcycle", "shop=car_repair"] },
  { id: "tyre", label: "Tyre & Puncture Shops", singular: "Tyre Shop", icon: "🛞", filters: ["shop=tyres"] },
  { id: "charging", label: "EV Charging", singular: "Charging Station", icon: "🔌", filters: ["amenity=charging_station"] },
  { id: "hospital", label: "Hospitals", singular: "Hospital", icon: "🏥", filters: ["amenity=hospital"] },
  { id: "police", label: "Police", singular: "Police Station", icon: "🚓", filters: ["amenity=police"] },
  { id: "parking", label: "Parking", singular: "Parking", icon: "🅿️", filters: ["amenity=parking"] },
];

// Which category ids are turned on when the app first loads (no shared link).
// A Set (not an array) because chip clicks need fast add/delete/has checks.
const DEFAULT_ACTIVE = ["fuel", "atm", "restaurant", "stay"];

// Find Nearby always searches within a fixed radius — kept simple on
// purpose (no adjustable slider) for a quick "what's near me right now"
// search. Quick Find reuses this same value for consistency.
const DEFAULT_SEARCH_RADIUS_METERS = 2000;
const activeCategories = new Set(DEFAULT_ACTIVE);

// Multiple public Overpass mirrors — the free servers get overloaded
// sometimes (one or more can be completely unresponsive for stretches at a
// time — confirmed by directly timing all four during development), so
// every search races all of them at once and uses whichever answers first
// (see fetchFromOverpassWithFallback below), instead of trying them one at
// a time and waiting out a slow one's timeout before moving to the next.
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter",
];
const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org";
// This app is scoped to Pune: geocoding results (search + suggestions) are
// restricted to places inside the Pune metropolitan area, and the default
// map view opens centered on Pune rather than all of India.
const AREA_COUNTRY_CODE = "in"; // Nominatim still needs a country code — Pune is in India
const PUNE_VIEWBOX = "73.68,18.75,74.05,18.35"; // west,north,east,south — Pune city + metro area (Hinjewadi, Wagholi, Hadapsar, etc.)
const PUNE_CENTER = [18.5204, 73.8567];
const PUNE_DEFAULT_ZOOM = 12;

// Rough icon per Nominatim result type, for the suggestions dropdown.
const PLACE_TYPE_ICONS = {
  city: "🏙️", town: "🏙️", village: "🏘️", hamlet: "🏘️", suburb: "🏘️",
  state: "🗺️", county: "🗺️", country: "🌐",
  road: "🛣️", street: "🛣️", pedestrian: "🛣️",
  house: "🏠", building: "🏠",
  railway: "🚉", station: "🚉", bus_stop: "🚌",
  hospital: "🏥", school: "🏫", college: "🎓", university: "🎓",
  place_of_worship: "🛕", temple: "🛕",
  postcode: "📮",
};

// Free, no-API-key web services used to enrich a location.
const WEATHER_ENDPOINT = "https://api.open-meteo.com/v1/forecast";
const ELEVATION_ENDPOINT = "https://api.open-elevation.com/api/v1/lookup";

// OSRM routing mirrors (FOSSGIS-hosted community demo servers), one per travel mode.
const ROUTING_PROFILES = {
  foot: { url: "https://routing.openstreetmap.de/routed-foot/route/v1/foot", label: "walking" },
  bike: { url: "https://routing.openstreetmap.de/routed-bike/route/v1/bike", label: "cycling" },
  car: { url: "https://routing.openstreetmap.de/routed-car/route/v1/driving", label: "driving" },
};

// WMO weather codes (used by Open-Meteo) → icon + short description.
const WEATHER_CODES = {
  0: ["☀️", "Clear sky"], 1: ["🌤️", "Mainly clear"], 2: ["⛅", "Partly cloudy"], 3: ["☁️", "Overcast"],
  45: ["🌫️", "Fog"], 48: ["🌫️", "Depositing rime fog"],
  51: ["🌦️", "Light drizzle"], 53: ["🌦️", "Drizzle"], 55: ["🌦️", "Dense drizzle"],
  61: ["🌧️", "Light rain"], 63: ["🌧️", "Rain"], 65: ["🌧️", "Heavy rain"],
  71: ["🌨️", "Light snow"], 73: ["🌨️", "Snow"], 75: ["❄️", "Heavy snow"],
  80: ["🌦️", "Rain showers"], 81: ["🌦️", "Rain showers"], 82: ["⛈️", "Violent rain showers"],
  95: ["⛈️", "Thunderstorm"], 96: ["⛈️", "Thunderstorm with hail"], 99: ["⛈️", "Thunderstorm with hail"],
};

// ---------- State ----------
// Everything here is mutable, module-level state (no framework/store — the
// app is small enough that plain `let`s wired up by the functions below are
// easier to follow than introducing state-management machinery).
let map; // the Leaflet map instance, created in initMap()
let userMarker = null; // the cyan dot marking the rider's own position
let userLatLng = null; // {lat, lon} — the rider's current working location (not necessarily GPS; could be a search result or map click)
let resultMarkers = []; // markers currently shown for the last "Find Nearby" search
let markerLayer; // Leaflet layer group holding resultMarkers, so they can all be cleared in one call
let currentTravelMode = "car"; // "car" doubles as the ride profile — riders need motorable roads, not footpaths or cycle-only tracks
let routeLayer = null; // the currently drawn route polyline (directions / Best Route), if any
let watchId = null; // navigator.geolocation.watchPosition() id while "Live" tracking is on; null when off
let suggestDebounceTimer = null; // debounce handle for the main search box's autocomplete
let suggestAbortController = null; // cancels an in-flight suggestion fetch when a newer keystroke supersedes it
let pilotModeActive = false; // true while the "Access" tab is open -- changes what a map click does (see initMap())
let pilotIsochroneLayer = null; // the currently drawn isochrone polygon, if any
let pilotHexLayer = null; // the loaded coverage-hexagon layer, if any
let pilotServicesLayer = null; // the loaded healthcare-services layer, if any

// ---------- DOM refs ----------
// One constant per element the script touches, resolved once at load time.
const categoryGrid = document.getElementById("category-grid");
const findBtn = document.getElementById("find-btn");
const statusHint = document.getElementById("status-hint");
const resultsList = document.getElementById("results-list");
const resultCount = document.getElementById("result-count");
const loader = document.getElementById("loader");
const locateBtn = document.getElementById("locate-btn");
const trackBtn = document.getElementById("track-btn");
const searchBtn = document.getElementById("search-btn");
const placeSearch = document.getElementById("place-search");
const searchSuggestions = document.getElementById("search-suggestions");
const modeToggle = document.getElementById("mode-toggle");
const locationInfoPanel = document.getElementById("location-info-panel");
const infoAddress = document.getElementById("info-address");
const infoWeather = document.getElementById("info-weather");
const infoWeatherIcon = document.getElementById("info-weather-icon");
const infoElevation = document.getElementById("info-elevation");
const shareBtn = document.getElementById("share-btn");
const routeBar = document.getElementById("route-bar");
const routeDestSearch = document.getElementById("route-dest-search");
const routeDestSuggestions = document.getElementById("route-dest-suggestions");
const routeDestBtn = document.getElementById("route-dest-btn");
const rideCodeInput = document.getElementById("ride-code");
const rideCodeGenerateBtn = document.getElementById("ride-code-generate");
const rideCodeCopyBtn = document.getElementById("ride-code-copy-btn");
const rideNameInput = document.getElementById("ride-name");
const rideToggleBtn = document.getElementById("ride-toggle-btn");
const rideStatus = document.getElementById("ride-status");
const rideFriendsList = document.getElementById("ride-friends-list");
const routeBarText = document.getElementById("route-bar-text");
const routeBarClose = document.getElementById("route-bar-close");
const sosNameInput = document.getElementById("sos-name");
const sosPhoneInput = document.getElementById("sos-phone");
const sosSaveStatus = document.getElementById("sos-save-status");
const sosBtn = document.getElementById("sos-btn");
const sosToast = document.getElementById("sos-toast");
const sidebarTabs = document.getElementById("sidebar-tabs");
const sidebarTabIndicator = document.getElementById("sidebar-tab-indicator");
const sidebarTabPanels = {
  explore: document.getElementById("tab-explore"),
  routes: document.getElementById("tab-routes"),
  safety: document.getElementById("tab-safety"),
  pilot: document.getElementById("tab-pilot"),
};
const fuelRangeSlider = document.getElementById("fuel-range-slider");
const fuelRangeValue = document.getElementById("fuel-range-value");
const fuelRangeBtn = document.getElementById("fuel-range-btn");
const fuelRangeStatus = document.getElementById("fuel-range-status");
const quickFindGrid = document.getElementById("quick-find-grid");
const quickFindStatus = document.getElementById("quick-find-status");
const pilotLoadLayersBtn = document.getElementById("pilot-load-layers-btn");
const pilotLayersStatus = document.getElementById("pilot-layers-status");
const pilotMinutesSlider = document.getElementById("pilot-minutes-slider");
const pilotMinutesValue = document.getElementById("pilot-minutes-value");
const pilotIsochroneStatus = document.getElementById("pilot-isochrone-status");
const pilotNearestList = document.getElementById("pilot-nearest-list");

// ---------- Init map ----------
// Creates the Leaflet map centered on Pune, wires up the two switchable
// basemaps (Streets / Satellite) via a layer control, creates the layer
// group that search-result markers live in, and makes a plain map click
// act as "set my location here".
function initMap() {
  map = L.map("map", { zoomControl: true }).setView(PUNE_CENTER, PUNE_DEFAULT_ZOOM);

  const streets = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  const satellite = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { maxZoom: 19, attribution: "Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics" }
  );

  L.control
    .layers({ "🗺️ Streets": streets, "🛰️ Satellite": satellite }, null, { position: "topright" })
    .addTo(map);

  markerLayer = L.layerGroup().addTo(map);

  // Classic GIS reference tools: a scale bar (Leaflet's built-in control,
  // just switched to metric) and a live lat/lon readout under the cursor.
  L.control.scale({ metric: true, imperial: false, position: "bottomright" }).addTo(map);

  const coordReadout = document.getElementById("coord-readout");
  map.on("mousemove", (e) => {
    coordReadout.textContent = `${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)}`;
  });
  map.on("mouseout", () => {
    coordReadout.textContent = "";
  });

  // Clicking the map sets the user location manually -- unless the Access
  // pilot tab is open, in which case a click instead runs the walking
  // isochrone / nearest-service analysis (see pilotModeActive below).
  map.on("click", (e) => {
    if (pilotModeActive) {
      runPilotIsochrone(e.latlng);
      runPilotNearest(e.latlng);
      return;
    }
    setUserLocation(e.latlng.lat, e.latlng.lng, "Location set from map click");
  });
}

// Leaflet's flyTo()/flyToBounds() compute their easing curve from the map's
// current pixel size; if the container is momentarily unsized (a hidden or
// just-backgrounded browser tab, for instance), that math divides by zero
// and throws, which would otherwise crash something as routine as setting a
// location. Animate when it's safe to, and silently fall back to an instant
// jump — same end state, just without the fly-through — rather than break.
function flyToSafe(latlng, zoom, options) {
  try {
    map.flyTo(latlng, zoom, options);
  } catch (e) {
    map.setView(latlng, zoom);
  }
}

function flyToBoundsSafe(bounds, options) {
  try {
    map.flyToBounds(bounds, options);
  } catch (e) {
    map.fitBounds(bounds, options);
  }
}

// ---------- Category chips ----------
// Rebuilds the whole "Categories" grid from CATEGORIES + activeCategories.
// Called on load, and again whenever a shared link restores a different
// active-category set. Clicking a chip toggles its category id in the
// Set and flips its own "active" class — it does not re-render the grid.
function renderCategoryChips() {
  categoryGrid.innerHTML = "";
  CATEGORIES.forEach((cat) => {
    const chip = document.createElement("div");
    chip.className = "category-chip" + (activeCategories.has(cat.id) ? " active" : "");
    chip.dataset.id = cat.id;
    chip.innerHTML = `<span class="cat-icon">${cat.icon}</span><span>${cat.label}</span>`;
    chip.addEventListener("click", () => {
      if (activeCategories.has(cat.id)) {
        activeCategories.delete(cat.id);
      } else {
        activeCategories.add(cat.id);
      }
      chip.classList.toggle("active");
    });
    categoryGrid.appendChild(chip);
  });
}

// ---------- User location ----------
// The single place that updates "where the rider currently is": moves/creates
// the user marker, flies the camera there, enables the Find Nearby button,
// and kicks off the address/weather/elevation lookups for that point. Called
// from geolocation, search, map clicks, and shared-link restoration alike.
function setUserLocation(lat, lon, message) {
  userLatLng = { lat, lon };
  placeUserMarker(lat, lon);

  flyToSafe([lat, lon], 14, { duration: 1.1 });
  setHint(message || "Location set.", "success");
  findBtn.disabled = false;
  loadLocationInfo(lat, lon);
}

// Creates the plain dot marker for the rider's own position the first time
// it's needed, or just moves it on every call after that. Shared by
// setUserLocation() and live tracking below, so there's a single definition
// of "what the rider's own marker looks like".
function placeUserMarker(lat, lon) {
  if (userMarker) {
    userMarker.setLatLng([lat, lon]);
    return;
  }
  const icon = L.divIcon({ className: "", html: '<div class="user-pin"></div>', iconSize: [18, 18] });
  userMarker = L.marker([lat, lon], { icon, zIndexOffset: 1000 }).addTo(map);
  userMarker.bindPopup("<b>You are here</b>");
}

// "My Location" button handler: asks the browser for a one-shot GPS/network
// fix and, on success, routes it through setUserLocation(). On failure (e.g.
// permission denied), leaves a hint telling the rider they can still set a
// location by searching or tapping the map.
function locateMe() {
  if (!navigator.geolocation) {
    setHint("Geolocation is not supported by this browser.", "error");
    return;
  }
  setHint("Requesting your location…");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      setUserLocation(pos.coords.latitude, pos.coords.longitude, "Using your current location.");
    },
    (err) => {
      setHint(`Could not get location: ${err.message}. Click the map to set it manually.`, "error");
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}
locateBtn.addEventListener("click", locateMe);

// ---------- Live location tracking ----------
// Toggled by the "📡 Live" button. While on, navigator.geolocation.watchPosition
// keeps userLatLng and the marker in sync with the device's GPS and gently
// pans the map to follow (map.panTo, not flyTo — ticks arrive every few
// seconds, and animating each one would feel jerky rather than smooth).
function toggleTrackLive() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
    trackBtn.classList.remove("active");
    trackBtn.textContent = "📡 Live";
    setHint("Live tracking stopped.");
    return;
  }
  if (!navigator.geolocation) {
    setHint("Geolocation is not supported by this browser.", "error");
    return;
  }
  trackBtn.classList.add("active");
  trackBtn.textContent = "⏹ Stop";
  setHint("Tracking your location live — the map will follow you.");
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      userLatLng = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      placeUserMarker(userLatLng.lat, userLatLng.lon);
      map.panTo([userLatLng.lat, userLatLng.lon]);
      findBtn.disabled = false;
    },
    (err) => {
      setHint(`Live tracking error: ${err.message}`, "error");
      toggleTrackLive();
    },
    { enableHighAccuracy: true, maximumAge: 5000 }
  );
}
trackBtn.addEventListener("click", toggleTrackLive);

// ---------- Location enrichment: address, weather, elevation ----------
// Reveals the "Location Info" panel and kicks off three independent lookups
// in parallel (none awaited here — each one fills in its own line of the
// panel whenever it resolves, and a slow/failed one doesn't block the others).
async function loadLocationInfo(lat, lon) {
  locationInfoPanel.hidden = false;
  infoAddress.textContent = "Looking up address…";
  infoWeather.textContent = "Loading weather…";
  infoWeatherIcon.textContent = "⛅";
  infoElevation.textContent = "Loading elevation…";

  loadAddress(lat, lon);
  loadWeather(lat, lon);
  loadElevation(lat, lon);
}

// Reverse-geocodes lat/lon into a human-readable address via Nominatim.
async function loadAddress(lat, lon) {
  try {
    const url = `${NOMINATIM_ENDPOINT}/reverse?format=json&lat=${lat}&lon=${lon}&zoom=17`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("lookup failed");
    const data = await res.json();
    infoAddress.textContent = data.display_name || "Address unavailable";
  } catch (e) {
    infoAddress.textContent = "Address unavailable";
  }
}

// Fetches current conditions from Open-Meteo and renders them as an icon + summary line.
async function loadWeather(lat, lon) {
  try {
    const url = `${WEATHER_ENDPOINT}?latitude=${lat}&longitude=${lon}&current_weather=true`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("weather failed");
    const data = await res.json();
    const cw = data.current_weather;
    if (!cw) throw new Error("no data");
    const [icon, desc] = WEATHER_CODES[cw.weathercode] || ["🌡️", "Unknown"];
    infoWeatherIcon.textContent = icon;
    infoWeather.textContent = `${desc}, ${Math.round(cw.temperature)}°C, wind ${Math.round(cw.windspeed)} km/h`;
  } catch (e) {
    infoWeather.textContent = "Weather unavailable";
  }
}

// Looks up ground elevation at lat/lon via Open-Elevation.
async function loadElevation(lat, lon) {
  try {
    const url = `${ELEVATION_ENDPOINT}?locations=${lat},${lon}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("elevation failed");
    const data = await res.json();
    const result = data.results && data.results[0];
    if (!result) throw new Error("no data");
    infoElevation.textContent = `${Math.round(result.elevation)} m above sea level`;
  } catch (e) {
    infoElevation.textContent = "Elevation unavailable";
  }
}

// ---------- Place search (Nominatim geocoding, Pune-scoped) ----------
// bounded=1 + the Pune viewbox restricts results to places actually inside
// the Pune metro area, rather than just biasing ranking toward it.
// Shared by the top search box AND the "Best Route" destination box below.
function puneGeocodeUrl(q, limit) {
  return (
    `${NOMINATIM_ENDPOINT}/search?format=json&q=${encodeURIComponent(q)}&limit=${limit}` +
    `&countrycodes=${AREA_COUNTRY_CODE}&viewbox=${PUNE_VIEWBOX}&bounded=1&addressdetails=1`
  );
}

// Geocodes whatever's in the top search box (or an explicit `query`) to a
// single best match and sets it as the rider's location via setUserLocation().
async function searchPlace(query) {
  const q = (query || placeSearch.value).trim();
  if (!q) return;
  hideSuggestions();
  setHint("Searching for place in Pune…");
  try {
    const res = await fetch(puneGeocodeUrl(q, 1), { headers: { Accept: "application/json" } });
    const data = await res.json();
    if (!data.length) {
      setHint("Place not found in Pune. Try a different search.", "error");
      return;
    }
    const { lat, lon, display_name } = data[0];
    placeSearch.value = display_name;
    setUserLocation(parseFloat(lat), parseFloat(lon), `Location: ${display_name}`);
  } catch (e) {
    setHint("Search failed. Check your connection.", "error");
  }
}
searchBtn.addEventListener("click", () => searchPlace());

// ---------- Search-box autocomplete suggestions ----------
// currentSuggestions holds the last fetched result list (so Enter/click can
// resolve an index straight to a place without re-fetching); activeSuggestionIndex
// tracks which row is highlighted for keyboard navigation (-1 = none).
let currentSuggestions = [];
let activeSuggestionIndex = -1;

// Debounced-as-you-type trigger for fetching suggestions (min 3 characters,
// 350ms of no further typing before firing a request).
placeSearch.addEventListener("input", () => {
  const q = placeSearch.value.trim();
  clearTimeout(suggestDebounceTimer);
  if (q.length < 3) {
    hideSuggestions();
    return;
  }
  suggestDebounceTimer = setTimeout(() => fetchSuggestions(q), 350);
});

// Arrow-key navigation through the open suggestion list, Enter to pick the
// highlighted one (or fall back to a plain search if nothing's highlighted),
// Escape to dismiss.
placeSearch.addEventListener("keydown", (e) => {
  const items = !searchSuggestions.hidden ? [...searchSuggestions.children] : [];
  if (e.key === "ArrowDown" && items.length) {
    e.preventDefault();
    activeSuggestionIndex = (activeSuggestionIndex + 1) % items.length;
    highlightActiveSuggestion(items);
  } else if (e.key === "ArrowUp" && items.length) {
    e.preventDefault();
    activeSuggestionIndex = (activeSuggestionIndex - 1 + items.length) % items.length;
    highlightActiveSuggestion(items);
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (activeSuggestionIndex >= 0 && currentSuggestions[activeSuggestionIndex]) {
      selectSuggestion(currentSuggestions[activeSuggestionIndex]);
    } else {
      searchPlace();
    }
  } else if (e.key === "Escape") {
    hideSuggestions();
  }
});

// Clicking anywhere outside the search box/dropdown closes the suggestions.
document.addEventListener("click", (e) => {
  if (!e.target.closest(".search-input-wrap")) hideSuggestions();
});

// Fetches up to 6 Pune-scoped matches for the current query. Aborts any
// still-in-flight request first, so a fast typist never has an old response
// race ahead of a newer one and overwrite the dropdown with stale results.
async function fetchSuggestions(q) {
  if (suggestAbortController) suggestAbortController.abort();
  suggestAbortController = new AbortController();
  try {
    const res = await fetch(puneGeocodeUrl(q, 6), {
      headers: { Accept: "application/json" },
      signal: suggestAbortController.signal,
    });
    const data = await res.json();
    renderSuggestions(data, q);
  } catch (e) {
    // ignore aborted/failed suggestion requests — search box remains usable
  }
}

// Renders the suggestion dropdown: one <li> per place, each with a type icon
// and its matched text highlighted, built as real DOM nodes rather than an
// innerHTML string (see highlightMatch below for why).
function renderSuggestions(places, query) {
  searchSuggestions.innerHTML = "";
  currentSuggestions = places;
  activeSuggestionIndex = -1;
  if (!places.length) {
    hideSuggestions();
    return;
  }
  places.forEach((p) => {
    const li = document.createElement("li");

    const icon = document.createElement("span");
    icon.className = "suggestion-icon";
    icon.textContent = PLACE_TYPE_ICONS[p.type] || PLACE_TYPE_ICONS[p.class] || "📍";
    li.appendChild(icon);

    const label = document.createElement("span");
    label.className = "suggestion-label";
    label.appendChild(highlightMatch(p.display_name, query));
    li.appendChild(label);

    li.addEventListener("click", () => selectSuggestion(p));
    searchSuggestions.appendChild(li);
  });
  searchSuggestions.hidden = false;
}

// Wrap the matched substring in <mark>, built from real text nodes (no HTML injection).
function highlightMatch(text, query) {
  const frag = document.createDocumentFragment();
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) {
    frag.appendChild(document.createTextNode(text));
    return frag;
  }
  frag.appendChild(document.createTextNode(text.slice(0, idx)));
  const mark = document.createElement("mark");
  mark.textContent = text.slice(idx, idx + query.length);
  frag.appendChild(mark);
  frag.appendChild(document.createTextNode(text.slice(idx + query.length)));
  return frag;
}

// Applies/moves the "active" class for keyboard-highlighted row `activeSuggestionIndex`,
// and scrolls it into view if the dropdown is taller than its visible area.
function highlightActiveSuggestion(items) {
  items.forEach((li, i) => li.classList.toggle("active", i === activeSuggestionIndex));
  const active = items[activeSuggestionIndex];
  if (active) active.scrollIntoView({ block: "nearest" });
}

// User picked a suggestion (click or Enter): fill the box with its full name,
// close the dropdown, and set it as the rider's location.
function selectSuggestion(p) {
  placeSearch.value = p.display_name;
  hideSuggestions();
  setUserLocation(parseFloat(p.lat), parseFloat(p.lon), `Location: ${p.display_name}`);
}

// Closes and clears the suggestion dropdown and its associated state.
function hideSuggestions() {
  searchSuggestions.hidden = true;
  searchSuggestions.innerHTML = "";
  currentSuggestions = [];
  activeSuggestionIndex = -1;
}

// ---------- Hint helper ----------
// Updates the small status line under "Find Nearby" with a message and an
// optional "error"/"success" class for colour-coding.
function setHint(text, type) {
  statusHint.textContent = text;
  statusHint.className = "hint" + (type ? ` ${type}` : "");
}

// ---------- Haversine distance (meters) ----------
// Great-circle distance between two lat/lon points — used for every
// "X km/m away" figure in the app (results list, popups, ride-friend distances).
function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Formats a metre figure as "123 m" or "1.23 km" depending on magnitude.
function formatDistance(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}

// Animates a number element counting up from its current displayed value to
// `target` over ~500ms (e.g. the "Results 0 → 237" badge), instead of the
// count just snapping to the new figure.
function animateCountUp(el, target) {
  const start = parseInt(el.textContent, 10) || 0;
  if (start === target) {
    el.textContent = target;
    return;
  }
  const durationMs = 500;
  const startTime = performance.now();
  function step(now) {
    const t = Math.min(1, (now - startTime) / durationMs);
    const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
    el.textContent = Math.round(start + (target - start) * eased);
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ---------- Travel mode toggle (for directions) ----------
// The 🏍️ / 🚴 / 🚶 segmented control above the results list. Clicking a
// button sets currentTravelMode, which both getDirectionsTo() (below) and
// the Best Route feature read when picking an OSRM routing profile.
modeToggle.addEventListener("click", (e) => {
  const btn = e.target.closest(".mode-btn");
  if (!btn) return;
  currentTravelMode = btn.dataset.mode;
  [...modeToggle.querySelectorAll(".mode-btn")].forEach((b) => {
    const isActive = b === btn;
    b.classList.toggle("active", isActive);
    b.setAttribute("aria-pressed", String(isActive)); // keeps screen readers' "pressed" state in sync with the visible one
  });
});

// ---------- Directions / routing (OSRM) ----------
// Fetches a route from the rider's current location to (destLat, destLon)
// using the OSRM mirror for the selected travel mode, then hands the result
// to drawRoute(). Used both by per-result "🧭 Directions" buttons/popups and
// by the Best Route destination search.
async function getDirectionsTo(destLat, destLon, destName) {
  if (!userLatLng) {
    setHint("Set your location first to get directions.", "error");
    return;
  }
  showRouteBar(`Calculating ${ROUTING_PROFILES[currentTravelMode].label} route…`, false, true);
  const profile = ROUTING_PROFILES[currentTravelMode];
  const url = `${profile.url}/${userLatLng.lon},${userLatLng.lat};${destLon},${destLat}?overview=full&geometries=geojson`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`routing service returned ${res.status}`);
    const data = await res.json();
    const route = data.routes && data.routes[0];
    if (!route) throw new Error("no route found");
    drawRoute(route, destName);
  } catch (e) {
    showRouteBar(`Could not get directions: ${e.message}`, true);
  }
}

// Replaces any existing route polyline with the new one, flies the camera to
// fit it, and updates the route bar with distance + ETA.
function drawRoute(route, destName) {
  if (routeLayer) map.removeLayer(routeLayer);
  const coords = route.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
  routeLayer = L.polyline(coords, { color: "#38bdf8", weight: 5, opacity: 0.85, className: "route-line" }).addTo(map);
  flyToBoundsSafe(routeLayer.getBounds(), { padding: [50, 50], duration: 1.2 });
  const km = (route.distance / 1000).toFixed(2);
  const mins = Math.round(route.duration / 60);
  const modeIcon = { foot: "🚶", bike: "🚴", car: "🏍️" }[currentTravelMode];
  showRouteBar(`${modeIcon} To ${destName}: ${km} km · ~${mins} min`, false);
}

// Removes the drawn route and hides the route bar (the ✕ button).
function clearRoute() {
  if (routeLayer) {
    map.removeLayer(routeLayer);
    routeLayer = null;
  }
  routeBar.hidden = true;
}
routeBarClose.addEventListener("click", clearRoute);

// Shows the floating route bar with a message; `isError` tints its border
// red, `isLoading` hides the ✕ close button while a route request is in flight.
function showRouteBar(text, isError, isLoading) {
  routeBarText.textContent = text;
  routeBar.hidden = false;
  routeBar.style.borderColor = isError ? "var(--danger)" : "var(--accent-2)";
  routeBarClose.hidden = !!isLoading;
}

// ---------- Best Route to a searched destination ----------
// A second, independent Pune-scoped autocomplete (mirrors the top search
// box's, but kept separate to avoid touching that already-working flow).
let routeDestDebounceTimer = null;
let routeDestAbortController = null;
let routeDestSuggestionsData = [];
let routeDestActiveIndex = -1;

routeDestBtn.addEventListener("click", () => getBestRouteToQuery());

routeDestSearch.addEventListener("input", () => {
  const q = routeDestSearch.value.trim();
  clearTimeout(routeDestDebounceTimer);
  if (q.length < 3) {
    hideRouteDestSuggestions();
    return;
  }
  routeDestDebounceTimer = setTimeout(() => fetchRouteDestSuggestions(q), 350);
});

// Same arrow/Enter/Escape handling as the main search box, but Enter without
// a highlighted suggestion triggers getBestRouteToQuery() instead of a plain search.
routeDestSearch.addEventListener("keydown", (e) => {
  const items = !routeDestSuggestions.hidden ? [...routeDestSuggestions.children] : [];
  if (e.key === "ArrowDown" && items.length) {
    e.preventDefault();
    routeDestActiveIndex = (routeDestActiveIndex + 1) % items.length;
    highlightRouteDestActive(items);
  } else if (e.key === "ArrowUp" && items.length) {
    e.preventDefault();
    routeDestActiveIndex = (routeDestActiveIndex - 1 + items.length) % items.length;
    highlightRouteDestActive(items);
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (routeDestActiveIndex >= 0 && routeDestSuggestionsData[routeDestActiveIndex]) {
      selectRouteDestSuggestion(routeDestSuggestionsData[routeDestActiveIndex]);
    } else {
      getBestRouteToQuery();
    }
  } else if (e.key === "Escape") {
    hideRouteDestSuggestions();
  }
});

document.addEventListener("click", (e) => {
  if (!e.target.closest("#route-dest-search") && !e.target.closest("#route-dest-suggestions")) {
    hideRouteDestSuggestions();
  }
});

// Fetches destination-search suggestions (same Pune-scoped Nominatim call
// as the main search box, just writing into the route-destination dropdown).
async function fetchRouteDestSuggestions(q) {
  if (routeDestAbortController) routeDestAbortController.abort();
  routeDestAbortController = new AbortController();
  try {
    const res = await fetch(puneGeocodeUrl(q, 6), {
      headers: { Accept: "application/json" },
      signal: routeDestAbortController.signal,
    });
    const data = await res.json();
    renderRouteDestSuggestions(data, q);
  } catch (e) {
    // ignore aborted/failed suggestion requests
  }
}

// Renders the destination-search dropdown (icon + highlighted match text per row).
function renderRouteDestSuggestions(places, query) {
  routeDestSuggestions.innerHTML = "";
  routeDestSuggestionsData = places;
  routeDestActiveIndex = -1;
  if (!places.length) {
    hideRouteDestSuggestions();
    return;
  }
  places.forEach((p) => {
    const li = document.createElement("li");
    const icon = document.createElement("span");
    icon.className = "suggestion-icon";
    icon.textContent = PLACE_TYPE_ICONS[p.type] || PLACE_TYPE_ICONS[p.class] || "📍";
    li.appendChild(icon);
    const label = document.createElement("span");
    label.className = "suggestion-label";
    label.appendChild(highlightMatch(p.display_name, query));
    li.appendChild(label);
    li.addEventListener("click", () => selectRouteDestSuggestion(p));
    routeDestSuggestions.appendChild(li);
  });
  routeDestSuggestions.hidden = false;
}

// Highlights the keyboard-selected row in the destination dropdown.
function highlightRouteDestActive(items) {
  items.forEach((li, i) => li.classList.toggle("active", i === routeDestActiveIndex));
  const active = items[routeDestActiveIndex];
  if (active) active.scrollIntoView({ block: "nearest" });
}

// User picked a destination suggestion directly: skip the "search then route"
// round trip and go straight to drawing directions to it.
function selectRouteDestSuggestion(p) {
  routeDestSearch.value = p.display_name;
  hideRouteDestSuggestions();
  getDirectionsTo(parseFloat(p.lat), parseFloat(p.lon), p.display_name);
}

// Closes and clears the destination-search dropdown and its state.
function hideRouteDestSuggestions() {
  routeDestSuggestions.hidden = true;
  routeDestSuggestions.innerHTML = "";
  routeDestSuggestionsData = [];
  routeDestActiveIndex = -1;
}

// "Get Best Route" button / plain Enter in the destination box: geocodes
// whatever text is typed to a single best match, then routes to it.
async function getBestRouteToQuery() {
  const q = routeDestSearch.value.trim();
  if (!q) return;
  if (!userLatLng) {
    setHint("Set your starting location first (My Location, search above, or click the map).", "error");
    return;
  }
  hideRouteDestSuggestions();
  showRouteBar("Finding best route…", false, true);
  try {
    const res = await fetch(puneGeocodeUrl(q, 1), { headers: { Accept: "application/json" } });
    const data = await res.json();
    if (!data.length) {
      showRouteBar("Destination not found in Pune.", true);
      return;
    }
    const { lat, lon, display_name } = data[0];
    routeDestSearch.value = display_name;
    getDirectionsTo(parseFloat(lat), parseFloat(lon), display_name);
  } catch (e) {
    showRouteBar(`Could not find destination: ${e.message}`, true);
  }
}

// ---------- Build Overpass query ----------
// Turns the set of active category ids into an Overpass QL query that finds
// every node/way within `radius` metres of (lat, lon) matching any of their
// OSM tag filters. `out center tags` returns each element's coordinates
// (or its centroid, for a way) plus its tags, which is all renderResults() needs.
function buildOverpassQuery(lat, lon, radius, categoryIds) {
  const cats = CATEGORIES.filter((c) => categoryIds.includes(c.id));
  let body = "";
  cats.forEach((cat) => {
    cat.filters.forEach((f) => {
      const [key, value] = f.split("=");
      body += `node["${key}"="${value}"](around:${radius},${lat},${lon});\n`;
      body += `way["${key}"="${value}"](around:${radius},${lat},${lon});\n`;
    });
  });
  return `[out:json][timeout:25];\n(\n${body}\n);\nout center tags;`;
}

// ---------- Fetch nearby POIs ----------
// "Find Nearby" button handler: validates there's a location and at least
// one active category, shows the loading spinner, runs the Overpass query
// (with mirror fallback), and renders whatever comes back — always clearing
// the loader/re-enabling the button afterward, success or failure.
async function findNearby() {
  if (!userLatLng) {
    setHint("Set your location first (use 'My Location', search, or click the map).", "error");
    return;
  }
  if (activeCategories.size === 0) {
    setHint("Select at least one category.", "error");
    return;
  }

  loader.hidden = false;
  findBtn.disabled = true;
  clearResults();

  try {
    const places = await fetchNearbyPlaces(userLatLng.lat, userLatLng.lon, DEFAULT_SEARCH_RADIUS_METERS, [...activeCategories]);
    renderResults(places);
  } catch (e) {
    setHint(`Failed to fetch nearby places: ${e.message}. The free Overpass servers can be busy — please try again in a moment.`, "error");
  } finally {
    loader.hidden = true;
    findBtn.disabled = false;
  }
}

// Runs an Overpass search for `categoryIds` within `radiusMeters` of
// (lat, lon) and turns the raw response into a clean, distance-sorted,
// de-duplicated list of places — {id, name, lat, lon, cat, dist, address,
// rating, tags} per place. This is the one shared "go find stuff nearby"
// function: Find Nearby, the Fuel Range Calculator, and the Quick Find
// buttons all call it, each just with a different category/radius and a
// different thing to do with the resulting list.
async function fetchNearbyPlaces(lat, lon, radiusMeters, categoryIds) {
  const query = buildOverpassQuery(lat, lon, radiusMeters, categoryIds);
  const data = await fetchFromOverpassWithFallback(query);
  const elements = data.elements || [];

  const items = [];
  elements.forEach((el) => {
    // Ways don't have a direct lat/lon — Overpass's `out center` gives us
    // their centroid under `.center` instead.
    const elLat = el.type === "node" ? el.lat : el.center && el.center.lat;
    const elLon = el.type === "node" ? el.lon : el.center && el.center.lon;
    if (elLat == null || elLon == null) return;

    const tags = el.tags || {};
    const cat = categoryForTags(tags);
    if (!cat) return; // tag combination we don't recognize — skip it

    const name = tags.name || cat.singular || cat.label.replace(/s$/, "");
    const dist = distanceMeters(lat, lon, elLat, elLon);
    const addressBits = [tags["addr:street"], tags["addr:city"] || tags["addr:suburb"]].filter(Boolean);
    const rating = extractRating(tags);

    items.push({ id: `${el.type}/${el.id}`, name, lat: elLat, lon: elLon, cat, dist, address: addressBits.join(", "), rating, tags });
  });

  // De-duplicate by OSM id (a place can appear more than once if it matches
  // multiple requested categories) and sort nearest-first.
  const seen = new Set();
  const unique = items.filter((it) => (seen.has(it.id) ? false : (seen.add(it.id), true)));
  unique.sort((a, b) => a.dist - b.dist);
  return unique;
}

// Sends the same query to every Overpass mirror AT ONCE and returns
// whichever one answers first — Promise.any() resolves as soon as any one
// of them succeeds, and only rejects if every single one fails. This
// replaces an earlier version that tried mirrors one at a time (so a slow
// first mirror meant waiting out its whole timeout before even trying the
// next one — worst case, the sum of every mirror's timeout). Racing them
// instead caps the worst case at a single 20s timeout window, and means one
// overloaded mirror no longer blocks the others from being tried.
const OVERPASS_TIMEOUT_MS = 20000;

async function fetchFromOverpassWithFallback(query) {
  const controllers = OVERPASS_ENDPOINTS.map(() => new AbortController());
  const attempts = OVERPASS_ENDPOINTS.map((endpoint, i) =>
    fetchOverpassFrom(endpoint, query, OVERPASS_TIMEOUT_MS, controllers[i])
  );

  try {
    const result = await Promise.any(attempts);
    controllers.forEach((c) => c.abort()); // we have a winner — stop the still-pending requests to the other mirrors, rather than needlessly tying up a free shared service
    return result;
  } catch (e) {
    throw new Error("no Overpass mirror responded in time");
  }
}

// Fetches from a single Overpass mirror, aborting it after `timeoutMs`.
async function fetchOverpassFrom(endpoint, query, timeoutMs, controller) {
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      body: "data=" + encodeURIComponent(query),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`${endpoint} returned ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timeoutId);
  }
}
findBtn.addEventListener("click", findNearby);

// ---------- Fuel Range Calculator ----------
// Rider-specific USP: instead of just listing nearby petrol pumps, this
// answers "can I actually get there?" — the rider enters how far they can
// still ride, and it searches for pumps within exactly that radius (reusing
// fetchNearbyPlaces(), scoped to the "fuel" category), then reports either
// the nearest one or a clear warning if nothing is within reach.
let fuelRangeLayer = null; // Leaflet layer group holding the pump markers from the last check, or null when cleared

function updateFuelRangeLabel() {
  fuelRangeValue.textContent = `${fuelRangeSlider.value} km`;
}
fuelRangeSlider.addEventListener("input", updateFuelRangeLabel);
updateFuelRangeLabel();

fuelRangeBtn.addEventListener("click", () => checkFuelRange());

async function checkFuelRange() {
  if (!userLatLng) {
    setFuelRangeStatus("Set your location first (My Location, search, or click the map).", "error");
    return;
  }
  const rangeKm = parseInt(fuelRangeSlider.value, 10);
  const radiusMeters = rangeKm * 1000;

  fuelRangeBtn.disabled = true;
  setFuelRangeStatus(`Searching for petrol pumps within ${rangeKm} km…`);

  try {
    const pumps = await fetchNearbyPlaces(userLatLng.lat, userLatLng.lon, radiusMeters, ["fuel"]);
    renderFuelRangeLayer(pumps);

    if (pumps.length === 0) {
      setFuelRangeStatus(
        `⚠️ No petrol pump found within your ${rangeKm} km range. Refuel as soon as you can, or try a larger range.`,
        "error"
      );
      return;
    }
    const nearest = pumps[0];
    setFuelRangeStatus(
      `✅ ${pumps.length} petrol pump${pumps.length === 1 ? "" : "s"} within range. Nearest: ${nearest.name}, ${formatDistance(nearest.dist)} away.`,
      "success"
    );
  } catch (e) {
    setFuelRangeStatus(`Could not check fuel range: ${e.message}. The free Overpass servers can be busy — try again in a moment.`, "error");
  } finally {
    fuelRangeBtn.disabled = false;
  }
}

// Draws every reachable pump as a marker (⭐ for the nearest one, ⛽ for the
// rest) in its own layer group, so a later check replaces only these
// markers and doesn't disturb a Find Nearby search.
function renderFuelRangeLayer(pumps) {
  if (fuelRangeLayer) {
    map.removeLayer(fuelRangeLayer);
    fuelRangeLayer = null;
  }
  if (pumps.length === 0) return;

  fuelRangeLayer = L.layerGroup().addTo(map);
  const bounds = L.latLngBounds([[userLatLng.lat, userLatLng.lon]]);
  pumps.forEach((pump, index) => {
    const icon = L.divIcon({
      className: "",
      html: `<div class="emoji-pin marker-drop-in">${index === 0 ? "⭐" : "⛽"}</div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });
    const marker = L.marker([pump.lat, pump.lon], { icon }).addTo(fuelRangeLayer);
    marker.bindPopup(buildPopupContent(pump));
    bounds.extend([pump.lat, pump.lon]);
  });
  flyToBoundsSafe(bounds, { padding: [40, 40], maxZoom: 15, duration: 1 });
}

function setFuelRangeStatus(text, type) {
  fuelRangeStatus.textContent = text;
  fuelRangeStatus.className = "hint" + (type ? ` ${type}` : "");
}

// ---------- Quick Find: one-tap "nearest X" buttons ----------
// Skips the full Find Nearby flow (pick categories, set a radius, scroll
// the results list) for the handful of things a rider most often needs in
// a hurry — jumps straight to the single closest match and opens its popup.
const QUICK_FIND_CATEGORY_IDS = ["fuel", "hospital", "atm", "restaurant"];

// Builds the quick-find buttons from CATEGORIES, once, so icons/labels stay in sync.
QUICK_FIND_CATEGORY_IDS.forEach((id) => {
  const cat = CATEGORIES.find((c) => c.id === id);
  if (!cat) return;
  const btn = document.createElement("button");
  btn.className = "quick-find-btn";
  btn.innerHTML = `<span class="cat-icon">${cat.icon}</span><span>${cat.label}</span>`;
  btn.addEventListener("click", () => findNearestOfCategory(cat));
  quickFindGrid.appendChild(btn);
});

let quickFindMarker = null; // the single marker from the last "nearest X" tap

async function findNearestOfCategory(cat) {
  if (!userLatLng) {
    setQuickFindStatus("Set your location first (My Location, search, or click the map).", "error");
    return;
  }
  // Same fixed radius as Find Nearby — see DEFAULT_SEARCH_RADIUS_METERS.
  const radiusMeters = DEFAULT_SEARCH_RADIUS_METERS;
  // Use the singular form ("petrol pump", not "petrol pumps") — we're
  // reporting exactly one nearest place, so the plural category label reads
  // wrong here ("Nearest petrol pumps: ..." is a grammar bug the plural label
  // would otherwise cause).
  const singular = (cat.singular || cat.label).toLowerCase();
  setQuickFindStatus(`Finding the nearest ${singular}…`);

  try {
    const places = await fetchNearbyPlaces(userLatLng.lat, userLatLng.lon, radiusMeters, [cat.id]);
    if (places.length === 0) {
      setQuickFindStatus(
        `No ${singular} found within ${formatDistance(radiusMeters)}. Try a larger search radius.`,
        "error"
      );
      return;
    }
    const nearest = places[0];
    placeQuickFindMarker(nearest);
    flyToSafe([nearest.lat, nearest.lon], 17, { duration: 1 });
    setQuickFindStatus(`${cat.icon} Nearest ${singular}: ${nearest.name}, ${formatDistance(nearest.dist)} away.`, "success");
  } catch (e) {
    setQuickFindStatus(`Could not search: ${e.message}. The free Overpass servers can be busy — try again in a moment.`, "error");
  }
}

// Shows the found place as a single marker with its usual popup (name,
// distance, rating, Directions button) — the same popup Find Nearby uses,
// via the shared buildPopupContent().
function placeQuickFindMarker(place) {
  if (quickFindMarker) {
    map.removeLayer(quickFindMarker);
    quickFindMarker = null;
  }
  const icon = L.divIcon({
    className: "",
    html: `<div class="emoji-pin marker-drop-in">${place.cat.icon}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
  quickFindMarker = L.marker([place.lat, place.lon], { icon }).addTo(map);
  quickFindMarker.bindPopup(buildPopupContent(place)).openPopup();
}

function setQuickFindStatus(text, type) {
  quickFindStatus.textContent = text;
  quickFindStatus.className = "hint" + (type ? ` ${type}` : "");
}

// ---------- Category lookup by tags ----------
// Given an OSM element's tags, finds which CATEGORIES entry it matches (the
// first filter that matches wins) — used to pick the right icon/label for a
// raw Overpass result.
function categoryForTags(tags) {
  if (!tags) return null;
  for (const cat of CATEGORIES) {
    for (const f of cat.filters) {
      const [key, value] = f.split("=");
      if (tags[key] === value) return cat;
    }
  }
  return null;
}

// Categories where a rating is meaningful (stays, restaurants, cafes) — a
// petrol pump or ATM doesn't have a "rating" in any practical sense, so we
// don't bother showing a "no rating" line for those.
const RATABLE_CATEGORY_IDS = ["stay", "restaurant", "cafe"];

// Pull whatever rating-ish data OpenStreetMap has for a place. Coverage is
// patchy — OSM isn't a review platform — so this surfaces `stars` (the
// common hotel star-classification tag) or a raw `rating` tag when present,
// and returns null otherwise so the caller can show an honest "not listed".
function extractRating(tags) {
  if (tags.stars) {
    const stars = parseFloat(tags.stars);
    if (!Number.isNaN(stars) && stars > 0) {
      return { text: `${"⭐".repeat(Math.round(Math.min(stars, 5)))} ${stars}-star` };
    }
  }
  if (tags.rating) {
    const rating = parseFloat(tags.rating);
    if (!Number.isNaN(rating) && rating > 0) {
      return { text: `⭐ ${rating}/5` };
    }
  }
  return null;
}

// ---------- Clear results ----------
// Wipes the map markers, the sidebar list, the result counter, and any
// drawn route — called at the start of every new "Find Nearby" search.
function clearResults() {
  markerLayer.clearLayers();
  resultMarkers = [];
  resultsList.innerHTML = "";
  resultCount.textContent = "0";
  clearRoute();
}

// ---------- Render results (markers + list) ----------
// Takes the already-parsed, distance-sorted list from fetchNearbyPlaces()
// and paints both the map markers and the sidebar list from it.
function renderResults(unique) {
  animateCountUp(resultCount, unique.length);

  if (unique.length === 0) {
    setHint("No places found in this radius. Try increasing the radius or selecting more categories.", "error");
    return;
  }
  setHint(`Found ${unique.length} place${unique.length === 1 ? "" : "s"} nearby.`, "success");

  const bounds = L.latLngBounds([[userLatLng.lat, userLatLng.lon]]);

  // Paint a marker + a matching sidebar row for every result, in the same
  // sorted order (so the Nth marker and the Nth list item correspond).
  unique.forEach((it, index) => {
    const icon = L.divIcon({
      className: "",
      html: `<div class="emoji-pin marker-drop-in">${it.cat.icon}</div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });
    const marker = L.marker([it.lat, it.lon], { icon }).addTo(markerLayer);
    marker.bindPopup(buildPopupContent(it));
    resultMarkers.push(marker);
    bounds.extend([it.lat, it.lon]);

    const li = document.createElement("li");
    li.className = "result-item";
    li.style.animationDelay = `${Math.min(index, 20) * 25}ms`; // staggers the CSS entrance animation, capped so a 200-result list doesn't take forever to finish appearing
    li.innerHTML = `
      <div class="r-title">${it.cat.icon} ${escapeHtml(it.name)}</div>
      <div class="r-meta">
        <span class="r-meta-text">${it.cat.label} · ${formatDistance(it.dist)}${it.address ? " · " + escapeHtml(it.address) : ""}${it.rating ? " · " + escapeHtml(it.rating.text) : ""}</span>
        <button class="directions-btn" title="Get directions" aria-label="Get directions to ${escapeHtml(it.name)}">🧭</button>
      </div>
    `;
    li.addEventListener("click", () => {
      flyToSafe([it.lat, it.lon], 17, { duration: 1 });
      marker.openPopup();
    });
    li.querySelector(".directions-btn").addEventListener("click", (e) => {
      e.stopPropagation(); // don't also trigger the row's own "fly to it" click handler above
      getDirectionsTo(it.lat, it.lon, it.name);
    });
    resultsList.appendChild(li);
  });

  // Fit the camera to show every result at once.
  flyToBoundsSafe(bounds, { padding: [40, 40], maxZoom: 16, duration: 1 });
}

// Escapes a string for safe insertion into an innerHTML template (used for
// user/OSM-sourced text like names and addresses that could otherwise be
// misread as markup).
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// Build popup content as real DOM nodes (not an HTML string) so names/addresses
// from OSM data can never be interpreted as markup, and the Directions button
// can bind a real click handler instead of an inline attribute.
function buildPopupContent(it) {
  const wrap = document.createElement("div");

  const title = document.createElement("b");
  title.textContent = it.name;
  wrap.appendChild(title);

  const meta = document.createElement("div");
  meta.className = "popup-meta";
  meta.textContent = `${it.cat.icon} ${it.cat.label} · ${formatDistance(it.dist)} away`;
  if (it.address) {
    meta.appendChild(document.createElement("br"));
    meta.appendChild(document.createTextNode(it.address));
  }
  wrap.appendChild(meta);

  if (it.rating) {
    const rating = document.createElement("div");
    rating.className = "popup-rating";
    rating.textContent = it.rating.text;
    wrap.appendChild(rating);
  } else if (RATABLE_CATEGORY_IDS.includes(it.cat.id)) {
    const noRating = document.createElement("div");
    noRating.className = "popup-rating popup-rating-none";
    noRating.textContent = "No rating listed on OpenStreetMap";
    wrap.appendChild(noRating);
  }

  const btn = document.createElement("button");
  btn.className = "popup-directions-btn";
  btn.textContent = "🧭 Directions";
  btn.addEventListener("click", () => getDirectionsTo(it.lat, it.lon, it.name));
  wrap.appendChild(btn);

  return wrap;
}

// ---------- Shareable link ----------
// Encodes the current location/categories into a URL on the clipboard, so
// pasting it elsewhere (or opening it later) reopens the app in the same
// state. No radius to encode — Find Nearby always uses the fixed 2 km default.
shareBtn.addEventListener("click", async () => {
  if (!userLatLng) return;
  const params = new URLSearchParams({
    lat: userLatLng.lat.toFixed(6),
    lon: userLatLng.lon.toFixed(6),
    cats: [...activeCategories].join(","),
  });
  const url = `${location.origin}${location.pathname}?${params.toString()}`;
  try {
    await navigator.clipboard.writeText(url);
    setHint("Shareable link copied to clipboard!", "success");
  } catch (e) {
    // Clipboard API may be unavailable (e.g. insecure context) — fall back to a prompt.
    window.prompt("Copy this link:", url);
  }
});

// Restore location/categories from a shared link, if present in the URL.
// Returns true if it restored something (so init() knows to skip auto-locating).
function restoreFromUrl() {
  const params = new URLSearchParams(location.search);
  const lat = parseFloat(params.get("lat"));
  const lon = parseFloat(params.get("lon"));
  if (Number.isNaN(lat) || Number.isNaN(lon)) return false;

  const cats = params.get("cats");
  if (cats) {
    activeCategories.clear();
    cats.split(",").filter(Boolean).forEach((id) => activeCategories.add(id));
    renderCategoryChips();
  }

  setUserLocation(lat, lon, "Location loaded from shared link.");
  findNearby();
  return true;
}

// ---------- Ride Together: live location sharing over a public relay ----------
// There's no backend here, so this uses HiveMQ's public, no-signup MQTT
// broker over WebSockets as a message relay: everyone who joins the same
// Ride Code publishes their position to a shared topic and subscribes to
// hear everyone else's. It's convenient, but it is NOT private — the broker
// is open to anyone on the internet who knows (or guesses) the Ride Code.
// Good for "here's where I am, meet me there" with people you trust; not a
// substitute for a real authenticated, encrypted tracking service.
const RIDE_BROKER_URL = "wss://broker.hivemq.com:8884/mqtt";
const RIDE_TOPIC_ROOT = "ridestop/ride"; // full topic is RIDE_TOPIC_ROOT/<code>/<riderId>
// Tuned for a "real time" feel: positions broadcast every 3s (was 5s), and a
// friend is flagged stale/gone sooner to match — a rider two stops behind
// you should look out of date within seconds, not minutes.
const RIDE_PUBLISH_INTERVAL_MS = 3000; // how often we broadcast our own position while sharing
const RIDE_STALE_MS = 15000; // grey out a friend's marker after 15s of silence (5 missed updates)
const RIDE_GONE_MS = 60000; // drop it entirely after 1 minute of silence

let rideClient = null; // the active mqtt.js client, or null when not sharing
let rideActive = false; // true while "Start Sharing" is on
let ridePublishTimer = null; // setInterval handle for periodic position publishes
let rideStaleTimer = null; // setInterval handle for the staleness sweep below
let activeRideTopicRoot = null; // set while sharing, so the SOS button can also broadcast to it
const rideFriends = new Map(); // riderId -> { marker, name, lastSeen, lat, lon, stale, sos }

// A per-browser random id, persisted in localStorage so it stays stable
// across reloads (and so a rider never sees their own published position
// show up as if it were a "friend").
const myRiderId = (function () {
  try {
    let id = localStorage.getItem("ridestop_rider_id");
    if (!id) {
      id = "r" + Math.random().toString(36).slice(2, 10);
      localStorage.setItem("ridestop_rider_id", id);
    }
    return id;
  } catch (e) {
    return "r" + Math.random().toString(36).slice(2, 10);
  }
})();

// 🎲 button: fills the Ride Code field with a random, easy-to-read code
// (e.g. "tiger-482") so a rider doesn't have to invent one themselves.
rideCodeGenerateBtn.addEventListener("click", () => {
  const words = ["tiger", "eagle", "cobra", "falcon", "storm", "thunder", "comet", "rocket", "wolf", "hawk"];
  const word = words[Math.floor(Math.random() * words.length)];
  rideCodeInput.value = `${word}-${Math.floor(100 + Math.random() * 900)}`;
});

// 📋 Copy Invite Link: this is what actually makes "both enter the same
// Ride Code" easy — instead of a friend having to type the code by hand
// (typos, wrong case, extra spaces all break it), copies a URL with the
// code baked in as ?ride=<code>. Opening that link pre-fills their Ride
// Code field automatically (see restoreRideCodeFromUrl() below), so all
// they have to do is tap "Start Sharing".
rideCodeCopyBtn.addEventListener("click", async () => {
  const code = sanitizeRideCode(rideCodeInput.value);
  if (!code || code.length < 4) {
    setRideStatus("Enter or generate a Ride Code first (4+ characters), then copy the invite link.", "error");
    return;
  }
  const url = `${location.origin}${location.pathname}?ride=${encodeURIComponent(code)}`;
  try {
    await navigator.clipboard.writeText(url);
    setRideStatus(`Invite link copied! Send it to your friend — Ride Code "${code}".`, "success");
  } catch (e) {
    // Clipboard API may be unavailable (e.g. insecure context) — fall back to a prompt.
    window.prompt("Copy this invite link:", url);
  }
});

// If the page was opened from a copied invite link (?ride=<code>), pre-fill
// the Ride Code field so joining is just "tap Start Sharing" instead of
// typing a code by hand. Called once from init().
function restoreRideCodeFromUrl() {
  const params = new URLSearchParams(location.search);
  const code = params.get("ride");
  if (!code) return;
  rideCodeInput.value = sanitizeRideCode(code);
  setRideStatus(`Ride Code "${rideCodeInput.value}" loaded from a shared link — tap Start Sharing to join.`, "success");
}

// "Start Sharing" / "Stop Sharing" button toggles between the two flows below.
rideToggleBtn.addEventListener("click", () => {
  if (rideActive) stopRideTogether();
  else startRideTogether();
});

function sanitizeRideCode(raw) {
  // Strip anything but the characters we allow, so a code can never contain
  // MQTT topic separators/wildcards ("/", "+", "#") and collide with our topic structure.
  return raw.trim().toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);
}

// Connects to the public MQTT broker, subscribes to everyone on this Ride
// Code's topic, and starts publishing our own position on a timer. All the
// live UI updates (friend markers, SOS alerts) flow from the "message" handler below.
function startRideTogether() {
  const code = sanitizeRideCode(rideCodeInput.value);
  if (!code || code.length < 4) {
    setRideStatus("Enter a Ride Code (4+ characters) — share the exact same code with your friend.", "error");
    return;
  }
  if (typeof mqtt === "undefined") {
    setRideStatus("Live-sharing library failed to load — check your connection and reload the page.", "error");
    return;
  }
  if (!userLatLng) {
    setRideStatus("Set your location first (My Location, search, or click the map).", "error");
    return;
  }

  rideCodeInput.disabled = true;
  rideNameInput.disabled = true;
  setRideStatus("Connecting…");

  const topicRoot = `${RIDE_TOPIC_ROOT}/${code}`;
  const client = mqtt.connect(RIDE_BROKER_URL, {
    clientId: `ridestop_${myRiderId}_${Date.now()}`,
    clean: true,
    connectTimeout: 8000,
    reconnectPeriod: 4000,
  });

  client.on("connect", () => {
    client.subscribe(`${topicRoot}/+`, { qos: 0 }); // "+" = every rider's subtopic under this code
    rideActive = true;
    activeRideTopicRoot = topicRoot;
    rideToggleBtn.textContent = "🔴 Stop Sharing";
    rideToggleBtn.classList.add("active");
    setRideStatus(`Sharing live — Ride Code "${code}". Use 📋 Copy Invite Link to send it to your friend.`, "success");
    publishMyRideLocation(topicRoot); // publish immediately so a friend who's already connected sees us right away
    ridePublishTimer = setInterval(() => publishMyRideLocation(topicRoot), RIDE_PUBLISH_INTERVAL_MS);
    rideStaleTimer = setInterval(refreshRideFriendStaleness, RIDE_PUBLISH_INTERVAL_MS);
  });

  // A message on our topic from anyone but ourselves is a friend's position
  // (or an SOS flag riding along with it).
  client.on("message", (topic, payload) => {
    const senderId = topic.slice(topicRoot.length + 1);
    if (senderId === myRiderId) return; // don't display our own published position as a "friend"
    let data;
    try {
      data = JSON.parse(payload.toString());
    } catch (e) {
      return;
    }
    if (typeof data.lat !== "number" || typeof data.lon !== "number") return;
    upsertRideFriend(senderId, data);
    if (data.sos) showSosToast(`🆘 ${(data.name || "Your riding buddy").toString().slice(0, 20)} triggered SOS! Check their location on the map.`);
  });

  client.on("error", (err) => {
    setRideStatus(`Connection error: ${(err && err.message) || err}`, "error");
  });

  client.on("close", () => {
    if (rideActive) setRideStatus("Disconnected from the relay — retrying…", "error");
  });

  rideClient = client;
}

// Publishes our current position (plus any extra fields, e.g. {sos: true})
// to our own subtopic under `topicRoot`. `extra` lets triggerSos() piggyback
// an SOS flag onto an otherwise-normal location update.
function publishMyRideLocation(topicRoot, extra) {
  if (!rideClient || !userLatLng) return;
  const payload = JSON.stringify({
    lat: userLatLng.lat,
    lon: userLatLng.lon,
    name: rideNameInput.value.trim().slice(0, 20) || "Rider",
    ts: Date.now(),
    ...extra,
  });
  rideClient.publish(`${topicRoot}/${myRiderId}`, payload, { qos: 0, retain: false });
}

// Tears down the MQTT connection, clears both publish/stale-check timers,
// removes every friend marker from the map, and resets the UI back to its
// "not sharing" state.
function stopRideTogether() {
  rideActive = false;
  activeRideTopicRoot = null;
  if (ridePublishTimer) clearInterval(ridePublishTimer);
  if (rideStaleTimer) clearInterval(rideStaleTimer);
  ridePublishTimer = null;
  rideStaleTimer = null;
  if (rideClient) {
    rideClient.end(true);
    rideClient = null;
  }
  rideFriends.forEach(({ marker }) => map.removeLayer(marker));
  rideFriends.clear();
  renderRideFriendsList();
  rideCodeInput.disabled = false;
  rideNameInput.disabled = false;
  rideToggleBtn.textContent = "🟢 Start Sharing";
  rideToggleBtn.classList.remove("active");
  setRideStatus("Not sharing.");
}

// Creates (on first sight of this rider) or updates (on every subsequent
// update) a friend's marker, name, and SOS flag, then re-renders the sidebar list.
function upsertRideFriend(riderId, data) {
  const name = (data.name || "Rider").toString().slice(0, 20);
  const isSos = !!data.sos;
  let friend = rideFriends.get(riderId);
  if (!friend) {
    const icon = L.divIcon({
      className: "",
      html: `<div class="friend-pin marker-drop-in">🏍️</div>`,
      iconSize: [26, 26],
      iconAnchor: [13, 13],
    });
    const marker = L.marker([data.lat, data.lon], { icon, zIndexOffset: 900 }).addTo(map);
    friend = { marker, name, lastSeen: Date.now(), lat: data.lat, lon: data.lon, stale: false, sos: isSos };
    rideFriends.set(riderId, friend);
  } else {
    friend.marker.setLatLng([data.lat, data.lon]);
    friend.name = name;
    friend.lastSeen = Date.now();
    friend.lat = data.lat;
    friend.lon = data.lon;
    if (isSos) friend.sos = true; // sticky until this rider stops sharing or a fresh non-SOS update supersedes it
    if (friend.stale) {
      friend.stale = false;
      const el = friend.marker.getElement();
      const pin = el && el.querySelector(".friend-pin");
      if (pin) pin.classList.remove("stale");
    }
  }
  const el = friend.marker.getElement();
  const pin = el && el.querySelector(".friend-pin");
  if (pin) pin.classList.toggle("sos", friend.sos); // turns the marker red + pulsing while an SOS is active
  friend.marker.bindPopup(
    `<b>${escapeHtml(name)}</b><div class="popup-meta">${friend.sos ? "🆘 Sent an SOS — " : ""}🏍️ Riding with you</div>`
  );
  renderRideFriendsList();
}

// Runs every 5s while sharing: marks a friend's marker "stale" (greyed out)
// once they've gone quiet for RIDE_STALE_MS, and removes them entirely after
// RIDE_GONE_MS — handles a friend losing signal or closing the app without
// us ever getting an explicit "they left" message (MQTT has none).
function refreshRideFriendStaleness() {
  const now = Date.now();
  let changed = false;
  [...rideFriends.entries()].forEach(([riderId, friend]) => {
    const age = now - friend.lastSeen;
    if (age > RIDE_GONE_MS) {
      map.removeLayer(friend.marker);
      rideFriends.delete(riderId);
      changed = true;
    } else if (age > RIDE_STALE_MS && !friend.stale) {
      friend.stale = true;
      const el = friend.marker.getElement();
      const pin = el && el.querySelector(".friend-pin");
      if (pin) pin.classList.add("stale");
      changed = true;
    }
  });
  if (changed) renderRideFriendsList();
}

// Rebuilds the "Ride Together" sidebar list from the current rideFriends map
// — one row per friend, showing distance from us and how long ago they last updated.
function renderRideFriendsList() {
  rideFriendsList.innerHTML = "";
  if (rideFriends.size === 0) {
    rideFriendsList.hidden = true;
    return;
  }
  rideFriendsList.hidden = false;
  rideFriends.forEach((friend) => {
    const li = document.createElement("li");
    li.className = "result-item ride-friend-item";
    const distText = userLatLng
      ? formatDistance(distanceMeters(userLatLng.lat, userLatLng.lon, friend.lat, friend.lon)) + " away"
      : "";
    const ago = Math.round((Date.now() - friend.lastSeen) / 1000);
    if (friend.sos) li.classList.add("ride-friend-sos");
    li.innerHTML = `
      <div class="r-title">${friend.sos ? "🆘" : "🏍️"} ${escapeHtml(friend.name)}${friend.stale ? " (stale)" : ""}${friend.sos ? " — SOS" : ""}</div>
      <div class="r-meta"><span class="r-meta-text">${distText} · updated ${ago}s ago</span></div>
    `;
    li.addEventListener("click", () => flyToSafe([friend.lat, friend.lon], 15, { duration: 1 }));
    rideFriendsList.appendChild(li);
  });
}

// Updates the "Ride Together" status line (connecting/sharing/error messages).
function setRideStatus(text, type) {
  rideStatus.textContent = text;
  rideStatus.className = "hint" + (type ? ` ${type}` : "");
}

// Disconnects cleanly from the MQTT broker if the tab is closing while sharing.
window.addEventListener("beforeunload", () => {
  if (rideClient) rideClient.end(true);
});

// ---------- Emergency SOS ----------
// No backend here either: SOS opens a prefilled WhatsApp message (with your
// live location) that YOU still tap Send on — same as a mailto:/tel: link,
// never an autonomous text. If Ride Together is active, it also flags your
// position as an SOS to whoever's sharing the same Ride Code.

// Restores a previously saved emergency contact (name/phone) from localStorage
// into the SOS panel's inputs, so it's remembered across reloads.
function loadSosContact() {
  try {
    sosNameInput.value = localStorage.getItem("ridestop_sos_name") || "";
    sosPhoneInput.value = localStorage.getItem("ridestop_sos_phone") || "";
  } catch (e) {
    // localStorage unavailable — the contact just won't persist across reloads
  }
}

// Persists the SOS contact fields to localStorage whenever either one loses
// focus with a new value (the "change" event), and shows a quick confirmation.
function saveSosContact() {
  try {
    localStorage.setItem("ridestop_sos_name", sosNameInput.value.trim());
    localStorage.setItem("ridestop_sos_phone", sosPhoneInput.value.trim());
    sosSaveStatus.textContent = "Saved.";
    sosSaveStatus.className = "hint success";
  } catch (e) {
    sosSaveStatus.textContent = "Could not save — this browser is blocking local storage.";
    sosSaveStatus.className = "hint error";
  }
}
sosNameInput.addEventListener("change", saveSosContact);
sosPhoneInput.addEventListener("change", saveSosContact);

sosBtn.addEventListener("click", () => triggerSos());

// The SOS flow: get a location (current one, or a fresh GPS fix if we don't
// have one yet), build a WhatsApp link pre-filled with a help message and a
// Google Maps link to that location, open it (the rider still taps Send
// themselves), and — if Ride Together is active — also broadcast an SOS
// flag to whoever's sharing the same Ride Code.
async function triggerSos() {
  let loc = userLatLng;
  if (!loc) {
    showSosToast("Finding your location…");
    loc = await new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve(null);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 8000 }
      );
    });
  }
  if (!loc) {
    showSosToast("⚠️ Couldn't get your location — set it first (My Location, search, or tap the map), then try SOS again.");
    return;
  }

  const mapsLink = `https://maps.google.com/?q=${loc.lat},${loc.lon}`;
  const message = `🆘 SOS! I need help.\nMy location: ${mapsLink}\nSent via RideStop.`;
  const phoneDigits = sosPhoneInput.value.replace(/[^\d]/g, ""); // wa.me wants digits only (country code + number, no "+")
  const waUrl = `https://wa.me/${phoneDigits}?text=${encodeURIComponent(message)}`;
  window.open(waUrl, "_blank", "noopener");

  if (rideActive && activeRideTopicRoot) {
    publishMyRideLocation(activeRideTopicRoot, { sos: true });
  }

  const contactLabel = sosNameInput.value.trim() || (phoneDigits ? "your emergency contact" : "a WhatsApp contact you pick");
  showSosToast(
    `🆘 WhatsApp opened with your location, ready to send to ${contactLabel}.` +
      (rideActive ? " Your riding buddy has also been alerted." : "")
  );
}

// Shows a temporary status message over the map (e.g. SOS confirmations/errors),
// auto-hiding after 8 seconds; a new call resets that timer.
let sosToastTimer = null;
function showSosToast(text) {
  sosToast.textContent = text;
  sosToast.hidden = false;
  clearTimeout(sosToastTimer);
  sosToastTimer = setTimeout(() => {
    sosToast.hidden = true;
  }, 8000);
}

// ---------- Sidebar tabs ----------
// Splits the sidebar into Explore / Routes / Safety screens (see the
// "Sidebar tabs" CSS section) so the full feature set doesn't read as one
// long scrolling stack of 8 panels. Switching tabs only changes which
// <div class="sidebar-panels"> is visible — nothing about the panels'
// own ids, state, or event listeners changes, so every feature keeps
// working exactly the same regardless of which tab it's currently on.
sidebarTabs.addEventListener("click", (e) => {
  const btn = e.target.closest(".sidebar-tab-btn");
  if (!btn) return;
  switchSidebarTab(btn.dataset.tab);
});

function switchSidebarTab(tabName) {
  Object.entries(sidebarTabPanels).forEach(([name, el]) => {
    el.hidden = name !== tabName;
  });
  pilotModeActive = tabName === "pilot";
  let activeBtn = null;
  [...sidebarTabs.querySelectorAll(".sidebar-tab-btn")].forEach((btn) => {
    const isActive = btn.dataset.tab === tabName;
    btn.classList.toggle("active", isActive);
    if (isActive) activeBtn = btn;
  });
  if (activeBtn) updateSidebarTabIndicator(activeBtn);
}

// Moves the sliding highlight pill to sit exactly behind `btn` — reads the
// button's own position/width (offsetLeft/offsetWidth) and writes them as
// the indicator's left/width, so it lines up no matter the label's length.
// The actual sliding motion is a CSS transition on those two properties
// (see .sidebar-tab-indicator in style.css); this function only decides
// where it should end up.
function updateSidebarTabIndicator(btn) {
  sidebarTabIndicator.style.left = `${btn.offsetLeft}px`;
  sidebarTabIndicator.style.width = `${btn.offsetWidth}px`;
}

// ---------- Walking Access Pilot (Experiential Learning assignment bonus) ----------
// A live walking-time analysis over a real pgRouting network, scoped to
// the Kothrud, Pune study area only -- built for the WebGIS Experiential
// Learning assignment's bonus challenge, reusing the same PostGIS data
// this project's analysis/ scripts loaded. Needs the project's own
// docker-compose stack running locally (pg_featureserv on :9000, the
// routing API on :8020) -- it does not call Overpass/OSRM like the rest
// of RideStop, so it only works for this one pilot area, not India-wide.
const PILOT_FEATURESERV = "http://localhost:9000";
const PILOT_ROUTING_API = "http://localhost:8020";
const PILOT_WALK_SPEED_M_PER_MIN = 80; // 4.8 km/h, same assumption the assignment uses throughout

pilotMinutesSlider.addEventListener("input", () => {
  pilotMinutesValue.textContent = `${pilotMinutesSlider.value} min`;
});

// Loads the coverage-hexagon and healthcare-services layers once, on
// request rather than automatically -- both are small (59 hexagons, 151
// services) so there's no real performance reason to lazy-load them, but
// requiring a tap keeps the pilot's "this needs the local stack running"
// dependency visible rather than silently failing on page load for
// anyone who opens RideStop without that stack up.
pilotLoadLayersBtn.addEventListener("click", async () => {
  pilotLayersStatus.textContent = "Loading…";
  try {
    const [hexRes, servicesRes] = await Promise.all([
      fetch(`${PILOT_FEATURESERV}/collections/public.hex_coverage_res9/items.json?limit=1000`),
      fetch(`${PILOT_FEATURESERV}/collections/public.services/items.json?limit=1000`),
    ]);
    const [hexGeojson, servicesGeojson] = await Promise.all([hexRes.json(), servicesRes.json()]);

    if (pilotHexLayer) map.removeLayer(pilotHexLayer);
    pilotHexLayer = L.geoJSON(hexGeojson, {
      style: (feature) => {
        const d = feature.properties.network_dist_m;
        const color = d < 600 ? "#2ca25f" : d < 1200 ? "#fdae61" : "#d73027";
        return { color, weight: 1, fillColor: color, fillOpacity: 0.35 };
      },
    }).addTo(map);

    if (pilotServicesLayer) map.removeLayer(pilotServicesLayer);
    pilotServicesLayer = L.geoJSON(servicesGeojson, {
      pointToLayer: (feature, latlng) =>
        L.circleMarker(latlng, { radius: 5, color: "#fff", weight: 1, fillColor: "#08519c", fillOpacity: 1 }),
      onEachFeature: (feature, layer) => {
        const p = feature.properties;
        layer.bindPopup(`<b>${escapeHtml(p.name || "(unnamed)")}</b><br>${escapeHtml(p.amenity || p.healthcare || "")}`);
      },
    }).addTo(map);

    pilotLayersStatus.textContent = `Loaded ${hexGeojson.features.length} coverage cells, ${servicesGeojson.features.length} services.`;
  } catch (e) {
    pilotLayersStatus.textContent = `Couldn't load (is the local stack running on :9000?): ${e.message}`;
  }
});

// Click handler (wired from initMap()'s map click listener, when the
// Access tab is active): draws the walking isochrone for the clicked point.
async function runPilotIsochrone(latlng) {
  pilotIsochroneStatus.textContent = "Loading isochrone…";
  const minutes = pilotMinutesSlider.value;
  try {
    const res = await fetch(`${PILOT_ROUTING_API}/isochrone?lon=${latlng.lng}&lat=${latlng.lat}&minutes=${minutes}`);
    if (!res.ok) throw new Error(`API returned ${res.status}`);
    const feature = await res.json();

    if (pilotIsochroneLayer) map.removeLayer(pilotIsochroneLayer);
    pilotIsochroneLayer = L.geoJSON(feature, {
      style: { color: "#3182bd", weight: 2, fillColor: "#3182bd", fillOpacity: 0.2 },
    }).addTo(map);

    const areaKm2 = (feature.properties.area_m2 / 1e6).toFixed(2);
    pilotIsochroneStatus.textContent =
      `${feature.properties.reached_nodes} nodes reached, ${areaKm2} km² ` +
      `(${feature._timing.db_ms}ms db)`;
  } catch (e) {
    pilotIsochroneStatus.textContent = `Couldn't load isochrone (is the local stack running on :8020?): ${e.message}`;
  }
}

// Click handler counterpart: lists the 5 nearest healthcare services by
// real walking time from the clicked point.
async function runPilotNearest(latlng) {
  try {
    const res = await fetch(`${PILOT_ROUTING_API}/nearest?lon=${latlng.lng}&lat=${latlng.lat}&k=5`);
    if (!res.ok) throw new Error(`API returned ${res.status}`);
    const data = await res.json();
    pilotNearestList.innerHTML = data.results
      .map((s) => `<li>${escapeHtml(s.name)} — ${s.minutes} min (${formatDistance(s.distance_m)})</li>`)
      .join("");
  } catch (e) {
    pilotNearestList.innerHTML = `<li class="hint">${escapeHtml(e.message)}</li>`;
  }
}

// ---------- Bootstrap ----------
// Runs once on page load: builds the map and category chips, restores a
// saved SOS contact and any Ride Together invite code, then either
// restores a full session from a shared link (?lat=&lon=&cats=) or falls
// back to asking for the rider's current location.
function init() {
  initMap();
  renderCategoryChips();
  loadSosContact();
  restoreRideCodeFromUrl();
  updateSidebarTabIndicator(sidebarTabs.querySelector(".sidebar-tab-btn.active")); // place the pill behind "Explore" on first load
  // A shared link takes priority over auto-locating the visitor.
  if (!restoreFromUrl()) {
    locateMe();
  }
}
init();
