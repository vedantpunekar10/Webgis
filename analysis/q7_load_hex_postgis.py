import h3
import pandas as pd
import geopandas as gpd
from shapely.geometry import Polygon
from sqlalchemy import create_engine

BASE = "C:/Users/Vedant Punekar/webgis-experiential-learning/analysis"
DB_URL = "postgresql+psycopg://webgis:changeme@localhost:5433/webgis"
engine = create_engine(DB_URL)

for res in (8, 9):
    df = pd.read_csv(f"{BASE}/q7_h3_res{res}.csv")
    # real hexagon boundaries (lat,lng pairs -> (lng,lat) for Polygon), not just cell-center points,
    # so the client can render an actual filled hex grid with data-driven colours.
    polys = [Polygon([(lng, lat) for lat, lng in h3.cell_to_boundary(h)]) for h in df["h3_index"]]
    gdf = gpd.GeoDataFrame(df, geometry=polys, crs="EPSG:4326")
    gdf.to_postgis(f"hex_coverage_res{res}", engine, if_exists="replace", index=False)
    print(f"Loaded hex_coverage_res{res} ({len(gdf)} cells) as polygons")
