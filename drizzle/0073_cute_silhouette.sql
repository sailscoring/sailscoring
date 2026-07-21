CREATE TABLE "split_rounds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"series_id" uuid NOT NULL,
	"workspace_id" text NOT NULL,
	"stage" text NOT NULL,
	"from_stage_race" integer NOT NULL,
	"fleet_ids" uuid[] NOT NULL,
	"method" text NOT NULL,
	"basis" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
ALTER TABLE "races" ADD COLUMN "stage" text;--> statement-breakpoint
ALTER TABLE "races" ADD COLUMN "stage_race_number" integer;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "qf_config" jsonb;--> statement-breakpoint
ALTER TABLE "split_rounds" ADD CONSTRAINT "split_rounds_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "split_rounds" ADD CONSTRAINT "split_rounds_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "split_rounds_series_idx" ON "split_rounds" USING btree ("series_id");