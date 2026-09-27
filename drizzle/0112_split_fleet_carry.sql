-- The score a boat takes into each split-fleet stage (series-file v59,
-- public export v5): `medal.carry` in place of the `medal.carryTransform`
-- block, which only ever meant 'halved', and a `final` block carrying the
-- final series' own carry and tie-break.
--
-- Expand only: `medal.carryTransform` stays on the rows, because the build
-- still serving until cutover reads it to halve the ILCA championships'
-- carry. The current build ignores it and drops it on the next write.
UPDATE series
SET qf_config = jsonb_set(
  qf_config,
  '{medal,carry}',
  to_jsonb(CASE
    WHEN qf_config->'medal'->'carryTransform' IS NOT NULL THEN 'halved'
    ELSE 'net'
  END)
)
WHERE qf_config IS NOT NULL
  AND qf_config ? 'medal'
  AND NOT (qf_config->'medal') ? 'carry';
--> statement-breakpoint
UPDATE series
SET qf_config = qf_config || '{"final": {"carry": "net", "tieBreak": "a8"}}'::jsonb
WHERE qf_config IS NOT NULL
  AND NOT qf_config ? 'final';
