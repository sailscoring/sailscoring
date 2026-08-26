ALTER TABLE "finishes" ADD COLUMN "track_data" jsonb;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "publish_track_data" boolean DEFAULT false NOT NULL;