ALTER TABLE "series_revision" ADD COLUMN "session_key" text;--> statement-breakpoint
ALTER TABLE "series_revision" ADD COLUMN "sealed" boolean DEFAULT false NOT NULL;