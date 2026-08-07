-- Fold the boolean into the new column before dropping it: every row that was
-- entered by bow number becomes matched_on = 'bow'. The text that was typed
-- was never recorded, so entered_sail_number stays null for these.
UPDATE "finishes" SET "matched_on" = 'bow' WHERE "matched_on_bow_number" IS TRUE;--> statement-breakpoint
ALTER TABLE "finishes" DROP COLUMN "matched_on_bow_number";
