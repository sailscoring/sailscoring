# Horizon

Long-range possibilities worth remembering but not actively tracking as issues.
Not scheduled, not designed — just captured so they're not lost.

---

## API, SDK & CLI follow-ons (ADR-009)

[ADR-009](decisions/009-api-and-cli.md) is accepted and partially implemented:
M1–M3 (keyed API access, the `POST /api/v1/series/import` endpoint, and the
bulk-import CLI with publish / categorise / archive) and the M4 read surface
have landed. The remaining roadmap milestones are captured here so they aren't
lost if their tracking issues go stale; the ADR's Roadmap section holds the
fuller framing.

### M4 Tier 3 — CLI long-tail reads

The stretch of the read surface: `ratings irc|echo|vprs`, `member list`,
`revision list --series`, `trash list`. The grammar and conventions are already
in place, so each is a thin command over an existing GET. Tracked on the M4
issue.

### M5 — Token-management UX

An `/account` "API keys" card (create / list / revoke, plaintext shown once,
default-workspace picker), retiring the `provision-token` bootstrap script for
normal users. Likely feature-gated while experimental.

### M6 — OpenAPI spec + TypeScript SDK

Generate an OpenAPI 3.1 description from the Zod schemas (with a CI
route-coverage assertion), extract the TS SDK (`api-repository` promoted to a
publishable typed client), and refactor the CLI to ride it. The inflection
point from "internal contract" toward a real public API.

### M7 — CLI breadth (create / update / delete)

Full write verbs across the resource grammar (`series create`,
`competitor create/update/delete`, `race …`, etc.) beyond M3's action verbs and
M4's reads, so the CLI can drive any workflow the app can. Includes proper
distribution: a published npm package / `npx sailscoring`, and a standalone,
dependency-free executable (Node SEA / Bun) to replace the current
tsx-at-runtime bin.

### M8 — Documented public API

Stability / deprecation policy, published spec + docs, rate-limit / quota
policy, and polyglot SDKs generated on demand — its own follow-up ADR.

---

## Third-party integrations

### Mobile finish-recording app

A mobile app for finish-line officials to log boat finishes in real time — using voice
recognition or document scanning — is a natural third-party application built on the
Sail Scoring API. It would be a thin write client: POSTs finish times (or positions)
as boats cross the line, with no scoring, series management, or standings logic of its own.

Shapes API design: the finish-recording use case requires a simple, low-latency write
endpoint, which should inform how the external API is scoped and authenticated. Voice
and scanning input are specific enough to be worth designing the data model around
(e.g. tolerating corrections, ambiguous identifiers).

Sail Scoring's public documentation should explicitly invite this kind of integration
and describe the API surface it would use.

