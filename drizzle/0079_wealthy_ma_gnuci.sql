ALTER TABLE "activity_log" ADD COLUMN "revision_id" uuid;--> statement-breakpoint
CREATE INDEX "activity_log_revision_idx" ON "activity_log" USING btree ("revision_id");--> statement-breakpoint
-- Backfill (#354): attribute existing entries to the earliest revision of the
-- same series at or after them, capped at 6 hours. Without the cap every
-- pre-existing entry would read as "not captured in a saved version", which is
-- false for the ones a trackChange mutation did snapshot — those get their
-- revision within seconds, or within a long coalesced session at worst. With
-- it, an entry whose nearest revision is days away stays unattributed, which is
-- the truth about it: nothing ever snapshotted the state it produced.
UPDATE "activity_log" a SET "revision_id" = (
  SELECT r."id" FROM "series_revision" r
  WHERE r."series_id" = a."series_id"
    AND r."created_at" >= a."created_at"
    AND r."created_at" < a."created_at" + interval '6 hours'
  ORDER BY r."created_at" ASC
  LIMIT 1
) WHERE a."series_id" IS NOT NULL;
