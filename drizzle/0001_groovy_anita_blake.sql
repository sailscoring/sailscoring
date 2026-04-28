CREATE TABLE "competitors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"series_id" uuid NOT NULL,
	"workspace_id" text NOT NULL,
	"fleet_ids" uuid[] NOT NULL,
	"sail_number" text NOT NULL,
	"boat_name" text,
	"boat_class" text,
	"name" text NOT NULL,
	"owner" text,
	"helm" text,
	"crew_name" text,
	"club" text DEFAULT '' NOT NULL,
	"gender" text DEFAULT '' NOT NULL,
	"age" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"irc_tcc" real,
	"py_number" real,
	"nhc_starting_tcf" real,
	"echo_starting_tcf" real,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competitors_gender_chk" CHECK ("competitors"."gender" in ('M','F',''))
);
--> statement-breakpoint
CREATE TABLE "finishes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"race_id" uuid NOT NULL,
	"competitor_id" uuid,
	"unknown_sail_number" text,
	"sort_order" integer,
	"finish_time" text,
	"result_code" text,
	"start_present" boolean,
	"penalty_code" text,
	"penalty_override" real,
	"redress_method" text,
	"redress_exclude_races" jsonb,
	"redress_include_races" jsonb,
	"redress_include_all_later" boolean DEFAULT false NOT NULL,
	"redress_points" real,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fleets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"series_id" uuid NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"display_order" integer NOT NULL,
	"scoring_system" text NOT NULL,
	"nhc_alpha" real,
	"echo_alpha" real,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fleets_scoring_system_chk" CHECK ("fleets"."scoring_system" in ('scratch','irc','py','nhc','echo'))
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"workspace_id" text NOT NULL,
	"key" text NOT NULL,
	"status" integer NOT NULL,
	"body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nhc_tcf_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"race_id" uuid NOT NULL,
	"competitor_id" uuid NOT NULL,
	"fleet_id" uuid NOT NULL,
	"tcf_applied" real NOT NULL,
	"new_tcf" real NOT NULL
);
--> statement-breakpoint
CREATE TABLE "race_starts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"race_id" uuid NOT NULL,
	"fleet_ids" uuid[] NOT NULL,
	"start_time" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "races" (
	"id" uuid PRIMARY KEY NOT NULL,
	"series_id" uuid NOT NULL,
	"workspace_id" text NOT NULL,
	"race_number" integer NOT NULL,
	"date" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "series" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "venue" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "start_date" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "end_date" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "venue_logo_url" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "event_logo_url" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "last_snapshot_id" uuid;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "last_saved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "last_modified_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "snapshot_history" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "scoring_mode" text DEFAULT 'scratch' NOT NULL;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "default_start_sequence" jsonb;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "discard_thresholds" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "dnf_scoring" text DEFAULT 'seriesEntries' NOT NULL;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "ftp_host" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "ftp_path" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "bilge_bundle" jsonb;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "include_json_export" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "publish_rating_calculations" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "enabled_competitor_fields" jsonb DEFAULT '["boatName","club"]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "primary_person_label" text DEFAULT 'competitor' NOT NULL;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finishes" ADD CONSTRAINT "finishes_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finishes" ADD CONSTRAINT "finishes_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleets" ADD CONSTRAINT "fleets_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleets" ADD CONSTRAINT "fleets_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nhc_tcf_records" ADD CONSTRAINT "nhc_tcf_records_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nhc_tcf_records" ADD CONSTRAINT "nhc_tcf_records_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nhc_tcf_records" ADD CONSTRAINT "nhc_tcf_records_fleet_id_fleets_id_fk" FOREIGN KEY ("fleet_id") REFERENCES "public"."fleets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_starts" ADD CONSTRAINT "race_starts_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "races" ADD CONSTRAINT "races_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "races" ADD CONSTRAINT "races_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "competitors_series_idx" ON "competitors" USING btree ("series_id");--> statement-breakpoint
CREATE INDEX "competitors_workspace_idx" ON "competitors" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "competitors_fleet_gin" ON "competitors" USING gin ("fleet_ids");--> statement-breakpoint
CREATE INDEX "finishes_race_idx" ON "finishes" USING btree ("race_id");--> statement-breakpoint
CREATE INDEX "finishes_competitor_idx" ON "finishes" USING btree ("competitor_id");--> statement-breakpoint
CREATE INDEX "fleets_series_order_idx" ON "fleets" USING btree ("series_id","display_order");--> statement-breakpoint
CREATE INDEX "fleets_workspace_idx" ON "fleets" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_keys_pk" ON "idempotency_keys" USING btree ("workspace_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "nhc_tcf_records_uidx" ON "nhc_tcf_records" USING btree ("race_id","competitor_id","fleet_id");--> statement-breakpoint
CREATE INDEX "nhc_tcf_records_race_idx" ON "nhc_tcf_records" USING btree ("race_id");--> statement-breakpoint
CREATE INDEX "race_starts_race_idx" ON "race_starts" USING btree ("race_id");--> statement-breakpoint
CREATE UNIQUE INDEX "races_series_number_uidx" ON "races" USING btree ("series_id","race_number");--> statement-breakpoint
CREATE INDEX "races_workspace_idx" ON "races" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "series_workspace_idx" ON "series" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_scoring_mode_chk" CHECK ("series"."scoring_mode" in ('scratch','handicap'));--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_dnf_scoring_chk" CHECK ("series"."dnf_scoring" in ('seriesEntries','startingArea'));--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_primary_person_label_chk" CHECK ("series"."primary_person_label" in ('competitor','entrant','helm','owner'));