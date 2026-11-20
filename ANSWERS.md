# ANSWERS.md

**Area:** Kothrud, Pune (class-sheet registration still pending — see README "Open items").
**Area type:** Ward(s) within a large metro (Pune) — per brief rule 3, not
the whole city.
**Service type:** Healthcare (`amenity=hospital`, `amenity=clinic`,
`amenity=doctors`, `healthcare=*`), carried over from the `hospital`
category used in the earlier nearby-services project.
**UTM zone:** Pune falls in UTM zone 43N (EPSG:32643) — to be confirmed
against the exact registered area's centroid longitude.
**Walking threshold:** 15 minutes (1.2 km), urban-area rule, walking speed
4.8 km/h.

Every answer below needs: the exact URL or SQL, the raw output (or its
key lines), a screenshot where asked, and 2–4 sentences of explanation.
**Nothing below is filled in with real numbers yet** — that requires the
registered study area, the downloaded OSM data, and a live PostGIS/GeoServer
stack to query against. The stack itself is proven working (see README,
`study/evidence/`); this file is the structure to fill in once the area
is locked in.

---

## Phase 1 — From API data to your own database

### Q1. One area, four areas

SQL: [`sql/q1_one_area_four_areas.sql`](sql/q1_one_area_four_areas.sql), run against the live `study_area` table (the Kothrud study area, a 2.4km box — see README/open-decisions):

```sql
SELECT
  ST_Area(geometry) AS area_sqdeg_4326,
  ST_Area(geometry::geography) AS area_sqm_geography,
  (SELECT ST_Area(geometry) FROM study_area_utm) AS area_sqm_utm43n,
  ST_Area(ST_Transform(geometry, 3857)) AS area_sqm_3857
FROM study_area;
```

Raw output:

```
    area_sqdeg_4326    | area_sqm_geography | area_sqm_utm43n  |   area_sqm_3857
-----------------------+--------------------+------------------+-------------------
 0.0004930031600889875 |  5762345.014056332 | 5759999.99999979 | 6442493.141004089
```

| CRS | Area | Unit |
|---|---|---|
| EPSG:4326 (plain geometry) | 0.000493 | square **degrees** — not a real-world unit |
| EPSG:4326 (`::geography`, geodetic) | 5,762,345.01 | m² |
| UTM 43N (EPSG:32643) | 5,760,000.00 | m² |
| Web Mercator (EPSG:3857) | 6,442,493.14 | m² |

Ratio check (second query in the same SQL file):

```
observed_ratio (3857/UTM) = 1.118488392535473
theoretical_ratio 1/cos²(lat) = 1.1120483602671556
centroid_lat = 18.50726168005917
```

**Explanation.** The UTM and geodetic (`::geography`) areas agree almost
exactly (within 0.04%) — expected, since UTM zone 43N's central meridian
sits close to this study area's longitude, so distortion there is
minimal, and the geography type computes true geodetic area directly.
The plain-4326 area is in square degrees and has no direct real-world
meaning (a degree of longitude covers less ground the further from the
equator you are). The observed 3857/UTM ratio (1.1185) is close to but
not identical to the textbook point formula 1/cos²(latitude) (1.1120) —
the ~0.6% gap is because the textbook formula is the *local* inflation
factor at one exact latitude, while the actual polygon area integrates
Mercator's inflation continuously across the box's full north–south
extent (roughly 18.496°–18.518°), and that inflation increases with
latitude, so the area-weighted average differs slightly from a single
centroid-point estimate.

**Which CRS did the earlier project measure distance in?** Checked
RideStop's actual code (`script.js`, `distanceMeters()` function): it
computes great-circle distance directly on raw EPSG:4326 (WGS84) lat/lon
coordinates using the haversine formula with a fixed Earth radius of
6,371,000m (`const R = 6371000`). It never reprojects to UTM or Web
Mercator — this is functionally equivalent to PostGIS's `::geography`
distance calculation, not a projected CRS at all.

