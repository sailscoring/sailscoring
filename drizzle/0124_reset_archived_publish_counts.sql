-- Archiving a series and moving it between categories used to bump its
-- version, so every series tidied away after publishing read as having
-- unpublished edits. Those writes no longer bump it; this clears the counts
-- they left on archived series. It also clears any real edit made before
-- archiving and never republished, which can't be told apart.
UPDATE "published_series" p
SET "published_version" = s."version"
FROM "series" s
WHERE p."series_id" = s."id"
  AND s."archived"
  AND s."version" > p."published_version";
