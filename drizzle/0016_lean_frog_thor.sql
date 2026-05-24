ALTER TABLE "competitors" ADD COLUMN "subdivision" text;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "subdivision_label" text DEFAULT 'Division' NOT NULL;