### Q2. Indexes and query plans

SQL: [`sql/q2_indexes_and_query_plans.sql`](sql/q2_indexes_and_query_plans.sql).
One honest wrinkle worth stating up front: GeoPandas' `to_postgis()` (via
geoalchemy2) auto-creates a GiST index on the geometry column by default
— both `services_utm` and `buildings_utm` already had one before any
`CREATE INDEX` of mine ran. To get a genuinely clean "no index" baseline,
I explicitly dropped `buildings_utm`'s auto-created index first (leaving
`services_utm`'s auto-index in place, which is why the "before" plan below
still shows an index scan — just on the other table).

**Before** (no index on `buildings_utm.geometry`):
```sql
EXPLAIN ANALYZE
SELECT s.osmid, count(b.osmid)
FROM services_utm s JOIN buildings_utm b ON ST_DWithin(s.geometry, b.geometry, 500)
GROUP BY s.osmid;
```
```
 GroupAggregate (actual time=172.751..183.942 rows=151 loops=1)
   ->  Sort (actual time=172.672..178.453 rows=102845 loops=1)
         ->  Nested Loop (actual time=7.702..131.701 rows=102845 loops=1)
               ->  Seq Scan on buildings_utm b (actual time=0.007..1.425 rows=20132 loops=1)
               ->  Index Scan using idx_services_utm_geometry on services_utm s (loops=20132)
 Execution Time: 195.384 ms
```
Scan node: **Seq Scan** on `buildings_utm` (the table with no index) joined
via Nested Loop to an indexed scan on the other side.

**After** (`CREATE INDEX buildings_utm_geom_gist ON buildings_utm USING GIST (geometry)`):
```
 HashAggregate (actual time=71.848..71.861 rows=151 loops=1)
   ->  Nested Loop (actual time=0.078..61.945 rows=102845 loops=1)
         ->  Seq Scan on services_utm s (rows=151 loops=1)
         ->  Index Scan using buildings_utm_geom_gist on buildings_utm b
               Index Cond: (geometry && st_expand(s.geometry, '500'))
               Filter: st_dwithin(s.geometry, geometry, '500')
 Execution Time: 71.893 ms
```
Scan node: **Index Scan** on `buildings_utm` (now indexed) — 20,132-row
table is indexed, 151-row `services_utm` is seq-scanned as the outer loop
(the planner correctly puts the small table on the outer loop and uses
the index to look up matches in the big one). **~2.7× faster** (195ms → 72ms).

**Rewritten as `ST_Distance(a,b) < 500`, index still present:**
```
 GroupAggregate (actual time=1006.584..1017.346 rows=151 loops=1)
   ->  Nested Loop (actual time=116.410..961.256 rows=102845 loops=1)
         Join Filter: (st_distance(s.geometry, b.geometry) < '500')
         Rows Removed by Join Filter: 2937087
         ->  Seq Scan on buildings_utm b (rows=20132 loops=1)
         ->  Materialize ->  Seq Scan on services_utm s (rows=151 loops=1)
 Execution Time: 1018.326 ms
```
Scan node: **Seq Scan** on both tables, full Nested Loop — the GiST index
is completely unused despite still existing. **~14× slower** than the
indexed `ST_DWithin` version (1018ms vs 72ms), and it computed
`st_distance()` on nearly 3 million row-pairs (`Rows Removed by Join
Filter: 2937087`) instead of a few hundred.

**Why the plan changes:** a GiST index only accelerates the `&&`
(bounding-box overlap) operator. `ST_DWithin(a, b, d)` is specifically
written to internally expand one geometry's bounding box by `d` and test
`&&` first — so the planner can use the index as a cheap pre-filter
before running the exact distance check on a small candidate set. A bare
`ST_Distance(a, b) < d` expression is just a scalar function call
compared to a number — nothing in that expression tells the planner it
can be answered via the box-overlap operator, so it has no choice but to
evaluate the function on every row pair in a full nested loop.

