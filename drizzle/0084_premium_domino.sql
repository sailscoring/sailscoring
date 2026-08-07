ALTER TABLE "competitors" ADD COLUMN "alternative_sail_numbers" jsonb;--> statement-breakpoint
ALTER TABLE "finishes" ADD COLUMN "matched_on" text;--> statement-breakpoint
ALTER TABLE "finishes" ADD COLUMN "entered_sail_number" text;