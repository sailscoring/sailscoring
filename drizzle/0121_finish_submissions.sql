CREATE TABLE "finish_submissions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"race_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"recorded_by" text,
	"starts" jsonb NOT NULL,
	"finishes" jsonb NOT NULL,
	"complete" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"submitted_by_user_id" text,
	"via_client_id" text,
	"via_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_by_user_id" text,
	"reviewed_at" timestamp with time zone,
	"reviewed_revision" integer
);
--> statement-breakpoint
ALTER TABLE "finish_submissions" ADD CONSTRAINT "finish_submissions_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finish_submissions" ADD CONSTRAINT "finish_submissions_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "finish_submissions_race_idx" ON "finish_submissions" USING btree ("race_id");--> statement-breakpoint
CREATE INDEX "finish_submissions_workspace_status_idx" ON "finish_submissions" USING btree ("workspace_id","status");