### Q3. Data quality vs your earlier source

SQL: [`sql/q3_data_quality.sql`](sql/q3_data_quality.sql).

**No-name share:**
```
 no_name | total | pct_no_name
---------+-------+-------------
       7 |   151 |         4.6
```
7 of 151 services (4.6%) have no `name` tag.

**Pairs within 25m** (a true spatial self-join on `ST_DWithin`, not a
same-name proxy):
```
 pairs_within_25m
------------------
               16
```
Listing them out shows two genuinely different situations, not one
uniform "duplicate" problem:
- **Likely the same real-world place mapped twice** — e.g. "Vinayak
  Hospital warje pune" and "Vinayak Hospital, Warje" 2.9m apart, or "Dr
  Sunny Dole | Kothrud Orthopedic Clinic" and "Dr Sunny Dole" 4.3m apart.
- **Likely genuinely distinct clinics sharing one building/complex
  entrance point** — e.g. "MyGyne Clinic" and "DR. UPLENCHWAR'S WOMENS &
  EYE CARE CLINIC" only 0.3m apart (two different specialities, plausibly
  two different practices in the same building, both mapped at the
  building's single entrance node).

So "16 pairs within 25m" overstates true duplication — a closer per-pair
read suggests roughly half are probably real duplicate mappings and half
are distinct co-located services, which matters for anyone using this
count as a straightforward data-quality defect tally.

**Comparison with the earlier project's data for the same area:**
RideStop (`script.js`, `CATEGORIES`) defines its `hospital` category
narrowly as `amenity=hospital` only. Re-querying with that exact narrower
definition against the same loaded data:
```
 earlier_project_tag_definition_count | this_assignment_full_healthcare_count
---------------------------------------+----------------------------------------
                                    53 |                                    151
```
This assignment's Healthcare service type is much broader (adds
`amenity=clinic`, `amenity=doctors`, and `healthcare=*`), which accounts
for the full 98-feature gap — not a difference in data quality, but in
how much of OSM's healthcare tagging each project chooses to count. A
rider using RideStop to find "the nearest hospital" would only ever see
53 of these 151 real healthcare features — the other 98 (clinics,
individual doctors, and anything tagged generically `healthcare=*`)
are invisible to that app by design, not by data gap.

**5-service spot-check against a second source (site visit, official
list, or street imagery):** honestly **not done** — this needs real local
verification (visiting, calling, or checking an authoritative Pune
healthcare directory) that isn't something to fabricate from here. Five
reasonable candidates to check first, picked from the near-duplicate
list above since they're the most likely to have gone stale: "Vinayak
Hospital warje pune" (osmid 5364499), "Dr Sunny Dole | Kothrud Orthopedic
Clinic" (13450231252), "Khenat Hospital and Maternity Home" (7079392124),
"Sushrut Hospital" (11651983008), and "Jog Hospital" (229849146).

## Phase 2 — Publish your own OGC services

### Q4. The axis-order trap

Published the `services` table as a GeoServer layer (`webgis:services`)
via the REST API. From its WMS 1.3.0 GetCapabilities
(`http://localhost:8081/geoserver/webgis/wms?service=WMS&version=1.3.0&request=GetCapabilities`):

```xml
<BoundingBox CRS="CRS:84" minx="73.77655792236328" miny="18.479516983032227" maxx="73.83538055419922" maxy="18.530820846557617"/>
<BoundingBox CRS="EPSG:4326" minx="18.479516983032227" miny="73.77655792236328" maxx="18.530820846557617" maxy="73.83538055419922"/>
```

Notice: the **same real-world box** is reported twice, with the min/max
values swapped between `minx`/`miny` depending on CRS — `CRS:84` keeps
(lon, lat) order; `EPSG:4326` reports (lat, lon) order, exactly per the
standard.

Sent the identical four raw numbers (`73.77655792236328,18.479516983032227,73.83538055419922,18.530820846557617`)
as `BBOX` to both:

