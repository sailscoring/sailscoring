# Feature Inventory

The single source of truth behind two user-facing surfaces:

- the **marketing site's `/features` page** (sailscoring.ie#6) — pre-signup,
  sales-shaped copy for a scorer deciding whether to try the app;
- the **in-app help page** (`app/help/page.tsx`) — post-signup, instructional
  copy for a scorer doing the job.

Both should draw on the same feature list and the same screenshots, differing
in slant and depth rather than substance. This document holds the neutral
inventory: what exists, one sentence on what it does, and what a
representative screenshot should show. When a feature ships, is gated, or is
retired, update this inventory alongside the help page (per
`docs/design/user-docs.md`, help ships with the feature) and treat the
marketing page as downstream of it.

## How to read the tables

- **Feature (help §)** — the section id documenting it in the in-app help.
  Help is chaptered (`/help/<group>`, one chapter per group below, same slugs
  as the marketing page); the manifest in `app/help/sections.ts` maps each id
  to its chapter, and old `/help#id` links redirect. *No §* marks a help gap
  worth closing.
- **Status** — `core` (always on), `default-on` (gated, on unless a workspace
  opts out), `opt-in` (self-service gate, off by default), `operator`
  (switched on per workspace by us, on request). Gated features get a light
  "needs enabling in Workspace settings" / "available on request" marker on
  both surfaces — status is a property, not the organising principle.
- **Screenshot** — what the shot should contain: real app, sample data, same
  lightbox treatment as the existing five in the marketing site's
  `public/screenshots/`. Every feature gets a shot **captured**; whether each
  is **included** on a given surface is decided afterwards, looking at the
  actual image — a brief that sounds worthwhile can come out too low-value to
  publish, and vice versa. Gated features need a demo workspace with the gate
  on; the seeded demo samples (`club-league.sailscoring`,
  `championship.sailscoring`) are ready-made subjects. Composition rules the
  capture rig (`scripts/feature-shots.ts`) applies: the shot's subject leads
  the frame (scrolled to the top of the viewport, not buried below settings
  cards or long lists), and a small affordance that carries the feature — an
  Open in Sail Scoring link, a recorded unknown row, an open code dropdown —
  gets a red presentation ring so it can't be missed.

Group ordering follows what a scorer cares about, not how the code is
organised; regroup freely when laying out a page.

## 1. Running a series

Setting up a series: entries, fleets, starts, and the race calendar.

