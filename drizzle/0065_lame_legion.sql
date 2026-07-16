CREATE TABLE "as_published_rankings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"season" integer NOT NULL,
	"fleet_label" text,
	"rule_note" text,
	"source" jsonb,
	"table" jsonb NOT NULL,
	"ranked_count" integer NOT NULL,
	"hash" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
ALTER TABLE "as_published_rankings" ADD CONSTRAINT "as_published_rankings_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "as_published_rankings_workspace_idx" ON "as_published_rankings" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "as_published_rankings_workspace_slug_uidx" ON "as_published_rankings" USING btree ("workspace_id","slug");