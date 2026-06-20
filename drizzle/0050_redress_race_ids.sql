ALTER TABLE "finishes" ADD COLUMN "redress_exclude_race_ids" jsonb;--> statement-breakpoint
ALTER TABLE "finishes" ADD COLUMN "redress_include_race_ids" jsonb;--> statement-breakpoint
UPDATE "finishes" f SET "redress_exclude_race_ids" = sub.ids
FROM (
  SELECT f2."id" AS fid, jsonb_agg(r."id"::text ORDER BY ord) AS ids
  FROM "finishes" f2
  JOIN "races" rf ON rf."id" = f2."race_id"
  CROSS JOIN LATERAL jsonb_array_elements_text(f2."redress_exclude_races") WITH ORDINALITY AS e(num, ord)
  JOIN "races" r ON r."series_id" = rf."series_id" AND r."race_number" = e.num::int
  WHERE f2."redress_exclude_races" IS NOT NULL
  GROUP BY f2."id"
) sub
WHERE f."id" = sub.fid;--> statement-breakpoint
UPDATE "finishes" f SET "redress_include_race_ids" = sub.ids
FROM (
  SELECT f2."id" AS fid, jsonb_agg(r."id"::text ORDER BY ord) AS ids
  FROM "finishes" f2
  JOIN "races" rf ON rf."id" = f2."race_id"
  CROSS JOIN LATERAL jsonb_array_elements_text(f2."redress_include_races") WITH ORDINALITY AS e(num, ord)
  JOIN "races" r ON r."series_id" = rf."series_id" AND r."race_number" = e.num::int
  WHERE f2."redress_include_races" IS NOT NULL
  GROUP BY f2."id"
) sub
WHERE f."id" = sub.fid;--> statement-breakpoint
ALTER TABLE "finishes" DROP COLUMN "redress_exclude_races";--> statement-breakpoint
ALTER TABLE "finishes" DROP COLUMN "redress_include_races";
