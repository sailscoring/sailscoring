CREATE TABLE "activity_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"series_id" uuid,
	"actor_user_id" text,
	"action" text NOT NULL,
	"summary" text NOT NULL,
	"dedupe_key" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_log_workspace_created_idx" ON "activity_log" USING btree ("workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "activity_log_series_created_idx" ON "activity_log" USING btree ("series_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "activity_log_coalesce_idx" ON "activity_log" USING btree ("workspace_id","dedupe_key","actor_user_id");