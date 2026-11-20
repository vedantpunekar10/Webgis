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
From the WMS 1.3.0 GetCapabilities, paste the services layer's
BoundingBox for EPSG:4326; send two GetMap requests with the same four
BBOX numbers (one VERSION=1.1.1&SRS=EPSG:4326, one
VERSION=1.3.0&CRS=EPSG:4326); screenshot both; explain the difference
using the standard.

_Partially ready: GeoServer is live at `http://localhost:8081/geoserver/web/`
— this can be demonstrated as soon as the services layer exists, which
needs the registered area's data published as a layer._

### Q5. WFS with a filter, two formats
Write a WFS 2.0 GetFeature request returning only named services inside
the area; give the full URL and numberMatched; fetch the same result as
GML 3.2 and GeoJSON; report both sizes in KB and the coordinate order of
the first point in each.

_Pending: needs the services layer published in GeoServer._

## Phase 3 — Was your earlier "nearest" right?

### Q6. Straight line vs street network
Take 30 random points in the area; for each, find the nearest service by
straight line and by walking network; report how many differ, the median
and maximum ratio of network/straight-line distance; map the worst case
and name the barrier.

_Pending: needs the walking network downloaded via OSMnx for the
registered area (osmnx/geopandas/h3/shapely are already installed and
confirmed working on this machine)._

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
