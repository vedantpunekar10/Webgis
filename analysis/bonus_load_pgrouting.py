"""
Bonus B: load the walking network into PostGIS as a pgRouting-ready edge
table (OSMnx node ids used directly as source/target -- they're already
unique integers, no need to rebuild topology from scratch).
"""
import geopandas as gpd
import osmnx as ox
from sqlalchemy import create_engine, text

BASE = "C:/Users/Vedant Punekar/Web GIS/Mini project/analysis"
DB_URL = "postgresql+psycopg://webgis:changeme@localhost:5433/webgis"

G = ox.load_graphml(f"{BASE}/walk_network.graphml")

edges = ox.graph_to_gdfs(G, nodes=False, edges=True).reset_index()
edges = edges[["u", "v", "length", "geometry"]].rename(columns={"u": "source", "v": "target", "length": "cost"})
edges["reverse_cost"] = edges["cost"]  # walking network: treat as undirected
edges["id"] = range(1, len(edges) + 1)
edges = edges.set_crs("EPSG:4326")

nodes = ox.graph_to_gdfs(G, nodes=True, edges=False).reset_index().rename(columns={"osmid": "id"})
nodes = nodes[["id", "y", "x", "geometry"]].rename(columns={"y": "lat", "x": "lon"})
nodes = nodes.set_crs("EPSG:4326")

engine = create_engine(DB_URL)
edges.to_postgis("walk_edges", engine, if_exists="replace", index=False)
nodes.to_postgis("walk_nodes", engine, if_exists="replace", index=False)

with engine.begin() as conn:
    conn.execute(text("CREATE INDEX IF NOT EXISTS walk_edges_source_idx ON walk_edges(source)"))
    conn.execute(text("CREATE INDEX IF NOT EXISTS walk_edges_target_idx ON walk_edges(target)"))
    conn.execute(text("CREATE INDEX IF NOT EXISTS walk_nodes_id_idx ON walk_nodes(id)"))

print(f"Loaded {len(edges)} edges, {len(nodes)} nodes into walk_edges / walk_nodes")
