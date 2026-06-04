# DBSC Summer Series Use Case

Target use case for scoring a full club racing season: the AIB DBSC Summer
Series run by Dublin Bay Sailing Club, 23 April – 26 September 2026.

Sourced from the 2026 Notice of Race (Keelboats & Water Wags, incl.
Amendment 1), Sailing Instructions A – General, the DBSC Keelboat Race
Times 2026 (committee vessels, start sequences, fleet make-up) and the DBSC
Racing Programme 2026 (calendar and series structure) — all under
`reference/`. The remaining unseen documents (SI Supplements B/C/D/G/H, the
RAYC Super League NoR) only affect courses and the deferred Super League;
items that depend on them are flagged at the end.

A note on terminology, because two senses of "series" collide here. DBSC's
season splits each fleet's racing into sequential calendar series — **Series
A / B / C** (the discard count resets at each). Orthogonally, each race day
runs one or more concurrent fleet groups, each on its own committee vessel.
Throughout this document a **Sail Scoring Series** maps to a single
*(fleet group × calendar series)* — i.e. one committee vessel's finish sheet
over one calendar block — which is the unit a scorer enters and publishes.

## Why DBSC?

DBSC is the largest step up in scoring complexity of the three target use
cases, and it tests whether the model holds for an ongoing season rather
than a discrete event:

- **IODAI** — one multi-day regatta, one-design, scratch, single scorer.
- **HYC Autumn League** — a 6-Saturday league, two race areas,
  IRC + HPH + scratch.
- **DBSC Summer Series** — a five-month season racing three days a week,
  ~20 classes, **six handicap/rating systems in parallel**, plus
  composite and cross-club meta-series.

It introduces concepts not present in either prior use case:

- **A season, not an event** — each day-stream runs several sequential
  calendar series (A/B/C) of ~6–10 races between April and September, on a
  sliding-scale discard ladder (in practice only the lower tiers bite,
  since a calendar series is short).
- **Many rating systems at once** — ECHO, IRC, ORC Club, VPRS, YTC and PY,
  with the same boat often scored under two or three of them.
- **Per-series progressive handicaps** — a boat carries a *different* ECHO
  handicap for its Tuesday, Thursday and Saturday series, each evolving
  independently.
- **Composite cross-class series** — Women on the Water (WOW) scores boats
  from four classes together off the same races that score their normal
  class.
- **A series-of-series** — the RAYC Super League ranks boats across DBSC
  races *and* external events (Lambay Race, waterfront regattas). This is
  the concept IODAI explicitly deferred.

It also shares the familiar core with both:

- Low Point scoring, RRS Appendix A, standard result codes, discards.
- Handicap correction by corrected time (as HYC).
- One-entry/multiple-results dual scoring (as HYC, but more systems).
- Volunteer scorers; results published on the club website.

## About DBSC

Dublin Bay Sailing Club (incorporating the Royal Alfred Yacht Club) is the
organising authority for the largest regular keelboat and dinghy racing in
Dublin Bay, run from the four Dun Laoghaire waterfront clubs. The Summer
Series is its flagship programme: continuous club racing on Tuesday,
Thursday and Saturday for keelboats, and Wednesday evenings for Water Wags,
from late April to late September.

Scoring is administered centrally by DBSC (the Honorary Secretary handles
entries, certificates, sail-number changes and scoring inquiries). Results
are published on `www.dbsc.ie`. The volume — three race days a week,
~20 classes, six rating systems, a whole season — makes this a
heavy-duty, recurring scoring workload rather than a one-off event.

## Event Overview

| Aspect | Detail |
|--------|--------|
| Name | AIB DBSC Summer Series 2026 |
| Type | Club season (members + visitor entries up to 14 days) |
| Duration | 23 Apr – 26 Sep 2026 (~5 months) |
| Race days | Tue, Thu, Sat (keelboats); Wed (Water Wags) |
| Classes | 12 one-design + Mixed Sportsboats + Cruisers 0–5 (subdivisible) |
| Rating systems | ECHO (progressive), IRC, ORC Club, VPRS, YTC, PY |
| Scoring | Low Point, Appendix A, with modified A5.3 |
| Minimum series | 3 races scored (SI A13.3) |
| Discards | Sliding-scale table, ~1 discard per 6 races (see below) |
| Series structure | Per fleet group, sequential calendar series A/B/C |

