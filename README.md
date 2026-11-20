# WebGIS Assignment: From Nearby Services to a Deployed Map Service

**Public URL:** _not yet deployed — Phase 5 (GitHub Pages + PMTiles) is still pending. Will be added here once live._

Builds on the earlier nearby-services project — kept unmodified at
[`legacy/nearby-services-gis.html`](legacy/nearby-services-gis.html), a
single-file Leaflet + Overpass app — rebuilding it into a provider/analyst
Web GIS backed by PostGIS, GeoServer, pg_tileserv and pg_featureserv —
answering: which residents of the study area cannot reach the service on
foot within a reasonable time, and why?

**This one repository is both**: the earlier nearby-services project
(preserved as-is in `legacy/`, for the Q3/Q6/Q9 comparisons that need it
untouched) **and** this assignment's new backend/analysis work. There is
no separate repo for the old project — this is the single thing to
submit.

- **Area:** _registration pending — see "Open decisions" below._
- **Service type:** Healthcare (`amenity=hospital`, `amenity=clinic`,
  `amenity=doctors`), carried over from the `hospital` category in the
  earlier nearby-services project for a valid Q3/Q6/Q9 comparison.
- **Walking threshold:** 15 minutes (1.2 km) — urban ward, per the brief's
  "urban vs rural" rule.
- **UTM zone:** _to be finalized once the exact ward is registered
  (Pune falls in UTM zone 43N, EPSG:32643 — confirm against the final
  area's centroid longitude)._

## Setup

Everything runs through Docker Compose: PostGIS, GeoServer, pg_tileserv,
and pg_featureserv on one network.

```bash
cp .env.example .env     # edit if you want non-default credentials
docker compose up -d
```

Services, once up:
- PostGIS: `localhost:5432` (db/user/password from `.env`)
- GeoServer admin: `http://localhost:8081/geoserver/web/` (note: **8081**, not
  8080 — this machine already runs a native GeoServer install on 8080, so
  the container is remapped to avoid the conflict; see debugging log)
- pg_tileserv: `http://localhost:7800/`
- pg_featureserv: `http://localhost:9000/`

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

**Separate, smaller issue:** GeoServer's container then failed to bind
port 8080 (`ports are not available: ... bind: Only one usage of each
socket address ... is normally permitted`) because a native GeoServer
install (from `GeoServer-2.28.2-winsetup.exe`) was already listening on
8080. Fixed by remapping the container's host port to 8081 in
`docker-compose.yml`, leaving the native install untouched.

## Open decisions (need your input before Phase 1 can start for real)

1. **Exact study area.** Needs to be a specific Pune ward or a few wards
   (not all of Pune — too large per the brief's rule 3), with ≥15
   healthcare features in OpenStreetMap, registered on the class sheet
   first (first-come-first-served). Kothrud was used as an example
   earlier in this session and does have dense OSM healthcare data, but
   this is not yet registered or confirmed as the final choice.
2. **Registration itself** — area, area type, service type, OSM feature
   count, and the earlier project's repo link need to go on the
   instructor's class sheet before any evidence work begins; this can't
   be done by anyone other than you.
3. Once the area is locked in, `PUNE`-style constants, the UTM zone, and
   all of Phases 1–5 can proceed for real against it.
