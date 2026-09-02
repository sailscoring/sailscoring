CREATE TABLE "support_grant" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"member_id" text,
	"role" text NOT NULL,
	"reason" text,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"released_at" timestamp with time zone,
	"released_by" text
);
--> statement-breakpoint
ALTER TABLE "support_grant" ADD CONSTRAINT "support_grant_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_grant" ADD CONSTRAINT "support_grant_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_grant" ADD CONSTRAINT "support_grant_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_grant_org_idx" ON "support_grant" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "support_grant_user_idx" ON "support_grant" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "support_grant_active_expires_idx" ON "support_grant" USING btree ("expires_at") WHERE released_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "support_grant_one_active_per_user_org" ON "support_grant" USING btree ("organization_id","user_id") WHERE released_at IS NULL;