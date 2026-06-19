CREATE TABLE "sub_series_races" (
	"sub_series_id" uuid NOT NULL,
	"race_id" uuid NOT NULL,
	"workspace_id" text NOT NULL,
	CONSTRAINT "sub_series_races_sub_series_id_race_id_pk" PRIMARY KEY("sub_series_id","race_id")
);
--> statement-breakpoint
ALTER TABLE "races" DROP CONSTRAINT "races_sub_series_id_sub_series_id_fk";
--> statement-breakpoint
DROP INDEX "races_sub_series_idx";--> statement-breakpoint
ALTER TABLE "sub_series_races" ADD CONSTRAINT "sub_series_races_sub_series_id_sub_series_id_fk" FOREIGN KEY ("sub_series_id") REFERENCES "public"."sub_series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_series_races" ADD CONSTRAINT "sub_series_races_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_series_races" ADD CONSTRAINT "sub_series_races_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sub_series_races_race_idx" ON "sub_series_races" USING btree ("race_id");--> statement-breakpoint
CREATE INDEX "sub_series_races_workspace_idx" ON "sub_series_races" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "races" DROP COLUMN "sub_series_id";