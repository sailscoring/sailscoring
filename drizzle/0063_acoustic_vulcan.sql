CREATE TABLE "rankings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text,
	"config" jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
ALTER TABLE "rankings" ADD CONSTRAINT "rankings_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rankings_workspace_idx" ON "rankings" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rankings_workspace_slug_uidx" ON "rankings" USING btree ("workspace_id","slug") WHERE "rankings"."slug" is not null;