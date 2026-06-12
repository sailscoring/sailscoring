CREATE TABLE "deleted_series" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"series_id" uuid NOT NULL,
	"name" text NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_by" text,
	"had_publication" boolean DEFAULT false NOT NULL,
	"snapshot_gz" "bytea" NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deleted_series" ADD CONSTRAINT "deleted_series_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deleted_series_workspace_idx" ON "deleted_series" USING btree ("workspace_id","deleted_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "deleted_series_purge_idx" ON "deleted_series" USING btree ("deleted_at");