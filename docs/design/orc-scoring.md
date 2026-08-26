# ORC Scoring

Primer and design for scoring under ORC (Offshore Racing Congress)
certificates. The driver is the HYC Autumn League 2026, where some offshore
classes will be scored under NHC, IRC, and ORC — with **Performance Curve
Scoring (PCS) over constructed courses** as the target method, repeating in
Sail Scoring what the 2025 experiment did in ORC Scorer
(`reference-docs:events/al-2025/ORC-experiment-report.pdf`).

Normative sources: `reference-docs:handicap-systems/orc/ORC-Rating-Systems-2026.pdf`
(rules 301–305 certificates, 401–403 scoring — cited below as bare rule
numbers), `ORC-Race-Management-Guide-2026.pdf`, `Scoring-Options-ORC.pdf`,
`PCS-Module-Specs.pdf`, and the public-domain PCS module source under
`reference-docs:handicap-systems/orc/pcs-module/`.

---

## Primer: how ORC differs from IRC

IRC assigns each boat one secret-formula TCC that blends its predicted
performance across all wind speeds and angles; fairness in any one race
depends on the race committee running a balanced mix of courses over a
series. ORC instead publishes the boat's predicted performance itself: a
certificate carries a matrix of **time allowances** (seconds per nautical
mile) computed by ORC's Velocity Prediction Program for true wind speeds of
4–24 knots and true wind angles from optimum beat through 52–150° to optimum
run. Scoring a race means choosing (or computing) the right mix of those
allowances for the course and conditions actually sailed, so every race gets
a race-specific handicap.

The 2025 Autumn League experiment showed this is not academic: on identical
finishes, IRC and ORC placings swung by 30–100 seconds in 35–85 minute races,
traceable to specific wind-angle/wind-speed performance differences the
single IRC number cannot express. It also showed the costs: per-leg course
data entry, and implied-wind sensitivity to mark-laying accuracy (a 50 m
error in laid-mark distance moved the implied wind ~3.6 kt, enough to change
results — and competitors record their own tracks).

## Primer: the certificate

- **Types**: ORC International (fully measured) and ORC Club
  (owner-declared/estimated data). One Design is a flag on either, not a
  separate type.
- **Families**: standard fully-crewed (`ORC`), Non-Spinnaker (`NS`),
  Double-Handed (`DH`). A DH or NS certificate may co-exist with the
  fully-crewed one (301.3–301.4), but a boat enters an event on exactly one
  (301.5) and is scored on it (301.6). This parallels IRC's spinnaker /
  non-spinnaker TCC pair, except each family is a whole separate certificate.
- **Issuing office**: the national rating office where the boat is *normally
  stationed or racing* (303.2) — not necessarily its flag. A certificate from
  any country is valid at any event; the central database exists for exactly
  this. (The AL 2025 assumption that a visiting boat needs an Irish
  certificate was wrong.)
- **Validity**: normally expires 31 December (some southern-hemisphere
  offices use 30 June); one valid certificate per boat per family, the
  last-issued wins (303.4–303.5); all boats in an event must be rated by the
  same VPP year (303.4).
- **Contents**: boat identity and hull/rig data; the time-allowance matrix
  (`Allowances`: wind speeds 4, 6, 8, 10, 12, 14, 16, 20, 24 kt × angles
  Beat/52/60/75/90/110/120/135/150/Run, with boat-specific optimum beat and
  gybe angles); pre-computed single numbers — All-Purpose ToD/ToT
  (`APHD`/`APHT`), Windward/Leeward ToD/ToT (`ILCWA`/`TMF_Inshore`),
  coastal/long-distance (`OSN`/`TMF_Offshore`), inshore and offshore triple
  numbers (low/medium/high wind), predominant upwind/downwind pairs; `CDL`
  and `GPH`; and **national scoring options** on page 2 — the Irish office
  publishes, among others, a five-band windward/leeward set
  (`IRL_5B_WL_{L,LM,M,MH,H}`) and predominant up/reach/down numbers. Which
  options exist is a per-country choice (403.4) and the NoR/SIs must name
  the one in use (401.1).

### The active-certificates database

Everything is served from `data.orc.org` with open CORS; country is the
top-level selector. Verified endpoints (all under
`https://data.orc.org/public/WPub.dll`):