| Feature (help §) | Status | Description | Screenshot |
|---|---|---|---|
| Series creation (`#creating-a-series`) | core | Create a series — a trophy, league, or championship — with a name, optional venue and date, and go straight to entering competitors. | New-series wizard filled in with name, venue, date, and a category picked. |
| Series list, categories, ordering (`#organising-series`) | core | The workspace home groups series under your own categories, in your own drag-ordered sequence, with recent-activity lines under each. | Workspace series list with two or three categories, several series each showing a recency line. |
| Archive and trash (`#organising-series`) | core | Finished series archive to a read-only year-grouped section, and deletion is a two-step soft delete with a 30-day recovery window. | Foot of the series list: the Archived section expanded showing year groups, and the Trash section with a series showing its Recover button. |
| Competitor list and fields (`#adding-competitors`) | core | Each entry carries a sail number and name plus whichever optional fields the series enables — boat, class, owner, helm, crew, club, gender, age, bow number, entry number, nationality (with flags), and prize-giving subdivision axes. | Competitors tab of a keelboat series showing nationality flags and a Division column. |
| Alternative sail numbers (`#adding-competitors` and `#entering-results`) | core | A boat can list the other sail numbers it may show — a replacement or borrowed sail. Finish entry matches any of them and records which one the boat raced under, while results still show the registered number. | Competitor dialog with two alternative numbers, and a committed finish row tagged "sailed as". |
| Sorting the competitor list (`#sorting-the-competitor-list`) | core | Sail numbers order as numbers, not as text, and any column sorts on a click — shift-click stacks up to three, so entries can be listed by nationality, then gender, then sail number. | Competitors tab sorted by club then sail number, both heading arrows and their position badges visible. |
| Multi-person fields (*inline in* `#adding-competitors`) | opt-in | Any person field can hold several names, so co-owned boats, co-helms, and full keelboat crews are recorded in full. | Competitor dialog with two owners and several crew rows. |
| Bulk clean-up (`#adding-competitors`) | core | Filter-and-select drives bulk delete and Set field…, and Find duplicates groups suspect entries — including sail-number changes — for review and one-click merge. | Find-duplicates review dialog: a possible-duplicate group with its Merge button, kept copy highlighted. |
| Fleets (`#fleets`) | core | Competitors group into fleets scored independently — each with its own standings and its own penalty-point base — created simply by naming them on entries. | Settings tab Fleets card: several fleets with drag handles, rename buttons, and each fleet's scoring system. |
| Start sequences (`#start-sequences`) | core | Describe the staggered start order once and every new race resolves all its start times from the first gun. | Default start sequence editor: three classes at 5-minute intervals with resolved times previewed in the new-race dialog. |
| Race-scoped fleets (`#race-fleets`) | core | A race's recorded starts declare which fleets sail it, so finish entry and automatic DNCs cover only the boats actually racing. | Race starts card with two of three fleets in a fleets-only start (gun time blank), the boat list beneath scoped to them. |
| Adding races, bulk add (`#adding-races`) | core | Add races singly or generate a whole weekly/fortnightly season with a date preview, then name, reorder, or insert races without disturbing scoring. | Add multiple races dialog with the generated date list. |
| Race conditions and management team (`#race-management-metadata`) | opt-in | Record what a race was sailed in (wind range and direction, course notes) and who ran it, using World Sailing's role names, publishable only by explicit choice. | Race record dialog with wind range, direction, and a small named team. |
| Sub-series (`#sub-series`) | opt-in | Score named blocks of races — Winter and Spring, Tuesdays and Saturdays — independently over one shared entry list, with their own discards, standings, published pages, and chained progressive handicaps. | Races tab of the seeded Sample Club League: race list with sub-series chips for Overall, Spring, and Summer. |
| Follow-on series (`#creating-a-follow-on-series`) | opt-in | Roll a finished series into the next one of the season, carrying settings, fleets, competitors, and end-of-series progressive handicaps forward. | Create follow-on series dialog asking name and start date, with the carried-forward note visible on the new series' Competitors tab. |
| Split-fleet championships (`#split-fleets`) | operator | Run a qualifying/final championship — Yellow/Blue fleets re-dealt from the ranking each morning, Gold/Silver finals, combined interleaved finish sheets, catch-up and medal races — from a guided tab that restates your configuration as sailing-instruction prose, marking the sentences whichever setting you are on writes. | Two shots: the Split Fleets tab of the seeded championship showing round assignments; the published championship standings with tiered Gold/Silver tables. |
| World Sailing Sailor IDs and seeding (`#world-sailing-id`) | opt-in | Record each sailor's World Sailing ID, carry an organising authority's seed ranking as a Seeding rank column, and verify every ID against World Sailing's datafeed. | Check Sailor IDs dialog with valid, unknown, and mismatch rows. |

## 2. Entering results

The race-day loop: getting a finish sheet into the app fast and correctly.

| Feature (help §) | Status | Description | Screenshot |
|---|---|---|---|
| Finish entry (`#entering-results`) | core | The entry screen is a digital finish sheet — row order is crossing order, a sail number commits on Enter as soon as it's unambiguous, and timed fleets prompt for a finish time. | Exists (`finish-entry.webp`): entry screen mid-race with finishers recorded and the Did-not-compete group below. |
| Unknown sail numbers (`#entering-results`) | core | A number not on the entry list is recorded as an unknown crossing in its slot and resolved to a competitor later, so the sheet is never held up. | A recorded unknown crossing in the finishing order — the "not registered" row with its Resolve affordance, ringed. |
| Bow-number matching (`#entering-results` and `#adding-competitors`) | core | When recorders write bow numbers, finish entry matches on those too and tags the row so the differing sail number is explained. | Suggestion list showing the matched-on-bow marker, and the committed row tagged entered by bow. |
| Result codes (`#entering-results`) | core | The full RRS code set — DNS, DNF, OCS, NSC, RET, DNC, DSQ, DNE, UFD, BFD — grouped by how each arises, with non-competing boats collected automatically. | Result-code dropdown open, showing the operational and protest-committee groups. |
| Scoring penalties (`#entering-results`) | core | Finishers penalised after a hearing take ZFP, SCP, or DPI additive penalties scored per RRS 44.3(c) and A6.2, shown in amber in the standings. | Penalty editor open from a finisher's row-actions menu, with an amber penalised score like 4 (ZFP) visible in the standings. |
| Redress (`#redress`) | core | Grant RRS A9 redress by average of all races, races before, or stated points — with race-pool restrictions and per-fleet values for boats scored in several fleets. | Redress dialog showing the three A9 methods and a pool restriction. |
| Start check-in (`#start-check-in`) | core | Tap or type boats present in the starting area as they arrive — the data source for A5.3 scoring and for DNF-vs-DNC defaults. | Start check-in tab with several boats marked and the running count. |
| Finish-sheet import (`#importing-finish-sheet`) | opt-in | Import a whole race's finish sheet from CSV or Excel — sail numbers, optional times, optional codes, row order as crossing order — with a preview before it replaces the race. | Import preview dialog reporting finishers, coded entries, and replacements. |
| RaceSense import (`#racesense-import`) | operator | Read a whole regatta out of the race committee's Vakaros RaceSense export: every sheet matched to its race and marked new, unchanged or differing, so a day's results land in one upload while corrections made by hand are never overwritten. Boats over the line keep their OCS, which the finish list alone would have lost. | The import dialog over the sample league: two races already imported reading Unchanged, the third still ticked as New. |
| Keyboard-first workflow (`#keyboard-shortcuts`) | core | Every page-level action has a shortcut and `?` opens the reference, so a practised scorer rarely leaves the keyboard. | Shortcut reference dialog open over the races tab. |

