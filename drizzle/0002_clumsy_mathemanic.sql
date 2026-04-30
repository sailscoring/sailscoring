CREATE TABLE "ftp_servers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"host" text NOT NULL,
	"port" integer DEFAULT 21 NOT NULL,
	"username" text NOT NULL,
	"encrypted_password" text NOT NULL,
	"ftps" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ftp_servers" ADD CONSTRAINT "ftp_servers_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ftp_servers_workspace_idx" ON "ftp_servers" USING btree ("workspace_id");