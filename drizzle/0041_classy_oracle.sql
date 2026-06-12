CREATE TABLE "sub_series" (
	"id" uuid PRIMARY KEY NOT NULL,
	"series_id" uuid NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"display_order" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
ALTER TABLE "races" ADD COLUMN "sub_series_id" uuid;--> statement-breakpoint
ALTER TABLE "sub_series" ADD CONSTRAINT "sub_series_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_series" ADD CONSTRAINT "sub_series_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sub_series_series_idx" ON "sub_series" USING btree ("series_id");--> statement-breakpoint
CREATE INDEX "sub_series_workspace_idx" ON "sub_series" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "races" ADD CONSTRAINT "races_sub_series_id_sub_series_id_fk" FOREIGN KEY ("sub_series_id") REFERENCES "public"."sub_series"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "races_sub_series_idx" ON "races" USING btree ("sub_series_id");