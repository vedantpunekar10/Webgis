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
Compute the area's size four ways (ST_Area on 4326 geometry, on geography
type, after transforming to UTM, after transforming to EPSG:3857), give
all four with units, divide the 3857 value by the UTM value, compare that
ratio with 1/cos²(latitude of the area's centre), explain the match, and
say which CRS the earlier project measured distance in.

_Pending: needs the registered area polygon._

### Q2. Indexes and query plans
Count buildings within 500m of each service point using ST_DWithin on UTM
geometry; run EXPLAIN ANALYZE without a GiST index, then with one; report
both times and the scan node in each plan; rewrite the filter as
ST_Distance(a,b) < 500 with the index present and explain why the plan
and time change.

_Pending: needs the registered area's OSM data loaded into PostGIS
(the PostGIS container is up and ready for this now)._

### Q3. Data quality vs your earlier source
What share of services have no name tag, how many pairs lie within 25m of
each other, how does that compare with the earlier project's data for the
same area, and how many of 5 spot-checked services were correct,
misplaced, or closed.

_Pending: needs the registered area's OSM data._

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
