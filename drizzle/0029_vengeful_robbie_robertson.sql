ALTER TABLE "fleets" DROP CONSTRAINT "fleets_scoring_system_chk";--> statement-breakpoint
ALTER TABLE "race_rating_overrides" DROP CONSTRAINT "race_rating_overrides_field_chk";--> statement-breakpoint
ALTER TABLE "competitors" ADD COLUMN "vprs_tcc" real;--> statement-breakpoint
ALTER TABLE "fleets" ADD CONSTRAINT "fleets_scoring_system_chk" CHECK ("fleets"."scoring_system" in ('scratch','irc','py','nhc','echo','vprs'));--> statement-breakpoint
ALTER TABLE "race_rating_overrides" ADD CONSTRAINT "race_rating_overrides_field_chk" CHECK ("race_rating_overrides"."field" in ('ircTcc','pyNumber','vprsTcc'));