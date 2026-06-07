CREATE TABLE "flag_locker_defaults" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"venue_logo_id" uuid,
	"event_logo_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
ALTER TABLE "flag_locker_defaults" ADD CONSTRAINT "flag_locker_defaults_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flag_locker_defaults" ADD CONSTRAINT "flag_locker_defaults_venue_logo_id_flag_locker_logos_id_fk" FOREIGN KEY ("venue_logo_id") REFERENCES "public"."flag_locker_logos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flag_locker_defaults" ADD CONSTRAINT "flag_locker_defaults_event_logo_id_flag_locker_logos_id_fk" FOREIGN KEY ("event_logo_id") REFERENCES "public"."flag_locker_logos"("id") ON DELETE set null ON UPDATE no action;