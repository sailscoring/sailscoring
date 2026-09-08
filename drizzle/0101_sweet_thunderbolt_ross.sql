ALTER TABLE "series" ADD COLUMN "series_note" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "page_notes" jsonb DEFAULT '[]'::jsonb NOT NULL;