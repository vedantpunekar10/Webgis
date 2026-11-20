import random
import geopandas as gpd
import networkx as nx
import osmnx as ox
from shapely.geometry import Point
import pyproj

BASE = r"C:\Users\Vedant Punekar\Web GIS\Mini project\analysis"
UTM_CRS = "EPSG:32643"
random.seed(42)

G = ox.load_graphml(f"{BASE}\\walk_network.graphml")
G = ox.project_graph(G, to_crs=UTM_CRS)

services = gpd.read_file(f"{BASE}\\raw_healthcare.gpkg")
services["geometry"] = services.geometry.to_crs(UTM_CRS).centroid
services = services[["name", "geometry"]].reset_index(drop=True)

area = gpd.read_file(f"{BASE}\\study_area_kothrud.geojson").to_crs(UTM_CRS).geometry.iloc[0]
minx, miny, maxx, maxy = area.bounds

def random_point_in_area():
    while True:
        p = Point(random.uniform(minx, maxx), random.uniform(miny, maxy))
        if area.contains(p):
            return p

# project service nodes onto the network once
service_nodes = ox.distance.nearest_nodes(G, X=services.geometry.x.values, Y=services.geometry.y.values)

results = []
for i in range(30):
    p = random_point_in_area()
    # straight-line nearest
    dists_straight = services.geometry.distance(p)
    nearest_straight_idx = dists_straight.idxmin()
    straight_dist = dists_straight.min()

    # network nearest: shortest path from this point's nearest node to every service node
    pt_node = ox.distance.nearest_nodes(G, X=p.x, Y=p.y)
    try:
        lengths = nx.single_source_dijkstra_path_length(G, pt_node, weight="length")
    except Exception:
        lengths = {}
    best_net_idx, best_net_dist = None, float("inf")
    for idx, node in enumerate(service_nodes):
        d = lengths.get(node)
        if d is not None and d < best_net_dist:
            best_net_dist, best_net_idx = d, idx

    if best_net_idx is None:
        continue

    results.append({
        "point": i,
        "nearest_straight": services.iloc[nearest_straight_idx]["name"],
        "straight_dist_m": round(straight_dist, 1),
        "nearest_network": services.iloc[best_net_idx]["name"],
        "network_dist_m": round(best_net_dist, 1),
        "same_service": nearest_straight_idx == best_net_idx,
        "ratio": round(best_net_dist / straight_dist, 2) if straight_dist > 0 else None,
    })

import pandas as pd
df = pd.DataFrame(results)
df.to_csv(f"{BASE}\\q6_results.csv", index=False)
print(df.to_string())
print()
print("Different nearest service in", (~df["same_service"]).sum(), "/", len(df), "cases")
print("Median ratio:", df["ratio"].median())
print("Max ratio:", df["ratio"].max(), "at point", df.loc[df["ratio"].idxmax(), "point"])