- `http://localhost:8081/geoserver/webgis/wms?service=WMS&version=1.1.1&request=GetMap&layers=webgis:services&srs=EPSG:4326&bbox=<same4numbers>&width=600&height=600&format=image/png` → HTTP 200, 13,016 bytes
- `http://localhost:8081/geoserver/webgis/wms?service=WMS&version=1.3.0&request=GetMap&layers=webgis:services&crs=EPSG:4326&bbox=<same4numbers>&width=600&height=600&format=image/png` → HTTP 200, 5,819 bytes

Screenshots: [`study/evidence/q4_wms_1.1.1.png`](study/evidence/q4_wms_1.1.1.png)
(all 151 service points render correctly, scattered across the study
area) vs [`study/evidence/q4_wms_1.3.0.png`](study/evidence/q4_wms_1.3.0.png)
(**completely blank**).

**Explanation.** 1.1.1 always treats EPSG:4326 BBOX as (lon, lat, lon,
lat), matching how these numbers were written, so it renders the correct
area. 1.3.0 follows the CRS authority's own defined axis order for
EPSG:4326, which is (lat, lon) — so it reads the same four numbers as
"latitude between 73.78 and 73.84," which is outside the valid ±90°
latitude range entirely. GeoServer doesn't error on this; it just finds
nothing to render there and returns a blank (but still 200 OK, smaller
file) image — which is exactly why this bug is dangerous in practice: a
silently blank map, not a loud error.

### Q5. WFS with a filter, two formats

URL (GeoJSON; swap `outputFormat` for `gml32` to get the GML version):
```
http://localhost:8081/geoserver/webgis/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=webgis:services&CQL_FILTER=name%20IS%20NOT%20NULL&outputFormat=application/json
```

`numberMatched="144"` in both formats (matches 151 total − 7 with no
name, from Q3).

| Format | File | Size | First point's coordinate order |
|---|---|---|---|
| GeoJSON | `study/evidence/q5_named_services.geojson` | 47,325 bytes (46.2 KB) | `[73.8058, 18.5075]` — **(lon, lat)** |
| GML 3.2 | `study/evidence/q5_named_services.gml` | 108,205 bytes (105.7 KB) | `<gml:pos>18.5075 73.8058</gml:pos>` — **(lat, lon)** |

GML is more than **2.3× larger** than GeoJSON for the identical 144
features — GML's verbose XML element structure (open/close tags per
coordinate, per property) costs real bytes compared to GeoJSON's compact
array-based structure.

**Same axis-order story as Q4, in a different format:** GeoJSON (per
RFC 7946) always fixes coordinate order as (longitude, latitude)
regardless of CRS; GML 3.2 instead follows the CRS's own authority-defined
axis order for EPSG:4326 — (latitude, longitude) — exactly the same rule
that caused the WMS 1.3.0 blank-map result in Q4. Any client parsing GML
coordinates by assuming "x then y = lon then lat" (a very natural but
wrong assumption carried over from GeoJSON habits) would silently plot
every point at the wrong location.

## Phase 3 — Was your earlier "nearest" right?

### Q6. Straight line vs street network

Script: [`analysis/q6_straight_vs_network.py`](analysis/q6_straight_vs_network.py),
full results: [`analysis/q6_results.csv`](analysis/q6_results.csv). 30
random points inside the study area (seeded for reproducibility), nearest
service found two ways: straight-line (`geopandas` distance) and network
(Dijkstra shortest path over the downloaded walking graph, 5,387
nodes/13,578 edges).

```
Different nearest service in 17 / 30 cases
Median ratio (network/straight-line): 1.335
Max ratio: 3.24 at point 5
```

**17 of 30 points (57%)** got a *different* nearest service once actual
streets were accounted for — straight-line "nearest" is wrong more often
than right, here. Network distance is a median **33% longer** than
straight-line for the same point, and the worst case is **3.24× longer**.

