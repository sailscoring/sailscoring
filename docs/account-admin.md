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
