-- Bring every race start's course up to the shape series-file v71 gives it
-- (ADR-013): the course library is gone. This mirrors
-- lib/course-library-upgrade.ts, which does the same for the copies the
-- database does not hold: files, revision snapshots, Trash tombstones and
-- published exports.
--
-- A course picked from the library loses the library course it named and
-- its waypoints. One that had waypoints is anchored at the first of them,
-- takes its own scored legs as the legs it gave where they were never
-- edited, and names each of them after the marks it runs between where
-- they are the waypoints' own one for one. Nothing scored changes: the
-- scored legs keep every figure, and gain only a name.
--
-- Every row keeps an empty `waypoints`: the build this replaces reads it
-- unguarded, and goes on serving requests for a few seconds after this runs.
WITH c AS (
  SELECT
    rs.id,
    rs.course,
    CASE WHEN jsonb_typeof(rs.course_legs) = 'array' THEN rs.course_legs ELSE '[]'::jsonb END AS legs,
    CASE WHEN jsonb_typeof(rs.course->'waypoints') = 'array' THEN rs.course->'waypoints' ELSE '[]'::jsonb END AS wp,
    coalesce(rs.course->'legsEdited' = 'true'::jsonb, false) AS edited
  FROM race_starts rs
  WHERE rs.course IS NOT NULL
    AND (
      rs.course ? 'courseId'
      OR CASE
        WHEN jsonb_typeof(rs.course->'waypoints') = 'array' THEN jsonb_array_length(rs.course->'waypoints') > 0
        ELSE true
      END
    )
),
p AS (
  SELECT
    c.*,
    jsonb_array_length(c.wp) AS n,
    jsonb_array_length(c.legs) AS m,
    coalesce(jsonb_typeof(c.wp->0->'lat') = 'number' AND jsonb_typeof(c.wp->0->'lng') = 'number', false) AS placed,
    NOT EXISTS (SELECT 1 FROM jsonb_array_elements(c.legs) e WHERE jsonb_typeof(e) <> 'object') AS legs_ok
  FROM c
),
u AS (
  SELECT
    p.id,
    (p.course - 'courseId')
      || jsonb_build_object('waypoints', '[]'::jsonb)
      || CASE
        WHEN p.placed AND NOT (p.course ? 'anchor')
          THEN jsonb_build_object('anchor', jsonb_build_object('lat', p.wp->0->'lat', 'lng', p.wp->0->'lng'))
        ELSE '{}'::jsonb
      END
      || CASE
        WHEN p.placed AND NOT p.edited AND p.m > 0 AND p.legs_ok AND NOT (p.course ? 'legs')
          THEN jsonb_build_object('legs', (
            SELECT jsonb_agg(jsonb_build_object('distanceNm', l->'distanceNm', 'bearingDeg', l->'bearingDeg') ORDER BY i)
            FROM jsonb_array_elements(p.legs) WITH ORDINALITY AS t(l, i)
          ))
        ELSE '{}'::jsonb
      END AS course,
    CASE
      WHEN p.placed AND NOT p.edited AND p.m > 0 AND p.legs_ok AND p.m = p.n - 1 THEN (
        SELECT jsonb_agg(
          CASE WHEN t.l ? 'name' OR x.name IS NULL THEN t.l ELSE t.l || jsonb_build_object('name', x.name) END
          ORDER BY t.i
        )
        FROM jsonb_array_elements(p.legs) WITH ORDINALITY AS t(l, i)
        CROSS JOIN LATERAL (
          SELECT
            CASE WHEN jsonb_typeof(p.wp->(t.i::int - 1)->'label') = 'string'
              THEN btrim(p.wp->(t.i::int - 1)->>'label', E' \t\r\n') END AS a,
            CASE WHEN jsonb_typeof(p.wp->(t.i::int)->'label') = 'string'
              THEN btrim(p.wp->(t.i::int)->>'label', E' \t\r\n') END AS b
        ) ends
        CROSS JOIN LATERAL (
          SELECT CASE
            WHEN ends.a IS NULL OR ends.b IS NULL OR ends.a = '' OR ends.b = '' THEN NULL
            WHEN char_length(ends.a || ' – ' || ends.b) > 80 THEN left(ends.a || ' – ' || ends.b, 79) || '…'
            ELSE ends.a || ' – ' || ends.b
          END AS name
        ) x
      )
    END AS course_legs
  FROM p
)
UPDATE race_starts rs
SET
  course = u.course,
  course_legs = coalesce(u.course_legs, rs.course_legs)
FROM u
WHERE rs.id = u.id;