**Worst case (point 5):** at (18.5073, 73.7993), straight-line nearest is
City Hospital at 53.1m, but the network path to it is 171.9m — because
City Hospital sits across **Paud Road**, visually confirmed via
OpenStreetMap as a wide, divided arterial road right at that location
(screenshot not saved due to time, but reproducible at
`openstreetmap.org/#map=17/18.5073/73.7985`). A straight line crosses
Paud Road directly; a real pedestrian has to walk to a crossing point,
which the network path correctly captures and a straight-line buffer
completely misses.

One data quality note worth flagging honestly: point 18 shows a network
distance of exactly 0.0m (vs 81.8m straight-line) — an artifact of the
point's nearest-network-node happening to coincide with the service's own
nearest-network-node after OSMnx's node-snapping, not a real zero-distance
result. Left in the CSV rather than quietly dropped, since it's a
genuine, explainable edge case rather than a data error.

### Q7. Coverage and the MAUP

Script: [`analysis/q7_coverage_maup.py`](analysis/q7_coverage_maup.py),
full cell data: `analysis/q7_h3_res8.csv` / `q7_h3_res9.csv`. WorldPop
wasn't available offline in the time I had, so population is proxied by
summed building-footprint area per cell (m²), exactly as the brief
allows — stated here, as required.

```
=== Resolution 8 (8 cells) ===
  % pop beyond threshold (network):   0.0%
  % pop beyond threshold (straight):  0.0%
  worst-served populated cell: 8860885097fffff (network_dist=1196m)

=== Resolution 9 (59 cells) ===
  % pop beyond threshold (network):   6.4%
  % pop beyond threshold (straight):  0.0%
  worst-served populated cell: 896088509b7ffff (network_dist=1531m, pop_proxy=25431 m²)
```

**Does the conclusion change? Yes, dramatically — this is MAUP in
action on real data.** At the coarse resolution 8 (8 cells, each one
covering a large chunk of the study area), every cell's centre is within
reach and the conclusion is "100% covered." At the finer resolution 9 (59
smaller cells), the exact same underlying network distances reveal that
6.4% of the (proxy) population sits in cells whose centre is beyond the
1.2km threshold — a real coverage gap that simply isn't visible at the
coarser aggregation, purely because of where the res-8 cell boundaries
happened to fall relative to it.

**Straight-line buffer reports 0.0% at both resolutions** — it never
finds a gap at all, because (per Q6) it systematically underestimates
real walking distance. The network/straight-line split and the
res8/res9 split are two independent reasons the "same" coverage question
can get a different answer, and both show up clearly here.

**Ward/pincode/village aggregation:** not done — this study area is a
single Kothrud-sized box with no sub-ward administrative boundaries
available to aggregate by (the brief's own fallback for exactly this
situation — "for a taluka, aggregate by village instead" — doesn't quite
apply either, since this is an urban ward-scale area, not a taluka). The
H3 resolution 8 vs 9 comparison above already demonstrates the MAUP point
the question is after.

**Worst-served populated cell:** `896088509b7ffff` (H3 res 9), 1,531m
network distance to the nearest healthcare service — 331m past the 1.2km
threshold.

### Q8. Who is the model for?

Same network-distance data as Q7, re-thresholded: 3.6 km/h → 900m in 15
minutes (vs 1.2km at 4.8 km/h).

```
=== Resolution 8 ===
  % beyond threshold @4.8km/h (1200m): 0.0%
  % beyond threshold @3.6km/h (900m):  18.1%
  percentage points lost: 18.1
  newly-excluded cells: ['886088509bfffff', '8860885097fffff']

=== Resolution 9 ===
  % beyond threshold @4.8km/h (1200m): 6.4%
  % beyond threshold @3.6km/h (900m):  11.0%
  percentage points lost: 4.5
  newly-excluded cells: [5 cells, incl. '896088509a7ffff', '89608850963ffff', ...]
```

