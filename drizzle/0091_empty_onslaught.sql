ALTER TABLE "fleets" DROP CONSTRAINT "fleets_scoring_system_chk";--> statement-breakpoint
ALTER TABLE "competitors" ADD COLUMN "orc_cert" jsonb;--> statement-breakpoint
ALTER TABLE "fleets" ADD COLUMN "orc_profile" jsonb;--> statement-breakpoint
ALTER TABLE "race_starts" ADD COLUMN "distance_nm" real;--> statement-breakpoint
ALTER TABLE "race_starts" ADD COLUMN "orc_scoring_wind" real;--> statement-breakpoint
ALTER TABLE "race_starts" ADD COLUMN "course_legs" jsonb;--> statement-breakpoint
ALTER TABLE "race_starts" ADD COLUMN "orc_option" text;--> statement-breakpoint
ALTER TABLE "fleets" ADD CONSTRAINT "fleets_scoring_system_chk" CHECK ("fleets"."scoring_system" in ('scratch','irc','py','nhc','echo','vprs','orc'));