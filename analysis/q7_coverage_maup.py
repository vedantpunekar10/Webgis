import h3
import geopandas as gpd
import networkx as nx
import osmnx as ox
import pandas as pd
from shapely.geometry import Point
from sqlalchemy import create_engine

BASE = "C:/Users/Vedant Punekar/Web GIS/Mini project/analysis"
UTM_CRS = "EPSG:32643"
THRESHOLD_M = 1200  # 15 min at 4.8 km/h, urban area
DB_URL = "postgresql+psycopg://webgis:changeme@localhost:5433/webgis"

# --- load inputs ---
area_wgs = gpd.read_file(f"{BASE}/study_area_kothrud.geojson").geometry.iloc[0]
services = gpd.read_file(f"{BASE}/raw_healthcare.gpkg")
services_utm = services.copy()
services_utm["geometry"] = services_utm.geometry.to_crs(UTM_CRS).centroid

buildings = gpd.read_file(f"{BASE}/raw_buildings.gpkg")
buildings_utm = buildings.copy()
buildings_utm["geometry"] = buildings_utm.geometry.to_crs(UTM_CRS)
buildings_utm["area_m2"] = buildings_utm.geometry.area
buildings_utm["centroid"] = buildings_utm.geometry.centroid

G = ox.load_graphml(f"{BASE}/walk_network.graphml")
G = ox.project_graph(G, to_crs=UTM_CRS)
service_nodes = list(set(ox.distance.nearest_nodes(G, X=services_utm.geometry.x.values, Y=services_utm.geometry.y.values)))

print("Computing multi-source shortest paths from all service nodes...")
net_dist = nx.multi_source_dijkstra_path_length(G, sources=service_nodes, weight="length")


def build_cells(resolution):
    boundary = [(lat, lng) for lng, lat in area_wgs.exterior.coords]
    poly = h3.LatLngPoly(boundary)
    cells = list(h3.polygon_to_cells(poly, resolution))
    rows = []
    for cell in cells:
        lat, lng = h3.cell_to_latlng(cell)
        pt_utm = gpd.GeoSeries([Point(lng, lat)], crs="EPSG:4326").to_crs(UTM_CRS).iloc[0]
        rows.append({"h3_index": cell, "resolution": resolution, "lat": lat, "lng": lng, "geom_utm": pt_utm})
    return pd.DataFrame(rows)


# precompute, once, which H3 cell each building's centroid falls in (vectorized over buildings, not cells x buildings)
building_centroids_wgs = gpd.GeoSeries(buildings_utm["centroid"].values, crs=UTM_CRS).to_crs("EPSG:4326")
building_lat = building_centroids_wgs.y.values
building_lng = building_centroids_wgs.x.values


def enrich(df):
    resolution = df["resolution"].iloc[0]
    b_cells = [h3.latlng_to_cell(lat, lng, resolution) for lat, lng in zip(building_lat, building_lng)]
    pop_by_cell = pd.Series(buildings_utm["area_m2"].values, index=b_cells).groupby(level=0).sum()

    # batch the node lookups and distance-to-nearest-service in one shot instead of per-row
    xs = [g.x for g in df["geom_utm"]]
    ys = [g.y for g in df["geom_utm"]]
    nodes = ox.distance.nearest_nodes(G, X=xs, Y=ys)
    net_d = [net_dist.get(n, float("inf")) for n in nodes]
    straight_d = [services_utm.geometry.distance(g).min() for g in df["geom_utm"]]

    df = df.copy()
    df["pop_proxy_m2"] = df["h3_index"].map(pop_by_cell).fillna(0.0)
    df["network_dist_m"] = net_d
    df["straight_dist_m"] = straight_d
    return df


results = {}
for res in (8, 9):
    print(f"Building H3 resolution {res} cells...")
    df = build_cells(res)
    print(f"  {len(df)} cells, enriching (population proxy + distances)...")
    df = enrich(df)
    results[res] = df
    df.drop(columns=["geom_utm"]).to_csv(f"{BASE}/q7_h3_res{res}.csv", index=False)

for res, df in results.items():
    total_pop = df["pop_proxy_m2"].sum()
    beyond_net = df.loc[df["network_dist_m"] > THRESHOLD_M, "pop_proxy_m2"].sum()
    beyond_straight = df.loc[df["straight_dist_m"] > THRESHOLD_M, "pop_proxy_m2"].sum()
    print(f"\n=== Resolution {res} ({len(df)} cells) ===")
    print(f"  % pop beyond threshold (network):  {100*beyond_net/total_pop:.1f}%")
    print(f"  % pop beyond threshold (straight):  {100*beyond_straight/total_pop:.1f}%")
    populated = df[df["pop_proxy_m2"] > 0]
    if len(populated):
        worst = populated.loc[populated["network_dist_m"].idxmax()]
        print(f"  worst-served populated cell: {worst['h3_index']} (network_dist={worst['network_dist_m']:.0f}m, pop_proxy={worst['pop_proxy_m2']:.0f}m2)")

print("\nDone. CSVs in", BASE)