At the slower, more elderly-realistic walking speed, coverage drops
sharply — **18.1 percentage points** at resolution 8, or **4.5 points**
at resolution 9, for the exact same underlying network distances.

**Worth flagging on its own: resolution 8 loses *four times* more
percentage points than resolution 9 for the identical speed change** —
another MAUP effect, not a second independent finding. At the coarse
resolution, each cell is large, so one cell crossing the threshold flips
a large chunk of (proxy) population from "covered" to "not covered" in
one jump; at the fine resolution the same underlying change is spread
across many more, smaller cells, so the reported swing looks gentler even
though it reflects the same real-world change in who can and can't reach
a hospital on foot in 15 minutes. Which aggregation unit you pick doesn't
just change the headline coverage number (Q7) — it also changes how
sensitive that number looks to a modeling assumption like walking speed.

## Phase 4 — Map client and performance

### Q9. Three ways to ship the same map

Built the actual client at [`client/index.html`](client/index.html) —
MapLibre GL JS, OSM basemap, the H3 coverage hexagons as real polygon
vector tiles from pg_tileserv with data-driven fill color by
`network_dist_m`, healthcare services via pg_featureserv (OGC API –
Features) with click popups, a layer-toggle panel, and a legend. The
"load all buildings as one WFS GeoJSON" toggle is wired to GeoServer's
WFS endpoint, verified actually firing in the browser's own network log
(`http://localhost:8081/geoserver/webgis/ows?...typeNames=webgis:buildings...` → 200).

Measured with [`analysis/q9_perf_measure.py`](analysis/q9_perf_measure.py):
a 3×3 grid of real tile requests (9 tiles) around the study area centre,
same tile coordinates used for both WMS and MVT so the comparison is
apples-to-apples; WFS is a single unbounded request (as the client task
itself specifies), so it's measured once, not per zoom.

| Zoom | WMS requests | WMS KB | WMS time (s) | MVT requests | MVT KB | MVT time (s) |
|---|---|---|---|---|---|---|
| 12 | 9 | 37.3 | 0.75 | 9 | **1282.6** | 0.59 |
| 14 | 9 | 271.2 | 0.37 | 9 | 928.6 | 0.25 |
| 16 | 9 | 340.3 | 0.24 | 9 | **169.0** | 0.08 |

WFS GeoJSON (all buildings, one request): **1 request, 7,656.8 KB, 0.44s**.

**Genuinely surprising result, worth stating honestly rather than forcing
the textbook answer:** at zoom 12, MVT is **34× larger** than WMS, not
smaller. This is because pg_tileserv (in its default config here) serves
the *same full-resolution* building geometry at every zoom level — no
server-side simplification/generalization by zoom. At zoom 12, each of
the 9 tiles covers a large chunk of the study area, packing in full-detail
polygons for thousands of buildings; the WMS PNG covering the same area
is a fixed 256×256 raster that compresses very well once rendered. By
zoom 16, the situation flips hard — each tile now covers a small patch
with few buildings, so MVT (169KB) becomes dramatically smaller than WMS
(340KB), because WMS still has to rasterize and re-encode a full image
per tile regardless of how little is in it, while MVT's payload shrinks
with the actual feature count.

**Which breaks first as the area grows:** the single WFS GeoJSON request,
unambiguously — 7.6MB for this one 2.4km-wide ward already; at real city
scale (10-100× more buildings), that single request becomes tens to
hundreds of MB, downloaded all at once before anything can render, with
no way to show partial progress or avoid data the user never scrolls to.
Both tiled approaches (WMS, MVT) scale with *viewport* size, not *city*
size — a bigger city means more total tiles exist, but any one view still
only fetches the handful of tiles it's currently showing.