## 3. Scoring correctness

The engine: RRS Appendix A, applied exactly and recomputed instantly.

| Feature (help §) | Status | Description | Screenshot |
|---|---|---|---|
| Low Point scoring (`#reading-the-standings`) | core | Series are scored to RRS Appendix A Low Point, and every edit — a late protest decision, a corrected finish — recomputes standings instantly. | Fleet standings with plain low-point race scores, a coded score in parentheses, and Total and Nett columns. |
| Result-code scoring (`#entering-results`) | core | Codes score their correct penalty bases automatically, including DNE's exclusion from discard. | Standings row where a red DNE stands undiscarded while the boat's next-worst score is struck through instead. |
| Discard rules (`#discard-rules`) | core | State the sailing instructions' discard schedule as sentence rules — with N races sailed, exclude M — and the app flags profiles that look wrong without forbidding them. | Scoring card with two step rules configured. |
| Proportional discards (*inline in* `#discard-rules`) | opt-in | State the allowance the way long-series SIs do — one discard per so many races sailed — and read back exactly where it steps up. | Scoring card in One per so many races mode showing the steps-up-at readback line. |
| Tie-breaking (`#reading-the-standings`) | core | Series ties break per RRS A8.1 and A8.2 automatically; tied finishes share averaged points. | Standings with two boats on equal nett points ordered by the tie-break, and a tied finish sharing an averaged score (2.5, 2.5). |
| A5.3 starting-area scoring (`#a53-scoring`) | core | Score DNF/OCS penalties on starting-area entries rather than series entries — including the variant that scores DNC that way too — for clubs with variable turnout. | Settings Scoring card with the A5.3 option and its variants visible. |
| Per-race scoring options (`#race-scoring-options`) | opt-in | Mark a race must-count, discard-first, or weighted (×2, ×0.5, …), with the standings carrying the marks and a legend. | Standings with an "R4 ×2" column header, asterisked header, and the legend beneath the table. |

## 4. Rating and handicap systems

Every mainstream system a club or class is likely to score under.

