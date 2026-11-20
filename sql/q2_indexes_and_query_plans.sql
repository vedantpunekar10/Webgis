-- Q2: Indexes and query plans.
-- Count buildings within 500m of each service point using ST_DWithin on UTM geometry.
-- Note: GeoPandas' to_postgis() (via geoalchemy2) auto-creates a GiST index on
-- the geometry column by default -- dropping it explicitly first, to get a
-- genuinely clean "no index" baseline before re-adding one.

DROP INDEX IF EXISTS idx_buildings_utm_geometry;
DROP INDEX IF EXISTS buildings_utm_geom_gist;

-- Step 1: EXPLAIN ANALYZE with NO index on buildings_utm.geometry at all
EXPLAIN ANALYZE
SELECT s.osmid AS service_osmid, count(b.osmid) AS buildings_within_500m
FROM services_utm s
JOIN buildings_utm b
  ON ST_DWithin(s.geometry, b.geometry, 500)
GROUP BY s.osmid;

-- Step 2: add the GiST index
CREATE INDEX buildings_utm_geom_gist ON buildings_utm USING GIST (geometry);
ANALYZE buildings_utm;

-- Step 3: EXPLAIN ANALYZE *with* the GiST index present, same query
EXPLAIN ANALYZE
SELECT s.osmid AS service_osmid, count(b.osmid) AS buildings_within_500m
FROM services_utm s
JOIN buildings_utm b
  ON ST_DWithin(s.geometry, b.geometry, 500)
GROUP BY s.osmid;

-- Step 4: rewrite the filter as ST_Distance(a,b) < 500, index still present
EXPLAIN ANALYZE
SELECT s.osmid AS service_osmid, count(b.osmid) AS buildings_within_500m
FROM services_utm s
JOIN buildings_utm b
  ON ST_Distance(s.geometry, b.geometry) < 500
GROUP BY s.osmid;