**How the earlier project loaded data, and how it'd behave at city
scale:** RideStop (`script.js`, `fetchNearbyPlaces()` /
`fetchFromOverpassWithFallback()`) fetches everything live from Overpass
as one unbounded JSON response per search, scoped to a fixed 2km radius
(`DEFAULT_SEARCH_RADIUS_METERS`) — functionally the same pattern as this
assignment's WFS-GeoJSON path, just with a hardcoded rather than
user-adjustable radius, and with resilience added on top (it races the
same query across 4 Overpass mirrors in parallel, since RideStop's own
earlier development found the public mirrors unreliable). It would hit
the same wall at city scale regardless: a wider search (or a denser,
bigger city) means a bigger single payload, with no tiling, no pagination
beyond what Overpass itself enforces, and no partial rendering until the
whole response arrives — the mirror-racing makes individual requests more
reliable, but doesn't change that each one is still a single unbounded
blob.

## Phase 5 — Deploy it, for free

### Q10. Image size

Two real Dockerfiles for the same client: [`client/Dockerfile`](client/Dockerfile)
(multi-stage, `nginx:1.27-alpine` final stage) and
[`client/Dockerfile.singlestage`](client/Dockerfile.singlestage) (single
stage, full `node:20` base with nginx installed via `apt-get`).

```
docker images wgis-client
TAG           SIZE
singlestage   1.62GB
multistage    73.6MB
```

**The multi-stage image is ~22× smaller** (73.6MB vs 1.62GB) for
identical final content — one static HTML file served by nginx.

`docker history` for the smaller (multistage) image:
```
COPY /src/index.html /usr/share/nginx/html/...   28.7kB
RUN apkArch=... (nginx install via apk)           38.7MB   <- largest layer
ENV NJS_RELEASE / NJS_VERSION                     0B
RUN addgroup/adduser (nginx user setup)           5.36MB
COPY docker-entrypoint scripts                    ~60kB total
ADD alpine-minirootfs-3.21.3-x86_64.tar.gz         8.5MB
```

**The largest layer is the nginx package install itself (38.7MB)** —
nginx plus its runtime shared libraries pulled in via `apk`. The actual
application content (`COPY index.html`) is only 28.7kB — three orders of
magnitude smaller than the web server that serves it. The single-stage
image is ~22× bigger not because it contains more *application* code, but
because it drags along `node:20`'s entire toolchain (Node.js runtime, npm,
build-essential-adjacent tooling, apt's package cache) — none of which the
running container ever needs, since nothing in it actually executes
Node.js at runtime. Multi-stage builds exist exactly to throw that away:
the `build` stage can have whatever heavy tooling it wants, and only the
`final` stage's content ships.

### Q11. Self-healing and state

Manifests: [`k8s/postgis-statefulset.yaml`](k8s/postgis-statefulset.yaml)
(StatefulSet + PVC), [`k8s/postgis-secret.yaml`](k8s/postgis-secret.yaml),
[`k8s/client-deployment.yaml`](k8s/client-deployment.yaml). Ran for real
on a `kind` cluster (installed just for this — `kind create cluster
--name webgis`, Kubernetes v1.31.2).

**With the PVC (real StatefulSet):**
```
Inserted a marker row into a new k8s_test table.
23:42:26.33  kubectl delete pod postgis-0
23:42:29.84  pod phase back to Running           (~3.5s)
23:42:30.06  pod condition Ready                  (~3.7s total)

SELECT * FROM k8s_test;
 id |             note
----+------------------------------
  1 | survived-the-pod-delete-test
```
Back up in under 4 seconds, and the data is still there.

**Same test, PVC replaced by `emptyDir`** (`k8s/postgis-statefulset-emptydir-TEST-ONLY.yaml`,
applied and torn down for this one comparison only — not part of the real deployment):
```
Inserted the same kind of marker row, deleted the pod, waited for Ready, then:
SELECT * FROM k8s_test;
psql: error: FATAL:  database "webgis" does not exist
```
**With `emptyDir`, not just the table but the entire database is gone**
after recreation — more total than I expected going in. `emptyDir`'s
storage lifecycle is tied to the *pod*, not the StatefulSet identity; a
freshly recreated pod gets a brand-new, empty directory on whatever node
it lands on, so Postgres's `docker-entrypoint.sh` re-runs its first-boot
initialization from scratch, as if the container had never run before.