| Feature (help §) | Status | Description | Screenshot |
|---|---|---|---|
| Scratch (`#rating-systems`) | core | Position-based scoring for one-designs and any fleet racing on equal terms. | A one-design fleet's per-race results table: finishing order, no corrected times, points equal to place. |
| IRC (`#rating-systems`, `#update-handicaps-irc-rating`) | default-on | Static time-on-time TCC scoring, with TCCs pulled straight from the worldwide IRC rating list — matched by sail number, spinnaker/non-spinnaker per fleet, dual certificates handled. The list also settles who is in the fleet: newly-certificated boats can be added, and boats it doesn't rate offered for removal. | Update handicaps dialog, IRC source: current → new rows with a couple unticked. |
| Portsmouth Yardstick (`#rating-systems`, `#update-handicaps-rya-py`) | default-on | PY scoring for mixed dinghy fleets, with numbers and canonical class names applied per class from the bundled RYA list, guide-only numbers flagged. | Update handicaps dialog, RYA PY source: per-class rows with Name and Number applies and a guide-only flag. |
| ECHO (`#rating-systems`, `#update-handicaps-irish-sailing`) | default-on | Irish Sailing's progressive handicap, adjusted after every race from a performance index, with handicaps pulled from the national Irish Sailing list. | Update handicaps dialog, Irish Sailing ECHO source: current → new rows matched by sail number. |
| NHC (`#rating-systems`) | core | The RYA National Handicap for Cruisers run on SWNHC2015 parameters, with per-fleet parameter overrides available for tuning experiments (opt-in). | NHC fleet race table with the New TCF column and applied ratings printed under each score. |
| VPRS (`#rating-systems`, `#update-handicaps-vprs`) | opt-in | Static time-on-time scoring on VPRS TCCs, pulled from the club's published list with spinnaker/no-spinnaker choice per fleet. | Update handicaps dialog, VPRS source: club picker and current → new rows. |
| Carrying handicaps between series (`#updating-handicaps`) | core | Carry every boat's handicap forward from a prior series — end-of-series TCFs for progressive systems — with a full current → new preview and a mid-series-vs-correction choice for already-scored races. | Update handicaps dialog, prior-series source, with the keep-already-scored-races-on-the-old-rating checkbox visible. |
| Rating transparency (`#rating-systems`) | core | Progressive fleets always show each boat's next rating, and a toggle reveals the full per-race calculation columns so a rating officer can verify every adjustment by calculator. | Published NHC or ECHO race table with the rating-calculation columns revealed. |
| Multi-fleet boats (`#fleets`, `#importing-competitors`) | core | One boat can be scored in several fleets at once — the same start scored under IRC and ECHO, or a rated fleet plus scratch line honours. | The same boat's row in an IRC fleet's standings and an ECHO fleet's standings, side by side or stacked. |

## 5. Reading and checking

Trusting the numbers: standings you can read, and a record of how they got there.

| Feature (help §) | Status | Description | Screenshot |
|---|---|---|---|
| Standings (`#reading-the-standings`) | core | Total and nett columns, struck-through discards, podium badges on the series and every race, and distinct styling for coded, penalised, and redress scores. | Exists (`standings.webp`). |
| Per-fleet race exclusion (`#reading-the-standings`) | core | Strike a race from one fleet's scoring straight from the standings — the single-competitor heat case — while it still counts for every other fleet. | Race column-header menu open on Exclude from this fleet, naming the underlying race, with an already-struck column alongside. |
| Preview (`#reading-the-standings`) | core | See the exact rendered results page in-app before anything goes public, and download it as self-contained HTML or print-tuned PDF. | Exists (`preview.webp`). |
| Version history (`#history`) | core | Automatic point-in-time versions with per-session change detail, one-click restore, named checkpoints, and pinned Published/Saved milestones — the audit trail for a protest committee. | History tab with real texture: a named checkpoint, a Published pin, and edit sessions, the newest expanded to its changes. |

## 6. Publishing

From standings to a public URL your club can link forever.

