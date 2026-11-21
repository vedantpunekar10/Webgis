"""Snap each service to its nearest walking-network node, and store that
node id back on the services table, so /nearest can route to it directly
without a spatial join on every request."""
import geopandas as gpd
import osmnx as ox
from sqlalchemy import create_engine, text

BASE = "C:/Users/Vedant Punekar/Web GIS/Mini project/analysis"
DB_URL = "postgresql+psycopg://webgis:changeme@localhost:5433/webgis"
UTM_CRS = "EPSG:32643"

G = ox.load_graphml(f"{BASE}/walk_network.graphml")
services = gpd.read_file(f"{BASE}/raw_healthcare.gpkg")

centroids_utm = services.geometry.to_crs(UTM_CRS).centroid
centroids_wgs = gpd.GeoSeries(centroids_utm, crs=UTM_CRS).to_crs("EPSG:4326")
nodes = ox.distance.nearest_nodes(G, X=centroids_wgs.x.values, Y=centroids_wgs.y.values)

engine = create_engine(DB_URL)
with engine.begin() as conn:
    conn.execute(text("ALTER TABLE services ADD COLUMN IF NOT EXISTS nearest_node_id bigint"))
    updated = 0
    for (_, row), node in zip(services.iterrows(), nodes):
        result = conn.execute(
            text("UPDATE services SET nearest_node_id = :node WHERE osmid = :osmid AND element_type = :element_type"),
            {"node": int(node), "osmid": str(row["id"]), "element_type": str(row["element"])},
        )
        updated += result.rowcount

print(f"Snapped {updated} services to network nodes")
