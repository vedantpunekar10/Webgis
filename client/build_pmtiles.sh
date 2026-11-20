#!/bin/bash
# Converts the hex-coverage and services layers to PMTiles for the
# serverless GitHub Pages deployment (Phase 5, Part A). Run from the
# client/ directory; outputs client/data.pmtiles.
set -e
BASE="$(cd "$(dirname "$0")" && pwd)"

echo "Exporting GeoJSON from PostGIS..."
docker exec wgis-postgis psql -U webgis -d webgis -t -A -c \
  "SELECT json_build_object('type','FeatureCollection','features', json_agg(ST_AsGeoJSON(t.*)::json)) FROM (SELECT * FROM hex_coverage_res9) t;" \
  > "$BASE/hex_res9.geojson"
docker exec wgis-postgis psql -U webgis -d webgis -t -A -c \
  "SELECT json_build_object('type','FeatureCollection','features', json_agg(ST_AsGeoJSON(t.*)::json)) FROM (SELECT * FROM services) t;" \
  > "$BASE/services.geojson"

echo "Converting to MBTiles with tippecanoe (via Docker)..."
docker run --rm -v "$BASE":/data ghcr.io/felt/tippecanoe:latest \
  tippecanoe -o /data/combined.mbtiles --force \
  -l hex_res9 /data/hex_res9.geojson \
  -l services /data/services.geojson

echo "Converting MBTiles to PMTiles (via Docker)..."
docker run --rm -v "$BASE":/data ghcr.io/protomaps/go-pmtiles:latest \
  convert /data/combined.mbtiles /data/data.pmtiles

echo "Done: $BASE/data.pmtiles"
