ALTER TABLE "competitors" ADD COLUMN "updated_by" text;--> statement-breakpoint
ALTER TABLE "finishes" ADD COLUMN "updated_by" text;--> statement-breakpoint
ALTER TABLE "fleets" ADD COLUMN "updated_by" text;--> statement-breakpoint
ALTER TABLE "ftp_servers" ADD COLUMN "updated_by" text;--> statement-breakpoint
ALTER TABLE "race_starts" ADD COLUMN "updated_by" text;--> statement-breakpoint
ALTER TABLE "races" ADD COLUMN "updated_by" text;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "updated_by" text;