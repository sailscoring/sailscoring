-- Backfill: a single crew_name becomes a one-element crew_names list.
UPDATE "competitors"
SET "crew_names" = jsonb_build_array("crew_name")
WHERE "crew_name" IS NOT NULL AND "crew_name" <> '';--> statement-breakpoint
ALTER TABLE "competitors" DROP COLUMN "crew_name";
