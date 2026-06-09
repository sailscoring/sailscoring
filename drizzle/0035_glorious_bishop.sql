CREATE TABLE "series_revision" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"series_id" uuid NOT NULL,
	"actor_user_id" text,
	"kind" text DEFAULT 'auto' NOT NULL,
	"label" text,
	"summary" text,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "series_revision" ADD CONSTRAINT "series_revision_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_revision" ADD CONSTRAINT "series_revision_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "series_revision_series_created_idx" ON "series_revision" USING btree ("series_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "series_revision_coalesce_idx" ON "series_revision" USING btree ("series_id","actor_user_id","kind");