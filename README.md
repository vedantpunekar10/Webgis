# WebGIS Assignment: From Nearby Services to a Deployed Map Service

**Public URL:** _GitHub Actions workflow is written and committed
(`.github/workflows/deploy-pages.yml`); the live URL depends on GitHub
Pages being enabled in this repo's Settings → Pages, which only the repo
owner can do. Update this line once that's done and the first deploy
completes._

Builds on **RideStop** — the pre-existing rider-focused nearby-services
Web GIS in this same repo (`index.html` / `style.css` / `script.js`; see
[`README_RIDESTOP.md`](README_RIDESTOP.md) for that app's own
documentation) — rebuilding it into a provider/analyst Web GIS backed by
PostGIS (+ pgRouting), GeoServer, pg_tileserv and pg_featureserv — answering: which
residents of the study area cannot reach the service on foot within a
reasonable time, and why?

**This one repository is both**: RideStop itself (the earlier
nearby-services project, kept unmodified for the Q3/Q6/Q9 comparisons
that need it untouched) **and** this assignment's new backend/analysis
work. There is no separate repo for the old project — this is the single
thing to submit.

- **Area:** Kothrud, Pune — a 2.4km study-area box centered on
  (18.5073, 73.8057). No clean OSM administrative boundary exists for
  this neighborhood, so the box was built per the brief's own fallback
  guidance (rule 3). **Class-sheet registration is still something only
  you can do** — this is the area actually used throughout Q1–Q12, so
  register it as-is unless you need to pick something else.
- **Service type:** Healthcare (`amenity=hospital`, `amenity=clinic`,
  `amenity=doctors`, `healthcare=*`), carried over from RideStop's own
  `hospital` category (`CATEGORIES` in `script.js`) for a valid Q3/Q6/Q9
  comparison. 151 real features found (well above the 15 minimum).
- **Walking threshold:** 15 minutes (1.2 km) — urban ward, per the brief's
  "urban vs rural" rule.
- **UTM zone:** EPSG:32643 (UTM 43N) — correct for Kothrud's longitude (73.8°E).

## Setup

Everything runs through Docker Compose: PostGIS, GeoServer, pg_tileserv,
and pg_featureserv on one network.

```bash
cp .env.example .env     # edit if you want non-default credentials
docker compose up -d
```

Services, once up:
- PostGIS: `localhost:5433` (db/user/password from `.env`; remapped from
  the default 5432 — see debugging log)
- GeoServer admin: `http://localhost:8081/geoserver/web/` (note: **8081**, not
  8080 — this machine already runs a native GeoServer install on 8080, so
  the container is remapped to avoid the conflict; see debugging log)
- pg_tileserv: `http://localhost:7800/`
- pg_featureserv: `http://localhost:9000/`
- Bonus routing API (FastAPI + pgRouting): `http://localhost:8020/`
  (`/isochrone`, `/nearest`, `/health`)

RideStop itself (the baseline app) is static and needs no server beyond
any plain static file host — see [`README_RIDESTOP.md`](README_RIDESTOP.md).

Verified working end-to-end on 2026-11-20: `docker compose ps` shows all
four containers healthy, `SELECT PostGIS_Version()` returns `3.4`,
pg_tileserv and pg_featureserv both return HTTP 200 on their root paths,
and the GeoServer admin UI loads with WMS 1.3.0/1.1.1, WFS 2.0.0/1.1.0/1.0.0,
WCS 2.0.1, and WPS 1.0.0 all listed. Evidence: `study/evidence/`.

## Sources / tools used

- Docker Compose service images: `postgis/postgis:16-3.4`,
  `kartoza/geoserver:2.24.0`, `pramsey/pg_tileserv:latest`,
  `pramsey/pg_featureserv:latest` (all official/maintainer images from Docker Hub).
- Docker Desktop release notes (docs.docker.com/desktop/release-notes/) —
  used to diagnose the startup crash below.
- Course brief: "WebGIS Assignment: From Nearby Services to a Deployed Map Service."

## Debugging log

