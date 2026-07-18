-- Backfill: each single person field becomes a one-element list; the primary
-- name is required, so an empty name still yields a one-element list of ''.
UPDATE "competitors" SET "names" = jsonb_build_array("name");--> statement-breakpoint
UPDATE "competitors"
SET "owners" = jsonb_build_array("owner")
WHERE "owner" IS NOT NULL AND "owner" <> '';--> statement-breakpoint
UPDATE "competitors"
SET "helms" = jsonb_build_array("helm")
WHERE "helm" IS NOT NULL AND "helm" <> '';--> statement-breakpoint
ALTER TABLE "competitors" ALTER COLUMN "names" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "competitors" DROP COLUMN "name";--> statement-breakpoint
ALTER TABLE "competitors" DROP COLUMN "owner";--> statement-breakpoint
ALTER TABLE "competitors" DROP COLUMN "helm";
