-- ADR-013: `dnf_scoring = 'startingAreaInclDnc'` (DBSC SI A13.2) is removed.
-- A series on it becomes A5.3 with DNC changed to score the same as DNF,
-- which is the same rule written as a scoring code, so no race rescores.
-- Mirrors `lib/dnc-rule-upgrade.ts`, which upgrades the same setting in files,
-- revision snapshots, Trash tombstones and published data files on reading.
ALTER TABLE "series" DROP CONSTRAINT "series_dnf_scoring_chk";--> statement-breakpoint
UPDATE "series"
SET
  "dnf_scoring" = 'startingArea',
  "scoring_codes" = CASE
    WHEN EXISTS (SELECT 1 FROM jsonb_array_elements("scoring_codes") AS c WHERE c->>'code' = 'DNC')
      THEN "scoring_codes"
    ELSE "scoring_codes" || '[{"code":"DNC","kind":"replace","rule":{"type":"sameAs","code":"DNF"},"discardable":true}]'::jsonb
  END
WHERE "dnf_scoring" = 'startingAreaInclDnc';--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_dnf_scoring_chk" CHECK ("series"."dnf_scoring" in ('seriesEntries','startingArea'));
