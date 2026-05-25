CREATE TABLE "published_blobs" (
	"key" text PRIMARY KEY NOT NULL,
	"html" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "published_series" (
	"series_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"slug" text NOT NULL,
	"pages" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_version" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "published_series" ADD CONSTRAINT "published_series_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "published_series" ADD CONSTRAINT "published_series_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "published_series_slug_uidx" ON "published_series" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "published_series_workspace_idx" ON "published_series" USING btree ("workspace_id");