| Query | Returns |
|---|---|
| no params | XML: per-country cert counts, VPP year, last update |
| `?action=DownRMS&CountryId=IRL&ext=json` | every active standard-family cert for a country |
| `…&Family=NS` / `…&Family=DH` | the non-spinnaker / double-handed families |
| `?action=DownBoatRMS&RefNo=…&ext=json` | one cert by reference number (first match only — fleet import must use `DownRMS`) |
| `?action=activecerts&CountryId=…` | XML index incl. the explicit `Expiry` date (absent from the JSON) |
| `/CC/{RefNo}` | printable full certificate page — the "view certificate" link |

The JSON payload carries a `ScoringOptions` catalog — `{Fieldname, Name,
Kind: TOD|TOT|PCS, CountryId}` for every rating field including the national
options — which lets the scoring-option picker be driven by data rather than
a hardcoded list. Gotchas: the JSON is served with a UTF-8 BOM, and expiry
must come from `activecerts` (or be defaulted from the VPP year).

## Primer: the scoring methods

Every ORC method is the product of two choices:

| | **Wind strength** | **Wind angle / course model** |
|---|---|---|
| simplest | single number (wind-averaged: 5/10/20/30/20/10/5% across 6–20 kt) | all-purpose (a hypothetical circular course) |
| | 3-band (triple number: low/medium/high) | windward/leeward (50% beat VMG + 50% run VMG) |
| | 5-band (e.g. the IRL national option) | predominant upwind / reaching / downwind |
| most accurate | PCS — wind *derived from finish times* | constructed course — per-leg distance, bearing, wind direction |

The corrected-time arithmetic is one of two forms (401.2: compute in seconds,
round to nearest whole second; 401.3: course length to 0.01 NM):

- **Time-on-time**: `CT = ToT × ET`, with `ToT = 600 / ToD`. Same direction
  as an IRC TCC (faster boat → higher number), so the app's existing
  correction primitive applies unchanged. Scoring with `APHT` is
  operationally identical to IRC.
- **Time-on-distance** (403.2): `CT = ET − (ToD_boat − ToD_scratch) ×
  distance`, where the scratch boat is the fleet's fastest (lowest ToD). The
  scratch-boat normalization never changes finishing order — it only anchors
  the winner's corrected time near their elapsed time for presentation.

Band methods just pick which pre-computed number to read: the race committee
records the wind band that best reflects the race average (the DBSC SIs have
the RC announce it by VHF and reserve the right to change it — the reason
band selection must be per-race and mutable, not series config).

### PCS and constructed courses

PCS (402) replaces the recorded wind with a wind *implied by the race
itself*:

1. For each boat, build a **performance curve**: predicted seconds-per-mile
   over the course as a function of true wind speed. For the pre-defined
   course models (windward/leeward, all-purpose, coastal) the curve rows are
   on the certificate; for a **constructed course** (402.5–402.6) they are
   computed from per-leg `{distance, bearing, wind direction}` (legs may be
   split into sub-legs on a wind shift; optional per-leg current).
2. Each boat's achieved `ET / distance` (s/NM) is looked up on its own curve
   by inverse interpolation, yielding that boat's **implied wind** — "the
   boat sailed as if the wind were X knots" (402.8, clamped to 4–24 kt).
   The faster a boat sailed relative to its predictions, the higher its
   implied wind.
3. The winner is the boat with the highest implied wind. That value becomes
   the race's **scoring wind** (402.9): each boat's time allowance at the
   scoring wind is read off its curve and applied as a ToD coefficient,
   producing corrected times for the rest of the fleet.

The race committee may override the scoring wind when the implied value
doesn't fairly represent the conditions (402.12). Re-scoring after a
winner's disqualification recomputes the scoring wind from the new best boat
(402.11). Rule 402.10 offers an alternative regime — rank boats directly by
their own implied wind, each corrected against its own curve — which is NoR
material and deferred here (see Out of scope).

