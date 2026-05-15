ALTER TABLE "nhc_tcf_records" RENAME TO "tcf_records";--> statement-breakpoint
ALTER TABLE "tcf_records" DROP CONSTRAINT "nhc_tcf_records_race_id_races_id_fk";
--> statement-breakpoint
ALTER TABLE "tcf_records" DROP CONSTRAINT "nhc_tcf_records_competitor_id_competitors_id_fk";
--> statement-breakpoint
ALTER TABLE "tcf_records" DROP CONSTRAINT "nhc_tcf_records_fleet_id_fleets_id_fk";
--> statement-breakpoint
DROP INDEX "nhc_tcf_records_uidx";--> statement-breakpoint
DROP INDEX "nhc_tcf_records_race_idx";--> statement-breakpoint
ALTER TABLE "tcf_records" ADD CONSTRAINT "tcf_records_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcf_records" ADD CONSTRAINT "tcf_records_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcf_records" ADD CONSTRAINT "tcf_records_fleet_id_fleets_id_fk" FOREIGN KEY ("fleet_id") REFERENCES "public"."fleets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tcf_records_uidx" ON "tcf_records" USING btree ("race_id","competitor_id","fleet_id");--> statement-breakpoint
CREATE INDEX "tcf_records_race_idx" ON "tcf_records" USING btree ("race_id");