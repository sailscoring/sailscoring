# Account admin

Self-service account settings (change email, list and add alternate
emails) land later — see ADR-008 Phase 10. Until then, account-level
fixes are handled from the database via admin scripts.

## Change a user's login email

Scorers commonly maintain more than one email address (club, work,
personal) and lose access to whichever one they signed up with. Better
Auth's data model has exactly one email per user, so the fix is to
reassign it.

```bash
pnpm change-email old@example.com new@example.com
```

What this does:

- Looks up the user by `old@example.com` (case-insensitive).
- Confirms `new@example.com` isn't already taken.
- Rewrites the `user.email` row.

What it deliberately does **not** touch: `user.id`, sessions,
organization memberships, workspace data, or anything keyed on the
user id. The next magic-link sign-in goes to the new address; any
active sessions stay signed in.

Pending magic-link tokens addressed to the old email keep working
until they expire (default ~5 minutes). If that's a concern, ask the
user to wait it out before requesting a new link.

## Delete a user account

For removing an account and its private data — today this is for cleaning
up **test accounts**. There is deliberately no backup-before-delete step;
don't reach for this to delete a real user's data without thinking about
recovery first.

```bash
pnpm delete-account someone@example.com           # dry run — prints the plan
pnpm delete-account someone@example.com --force   # actually delete
```

Without `--force` it only prints what it *would* delete and changes
nothing. Read the plan, then re-run with `--force`.

What it deletes:

- The `user` row, which cascades through everything keyed on the user id:
  sessions, OAuth/credential `account` rows, `member` rows, sent
  `invitation`s, and `org_request`s.
- Any workspace where the user is the **sole member** — which cascades
  through that workspace's series, races, competitors, fleets, FTP
  servers, published-results rows, activity log, and feedback. This is
  the part a plain `DELETE FROM user` misses: an `organization` has no
  foreign key back to its owner (only `member` rows link the two), so
  deleting the user alone would orphan their personal workspace and all
  its data. The script deletes those workspaces explicitly first.

What it preserves:

- **Shared workspaces** (any workspace with other members). The user is
  simply removed via the `member` cascade; the workspace and its data
  stay. If the user was the workspace's **only owner**, the plan flags it
  as left ownerless — reassign ownership with
  `pnpm provision-org set-role <slug> <other-email> owner` before
  deleting, so the remaining members can still administer it.

### Caveat: published HTML blobs in production

Deleting a workspace cascades its `published_series` rows, but the
rendered HTML for published results lives outside Postgres in production
(Vercel Blob; see `lib/blob-storage.ts`). Those blobs are content-addressed
by an unguessable slug and are *not* removed by the DB cascade. Test
accounts generally haven't published to production, so this rarely
matters; if a deleted account had live published pages, clean the blobs up
separately. Locally and in CI there is no external blob store — published
HTML sits in the `published_blobs` table — so there's nothing extra to do.

## User stats

For a read-only snapshot of who's using the app:

```bash
pnpm user-stats
pnpm user-stats --sort last_login
pnpm user-stats --json
```

Per user it reports email, name, created date, whether they've ever
signed in (`emailVerified` flips on the first magic-link), session
count and most recent session time, workspace count, and totals for
series, races, competitors, and finishes across all their workspaces.

Quote the URL when overriding `DATABASE_URL`; Neon URLs contain `&`
which the shell otherwise treats as a job separator:

```bash
DATABASE_URL='postgresql://…?sslmode=require&channel_binding=require' pnpm user-stats
```

## Production usage

The CLI reads `DATABASE_URL`. Against production:

```bash
DATABASE_URL=$PROD_DATABASE_URL pnpm change-email old@example.com new@example.com
```

`pnpm change-email` (no env override) runs against `.env.local` if
present — that's the local dev / test loop. Don't accidentally point
local commands at production.

## Multiple emails per account

Not supported today. The user table stores a single canonical email,
and Better Auth has no built-in plugin for alternates. Adding it would
require a `user_email` join table, a magic-link send hook that
resolves any address to the owning user, and UI to manage the list.
Worth doing if scorers hit the change-email path often; in the
meantime this script covers the common case (a scorer switches club
or job).
