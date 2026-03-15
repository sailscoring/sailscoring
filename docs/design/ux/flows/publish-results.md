# Publish Results Flow

Detailed user flow for S-08: Series Standings — publishing results to bilge,
the MVP results-publishing service.

---

## Overview

After entering finishes and reviewing standings, the scorer publishes results
so that sailors and club officials can view them at a public URL. Publishing
posts scored HTML pages to [bilge](https://github.com/sailscoring/bilge), a
dedicated serverless service described in
[ADR-004](../decisions/004-results-publishing.md).

**Design principles:**

1. **One click for return publishers.** After the first publish establishes a
   UUID and verifies an email address, subsequent publishes are a single button
   press. No re-configuration, no re-verification.
2. **All pages at once.** A dual-scored series should not require the scorer to
   publish each fleet or scoring system separately. One button uploads everything.
3. **The listing URL is the shareable link.** The scorer shares a single bilge
   listing URL with sailors — not a list of page URLs they must track manually.
4. **The prefix lives in Settings; email lives in the app.** The scorer sets
   the publishing prefix once in S-01 (Series Settings). Their email address is
   an app-level setting — not specific to any series. The Standings screen is
   for reviewing results and triggering publication, not for configuring where
   they go.
5. **Clearly temporary.** The in-app publishing UI must not obscure the
   throwaway nature of bilge. A small note linking to bilge's retirement
   timeline is appropriate.

---

## Series Publishing Configuration

The scorer configures publishing once per series in **S-01: Series Settings**,
in a **Publishing card** alongside the existing Basics, Competitors, Fleets,
Scoring, and Discards cards.

### Fields

| Field | Notes |
|-------|-------|
| **Prefix** | The slug namespace for this series (e.g. `hyc/autumn-league-2026`). Defaults to a slugified version of the series name. **Locked after the first verified publish.** Changing the prefix after publishing would produce new slugs and orphan the old pages, so locking is the right trade-off. |

### Email address

The email address used for UUID verification is an **app-level setting**, not
a per-series field. The scorer sets it once (in an app settings screen outside
any series); it is used as the verification address whenever a new UUID is
first uploaded to bilge.

The email is:

- **Not stored in any series record** — not in IndexedDB series data
- **Not included in the series JSON export** — the export carries the UUID but
  not the email that verified it
- **Only sent to bilge on the first upload for a new UUID.** Once the UUID is
  verified, bilge identifies subsequent uploads by UUID alone. The email field
  is omitted from all return publishes.

The implication: a scorer who exports a series and imports it on another device
can re-publish immediately using the UUID — they do not need to re-enter their
email or re-verify, because the UUID is already known to bilge as verified.

### UUID

The UUID is the publisher credential the app presents to bilge. bilge has no
concept of a series — it only knows that a given UUID is either unverified,
pending, or verified, and which slugs that UUID owns. One UUID covers all page
slugs for the series. It is:

- Generated automatically on the first publish attempt
- Never shown to the scorer in normal operation
- Stored in IndexedDB alongside the series data
- Included in the JSON export/import so it survives device transfers

### Publishing status (per series)

| Status | Meaning |
|--------|---------|
| `unpublished` | No publish attempt has been made. UUID does not yet exist. |
| `pending` | First publish sent; verification email dispatched; scorer has not yet clicked the verification link. |
| `verified` | UUID is verified with bilge. All subsequent publishes go live immediately. |

### Stored data shape

The publishing state is stored in IndexedDB on the series record:

```json
{
  "publishing": {
    "service": "https://bilge.vercel.app",
    "uuid": "550e8400-e29b-41d4-a716-446655440000",
    "status": "verified",
    "prefix": "hyc/autumn-league-2026",
    "pages": [
      {
        "slug": "hyc/autumn-league-2026/junior",
        "url":  "https://bilge.vercel.app/r/hyc/autumn-league-2026/junior"
      },
      {
        "slug": "hyc/autumn-league-2026/class-2-irc",
        "url":  "https://bilge.vercel.app/r/hyc/autumn-league-2026/class-2-irc"
      },
      {
        "slug": "hyc/autumn-league-2026/class-2-nhc",
        "url":  "https://bilge.vercel.app/r/hyc/autumn-league-2026/class-2-nhc"
      }
    ]
  }
}
```

The `service` field is stored so a future migration tool can identify bilge
uploads and move them to the full-stack system (see ADR-004 §Retirement).

### Publishing card (S-01, collapsed states)

**Before any configuration:**

```
┌─ Publishing ──────────────────────────────────────────────────────────┐
│  Not configured                                     [Set up ▸]        │
└───────────────────────────────────────────────────────────────────────┘
```

**Configured, not yet published:**

```
┌─ Publishing ──────────────────────────────────────────────────────────┐
│  hyc/autumn-league-2026                             [Edit ▸]          │
└───────────────────────────────────────────────────────────────────────┘
```

**Pending verification:**

```
┌─ Publishing ──────────────────────────────────────────────────────────┐
│  Awaiting email verification · hyc/autumn-league-2026   [Edit ▸]      │
└───────────────────────────────────────────────────────────────────────┘
```

**Verified:**

```
┌─ Publishing ──────────────────────────────────────────────────────────┐
│  hyc/autumn-league-2026 · Prefix locked after first publish           │
└───────────────────────────────────────────────────────────────────────┘
```

### Publishing card (S-01, expanded)

```
┌─ Publishing ──────────────────────────────────────────────────────────┐
│  Prefix   [ hyc/autumn-league-2026____________________ ]              │
│           ↑ auto-filled from series name; editable                    │
│                                                                        │
│  Verification emails go to your publishing address in app settings.   │
│                                                                        │
│  Results are published via bilge, a temporary service.                 │
│  bilge will be retired when Sail Scoring ships its full-stack version. │
│                                                                [Done]  │
└───────────────────────────────────────────────────────────────────────┘
```

---

## Slug Derivation

Published pages are one per fleet per scoring system:

| Fleet | Scoring systems | Slug |
|-------|----------------|------|
| Junior | Scratch | `{prefix}/junior` |
| Class 2 | IRC + NHC | `{prefix}/class-2-irc` and `{prefix}/class-2-nhc` |
| Puppeteer 22 | Scratch + NHC | `{prefix}/puppeteer-22` and `{prefix}/puppeteer-22-nhc` |

**Single-system fleets:** slug is `{prefix}/{fleet-slug}`.

**Dual-scored fleets:** slugs are `{prefix}/{fleet-slug}-{scoring-system-slug}`
for each system.

The `{fleet-slug}` is the slugified fleet name. The `{scoring-system-slug}` is
`irc`, `nhc`, or `py` as appropriate. The scratch system has no suffix — it is
the default for a one-design fleet.

`slugify`: lowercase, replace runs of non-alphanumeric characters with a single
hyphen, strip leading/trailing hyphens.

Slugs are derived automatically and are not editable by the scorer. The prefix
is the only user-controlled part of the URL.

---

## The Publish Button (S-08)

The **Publish results** button appears in the header of the Standings screen.
Its state reflects the series publishing status:

| Status | Button label | Button state |
|--------|-------------|-------------|
| No prefix configured (or no app-level email set) | Publish results | Disabled; tooltip: "Configure publishing in Settings first" |
| Configured, unpublished | Publish results | Active |
| Publishing in progress | Publishing… (N of M) | Disabled (in-progress) |
| Pending verification | Awaiting verification | Active (allows retry — see §Flow: Pending) |
| Verified, previously published | Publish results | Active |

After a successful publish (all pages uploaded), the Standings screen shows:

```
┌───────────────────────────────────────────────────────────────────────┐
│  Results published                                                     │
│                                                                        │
│  Listing: bilge.vercel.app/l/hyc/autumn-league-2026/     [Copy link]  │
│                                                                        │
│  Individual pages:                                                     │
│  · Junior          bilge.vercel.app/r/…/junior           [Copy]       │
│  · Class 2 IRC     bilge.vercel.app/r/…/class-2-irc      [Copy]       │
│  · Class 2 NHC     bilge.vercel.app/r/…/class-2-nhc      [Copy]       │
│                                                     [Publish again ▸]  │
└───────────────────────────────────────────────────────────────────────┘
```

The **listing URL** (`/l/{prefix}/`) is the primary link to share. It lists all
verified pages under the prefix — no index page needed from the app. Individual
page links are available for scorers who want to link directly to a specific fleet.

---

## Flow: First Publish

The scorer navigates to S-08 (Standings). Publishing is configured in Settings
but no publish has happened yet (`status: unpublished`).

### Step 1 — Click "Publish results"

The app checks for a UUID. Finding none, it generates one (UUID v4) and stores
it in the series record.

### Step 2 — Generate HTML pages

For each fleet × scoring system combination, the app generates a full HTML
page containing:

- Series standings table for that fleet/scoring system
- Individual race results below the standings
- Series name, fleet name, scoring system label, generated timestamp

All pages are generated in memory before any upload begins. If page generation
fails (e.g. no results yet for a fleet), that page is skipped with a warning.

### Step 3 — Upload pages sequentially

The app uploads each page to bilge in sequence (not parallel — simpler error
handling, clearer progress):

```
┌───────────────────────────────────────────────────────────────────────┐
│  Publishing results…                                                   │
│                                                                        │
│  ✓  Junior               (1 of 3)                                      │
│  ⟳  Class 2 IRC          (2 of 3)                                      │
│  ○  Class 2 NHC          (3 of 3)                                      │
└───────────────────────────────────────────────────────────────────────┘
```

Each upload POSTs to bilge `/upload` per ADR-004. The `email` field (from app
settings) is included only on the first upload for this UUID — bilge requires
it then, and ignores or rejects it once the UUID is already known.

### Step 4 — Handle responses

| Response | Handling |
|----------|---------|
| `202 pending` | Expected for first publish. Set `status: pending` on the series. Mark this page as pending. Continue uploading remaining pages. |
| `200 published` | Not expected on first publish (UUID was just generated). Store the URL anyway. |
| `409 slug_conflict` | Mark this page failed. Show error: "Slug already claimed — contact the operator." Continue other pages. |
| `413 too_large` | Mark this page failed. Show error: "Page too large (> 512 KB)." |
| `401 unauthorized` | Abort all uploads. Show: "Publishing configuration error — check app settings." (API key problem; not user-fixable.) |
| Network error | Retry once automatically. If still failing, mark page failed and continue. |

### Step 5 — After all uploads complete

If all pages returned `202 pending`:

```
┌───────────────────────────────────────────────────────────────────────┐
│  Check your email                                                      │
│                                                                        │
│  A verification link has been sent to scorer@example.com              │
│  (your publishing address in app settings).                            │
│  Click the link to publish your results. The link expires in          │
│  10 minutes.                                                           │
│                                                                        │
│  Once verified, your results will appear at:                           │
│  bilge.vercel.app/l/hyc/autumn-league-2026/                           │
│                                                              [Done]   │
└───────────────────────────────────────────────────────────────────────┘
```

If any pages failed, a summary lists the failures below the success count.
The scorer can retry individual pages by clicking "Publish results" again
(the UUID is now set; only failed pages are retried on the next attempt).

---

## Flow: Return Publish (Verified UUID)

The scorer has previously published and clicked the verification link. The
series `status` is `verified`.

### The happy path

1. Scorer opens S-08 (Standings).
2. Clicks **Publish results**.
3. The app generates HTML pages.
4. Uploads sequentially. All pages return `200 published`.
5. Shows the URL panel (listing link + individual links).

No email, no waiting. One click from standings to live results.

### Partial failures

If any page returns an error:

- Successful pages are shown with their URLs.
- Failed pages are listed with their error.
- A **Retry failed** button re-uploads only the failed pages.

---

## Flow: Pending State

The scorer published for the first time but has not yet clicked the
verification link — or the 10-minute window expired.

### Returning scorer (verification still valid)

The series `status` is `pending`. On S-08, the Publish button shows
**Awaiting verification** and the banner reads:

```
┌───────────────────────────────────────────────────────────────────────┐
│  Awaiting email verification                                           │
│                                                                        │
│  Check your publishing email (scorer@example.com) for a              │
│  verification link. The link expires 10 minutes after your last       │
│  publish attempt.                                                      │
│                                                                        │
│     [Resend / publish again]                                           │
└───────────────────────────────────────────────────────────────────────┘
```

**Resend / publish again** re-uploads all pages with the same UUID. bilge
will:
- See the UUID as already known (pending)
- Dispatch a fresh verification email
- Reset the 10-minute expiry

The button label deliberately covers both intents — the scorer may be
clicking because they want to resend the email, or because they want to
pick up results from a race entered since the first publish.

### Returning scorer (verification window expired)

Bilge deletes the pending upload after 10 minutes. The pages are not live.
However, **the UUID is not invalidated** — it remains pending in bilge and
the verification email can be resent by re-uploading.

The app cannot distinguish "pending, window still open" from "pending, window
closed" — it has no way to query bilge's internal state. This is acceptable:
the **Resend / publish again** button works in both cases, and the scorer will
find out whether their results are live by visiting the listing URL after
verifying.

### After clicking the verification link

bilge marks the UUID as verified and makes all pending pages live. The scorer
does not need to return to the app — results are already published. When they
next open the app and navigate to S-08, the status will still show `pending`
because the app has no push mechanism from bilge.

The `pending → verified` transition in the app occurs on the **next publish
attempt**: bilge returns `200 published` (not `202 pending`), and the app
updates `status` to `verified`.

---

## HTML Page Structure

Each published page covers one fleet and one scoring system. It contains:

### Header

- Series name (e.g. "HYC Autumn League 2026")
- Fleet name (e.g. "Class 2")
- Scoring system (e.g. "IRC" — omitted for single-system fleets)
- "Published by Sail Scoring" with a link to the app
- Generated timestamp

### Series Standings Table

Columns: Rank · Sail No. · Helm · Boat · Points per race (R1, R2, … Rn)
· Total · Discards · Net.

Discarded race scores are shown struck through in the per-race columns.
Result codes (DNS, DNF, DSQ, etc.) are shown in place of numeric points.

### Race Results (per race)

Below the standings, one results block per race:

- Race number and date
- Ranked list: Place · Sail No. · Helm · Corrected time (if handicap) · Points

Non-finishers (DNS, DNF, etc.) listed at the foot of each race block.

### Footer

- "Results subject to protest and appeal" (standard sailing results caveat)
- bilge retirement note: "Published via bilge — a temporary service"

---

## Out of Scope for MVP

| Feature | Reason deferred |
|---------|----------------|
| Selective publish (choose which fleets to publish) | Adds complexity; publish-all is simpler and covers all known use cases |
| Unpublish / delete a page | bilge has no delete endpoint; requires direct Vercel Blob access by operator |
| Custom page templates / styling | One standard template is enough for MVP validation |
| Slug editing | Prefix is the scorer-controlled part; per-page slugs are derived automatically |
| Push notification when verification completes | Requires a push mechanism bilge does not have |
| Division-filtered sub-pages | Could publish division standings separately; deferred — no clear demand yet |
| Password-protected results | No authentication model in bilge MVP |
