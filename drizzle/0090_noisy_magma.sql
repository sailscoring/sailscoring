ALTER TABLE "fleets" DROP CONSTRAINT "fleets_scoring_system_chk";--> statement-breakpoint
ALTER TABLE "competitors" ADD COLUMN "orc_cert" jsonb;--> statement-breakpoint
ALTER TABLE "fleets" ADD COLUMN "orc_profile" jsonb;--> statement-breakpoint
ALTER TABLE "fleets" ADD CONSTRAINT "fleets_scoring_system_chk" CHECK ("fleets"."scoring_system" in ('scratch','irc','py','nhc','echo','vprs','orc'));