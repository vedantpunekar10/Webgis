"""
Phase 1 cleaning + load:
- convert polygon/multipolygon service features to points (their centroid)
- drop duplicates (by OSM id, and by near-identical name+location)
- keep name + type tags
- load into PostGIS in EPSG:4326, with a UTM (EPSG:32643) copy for metric work
"""
import geopandas as gpd
from sqlalchemy import create_engine

BASE = r"C:\Users\Vedant Punekar\Web GIS\Mini project\analysis"
UTM_CRS = "EPSG:32643"
DB_URL = "postgresql+psycopg://webgis:changeme@localhost:5433/webgis"


def to_point_geom(gdf):
    gdf = gdf.copy()
    # Ways/relations (polygons) don't have a direct point location in OSM —
    # use their centroid, computed in UTM for metric accuracy, then back to 4326.
    utm = gdf.geometry.to_crs(UTM_CRS)
    centroids_utm = utm.centroid
    gdf["geometry"] = gpd.GeoSeries(centroids_utm, crs=UTM_CRS).to_crs("EPSG:4326")
    return gdf


def clean_healthcare():
    gdf = gpd.read_file(f"{BASE}\\raw_healthcare.gpkg")
    # osmnx already saves the OSM id as plain "element"/"id" columns (not an index) in GPKG output.
    gdf = to_point_geom(gdf)

    for c in ["name", "amenity", "healthcare"]:
        if c not in gdf.columns:
            gdf[c] = None
    keep_cols = ["id", "element", "name", "amenity", "healthcare", "geometry"]
    gdf = gdf[keep_cols].rename(columns={"id": "osmid", "element": "element_type"})

    before = len(gdf)
    gdf = gdf.drop_duplicates(subset=["osmid", "element_type"])
    print(f"Healthcare: {before} -> {len(gdf)} after dropping exact OSM-id duplicates")

    # near-duplicate check: same name, within ~11m of each other (rounded coords as a cheap proxy for ~25m)
    gdf["_lon_r"] = gdf.geometry.x.round(4)
    gdf["_lat_r"] = gdf.geometry.y.round(4)
    near_dupe_groups = gdf[gdf["name"].notna()].groupby(["name", "_lon_r", "_lat_r"]).size()
    near_dupes = near_dupe_groups[near_dupe_groups > 1]
    print(f"  {len(near_dupes)} name+~11m-coordinate groups with >1 feature (near-duplicate candidates)")
    gdf = gdf.drop(columns=["_lon_r", "_lat_r"])

    no_name = gdf["name"].isna().sum()
    print(f"  {no_name}/{len(gdf)} features have no name tag ({no_name/len(gdf)*100:.1f}%)")

    gdf["osmid"] = gdf["osmid"].astype(str)
    return gdf


def clean_buildings():
    gdf = gpd.read_file(f"{BASE}\\raw_buildings.gpkg")
    for c in ["building", "name"]:
        if c not in gdf.columns:
            gdf[c] = None
    keep_cols = ["id", "element", "building", "name", "geometry"]
    gdf = gdf[keep_cols].rename(columns={"id": "osmid", "element": "element_type"})
    before = len(gdf)
    gdf = gdf.drop_duplicates(subset=["osmid", "element_type"])
    print(f"Buildings: {before} -> {len(gdf)} after dropping exact OSM-id duplicates")
    gdf["osmid"] = gdf["osmid"].astype(str)
    return gdf


def load(gdf, table_name, engine, geom_type):
    # 4326 copy
    gdf.set_geometry("geometry").set_crs("EPSG:4326").to_postgis(
        table_name, engine, if_exists="replace", index=False
    )
    # UTM copy, same table name + _utm suffix, for metric work (ST_DWithin etc.)
    gdf_utm = gdf.copy()
    gdf_utm["geometry"] = gdf_utm.geometry.to_crs(UTM_CRS)
    gdf_utm.set_geometry("geometry").set_crs(UTM_CRS).to_postgis(
        f"{table_name}_utm", engine, if_exists="replace", index=False
    )
    print(f"Loaded {table_name} ({len(gdf)} rows) + {table_name}_utm into PostGIS")


def main():
    engine = create_engine(DB_URL)

    healthcare = clean_healthcare()
    buildings = clean_buildings()

    load(healthcare, "services", engine, "point")
    load(buildings, "buildings", engine, "polygon")

    print("Phase 1 load complete.")


if __name__ == "__main__":
    main()