## Day, Series and Class Structure

### Race days, committee vessels and finish sheets

The NoR §4.2 "Number of Series" column counts the **concurrent fleet groups
per race day**, not a calendar split — and each fleet group is a separate
committee vessel with its own finish sheet (Keelboat Race Times 2026):

| Day | Fleet groups (committee vessel) | NoR "Series" |
|-----|----------------------------------|--------------|
| Tuesday | **All keelboats** on one vessel (West Pier Hut, Ch 68), four starts | 1 + WOW |
| Thursday | **Blue** (Corinthian, Ch 74) and **Red** (Freebird, Ch 72) | 2 |
| Saturday | **Blue/Red non-Green** (Hut + Corinthian, see below) and **Green** (Freebird, Ch 72) | 2 |
| Wednesday | **Water Wags** (own vessel) | — |

Separately, the season is divided into **sequential calendar series** per
day-stream (Racing Programme 2026):

- **Tuesday:** Series A (28 Apr–26 May), B (2 Jun–14 Jul), C (21 Jul–25 Aug).
- **Thursday:** Series A (23 Apr–18 Jun), B (25 Jun–27 Aug).
- **Saturday:** Series A (25 Apr–18 Jul), B (25 Jul–26 Sep).
- **Water Wags:** Series A, B, C.

No DBSC racing on the four waterfront-regatta Saturdays (6, 13, 27 Jun;
4 Jul). The discard count resets per calendar series.

**Thursday is the cleanest structure for modelling.** Blue = all the
cruisers on one vessel; Red = the one-designs and sportsboats on another.
Two committee vessels, two finish sheets, two Sail Scoring Series per
calendar block.

**Saturday is the awkward case.** The non-Green keelboats are scored as one
series, but physically split across **two** committee vessels each week —
one fleet starts at the Hut, the other at Corinthian, swapping week to week
(per the Racing Programme schedule). Two finish sheets feed one logical
series, which our "one finish sheet = one series" model does not handle
out of the box. The Green fleet (SB20, Sportsboats & Dragon, Flying
Fifteen, Beneteau 211) is a clean third vessel (Freebird). On 29 Aug &
12 Sep (coastal) the Hut is unused and everything starts from Corinthian.

### Classes (NoR §2)

- **One-design (12):** Beneteau 211 (incl. 21.7), Beneteau 31.7, Dragon,
  Dublin Bay 21, Flying Fifteen, Glen, Mermaid, Ruffian 23, SB20,
  Shipman 28, Sigma 33, Water Wag.
- **Mixed Sportsboats** — sportsboats not on the one-design list, scored
  under VPRS.
- **Cruisers 0/1/2/3** (spinnaker) — assigned by handicap band, with the
  Committee free to override (SI A6.3):

  | Class | Handicap range |
  |-------|----------------|
  | Cruisers 0 | ≥ 1.035 |
  | Cruisers 1 | 0.980 – 1.034 |
  | Cruisers 2 | 0.920 – 0.979 (0.908–0.979 if LOA > 9 m) |
  | Cruisers 3 | ≤ 0.919 (≤ 0.907 if LOA > 9 m) |

- **Cruisers 4/5** (non-spinnaker; Cruisers 5 = roller-furling jib),
  subdividable by handicap into **4A/4B/5A/5B**.

Class boundaries may be adjusted by the Committee before the season to
balance numbers and narrow the handicap spread per class (NoR §2.5) — the
same OA-assigns-by-rating pattern as HYC.

### Fleet make-up (Race Times 2026)

