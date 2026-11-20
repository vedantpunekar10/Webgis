import geopandas as gpd
from sqlalchemy import create_engine

BASE = r"C:\Users\Vedant Punekar\webgis-experiential-learning\analysis"
UTM_CRS = "EPSG:32643"
DB_URL = "postgresql+psycopg://webgis:changeme@localhost:5433/webgis"

engine = create_engine(DB_URL)
gdf = gpd.read_file(f"{BASE}\\study_area_kothrud.geojson")
gdf = gdf.set_crs("EPSG:4326") if gdf.crs is None else gdf

gdf.to_postgis("study_area", engine, if_exists="replace", index=False)
gdf_utm = gdf.copy()
gdf_utm["geometry"] = gdf_utm.geometry.to_crs(UTM_CRS)
gdf_utm.set_crs(UTM_CRS, allow_override=True).to_postgis("study_area_utm", engine, if_exists="replace", index=False)
print("Loaded study_area + study_area_utm")
