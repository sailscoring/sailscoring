CREATE TABLE "org_request" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"user_email" text NOT NULL,
	"requested_name" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp,
	"resolved_org_id" text
);
--> statement-breakpoint
ALTER TABLE "org_request" ADD CONSTRAINT "org_request_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "org_request_user_idx" ON "org_request" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_request_one_pending_per_user" ON "org_request" USING btree ("user_id") WHERE status = 'pending';