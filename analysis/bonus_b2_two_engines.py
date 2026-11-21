"""
B2: regenerate the exact same 30 points used in Q6 (same seed, same
sampling code) and compare pgRouting's nearest-service walking distance
(via the live /nearest API, k=1) against the OSMnx/NetworkX result
already recorded in q6_results.csv.
"""
import random

import geopandas as gpd
import pandas as pd
import requests
from shapely.geometry import Point

BASE = "C:/Users/Vedant Punekar/Web GIS/Mini project/analysis"
API = "http://localhost:8020"
random.seed(42)  # same seed as q6_straight_vs_network.py

area = gpd.read_file(f"{BASE}/study_area_kothrud.geojson").to_crs("EPSG:32643").geometry.iloc[0]
minx, miny, maxx, maxy = area.bounds


def random_point_in_area():
    while True:
        p = Point(random.uniform(minx, maxx), random.uniform(miny, maxy))
        if area.contains(p):
            return p


pts_utm = [random_point_in_area() for _ in range(30)]
pts_wgs = gpd.GeoSeries(pts_utm, crs="EPSG:32643").to_crs("EPSG:4326")

q6 = pd.read_csv(f"{BASE}/q6_results.csv")

rows = []
for i, p in enumerate(pts_wgs):
    r = requests.get(f"{API}/nearest", params={"lon": p.x, "lat": p.y, "k": 1}).json()
    if not r["results"]:
        continue
    pg_dist = r["results"][0]["distance_m"]
    pg_name = r["results"][0]["name"]

    q6_row = q6[q6["point"] == i]
    if q6_row.empty:
        continue
    osmnx_dist = q6_row["network_dist_m"].iloc[0]
    osmnx_name = q6_row["nearest_network"].iloc[0]

    pct_diff = abs(pg_dist - osmnx_dist) / osmnx_dist * 100 if osmnx_dist > 0 else float("nan")
    rows.append({
        "point": i, "pgrouting_dist_m": pg_dist, "pgrouting_nearest": pg_name,
        "osmnx_dist_m": osmnx_dist, "osmnx_nearest": osmnx_name,
        "pct_diff": round(pct_diff, 1), "same_service": pg_name == osmnx_name,
    })

df = pd.DataFrame(rows)
df.to_csv(f"{BASE}/bonus_b2_results.csv", index=False)
print(df.to_string())
print()
print(f"Median % diff: {df['pct_diff'].median():.1f}%")
print(f"Points differing by >10%: {(df['pct_diff'] > 10).sum()} / {len(df)}")
print(df[df["pct_diff"] > 10][["point", "pgrouting_dist_m", "osmnx_dist_m", "pct_diff", "same_service"]].to_string())
