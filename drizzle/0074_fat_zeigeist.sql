ALTER TABLE "competitors" ADD COLUMN "entry_number" text;--> statement-breakpoint
ALTER TABLE "competitors" ADD COLUMN "seed" integer;--> statement-breakpoint
ALTER TABLE "races" ADD COLUMN "first_place_offset" integer;--> statement-breakpoint
ALTER TABLE "split_rounds" ADD COLUMN "overrides" jsonb;--> statement-breakpoint
ALTER TABLE "split_rounds" ADD COLUMN "published_at" timestamp with time zone;