CREATE TABLE "competitor_identity_links" (
	"competitor_id" uuid NOT NULL,
	"identity_id" uuid NOT NULL,
	"workspace_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competitor_identity_links_competitor_id_identity_id_pk" PRIMARY KEY("competitor_id","identity_id")
);
--> statement-breakpoint
ALTER TABLE "competitors" DROP CONSTRAINT "competitors_identity_id_competitor_identities_id_fk";
--> statement-breakpoint
DROP INDEX "competitors_identity_idx";--> statement-breakpoint
ALTER TABLE "competitor_identity_links" ADD CONSTRAINT "competitor_identity_links_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_identity_links" ADD CONSTRAINT "competitor_identity_links_identity_id_competitor_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."competitor_identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_identity_links" ADD CONSTRAINT "competitor_identity_links_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "competitor_identity_links_identity_idx" ON "competitor_identity_links" USING btree ("identity_id");--> statement-breakpoint
CREATE INDEX "competitor_identity_links_workspace_idx" ON "competitor_identity_links" USING btree ("workspace_id");--> statement-breakpoint
-- Backfill: every linked competitor becomes one membership row.
INSERT INTO "competitor_identity_links" ("competitor_id", "identity_id", "workspace_id")
SELECT "id", "identity_id", "workspace_id"
FROM "competitors"
WHERE "identity_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "competitors" DROP COLUMN "identity_id";