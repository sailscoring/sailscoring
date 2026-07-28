ALTER TABLE "race_starts" ADD COLUMN "stage" text;--> statement-breakpoint
ALTER TABLE "race_starts" ADD COLUMN "stage_race_number" integer;--> statement-breakpoint
ALTER TABLE "race_starts" ADD COLUMN "first_place_offset" integer;--> statement-breakpoint
UPDATE "race_starts" rs
SET "stage" = r."stage",
    "stage_race_number" = r."stage_race_number",
    "first_place_offset" = r."first_place_offset"
FROM "races" r
WHERE rs."race_id" = r."id" AND r."stage" IS NOT NULL;