ALTER TABLE "sub_series" ADD COLUMN "fleet_ids" uuid[];--> statement-breakpoint
ALTER TABLE "sub_series_races" ADD COLUMN "excluded_fleet_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;