| Fleet group | Classes (each its own start) |
|-------------|------------------------------|
| **Thursday Blue** (Corinthian) | Cruisers 0, 1, 2, 3, 4 & 5, Beneteau 31.7 |
| **Thursday Red** (Freebird) | SB20, Sportsboats & Dragon, Flying Fifteen, Ruffian 23, Beneteau 211, Shipman, Glen & Mermaid |
| **Saturday Blue** | Beneteau 31.7, Cruisers 2, 4 & 5 |
| **Saturday Red** | Cruisers 3, Shipman, Ruffian, Glen & Mermaid |
| **Saturday Green** (Freebird) | SB20, Sportsboats & Dragon, Flying Fifteen, Beneteau 211 |
| **Tuesday** (one vessel) | All keelboats, in four starts: (1) Cruisers 0/1/2/4/5 + B31.7; (2) Sportsboats/SB20/FF/Ruffian; (3) Cruisers 3/Dragon/B211; (4) Shipman/Glen/Dublin Bay 21 |

On Tuesdays all cruisers start together (one gun) and are scored under ECHO
(NoR §4.5); Cruisers 0/1/2 additionally under IRC. Each class flies a
numeral pennant for its class (SI A6.5). The Green fleet may sail two
windward/leeward races on a Saturday.

## Handicap and Rating Systems

DBSC runs six systems concurrently. ECHO and IRC are already modelled by
the engine (from the HYC use case); **ORC Club, VPRS, YTC and PY are new**.

| System | Type | Applies to | Notes |
|--------|------|------------|-------|
| **ECHO (progressive)** | Progressive (per-series) | C0–3, C5A/5B, Beneteau 211 & 31.7, WOW | Separate handicap per day-series per boat (A15.10); carries season-to-season (A15.11) |
| **IRC** | Fixed TCC | C0/1/2 (endorsed cert), C3 | `corrected = elapsed × TCC` |
| **ORC Club** | Time-on-time/distance, wind-band | C0–3 *if class requests* | RC selects a wind band per race by VHF; uses a custom scoring option from cert page 2 (A15.7–15.9) |
| **VPRS** | Rating | Mixed Sportsboats, C4A+5A, C4B+5B | New to the engine |
| **YTC** | Rating | Optional substitute for IRC or VPRS | New; "Yacht Time Correction" (RYA keelboat scheme) |
| **PY (Portsmouth Yardstick)** | Yardstick | Mermaid+Glen combined (if < 3 Mermaids) | RYA PY data imported under `reference/data/rya-py/` |

### ECHO (Progressive) — the central system

ECHO is DBSC's progressive handicap and the most pervasive system. Two
DBSC-specific behaviours matter for the model:

1. **Per-series handicaps.** A boat carries *separate* ECHO handicaps for
   its Tuesday, Thursday and Saturday series, each adjusted independently
   from that series' races (A15.10) — up to three concurrent ECHO numbers
   for one boat. This needs no special engine support: because each
   day-stream is a *separate* Sail Scoring Series and ECHO is carried
   per-series, the three progressions are independent by construction (the
   boat is simply a competitor in three series, each with its own seed TCF).
2. **Season carry-over.** A boat that raced ECHO in DBSC in 2025 starts
   2026 on its **adjusted end-of-2025 handicap**; others start on the Irish
   Sailing value. DBSC may revise ECHO at any time, and adjustments are not
   grounds for redress (A15.11).

Corrected time is `elapsed × ECHO_number`, ranked within the class, with
the rating re-adjusted after each race — the same shape as HYC's HPH/NHC.

