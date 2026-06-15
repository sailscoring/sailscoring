CREATE TABLE "competitor_identities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"label" text NOT NULL,
	"sail_number" text DEFAULT '' NOT NULL,
	"boat_name" text,
	"club" text,
	"nationality" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
ALTER TABLE "competitors" ADD COLUMN "identity_id" uuid;--> statement-breakpoint
ALTER TABLE "competitor_identities" ADD CONSTRAINT "competitor_identities_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "competitor_identities_workspace_idx" ON "competitor_identities" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_identity_id_competitor_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."competitor_identities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "competitors_identity_idx" ON "competitors" USING btree ("identity_id");