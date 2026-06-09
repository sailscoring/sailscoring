ALTER TABLE "series_revision" ALTER COLUMN "snapshot" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "series_revision" ADD COLUMN "snapshot_gz" "bytea";