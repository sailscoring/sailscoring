# Workspace provisioning

ADR-008 Phase 7 ships the **safety floor** for panel collaboration —
shared workspaces, actor attribution on conflicts, copy-to-workspace —
without the self-service org admin UI that lands in Phase 10. Until
then, organization workspaces are provisioned by hand using
`scripts/provision-org.ts` against the production database.

## When to use

The default sign-in flow already gives every user a personal workspace
(IODAI use case). Use this CLI to set up a **shared** workspace
(HYC use case), where multiple scorers collaborate on the same series.

## HYC workflow

1. **Each panel member exists as a user.** The CLI looks members up by
   email in step 3, so the user row has to exist first. Two ways to
   get there:

   - **Ask them to sign in once.** The magic-link flow creates the
     user row and a personal workspace as a side effect.
   - **Pre-create the user.** Useful when you want them on the panel
     before they've ever signed in, or for setting up the workspace
     the moment a new scorer is onboarded:

     ```bash
     pnpm provision-org pre-create-user alice@example.com --name "Alice Adams"
     ```

     `--name` is required — it's what shows up in the workspace
     switcher and on the panel's member list until the user updates
     it themselves. Pre-created rows match the sign-up hook exactly
     (user row + `My Workspace` personal workspace + owner
     membership), so when Alice later requests a magic link Better
     Auth recognises the email and signs her straight in — no
     duplicate, and the panel membership added in step 3 is already
     waiting.

2. **Create the workspace.**

   ```bash
   pnpm provision-org create-org "HYC Scoring Panel" --slug hyc
   ```

   `--slug` is optional — when omitted, it's derived from the name.
   Slugs are URL-safe and unique across the platform.

3. **Add each panel member.**

   ```bash
   pnpm provision-org add-member hyc alice@example.com --role owner
   pnpm provision-org add-member hyc bob@example.com
   pnpm provision-org add-member hyc carol@example.com
   ```

   Roles are `owner`, `admin`, or `member` — defaults to `member`.
   Roles map to Better Auth's organization roles directly; we don't
   layer sailing-specific names on top.

4. **Panel members switch into the workspace.** From their
   `/account` or any signed-in page, the workspace switcher in the
   header now shows both their personal workspace and the HYC one.
   Pick HYC and the rest of the app reorients onto the shared series
   and FTP credentials.

5. **Move existing series in.** A panel member who's been scoring in
   their personal workspace can copy any series across using the
   "Copy to another workspace" card on the series Settings tab. The
   personal-workspace original stays intact — copy rather than move
   so a botched move is recoverable.

## Other operations

```bash
pnpm provision-org list-members hyc
pnpm provision-org set-role hyc bob@example.com admin
pnpm provision-org remove-member hyc carol@example.com
```

`list-members` works with either the slug or the org id. The id is
useful for support — it appears on the `/workspace` page and in the
workspace-switcher data attributes.

## Production usage

The CLI reads `DATABASE_URL` directly. Against production:

```bash
DATABASE_URL=$PROD_DATABASE_URL pnpm provision-org create-org "…" --slug …
```

`pnpm provision-org` (no env override) runs against `.env.local` if
present — that's the local dev / test loop. Don't accidentally point
local commands at production.

## What's deliberately out of scope (Phase 7)

- **Self-service org creation.** Lands in Phase 10 as an admin-approved
  request flow from `/account`.
- **Invitations and members management UI.** Same — Phase 10.
- **Activity log.** Phase 7 captures `updated_by` on every mutable row;
  the per-series Activity tab and recency strips land in Phase 10.

See [ADR-008 Phase 7](design/decisions/008-full-stack-transition.md)
for the full scope and rationale.
