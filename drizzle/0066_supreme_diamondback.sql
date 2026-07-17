ALTER TABLE "races" ADD COLUMN "last_finisher_time" text;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "results_status" text DEFAULT 'provisional' NOT NULL;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "finalised_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "protest_time_limit" jsonb;--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_results_status_chk" CHECK ("series"."results_status" in ('provisional','final'));