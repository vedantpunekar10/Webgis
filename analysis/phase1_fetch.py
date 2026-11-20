"""
Phase 1 — download the study area's healthcare features, building
footprints, and walking network (plus a 2km margin), clean them, and
report what we got. Loading into PostGIS is a separate script
(phase1_load_postgis.py) once this step's output looks right.
"""
import time
import geopandas as gpd
import osmnx as ox

BASE = r"C:\Users\Vedant Punekar\Web GIS\Mini project\analysis"
AREA_PATH = f"{BASE}\\study_area_kothrud.geojson"
MARGIN_M = 2000

HEALTHCARE_TAGS = {
    "amenity": ["hospital", "clinic", "doctors"],
    "healthcare": True,
}


def fetch_with_retry(fn, *args, tries=4, **kwargs):
    last_err = None
    for i in range(tries):
        try:
            return fn(*args, **kwargs)
        except Exception as e:
            last_err = e
            print(f"  attempt {i+1}/{tries} failed: {type(e).__name__}: {e}")
            time.sleep(5 * (i + 1))
    raise last_err


def main():
    poly = gpd.read_file(AREA_PATH).geometry.iloc[0]
    # buffer the polygon by MARGIN_M (in UTM) for the "area + 2km margin" fetch
    utm_crs = "EPSG:32643"
    poly_utm = gpd.GeoSeries([poly], crs="EPSG:4326").to_crs(utm_crs).iloc[0]
    poly_buffered_utm = poly_utm.buffer(MARGIN_M)
    poly_buffered = gpd.GeoSeries([poly_buffered_utm], crs=utm_crs).to_crs("EPSG:4326").iloc[0]

    print("Fetching healthcare features...")
    healthcare = fetch_with_retry(ox.features_from_polygon, poly_buffered, HEALTHCARE_TAGS)
    print(f"  got {len(healthcare)} raw healthcare features")
    healthcare.to_file(f"{BASE}\\raw_healthcare.gpkg", driver="GPKG")

    print("Fetching building footprints...")
    buildings = fetch_with_retry(ox.features_from_polygon, poly_buffered, {"building": True})
    print(f"  got {len(buildings)} raw building features")
    buildings.to_file(f"{BASE}\\raw_buildings.gpkg", driver="GPKG")

    print("Fetching walking network...")
    G = fetch_with_retry(ox.graph_from_polygon, poly_buffered, network_type="walk")
    print(f"  got {len(G.nodes)} nodes, {len(G.edges)} edges")
    ox.save_graphml(G, f"{BASE}\\walk_network.graphml")

    # also save the buffered area polygon for reuse by later scripts
    gpd.GeoSeries([poly_buffered], crs="EPSG:4326").to_file(
        f"{BASE}\\study_area_kothrud_buffered.geojson", driver="GeoJSON"
    )

    print("Done. Outputs in", BASE)


if __name__ == "__main__":
    main()