> **Open question.** The DBSC ECHO progressive-adjustment algorithm.
> `reference/Irish Sailing ECHO guide for clubs 2022.pdf` and
> `reference/ECHO Rules.pdf` define ECHO generally; we need to confirm
> DBSC follows the standard Irish Sailing progressive method (and that the
> engine's existing ECHO matches it).

### New systems to research

VPRS, ORC Club and YTC are new corrected-time systems with no current
engine support. Scope and formulas need confirming before they become
requirements — see open questions.

## Multi-System ("Dual") Scoring

As at HYC, a single finish time produces results under multiple systems,
each with its own series standings and prizes — but DBSC layers this more
heavily:

- **Cruisers 0–3:** ECHO + IRC (+ ORC if requested) → two or three parallel
  series per class.
- **Cruisers 5A/5B:** VPRS + ECHO.
- **Beneteau 211 & Beneteau 31.7:** one-design + ECHO.
- **Sigma 33:** scored *as part of Cruisers 2* **and** as a standalone
  one-design fleet — one boat's finish feeds another class's results plus
  its own. (In our model this is just multi-fleet membership within the one
  cruiser series: a Sigma 33 is in `C2-IRC`, `C2-ECHO` and `Sigma33-OD`.)
- **Mermaid/Glen:** one-design (Glens) + PY (combined) when Mermaid numbers
  are low.

**Prize exclusion** (NoR §9.2): a boat winning an IRC/VPRS prize is
ineligible for the ECHO prize in the same series; a one-design winner
(Beneteau 211/31.7) is ineligible for the ECHO prize. A class may opt out
before the season. This is the HYC IRC-vs-HPH exclusion pattern again — a
prize/presentation concern aware of results across systems, not a scoring
concern.

## Composite and Meta Series

### Women on the Water (WOW) — composite cross-class series (NoR §4.4)

A Tuesday-only parallel series in which boats from **four classes** (SB20,
Sportsboats, Flying Fifteen, Ruffian) **race together and are scored under
ECHO**, off the *same races* that also score each boat in its normal
Tuesday class. Eligibility: ≥ 50% female crew including a female helm.

- A boat's Tuesday races feed **two** series (its class + WOW) from one
  finish.
- **Conditional per-race participation:** if a WOW-entered boat lacks
  sufficient female crew for a race, it informs the RC and is scored
  **DNC in WOW only** — the normal Tuesday series is unaffected.

### RAYC Super League — series-of-series (SI A14)

A cross-club meta-league for Cruisers 0/1/2/4/5 and Beneteau 31.7, made of
**three sub-series** combining DBSC races with **external events**:

- Series 1: DBSC races 2 & 9 May + **HYC Lambay Race** 30 May.
- Series 2: the four Dun Laoghaire waterfront-club regattas.
- Series 3: DBSC coastal races 29 Aug & 12 Sep + DBSC race 19 Sep.

Scored: C0/1/2 under IRC, C4/5 under ECHO, Beneteau 31.7 one-design. For
external events, a boat's score is its **ranking place after excluding all
non-Super-League boats** (regattas: overall ranking similarly reduced). A
boat's overall Super League score is the **total of her ranking places**
across the three sub-series (A8.1 with "ranking place" for "race score").

This is the **series-of-series** concept IODAI deferred (national ranking)
— it needs importing external results, reducing them to entrants-only
rankings, and scoring a parent series off child-series placements.

> **Open question.** The RAYC Super League NoR (referenced, not yet
> available) holds the coastal-race details and any further specifics.

## Result Entry Workflow

Largely the HYC ashore-from-records pattern, with handicap correction:

1. Each class has its own start with a recorded start time, off one
   committee vessel per fleet group (Tuesday: one vessel, four starts;
   Thursday: Blue on Corinthian, Red on Freebird; Saturday: Blue/Red split
   across Hut + Corinthian, Green on Freebird).
2. That vessel's finishers are recorded as one sheet (sail number + finish
   time of day), mixing every class it started.
3. The scorer enters sail numbers + finish times; the system identifies
   each boat's class and the systems it is scored under.
4. Elapsed time = finish time − class start time.
5. Each applicable rating produces a corrected time; corrected times
   determine positions; positions determine points.
6. ECHO ratings are re-adjusted after each race, **per day-series**.
7. Results published to `www.dbsc.ie`; penalties given without a hearing
   are recorded in the published results (SI A17).

### Result codes and scoring specifics

