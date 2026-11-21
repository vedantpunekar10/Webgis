import json
import matplotlib.pyplot as plt
from shapely.geometry import shape
import geopandas as gpd

with open(r"C:\Users\Vedant Punekar\Web GIS\Mini project\api\b3_hulls.txt") as f:
    line = f.read().strip()

convex_j, concave03_j, concave06_j, buffer_j = line.split("|")
convex = shape(json.loads(convex_j))
concave03 = shape(json.loads(concave03_j))
concave06 = shape(json.loads(concave06_j))
buffer_poly = shape(json.loads(buffer_j))

utm = "EPSG:32643"
gdf = gpd.GeoDataFrame(
    {"name": ["Convex hull", "Concave (0.6)", "Concave (0.3)", "Buffered edges"]},
    geometry=[convex, concave06, concave03, buffer_poly],
    crs="EPSG:4326",
).to_crs(utm)

fig, ax = plt.subplots(figsize=(8, 8))
colors = ["#d73027", "#fdae61", "#1a9850", "#3182bd"]
for (_, row), c in zip(gdf.iterrows(), colors):
    gpd.GeoSeries([row.geometry]).plot(ax=ax, facecolor="none", edgecolor=c, linewidth=2, label=row["name"])

ax.legend()
ax.set_title("B3: Same 15-minute isochrone, four hull methods\n(click point: 18.5073N, 73.8057E)")
ax.set_aspect("equal")
plt.tight_layout()
plt.savefig(r"C:\Users\Vedant Punekar\Web GIS\Mini project\study\evidence\b3_hull_comparison.png", dpi=120)
print("saved")
