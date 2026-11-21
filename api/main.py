"""
Bonus challenge: a live walking-isochrone + nearest-service API over the
pgRouting-loaded walking network. Two endpoints:
  /isochrone?lon=&lat=&minutes=  -> GeoJSON polygon reachable on foot
  /nearest?lon=&lat=&k=          -> the k closest services by walking time
"""
import json
import os
import time

import psycopg
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Kothrud Healthcare Walking-Access API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

DB_DSN = os.environ.get(
    "DATABASE_URL",
    "postgresql://webgis:changeme@localhost:5433/webgis",
)

WALK_SPEED_M_PER_MIN = 80.0  # 4.8 km/h, per the assignment's own urban walking-speed assumption


def get_conn():
    return psycopg.connect(DB_DSN)


@app.get("/isochrone")
def isochrone(
    lon: float = Query(...),
    lat: float = Query(...),
    minutes: float = Query(15, gt=0, le=60),
    hull: str = Query(
        "convex",
        pattern="^(concave|convex|buffer)$",
        description="convex is near-instant (~20ms); concave is accurate but slow "
        "(~11s at a 15-min radius -- see B1/B3). Only use concave/buffer for the "
        "hull-comparison exercise, not live interaction.",
    ),
):
    t0 = time.perf_counter()
    distance_m = minutes * WALK_SPEED_M_PER_MIN
    hull_expr = {
        "convex": "ST_ConvexHull(ST_Collect(geometry))",
        "buffer": "ST_Buffer(ST_Collect(geometry)::geography, 60)::geometry",
        "concave": "ST_ConcaveHull(ST_Collect(geometry), 0.3)",
    }[hull]

    with get_conn() as conn, conn.cursor() as cur:
        db_t0 = time.perf_counter()
        cur.execute(
            f"""
            WITH start_node AS (
              SELECT id FROM walk_nodes
              ORDER BY geometry::geography <-> ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)::geography
              LIMIT 1
            ),
            reached AS (
              SELECT dd.node
              FROM pgr_drivingDistance(
                'SELECT id, source, target, cost, reverse_cost FROM walk_edges',
                (SELECT id FROM start_node),
                %(distance_m)s,
                directed => false
              ) dd
            ),
            reached_geom AS (
              SELECT n.geometry FROM reached r JOIN walk_nodes n ON n.id = r.node
            ),
            hull_cte AS (
              -- computed ONCE here and reused below -- an earlier version of this
              -- query computed the (slow) hull expression twice, once for the
              -- GeoJSON and once for the area, doubling the response time for no
              -- reason. See README's debugging log / B1.
              SELECT {hull_expr} AS geom, count(*) AS n FROM reached_geom
            )
            SELECT ST_AsGeoJSON(geom), n, ST_Area(geom::geography)
            FROM hull_cte;
            """,
            {"lon": lon, "lat": lat, "distance_m": distance_m},
        )
        row = cur.fetchone()
        db_time = time.perf_counter() - db_t0

    if row is None or row[0] is None:
        raise HTTPException(404, "No reachable nodes found (point too far from the walking network)")

    hull_geojson, reached_nodes, area_m2 = row
    total_time = time.perf_counter() - t0
    return {
        "type": "Feature",
        "geometry": json.loads(hull_geojson),
        "properties": {
            "minutes": minutes,
            "distance_m": distance_m,
            "reached_nodes": reached_nodes,
            "area_m2": round(area_m2, 1),
            "hull_type": hull,
        },
        "_timing": {"db_ms": round(db_time * 1000, 1), "total_ms": round(total_time * 1000, 1)},
    }


@app.get("/nearest")
def nearest(
    lon: float = Query(...),
    lat: float = Query(...),
    k: int = Query(5, ge=1, le=50),
):
    t0 = time.perf_counter()
    with get_conn() as conn, conn.cursor() as cur:
        db_t0 = time.perf_counter()
        cur.execute(
            """
            WITH start_node AS (
              SELECT id FROM walk_nodes
              ORDER BY geometry::geography <-> ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)::geography
              LIMIT 1
            ),
            targets AS (
              SELECT DISTINCT nearest_node_id FROM services WHERE nearest_node_id IS NOT NULL
            ),
            costs AS (
              SELECT * FROM pgr_dijkstraCost(
                'SELECT id, source, target, cost, reverse_cost FROM walk_edges',
                (SELECT id FROM start_node),
                (SELECT array_agg(nearest_node_id) FROM targets),
                directed => false
              )
            )
            SELECT s.name, s.osmid, s.amenity, s.healthcare,
                   ST_X(s.geometry) AS lon, ST_Y(s.geometry) AS lat,
                   c.agg_cost AS distance_m
            FROM costs c
            JOIN services s ON s.nearest_node_id = c.end_vid
            ORDER BY c.agg_cost ASC
            LIMIT %(k)s;
            """,
            {"lon": lon, "lat": lat, "k": k},
        )
        rows = cur.fetchall()
        db_time = time.perf_counter() - db_t0

    total_time = time.perf_counter() - t0
    results = [
        {
            "name": r[0] or "(unnamed)",
            "osmid": r[1],
            "amenity": r[2],
            "healthcare": r[3],
            "lon": r[4],
            "lat": r[5],
            "distance_m": round(r[6], 1),
            "minutes": round(r[6] / WALK_SPEED_M_PER_MIN, 1),
        }
        for r in rows
    ]
    return {
        "results": results,
        "_timing": {"db_ms": round(db_time * 1000, 1), "total_ms": round(total_time * 1000, 1)},
    }


@app.get("/health")
def health():
    return {"status": "ok"}