**Why a database is a StatefulSet, not a plain Deployment:** both will
self-heal — Kubernetes recreates a failed Pod from either in roughly the
same few seconds, as shown above. The difference is identity and storage,
not recovery speed. A Deployment's Pods are interchangeable; any
replacement is as good as any other, which is exactly right for this
project's stateless client. A StatefulSet instead gives each Pod a stable
name (`postgis-0`, not a random suffix) and binds it to its *own*
PersistentVolumeClaim via `volumeClaimTemplates` — so a recreated Pod
reattaches to the *same* storage it had before, not a fresh one. That's
the only reason the PVC version's data survived and the emptyDir
version's didn't: the Pod's compute identity is disposable either way,
but only the StatefulSet+PVC combination keeps the data that compute
identity was attached to.

### Q12. Static vs server deployment

GitHub Pages deployment itself is still pending (needs the repo's Pages
setting enabled, which only the repo owner can do, plus propagation time
after push) — the workflow is written and committed
([`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml)),
but I can't confirm a live public URL from here yet. What **is** real and
tested: the static client ([`client/index.html`](client/index.html)) was
built for real — real tippecanoe + go-pmtiles conversion (both run via
Docker, not fabricated), producing a real 64,223-byte
[`client/data.pmtiles`](client/data.pmtiles) covering the hex-coverage and
services layers — and verified working locally against a range-capable
server (Python's own `http.server` doesn't support HTTP Range requests at
all, which I only discovered by testing it and watching `pmtiles.js` fail
with an explicit "content-length exceeding request... check your storage
backend supports HTTP Byte Serving" error — so I wrote a small custom
range-serving test server, [`client/range_server.py`](client/range_server.py),
to confirm the client-side mechanics for real before trusting that GitHub
Pages' own CDN would do the same).

Confirmed via direct testing:
```
curl -r 0-99 http://localhost:8092/data.pmtiles
→ HTTP/1.0 206 Partial Content
  Content-Range: bytes 0-99/64223
  Content-Length: 100
  Accept-Ranges: bytes
```
And the browser's own network log, loading the page for real through
`pmtiles.js`, shows multiple genuine `206 Partial Content` responses for
`data.pmtiles` — the library is actually issuing targeted byte-range
requests to read only the index and the specific tiles needed, not
downloading the whole 64KB file up front.

**Total size for this view:** 64,223 bytes (63KB) is the *entire*
PMTiles file for the whole study area at every zoom — tiny next to Q9's
measurements, but not a fair apples-to-apples number: Q9 measured
per-viewport tile cost at 3 zooms for the much larger `buildings` table;
this PMTiles file only contains the 59 hex cells + 151 services, which is
why direct comparison isn't meaningful here — what matters is *how* the
bytes are fetched (ranged, on demand) rather than the raw total.

**Two things the server stack can do that the static site can't:**
1. **Answer live, parameterized queries** — pg_featureserv/pg_tileserv
   can filter, aggregate, or re-run SQL against current data on request;
   a static PMTiles file is a frozen snapshot that needs a full rebuild
   and redeploy to reflect any data change.
2. **Serve truly dynamic/user-specific content** — nothing in the static
   path can do an authenticated request, a write, or a per-user response;
   it's read-only, public, identical-for-everyone by construction.

**One advantage the static site has:** zero server cost and zero uptime
risk — once deployed, GitHub's own CDN serves it; there's no database to
crash, no container to restart, no port conflict to debug (unlike this
session's entire PostGIS/GeoServer troubleshooting saga). It also loads
fast globally without needing to provision or pay for any backend at all.

---

## Bonus (B1–B3) — not attempted yet

Optional; only worth pursuing after Q1–Q12 are solid, per the brief's own
effort estimate (15–20 extra hours for the bonus alone).
