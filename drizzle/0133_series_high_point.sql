ALTER TABLE "series" ADD COLUMN "points_system" text;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "high_point_formula" text;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "point_for_coming_to_start" boolean;--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_points_system_chk" CHECK ("series"."points_system" in ('lowPoint','highPoint'));--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_high_point_formula_chk" CHECK ("series"."high_point_formula" in ('boatsBeaten','chips3'));