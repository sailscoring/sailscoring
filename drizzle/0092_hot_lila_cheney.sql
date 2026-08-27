ALTER TABLE "finishes" ADD COLUMN "elapsed_secs" real;--> statement-breakpoint
-- Elapsed time moves off track_data onto the finish row: it is a recording of
-- the finish, scored and hand-enterable, not a display-only track metric.
UPDATE "finishes"
   SET "elapsed_secs" = ("track_data" ->> 'elapsedSecs')::real
 WHERE "track_data" ? 'elapsedSecs';--> statement-breakpoint
UPDATE "finishes"
   SET "track_data" = CASE
         WHEN "track_data" - 'elapsedSecs' = '{}'::jsonb THEN NULL
         ELSE "track_data" - 'elapsedSecs'
       END
 WHERE "track_data" ? 'elapsedSecs';