*(Was GitHub issue #15)*

### Live results display for clubhouse big screens

A read-only display client consuming the Sail Scoring API, designed for large screens
in a clubhouse or race office — big text, high contrast, minimal chrome, cycling between
current race standings, series standings, and next start times.

Real-time or near-real-time read access has different requirements to the write API —
likely polling or a push mechanism (WebSocket / SSE). Shapes how standings data is
exposed: the API needs to serve current standings cheaply and frequently.

A clubhouse display is immediately tangible to sailors and clubs — a good example to
lead with in developer-facing documentation.

HalSail has an equivalent in its "web page sequencer" (`halsail.com/Sequence/Preview`):
show a sequence of web pages, each visible for a configurable number of seconds, then
auto-advance and recycle indefinitely until stopped. It's completely generic — any URL,
not tied to its own results pages — so it's effectively a kiosk rotator rather than a
purpose-built standings display. Worth noting only as prior art that the feature is
wanted in the wild.

*(Was GitHub issue #16)*

### Submit results to Irish Sailing and RYA

After scoring a series, results could be submitted back to Irish Sailing (for ECHO
and IRC) and the RYA (for PY). This closes the loop: handicap authorities use race
results to update handicap numbers. Currently this is a manual process involving
spreadsheets or web forms. Automating it would be valuable to both scorers and the
authorities, but requires agreement on data format and access.

### Push competitor list to racingrulesofsailing.org

racingrulesofsailing.org (RRS.org) is the de-facto online tool for race-committee /
jury workflows — protest and request-for-redress filing, hearing scheduling, and
notice-board posting. Events that score in Sail Scoring may run their protest process
on RRS.org, and that tool needs the same competitor list. Today RRS.org imports it from
Sailwave via a plugin: the scorer opens the **RRS Interface** widget under Sailwave's
Plugins menu, pastes the event-specific **UUID** from the RRS Event Panel, and clicks
upload (repeatable — re-uploading syncs changes). See
`https://www.racingrulesofsailing.org/pages/help/sailwave_import`.

Sail Scoring could offer the same: the scorer pastes an RRS event UUID into a series and
pushes its competitors to RRS.org, re-pushing on change. Most of the fields RRS.org
accepts already map cleanly onto our competitor model — Class, Division, Boat Name,
SailNo, NAT, HelmName (→ First/Last Name), MNA No., Club Name — so for those it is a
transport question, not a data-model one.

Two fields RRS.org wants, though — **Email** and **Phone** — Sail Scoring deliberately
does *not* store. Contact details belong to the event-management / entry system, not the
scoring engine (they are never needed to compute or publish a result), and holding them
purely to relay them onward to RRS.org is not a trade worth making. So rather than push
them from stored data, the cleaner design is to do the RRS.org hand-off **at CSV-import
time**: the "import competitors from CSV" dialog gains an "also push to RRS.org" option,
reads the email / phone columns straight out of the uploaded CSV, sends them to RRS.org
alongside the rest, and discards them — they never land in the Sail Scoring data model.
The entry system already owns that data; Sail Scoring becomes a convenient relay point
for it without becoming a store of record for private info.

The integration contract is no longer an open question: RRS.org now publishes an
"AI import" help page that documents the endpoint (`POST
https://www.racingrulesofsailing.org/api/competitors`), the payload shape, and the
replace-not-merge semantics — the event UUID in the body is the only credential. One
consequence of those semantics must be made clear to users in the UI: every import
deletes and re-creates *all* competitors previously imported via the API for that event,
so any edits made to them inside RRS.org since the last push are overwritten (competitors
entered manually in RRS.org are untouched). The contract, a worked import, and a sketch
of the dialog integration are captured in `docs/notes/rrs-org/competitor-import-api.md`. Maps to the same "thin write client over
the Sail Scoring API" framing as the mobile finish-recorder above, except here Sail
Scoring is the *source* pushing to an external sink rather than the API being consumed.

---

### Pull scoring inquiries and protest decisions back from racingrulesofsailing.org

The competitor-push above is one half of the RRS.org loop; this is the other half. Once
an event runs its protest/redress process on RRS.org, decisions there change the score:
a scoring inquiry ("my finish position is wrong"), a protest decision (DSQ a boat, or
reinstate one), or a request for redress that awards points by some redress method. Today
the scorer learns of these out-of-band — a jury chair emails the result, or they read the
notice board — and re-enters the consequence into the scoring tool by hand, with no link
back to the decision that caused it.

Sail Scoring could surface RRS.org's open items inline: pull the event's scoring inquiries
and hearing decisions for a series and show them as a worklist on (or beside) the relevant
race, so the scorer sees "Inquiry: boat 1234, claims finish should be 3rd not 5th" or
"Protest 7: 1234 DSQ under RRS 10" as actionable items. The scorer resolves each one in
Sail Scoring — apply the code, adjust the finish, grant the redress (ties into the redress
methods under *Esoteric scoring engine requirements* below) — and the resolution is
submitted back to RRS.org so the jury's tool reflects that the scoring consequence has been
applied. That closes the loop the competitor-push opens: competitors flow out, decisions
flow back in, resolutions flow back out.

Open questions, mostly the same shape as the push side: there's no documented public RRS.org
API, so the read endpoints (what an inquiry/decision payload looks like) and the write-back
contract would both need to be agreed with them, not reverse-engineered. There's also a
workflow-ownership question — the jury owns the *decision*, the scorer owns its *scoring
consequence*, and the two tools would need a clear handshake about which side is
authoritative for "this has been actioned" so a decision isn't double-applied or silently
dropped. Pairs naturally with the changelog/snapshot-history work under *Scoring records and
audit trail* — a resolution sourced from an RRS.org decision is exactly the kind of change
that wants an attributed, linkable audit entry.

### Calculate age divisions from date of birth at import

Age divisions — Masters, Juniors, U21, and the like — genuinely affect scoring and
prize-giving, so a competitor's *age* is a legitimate scoring field (it already exists,
added for IODAI). Its **date of birth** is not: it is far more sensitive, and there is no
single "age" formula anyway — classes and events reckon it differently (age on the first
day of the event, age as of the preceding 1 January, whole crew under a limit vs. helm
only, and different bands per event: Optimists 8–15, ILCA 30 to 75+, ICRA under-25).

So Sail Scoring should never store DOB, but it could still *calculate from* one. The
"import competitors from CSV" dialog could accept a DOB column and, under a rule the
scorer selects for that event, compute each competitor's age at import time — keeping the
age and discarding the DOB. That gives events entering DOB (as an ILCA event might) their
age prizes without Sail Scoring becoming a store of dates of birth. Same "compute at
import, discard the sensitive input" shape as the email/phone relay in the RRS.org push
above; DOB, email, and phone are all event-management data with their own GDPR weight,
kept out of the scoring store by design.

Open question is mostly the rule catalogue: enumerate the age-reckoning conventions worth
supporting (and how the band definitions themselves are configured per event) versus
leaving age categorisation to be finished upstream, in the entry system, before the CSV
reaches Sail Scoring — which several scorers consider the safest place for it.

### Reconciling competitor identity with external member databases

The cross-series competitor-identity spine (#212) builds a *workspace-local* identity
table — competitor rows across series collapse onto a stable recurring competitor,
populated on demand and corrected by hand. The obvious next step is **automated
reconciliation against the organisation's real member database**: IODAI's members
system, a club's roster, a class association's register. Rather than the scorer
confirming matches manually, the workspace identity table would be matched — and kept
in sync — against the authoritative external source, so a sailor's identity, eligibility
(e.g. paid-up membership, nationality), and history are pulled rather than re-keyed.

This grows without bound: every club and class has its own member database, in its own
format, with its own access story (most are not public — IODAI's isn't). Building a
bespoke connector per organisation is not a product. Two things bound the risk. First,
the local identity spine (#212) is deliberately useful *without* any of this — external
reconciliation is an enhancement on top, not a prerequisite. Second, **Irish Sailing are
building a Member Management System** with essentially this remit (one authoritative
identity for every Irish sailor across clubs and classes); if it exposes an integration
surface, it could become the long-term *universal* reconciliation source for Irish
events, displacing the need for per-org connectors. We should avoid overlapping with
that endeavour — start with whatever bespoke arrangement IODAI needs, and treat a future
MMS integration as the general solution rather than reinventing it.

Touches personal data and eligibility, so the sub-processor / Privacy Policy implications
(legal pages live in the marketing-site repo) need checking before any real feed is wired
up.

### Configurable, re-syncable entry-list source

Clubs and class associations publish event entry lists as server-rendered HTML
tables — IODAI at `members.iodai.com/event/entered/{id}` (Name / Sail number /
Sail country, one table per fleet), HYC/MyClubAccount at
`myclubaccount.co.uk/{club}/ClubEvents/EntryList?EventId={guid}` (Pos / Sail /
Club / Helm / Crew). Scorers re-key these by hand, and the lists keep changing up
to race day, so a one-shot import isn't enough.

The proposal: attach an **entry-list source** to a series — a URL plus a saved
column mapping (and fleet handling) — and let the scorer hit **Re-sync** to
re-fetch and re-apply that mapping through the existing match-by-sail-number
upsert path (`components/competitor-import.tsx` + `lib/csv-import.ts`), new
entrants added and changed ones updated with no re-mapping. The mapping is
persisted by **header name** (not column index) so a re-fetch survives column
reordering. The server route mirrors the existing handicap-source fetchers
(`lib/api-handlers/{irc-rating,vprs-rating,irish-sailing}` behind
`/api/v1/handicap-sources/*`): fetch + parse the table to `string[][]`, hand it to
the mapping flow. Server-rendered HTML only — JS-rendered/SPA and login-gated
lists are out of scope, and only the fields the source exposes are recovered
(IODAI's public list carries no club/age/gender/subdivision).

Hard parts settled in the thread: **SSRF** guards on user-supplied URLs
(scheme/redirect/private-range, timeout, size cap); new `Series.entryListSources`
persistence (`lib/types.ts`, Drizzle migration, Zod, `lib/series-file.ts` version
bump, a `public-export.ts` include/exclude decision); a **re-sync deletion
policy** (dropped entrants reported, never auto-deleted — results may be
attached); and the privacy implication of server-side pulling personal data
(including minors) into our DB. Deferred further: a workspace-level member roster
and ongoing two-way members-DB integration. The recurring-competitor spine and
its reconciliation are explicitly *not* this issue's concern (that's #212 below).

*(Was GitHub issue #208)*

---

## Import / export

### Excel (.xlsx) import and export alongside CSV

Competitor import today is CSV; exports are JSON / HTML. HalSail does everything in Excel
(with a pre-2007 `.xls` toggle), and many scorers live in spreadsheets. Adding `.xlsx`
read/write alongside CSV would let scorers round-trip boats, races, and results without
CSV's footguns — notably **quoting/comma fragility** (a HalSail CSV boat import silently
dropped a boat whose entrant contained a comma; see the `hyc-archive` Puppeteer build).
Shape of the change: an xlsx reader/writer behind the existing import/export seams (a small
MIT/Apache-licensed dependency, per our licensing constraint); CSV stays as the
lowest-common-denominator format. A format-breadth feature, not new data.

---

## Finish entry UX

### Elapsed time recording in finish entry

MVP records finish time of day; elapsed time is back-calculated from the start. Some
finish boats use stopwatches and record elapsed times directly — supporting this natively
would save the scorer a step. Unclear how common this practice actually is in the field;
worth asking real recorders before building anything.

*(Was GitHub issue #21)*

### Per-race metadata — race officer, conditions, course

Capture the per-race context that has nowhere to live today: the race officer's name,
wind speed and direction, and a course note. HalSail records these at result entry.
Two of them are more than provenance — **wind speed and the course are required inputs
for ORC scoring** (performance-curve scoring selects a boat's rating from the wind
condition on the course sailed), so this is a prerequisite for the ORC advanced methods
below. The rest is audit and presentation value: who ran the race, what the conditions
were, surfaced on the race view and plausibly the published page. Shape of the change: a
small metadata bag on `Race` (RO, wind speed, wind direction, course/notes), entered in
the finish-sheet header / race settings, carried in the series file + JSON export.
Relates to the committee-boat-photo entry (same race-record enrichment) and to ORC Club / PCS.

### Printable starters checklist (spotter sheet)

A printed sheet the recording team takes on the committee boat — HYC calls it a
**starters checklist** — pre-filled with the expected entrants so a scribe can tick boats
off as they start and finish, record lap counts, and pencil in conditions. HalSail's
equivalent ("round" / "spotter" sheet) also leaves room for wind, the number of starters,
and the **time of the last finisher** (the protest-time-limit anchor — see the
last-finisher entry below). It's the paper counterpart to the mobile finish-recording app,
and the realistic fallback when there's no device on the water. Shape of the change: a
print/PDF rendering of a race's entry list with tick / lap / time columns and a conditions
header, generated per race (parameterised by fleet/start) — mostly a rendering-path
feature, tying into server-side PDF generation.

---

## Scoring records and audit trail

### Rendered (WYSIWYG) revision diff

Revision history itself is implemented (#166): per-session snapshots, a History tab,
restore, named checkpoints, and history embedded in the saved `.sailscoring` file. The
remaining horizon piece is a **rendered diff** between two revisions — a WYSIWYG
standings/results view that highlights what changed (added/removed/changed cells)
rather than the current "list the actions in this revision's window" drill-down. The
stored snapshots make it addable later: it needs a structural differ over
competitors/finishes plus a diff-aware results renderer.

### Changelog on published results pages

Each time a scorer publishes an update, the change should be recorded in a changelog
visible on the published results page — collapsed by default. Scorer is prompted (but
not forced) to add a short summary when publishing an update. Each entry records at
minimum: timestamp, scorer identity, and optional commentary.

Natural extension once revision history is in place: link changelog entries to the diff
between versions, and allow viewers to browse earlier result snapshots.

*(Was GitHub issue #8)*

### Scorer attribution in snapshot history

Every signed-in scorer has an email address (Better Auth); include it as attribution in
the snapshot history entries in the series file format.

*(Was GitHub issue #37)*

### Per-race lock granularity and unlock audit trail

Whole-series locking is done: archiving a series (#154) makes it read-only
(enforced server-side) and collapses it out of the active list; unarchiving or
copying to another workspace restores editing, and delete is gated behind
archive-first. What's still future layers on top of that model without changing
it: **per-race lock granularity** (freeze individual races while the rest of the
series stays editable), and an **unlock audit trail** that records who reopened a
locked series or race and when — which only becomes meaningful once revision
history (above) exists to record against.

### Attach committee-boat finish-sheet photos to a race

The authoritative record of what crossed the line is the handwritten finish sheet the
committee boat keeps — boats logged in crossing order, often with times, in pencil on a
clipboard. At HYC the committee boat photographs the sheet and emails it ashore, and the
photo is filed straight into a "paperwork" drive so there's a primary-source artifact to
audit a result against later: when a competitor queries a finish, the scorer goes back to
the original sheet, not to what was typed into the scoring tool. Today that audit trail
lives entirely outside Sail Scoring, in an ad-hoc shared drive disconnected from the
series the sheet belongs to.

Sail Scoring could hold the photo *with* the race it documents — attach one or more
images to a `Race`, stored in Vercel Blob, so the source sheet sits one click from the
finish list that was transcribed from it. The value is the link: an auditor (or the
scorer six months on) opens the race and sees both the entered finishes and the paper
they came from, rather than cross-referencing a filename in a separate drive.

Storage hygiene is part of the idea, not an afterthought. A finish sheet is
black-pencil-on-white-paper — it carries no useful colour and doesn't need photographic
fidelity. Converting on upload to **high-contrast greyscale** (or even bilevel/1-bit for
clean sheets) before storing drops the footprint by an order of magnitude versus a phone
camera's full-colour JPEG, while keeping the writing perfectly legible — the same logic a
document scanner applies to a page of text. Do the conversion server-side on ingest so the
stored artifact is the small one regardless of what the committee boat's phone produced.

How the committee boat gets the photo *into* Sail Scoring matters as much as where it
lands. The boat crew are wet, gloved, and on a heaving deck — they will not log into a web
app and navigate to a race. The natural capture-and-send gestures are the ones they
already use: snap the sheet, then share it to a single fixed destination. So the realistic
ingest channels are **a dedicated email address** the photo is forwarded to (an inbound
mail webhook parses the attachment and files it against the right race) or **a WhatsApp
message** to a number the club watches (via the WhatsApp Business / Cloud API, or in the
crude interim a human who relays it). Either way the hard part isn't receiving the image —
it's routing it to the correct race without the sender typing anything structured. Options:
a per-race or per-race-day magic address / alias the SI hands the committee boat
(`finish+<token>@…`), a subject-line or message-body convention (event + race number), or
an unrouted inbox the scorer triages and attaches by hand. Lean: start with the manual-triage
inbox (zero routing logic, immediately useful) and earn the addressing scheme only once the
volume justifies it.

The routing question has two halves — *which workspace* and *which series/race within it* —
and the clean answer to both is **the address is the capability**. Rather than trying to
recognise the sender (committee-boat phones are shared, mail gets forwarded, From: is
trivially spoofed — sender identity is a weak key), mint an opaque per-series token and
publish the address that carries it in the Sailing Instructions: `finish+<token>@in.sailscoring.ie`.
The token resolves to exactly one `(workspace, series)`, so whoever holds it can post finish
sheets to that series and nothing else — which is the right trust level for an inbound audit
artifact (low-stakes, and the SI already hands the token to precisely the people who should
have it). That collapses "which workspace / which series" into a single lookup and means the
committee boat types nothing. The residual question is *which race*: a race day usually spans
several races and fleets, so options are a finer-grained per-race-day or per-race token, a
race number parsed from the subject/message, or — simplest — file every inbound sheet against
the series' open race day as **unassigned** and let the scorer drop each photo onto the right
race during triage. The token needs a small lifecycle of its own: minted when a series is
created (or first published), shown in workspace/series settings for the SI author to copy,
and rotatable/revocable so a leaked or end-of-season address can be retired. WhatsApp doesn't
get per-series addresses cheaply (numbers cost money), so it routes differently: a per-workspace
number a club provisions, with series/race resolved from the message body or a short
back-and-forth ("which race?") — another reason email is the better first target and WhatsApp
the later, club-specific upgrade.

Because the channel is conversational, it can talk back. The same email/WhatsApp reply path
gives a natural way to **acknowledge receipt and flag a bad capture** without the committee
boat ever opening the app: a quick automated reply ("got it — sheet filed against Race 3")
closes the loop, and if the image fails a quality gate the reply asks for a re-shoot while
the boat is still on station and the sheet still in hand — far better than the scorer
discovering an unreadable photo hours later ashore. The cheap, high-value check is
resolution / blur (reject anything below a sensible pixel-density or sharpness threshold).
A genuine **legibility** check is more ambitious — OCR or a vision model deciding whether
the pencil is actually readable — and is firmly a later refinement, but worth noting because
the same model could eventually *transcribe* the sheet into a draft finish list, not just
judge it.

Shape of the change: an attachments relation on `Race` (Blob key, original filename,
uploaded-by, uploaded-at), an upload affordance in race settings / the finish sheet view,
a server-side image-normalisation step (greyscale + contrast, optional bilevel, sensible
max dimension), and a thumbnail/lightbox to view them. Open questions: whether attachments
belong in the `.sailscoring` export and JSON public-export (they're part of the
authoritative record — but embedding binaries bloats the file; a reference-with-rehydrate
scheme may be better); retention and who can delete an attachment once a result is
contested; whether the photo should ever surface on the published `/p/...` page (probably
not — it's an audit artifact for scorers, not competitor-facing); and whether to keep the
original alongside the compressed copy or treat the normalised image as the record of
truth (lean: normalised *is* the record — the whole point is to not hoard full-colour
originals).

### Race / results status (Provisional vs Final)

Results carry a lifecycle status, surfaced on the series and on published pages. HalSail
models this as a five-state machine — `NoResults` → `Provisional` →
`Validated` / `Cancelled` / `Abandoned` — which is probably more than Sail Scoring needs.
The distinction that genuinely matters to competitors and scorers is the standard
**Provisional vs Final**: provisional results are still open to correction; final results
are settled. A status field (per race, or per race day, or per series — granularity is an
open question) drives a clear badge on the standings and the published `/p/...` page, so a
competitor can tell at a glance whether a result can still move.

The hard part is making "Final" mean something specific rather than a button a scorer
clicks when they feel done. The anchor is **RRS 90.3**, which governs scoring; **90.3(e)**
in particular covers the time limits for requesting changes to a race score and when such
requests may be initiated. So "Final" should be defined against the actual mechanism by
which a score can still change:

- The protest / request-for-redress time limit has passed (RRS 62.2 / the SI's stated
  limit).
- There are no open scoring inquiries or protest-committee decisions pending.
- The results team is not aware of any other issue outstanding.

The subtlety is that the *time limit* itself is event-specific. The RRS are written with
World Sailing / Olympic / international-championship events in mind and include hurdles
that smaller events often ignore. Some classes close the window explicitly in the NoR — a
short period (sometimes an hour or so) after results are *published* — which matters most
where results decide selection to another event or advancement to the next round of a
match-racing ladder. Many events impose no NoR limit at all; there, late change requests
are handled by a protest committee whose decision simply arrives, and for a small fleet by
the next day no issue has arisen and the results are presumed final.

So a credible design can't just hard-code a global clock. It needs to express, per
series/event, *which* regime applies — a configured time limit (absolute, or relative to
publication time, per the NoR), or "no stated limit, finalised by scorer judgement once the
PC is silent." The status then becomes the visible output of that rule rather than a free
-floating flag, and the "Final" badge carries real meaning: it asserts a specific,
RRS-grounded condition has been met, not merely that someone pressed a button. Worth
designing the status field and its transitions so that meaning is enforced (or at least
prompted for) rather than assumed. Relates to per-race lock granularity above — finalising
and locking are adjacent but distinct (a result can be locked-for-editing without being
formally Final, and vice versa).

### Surface the last finisher's finish time for protest time limits

A close relative of the status work above: the **protest and request-for-redress time
limit is itself often defined relative to the last boat's finish**. Many SIs set it as a
fixed period after the last boat finishes (or after the race committee signals the end of
racing), so the protest committee — and any competitor deciding whether they still have
time to lodge — needs one specific number from the results: **the finish time of the last
finisher** in the relevant race. Today that number is buried in the finish sheet (and only
exists at all when finishes were timed); a PC member ends up scanning the timesheet for the
last row.

The note is just to surface it deliberately. The results already hold the finish times, so
the data is there when the race was timed — the work is presenting the last-finisher time
where the people computing the limit will look for it: on the race view for the scorer, and
plausibly on the published page. From there it's a short step to *deriving* the limit when
the SI's rule is configured (e.g. "90 minutes after the last finisher" → a concrete clock
time), which feeds directly into the "has the protest time limit passed?" condition that
gates a Final status above. Open questions mirror that entry: where the rule lives (NoR/SI
config per series), the untimed-finish case (no last-finisher *time* exists, so the limit
falls back to "after the RC signals end of racing" — which Sail Scoring doesn't capture
today), and whether the derived limit is competitor-facing or scorer-only.

---

## Publishing

### Scheduled publishing

Today publishing is a manual, per-fleet action: when results are ready, the scorer
opens each published target and hits publish. Logged-in scorers can already see the
unpublished state via **Preview**, so the gap isn't *visibility before release* — it's
the **release action itself** at event scale. An event is several series (one per fleet
in our model), and "go live now" means walking every one of them and republishing in
turn, ideally at the same moment.

Scheduled publishing lets the scorer set a release time up front — the series (or a
group of them) goes public automatically at that instant — instead of standing at a
keyboard hitting publish across fleets. The motivating cases are a prize-giving where
results must stay embargoed until the ceremony, and a provisional → final cadence where
the scorer wants every fleet to flip together rather than trickle out as each is
finished.

Shape of the change: a per-target (or per-event) scheduled-release timestamp, a
mechanism to fire the publish at that time (Vercel Cron over due series, since the app
already runs on Vercel), and UI to set/clear it. Open questions: the scope unit — does a
schedule attach to one series or to an event-level grouping of series that publish
together (relates to the event/day-level scope raised under Prize allocation, which we
don't model yet); what happens if the scorer edits results after scheduling but before
release (re-snapshot at fire time, or freeze what was current when scheduled?); timezone
handling for the release instant; and how a pending schedule is surfaced so it isn't
forgotten.

### Print-only QR code for a published page

A QR code linking to a series' published `/p/...` page, **scoped to physically printed
output only** — a results sheet pinned to the clubhouse noticeboard, a poster, an event
programme. The value is bridging paper to the live page from a printout where there's no
link to tap.

Deliberately *not* a share button or an on-screen QR: codes shared electronically (pasted
into a WhatsApp message, shown on a screen) are an anti-pattern — they force the recipient
to find a second device to scan something that should just be a URL. If you can send it
electronically, send the link. So this lives only in print/PDF rendering paths, never as
an on-page "share via QR" affordance.

Open questions: which printed artifacts get one (the results-sheet PDF export is the
obvious first); whether it carries the canonical short `/p/...` URL or a per-print
tracking variant (probably canonical — tracking reintroduces the abuse surface); and
sizing/quiet-zone so it scans reliably off paper.

### Server-side PDF generation at publish time

The first cut of PDF export (#207) is client-side: a print stylesheet on the rendered
results HTML plus a "Save as PDF" affordance, so the scorer (or a viewer on the public
`/p/...` page) drives the browser's print → Save as PDF. That covers "I want a PDF to
email or pin to a noticeboard" with no new infrastructure.

What it can't do is produce a deterministic, server-generated artifact that the publish
flow can attach or link directly. The follow-on is to render the existing
`renderSeriesHtml` output through headless Chromium (`puppeteer-core` +
`@sparticuz/chromium` — both Apache-2.0 / BSD, clear of the GPL constraint) inside a
Fluid function, store the resulting PDF as a blob next to the fleet HTML in the publish
path, and serve it at e.g. `/p/{ws}/{series}/{fleet}.pdf` with a download link on the
published page. Because it reuses the same renderer, there's no layout duplication — the
PDF matches the HTML exactly.

Costs that keep this deferred: a ~50 MB Chromium binary in the function bundle,
cold-start and timeout headroom, and a heavier publish path (every re-publish now also
renders a PDF). Revisit only if scorers ask for an attach-from-publish artifact rather
than a print-it-yourself one. The print/PDF rendering path here is also where the
print-only QR code above would live.

### Class-branded, embeddable public results index

Suggested by a class sailor as an adoption lever: a class association is far more likely
to send its members to Sail Scoring if the published results *feel like the class's own
page* and slot into the class website rather than reading as a generic third-party site.
Two related affordances:

- **Colour-match the public index to the class.** Let a workspace (or a class-scoped
  grouping of series) set a small, constrained palette — header/accent colours keyed to
  the class's brand — applied to the public results listing and the per-fleet `/p/...`
  pages. This is the same curated-token approach proposed under
  [Per-event branding](#per-event-branding) (colours, not arbitrary CSS, to keep the
  published HTML safe), just driven by the class identity rather than a single regatta.
  The logo library already supplies the marks; this adds the colour layer.
- **Embed/link the index from the class's own site.** A way for the class to surface its
  live Sail Scoring results inside its own web page — at minimum a clean canonical URL
  and link affordance, ideally an embeddable widget (an `<iframe>`-able results index, or
  a small script/oEmbed) that renders the current standings in-page. The published pages
  are static, so an embeddable read-only view is cheap; the work is a chrome-less render
  mode and the cross-origin/sizing story.

Open questions: the scope unit again (workspace vs. a real class/series grouping — a class
typically spans multiple series and seasons); how branding here relates to the
workspace-level and per-event branding layers (this is plausibly the *class* tier of the
same override stack); and whether embedding is a true widget or just a well-documented
link + canonical URL to start. The adoption argument is the point: the class's members
discover the tool through the class's own site, in the class's own colours.

### Splitting `Fleet` into a boat-group and a scoring view

Today `Fleet` conflates two things: a **group of boats** (the Puppeteer one-design class,
the "Cruisers" division) and a **scoring lens** (`scoringSystem` — one of
`scratch|irc|py|nhc|echo|vprs`). One fleet = one method. So a class scored two ways —
Puppeteer on scratch *and* on HPH, a common HYC layout — is modelled as **two fleets**
sharing the same competitors and finishes (a `scratch` fleet plus a `py` fleet carrying
each boat's HPH number). That works correctly today — `lib/competitor-ratings.ts` already
handles a competitor sitting in several fleets with different systems — and the
publishing-groups feature (compose several fleet-result sections onto one published page)
is enough to *present* those two fleets as a single "Puppeteer" page with full per-race
detail. Publishing groups are the near-term answer; this note is the deeper model that
publishing groups would otherwise paper over.

The cost of the two-fleets-per-class encoding is **authoring bloat, not incorrect
scoring**: every class × N methods multiplies the fleet list, the Standings tabs, the
publish dialog, and each competitor's `fleetIds`. For a panel scoring several classes each
on scratch + HPH, the fleet count balloons and the duplicate membership is tedious to keep
in sync. If that friction proves real, the principled fix is to split the concept:

- **Fleet** (rename candidate: *class* / *division*) becomes purely a group of boats —
  membership and identity, no `scoringSystem`.
- **ScoringView** = (fleet × method + params) — the unit that actually produces a standings
  table. One fleet yields several views (Puppeteer → scratch view + HPH view) without
  duplicating membership. A published page composes views, and the existing per-fleet page
  is just the single-view case.

This keeps the *scoring engine* unchanged in spirit — a view scores exactly as a
single-method fleet does now — while removing the membership duplication. The blast radius
is the reason it's deferred: `scoringSystem` currently lives on `Fleet` and is read across
scoring assembly (`lib/results-export.ts`), competitor ratings, race-fleet exclusions,
per-fleet points, the `.sailscoring` file format, public JSON export, and publish
sub-paths. All of those assume one system per fleet and would need to move to the view.
The migration is mechanical but wide, and it's only worth it once publishing groups have
shown that scorers genuinely want the multi-method layout at enough scale to make the
duplicate-fleet authoring painful.

The line to hold either way: a fleet/view composes **existing scored units**, never an
arbitrary competitor *filter* ("just Club X across all fleets", "top 10 overall"). That
selector model is Sailwave's, and it's the infinite-configurability trap this split is
specifically *not* trying to open — see
[Arbitrary competitor selectors](#arbitrary-competitor-selectors-flags--tags).

---

## Workspaces and sharing

### Per-series scorer scope

Workspace roles shipped (#202): `member` is the read-only tier, `scorer` is
race-day operations only (races, starts, finishes, publishing), and
`owner`/`admin` have full access, enforced per-request at the `workspaceRoute`
seam from the shared permission table in `lib/auth/permissions.ts`.

The deferred residue is scope: roles are workspace-wide, but a rostered duty
scorer arguably only needs the series they're running that evening. Per-series
scope would add a series dimension to the same permission check — a
series-access table consulted when the role alone doesn't grant `score` — plus
UI to assign a scorer to specific series. Not worth the machinery until a real
panel asks for it; the activity log already records what was done, so the
workspace-wide scorer role bounds the blast radius well enough for now.

### Cross-workspace series for guest-scored events

A common pattern: the host club scores an event for a visiting class — say HYC's
scorers run an ILCA regional on HYC's workspace. It works, but it puts the series
in the wrong place. The class owns the competitor identities that span its events
(see *Cross-series identity and ranking*), so an ILCA regional scored inside a
club workspace is cut off from the class's own competitor history and published
under the club's namespace rather than the class's. The instinct is right that
the series belongs in the *class's* workspace and is published there — but the
people doing the scoring belong to the *club*.

Today a workspace is a closed unit: membership, roles, series, and the published
`/p/{workspace}/...` namespace all live together, and a scorer in one workspace
has no standing in another. Supporting this cleanly is two hard problems at once:

- **Cross-workspace roles.** A club scorer needs `score` permission on one series
  in a workspace they aren't a member of, without becoming a member of (and
  seeing the rest of) that workspace. This is the *per-series scope* idea above
  turned inside out — the grant has to cross the workspace boundary, so the
  series-access table would key on (foreign user → this series) and the
  `workspaceRoute` seam, which today resolves a single membership row, would have
  to consult a second, cross-workspace grant table. The activity log already
  stamps who did what, so attribution survives; the hard part is bounding what an
  invited foreign scorer can see and do to *just* the loaned series.
- **Cross-workspace series linkage / ownership.** Which workspace "owns" the
  series for billing, publishing namespace, deletion, and competitor-identity
  resolution? The clean model is single ownership (the class workspace owns it)
  with a scoped guest grant to the club's scorers — rather than a series that
  genuinely lives in two workspaces, which multiplies every "whose is it"
  question. A lighter alternative that sidesteps roles entirely: score in the
  club workspace as today, then *transfer* the finished series to the class
  workspace (a one-shot ownership move that re-homes its published namespace and
  re-resolves competitor identities). Transfer is far simpler and may cover most
  of the real need; full live cross-workspace scoring is only worth it if classes
  and clubs genuinely need to collaborate on the same series *during* an event.

Open questions: whether the first useful version is a guest-scorer grant or a
post-hoc series transfer; how publishing namespace and "Open in Sail Scoring"
links behave when a series changes hands; and how competitor-identity resolution
(class roster vs. club roster) is chosen for a guest-scored series. Not worth
building until a class and a club actually ask to run an event this way — but
worth recording, because the "score it on the host's workspace" workaround
quietly accretes class series in the wrong home.

### Light/dark colourway logo variants

The canonical-logos manifest schema carries `variants` + `background`, but every
entry ships only `primary`. Several marks are dark wordmarks that wash out on a
navy header. Where an owner publishes a white-on-dark variant, source and record
it, and have the renderer pick by header background. Don't manufacture variants.

### Fleet-level logo overrides

The venue/event burgees are set per *series*; a multi-fleet series shows the
same two logos on every fleet's page. Some events want a fleet to carry its own
mark — a class association's logo on that class's fleet page, say — overriding
the series venue or event slot. Shape of the change: optional per-fleet
`venueLogoOverride` / `eventLogoOverride` plus a per-fleet toggle for *which*
slot the override replaces, falling back to the series slot when unset. This is
the one piece of the logo library that adds persistent fields to `Fleet` in
`lib/types.ts`, so it pulls in `series-file.ts`, the public JSON export, and a
file-format version bump — which is why it's separated out rather than shipped
with the per-series picker. Open question: whether a fleet override should be
pickable from the same library/canonical sources (almost certainly yes, reusing
the existing `LogoField` picker).

### Per-event branding

Published results today carry a single, workspace-level look. Real events often want
their *own* identity that overrides the club's: an event banner with the regatta's
sponsors and organising-authority logos, and sometimes a distinct visual style, applied
to every fleet's published page for that event without disturbing the club's default
branding or other concurrent series. HalSail does exactly this — an event banner that
overrides the club banner, plus a bespoke per-event stylesheet.

This is the consumption side of the shared logo library above: the library is where
branding *assets* live; per-event branding is how a chosen set of them (plus layout and
style) gets bound to an event and rendered onto its published pages. It also relates to
the event/day-level scope raised under Prize allocation and Scheduled publishing — an
"event" that groups several fleet-series and carries shared branding is the same missing
abstraction in each case.

Shape of the change: an event-level (or series-level) branding override — banner
logos, title, and optionally a constrained set of style tokens (colours, not arbitrary
CSS, to keep the published HTML safe and consistent) — falling back to workspace
branding when unset. Open questions: the scope unit again (per-series vs. a real event
grouping); how much styling to expose (a curated theme vs. HalSail's full custom
stylesheet — arbitrary CSS injected into a public page is a footgun); and how this lands
in the published HTML, which today embeds the full series rather than linking to shared
assets.

---

## Country-scoped instances

### Standing up Sail Scoring instances beyond sailscoring.ie

`sailscoring.ie` is scoped to Irish clubs and classes deliberately — a narrow,
legible userbase is far easier for a central organisation to fund or operate
than the open-ended cost of running the service for the entire world (see
[sustainability.md](https://github.com/sailscoring/governance/blob/main/sustainability.md),
"A central organisation funds or operates the service"). The natural consequence is that other governing bodies
or large clubs may want their own country-scoped instance —
`sailscoring.co.uk` run by/for the RYA, `sailscoring.fr` for the FFVoile, and
so on — each funded and operated by an entity with an interest in its own
sailing community.

The mechanics already exist as a runbook, not a feature: the backup runbook
documents bootstrapping a separate instance under its own Neon project and AWS
account, "preferred if the new instance is run by a different operator or legal
entity" ([database-backup.md](../database-backup.md#bootstrapping-a-new-instance)).
What's deferred is everything around making that repeatable and supported:

- **Onboarding playbook for a new operator.** Turn the runbook into a path a
  governing body's IT staff can follow — domain, Vercel project, Neon, Blob,
  Resend, the env wiring — without hand-holding from the original maintainer.
  This is the same independence the sustainability note wants between code
  governance and service governance.
- **Per-instance branding and locale.** Domain, contact email, governing-body
  name in copy, and likely language. Touches the marketing site, the app shell,
  and any hard-coded `sailscoring.ie` / `mark@hyc.ie` references.
- **Per-instance handicap systems.** A UK instance leads with RYA NHC 2015 and
  PY; an Irish one with ECHO and IRC; a French one with its own systems. Which
  handicap engines and defaults a given instance exposes becomes a
  per-deployment concern — relates to the deferred RYA NHC 2015 work below.
- **Cross-instance identity and discovery.** Open questions, not commitments:
  does a scorer with accounts on two instances have any shared identity; is
  there a federated directory of "where is club X scored"; how do published
  `/p/...` URLs read across instances. Likely unnecessary for a long time —
  each instance can be fully independent — but worth flagging that the
  workspace-namespaced URL scheme assumes a single host today.

Strongly tied to the open-source-vs-commercial decision: an open project that
an adopter "who doesn't fit the funded audience can always host their own
instance" of is exactly the federation story above
([sustainability.md](https://github.com/sailscoring/governance/blob/main/sustainability.md),
"The bus factor").

### Localization (i18n)

A French instance can't ship an English UI — `sailscoring.fr` would need to be
*in French*. The app is currently English-only with strings inline in JSX, so
localization is a prerequisite for any non-English-speaking instance, not a
polish item. It's a sizeable cross-cutting change, captured here so the scope
is visible before a target instance forces it:

- **String extraction and a message catalogue.** Every user-facing string
  pulled out of components into a translatable catalogue (e.g. an `next-intl` /
  ICU-message setup), with a French translation as the first non-English locale.
  This is the bulk of the work and touches almost every component.
- **Scoring/RRS terminology is the hard part.** Result codes (DNF, OCS, DSQ…),
  RRS Appendix A vocabulary, and handicap-system names are terms of art. Some
  are internationally fixed (the RRS abbreviations are defined by World Sailing
  and may stay English even in a French UI); others have established French
  equivalents. Getting this right needs a French-speaking scorer, the same way
  the scoring fixtures need a human scorer to vet them — a wrong translation of
  a result code is worse than no translation.
- **Formats, not just words.** Dates, times, and number formatting follow the
  locale; finish-time entry and the published results pages both surface these.
- **Published-page locale.** A published `/p/...` page renders in the locale of
  the instance (or the series), since the audience is the local sailing
  community — independent of whatever locale the scorer's browser prefers.
- **Per-instance default vs. per-user choice.** Likely each instance has a
  default locale (French on `.fr`) with a per-user override; open question
  whether a single instance ever needs to serve multiple locales, or whether
  one-locale-per-instance is enough for a long time.

Pairs with the per-instance branding/locale bullet in the instances entry
above: branding and language are the two things that make an instance feel like
it belongs to its own community rather than a re-skinned `sailscoring.ie`.

---

## Race formats

### Pursuit races

A pursuit race inverts the usual format: instead of a common start and corrected finish
times, each boat is given an individual **start time** derived from its handicap — the
slowest boats start first, the fastest last — so that, if every boat sails exactly to
its handicap, they all converge on the finish together and the race is won by the first
boat across the line on the water. No corrected-time scoring at the finish; the handicap
is spent entirely on the staggered start. It's a genuinely fun, spectator-friendly
format (first-to-finish wins, no waiting for results) and a real one — HalSail computes
and publishes pursuit start times.

The non-trivial part is everything *before* the gun, not the scoring after it. The
engine has to turn each boat's handicap into a start offset against a chosen scratch
boat and race length, producing a **start-order schedule** (boat → start time) that then
has to be **published to competitors in advance** — sailors need to know their own start
time before they leave the dock, and the race officer needs the ordered list on the
water. So this is as much a publishing/output feature as a scoring one: a per-boat start
schedule is a new kind of artifact alongside results.

Shape of the change: a pursuit race *type* on `Race`; a start-time computation from
handicap + scratch boat + nominal race duration (the formula differs by handicap system,
since the offset is a function of the same TCF/yardstick maths we already model);
finish entry that records on-the-water finish order (or time) with no time correction
applied; and a published start-schedule output (and likely a clubhouse/big-screen
countdown, tying into the live-display horizon entry). Open questions: how race length is
chosen and whether it's capped (pursuit races usually run to a time limit, not a fixed
course); how mixed-handicap-system fleets are handled in one pursuit start sequence; and
whether start times round to sensible whole seconds/minutes for a startable sequence.

---

## Esoteric scoring engine requirements

Scoring variations that go beyond standard RRS Appendix A — supported by
Sailwave and occasionally specified in Notices of Race, but not common enough
to prioritise. Captured here so that when a real-world series needs one, we
have a starting point rather than a blank page.

### Windsurfing (Appendix B) and kiteboarding (Appendix F) scoring

The engine implements the standard RRS Appendix A series tie-break (A8.1 then
A8.2). RRS Appendix B (windsurfing) and Appendix F (kiteboarding) change parts
of Appendix A — including the series-score sums and the A8 tie-break — so we
can't currently score those disciplines faithfully. Not a priority until a
real board-racing series turns up.

Shape of the change: a per-fleet discipline flag selecting the Appendix A / B /
F variant, with the affected steps (series scoring, tie-break) branching on it.

### Non-discardable races

A series NoR can designate certain races as non-discardable — they must count
toward the final total even when the series allows discards. Example: the
Lambay Race is the centrepiece of the HYC Wave Regatta and its NoR marks it
as non-discardable, so a competitor's worst result cannot be the Lambay Race.

Shape of the change: a per-race flag on `Race`, surfaced in race settings, and
a tweak to the discard selection logic in `lib/scoring.ts` to exclude flagged
races from the discardable set.

### Race weightings

A series NoR can weight individual races differently — e.g. the Lambay Race
counts for 1.5× points. The weighting multiplies each competitor's score for
that race before series totals are computed.

Shape of the change: a per-race multiplier on `Race` (default 1.0), applied in
the series totalling step. Interaction with discards needs thought: is the
weighted or unweighted score used when selecting which race to discard?
Sailwave's behaviour here is worth checking before designing.

### Remaining RDG (redress) method — points for a place

The engine supports redress as an average (RRS A9(a) `all_races`, the
DNC-excluding `all_races_excl_dnc`, and `races_before`) plus a single `stated`
points value. One HalSail method remains unreproduced (see
`../dbsc-archive/docs/notes/halsail/querying-public-results.md`):

- **RDG type 4 — points for a given place.** The boat is scored as if it
  finished in a stated place (and ties with any boat actually in that place).
  No engine equivalent: we'd need a "points for place N" redress that resolves
  against the race's actual scores. Shape: a `redressPlace` field + resolver
  that reads the Nth place's points. Resolution sits inside the existing
  per-fleet pass, so the place's points already differ correctly per fleet — no
  shared-value problem. For a per-fleet *stated* place value, this would reuse
  the per-fleet-points map and widget added for RDG/DPI stated points (#224).
  The HalSail converter maps types 1/2/3 (the averages, which the engine
  recomputes per fleet) and warns on type 4.

### TLE (Time Limit Expired) — points relative to the last finisher

A result code for boats that don't finish within a stated **Finishing Window**
(the time allowed after the first boat sails the course and finishes). Unlike a
plain time limit, TLE keeps the boat in the results rather than scoring it DNF:
a boat scored TLE gets points for the finishing place a fixed number — `[one]`
or `[two]`, chosen by the NoR/SI — *more* than the last boat that finished
within the window. The World Sailing SI template wording (clause 16.3):

> The Finishing Window is the time for boats to finish after the first boat
> sails the course and finishes. Boats failing to finish within the Finishing
> Window, and not subsequently retiring, penalized or given redress, will be
> scored Time Limit Expired (TLE) without a hearing. A boat scored TLE shall be
> scored points for the finishing place [one][two] more than the points scored
> by the last boat that finished within the Finishing Window. This changes RRS
> 35, A5.1, A5.2 and A10.

Source: <https://www.racingrulesofsailing.org/posts/896-time-limit-expired-tle>.

Sail Scoring has no TLE code today. **DBSC use it, and the HalSail converter
currently maps it to DNF** — which over-penalises: a TLE boat should sit just
behind the last finisher, not be lumped with the whole non-finishing field at
`finishers + 1`.

Shape of the change: a `TLE` entry in `lib/scoring-codes.ts` whose points aren't
a fixed `finishers + 1` but are computed *relative to the last in-window
finisher* — `(points of last finisher) + offset`, with `offset` ∈ {1, 2} a
series-level setting (the `[one][two]` choice). All TLE boats in a race share
that same points value and tie with each other. Note the cross-references it
changes: A5.1/A5.2 (so a redress or scoring-penalty boat is excluded from the
TLE set, per the SI proviso) and A10 (tie resolution). Worth scoring a fixture
against a real DBSC race once the code lands.

### High-point and bonus-point scoring systems

The engine scores low-point (RRS Appendix A). Other published systems — **high-point**
(score a percentage of the fleet; common in US college/team racing) and **bonus-point**
(descending awards, e.g. 0 / 3 / 5.7 / 8 …) — are offered by Sailwave and HalSail. We
don't have them and won't build them speculatively. **Demand-driven: wait to hear from a
user running a real series on one before designing.** Shape, when it comes: a per-series
scoring-method selector that branches the points assignment and the A8 tie-break, with a
fixture per method.

### Configurable minimum-competitors-per-race rule

A NoR sometimes voids a race for a fleet that didn't muster a minimum turnout — e.g. "a
heat with fewer than 3 competitors does not count." DBSC do exactly this by hand (striking
single-competitor heats), and we deliberately did **not** auto-encode their specific
behaviour (#232, closed not-planned — it was manual SI enforcement, with misses, not a
rule). The horizon version is the *configurable, opt-in* form: a per-series threshold
("at least N competitors in a race, per fleet, or the race is excluded for that fleet")
that a scorer turns on knowingly, producing an explicit, auditable exclusion rather than
an inferred one. Shape of the change: a per-series minimum-starters setting, evaluated per
(race × fleet), feeding the same exclusion path as the per-fleet race exclusion in #203;
the excluded race carries a visible reason. Keep it strictly opt-in — most series don't
want it, and it must never silently reshape results.

---

## Deferred handicap-system work

Variants and refinements of the existing handicap engine, designed against
the relevant specifications but not implemented. Held back pending real
demand from a target series. Detail in `docs/design/handicap-scoring.md`.

### RYA NHC 2015

The published RYA NHC algorithm — symmetric `α = 0.3`, T_C-based extreme
clamping (`cap-input` outlier strategy), base-number realignment anchored
to `H0`. Distinct from the implemented NHC1 (SWNHC2015) which uses
asymmetric blend rates, classifies on `S = Q/L`, and realigns to the
fleet's prior sum.

### Named NHC profiles (per-series registry and per-workspace library)

Per-fleet `Fleet.nhcProfile` override of the seven SWNHC2015 parameters
landed for #143 — every NHC fleet can already carry custom blend rates,
σ thresholds, and `MinFin` inline. The deferred work is sharing those
profiles by name across fleets, series, and workspaces:

- **Per-series profile registry.** `Series.nhcProfiles: NhcProfile[]`
  with a fleet-side `Fleet.nhcProfileId` pointer, replacing the inline
  `Fleet.nhcProfile`. Auto-created `"NHC1 (Sailwave)"` default profile so
  existing series keep stock parameters; scorers can add a `"HPH
  (aggressive)"` variant in the same series for an A/B run across two
  NHC fleets. Lock parameters on a shared profile after the first race
  scores to prevent retroactive rescoring across fleets; offer
  "duplicate profile" to fork an experiment.
- **Per-workspace profile library.** Workspace owners maintain a list
  of named profiles that get copied into new series at creation time.
  HYC could define the "HPH" profile once, every new HYC series picks it
  up automatically. Open questions: how does a personal-workspace scorer
  pick up a club's profile set (export/import JSON? join-org copy?);
  when the workspace edits a profile, do existing series get the
  update or stay frozen (lean: frozen — series are historical records).
- **Profile attribution in published HTML.** The per-race fleet header
  carries the profile name (`Rating system: NHC1 (HPH-aggressive)`),
  and — once workspace-sharing lands — the source workspace too,
  surfacing "this series used a custom profile" without exposing the raw
  parameters inline.

See the scoping discussion in #135 for the original options analysis;
the inline per-fleet step landed under #143 as the bridge.

### Scoring-inquiry rating adjustments

NHC and ECHO can be configured to exclude specific results (e.g. RDG, BFD,
DSQ) from the rating calculation while still counting them for series
points. Currently every participating boat is adjusted on every race.

### Series-level rating-history page

A view across the whole series showing each boat's rating evolution race
by race, with the existing per-race explainability columns rolled up.
Per-race explainability is implemented; the series-level rollup is not.

### ECHO certificate-layer features

The first ECHO pass implements the per-race performance-index blend only.
The formal Irish Sailing *ECHO Rules* document defines a certificate-
administration layer that production ECHO clubs run on top of that
algorithm — out of scope for the first pass, captured so it isn't lost:

- **Standard TCF per boat** (Rule 6) — the IS-issued certificate rating;
  a per-competitor field alongside the progressive handicap.
- **Hard limits on Current TCF** (Rules 6.6, 8.3) — Current TCF clamped
  to Standard TCF × [0.925, 1.12]; a post-blend clamp on the new handicap.
- **Block Adjustment** (Appendix E) — a scorer-triggered season-start
  action scaling every Current TCF by ΣStandard / ΣCurrent.
- **Provisional TCF status** (Rules 7.2, 8.1) — newly-rated boats whose
  results don't drive other boats' updates while their own TCF settles;
  affects whether a boat contributes to ΣH_S and Σ(1/T_E).

Detail in `docs/design/handicap-scoring.md` (ECHO → "Out of scope (first
ECHO pass): certificate-layer features").

### VPRS and YTC (DBSC 2026)

The **DBSC 2026 Summer Series** NoR
(`reference-docs:events/dbsc-2026/NoR-Keelboats-Wag-Summer-amended1.pdf`) adds
two rating systems Sail Scoring doesn't yet model, both driven by this one
real-world series. DBSC's general SI
(`reference-docs:events/dbsc-2026/SI-A-General-v2.pdf`, A15.1) lists the
full 2026 handicap set — ECHO (Progressive), IRC, VPRS, ORC Club, YTC and PY —
so with IRC, ECHO and PY in production and ORC Club captured as Phase 3 below,
VPRS and YTC are the two missing pieces for full DBSC coverage.

- **VPRS** (Velocity Prediction Rating System) — a UK measurement handicap
  that, like IRC, issues each boat a single time-correction coefficient applied
  time-on-time (`CT = ET × TCC`). Mechanically it is a **static-TCF** system,
  identical to the IRC path already in production; the engine needs no new
  scoring maths. What it needs is a distinct `scoringSystem` value (so results
  label it correctly, and a boat can be scored under VPRS *and* ECHO in
  parallel, as DBSC requires), a per-boat `vprsTcc` rating field alongside
  `ircTcc`, and a rating source (below). DBSC scores its (Mixed) Sportsboats and
  Cruisers 4A/4B/5A/5B classes under VPRS by default (NoR 2.3, 2.7), and allows
  it to substitute for IRC in Cruisers 0–3 on class request (NoR 2.6).

- **YTC** (RYA Yacht Time Correction) — the RYA's national keelboat
  yardstick scheme. Like PY it is a published yardstick number turned into a
  TCF, so it reuses the existing PY mechanics — but unlike PY it is a
  **per-boat** rating carried on a certificate (NoR 3.5), not a per-boat-*type*
  class number. That distinction drives the data model: PY today is a boat-type
  lookup, whereas YTC is a certificate field on the individual competitor. DBSC
  allows YTC to substitute for IRC in Cruisers 0–3 and for VPRS in Cruisers 4/5
  on class request (NoR 2.6, 2.7).

Both are gated the same way the existing systems are: a boat may only be scored
under a system for which it holds a current certificate (NoR 3.5), and a class
winning under IRC/VPRS forfeits the parallel ECHO prize (NoR 9.2) — the
parallel-scoring and prize-eligibility shape is the same as the ECHO/one-design
pairing already supported.

**Rating sources.** The IRC, ECHO and VPRS fetch paths are implemented
(`lib/irc-rating.ts`, `lib/irish-sailing-ratings.ts`, `lib/vprs-rating.ts`);
VPRS reads its ratings from `vprs.org/ratings.html`. YTC is the remaining
source: RYA YTC certificates are listed by the RORC Rating Office at
`rorcrating.com/ryaytc/ryaytclistings`, and its fetch path lands with YTC
scoring. All these sources share the same posture the implemented ones already
follow — per-event and verification-only: fetch the boats in an event being
scored, never mirror the whole database, and never let a rating fetched for one
system feed another's computation (e.g. IRC TCCs must not feed ECHO).

### PHRF (time-on-distance)

PHRF (Performance Handicap Racing Fleet) is the dominant North American keelboat
handicap. It matters here because, unlike every system we model today, it is classically
scored **time-on-distance**: a boat's allowance is its rating (seconds per nautical mile)
multiplied by the *course distance*, so the corrected time is `ET − (rating × distance)`
rather than a time-on-time `ET × TCF`. That distinction drives a data-model change we
don't have anywhere else — the **course length** becomes a required scoring input on each
race, not just descriptive metadata. (PHRF also has a time-on-time variant; the
time-on-distance form is the one that's genuinely new to the engine.)

Far from our current target events, captured because it's the obvious system to reach for
if Sail Scoring ever extends to North American clubs — and because the time-on-distance
mechanic is a clean, self-contained addition worth having designed before it's needed.
HalSail added PHRF in February 2025, so it's live demand in comparable tools.

Shape of the change: a `scoringSystem` value for PHRF; a per-boat `phrfRating`
(seconds/mile) field; a per-race course-distance input; and a time-on-distance correction
path in `lib/scoring.ts` alongside the existing time-on-time one. Open questions: whether
to support both PHRF variants (ToD and ToT) and how a fleet picks; how course distance is
captured for series where it varies race to race; and the rating source (PHRF ratings are
issued by many regional fleets, not one central authority — no single fetch endpoint like
IRC's).

### Phase 3: ORC Club

A more elaborate handicap system used internationally for offshore
racing, distinct from IRC. Out of scope for HYC and IODAI but the
obvious next system after IRC, NHC, and ECHO.

### ORC advanced methods (PCS, Custom Courses)

Beyond ORC Club itself, ORC defines Performance Curve Scoring (PCS) and
Custom Courses — scoring that models a boat's speed against the actual
wind conditions and course geometry of each race rather than a single
time allowance. Far horizon; only relevant if a target series runs full
ORC International scoring.

---

## Series lineage and seasons

### Automatic handicap refresh along the series-lineage chain

The "Create follow-on series" rollover (#201) copies a series's structure
(settings, fleets, competitors — no races or finishes), seeds each boat's
progressive starting handicap from the predecessor's end-of-series TCF, and
records the lineage (`previousSeriesId` + the race the seed was taken as-of).
The deferred work is making that seed *stay* current: when the predecessor
gains or changes scored races, refresh the follow-on series's starting TCFs
automatically instead of asking the scorer to re-run Update Handicaps.

One design constraint is already settled. This must be **automatic refresh of
a snapshot, not live read-through resolution**: the `.sailscoring` file
format, the public JSON export, the published `/p/...` pages, and the scoring
engine all require a series to be self-contained, so the follow-on series
always carries concrete `nhcStartingTcf` / `echoStartingTcf` values. The
lineage chain only governs when those values get rewritten. The write path is
the same one the rollover and the Update Handicaps dialog already share
(`endOfSeriesTcfs()` over the predecessor's `TcfRecord` history), so the
delta is purely *when it fires* and *what policy governs it*.

The motivating workflow is season-upfront setup (DBSC): create every series
and its races at the start of the season, chained via rollover, and let
results flow — each series boundary resolving itself as the predecessor
completes, with no per-boundary manual step.

Open questions, deliberately left to be answered by a season of rollover
usage at Howth/DBSC before building this:

- **Refresh vs freeze.** Starting TCFs feed race 1 and progressive ratings
  chain forward, so a refresh re-flows the *entire* follow-on series. If a
  predecessor protest is decided after the follow-on has sailed and published
  races, does the refresh silently change published results? Scorers may
  want "frozen once the follow-on has a scored race" — a product decision
  with RRS-adjacent weight.
- **Overlapping series.** Series can overlap in time; "predecessor finished"
  is not always a clean moment to hang the refresh on.
- **Late entrants.** The rollover copies competitor rows 1:1, so identity is
  exact at creation. Boats added to the follow-on later need sail-number
  matching against the predecessor (the machinery exists in
  `lib/source-handicaps.ts`, but the dialog resolves ambiguity by *asking*;
  auto mode needs defaults).
- **Predecessor lifecycle.** What a dangling `previousSeriesId` means when
  the predecessor is trashed, deleted, or moved.

The rollover's "Handicaps seeded from {series} as of Race {n}" provenance
note is the UI hook this work hangs on — staleness detection ("seed is out
of date — refresh?") is the natural intermediate step before fully automatic
refresh. Season-spanning *views* (a season grouping above the series, results
across a season) are a separate idea that the lineage chain enables; they
connect to the perpetual-trophies question under Prize allocation.

Sub-series within a single series (#203) reduces the pressure on this work:
back-to-back blocks sharing one entry list become one series, so the
highest-value boundary (e.g. a Frostbite Winter→Spring) stops being a series
boundary at all. Rollover remains for entry-list turnover, fleet
restructuring, and series that overlap in time.

---

## Cross-series identity and ranking

The cross-series competitor-identity **spine is implemented** (#212, closed): a
workspace-scoped `CompetitorIdentity` with a `Competitor.identityId` link collapses
a sailor's per-series rows into one recurring competitor. The shipped cut — **name**
is the cross-season spine (not sail number), implied birth year is a *transient*
reconciliation input (never schema, never public), identity is workspace-local
(excluded from the `.sailscoring` file and public JSON export, re-derived on
import), and a batch reconcile pass (`scripts/reconcile-identities.ts`) populates
it. The principle held — a matcher only *suggests*, a human confirms; identity is
persisted, never re-inferred at compute time — and matching **prefers false-splits
over false-merges** (a wrong split is one click to fix; a wrong merge silently
corrupts a ranking). What recurs isn't always a person (a keelboat campaign is a
boat + crew), so the record mirrors the polymorphism the `Competitor` row carries.

Built on the spine, the **public product is also implemented** (#217): the
competitor index, name/sail search and year filter, and the per-competitor
**timeline** — every series a sailor entered with their results and ranking, the
whole Optimist junior arc from coached eight-year-old to ageing out. Public but
`noindex`. The full spine design (data model, lifecycle, matching tiers, backfill,
privacy) is preserved on #212.

### Open work in this area

The ranking, lazy population, and reconcile UI shipped together (July 2026):

- **Workspace cross-series ranking** — **#209, implemented**. Bucketed best-N
  ladders (`rankings` feature, the Rankings workspace tab, live public page at
  `/p/{ws}/ranking/{slug}` over published series only). Deliberately *not*
  built: per-category (Senior/Junior) ladders, tie-breaks beyond shared ranks,
  cross-series discards beyond best-N — add when IODAI asks. Still overlaps
  season-spanning *views* (*Series lineage and seasons*) and perpetual trophies
  (*Prize allocation*).
- **On-demand identity population** — **#222, implemented**. The reconcile pass
  runs automatically after competitor writes (one matching model — the batch
  CLI and the hook share `lib/competitor-identity-reconcile.ts`). Future
  optimisation if it ever shows in traces: surname-narrowed corpus loading.
- **In-app reconcile UI** — **#221, implemented**. Review queue (merge
  suggestions + long arcs, persisted dismissals), combine-with-undo, cluster
  split. Splits land on fresh confirmed identities so the auto-pass never
  re-fuses them. A merged-away identity's public slug stops resolving — slug
  aliases/redirects are deferred until someone actually misses them.
- **IODAI competitor-history cleanup** — **#218**. Methodical, repeatable
  corrections keyed on vanity slugs (the iodai-archive manifest); fixes
  blank / mojibake / malformed names at source and re-imports. The manifest
  remains authoritative over rows it covers when re-applied — fold in-app
  corrections into it before any archive rebuild.

External reconciliation against real member databases stays the separate horizon
entry above (*Reconciling competitor identity with external member databases*).

### Career arc as a scope boundary

The timeline is also a clean **scope test for the project**. Entries, results, and
rankings over time are scoring data Sail Scoring owns — squarely in scope. The
tempting next step is a *photo* retrospective: tag regatta photos with a competitor
ID so the page shows the sailor as well as their results. That steps outside scoring
data, and belongs **outside** the app — a third-party integration built on the Sail
Scoring API (the same "thin client over the API" framing as the mobile
finish-recorder and clubhouse big-screen display under *Third-party integrations*),
with the competitor identity as the join key, rather than photos becoming
something Sail Scoring stores and manages itself. The exciting feature and its
correct home are different things: the app exposes the identity and the record;
someone else builds the photo wall on top.

A concrete sighting of exactly this: ITCA (Topper) publishes a per-sailor **"2026
season stats"** card — name, photo, club, age, sail number, honours, national and
regional titles, full results, where they've represented Ireland, even the school
they attend — and it's beautifully presented. It's worth studying because it draws
the scope line for us precisely. The spine *is* the half a class can't easily
assemble itself: the identity join key, the per-series results and rankings, and
the titles and representative honours that fall out of cross-series ranking
(*Workspace cross-series ranking*, #209). The rest — photo, age, school, the
layout and art direction — is enrichment a class layers on with data it already
holds. That split is the argument for the public API: we shouldn't *build* the
Topper card, we should make it so a class can. The aspiration isn't a feature on
our roadmap; it's **inspiring people to build cards like this for their own
classes** on top of our record, and shaping the read API (M6/M8 above) so the join
key and the rankings are the easy part.

---

## Prize allocation

> **First stab in flight:** the deterministic core (predicate + recipient count,
> ranked by series standing) is scoped in #240, with the 2026 ILCA Leinsters
> Sailwave prize config as the baseline target. The ambitious parts below
> (NL/LLM drafting, event/day scope, the Lambay Lady derived-metric/OA case,
> prize exclusion, perpetual trophies, free-form selectors) stay deferred here.
> Prereq: #239 (the importer drops helm gender, which the "Lady" prizes need).

### Allocating prizes

A scored series produces standings; an event produces *prizes*, and the mapping
between the two is its own problem. A prize is a named award (a trophy, often
perpetual) given to the competitor — or boat, or crew — that best satisfies some
eligibility-and-ranking rule. Sailwave models this manually: the scorer defines a
prize category, then sets competitor-selection criteria (reusing the same
filter UI as race-start selection), and the eligible competitors are ranked by
their series result. Anything the built-in filters can't express, the scorer fakes
by stuffing combined information into a spare field and filtering on that.

We should aim higher than a filter builder. The variety of prize rules is close to
infinite — best lady helm, best junior, best boat from a given club, best
newcomer, top non-spinnaker, the perpetual trophy with a hand-written constitution —
and most real rules are written in prose in a Notice of Race, not as a filter
expression. The aspiration: let the scorer express prize criteria in **natural
language** (ideally by pointing at the NoR text directly), have the system draft a
**deterministic rule** from it, and let the scorer review and confirm that rule
before it runs. The natural-language statement stays attached as the
human-readable record of intent, the same pattern as the Claude-assisted YAML
scoring fixtures above — the LLM drafts, a human who knows the event vets, and the
vetted artifact is deterministic and auditable.

KISS start. Because the rule space is unbounded, the first pass should be small and
honest about its limits:

- A **prize** is a named award with an eligibility predicate over competitors and a
  ranking rule (default: series standing) to break it down to a single winner.
- Eligibility starts as the boring, common cases — a field equals a value (class,
  division, club), a flag is set (junior, lady helm), membership in a named set.
- Prizes are computed against a series' final standings, listed on a prize sheet,
  and included in published output. Sailwave can already publish a prize list; we
  should at least match that.

Then layer the LLM-drafting step on top once the deterministic core exists: NoR text
in, a draft predicate + ranking rule out, scorer confirms.

A concrete example of these common cases is the IODAI (Optimist) nationals: "First
IRL is national champion, and first girl is first girl." The overall series winner
takes the regatta, but the *national champion* title is restricted to IRL sailors —
the first boat whose nationality is IRL, which may not be the overall winner if a
visiting sailor tops the standings. The "first girl" is a separate prize ranked on
series standing within a gender filter. Both are eligibility-predicate-plus-standing
rules — nationality-restricted title and gender-restricted prize — so they land
squarely in the deterministic core, but they show that a single series can carry a
*restricted title* (national champion ≠ overall winner) alongside ordinary prizes.

**The hard example — multi-series, OA judgement, conditional metric.** The HYC
Lambay Lady shows how far past a filter builder real rules go:

> The Lambay Lady, which is perpetual, will be awarded to the boat that the OA
> determines to be the best performing boat on the day, based on time difference to
> the second placed boat for fleets with at least six starters, either on scratch
> or IRC.

Everything about this resists a simple predicate:

- **It spans multiple series.** The metric is computed *across* every fleet racing
  that day, each of which is (in our model) its own series with its own scoring.
  A prize that ranges over multiple series has no home in a per-series prize list —
  it needs an event/day-level scope that sits above the series, which we don't model
  yet.
- **The metric is a margin, not a placing.** "Time difference to the second placed
  boat" is a derived quantity — first boat's corrected time vs. second's — not
  something in the standings table. And it's computed per fleet, then compared
  across fleets.
- **It's conditional.** Only fleets with ≥6 starters qualify, and the comparison can
  be done "on scratch or IRC" — two different scoring bases, with the choice itself
  part of the rule.
- **It ends in human judgement.** "the OA determines" — the system's job here is to
  *surface the candidates and their margins* (the six-plus-starter fleets, each
  winner's gap to second on both bases) and let the Organising Authority decide,
  not to crown a winner automatically. A good prize feature knows when to compute a
  shortlist and hand off, rather than pretending the rule is fully mechanical.

This one example argues for the eventual shape: prizes scoped above the series (at
an event or day level), ranking rules that can reference derived metrics beyond the
standings placing, and a deliberate "assisted, not automatic" mode where the system
computes candidates and the OA confirms — distinct from the mechanical prizes it can
award outright.

A further rule shape is **prize exclusion**, where winning one prize disqualifies a
boat from another:

- Prize exclusion (NoR §9.2): a boat winning an IRC/VPRS prize is
  ineligible for the ECHO prize in the same series; a one-design winner
  (Beneteau 211/31.7) is ineligible for the ECHO prize. A class may opt out
  before the season. This is the HYC IRC-vs-HPH exclusion pattern again — a
  prize/presentation concern aware of results across systems, not a scoring
  concern.

Exclusion makes prize allocation order-dependent: prizes can't all be computed
independently, since awarding one removes a candidate from another's pool. The model
needs a notion of resolution order (or precedence) between prizes, not just a
predicate per prize.

Open questions: the scope model (does a "prize" attach to a series, an event, or a
free-standing day-level grouping of series?); how perpetual trophies carry across
years and where their history lives; whether prize winners belong in the series file
/ JSON export as part of the authoritative record; how prize lists render into the
published `/p/...` pages; and where the boundary sits between fully-deterministic
prizes and ones that always end in an OA decision.

### Arbitrary competitor selectors (flags / tags)

Beyond the structured competitor fields we already hold, HalSail lets a club attach
free-form **selectors** (a.k.a. selection flags) to a boat — short tags like "youth",
"gold fleet", "lady helm" — to slice the fleet. We never pinned down exactly what DBSC
drive with them, so this is speculative — but worth capturing. The clear use in our model
is **prize eligibility** (the "a flag is set (junior, lady helm)" cases in Allocating
prizes above) and ad-hoc filtering / views. Shape of the change: an open tag set on the
competitor, editable in the competitor list and usable as a predicate wherever we filter
competitors (prizes, and any future selection-based grouping). Caveat: prefer a real
structured field when the concept is known (class, division, club) — selectors are the
escape hatch for the long tail a club invents, not a substitute for modelling.

> The structured counterpart — letting a competitor carry more than one
> subdivision/category axis at once (e.g. a Gold/Silver division *and* a
> Youth/Master age category) — is tracked in #241; keep that distinct from these
> free-form tags.

---

## Results analytics

Beyond the standings table itself, scorers and organisers want views that *interrogate*
a series — how boats performed against their handicaps, how healthy the racing was, where
a result was won or lost. HalSail ships a cluster of these (time-to-win, handicap
analysis, turnout analysis), all exportable to spreadsheet. We have none yet; the
standings page is the only analytical surface.

Candidate analyses, roughly in order of usefulness:

- **Time-to-win.** For a handicap race, how much faster each boat would have needed to
  sail to win — the corrected-time gap to first, expressed as elapsed time. Makes a
  handicap result legible to a sailor who only knows their own finish time ("you were 90
  seconds off winning"). Pure post-processing of finishes already in the engine.
- **Handicap analysis.** Each boat's performance *relative to its own rating* across the
  series — are they consistently over- or under-performing their handicap? Distinct from
  the progressive-rating evolution captured under "Series-level rating-history page"
  (which tracks how the *number* moved): this asks how the boat sailed against whatever
  number it held, including for static systems (IRC, PY) where the rating doesn't move.
- **Turnout analysis.** Participation health — starters per race, per class, over the
  series; who's sailing consistently vs. dipping in. An organiser/club metric more than a
  competitor one, useful for series reports and justifying the event.

Shape of the change: these are read-only derived views over data the engine already
holds (finishes, ratings, results), so the work is computation + presentation, not
schema. Open questions: which land in the app UI vs. only as exports (HalSail leans on
spreadsheet export — we'd likely want at least time-to-win in-page); whether any belong
in the published `/p/...` output for competitors, or stay scorer/organiser-facing; and
how they interact with multi-fleet series and discards (is time-to-win computed before or
after discards?). Pairs with the operator-facing engagement metrics under Operator
administration — those measure the *product*; these measure a *series*.

---

## AI and automation

### LLM-drafted changelog entries

When a scorer publishes an update, an LLM could automatically draft the changelog entry
by diffing the previous and new results — the scorer then reviews, edits, and confirms
before publishing. The input (structured results diff) is well-suited to LLM
summarisation.

Considerations: cost and latency of an LLM call at publish time (may need to be
optional or async); privacy (results data would leave the system if sent to an external
LLM API).

Depends on the changelog feature above.

*(Was GitHub issue #9)*

### Claude-assisted workflow for non-coder domain experts

Domain expertise (RRS Appendix A, obscure scenarios, edge cases) is rare and hard to
encode. A contributor workflow where an experienced scorer uses Claude to explore a
scoring scenario in natural language, Claude translates it into a declarative YAML test
case, and the contributor vets the YAML for accuracy — lowering the barrier to
contributing deep scoring knowledge without requiring coding ability.

The natural-language description alongside the YAML serves as human-readable
documentation, making the test case legible to other non-coders. The vetting step is
critical and non-trivial — only someone who really knows the rules can confirm the YAML
is correct.

*(Was GitHub issue #18)*

---

## Operator administration

### An admin interface for the instance operator

Everything the operator of `sailscoring.ie` does today happens through CLI scripts
run against the production `DATABASE_URL` (`docs/account-admin.md`,
`scripts/provision-org.ts`) plus runbooks. That was the right shape while every
operation was rare, but the surface keeps growing — org-request fulfilment, feature
toggles, account deletion — and each is a UI-shaped task being done with
copy-pasted CLI invocations. The proposal: a gated in-app admin area (an `/admin`
route group) giving the operator the same operations with the safety of forms,
confirmations, and visibility.

The prerequisite is an *operator identity*: the schema has workspace-level roles
(`owner | admin | member`) but no site-level operator concept. Gating could start
as simply as an env-var email allowlist checked in a `requireOperator()` seam,
mirroring `require-workspace.ts`. Per-instance operators also fall out of the
country-scoped-instances idea above — each instance has its own operator, so the
admin surface should not assume a single hard-coded person.

### What the CLI scripts provide today

Each script is a candidate admin-UI page; the script logic is already factored as
importable functions writing through Drizzle, so a UI can share it rather than
shelling out.

- **`provision-org`** — the privileged workspace lifecycle: `create-org` /
  `delete-org`, pre-creating users, break-glass member operations (`add-member`,
  `set-role`, `remove-member`, `list-members`), fulfilment of self-service
  org-creation requests (`list-requests` / `fulfil-request` / `decline-request`),
  and per-workspace feature toggles (`enable-feature` / `disable-feature` /
  `list-feature`).
- **`user-stats`** — read-only per-user engagement: ever logged in, session count
  and recency, workspace memberships, series/race/competitor/finish counts.
- **`change-email`** — reassigns a user's login email; the supported recovery path
  while magic-link is the only sign-in method and self-service email change
  doesn't exist.
- **`delete-account`** — deletes a user and their private data, with a dry-run
  plan (sole-member workspaces cascade, shared workspaces survive, ownerless
  workspaces flagged) and `--force` to execute.

### Workspace feature matrix

A table view of which gated features (#155, `lib/features.ts`) are enabled for
each workspace: workspaces as rows, registered features as columns, each cell a
toggle. This replaces the `enable-feature` / `disable-feature` / `list-feature`
CLI round-trips and gives the containment-audience question ("who do we need to
talk to before retiring this?") a single screen. The registry's `label` field
already anticipates this ("used by … any future admin UI"). Toggles must honour
the default-on semantics: disabling a default-on feature records an explicit
opt-out in `disabledFeatures`, not just the absence of an enable.

### User engagement metrics

Two roles to track (per `docs/requirements/user-stories.md`): scorers, who log in
and edit, and result viewers, who anonymously hit published pages. The operator
needs to see growth in both, and the right question evolves with the user base.

**Scorers.**

- *Right now:* have invited scorers ever logged in? A binary per-user signal — the
  schema doesn't carry it (no `user.lastLoginAt`; `session` rows expire).
- *Next:* are they coming back? Per-workspace last activity, including reads. The
  single `requireWorkspace()` seam would naturally be the place to stamp a throttled
  `member.lastSeenAt` — which also powers a "Last active" column in the Members card.
- *As the user base grows:* weekly/monthly active scorers, retention cohorts,
  per-workspace activity counts. At that point engagement belongs on the admin
  interface, not the per-workspace Members card — the questions are about the
  product as a whole, not a specific club's roster.

**Result viewers.**

- *Right now:* are published pages being hit at all, and is the count growing?
  Anonymous traffic; the `/p/[...slug]` function (see ADR-008 Phase 10) is a natural
  pinch point for app-side counting, and Vercel's analytics covers the CDN side.
- *Next:* hits per series and per workspace over time — distinguishing pages that
  draw repeat traffic from one-shot regatta wrap-ups.
- *As publishing grows:* aggregate trends across all workspaces, surfaced on the
  same admin dashboard as the scorer metrics.

Natural first concrete steps, when each check actually needs answering: a
`member.lastSeenAt` stamp in `requireWorkspace()` on the scorer side, and turning
on request counting at the `/p` function (or Vercel analytics) on the viewer side.

### Account deletion

The Privacy Policy directs users wanting their account deleted to email
`mark@hyc.ie`, and we act within the GDPR one-month window — today by running
`delete-account` by hand. Two steps forward from there:

1. **Operator-performed deletion in the admin UI.** The script's dry-run plan
   (which workspaces cascade, which survive, which end up ownerless) is exactly
   the confirmation screen the admin UI should show before the destructive step.
   This also forces resolving the caveat in `docs/account-admin.md` that the
   script has no backup-before-delete and is scoped to test accounts.
2. **Self-service deletion in `/account`.** The modern expectation is a button
   that removes the account without anyone in the loop. Open questions:
   confirmation flow (typing the account email, an email-loop confirm, or both);
   a short retention window for accidental deletes versus immediate hard delete;
   what happens to workspaces the user owns alone (transfer to another member?
   force-delete with notice?) versus workspaces where they are one of several
   members (just remove the membership); whether to offer a one-click export of
   owned workspaces before deletion; how `lastModifiedBy` and activity-log
   references survive an erased user (tombstone identifier vs. anonymise).

Distinct from the operator-triggered stealth-beta cleanup that landed under #121
(export-and-email by the operator) — that was about *us* deleting *their* data on
a short clock; these are about deletion on the account holder's request.

---

## Marketing and presence

### Short video demo on the website

A 60–90 second screencast showing the core scoring workflow, embedded on the marketing
site home page. Should reflect the keyboard-driven UX. Record at a stable milestone,
not too early; needs to be kept up to date as the UI evolves.

*(Was GitHub issue #6)*