- **Modified A5.3** (NoR §8, SI A13.2): a boat that did not come to the
  starting area is scored **(boats that came to the starting area) + 1**.
  This applies to Water Wags too — the published 2026 results confirm DNC =
  came + 1, identical to the keelboats (verified against the HalSail summary
  for races with no DNS, where came = finishers and DNC = finishers + 1).
- **DNS** (SI A8.4): not started within **10 minutes** of own starting
  signal → DNS without a hearing.
- **OCS** may be announced by VHF after the start (changes RRS 29.1); a
  general-recall restart procedure defers the recalled class to the end of
  the start sequence (changes 29.2).
- **20% Scoring Penalty** (RRS 44.3(c)) applied without a hearing for
  prohibited-area / shipping-interference breaches (SI A10–A11).
- **Sail-number change** requires 24 h notice via form (SI A16.2);
  indistinct/missing sail number may be scored DNC (A16.4).

## Series Scoring Rules (NoR §8, SI A13)

- **Race validity:** scored if not abandoned and 2+ boats come to the
  starting area with ≥ 1 finishing within the time limit (changes 90.3(a)).
- **Minimum series:** 3 races scored (SI A13.3). *(NoR §8.5 is silent on
  the floor — SI is authoritative.)*
- **Discards — sliding scale** (SI A13.4):

  | Races scored | Discards | Races scored | Discards |
  |--------------|----------|--------------|----------|
  | < 4 | 0 | 18–24 | 4 |
  | 4–6 | 1 | 25–31 | 5 |
  | 7–11 | 2 | 32+ | 6 |
  | 12–17 | 3 | | |

- **"Starred" races** (SI A13.5): a class may have 1–2 Saturdays excluded
  from the series score and prizes — a per-race, per-class exclusion flag.
- **Average points for duty** (SI A13.6): a boat scored DNC because its
  helm/key crew were required for RO or hut duty may request average points
  for the series (via Scoring Inquiry). A variable-points override — cf.
  HYC's Squib Inland conflict.
- **Scoring inquiries / redress:** within 7 days of publication
  (SI A13.7, A12.3).

## Competitor Data

| Attribute | Example | Notes |
|-----------|---------|-------|
| Sail number | IRL 1234 | Primary identifier; change needs 24 h notice |
| Boat name | — | Keelboats known by name |
| Class | Cruisers 2 | Assigned by Committee from rating band |
| Fleet (Sat) | Blue / Red / Green | Saturday one-design grouping |
| IRC TCC | 0.965 | Endorsed cert for C0/1/2 |
| ECHO number (×3) | 0.870 | Separate Tue / Thu / Sat values, progressive |
| VPRS / ORC / YTC / PY rating | — | Per system, per the boat's classes |
| Helm / Person in Charge | — | RRS 46; IS membership requirement |
| Crew age flag | ≤ 30 | Full crew ≤ 30 on 1 Apr → age prize |
| WOW eligibility | y/n | Tuesday SB20/Sportsboat/FF/Ruffian only |

A boat scored under any rating system must hold a valid current certificate
for it (NoR §3.5); ratings other than routine ECHO/PY updates must be
notified to the Honorary Secretary (SI A15.3).

**Mid-series re-rating happens** — a boat can lodge a new IRC certificate
part-way through the season, and HalSail then scores its earlier races on the
old TCC and later races on the new one (flagged with `*` in the published Hcap
column; observed on Chimaera, 1.008 → 1.001). The fixed-rating systems (IRC,
VPRS, YTC, PY) therefore can't be modelled as a single per-boat value.
*Added during M1:* per-race rating overrides let a boat keep its current rating
while earlier races pin the superseded value. The progressive system (ECHO)
doesn't need this — its rating varies per race by construction.

## Water Wags

- Wednesday evenings; up to **three divisions** assigned by the class.
- Some series may mix divisions (NoR §8.2).
- A5.3: DNC = (boats that came to the starting area) + 1 — the same as the
  keelboats, **not** entries + 2. An earlier reading of the NoR took the Water
  Wags as a distinct variant; the 2026 published results disprove it (see the
  scoring-specifics note above). No separate `dnfScoring` mode is needed.