| Feature (help §) | Status | Description | Screenshot |
|---|---|---|---|
| One-click publish (`#publishing-results`) | core | Publish standings to a stable public URL under your workspace — an explicit point-in-time action, with the dialog counting edits since the last publish. | Publish dialog over a multi-fleet series: fleet checkboxes, editable URL segments, edits-since note. |
| Public results pages (`#publishing-results`) | core | Clean, read-only results pages — one per fleet — that need no sign-in and carry your event branding. | Exist (`public-results.webp`, `public-results-full.webp`). |
| The publication tree (`#publishing-results`) | core | Every published page slots into a navigable tree — workspace index, season and event indexes, filter dropdowns, and a navigation cascade on every page — maintained automatically as you publish. | Workspace public index: seasons collapsible, current season open, per-event results links, filter dropdowns. |
| Co-published events (`#publishing-results`) | core | Several series can publish into one event folder — cruisers and one-designs of the same regatta — each publishing and unpublishing independently. | An event folder's listing page with two series under it, each with its own fleets. |
| Single-race events (`#publishing-results`) | core | A one-race trophy publishes as just the race table — finish times, corrected times, places — instead of a one-column standings page. | Published Results page of a one-race event: the race table alone, no series summary above it. |
| Extra pages (`#combined-pages`) | opt-in | Publish several fleets as sections of one page — an all-fleets Overall page, or one class page covering every method it's scored under — optionally replacing the per-fleet pages. Full-detail pages read standings first, then each fleet's races in its own delineated section, and can publish just the last N races' results for embedding in a fixed-height frame. | Combined Overall page with two or three fleet sections. |
| Per-division pages (`#combined-pages`) | opt-in | Publish a table per division — Gold, Silver, Bronze — beside the overall standings: the same racing and the same scores, each division ranked among its own boats, which is how a division prize-giving reads and what a class will ask for. | Published per-division page: three division tables of one fleet's results. |
| Provisional and final results (`#results-status`) | opt-in | Results carry a provisional-as-of line until you mark the series final through a checklist built on the RRS 60.3(b) protest time limit, computed live from each race's last finisher. | Races tab on race day with the last-finisher / protest-limit line; or the Mark as final checklist dialog. |
| Prizes (`#prizes`) | opt-in | Turn the Notice of Race prize list into named awards with eligibility conditions — fleet, subdivision, rank, gender, nationality, club — allocated live from the standings and published as a prize-sheet page. | Prizes tab with several awards and their current recipients, one warning showing. |
| Published-page management (`#publishing-results`) | core | The Published tab lists every live page with its URL, last publish, and edits since — with search, filters, and unpublish, including for pages whose series was deleted. | Published tab: pages grouped by category and Past results, edits-since counts, and a Series deleted entry. |
| FTP upload to your own site (*inline in* `#publishing-results`) | operator | Push published results pages directly onto your club's own web hosting over FTP or FTPS, with per-fleet remote paths remembered per series. | Publish dialog in Your website (FTP) mode: server selected, per-fleet remote paths with checkboxes. |
| Logo library and branding (`#logo-library`) | default-on | A shared workspace library of venue, club, class, and sponsor logos — plus a built-in canonical set — with workspace defaults, so published pages come out branded without hunting for image URLs. | Logo library card with a grid of workspace and built-in logos. |

## 7. Data in and out

No lock-in, in either direction.

| Feature (help §) | Status | Description | Screenshot |
|---|---|---|---|
| Competitor spreadsheet import (`#importing-competitors`) | core | Import an entry list from CSV or Excel with per-column mapping and samples, and sail-number changes detected instead of duplicated. | Column-mapping dialog with sample values. |
| Fleet planning on import (`#importing-competitors`) | core | Decide the fleets before the columns: pick what splits the boats, see the fleets the ratings imply, then rename, re-scope, drop, or add one the spreadsheet says nothing about — an IRC fleet with certificates still to come. | The importer's Fleets step: a group with an NHC fleet and an added IRC one, showing boat counts. |
| Sailwave import (`#sailwave-import`) | opt-in | Import a Sailwave `.blw` — fleets, competitors, ratings, results, subdivisions, prizes — or keep scoring in Sailwave and use Update from Sailwave file to make Sail Scoring the publishing front end. | Sailwave import wizard preview of fleets, competitors, and races. |
| `.sailscoring` files (`#saving-and-sharing`) | core | Save any series as a single portable file — competitors, races, results, and its full version history — and reopen or update from it anywhere, with divergence detected. | Update from File confirmation with the clean-continuation check, alongside the series ⋯ menu showing Save to File. |
| JSON export and Open in Sail Scoring (`#json-export`) | core | Every published page embeds a machine-readable results snapshot and an Open in Sail Scoring link that imports the whole series into any account, one click. | Published-page footer with the Open in Sail Scoring link, and the import confirmation with its workspace picker. |
| rrs.org competitor push (`#rrs-org-push`) | opt-in | Push the entry list to a racingrulesofsailing.org event for protests and jury work, relaying contact columns without ever storing them. | Import dialog with Import to rrs.org ticked: event UUID field and the division-slot mapping choice. |

## 8. Across series and seasons

The workspace-level layer over individual series.

| Feature (help §) | Status | Description | Screenshot |
|---|---|---|---|
| Competitor identity and timelines (`#competitor-identity`) | operator | Entries across seasons resolve into recurring competitors, each with a public timeline of every series sailed ("3rd of 48") and a searchable competitor index. | Public competitor timeline spanning several seasons; competitor index with a search underway. |
| In-app reconcile (*inline in* `#competitor-identity`) | operator | Review the automatic matching on the workspace Competitors tab — combine possible pairs, split long arcs, rename — with splits that stick. | Workspace Competitors tab: a recurring-competitor card, and a To-review possible-same-sailor pair with Combine and Different sailors. |
| Cross-series rankings (`#rankings`) | operator | Best-N season ladders computed over chosen series buckets — participation floors, nationality and fleet filters, committee adjustments — published as a public page that updates as results land. | Public ranking ladder: per-series place columns, discards in parentheses, Net and Total. |
| As-published archives (no §; ADR-010) | operator | A club's historical results can be brought in exactly as originally published — display-only, never re-scored — so decades of results live alongside the current season. Where a club published one result twice (an overall standing and the same boats split by division), both presentations are carried as pages of one event, and the sailors are counted once. | Workspace public index showing past seasons stretching back years. |

