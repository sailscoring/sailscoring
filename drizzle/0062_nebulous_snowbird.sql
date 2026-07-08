CREATE TABLE "competitor_identity_distinctions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"identity_a_id" uuid NOT NULL,
	"identity_b_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
ALTER TABLE "competitor_identities" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "competitor_identity_distinctions" ADD CONSTRAINT "competitor_identity_distinctions_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_identity_distinctions" ADD CONSTRAINT "competitor_identity_distinctions_identity_a_id_competitor_identities_id_fk" FOREIGN KEY ("identity_a_id") REFERENCES "public"."competitor_identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_identity_distinctions" ADD CONSTRAINT "competitor_identity_distinctions_identity_b_id_competitor_identities_id_fk" FOREIGN KEY ("identity_b_id") REFERENCES "public"."competitor_identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "competitor_identity_distinctions_workspace_idx" ON "competitor_identity_distinctions" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "competitor_identity_distinctions_pair_uidx" ON "competitor_identity_distinctions" USING btree ("identity_a_id","identity_b_id");