- Usually one race, optional second at RO discretion.

## Feature Analysis (vs the current engine)

This section was originally framed as "additive to HYC". On inspecting the
engine (`lib/scoring.ts`, `lib/types.ts`), most of what DBSC needs is
**already built** — the dual-scoring machinery introduced for HYC turns out
to cover far more of DBSC than the use case first assumed. The honest split
is therefore "already supported" vs "genuinely new", not a fresh MVP list.

### Already supported (no new work)

- **Time-based finish entry, per-class starts** — `RaceStart` carries a
  `startTime` per group of fleets; elapsed = finish − the relevant start.
- **IRC (fixed TCC)** — `Fleet.scoringSystem='irc'`, `Competitor.ircTcc`.
- **ECHO (progressive)** — `scoringSystem='echo'`, alpha 0.25 club / 0.50
  regatta, per-race carried TCF, seed `echoStartingTcf`, explainability.
- **Scratch one-design** — `scoringSystem='scratch'`.
- **Multi-system / dual scoring, and the single-finish-sheet rule** — a
  competitor holds `fleetIds: string[]`, so one boat lives in several fleets
  (e.g. `C2-IRC` + `C2-ECHO`). The scorer enters one finish sheet once; each
  finish scores across all the competitor's fleets; unrecognised sail
  numbers resolve to `null` and are skipped. **This is exactly the entry
  ergonomics DBSC needs**, and it also covers Sigma 33's cross-class scoring
  and per-class splitting from a mixed sheet.
- **Per-day-series progressive ECHO** — falls out of each day-stream being
  a separate Series (see ECHO section); no special keying needed.
- **Sliding-scale discards** — `discardThresholds: {minRaces, discardCount}[]`
  is already a table; the DBSC ladder is pure configuration.
- **Modified A5.3 (DNC = starters + 1)** — `dnfScoring='startingAreaInclDnc'`
  scores DNC as `startingAreaCount + 1` too. *Added during M1:* the existing
  `startingArea` mode applied the starters-+1 value to came-but-didn't-finish
  codes only and left DNC on the A5.2 (entries + 1) value, which is **not**
  what DBSC's SI A13.2 specifies; the new mode extends it to DNC.
- **Redress (RDG)** — DBSC's published results carry RDG redress (per-fleet
  average). *Added during M1:* the engine now resolves the redress average in
  handicap (IRC/ECHO) fleets, not just scratch, and supports the RDG-type
  variants HalSail emits (average over all races / excluding DNC / races
  before the incident).

### Genuinely new (required before the relevant classes can be scored)

1. **VPRS** — new corrected-time system. Blocks Cruisers 4/5 and Mixed
   Sportsboats.
2. **ORC Club** — new; time-on-time with a per-race wind band chosen by the
   RC. Needed only if a C0–3 class requests ORC this season.
3. **YTC** — new; optional substitute for IRC/VPRS.
4. **Composite cross-class series (WOW)** — a *separate* series fed from the
   *same* finish sheet as the boats' class series. The multi-fleet trick is
   within one series; feeding a second series off one sheet would force
   double entry, which violates the entry rule. Needs a cross-series
   shared-finish feed.
5. **Two-vessel single series (Saturday non-Green)** — two finish sheets,
   one logical series. Either model as two series and merge for standings,
   or allow a series to take more than one finish sheet per race.

### Deferred / out of scope

- **RAYC Super League** — series-of-series importing external event results.
- **"Starred" race exclusion** (SI A13.5) — per-race, per-class exclude flag.
- **Average-points-for-duty override** (SI A13.6) — request-based score.
- **Prize-exclusion awareness** (NoR §9.2) — presentation-layer concern.
- Automatic class assignment from rating bands; visitor/age-prize admin.

## Data Model Implications

