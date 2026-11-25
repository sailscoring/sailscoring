-- A category's public page is /p/{ws}/-/{slug}. Existing categories take the
-- slug their name reads as (lib/category-slug.ts's categorySlugBase); where
-- two names read as one slug, the later-ordered ones take -2, -3, ….
ALTER TABLE "categories" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "former_slugs" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
WITH base AS (
  SELECT
    "id",
    coalesce(nullif(btrim(regexp_replace(lower("name"), '[^a-z0-9]+', '-', 'g'), '-'), ''), 'category') AS "slug",
    row_number() OVER (
      PARTITION BY "workspace_id",
        coalesce(nullif(btrim(regexp_replace(lower("name"), '[^a-z0-9]+', '-', 'g'), '-'), ''), 'category')
      ORDER BY "display_order", "created_at", "id"
    ) AS "n"
  FROM "categories"
)
UPDATE "categories" SET "slug" = CASE WHEN base."n" = 1 THEN base."slug" ELSE base."slug" || '-' || base."n" END
FROM base WHERE base."id" = "categories"."id";--> statement-breakpoint
ALTER TABLE "categories" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_workspace_slug_uidx" ON "categories" USING btree ("workspace_id","slug");
