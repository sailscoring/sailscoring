-- Role enforcement lands with this release: `member` becomes the read-only
-- tier, so every pre-enforcement member — who had full implicit read-write —
-- is promoted to `admin` to keep exactly the access they already had.
-- Personal workspaces are always `owner` and are untouched.
UPDATE "member" SET "role" = 'admin' WHERE "role" = 'member';
