-- Q3: Data quality vs the earlier (nearby-services) project's data.

-- (a) Share of services with no name tag
SELECT
  count(*) FILTER (WHERE name IS NULL) AS no_name,
  count(*) AS total,
  round(100.0 * count(*) FILTER (WHERE name IS NULL) / count(*), 1) AS pct_no_name
FROM services;

-- (b) Pairs of services within 25m of each other (true spatial self-join, not a name-based proxy)
-- osmid < osmid avoids counting each pair twice and matching a row against itself.
SELECT count(*) AS pairs_within_25m
FROM services_utm a
JOIN services_utm b
  ON a.osmid < b.osmid
 AND ST_DWithin(a.geometry, b.geometry, 25);

-- (c) What those near-duplicate pairs actually are (for the write-up)
SELECT a.osmid AS osmid_a, a.name AS name_a, b.osmid AS osmid_b, b.name AS name_b,
       round(ST_Distance(a.geometry, b.geometry)::numeric, 1) AS distance_m
FROM services_utm a
JOIN services_utm b
  ON a.osmid < b.osmid
 AND ST_DWithin(a.geometry, b.geometry, 25)
ORDER BY distance_m;

-- (d) Count matching the earlier project's exact tag definition for "hospital"
--     (legacy/nearby-services-gis.html CATEGORIES.hospital: amenity=hospital OR amenity=clinic only --
--      narrower than this assignment's Healthcare service type, which also includes
--      amenity=doctors and healthcare=*).
SELECT count(*) AS earlier_project_tag_definition_count
FROM services
WHERE amenity IN ('hospital', 'clinic');

SELECT count(*) AS this_assignment_full_healthcare_count FROM services;
