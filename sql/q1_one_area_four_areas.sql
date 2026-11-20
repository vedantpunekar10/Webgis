-- Q1: One area, four areas.
-- Compute the study area's size four ways and compare the Mercator/UTM ratio
-- against the theoretical 1/cos^2(latitude) inflation factor.

SELECT
  ST_Area(geometry) AS area_sqdeg_4326,                                   -- raw 4326, degrees^2 (meaningless as a real area unit)
  ST_Area(geometry::geography) AS area_sqm_geography,                      -- geodetic area on the sphere/ellipsoid, m^2
  (SELECT ST_Area(geometry) FROM study_area_utm) AS area_sqm_utm43n,       -- projected UTM 43N, m^2
  ST_Area(ST_Transform(geometry, 3857)) AS area_sqm_3857                   -- projected Web Mercator, m^2
FROM study_area;

-- Ratio of 3857 area to UTM area, vs the theoretical secant-latitude-squared inflation
WITH areas AS (
  SELECT
    ST_Area(ST_Transform(geometry, 3857)) AS area_3857,
    (SELECT ST_Area(geometry) FROM study_area_utm) AS area_utm,
    ST_Y(ST_Centroid(geometry)) AS centroid_lat
  FROM study_area
)
SELECT
  area_3857,
  area_utm,
  area_3857 / area_utm AS observed_ratio,
  1.0 / (cos(radians(centroid_lat)) ^ 2) AS theoretical_ratio,
  centroid_lat
FROM areas;
