ALTER TABLE "competitors" ADD COLUMN "subdivisions" jsonb;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "subdivision_axes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
-- Backfill: collapse the single subdivision_label / subdivision pair into
-- one named axis. Give every series that actually used the field (enabled, a
-- non-default label, or any competitor value) a single axis with a stable id and
-- the old label; series that never used it keep the empty-array default.
UPDATE "series" s
SET "subdivision_axes" = jsonb_build_array(
  jsonb_build_object('id', gen_random_uuid()::text, 'label', s."subdivision_label")
)
WHERE s."enabled_competitor_fields" @> '["subdivision"]'::jsonb
   OR s."subdivision_label" <> 'Division'
   OR EXISTS (
     SELECT 1 FROM "competitors" c
     WHERE c."series_id" = s."id"
       AND c."subdivision" IS NOT NULL AND c."subdivision" <> ''
   );--> statement-breakpoint
-- Map each competitor's old single value onto its series' new axis id.
UPDATE "competitors" c
SET "subdivisions" = jsonb_build_object(s."subdivision_axes" -> 0 ->> 'id', c."subdivision")
FROM "series" s
WHERE c."series_id" = s."id"
  AND c."subdivision" IS NOT NULL AND c."subdivision" <> ''
  AND jsonb_array_length(s."subdivision_axes") >= 1;--> statement-breakpoint
ALTER TABLE "competitors" DROP COLUMN "subdivision";--> statement-breakpoint
ALTER TABLE "series" DROP COLUMN "subdivision_label";
