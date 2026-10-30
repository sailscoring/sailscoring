-- The course library's last traces go (ADR-013). Migration 0123 brought
-- every race start's course up to the shape series-file v71 gives it, but
-- kept an empty `waypoints` in every row for the build it replaced, and that
-- build went on writing courses for a few seconds after it ran. So:
--
-- 1. 0123's conversion runs again, for any row such a build left naming its
--    library course or carrying waypoints. A row 0123 already brought
--    forward is left as it is.
-- 2. No row keeps `waypoints` or `courseId` any longer.
-- 3. The library's marks and courses go. Nothing has read them since 0123.
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
    (p.course - 'courseId' - 'waypoints')
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
WHERE rs.id = u.id;--> statement-breakpoint
UPDATE race_starts
SET course = course - 'waypoints' - 'courseId'
WHERE course ?| ARRAY['waypoints', 'courseId'];--> statement-breakpoint
DROP TABLE "series_courses" CASCADE;--> statement-breakpoint
DROP TABLE "series_marks" CASCADE;
