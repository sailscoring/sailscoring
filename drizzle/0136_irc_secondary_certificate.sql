ALTER TABLE "competitors" ADD COLUMN "irc_secondary_tcc" real;--> statement-breakpoint
ALTER TABLE "competitors" ADD COLUMN "irc_secondary_cert" jsonb;--> statement-breakpoint
ALTER TABLE "race_rating_overrides" ADD COLUMN "certificate" text;