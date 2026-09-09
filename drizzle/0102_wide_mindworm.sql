ALTER TABLE "competitors" ADD COLUMN "clubs" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "competitors" SET "clubs" = jsonb_build_array("club") WHERE btrim("club") <> '';
