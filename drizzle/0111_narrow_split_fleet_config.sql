-- Narrow the stored split-fleet configuration to the settings the
-- championships scored with it used (ADR-013). This mirrors
-- lib/split-fleet-config-upgrade.ts, which does the same for the copies the
-- database does not hold: files, revision snapshots, Trash tombstones and
-- published exports.
--
-- 1. Refuse to run if any configuration carries a removed value that would
--    score its championship differently, given the racing it has.
-- 2. Rename the races whose labels change (continuous Q under the 2026 ILCA
--    wording becomes QP and QE), from the configuration as it was.
-- 3. Rewrite every configuration in the current shape.
DO $$
DECLARE
  refused text;
BEGIN
  SELECT string_agg(format('%s (%s): %s', s.name, s.id, v.reasons), E'\n')
  INTO refused
  FROM series s
  CROSS JOIN LATERAL (
    SELECT
      s.qf_config AS c,
      coalesce(s.qf_config->'split'->>'kind', 'equal-blocks') <> 'none' AS divided,
      EXISTS (
        SELECT 1 FROM race_starts rs JOIN races r ON r.id = rs.race_id
        WHERE r.series_id = s.id AND rs.stage IS NOT NULL
      ) AS racing,
      EXISTS (
        SELECT 1 FROM split_rounds sr WHERE sr.series_id = s.id AND sr.stage = 'medal'
      ) AS medal_selected,
      EXISTS (
        SELECT 1 FROM finishes f
        JOIN race_starts rs ON rs.race_id = f.race_id
        JOIN races r ON r.id = rs.race_id
        WHERE r.series_id = s.id AND rs.stage = 'medal'
      ) AS medal_sailed
  ) x
  CROSS JOIN LATERAL (
    SELECT concat_ws('; ',
      CASE WHEN x.racing AND x.c ? 'carry' AND x.c->>'carry' <> 'points'
        THEN 'how scores carry' END,
      CASE WHEN x.racing AND x.c->'split'->>'kind' = 'fixed-top'
        THEN 'a fixed top-fleet size' END,
      CASE WHEN x.racing AND coalesce(x.c->'codeBasis'->>'qualifying', 'largest-fleet') <> 'largest-fleet'
        THEN 'the non-finisher score' END,
      CASE WHEN x.racing AND x.divided AND coalesce(x.c->'codeBasis'->>'final', 'own-fleet') <> 'own-fleet'
        THEN 'the final-series non-finisher score' END,
      CASE WHEN x.racing AND coalesce(x.c->>'equalization', 'abandon-extra-races') <> 'abandon-extra-races'
        THEN 'equalising scores at the end of qualifying' END,
      CASE WHEN x.racing AND x.divided AND coalesce(x.c->>'maxFinalDiscards', '1') <> '1'
        THEN 'the cap on final-series discards' END,
      CASE WHEN x.racing AND x.divided AND coalesce(x.c->>'protectLoneFinalRace', 'true') <> 'true'
        THEN 'protecting a lone final-series race' END,
      CASE WHEN x.medal_selected AND x.c->'medal' IS NULL
        THEN 'no deciding stage' END,
      CASE WHEN x.racing AND coalesce(x.c->'medal'->>'multiplier', '2') NOT IN ('1', '2')
        THEN 'the medal race multiplier' END,
      CASE WHEN x.medal_selected
          AND coalesce(x.c->'medal'->>'tieBreak', '') NOT IN ('last-race', 'medal-race-then-a8')
        THEN 'the medal tie-break' END,
      CASE WHEN x.medal_selected AND x.c->'medal'->>'companionRace' = 'dnc'
        THEN 'scoring DNC in the medal race' END,
      CASE WHEN x.medal_selected AND x.c->'medal'->'carryTransform' IS NOT NULL
          AND (x.c->'medal'->'carryTransform'->>'kind' IS DISTINCT FROM 'divide'
            OR x.c->'medal'->'carryTransform'->>'by' IS DISTINCT FROM '2'
            OR x.c->'medal'->'carryTransform'->>'rounding' IS DISTINCT FROM 'half-up')
        THEN 'the carried score' END,
      CASE WHEN x.medal_selected AND NOT x.medal_sailed
          AND x.c->'medal'->'carryTransform' IS NOT NULL
          AND coalesce(x.c->'medal'->'carryTransform'->>'appliesFrom', 'medal-fleet-selected') <> 'first-medal-race'
        THEN 'halving the score before a medal race is sailed' END
    ) AS reasons
  ) v
  WHERE s.qf_config IS NOT NULL AND v.reasons <> '';

  IF refused IS NOT NULL THEN
    RAISE EXCEPTION E'split-fleet configurations that would score differently once narrowed:\n%', refused;
  END IF;
