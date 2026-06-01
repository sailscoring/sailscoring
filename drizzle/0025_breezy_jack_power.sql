ALTER TABLE "series" ADD COLUMN "display_order" integer;--> statement-breakpoint
-- Backfill: preserve the existing newest-first order per workspace (the list
-- sorted by created_at desc) as the initial manual order.
UPDATE "series" SET "display_order" = sub.rn FROM (
  SELECT "id", (row_number() OVER (PARTITION BY "workspace_id" ORDER BY "created_at" DESC) - 1) AS rn
  FROM "series"
) AS sub WHERE "series"."id" = sub."id";--> statement-breakpoint
ALTER TABLE "series" ALTER COLUMN "display_order" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "series_workspace_order_idx" ON "series" USING btree ("workspace_id","display_order");
