CREATE TABLE "series_courses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"series_id" uuid NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"card" jsonb,
	"modified" boolean DEFAULT false NOT NULL,
	"marks" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "series_marks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"series_id" uuid NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"card" jsonb,
	"shape" text,
	"color" text,
	"laid_from" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
ALTER TABLE "race_starts" ADD COLUMN "course" jsonb;--> statement-breakpoint
ALTER TABLE "series_courses" ADD CONSTRAINT "series_courses_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_courses" ADD CONSTRAINT "series_courses_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_marks" ADD CONSTRAINT "series_marks_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_marks" ADD CONSTRAINT "series_marks_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "series_courses_series_idx" ON "series_courses" USING btree ("series_id");--> statement-breakpoint
CREATE INDEX "series_courses_workspace_idx" ON "series_courses" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "series_marks_series_idx" ON "series_marks" USING btree ("series_id");--> statement-breakpoint
CREATE INDEX "series_marks_workspace_idx" ON "series_marks" USING btree ("workspace_id");