- **Series multiplicity.** A single club season produces *many* Series in
  the model — one per *(committee vessel × calendar block)*, e.g. Thursday
  Blue Series A, Thursday Red Series A, …, plus WOW and Water Wags — running
  concurrently for months. There is no single parent "event"; they are
  linked only by being the same club's season.
- **Series-scoped progressive ratings (already handled).** Because each
  day-stream is its own Series and ECHO is carried per-series, the same
  boat's Tuesday/Thursday/Saturday ECHO numbers evolve independently with no
  special keying. The data dependency is the *seed* `echoStartingTcf` per
  series, sourced from the 2025 end-of-season value.
- **Discard profile as a table (already handled).** `discardThresholds` is a
  step function of races scored; the DBSC ladder is configuration.
- **Within-series multi-fleet covers most "dual" cases (already handled).**
  `Competitor.fleetIds[]` lets one finish score under several systems and
  produce a one-design result too — IRC + ECHO for a cruiser, or Cruisers 2
  + Sigma 33 one-design for a Sigma. The single finish-sheet entry splits by
  registration automatically.
- **Cross-*series* feed is the real gap (WOW).** A boat's one Tuesday finish
  must feed its class series *and* the WOW series — two distinct series off
  one sheet. The multi-fleet trick is within a single series, so this needs
  a new shared-finish mechanism to avoid double entry.
- **Two finish sheets, one series (Saturday non-Green).** The model assumes
  one finish sheet per series; the Saturday Blue/Red split breaks that.
  Either merge two series for standings, or let a series accept multiple
  finish sheets per race.
- **The finish-sheet boundary is now concrete.** Per the Race Times doc,
  one committee vessel = one finish sheet = one Series. Thursday is clean
  (Blue = cruisers on Corinthian; Red = one-designs on Freebird); Saturday
  non-Green is the exception above.

## Comparison with HYC and IODAI

| Dimension | IODAI | HYC Autumn League | DBSC Summer Series |
|-----------|-------|-------------------|--------------------|
| Shape | One regatta | 6-Saturday league | Five-month season |
| Cadence | Consecutive days | Weekly (Sat) | 3 days/week, many series |
| Classes | 1 (Optimist) | 8 | ~20 |
| Rating systems | None | IRC, HPH, scratch | ECHO, IRC, ORC, VPRS, YTC, PY |
| Progressive handicap | No | Yes (one per boat) | Yes (per day-series per boat) |
| Season carry-over | No | Yes (Club Number) | Yes (prior-season ECHO) |
| Discards | Fixed | Fixed (0/1) | Sliding scale to 6 |
| Composite series | No | No | Yes (WOW) |
| Series-of-series | Deferred | No | Yes (RAYC Super League) |
| Cross-class scoring | No | No | Yes (Sigma 33) |
| Scorer | 1 | ~4 panel | Central (Hon. Sec.) |

## Open Questions

The series structure and finish-sheet boundaries are now settled from the
Race Times and Racing Programme docs. What remains:

- **ECHO match (the main replication risk).** Confirm DBSC's ECHO is the
  Irish Sailing 2022 progressive method the engine implements (alpha 0.25),
  including whether cruisers are pooled or scored per-class for the ECHO
  adjustment. To reproduce ECHO from race 1 we need each boat's **seed
  `echoStartingTcf`** (the 2025 end-of-season value). IRC has no such
  dependency — TCCs come from certificates.
- **VPRS / ORC Club / YTC.** Resolved from the catalog: **VPRS** is done (a
  static time-on-time rating; reconciled for C4/5 + Mixed Sportsboats — parity
  plan M3). **ORC Club and YTC have no fleet in DBSC's 2026 catalog** — no class
  opted in — so they are deferred, not 2026 blockers (parity plan M4).
- **Saturday two-vessel series** — confirm how DBSC/HalSail merges the
  Blue/Red split into one published series, to decide the model approach.
- **Still unseen, but only affecting deferred/course work:** SI Supplements
  B/C/D/G/H and the RAYC Super League NoR.