END $$;
--> statement-breakpoint
DO $$
DECLARE
  s record;
  st record;
  vocab text;
  continuous boolean;
  q_races int;
  old_q text; old_f text; old_m text;
  new_q text; new_f text; new_m text;
  before text; after text;
BEGIN
  FOR s IN SELECT id, qf_config AS c FROM series WHERE qf_config IS NOT NULL LOOP
    vocab := coalesce(
      s.c->>'vocabulary',
      CASE WHEN s.c->'stageNaming'->>'continuousOpeningNumbers' = 'true'
        THEN 'qualification-final' ELSE 'opening-medal' END);
    continuous := coalesce((s.c->'raceLabels'->>'continuousOpeningNumbers')::boolean,
      vocab = 'qualification-final');
    old_q := coalesce(s.c->'raceLabels'->'prefixes'->>'qualifying', 'Q');
    old_f := coalesce(s.c->'raceLabels'->'prefixes'->>'final',
      CASE WHEN vocab = 'qualification-final' THEN 'Q' ELSE 'F' END);
    old_m := coalesce(s.c->'raceLabels'->'prefixes'->>'medal',
      CASE WHEN vocab = 'qualification-final' THEN 'F' ELSE 'M' END);
    IF vocab = 'qualification-final' THEN
      new_q := 'QP'; new_f := 'QE'; new_m := 'F';
    ELSE
      new_q := 'Q'; new_f := 'F'; new_m := 'M';
    END IF;
    IF coalesce(s.c->'split'->>'kind', 'equal-blocks') = 'none' THEN
      new_q := 'Q';
    END IF;
    SELECT coalesce(max(rs.stage_race_number), 0) INTO q_races
    FROM race_starts rs JOIN races r ON r.id = rs.race_id
    WHERE r.series_id = s.id AND rs.stage = 'qualifying';

    FOR st IN
      SELECT r.id AS race_id, rs.stage, rs.stage_race_number AS n
      FROM race_starts rs JOIN races r ON r.id = rs.race_id
      WHERE r.series_id = s.id AND rs.stage IS NOT NULL AND rs.stage_race_number IS NOT NULL
    LOOP
      before := CASE
        WHEN st.stage = 'qualifying' THEN old_q || st.n
        WHEN st.stage = 'final' AND continuous THEN old_q || (q_races + st.n)
        WHEN st.stage = 'final' THEN old_f || st.n
        ELSE old_m || st.n END;
      after := CASE
        WHEN st.stage = 'qualifying' THEN new_q || st.n
        WHEN st.stage = 'final' THEN new_f || st.n
        ELSE new_m || st.n END;
      IF before <> after THEN
        UPDATE races
        SET name = regexp_replace(name, '(^|[^A-Za-z0-9])' || before || '(?![0-9])', '\1' || after)
        WHERE id = st.race_id AND name IS NOT NULL;
      END IF;
    END LOOP;
  END LOOP;
END $$;
--> statement-breakpoint
UPDATE series
SET qf_config = jsonb_build_object(
  'qualifyingFleets', coalesce(qf_config->'qualifyingFleets', '[]'::jsonb),
  'finalFleets', CASE WHEN coalesce(qf_config->'split'->>'kind', 'equal-blocks') = 'none'
    THEN '[]'::jsonb ELSE coalesce(qf_config->'finalFleets', '[]'::jsonb) END,
  'split', CASE WHEN coalesce(qf_config->'split'->>'kind', 'equal-blocks') = 'none'
    THEN '{"kind": "none"}'::jsonb ELSE '{"kind": "equal-blocks"}'::jsonb END,
  'discardThresholds', coalesce(qf_config->'discardThresholds', '[]'::jsonb),
  'vocabulary', coalesce(
    qf_config->>'vocabulary',
    CASE WHEN qf_config->'stageNaming'->>'continuousOpeningNumbers' = 'true'
      THEN 'qualification-final' ELSE 'opening-medal' END),
  'medal', jsonb_strip_nulls(jsonb_build_object(
    'size', coalesce(qf_config->'medal'->'size', '10'::jsonb),
    'multiplier', CASE WHEN qf_config->'medal'->>'multiplier' = '1'
      THEN '1'::jsonb ELSE '2'::jsonb END,
    'carryTransform', CASE WHEN qf_config->'medal'->'carryTransform' IS NOT NULL
      THEN '{"kind": "divide", "by": 2, "rounding": "half-up"}'::jsonb END,
    'tieBreak', CASE WHEN qf_config->'medal'->>'tieBreak' = 'last-race'
      THEN 'last-race' ELSE 'medal-race-then-a8' END
  ))
)
WHERE qf_config IS NOT NULL;
