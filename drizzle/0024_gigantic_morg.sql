DROP INDEX "published_series_workspace_slug_uidx";--> statement-breakpoint
CREATE INDEX "published_series_workspace_slug_idx" ON "published_series" USING btree ("workspace_id","slug");