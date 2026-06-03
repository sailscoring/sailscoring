CREATE TABLE "race_rating_overrides" (
	"id" uuid PRIMARY KEY NOT NULL,
	"race_id" uuid NOT NULL,
	"competitor_id" uuid NOT NULL,
	"field" text NOT NULL,
	"value" real NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "race_rating_overrides_field_chk" CHECK ("race_rating_overrides"."field" in ('ircTcc','pyNumber'))
);
--> statement-breakpoint
ALTER TABLE "race_rating_overrides" ADD CONSTRAINT "race_rating_overrides_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_rating_overrides" ADD CONSTRAINT "race_rating_overrides_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "race_rating_overrides_race_idx" ON "race_rating_overrides" USING btree ("race_id");--> statement-breakpoint
CREATE UNIQUE INDEX "race_rating_overrides_race_comp_field_idx" ON "race_rating_overrides" USING btree ("race_id","competitor_id","field");