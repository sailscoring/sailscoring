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

## Feature gating (experimental features)

Some features are kept behind a gate (#155) because they're experimental
and may be **removed** later. Gating them to a chosen set of workspaces
keeps the audience small and enumerable, so a feature can be withdrawn
with a clear explanation to a known group rather than silently pulled
out from under everyone.

The current gated keys are:

| key | default | what it unlocks |
|-----|---------|-----------------|
| `sailwave-import` | off | the "Sailwave export" option in the home Import dialog |
| `csv-finish-import` | off | the per-race "Import CSV" finish-sheet control |
| `ftp-upload` | off | the Standings "Upload via FTP" button + the Workspace-settings FTP-servers card |
| `logo-library` | **on** | the Workspace-settings **Logo library** card (the workspace's own logo, upload + manage logos, per-workspace default venue/event logos, copy a logo from another workspace you belong to) **and** the **Library** picker on a series' venue/event logo fields, drawing on both the workspace's own logos and the built-in canonical set served from `logos.sailscoring.ie`. On by default — the canonical set makes it useful to every workspace out of the box. |
| `nhc-parameters` | off | the per-fleet **Configure…** custom-NHC dialog (NHC scoring with stock parameters stays available to everyone) |
| `echo` | **on** | ECHO as a per-fleet scoring system **and** the "Irish Sailing ECHO" source in the Competitors **Update handicaps** dialog (pulls ECHO handicaps from the national Irish Sailing ratings list, matched by sail number). On by default because the seeded sample club-racing series uses ECHO fleets. |
| `irc-rating` | **on** | IRC as a per-fleet scoring system **and** the "IRC TCC (international)" source in the Competitors **Update handicaps** dialog (pulls TCCs from the worldwide IRC ClubListing, #168) |
| `rya-py` | **on** | PY (Portsmouth Yardstick) as a per-fleet scoring system **and** the "RYA Portsmouth Yardstick" source in the Competitors **Update handicaps** dialog (sets each class's PY number from the RYA's published list and tidies class names, matched by boat class). On by default. |
| `vprs` | off | VPRS as a per-fleet scoring system **and** the "VPRS TCC" source in the Competitors **Update handicaps** dialog (pick a club, then pull each boat's TCC from that club's published `vprs.org` listing, matched by sail number, #175). Off by default — VPRS is new and not yet reconciled against real published results, so the audience stays small until it's proven. |
| `follow-on-series` | off | the **Create follow-on series…** action on the series-list row menu (#201): rolls a finished series into the next one of the season — same settings, fleets, and competitors, no races — with each boat's NHC/ECHO starting handicap seeded from its TCF after the source's last scored race, and the lineage recorded (`previousSeriesId`, shown as a "carried forward from" note on the new series' Competitors tab). Off by default until the rollover semantics are proven against a real season. |
| `fine-grained-roles` | off | the **scorer** option in the Workspace-settings **Members** card role selects (invite + per-member), #202. Only the *affordance* is gated: role enforcement is always on, so a `member` is read-only and any assigned `scorer` (read + race-day operations: races, starts, finishes, publishing) is already honoured server-side — this flag just controls whether the workspace can hand the scorer role out from the UI. Off by default while the role set beds in. |
| `sub-series` | off | the **New sub-series** button and the **Sub-series** management panel on a series' **Races** tab, #203: define named **selections of races** inside one series (e.g. a Frostbite Winter + Spring, or a Tuesday series and a Saturday series), each scored independently — its own standings (a selector on the **Standings** tab), discards (the series discard rule applied to the selection's race count), entrants (a boat absent from a selection isn't in it), and published page (`/p/{ws}/{series}/{sub-series}/{fleet}`). Selections may overlap and a race may belong to several. For NHC/ECHO, each sub-series computes its own progressive chain over its own races; an optional **continue handicaps from** another sub-series carries the chain forward explicitly. Only the *authoring* UI is gated: a series that already has sub-series renders, scores, and publishes them regardless; when the feature is off, a series carrying sub-series shows a hint on its **Settings** tab pointing at this toggle (#280). Off by default until the model is proven against a real season. Turning it on for the first time (self-service) seeds a worked demo — **Sample Club League 2026** — into the workspace's *Samples* category so the scorer has a live example to explore (#256); seeded once, and never re-seeded if deleted. |
| `combined-pages` | off | the **Combined pages** card on a multi-fleet series' **Settings** tab and the combined-page rows in the **Publish** dialog (#255): publish several fleets' results as sections of **one page** — an all-fleets "Overall" page (typically standings only), or a multi-method class page (e.g. one "Puppeteer" page carrying its Scratch and HPH fleets in full detail); a single series-level toggle ("Publish individual per-fleet pages") switches the standalone fleet pages off so the combined pages **replace** them. Only the *authoring* UI is gated: a series that already carries group config keeps rendering and publishing it, like `sub-series`; when the feature is off, a series that carries such config shows a hint on its **Settings** tab pointing at this toggle (#280). Off by default while the page composition proves out. |
| `competitor-identity` | off | the **public** side of the cross-series competitor-identity spine (#212, #217): the public **competitor index** (`/p/{ws}/competitors` — searchable by name and sail number, filterable by year), each competitor's public **timeline** (every series they entered, with results and ranking over the years), and the index link on the public results listing — all read off the identity link (`competitors.identity_id`) the reconcile pass populates. Off by default and introduced for IODAI first — a one-design junior class whose ~180-series corpus back to 2009 makes the timeline the showcase. Invisible and inert in every other workspace. Identity is workspace-local: excluded from the `.sailscoring` file format and public JSON export, re-derived by the reconcile pass. Pages are noindex (shareable by link, out of search engines). |
| `prizes` | off | the **Prizes** tab on a series (#240): named awards, each an eligibility predicate (conditions over subdivision-axis values, fleet, and maximum series rank) plus a places count, allocated live from the series standings (top N eligible by rank, with warnings for empty fields, short awards, and ties at the cut). Also unlocks the published **prize sheet** page (`/p/{ws}/{series}/prizes` — one more tickable row in the Publish dialog, disambiguated to `{series-slug}-prizes` on a shared slug) and prizes in the public JSON export. The server gates *publishing* too: a prize list imported into an ungated workspace is kept but stays unpublished. Off by default while the predicate model proves out against real NoRs. |
| `rrs-import` | off | the **Import to rrs.org** side of the Competitors-page Import dialog (#260): push the competitor list to a racingrulesofsailing.org event via its competitor-import API — either alongside a CSV import (relaying email / phone / MNA-number columns that Sail Scoring itself never stores) or push-only from the current listing. The event UUID and division-source mapping are remembered on the series. With the flag off the button stays "Import CSV" and behaves exactly as before. Off by default while the integration proves out against real events. |
| `competitor-reconcile` | off | the **in-app** reconcile surface (#212, #221): the **Competitors** tab on the workspace home and the `/workspace/competitors` page — the review queue (merge suggestions + long-arc flags), combine-with-undo, cluster split, rename — plus the `/api/v1/competitor-identities` endpoints behind it. Separate from `competitor-identity` so the public competitor pages can be live independently of the in-app correction tooling. Off by default. |
| `rankings` | off | the **Rankings** tab on the workspace home (#209): cross-series season ladders — each a saved bucketed best-N config (e.g. Nationals place + two best regionals), computed on demand over the selected series and grouped by competitor identity — plus each ranking's optional public page (`/p/{ws}/ranking/{slug}`, per-ranking toggle, computed over published series only). Requires the identity spine to be meaningful: enable `competitor-identity` (and normally `competitor-reconcile`) alongside it. |
| `results-status` | off | the results lifecycle (Provisional vs Final, #291): the **Mark as final** button + status chip on the **Standings** tab (a checklist dialog asserting the RRS 90.3(e)-grounded conditions — protest/redress time limit passed, nothing pending with the PC, nothing else outstanding), the **Protest time limit** card on series **Settings** (minutes after each race's / the day's last finisher, per the SIs), the last-finisher line on the race page (auto from timed finishes, manual entry otherwise), and the race-day recency strip on the **Races** tab ("Last finisher … · protest time limit until …"). A final series is read-only until reopened from its banner, and published pages stamp **Final results** instead of provisional-as-of on the next publish. Only the *affordances* are gated: a series already marked final keeps its badge, banner, and read-only enforcement regardless. Off by default while the lifecycle proves out against a real season. |

**Archivist credentials (ADR-010).** A class archive repo's CI pushes
as-published series through `/api/v1/archive` with an API key whose user
holds the **`archivist`** role in the target workspace — `read` +
`archive-ingest` only, so a leaked key can touch nothing but that
workspace's (already public) archive. Provision: `provision-org
pre-create-user` for a per-repo service user, add it to the workspace with
role `archivist`, then `provision-token create … --workspace <slug>
--admin` (bulk ingests make hundreds of requests; a plain key's rate limit
429s mid-corpus). See `docs/design/as-published-archives.md`.

**Default-on features.** Most gated features are opt-in (off until enabled),
but a feature can be marked default-on in `lib/features.ts` — on for every
workspace unless that workspace records an explicit opt-out. `echo`,
`irc-rating`, `rya-py` and `logo-library` are currently default-on. `disable-feature` records the opt-out;
`enable-feature` clears it again. An opt-out on the active workspace always
wins, even over a feature inherited from a club (Model B).

`lib/features.ts` is the source of truth for the key list and which are
default-on; `pnpm provision-org --help` prints the current keys too.

**Self-service.** Owners and admins now turn most features on and off
themselves from **Workspace settings → Features** (`/workspace`), so routine
"hide the Prizes tab for this club" requests no longer need an operator. The
CLI remains for enabling a feature on someone's behalf, for the audience
query, and for the **operator-managed** keys — those with `selfService: false`
in `lib/features.ts`, which never appear on the self-service card and can only
be flipped here. The operator-managed set is deliberately small:

| key | why operator-managed |
|-----|----------------------|
| `ftp-upload` | HYC-only, slated for removal with scupper |
| `competitor-identity` | cross-series identity adoption stays centrally controlled |
| `competitor-reconcile` | counterpart of the above; reconcile UX still bedding in |
| `rankings` | groups by the identity spine, so adoption travels with it |

Every other key is self-service — including opt-in ones like `vprs` and
`prizes`: a workspace it's been enabled for can hide it again itself. Because
the self-service card lists effective features, a workspace can also switch off
a default-on feature (records the opt-out) directly. `selfService` is
orthogonal to `defaultOn` and to resolution — the CLI can still flip any key,
and `computeEffectiveFeatures` honours the metadata regardless.

**Turn a feature on / off for a workspace:**

```bash
pnpm provision-org enable-feature hyc echo
pnpm provision-org disable-feature hyc echo
```

These act on an existing club workspace and take one feature at a time.
To set features at the moment a workspace is created, pass a
comma-separated list to `create-org` (or `fulfil-request`):

```bash
pnpm provision-org create-org "HYC Scoring Panel" --slug hyc \
  --enable-feature echo,ftp-upload
pnpm provision-org fulfil-request <request-id> --enable-feature echo
```

**Who has a feature (the audience query)** — run this before retiring a
feature to see exactly which workspaces would be affected:

```bash
pnpm provision-org list-feature echo
```

**Propagation (Model B).** A feature enabled on a *club* workspace is
visible both in that workspace and in the **personal workspace of every
member** — their own sandbox for the same feature. It does *not* leak
into other club workspaces a member happens to belong to. So enabling
`echo` on `hyc` turns it on for the HYC workspace and for each HYC
scorer's personal workspace, and nowhere else.

Feature commands follow the same production rules as the rest of the CLI
(see below) — they read `DATABASE_URL`, so be sure you're pointed at the
right database before enabling on a real workspace like `hyc`.

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
