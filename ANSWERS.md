# ANSWERS.md

**Area:** _pending registration — see README "Open decisions"._
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

**Which CRS did the earlier project measure distance in?** Checked its
actual code (`legacy/nearby-services-gis.html`, `haversine()` function):
it computes great-circle distance directly on raw EPSG:4326 (WGS84)
lat/lon coordinates using the haversine formula with a fixed Earth radius
of 6,371,000m. It never reprojects to UTM or Web Mercator — this is
functionally equivalent to PostGIS's `::geography` distance calculation,
not a projected CRS at all.

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

**Comparison with the earlier project's data for the same area:** the
earlier project (`legacy/nearby-services-gis.html`) defines its
`hospital` category narrowly as `amenity=hospital` OR `amenity=clinic`
only (see its `CATEGORIES` object). Re-querying with that exact narrower
definition against the same loaded data:
```
 earlier_project_tag_definition_count | this_assignment_full_healthcare_count
---------------------------------------+----------------------------------------
                                   114 |                                    151
```
This assignment's Healthcare service type is broader (adds
`amenity=doctors` and `healthcare=*`), which accounts for the full
37-feature gap — not a difference in data quality, but in how much of
OSM's healthcare tagging each project chooses to count.

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
What share of population is beyond the walking threshold, by network and
by buffer; compute the network figure aggregated by ward/pin code/village,
by H3 resolution 8, and by H3 resolution 9; does the conclusion change;
give the H3 index of the worst-served populated cell.

_Pending: needs the registered area and a population source (WorldPop or
building-footprint-area proxy, per the brief)._

### Q8. Who is the model for?
Re-run network coverage at 3.6 km/h; how many percentage points of
population coverage are lost, and where.

_Pending: same prerequisites as Q7._

## Phase 4 — Map client and performance

### Q9. Three ways to ship the same map
With DevTools Network (cache disabled), record at zoom 12, 14, 16 the
number of requests, KB transferred, and time to finish for buildings as
(a) tiled WMS PNG, (b) one WFS GeoJSON, (c) MVT from pg_tileserv; give a
3×3 table; explain which breaks first as the area grows; compare with how
the earlier project loaded data and how it would behave at city scale.

_Partially ready: pg_tileserv and GeoServer are both live now; needs the
MapLibre client built and the area's building data loaded._

## Phase 5 — Deploy it, for free

### Q10. Image size
Build the client image twice (full base image single-stage, multi-stage
slim/Alpine); report both sizes; paste `docker history` for the smaller
one; explain which layer is largest and why.

_Pending: needs the MapLibre client built first._

### Q11. Self-healing and state
Delete the PostGIS pod with `kubectl delete pod`; record with timestamps
from `kubectl get pods -w` how long until it's running again; does data
survive; repeat with the PVC replaced by `emptyDir`; explain why a
database is a StatefulSet, not a plain Deployment.

_Pending: needs a local kind/minikube cluster (not yet installed — neither
`kind` nor `minikube` were found on this machine) and the `/k8s` manifests
written._

### Q12. Static vs server deployment
On the public GitHub Pages URL, open the Network tab at zoom 14, find the
PMTiles requests; paste one request's Range header and response status
code; report total KB for the view; compare with Q9's pg_tileserv
numbers; name two things the server stack can do that the static site
can't, and one advantage the static site has.

_Pending: needs Phase 5 Part A (GitHub Pages + PMTiles) deployed._

---

## Bonus (B1–B3) — not attempted yet

Optional; only worth pursuing after Q1–Q12 are solid, per the brief's own
effort estimate (15–20 extra hours for the bonus alone).
