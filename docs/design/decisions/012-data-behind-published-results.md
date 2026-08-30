# ADR-012: The data behind a published results page

**Status:** Accepted (amended 2026-08-30 — the view-only destination is
strictly read-only; see the note in the Decision)

**Date:** 2026-08-29

**Deciders:** Mark McLoughlin

## Context

Every published results page today carries an "Open in Sail Scoring" link
in its footer, with the entire series embedded in the URL as base64. The
feature landed early in the project, has probably been used rarely, and
the recent analysis of it (#465, #466) has been narrow: how to make the
link work for signed-out readers, and how to get 325 KB of base64 out of
an 847 KB page. Both are real problems, but they are symptoms. This ADR
steps back and treats the feature as if it did not exist, and asks what —
if anything — should stand behind a published results page.

### Problem statement

A published results page is a rendering. The question is whether the
*data* it renders should also be public, in what form, and what a reader
should be able to do with it.

The conviction driving this: **a greater level of transparency should be
a differentiator for Sail Scoring.** Concretely:

- A Sailwave results page gives you nothing behind it. A parent at an
  IODAI event with an idle curiosity about how the event is set up and
  scored cannot get the `.blw` — it lives on the scorer's laptop.
- HalSail shows a public view, but the scorer's view is out of reach.
  While designing sub-series support, we asked DBSC for view-only access
  to their HalSail results, weren't given it, and ended up reproducing
  HYC results as a HalSail tandem series just to understand how the
  mechanism worked. That is the experience of a *motivated, friendly*
  reader; a casual one just gives up.
- For handicap racing, some competitors would genuinely enjoy "what if"
  play — tweaking finish times and watching the effect ripple through
  corrected times and standings.
- Interested parties might re-score an event under a different
  configuration (a different rating system, different discard profile).
- A scorer evaluating Sail Scoring would learn more from opening a real
  event's results in the app than from any amount of documentation.
- Data that is easily exported in a documented format invites uses nobody
  planned for — club websites, class-association statistics, a
  competitor's personal tooling. Portability enables innovation we can't
  predict, and that is a feature, not a risk.

Two fidelity requirements shape any design:

- If "Open in Sail Scoring" continues to exist, it must open **exactly
  the results the reader is viewing** — not a newer unpublished state of
  the series, not an approximation.
- The data behind the page must contain **nothing the scorer chose not to
  publish**. Transparency is about the published record, not about
  turning the scorer's working file inside out.

One question we are genuinely ambivalent on, recorded here as open: if a
page is unpublished but someone kept a copy, should the copy still open?
There is an argument each way — a self-contained artifact keeps its
promise forever; an unpublished page arguably had its promise withdrawn.

## Background: what exists today

### Two serialization formats with overlapping purposes

The codebase carries two ways to write a series down, and the overlap
between them is itself one of the problems:

- **The `.sailscoring` file** (`lib/series-file.ts`, format v41) is the
  scorer's working file: every internal UUID, FTP configuration, the
  embedded revision history — including actor display names and emails —
  and every field regardless of publish opt-ins. It exists for backup and
  for moving a series between workspaces. It is private by nature; it is
  the analogue of Sailwave's `.blw`.
- **The public JSON export** (`lib/public-export.ts`) is a stripped,
  portable snapshot: no UUIDs (competitors are keyed by sail number,
  fleets by name), no FTP configuration, no revision history. It exists
  for exactly the transparency purpose above — but today its only
  distribution channel is the embedded footer link.

The split is right in principle — full fidelity for the owners, a
sanitized public tier for everyone else — but the relationship between
the two formats is nowhere stated, and each evolves separately (the
Feature Checklist has to remind us to update both).

### The embedded blob and its import path

`buildFleetHtmlFiles` (`lib/results-export.ts`) builds the public export
from the *same snapshot and standings* used to render the page, encodes
it base64url, and embeds it as `app.sailscoring.ie/import#data=<blob>` in
every page footer, gated on `series.includeJsonExport` (default on). Two
properties fall out of that construction, one good, one bad:

- **Fidelity is exact by construction.** The blob is the rendered data —
  never a newer unpublished state. Any redesign must preserve this.
- **Every viewer pays for it.** On the measured 141-boat page the blob is
  ~325 KB, 38% of the page, downloaded by every reader whether or not
  they ever notice the link (#466) — and base64 compresses poorly, so
  the cost survives gzip.

`/import` (`app/import/page.tsx`) decodes the fragment client-side,
confirms, and imports a *copy* into a workspace of the reader's choosing.

### The known issues

- **The link fails for exactly its audience.** `/import` sits behind the
  auth wall; the proxy builds its sign-in `callbackURL` from path+search,
  and the fragment — which is never sent to the server, and cannot follow
  a magic link through an inbox — is lost. A signed-out reader lands on
  an empty `/import` (#465). There is no view-only mode: the only thing a
  reader can *do* with the data is become a user and import a copy.
- **Page bloat**, as above (#466).
- **Discoverability is near zero.** A quiet footer link most people will
  never notice. (There is something to be said for the easter-egg
  quality — a capability like this is almost more striking when it isn't
  shouting — but it should be a choice, not an accident.)
- **The export's contract wobbles between two rationales.** Checking the
  suspected RaceSense leak: it is *not* there — `trackData` is gated on
  `series.publishTrackData`, and the code comments state explicitly that
  being left out of this export is what "not published" means (same for
  officials under `publishOfficials`). But the export also deliberately
  carries data the page does not show, under a different rationale —
  *scoring reproducibility*: `elapsedSecs` travels unconditionally even
  when the column is hidden (gating it would make a re-import score
  differently); every competitor field travels regardless of which
  columns the series displays (gender, helm and crew names, World
  Sailing IDs — some of these are scoring/prize inputs, some are just
  hidden columns); DPI `penaltyLabel` text and unresolved
  `unknownSailNumber` rows travel too. Each choice is individually
  defensible, but the export as a whole answers to two masters — "what
  the page publishes" and "what reproduces the scoring" — and no
  document says which wins where. Whether hidden-column data in a public
  blob is a leak or the whole point depends on answering the problem
  statement above.

## Survey: how others handle the data behind results

Not exhaustive — examples chosen to stake out the poles.

### Sailwave — portable file, ad hoc transparency

The `.blw` is fully self-contained by design: "everything needed to score
the series is contained within the .BLW file", and the user guide
celebrates the portability — a scorer needing help is told to email the
file to more experienced users, who can then see exactly how the event
was set up (`reference-docs:tool-manuals/sailwave/`). That sharing
culture is the closest thing in sailing to what we want. But it is
all-or-nothing and ad hoc: the `.blw` is the *working* file, so the same
guide warns that posting one publicly may breach data-protection law —
there is no sanitized tier. A few clubs publish `.blw` files alongside
their HTML (HYC's own archive has them); most don't, and nothing in the
published HTML points at the data even when it exists.

### HalSail — server of record, admins only

The opposite pole. Results live in HalSail's database; the public gets
rendered views. A club administrator can download a "Hal file" for
backup or offline editing — but only an administrator, and only on a
paid account (trial accounts explicitly cannot download their own data).
There is no view-only access to the scorer's configuration at any price;
our DBSC experience above is the system working as designed. Everything
about how a series is *set up* — tandems, discards, handicap policy — is
invisible from outside.

### ORC — publishing the scoring inputs as policy

ORC publishes every certificate: anyone can look up any boat and
download the certificate with its speed guide. The scoring *inputs* are
public record as a matter of policy, on the reasoning that competitors
can only trust corrected-time racing if they can inspect what corrects
it. That is transparency-as-legitimacy — the same argument that applies
to a club's discard profile or rating overrides.

### Outside sailing

- **Lichess** makes every game's PGN one click away and publishes the
  entire game database for bulk download. Transparency is the product's
  identity, and an ecosystem of third-party tools grew on top of it —
  the "who-knows-what innovation" effect, observed in the wild.
- **A public GitHub repository** doesn't distinguish the rendered page
  from the data: the clone *is* the repo. Nobody asks whether readers
  should get the whole thing; that's what public means.
- **A Google Docs view-only link** is the reference point for "view
  without an account": anyone with the link can read; *Make a copy* —
  the analogue of our import — is where sign-in enters.
- **Observable / Jupyter notebooks** publish the document and the
  re-runnable artifact as one thing. The reader who wants to tweak a
  parameter and re-run is a first-class audience, not an edge case —
  the closest analogue to "what if" play with finish times.

The poles, then: HalSail treats the data as the club's private property
with rendered views as the product; Lichess/GitHub treat the published
data as the product with views as conveniences. Sailwave sits awkwardly
between — portable in format, opaque in practice. The problem statement
places us deliberately toward the open pole, with the scorer's publish
opt-ins as the boundary.

## Decision drivers

- Transparency as a differentiator — the data behind a published page
  should be reachable by anyone, in a documented format.
- Exact fidelity — what opens is what was viewed, never a newer state.
- The publish opt-ins are the privacy boundary; nothing unpublished
  travels, and the export's contract should be stated, not implied.
- Page weight — the audience is a phone on a crowded cell in a dinghy
  park (#466); the data must not tax readers who don't want it.
- The signed-out reader is the audience, not an edge case (#465).
- Standalone artifacts (FTP uploads, downloaded pages) must keep
  working with no server behind them.
- One mechanism, not three — the fix should not add a second payload
  format or a second import path beside the existing ones.

## Considered options

Two nearly independent axes run through these: **where the data lives**
(inline in the page / a published sidecar / a live server reference) and
**what a reader can do with it** (download it / view it in the app
without an account / import it into a workspace). The options below are
the plausible combinations.

### Option 1: Nothing behind the page

The HTML is the publication; owners have `.sailscoring` files and the
workspace. Remove the blob and the link.

**Pros:**
- Smallest pages, zero leak surface, nothing to maintain.
- What every other sailing product does by default.

**Cons:**
- Abandons the differentiator entirely; every motivation in the problem
  statement goes unserved.
- Discards a working (if hidden) capability rather than fixing its
  delivery.

### Option 2: Self-contained pages, patched (the status quo shape)

Keep embedding the export in every page; fix the delivery — take
`/import` out from behind the auth wall so the reader at least sees what
the link holds before being asked to sign in, and perhaps surface the
link a little better.

**Pros:**
- Exact fidelity by construction; the artifact works offline, on FTP
  sites, and forever — the downloaded-copy question answers itself
  (yes, it still opens).
- No new server surface.

**Cons:**
- Every reader keeps paying ~325 KB for a link almost nobody clicks —
  directly against the dinghy-park driver, and #466 stays open.
- The reader still can't *do* anything without an account except
  download; "view-only without logging in" doesn't fit this shape well.
- The blob stays invisible in view-source-hostile mobile browsers; as
  data portability it is technically present, practically absent.

### Option 3: The data as a published sidecar artifact

Publishing a page also publishes the public export as a file beside it —
a "data behind this page" link (e.g. `…/standings.sailscoring.json`)
written at publish time from the same snapshot as the page. "Open in
Sail Scoring" becomes a small link that fetches it; so can anyone's
`curl`. Unpublishing removes it with the page. Standalone outputs (a
downloaded page, an FTP page for a never-published series) either keep a
small inline copy or link to the app copy when one exists.

**Pros:**
- Pages shed the blob for every reader; the data costs only those who
  ask for it.
- Fidelity stays exact — the sidecar is snapshot-pinned at publish, not
  resolved against the live series.
- The export becomes a *visible, documented, linkable* artifact — the
  portability story becomes real (a URL you can hand to a script).
- Unpublish semantics are coherent: the public copy disappears; a
  previously downloaded file still works.

**Cons:**
- A second published artifact to version, store, and keep in step with
  re-publishes (though it is written by the same code path at the same
  moment, so drift is unlikely by construction).
- Two delivery modes to maintain (sidecar for published, inline for
  standalone) — though #466's analysis shows the three call sites
  already distinguish these cleanly.

### Option 4: A live reference into the app

Published pages carry only a reference URL — `/open/{workspace}/{page}`
— resolved server-side against the published series (the shape sketched
in #465/#466). No payload anywhere.

**Pros:**
- Cheapest to build; fixes #465 and #466 in one move.
- No second copy of the data to store.

**Cons:**
- Resolving against the *live* series breaks the fidelity requirement:
  the reader can be handed a newer state than the page they were
  looking at. Pinning the reference to a publication-time revision
  (the #166 machinery) repairs this — at which point the option has
  converged on Option 3 with extra steps.
- Unpublishing kills the link even in copies people kept, and the
  standalone/FTP outputs still need an inline fallback anyway.
- The data is only reachable *through* the app — weaker as portability
  than a fetchable file.

### Option 5: View-only mode without an account

Orthogonal to 2/3/4, and the option that actually delivers the
differentiator: the app can open a public export **read-only with no
sign-in** — browse the standings, the races, the settings that produced
them; make scratch edits ("what if" a finish time) that live only in the
browser; and "save to my workspace" is the one door where sign-in
appears (the Google-Docs boundary: view freely, copy with an account).
The scoring engine already runs client-side, so no server persistence is
needed for the scratch tier.

**Pros:**
- Serves every motivation in the problem statement directly: the curious
  parent, the what-if competitor, the re-scoring tinkerer, the
  evaluating scorer.
- Turns every published event into a live demonstration of the product.
- Makes the auth-wall problem (#465) structural rather than patched:
  the reader was never supposed to need an account to look.

**Cons:**
- The largest build: a read-only/scratch presentation of the series
  pages, which today all assume a workspace behind them.
- Needs care that "scratch edits" can't be mistaken for the official
  record (clear provenance banner, no publish path from scratch).
- Depends on one of Options 2–4 for how the data arrives.

## Decision

**Options 3 and 5, together**: the data behind a published page is a
snapshot-pinned public sidecar file, built toward a view-only mode that
needs no account. Option 3 without 5 fixes the plumbing but leaves the
differentiator unbuilt; Option 5's entry point wants exactly the
fetchable, pinned artifact Option 3 creates — so 3 ships first and
stands alone, and 5 is the destination it is built toward.

*Amended 2026-08-30:* Option 5 is adopted **without its scratch-edit
tier**. The viewer is strictly read-only; a reader who wants to change
anything — the "what if" play included — goes through the one door:
sign in, import a copy, and experiment there with the full app behind
it. That serves the what-if motivation better than an ephemeral scratch
copy (the experiment persists, and can never be confused with the
published record), and it removes both the provenance risk and most of
Option 5's build cost.

The questions the draft left open are resolved as follows:

- **The export's contract.** The export carries **everything needed to
  re-score the published results** — that holding is the priority; the
  file is meaningless if it does not — **and beyond that, nothing that
  is not in the published HTML**. So scoring and prize inputs travel
  unconditionally (elapsed times, ratings, whatever the configured
  scoring and prize rules read, shown or not); display-only data
  follows its publish opt-in, as officials and track data already do;
  and hidden competitor columns that no scoring or prize rule reads are
  dropped. This is a behaviour change from today's export, which
  carries every competitor field regardless of displayed columns.
- **The file is distinguishable from the backup by suffix.** The public
  sidecar is published as **`.sailscoring.json`** — the suffix says
  "open data, plain JSON", and browsers and scripts treat it as such —
  while bare `.sailscoring` remains the scorer's private working file
  carrying the unsanitized remainder (internal ids, FTP configuration,
  revision history). The two formats' relationship is now stated: the
  public export is the sanitized projection of the series; the
  `.sailscoring` file adds the private remainder.
- **Unpublish deletes the sidecar** along with the page. A copy someone
  downloaded first keeps working — a self-contained artifact keeps its
  promise — but the public copy's promise is withdrawn with the page.
  Standalone outputs (a downloaded page, an FTP page of a
  never-published series) keep an inline copy, as today.
- **The public export becomes a stable, versioned, documented file
  format.** It is an API surface the moment it has a URL; changes to it
  follow the same discipline as the `.sailscoring` format's versioning,
  and the format gets a public document.
- **Discoverability stays quiet, but stops being accidental.** The
  placements considered: a louder page-chrome affordance (a download
  control beside the print button); a data link per publication on the
  `/p/` index pages; the quiet footer line; and pure convention (a
  documented URL rule with no on-page link at all). Decided: the footer
  credit line carries both links — "Open in Sail Scoring" and the
  `.sailscoring.json` file — and the machine-facing discoverability is
  made real regardless of placement: each page declares the sidecar via
  `<link rel="alternate" type="application/json">`, the URL convention
  is documented in the format document and the help docs. The
  easter-egg quality is kept deliberately: the reader who notices gets
  the mind-blowing moment, the script author gets a documented rule,
  and nobody's phone pays for a button they didn't want. Louder chrome
  is worth revisiting when view-only mode ships and the link leads
  somewhere a casual reader can actually go.

Design depth beyond this — sidecar storage and naming within the `/p/`
tree, the field-by-field export pass, the shape of view-only mode — is
deliberately left to the implementation issues.

## Consequences

### Positive

- Published pages shed the ~325 KB payload for every reader; the data
  costs only those who ask for it (#466's payload half).
- The portability story becomes real: a documented, versioned, fetchable
  format rather than a blob hidden in an href.
- A signed-out reader can finally *get* the data (#465's audience), and
  view-only mode makes the auth wall structurally irrelevant to reading.
- Every published event becomes a live demonstration of the product.

### Negative

- A published format is a compatibility commitment; the export can no
  longer evolve casually.
- Meeting the stated contract needs a field-by-field pass over the
  export, and dropping hidden non-scoring fields is a behaviour change
  for existing embedded blobs' consumers (there are unlikely to be any,
  but it is a change).
- Two delivery modes to maintain: sidecar for published pages, inline
  for never-published standalone outputs.

### Risks

- View-only mode is the larger build and could stall — mitigated by
  shipping Option 3 first (it stands alone and loses nothing by
  waiting), and by the 2026-08-30 amendment, which drops the scratch
  tier and with it most of the remaining cost and the risk of local
  edits being mistaken for the official record.

## Related decisions

- [ADR-004](004-results-publishing.md): the original publishing shape
  the embedded link was built for.
- [ADR-008](008-full-stack-transition.md): the auth wall and workspace
  model the import path now runs into.
- [ADR-011](011-public-results-navigation.md): the `/p/` tree any
  sidecar or reference URL would live in.
- [ADR-010](010-as-published-archives.md): archives are display-only ingests — whether
  archive pages should carry data behind them at all is a follow-on
  question.

## References

- #465 — "Open in Sail Scoring" loses the series for anyone not already
  signed in.
- #466 — Published results pages are ~847 KB, three quarters of it
  avoidable (the payload half; flags are #468).
- `lib/public-export.ts`, `lib/results-export.ts`,
  `app/import/page.tsx`, `lib/series-file.ts`.
- `reference-docs:tool-manuals/sailwave/Sailwave-User-Guide-2025-V16.md`
  (BLW portability and the data-protection caution),
  `reference-docs:tool-manuals/halsail/HalSail-FAQ.md` (Hal file
  download, admin-only).
