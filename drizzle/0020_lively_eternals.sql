-- published_series is re-keyed for the workspace-namespaced URL model (#153):
-- surrogate id PK, (workspace_id, slug) unique, and series_id decoupled
-- (nullable, ON DELETE SET NULL) so deleting a series orphans its page.
-- The table is brand-new (added in 0018) and unused, so a drop-and-recreate is
-- safe and avoids an awkward primary-key swap.
DROP TABLE IF EXISTS "published_series" CASCADE;
--> statement-breakpoint
CREATE TABLE "published_series" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"series_id" uuid,
	"slug" text NOT NULL,
	"pages" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_version" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "published_series" ADD CONSTRAINT "published_series_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "published_series" ADD CONSTRAINT "published_series_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "published_series_workspace_slug_uidx" ON "published_series" USING btree ("workspace_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "published_series_series_uidx" ON "published_series" USING btree ("series_id") WHERE "published_series"."series_id" is not null;
