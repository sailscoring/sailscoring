CREATE TABLE "as_published_results" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"series_id" uuid NOT NULL,
	"fleet_id" uuid NOT NULL,
	"results" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
ALTER TABLE "competitor_identities" ADD COLUMN "managed_by" text DEFAULT 'app' NOT NULL;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "as_published" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "as_published_hash" text;--> statement-breakpoint
ALTER TABLE "as_published_results" ADD CONSTRAINT "as_published_results_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "as_published_results" ADD CONSTRAINT "as_published_results_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "as_published_results" ADD CONSTRAINT "as_published_results_fleet_id_fleets_id_fk" FOREIGN KEY ("fleet_id") REFERENCES "public"."fleets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "as_published_results_workspace_idx" ON "as_published_results" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "as_published_results_series_idx" ON "as_published_results" USING btree ("series_id");--> statement-breakpoint
CREATE UNIQUE INDEX "as_published_results_series_fleet_uidx" ON "as_published_results" USING btree ("series_id","fleet_id");--> statement-breakpoint
ALTER TABLE "competitor_identities" ADD CONSTRAINT "competitor_identities_managed_by_chk" CHECK ("competitor_identities"."managed_by" in ('app','archive'));