## 9. Collaboration and accounts

A scoring panel working as one.

| Feature (help §) | Status | Description | Screenshot |
|---|---|---|---|
| Passwordless sign-in (`#signing-in`) | core | Sign in with an emailed link — no password to manage — and your series follow your account to any device. | Sign-in screen with the email field, or the check-your-email state after requesting a link. |
| Workspaces (`#signing-in`) | core | A private personal workspace plus shared club workspaces, with series copyable between them and everything scoped to the workspace you're in. | Workspace switcher open, showing My Workspace and a shared club workspace with its logo. |
| Members, roles, invitations (`#collaboration`) | core | Invite the panel by email and set roles — owner, admin, viewer-member, and (opt-in) a race-day scorer role scoped to entering and publishing results. | Members card with a pending invitation and role selects. |
| Live co-scoring (`#collaboration`, `#signing-in`) | core | The whole panel sees edits in close to real time, and simultaneous edits to the same finish produce a conflict prompt naming the other scorer instead of silent overwrites. | The conflict dialog naming the other scorer over a finish both edited. |
| Workspace requests (`#signing-in`) | core | Request a shared workspace from your Account page and it arrives with you as owner, ready to invite the panel. | Account page workspace-request card with a name filled in. |
| Feature toggles (`#signing-in`) | core | Owners switch optional features on and off for the whole workspace — several seed a worked demo series when first enabled — keeping the interface as small as the club's racing. | Features card in Workspace settings. |
| Help beside your work (`#reading-help`) | core | Help opens in a panel next to the screen you're on, pinned to the section covering it, and minimises and returns without losing your place — the advice and the thing it describes stay on screen together. | A series' standings with the help panel open beside them on Reading the standings. |
| Send feedback (`#sending-feedback`) | core | Send a bug report or suggestion from the user menu, with page and browser context attached and shown before you submit. | Feedback dialog with a message typed and the attached page and browser context shown beneath it. |

## 10. For the technical

For clubs with a developer, and anyone who cares about openness.

| Feature (help §) | Status | Description | Screenshot |
|---|---|---|---|
| REST API (`#rest-api`; `docs/cli.md`, ADR-009) | core | A keyed public `/api/v1` covering series, competitors, races, results, and publishing — the same surface the app itself uses. | Terminal shot: a curl request to `/api/v1` and its JSON response. |
| CLI (`#cli`; `docs/cli.md`) | core | The `sailscoring` CLI drives the API for bulk import, publish, and read operations — scriptable season automation with no database access required. | Terminal shot: a `sailscoring` command and its output (a series import or publish). |
| Open source (no §) | core | The application is MIT-licensed and developed in the open. *(Hold until the repo flip, #282.)* | The public GitHub repository page (capture after the #282 flip). |
| Open data (no §) | core | Your data is exportable at any time — `.sailscoring` files, embedded JSON on every published page — and the file format is documented. | View-source excerpt of a published page's embedded JSON snapshot beside the rendered footer. |

## Decisions still open

Carried from sailscoring.ie#6, to be settled when building the pages:

- **Operator-managed features on the marketing page.** Recommendation:
  include competitor identity/timelines, rankings, and split-fleet
  championships (they have public output and are genuinely differentiating),
  described as *available on request* — as is FTP upload to a club's own
  site; omit in-app reconcile until its UX settles.
- **Screenshot curation.** Every row above gets its shot captured (~55
  briefs, 5 existing); inclusion is decided per surface after reviewing the
  actual images. Low-value shots are dropped from the page, not from the
  capture set — every group should keep at least one.
- **Drift.** Status stays manually maintained (the copy and screenshots are
  the expensive part regardless); the checklist is *registry change →
  update this file → update help → update marketing*. Revisit generating
  the status column from `FEATURES` if it drifts in practice.
- **Help-page screenshots.** `docs/design/user-docs.md` chose prose-only
  help; now that screenshots are being produced anyway, the strongest of
  them should be added to the matching help sections — same assets,
  instructional captions.