**What broke:** Docker Desktop crashed on every single launch attempt with:

```
starting services: initializing Ingest server: listening on
unix://.../AppData/Local/Docker/run/sailor-ingest.sock: rename
.../sailor-ingest.sock .../sailor-ingest.sock.stale: The file cannot be
accessed by the system. (listener: The file cannot be accessed by the system.)
```

and, after a first partial fix, the same error on a second file:
`.../AppData/Local/docker-secrets-engine/engine.sock`.

**What we tried, in order, each verified to not be the cause:** removing
the individual stale socket files (blocked — they were broken symlink
reparse points Windows itself refused to touch); renaming the *parent*
folders instead (worked, but the crash recurred on a fresh file moments
later); `wsl --shutdown`; a full OS reboot; adding Windows Defender
folder exclusions for every Docker path. None of these stopped the crash
— which ruled out "stale leftover lock," "stuck WSL state," and
"antivirus interference" as the actual cause.

**Root cause:** the installed Docker Desktop version (4.89.0) was several
releases behind current. Docker's own 4.99.0 release notes list, under
"For Windows": *"Fixed an issue where Docker Desktop could shut down
ungracefully, causing resource leaks or a corrupted state."* That's
exactly this symptom.

**Fix:** downloaded and installed the current Docker Desktop installer
(updated to 4.99.0). First launch afterward came up clean with no crash.

**Separate, smaller issues — two real port conflicts:** GeoServer's
container failed to bind port 8080 because a native GeoServer install
(from `GeoServer-2.28.2-winsetup.exe`) was already listening there;
PostGIS's container failed to authenticate over its mapped port because a
native PostgreSQL install (from `postgis_3_5_pg17.exe`) was already
listening on 5432 and intercepting the connection. Both fixed by
remapping the containers' host ports (8081, 5433) in `docker-compose.yml`,
leaving both native installs untouched.

**A third issue, while building the static PMTiles client:** Python's
stdlib `http.server` doesn't support HTTP Range requests at all, which
`pmtiles.js` needs — discovered by watching it fail locally with an
explicit "check your storage backend supports HTTP Byte Serving" error.
Fixed by writing a small custom range-serving test server
(`client/range_server.py`) to confirm the real mechanics before trusting
GitHub Pages' own CDN to do the same.

**A recurring fragility, seen twice:** `pg_featureserv` crashes outright
(`write: broken pipe`, exit 1) whenever `postgis` is recreated out from
under it (once for the port fix, again when swapping to the
pgRouting-bundled image for the bonus) — it doesn't retry its database
connection. Fixed the same way both times: `docker compose up -d
pg_featureserv`. Worth knowing if a fresh `docker compose up` ever leaves
it in `Exited (1)`.

## Open items (need your action — not something I can do from here)

1. **Class-sheet registration** — area (Kothrud), service type
   (Healthcare), OSM feature count (151), and this repo's link still need
   to go on the instructor's class sheet; only you have access to it.
2. **Enable GitHub Pages** in this repo's Settings → Pages, so the
   already-committed deployment workflow actually publishes somewhere,
   and the public URL at the top of this file can be filled in.
3. **Q12's 5-service second-source spot-check** (Q3 as well) needs real
   local verification — a site visit, call, or an authoritative Pune
   healthcare directory — that isn't something to fabricate remotely.

**Bonus (B1–B3) is done** — see the "Bonus challenge" section at the end
of `ANSWERS.md`. A real pgRouting-backed FastAPI (`api/`, added as the
`routing_api` service in `docker-compose.yml`) serves live
`/isochrone` and `/nearest` endpoints, wired into the MapLibre client
(`client/index-local.html`) with a click handler and a minutes slider,
verified working live. B1 found and fixed a genuine 550× latency
regression (a duplicated, expensive `ST_ConcaveHull` call); B2
cross-validated pgRouting against the OSMnx results from Q6 and traced
the one real >10% discrepancy to its exact cause (a service-to-node
snapping difference between two scripts, not a routing disagreement); B3
compares four hull methods with a real visual.
