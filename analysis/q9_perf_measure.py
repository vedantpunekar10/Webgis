"""
Q9: three ways to ship the same buildings data, measured at zoom 12/14/16.
A 3x3 tile grid around the study area's centre, for both (a) tiled WMS PNG
and (c) MVT from pg_tileserv -- same tile coordinates, same area, so the
comparison is apples-to-apples. (b) WFS GeoJSON is a single, unbounded
request (per the brief's own client task) so it's measured once, not per zoom.
"""
import math
import time
import requests

LAT, LON = 18.5073, 73.8057
GEOSERVER = "http://localhost:8081/geoserver/webgis/wms"
TILESERV = "http://localhost:7800/public.buildings"


def deg2tile(lat, lon, zoom):
    lat_rad = math.radians(lat)
    n = 2.0 ** zoom
    xtile = int((lon + 180.0) / 360.0 * n)
    ytile = int((1.0 - math.log(math.tan(lat_rad) + 1 / math.cos(lat_rad)) / math.pi) / 2.0 * n)
    return xtile, ytile


def tile_bbox_3857(x, y, z):
    n = 2.0 ** z
    def lon_lat(xt, yt):
        lon_deg = xt / n * 360.0 - 180.0
        lat_rad = math.atan(math.sinh(math.pi * (1 - 2 * yt / n)))
        return lon_deg, math.degrees(lat_rad)
    lon0, lat0 = lon_lat(x, y + 1)
    lon1, lat1 = lon_lat(x + 1, y)
    # project to 3857
    def to_3857(lon, lat):
        x = lon * 20037508.34 / 180
        y = math.log(math.tan((90 + lat) * math.pi / 360)) / (math.pi / 180)
        y = y * 20037508.34 / 180
        return x, y
    x0, y0 = to_3857(lon0, lat0)
    x1, y1 = to_3857(lon1, lat1)
    return f"{x0},{y0},{x1},{y1}"


def measure_wms(x, y, z):
    bbox = tile_bbox_3857(x, y, z)
    url = (f"{GEOSERVER}?service=WMS&version=1.1.1&request=GetMap&layers=webgis:buildings"
           f"&srs=EPSG:3857&bbox={bbox}&width=256&height=256&format=image/png")
    t0 = time.time()
    r = requests.get(url)
    dt = time.time() - t0
    return len(r.content), dt


def measure_mvt(x, y, z):
    url = f"{TILESERV}/{z}/{x}/{y}.pbf"
    t0 = time.time()
    r = requests.get(url)
    dt = time.time() - t0
    return len(r.content), dt


results = []
for zoom in (12, 14, 16):
    cx, cy = deg2tile(LAT, LON, zoom)
    tiles = [(cx + dx, cy + dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1)]

    wms_total_bytes, wms_total_time, wms_requests = 0, 0.0, 0
    mvt_total_bytes, mvt_total_time, mvt_requests = 0, 0.0, 0
    for (tx, ty) in tiles:
        b, t = measure_wms(tx, ty, zoom)
        wms_total_bytes += b
        wms_total_time += t
        wms_requests += 1

        b, t = measure_mvt(tx, ty, zoom)
        mvt_total_bytes += b
        mvt_total_time += t
        mvt_requests += 1

    results.append({
        "zoom": zoom,
        "wms_requests": wms_requests, "wms_kb": round(wms_total_bytes / 1024, 1), "wms_time_s": round(wms_total_time, 2),
        "mvt_requests": mvt_requests, "mvt_kb": round(mvt_total_bytes / 1024, 1), "mvt_time_s": round(mvt_total_time, 2),
    })

print(f"{'zoom':<6}{'WMS req':<10}{'WMS KB':<10}{'WMS s':<8}{'MVT req':<10}{'MVT KB':<10}{'MVT s':<8}")
for r in results:
    print(f"{r['zoom']:<6}{r['wms_requests']:<10}{r['wms_kb']:<10}{r['wms_time_s']:<8}{r['mvt_requests']:<10}{r['mvt_kb']:<10}{r['mvt_time_s']:<8}")

# single WFS GeoJSON measurement (unbounded, same regardless of zoom)
t0 = time.time()
r = requests.get("http://localhost:8081/geoserver/webgis/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=webgis:buildings&outputFormat=application/json")
dt = time.time() - t0
print(f"\nWFS GeoJSON (all buildings, one request): 1 request, {len(r.content)/1024:.1f} KB, {dt:.2f}s")
