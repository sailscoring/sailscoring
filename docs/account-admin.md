# Account admin

There is no self-service email management (change email, alternate
emails) — account-level fixes are handled from the database via admin
scripts.

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
until they expire (30 minutes). If that's a concern, ask the user to
wait it out before requesting a new link.

Sessions last 90 days and slide forward on use, so a rename does not
prompt a re-authentication and an active session can be long-lived.
There is no "sign out other devices" control today: to cut a session
short, delete the row from the `session` table.

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

Every admin script has a `:prod` variant that runs it against
production:

```bash
pnpm change-email:prod old@example.com new@example.com
pnpm user-stats:prod
pnpm republish:prod --apply --limit 3
```

The plain script (`pnpm change-email`) reads `.env.local`, which
`vercel env pull` fills from the Development environment — that's the
local dev loop, and the production connection string is deliberately
never written to disk. The `:prod` variants wrap the command in
`scripts/prod-env.sh`, which fetches the production secrets from
Bitwarden for the duration of one run.

One-time setup:

1. Install the Bitwarden CLI (`bw`) and `jq`, and `bw login`.
2. Create a vault item (a Secure Note does) with custom fields named
   after the variables: `DATABASE_URL` (required; the Neon production
   URL), `BLOB_READ_WRITE_TOKEN` and `NEXT_PUBLIC_APP_URL` (needed by
   `republish`). Hidden fields are fine. No other field is read.
3. Put its id in an untracked `.env.operator` at the repo root:

   ```bash
   bw list items --search "sailscoring prod" | jq -r '.[] | "\(.id)  \(.name)"'
   echo 'BW_ITEM=<that id>' > .env.operator
   ```

   Next.js never loads a file by that name, so it cannot bleed into
   the app's environment. Run `bw sync` if the item was created after
   the CLI last synced.

Each run prompts for the master password, unlocks the vault, reads the
one item, locks the vault again when the command exits, and says which
database host it is about to use before running anything. If the shell
already holds an unlocked `BW_SESSION`, that is used and left alone.
Only the three variables above are exported; the session key never is.

The prompt needs a terminal, so a `:prod` script cannot run from a
non-interactive shell — the wrapper says so and exits rather than
hanging. Run production operations yourself, from your own terminal.

## Multiple emails per account

Not supported today. The user table stores a single canonical email,
and Better Auth has no built-in plugin for alternates. Adding it would
require a `user_email` join table, a magic-link send hook that
resolves any address to the owning user, and UI to manage the list.
Worth doing if scorers hit the change-email path often; in the
meantime this script covers the common case (a scorer switches club
or job).
