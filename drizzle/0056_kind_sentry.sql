ALTER TABLE "series" ADD COLUMN "ftp_last_uploaded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "ftp_uploaded_version" integer;