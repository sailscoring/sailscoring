ALTER TABLE "competitors" ADD COLUMN "custom_fields" jsonb;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "custom_fields" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "results_columns" jsonb;