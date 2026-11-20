import pandas as pd
import geopandas as gpd
from shapely.geometry import Point
from sqlalchemy import create_engine

BASE = "C:/Users/Vedant Punekar/webgis-experiential-learning/analysis"
DB_URL = "postgresql+psycopg://webgis:changeme@localhost:5433/webgis"
engine = create_engine(DB_URL)

for res in (8, 9):
    df = pd.read_csv(f"{BASE}/q7_h3_res{res}.csv")
    gdf = gpd.GeoDataFrame(df, geometry=[Point(xy) for xy in zip(df["lng"], df["lat"])], crs="EPSG:4326")
    gdf.to_postgis(f"hex_coverage_res{res}", engine, if_exists="replace", index=False)
    print(f"Loaded hex_coverage_res{res} ({len(gdf)} cells)")
