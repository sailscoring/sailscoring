ALTER TABLE "flag_locker_defaults" DROP CONSTRAINT "flag_locker_defaults_venue_logo_id_flag_locker_logos_id_fk";
--> statement-breakpoint
ALTER TABLE "flag_locker_defaults" DROP CONSTRAINT "flag_locker_defaults_event_logo_id_flag_locker_logos_id_fk";
--> statement-breakpoint
ALTER TABLE "flag_locker_defaults" DROP COLUMN "venue_logo_id";--> statement-breakpoint
ALTER TABLE "flag_locker_defaults" DROP COLUMN "event_logo_id";