"""
B1: fire 50 random clicks inside the study area at both endpoints, report
p50/p95 total response time, split into database time (reported by the
API itself) and API/network overhead (total - db).
"""
import random
import statistics as stats
import time

import geopandas as gpd
import requests
from shapely.geometry import Point

BASE = "C:/Users/Vedant Punekar/Web GIS/Mini project/analysis"
API = "http://localhost:8020"
random.seed(7)

area = gpd.read_file(f"{BASE}/study_area_kothrud.geojson").geometry.iloc[0]
minx, miny, maxx, maxy = area.bounds


def random_point():
    while True:
        p = Point(random.uniform(minx, maxx), random.uniform(miny, maxy))
        if area.contains(p):
            return p


def fire(endpoint, params):
    t0 = time.perf_counter()
    r = requests.get(f"{API}/{endpoint}", params=params)
    total_ms = (time.perf_counter() - t0) * 1000
    r.raise_for_status()
    db_ms = r.json()["_timing"]["db_ms"]
    return total_ms, db_ms


def summarize(name, totals, dbs):
    totals.sort()
    dbs.sort()
    n = len(totals)
    p50 = totals[int(n * 0.50)]
    p95 = totals[int(n * 0.95) - 1]
    print(f"{name}: n={n}  total p50={p50:.1f}ms p95={p95:.1f}ms  |  db p50={stats.median(dbs):.1f}ms  |  api/network overhead (p50 total - p50 db) ~= {p50 - stats.median(dbs):.1f}ms")


points = [random_point() for _ in range(50)]

iso_totals, iso_dbs = [], []
for p in points:
    total_ms, db_ms = fire("isochrone", {"lon": p.x, "lat": p.y, "minutes": 15})
    iso_totals.append(total_ms)
    iso_dbs.append(db_ms)

nearest_totals, nearest_dbs = [], []
for p in points:
    total_ms, db_ms = fire("nearest", {"lon": p.x, "lat": p.y, "k": 5})
    nearest_totals.append(total_ms)
    nearest_dbs.append(db_ms)

print("=== /isochrone (convex hull, default) ===")
summarize("isochrone", iso_totals, iso_dbs)
print("=== /nearest ===")
summarize("nearest", nearest_totals, nearest_dbs)