**Terminology.** The 2026 rulebook says "Scoring Wind" for both the
per-boat value (402.8) and the race-level value (402.9); ORC Scorer's UI and
results say "Implied Wind" for the per-boat value. The app uses each term
for exactly one thing: **implied wind** = the per-boat quantity from step 2;
**scoring wind** = the race-level wind actually used to correct times (the
winner's implied wind, or the RC override). The glossary records both.

**The algorithm is fully published.** Rule 402.13 points to ORC's PCS
module, which ORC provides "to the public domain" with Delphi source
(captured at `reference-docs:handicap-systems/orc/pcs-module/`, spec in
`PCS-Module-Specs.pdf`, both revised May 2026). The mechanics: per-leg TWA =
wind direction − leg bearing; legs inside the optimum beat/gybe angles take
the Beat/Run VMG allowance projected by `cos(TWA)`; other angles come from
Lagrange interpolation over the polar (in velocity space) between the
tabulated angles; per-leg allowances are corrected for current, then
distance-weighted into the course curve at each of the nine wind speeds;
implied wind is found by cubic-spline inverse interpolation (with a
monotonicity check) across those nine points. ORC also runs the same module
as a free web service (`WPCS.dll`, POST XML) and ships a test app with
example race files — both useful as validation oracles for a native port.

---

## Design

### The two-tier model

Nearly every ORC method reduces to *"per race, pick a number off the
certificate; apply it ToT or ToD"*. Only PCS computes a number instead of
reading one. So:

- **Tier 1 — certificate-field scoring.** A scoring option names a rating
  field from the cert's own `ScoringOptions` catalog (e.g. "IRL 5-band W/L
  ToT", or plain `APHT`). Single-number options need no per-race input
  beyond what ToD already needs (distance); band options add one per-race
  choice — the band. This covers APH, W/L, triple-number, 5-band, and
  predominant options uniformly, including national options we've never
  heard of, because the catalog is data.
- **Tier 2 — PCS.** A native TypeScript port of the public-domain module:
  course curve construction (pre-defined W/L, all-purpose, and coastal
  models first; constructed courses from leg data), implied wind, scoring
  wind, corrected times. Validated against the module's own test fixtures,
  the `WPCS.dll` service, and the AL 2025 published results (which include
  per-race ToD and implied-wind columns for Class 2). Owning the
  implementation is what makes the transparency goal achievable — neither
  Sailwave nor HalSail supports PCS or constructed courses at all.

**The option resolves per fleet per race** (#440). The fleet's ORC config
is only the *default* option; each race start may name the option its races
are scored under, from either tier — it is entirely normal for one fleet to
score its windward/leeward days on curves, a coastal race on
time-on-distance, and a race under an announced band. The start's option
decides the whole method (there is no same-kind restriction — choosing the
option *is* choosing the method), the engine resolves ratings and the
scratch allowance per race, and the published audit header names the option
on every race. A boat whose certificate lacks the chosen field goes
unscored in that race only; series-level ratability follows the default.

### Certificates: import and storage

- Store the **raw per-boat JSON record verbatim** in a `jsonb` on the
  competitor (the `nhcProfile` precedent), plus extracted scalars for
  display and sorting: `RefNo`, family, cert type, issue date, expiry, and
  `CDL`/`GPH`/`APH` (the fleet-splitting sort keys — CDL is ORC's analogue
  of sorting an entry list by IRC TCC). Scoring reads whatever field or
  matrix it needs from the stored document; we never model the whole cert.
- Import is a new source in the update-handicaps wizard: country (default
  from the existing sail-country default) → family, chosen per fleet the way
  the IRC spinnaker/non-spinnaker variant is → server-side cached
  `DownRMS` fetch → `RatingMatcher` on sail number / boat name → store the
  record. Warn on: expired certificate, mixed VPP years within a fleet, and
  a newer issue date for an already-imported `RefNo`.
- The certificate JSON stays **out of the public export and the series
  file's competitor CSV round-trip surface area** is limited to the applied
  scalars; published results carry the per-race applied numbers in the
  explainability block, not the certificate.

### Race inputs

- `Fleet.scoringSystem` gains `'orc'`, with an `orcProfile` config block:
  scoring option (Tier 1 field family or PCS + course model), ToT vs ToD as
  the option dictates.
- **`RaceStart` carries the course**: `distanceNm` for ToD and the
  pre-defined PCS models, and `courseLegs` (`{distanceNm, bearingDeg,
  windDirectionDeg, current?}` per leg) for constructed courses — when legs
  are present the distance is their sum. A start is already the app's only
  per-race, per-fleet-group entity and is edited on the finish page beside
  the gun time; fleets sharing a gun but sailing different courses split
  into two same-time starts.
- The wind band (Tier 1) and the scoring-wind override (402.12) are
  per-race entries alongside the existing `RaceConditions` wind range, whose
  `averageWindSpeed()` was built to seed exactly this.

### Engine and transparency

- A time-on-distance correction path joins the time-on-time one in
  `lib/scoring.ts`, and `HandicapRaceScore` gains an `orc` explainability
  block (the `nhc`/`echo` pattern): applied field or computed allowance,
  distance, implied wind per boat, scoring wind and its source (winner /
  RC override).
- Published results must make PCS auditable — the AL 2025 report's
  race-management lesson is that implied wind confuses competitors and
  inaccurate course data invites protests. Results pages show the course
  legs, each boat's implied wind, the scoring wind, and each boat's
  allowance at the scoring wind, so a competitor can reproduce their
  corrected time from their own certificate.
- Course capture grows in layers: v1 is the leg array (ORC's own input
  shape); later a workspace course library (fixed marks + course cards
  generating legs from a course number plus start/windward/finish
  positions — the `markmate` prototype's model) and a course visualization
  on published pages. Record the richest form available; always derive the
  leg array from it.

### Gating

A new `orc` feature key, default off (the VPRS precedent: new system, not
yet validated against a full season). The `race-management-metadata` gate's
standing note applies: wind becomes a scoring input under ORC, so that gate
is split or defaulted on when ORC lands.

## Milestones

Implementation detail lives in the milestone issues (#429 is the umbrella);
the order is built backwards from the Autumn League calendar (entries ~end
of August, first gun ~12 September 2026), so PCS comes before the band
methods:

1. **Certificates** (#431, ~31 Aug) — import, storage, expiry/VPP
   validation, CDL/GPH/APH columns; `'orc'` fleet system scoring `APHT`
   time-on-time (the IRC-equivalent path, end-to-end plumbing).
2. **Time-on-distance** (#432, ~4 Sept) — the engine path,
   `RaceStart.distanceNm`, finish page entry; single-number ToD options.
3. **PCS** (#433, ~4 Sept; starts immediately, in parallel) — native module
   port with pre-defined course models, implied wind, scoring wind, RC
   override. Built as a hermetic module — own directory, own README, its
   own parity fixtures, no imports from the rest of `lib/` — and **spun out
   to a standalone repo under the `sailscoring` org once the parity suite
   is green and the API has survived integration** (the archive-kit
   pattern): standalone validation mirrors ORC's own module-shaped
   ecosystem and is the credibility artifact for ORC and other tools.
4. **Constructed courses** (#434, first gun) — per-leg entry on the start,
   curve construction from legs, sub-legs and current; gated by the dry
   run: reproduce the full AL 2025 Class 2 series and match ORC Scorer's
   published results.
5. **Published transparency** (#435, iterating weekly from race 1) — the
   PCS audit trail on published pages, help chapter, feature-checklist
   tail.
6. **Band methods** (#436, post-league) — per-race band selection over the
   `ScoringOptions` catalog (triple-number, IRL 5-band, predominant).
7. **Course library** (#437, kickoff any time; designer product
   post-league) — a standalone, format-first repo under the org: a
   versioned marks / course-cards / race-infrastructure format maturing
   the `markmate` model, a leg-computation + rendering library consumed by
   the app (course-number lookup filling a start's legs, published course
   rendering), and later a club-facing course-card designer. Raw leg entry
   (milestone 4) remains the interchange floor either way.

Milestones 1–4 are the Autumn League critical path; shadow-scoring
alongside ORC Scorer mid-series is the fallback if 3–4 land late, and
windward/leeward races can be scored on the pre-defined model from
milestone 3 alone if 4 slips.

## Out of scope (deferred)

- **Per-boat implied-wind scoring (402.10)** — a NoR-declared alternative
  regime; later phase.
- **Weather Routing Scoring (WRS)** — per-race routing simulations bought
  from ORC; not club racing.
- **Custom ToD/ToT coefficients** (manually entered per boat) and custom
  wind-distribution matrices (Cove Island-style national course models
  beyond what certificates carry).
- **Olympic triangle / non-spinnaker course models** — documented by ORC but
  not exposed by any comparable tool.
- **Pursuit-start calculators** from the Race Management Guide.
