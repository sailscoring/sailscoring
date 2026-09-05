# Workspace provisioning

Organization workspaces are provisioned by the operator using
`scripts/provision-org.ts` against the production database — either
directly, or to fulfil a self-service request submitted from `/account`
(ADR-008 Phase 10's admin-approved request flow). Everything else about
running a shared workspace — invitations, members management, feature
toggles, the activity log — is self-service in the app; creating the
org workspace itself is the deliberate operator step this doc covers.

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

### Personal workspaces

Personal workspaces are single-user: the app refuses invitations to them
on both create and accept, and `/workspace` doesn't render the Members
card there at all — membership isn't a concept on a workspace that holds
one person. Someone who wants co-scorers requests a club workspace from
`/account`, and fulfilling that request is the approval step this whole
document exists for.

That means clearing one out is an operator job — deliberately, since it
should only ever come up for the workspaces that picked up members before
invitations were blocked. They're awkward to address by hand, though:
every one is named "My Workspace" and the slug is derived from a user id
you don't have. Resolve one from the owner's email:

```bash
pnpm provision-org personal-workspace mary@example.com
```

That prints the slug, the roster, and any pending invitations. To clear
out members who joined before the guard existed, feed the slug back to
the usual commands:

```bash
pnpm provision-org remove-member u-usr_1234567890ab bob@example.com
pnpm provision-org cancel-invitations u-usr_1234567890ab
```

Removing a member takes away their access to the workspace; it doesn't
touch their own account or their own personal workspace. If they were
scoring a series that ought to survive, get the owner to copy it to a
club workspace first ("Copy to another workspace" on series Settings)
— removal leaves the series where it is, reachable only by the owner.

## Support access

A scorer asks for help with a series in a workspace you are not a member
of. The options, least to most privilege, are: they send the `.sailscoring`
file; they send a published or Preview link (the footer's "Open in Sail
Scoring" carries the series); they invite you as a `member` and remove you
afterwards; or you let yourself in. Prefer them in that order. The last is
the only one that works without the scorer doing anything, which is why it
exists and why it is the most deliberate of the four — it is a paved path
with an audit trail, not a mechanism for standing access.

```bash
pnpm provision-org:prod support find alice@example.com
pnpm provision-org:prod support join hyc mark@example.com --hours 24 --reason "standings query"
pnpm provision-org:prod support list
pnpm provision-org:prod support leave hyc mark@example.com
```

`find` maps the requester's email to their workspaces — name, slug, their
role, series count — which is step one of every support interaction.
`join` inserts a real `member` row for you (read-only unless you pass
`--role`, which you should have a reason for) together with a
`support_grant` row that records the reason and the expiry, and writes a
`support.joined` entry in that workspace's activity log. An hourly cron
(`/api/cron/sweep-support-grants`) removes the membership when the time
is up and logs `support.left`; `leave` does the same early. `list` is the
question "am I still sitting in anyone's workspace?" — review it
periodically, and `--all` shows the history.

The practice, in order of importance:

- **Read-only by default, time-boxed, and logged.** Every grant expires
  (24 hours unless you say otherwise) and every join and leave is visible
  in the target workspace's activity log. That visibility is what
  separates support access from the maintainer quietly adding himself,
  and it is what the privacy policy discloses.
- **A grant only ever owns the row it created.** `join` refuses if you are
  already a member, however you got there; `leave` refuses to touch an
  ordinary membership (use `remove-member`). If the workspace's owner
  removes you from the Members card mid-session, the grant closes as
  `member-removed` on the next sweep rather than pretending otherwise.
- **This is not a security control.** Anyone holding the production
  database URL can bypass all of it. Its value is that deviation is
  visible by absence: a support session with no activity entry looks
  wrong to anyone reading the log later. Do not go around it.

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
| `racesense-import` | off, operator-managed | the Races tab's **Import from RaceSense** button (and its `i` shortcut): reads a Vakaros RaceSense regatta export — a workbook with a sheet per race — and offers each sheet against the race it matches, ticking only races with nothing in them yet. Also unlocks the **Publish RaceSense track data** toggle on the series Publishing card (off by default per series): with it on, the per-race tables publish the export's finish/elapsed times, distance sailed, average and max speed, and DTL at the start as sortable columns. The same gate puts the track data in front of the scorer, published or not: a count per sheet in the import dialog, a badge per race on the Races tab, and a marker on each finish row that opens the boat's figures. Operator-managed (never on the self-service card): the export format is still being learned from real championship exports, so the audience stays one event at a time. |
| `ftp-upload` | off | the Standings "Upload via FTP" button + the Workspace-settings FTP-servers card |
| `logo-library` | **on** | the Workspace-settings **Logo library** card (the workspace's own logo, upload + manage logos, per-workspace default venue/event logos, copy a logo from another workspace you belong to) **and** the **Library** picker on a series' venue/event logo fields, drawing on both the workspace's own logos and the built-in canonical set served from `logos.sailscoring.ie`. On by default — the canonical set makes it useful to every workspace out of the box. |
| `nhc-parameters` | off | the per-fleet **Configure…** custom-NHC dialog (NHC scoring with stock parameters stays available to everyone) |
| `echo` | **on** | ECHO as a per-fleet scoring system **and** the "Irish Sailing ECHO" source in the Competitors **Update handicaps** dialog (pulls ECHO handicaps from the national Irish Sailing ratings list, matched by sail number). On by default because the seeded sample club-racing series uses ECHO fleets. |
| `irc-rating` | **on** | IRC as a per-fleet scoring system **and** the "IRC TCC (international)" source in the Competitors **Update handicaps** dialog (pulls TCCs from the worldwide IRC ClubListing, #168) |
| `rya-py` | **on** | PY (Portsmouth Yardstick) as a per-fleet scoring system **and** the "RYA Portsmouth Yardstick" source in the Competitors **Update handicaps** dialog (sets each class's PY number from the RYA's published list and tidies class names, matched by boat class). On by default. |
| `vprs` | off | VPRS as a per-fleet scoring system **and** the "VPRS TCC" source in the Competitors **Update handicaps** dialog (pick a club, then pull each boat's TCC from that club's published `vprs.org` listing, matched by sail number, #175). Off by default — VPRS is new and not yet reconciled against real published results, so the audience stays small until it's proven. |
| `orc` | off | ORC as a per-fleet scoring system **and** the "ORC certificates" source in the Competitors **Update handicaps** dialog (imports whole certificates — expiry, CDL, ratings, time-allowance matrix — from the ORC active-certificates database per country and family, matched by sail number, #429). Turning it on for the first time seeds a worked demo — **Sample ORC Series 2026**, real certificates with a different scoring option per race (APHT, a wind band, a constructed course on performance curves, an RC scoring wind) plus an IRC comparison fleet — into the workspace's *Samples* category; seeded once, never re-seeded if deleted. Off by default — being proven against the HYC Autumn League 2026 before any wider audience. |
| `follow-on-series` | off | the **Create follow-on series…** action on the series-list row menu (#201): rolls a finished series into the next one of the season — same settings, fleets, and competitors, no races — with each boat's NHC/ECHO starting handicap seeded from its TCF after the source's last scored race, and the lineage recorded (`previousSeriesId`, shown as a "carried forward from" note on the new series' Competitors tab). Off by default until the rollover semantics are proven against a real season. |
| `fine-grained-roles` | off | the **scorer** option in the Workspace-settings **Members** card role selects (invite + per-member), #202. Only the *affordance* is gated: role enforcement is always on, so a `member` is read-only and any assigned `scorer` (read + race-day operations: races, starts, finishes, publishing) is already honoured server-side — this flag just controls whether the workspace can hand the scorer role out from the UI. Off by default while the role set beds in. |
| `sub-series` | off | the **New sub-series** button and the **Sub-series** management panel on a series' **Races** tab, #203: define named **selections of races** inside one series (e.g. a Frostbite Winter + Spring, or a Tuesday series and a Saturday series), each scored independently — its own standings (a selector on the **Standings** tab), discards (the series discard rule applied to the selection's race count), entrants (a boat absent from a selection isn't in it), and published page (`/p/{ws}/{series}/{sub-series}/{fleet}`). Selections may overlap and a race may belong to several. For NHC/ECHO, each sub-series computes its own progressive chain over its own races; an optional **continue handicaps from** another sub-series carries the chain forward explicitly. Only the *authoring* UI is gated: a series that already has sub-series renders, scores, and publishes them regardless; when the feature is off, a series carrying sub-series shows a hint on its **Settings** tab pointing at this toggle (#280). Off by default until the model is proven against a real season. Turning it on for the first time (self-service) seeds a worked demo — **Sample Club League 2026** — into the workspace's *Samples* category so the scorer has a live example to explore (#256); seeded once, and never re-seeded if deleted. |
| `combined-pages` | off | the **Combined pages** card on a multi-fleet series' **Settings** tab and the combined-page rows in the **Publish** dialog (#255): publish several fleets' results as sections of **one page** — an all-fleets "Overall" page (typically standings only), or a multi-method class page (e.g. one "Puppeteer" page carrying its Scratch and HPH fleets in full detail); a single series-level toggle ("Publish individual per-fleet pages") switches the standalone fleet pages off so the combined pages **replace** them. Only the *authoring* UI is gated: a series that already carries group config keeps rendering and publishing it, like `sub-series`; when the feature is off, a series that carries such config shows a hint on its **Settings** tab pointing at this toggle (#280). Off by default while the page composition proves out. |
| `competitor-identity` | off | the **public** side of the cross-series competitor-identity spine (#212, #217): the public **competitor index** (`/p/{ws}/competitors` — searchable by name and sail number, filterable by year), each competitor's public **timeline** (every series they entered, with results and ranking over the years), and the index link on the public results listing — all read off the identity link (`competitors.identity_id`) the reconcile pass populates. Off by default and introduced for IODAI first — a one-design junior class whose ~180-series corpus back to 2009 makes the timeline the showcase. Invisible and inert in every other workspace. Identity is workspace-local: excluded from the `.sailscoring` file format and public JSON export, re-derived by the reconcile pass. Pages are noindex (shareable by link, out of search engines). |
| `competitor-identity-crew` | off | extends the identity spine to the **crew** slot (#348). Without it, the reconcile pass reads people out of a competitor's primary names only, so on a two-person dinghy the helm accrues a sailing history and the crew accrues nothing: a sailor who only ever crews gets no identity, no timeline, and no career arc, and one who helms some seasons and crews others shows half a record. With it on, everyone in a row's crew field is a person the pass can recognise across series. Crew names are messier than helm names, so unrecognisable cells (bare first names, initials, `???` / `TBD`) are skipped rather than turned into identities, and a cell naming several people is split. Crew do **not** accrue ranking points — whether they should is a scoring-policy question for the club, so the ladder keeps crediting the primary slot only. Gates the automatic pass only: an as-published archive manifest that names crew applies regardless. Inert where no crew is recorded, so a single-handed class sees nothing either way. Enable alongside `competitor-identity`; off by default because switching it on changes which identities exist in an already-adopted corpus. |
| `prizes` | off | the **Prizes** tab on a series (#240): named awards, each an eligibility predicate (conditions over subdivision-axis values, fleet, and maximum series rank) plus a places count, allocated live from the series standings (top N eligible by rank, with warnings for empty fields, short awards, and ties at the cut). Also unlocks the published **prize sheet** page (`/p/{ws}/{series}/prizes` — one more tickable row in the Publish dialog, disambiguated to `{series-slug}-prizes` on a shared slug) and prizes in the public JSON export. The server gates *publishing* too: a prize list imported into an ungated workspace is kept but stays unpublished. Off by default while the predicate model proves out against real NoRs. |
| `entry-list` | off | the published **competitor list** (#423) — the entry list, at `/p/{ws}/{series}/entries` (disambiguated to `{series-slug}-entries` on a shared slug), as one more tickable row in the Publish dialog and in Preview. Columns come from the series' enabled competitor fields, each suppressed when no entry fills it; nothing on the page is derived from results. It is the only page a series with **no races yet** can publish, which is the point of it — an event wants its entry list up in the run-up. Off by default because every series has a roster, so an ungated version would add a page to every workspace's next publish unasked. The page also prints as the **starters checklist** (one table per start, a tick box per boat) from a footer button, so a club whose race team wants the sheet needs this on. |
| `rrs-import` | off | the **Import to rrs.org** side of the Competitors-page Import dialog (#260): push the competitor list to a racingrulesofsailing.org event via its competitor-import API — either alongside a CSV import (relaying email / phone / MNA-number columns that Sail Scoring itself never stores) or push-only from the current listing. The event UUID and division-source mapping are remembered on the series. With the flag off the button stays "Import CSV" and behaves exactly as before. Off by default while the integration proves out against real events. |
| `competitor-reconcile` | off | the **in-app** reconcile surface (#212, #221): the **Competitors** tab on the workspace home and the `/workspace/competitors` page — the review queue (merge suggestions + long-arc flags), combine-with-undo, cluster split, rename — plus the `/api/v1/competitor-identities` endpoints behind it. Separate from `competitor-identity` so the public competitor pages can be live independently of the in-app correction tooling. Off by default. |
| `rankings` | off | the **Rankings** tab on the workspace home (#209): cross-series season ladders — each a saved bucketed best-N config (e.g. Nationals place + two best regionals), computed on demand over the selected series and grouped by competitor identity — plus each ranking's optional public page (`/p/{ws}/ranking/{slug}`, per-ranking toggle, computed over published series only). Requires the identity spine to be meaningful: enable `competitor-identity` (and normally `competitor-reconcile`) alongside it. |
| `multi-person-fields` | off | the per-field **Allow multiple** checkboxes in the **Competitor fields** card on a series' **Settings** tab (#316): open the primary identifier, Owner, Helm, and/or Crew to **several names per entry** — co-owned boats ("J. & M. Murphy" syndicates), offshore co-helms, full keelboat crews. With a field ticked, the competitor dialog gains an add-a-name button for it, and a spreadsheet import keeps every column mapped to that field (plus splits `<br>`/newline/semicolon-separated names within one cell); untick and it behaves as a single value again. Only the *entry affordances* are gated — stored multi-name entries always render (stacked in tables, joined with an ampersand in one-line contexts like finish entry), so switching a field back to single never hides or truncates existing data. Gender and age apply to the primary person and are cleared when a primary carries more than one name; nationality is unaffected (national letters attach to the boat). Off by default — most scorers run single-helm or two-person classes and never need the affordance. |
| `results-status` | off | the results lifecycle (Provisional vs Final, #291): the **Mark as final** button + status chip on the **Standings** tab (a checklist dialog asserting the RRS 90.3(e)-grounded conditions — protest/redress time limit passed, nothing pending with the PC, nothing else outstanding), the **Protest time limit** card on series **Settings** (minutes after each race's / the day's last finisher, per the SIs), the last-finisher line on the race page (auto from timed finishes, manual entry otherwise), and the race-day recency strip on the **Races** tab ("Last finisher … · protest time limit until …"). A final series is read-only until reopened from its banner, and published pages stamp **Final results** instead of provisional-as-of on the next publish. Only the *affordances* are gated: a series already marked final keeps its badge, banner, and read-only enforcement regardless. Off by default while the lifecycle proves out against a real season. |
| `split-fleets` | off | The **Split Fleets** tab on a series (docs/design/split-fleets.md): the guided qualifying/final championship workflow — seed qualifying fleets, reassign by rank each day, split into Gold/Silver/Bronze, medal races, publish the championship standings + rolling assignment lists. Creates ordinary fleets/races/starts, so data survives the gate being turned off. First enable seeds a complete worked championship ("Sample Championship 2026") into the workspace's Samples category. Off by default and not self-service: enable per-workspace for championship events; no GA until the format has been validated against a real event. |
| `world-sailing-id` | off | the **World Sailing Sailor ID** (#362) — the free identifier tied to a sailor's World Sailing profile, required for entry to most international events. Unlocks the **World Sailing ID** competitor field (a checkbox on the **Competitor fields** card, then a column and a dialog input), the **Seeding rank** field alongside it, and **Check Sailor IDs** — a batch lookup against World Sailing's datafeed reporting each ID as valid, valid but spelled differently, a mismatch against the name/nation we hold, unknown, or malformed, with an offer to fill blank nationalities from what World Sailing returned. A seed ranking from an organising authority arrives as a **Seeding rank** column on the entry list import, which the Split Fleets initial assignment then orders by. **The ID is per person and is recorded for the primary sailor only** — a keelboat's crew have nowhere to put theirs. Published results show it as a link to the sailor's World Sailing biography when the field is enabled, and the public JSON export carries it. Off by default: inert at a club, where nobody holds a Sailor ID. |
| `race-scoring-options` | off | the per-race **scoring options** dialog (#342) — reached from a race's header chip or its row in the **Races** tab — plus the badges the races list shows and the marks and legend the standings carry. Sets how much a particular race counts, as a NoR or SI may specify it: **must count** (never discarded, the centrepiece race), **discard first** (taken before any other when discards are selected — a practice race, dropped once real racing starts), and a **weighting** (×2 for a trophy race, ×0.5 for a lesser one; non-integer values allowed). Weighting a race up does not protect it from discard — an SI that wants both says both — and the weighted score is what discard selection and the RRS A8.1 tie-break compare. Only the *authoring* UI is gated: a series that already carries options scores, displays and publishes them regardless, so switching the feature off never silently changes anyone's standings. Off by default while the options prove out against a real NoR. |
| `race-management-metadata` | off | the **race record** (#338/#339): a per-race dialog — reached from the record line in a race's header, **Race record…** on its row in the **Races** tab, or `r` — holding the **conditions** the race was sailed in (wind as a min/max range in knots plus a 16-point direction, and a free-text course/tide note) and the **race management team** that ran it; plus a **Race management team** card on series **Settings** holding the event's *standing* team. The two levels are deliberately independent — no inheritance, no override — so a regatta uses the standing team, a club series with a rotating duty uses the per-race one, and a series that fills in both shows both. Roles are World Sailing's Race Management Manual vocabulary, fixed in code and race-management only (no jury titles): a club's "OOD" is a **Race Officer** and the person recording finishes is a **Recorder**, so two names for one job can't both appear. **Officials are published opt-in per series** — the **Publish the race management team** switch on that card is off by default, and while it is off no team reaches a published page *or* the JSON export embedded in it. Conditions publish regardless (they describe the racing, not a person). Only the authoring surfaces and the published display are gated; a series that already carries a record keeps it in its file and export. Off by default. **Revisit when ORC work starts:** wind is a *scoring* input for ORC performance-curve scoring, not just a display field, so a gate hiding the wind inputs would then be hiding a required input — at that point either split the gate or default it on. |
| `proportional-discards` | off | a second **kind** of discard rule (#341) on the **Scoring** card of a series' **Settings** tab: an allowance stated as a proportion — "one discard for every three races sailed", "one third of the results are discarded" — instead of a threshold per step-up. Set as two numbers (the race count at which the first discard applies, and how many further races earn each one after that); the card reads back where the steps land so the setup can be checked against the sailing instruction it came from. Counted against races **sailed**, rounded down, and capped at the number of races sailed. It **replaces** the threshold list for scoring while set; the thresholds are kept so switching back loses nothing. Only the *authoring* UI is gated — a series that already carries a rule scores and publishes with it regardless, so turning the feature off never silently changes anyone's standings. Off by default while the wording proves out against real sailing instructions. |

**Archivist credentials (ADR-010).** A class archive repo's CI pushes
as-published series through `/api/v1/archive` with an API key whose user
holds the **`archivist`** role in the target workspace — `read` +
`archive-ingest` only, so a leaked key can touch nothing but that
workspace's (already public) archive. Provision: `provision-org
pre-create-user` for a per-repo service user, add it to the workspace with
role `archivist`, then `provision-token create … --workspace <slug>
--admin` (bulk ingests make hundreds of requests; a plain key's rate limit
429s mid-corpus). See `docs/design/as-published-archives.md`.
The Members card never offers `archivist` in its role selects — it is an
operator-provisioned machine role, not a human membership tier; a member
holding it shows read-only in the roster (with Remove still available).

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
| `competitor-identity-crew` | changes which identities exist in an adopted corpus |
| `rankings` | groups by the identity spine, so adoption travels with it |
| `split-fleets` | expert machinery pending real-event validation; audience stays enumerable |

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

The CLI reads `DATABASE_URL`, and the three named scripts decide which
one: `pnpm provision-org` reads `.env.local` (the local dev loop),
`pnpm provision-org:test` targets the local container, and
`pnpm provision-org:prod` fetches the production secrets from Bitwarden
for the one run (see [account-admin.md](account-admin.md#production-usage)).
Never prefix a command with `DATABASE_URL=…` by hand — the Bash guard
blocks it, and the point of the `:prod` script is that it says out loud
where it is going before it goes there.

## What Phase 7 deliberately left out (since shipped in Phase 10)

- **Self-service org creation.** Landed as the admin-approved request
  flow from `/account`, fulfilled with `provision-org fulfil-request`.
- **Invitations and members management UI.** Landed as the Members card
  on `/workspace` plus `/accept-invitation`.
- **Activity log.** Phase 7 captured `updated_by` on every mutable row;
  the per-series Activity tab and recency strips landed in Phase 10.

See [ADR-008](design/decisions/008-full-stack-transition.md) for the
full scope and rationale.
