CREATE TABLE "published_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"path" text NOT NULL,
	"label" text,
	"season" text
);
--> statement-breakpoint
ALTER TABLE "published_folders" ADD CONSTRAINT "published_folders_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "published_folders_workspace_path_uidx" ON "published_folders" USING btree ("workspace_id","path");