# Handicap Scoring

Design and implementation record for time-based handicap scoring. Phase 1
(static TCF — IRC and PY) is complete. The first pass of Phase 2 (NHC1 —
Sailwave's built-in progressive handicap) is complete, including the
rating-calculation explainability view. ECHO is the next progressive system
to implement; its design is recorded below against the Irish Sailing 2022
*ECHO Guide for Clubs* as the canonical reference. RYA NHC 2015, SWNHC2015,
and scoring-inquiry exclusions remain deferred. Covers mathematics,
architecture, and implementation status.

---

## The core idea

All handicap systems in Phase 1 and 2 use **time-on-time corrected time scoring**:

```
Elapsed Time (ET)   = Finish Time − Gun Time
Corrected Time (CT) = Elapsed Time × TCF
```

where **TCF** (Time Correction Factor) is a dimensionless number specific to each
boat. Lowest corrected time wins. The ranking logic is otherwise the same as
scratch: places map to points 1, 2, 3..., penalty codes apply identically,
discards and tie-breaking work as before.

---

## Phase 1: Static TCF scoring — IRC and PY ✓ Implemented

> **Status:** Complete. Implemented in issue #61 (commit `9e9eba0` and
> subsequent polish commits). All data model changes, scoring engine,
> finish sheet model, start time entry, multi-fleet competitors, rating
> field editing, fleet scoring system settings, handicap standings
> display, and series file format changes are in production. YAML scoring
> fixtures cover IRC basic, PY basic, handicap DNF, missing rating
> rejection, and corrected-time tie-breaking (`tests/fixtures/scoring/tcc-handicap/`).

### IRC

IRC (International Rating Certificate) assigns each boat a **TCC** (Time Correction
Coefficient) issued annually by the IRC Rating Authority (RORC/UNCL). The TCC is
used directly as the TCF:

```
CT = ET × TCC
```

TCC typically ranges 0.85–1.10 for club offshore boats. A higher TCC means a
faster-rated boat: if two boats sail at exactly their rated performance, their
corrected times are equal. Example:

| Boat | TCC  | ET (s) | CT (s) |
|------|------|--------|--------|
| A    | 1.05 | 3,600  | 3,780  |
| B    | 0.88 | 4,318  | 3,800  |

Boat A wins by 20 corrected seconds despite finishing 718 seconds earlier on the water.

### PY (Portsmouth Yardstick) / RYA

Each **boat type** (not individual boat) has a PY number published by the RYA
(e.g. Laser Standard = 1100, RS400 = 940). Clubs may apply local adjustments. The
PY number is an integer (typically 800–1200). TCF is derived as:

```
TCF = 1000 / PY
CT  = ET × (1000 / PY)
```

A lower PY number = faster boat type = higher TCF.

| Boat type   | PY   | TCF   | ET (min) | CT (min) |
|-------------|------|-------|----------|----------|
| RS400       |  940 | 1.064 |    60.0  |   63.8   |
| Laser Std   | 1100 | 0.909 |    70.3  |   63.9   |

**Relationship to IRC:** IRC TCC and PY TCF are mathematically identical — both
are a single multiplier applied to elapsed time. The scoring engine uses one
`tcf: number` abstraction for both. The distinction is how it is stored
(raw decimal for IRC; derived from PY integer for PY) and how it is presented
to the scorer.

---

## Phase 2: Progressive handicaps — NHC and ECHO

> **Status:** First pass complete. NHC1 (Sailwave built-in; α = 0.15,
> symmetric, no realignment) is implemented and in production, with
> rating-calculation explainability and persistence of per-race TCF
> snapshots. Implemented in commit `db39652` ("Add NHC1 progressive
> handicap scoring"), with follow-ups `41cdf29` (viewer toggle) and
> `a7d452a` (unified fixture rendering). **ECHO is designed and
> next in line for implementation** — see the ECHO section below;
> the IS 2022 worked example is the verification fixture. Deferred:
> RYA NHC 2015, SWNHC2015, scoring-inquiry rating adjustments, and
> the series-level Rating-history page.

### NHC (National Handicap for Cruisers)

NHC is the standard progressive time-on-time handicap system for cruisers in
Ireland and the UK. Each boat starts with an initial TCF, which is adjusted
after every race based on performance relative to the fleet average.

Three distinct implementations exist in the wild:

- **NHC1** — Sailwave's built-in algorithm. Symmetric `α = 0.15`, fleet-mean
  target, no explicit realignment (the formulation conserves fleet mean by
  construction). Covered in detail below; this is the variant we implement first.
- **RYA NHC 2015 (HalSail)** — the RYA's published spec, as documented in
  HalSail's FAQ. Symmetric `α = 0.3`, extreme-performer cap at ±1 SD of
  corrected time, realignment anchored to RYA-published base numbers `H0`
  (not to the prior fleet mean). Documented below for reference.
- **SWNHC2015** — external Sailwave spreadsheet (`SWNHC*.xls`) used as a
  standalone calculator by some clubs. Asymmetric rates, SD-based outlier
  dampening via a reduced α, realignment anchored to the prior fleet mean.
  Documented below for reference only.

> **HPH (Howth Performance Handicap)** is HYC's local label for its NHC-based
> progressive handicap; mechanically it is NHC1 with the default parameters.
> The codebase will not carry any HPH-specific concept: HYC scorers configure
> a fleet with `scoringSystem: 'nhc'` and the default parameters, and the
> resulting handicap is what HYC calls HPH. Other clubs' NHC variants are
> reached by the same scoring system with different parameters.

#### NHC1 — Sailwave built-in ✓ Implemented

> **Status:** Complete. Scoring engine extended in `lib/scoring.ts`;
> persistence of per-race TCF snapshots in `NhcTcfRecord`
> (`lib/nhc-persistence.ts`, Dexie table `nhcTcfHistory`); series file
> format and public JSON export both carry the TCF history. Per-fleet
> `nhcAlpha` and per-competitor `nhcStartingTcf` editable from the
> competitors and fleets settings pages. Four YAML fixtures in
> `tests/fixtures/scoring/nhc/` cover single-race blend, non-finisher
> carry-forward, missing-starting-TCF rejection, and multi-race
> propagation. Retroactive edits to earlier races propagate forward to
> later races' TCFs automatically (no explicit commit step).

The algorithm has been confirmed by reverse-engineering the 2025 Puppeteer 22
Championships data (`reference/data/nhc-example/`), where actual per-race TCFs
and finish times are preserved in full.

**NHC1 algorithm (confirmed Adjust = 0.15, symmetric):**

```
H_i  = elapsed time in decimal minutes
O_i  = 100 / H_i                     # raw performance index
O_avg = mean(O_i) over NHC finishers
P50  = mean(TCF_i) / O_avg            # scale: converts O-units to TCF-units
Q_i  = O_i × P50                     # "fair TCF" — the TCF that would have given
                                      # boat i exactly the fleet-mean corrected time
new_TCF_i = TCF_i + 0.15 × (Q_i − TCF_i)   for finishers
new_TCF_i = TCF_i                            for non-finishers (OCS/DNF/DNC/etc.)
```

`Q_i` is algebraically equivalent to `fair_TCF_i = TCF_i × (CT_avg / CT_i)`. The
P50 formulation is numerically cleaner to implement and matches Sailwave's internal
calculation directly.

The adjustment is **symmetric** — the same 15% rate applies whether a boat
over-performed or under-performed. This differs from the SWNHC2015 spreadsheet
(AdjustP=0.30/AdjustN=0.15); see below.

**Re-alignment is a no-op in NHC1.** Because P50 is constructed from the fleet mean,
`Q_avg = TCF_avg` exactly. The average new TCF equals the average old TCF after every
race, so a re-alignment scale factor is always 1.0. No extra step is needed.

Round `new_TCF_i` to 3 decimal places — this is the boat's handicap for race N+1.

The critical implication: **the TCF applied in race N must be snapshotted**, because
the stored TCF will change after race N is scored. In Sailwave this is the `rrat` field
per result record (distinct from `comprating`, the master stored TCF). Both must be
persisted: `comprating` for the current master handicap, `rrat` (= `tcfApplied`) for
the audit trail of what was actually used in each race. The two can diverge when a
prior update is pending — see "Race rating vs master rating" below.

Sailwave's `scrratingsystem = 'NHC1'` activates the built-in; corrected times and
per-race TCFs are computed inside Sailwave and published in results. The scorer
updates each boat's master rating before each race; Sailwave does not write updated
ratings back automatically (`scrupdateratings = 'No'`).

Key properties confirmed from the Puppeteer 22 Championships data:
- **Symmetric Adjust = 0.15** (same rate up and down)
- **Re-alignment is a no-op** (fleet mean conserved by construction)
- **Non-finishers keep their TCF unchanged**
- **`rrat` per result** = TCF applied that race (= `tcfApplied` snapshot)
- **`comprating`** = master stored TCF; may differ from `rrat` when a prior update
  is pending from an earlier event

**Race rating vs master rating:** The gap between `comprating` and race 1 `rrat` in
the Championships data (up to ±0.025 for some boats) reflects ratings that were
updated in a prior event whose master rating had not yet been written back. Both
values must be persisted: the master TCF (what shows in the standings header) and
the race-specific TCF (what was used to compute that race's corrected times).

**Rating storage convention:** Sailwave stores TCFs as raw 3-decimal values (e.g.
`1.319`). The Puppeteer 22 fleet has ratings in the 1.14–1.45 range — all above
1.0 — because the fleet's historical baseline was calibrated against a slow reference
boat. The absolute scale does not affect the algorithm; only relative values within
the fleet matter. Our implementation should store raw TCF and document the convention
clearly.

#### RYA NHC 2015 (HalSail) — reference spec

HalSail's public FAQ describes the RYA scheme as introduced in 2013 and revised
in May 2015. The variable naming differs from ours (the FAQ uses `H0/H1/H2/Hp/Ha`
rather than `TCF/Q/new_TCF`), but the per-boat "fair handicap" formulation is
algebraically identical to NHC1's:

```
Ha_i = ΣH1 / (Te_i × Σ(1/Te))      # = our Q_i = TCF × CT_avg / CT_i
```

Three properties distinguish it from NHC1:

**1. Symmetric `α = 0.3`.** Twice NHC1's blend rate. Handicaps move further per
race, so the system converges faster but is noisier.

```
Hp_i = (1 − α) H1_i + α · Ha_i     # non-extreme performers
```

**2. Extreme-performer cap.** A boat is an "extreme performer" if its corrected
time is more than one standard deviation from the fleet mean:

```
fast extreme:  Tc_i < μ_tc − σ_tc
slow extreme:  Tc_i > μ_tc + σ_tc
```

For extreme performers, the formula substitutes a threshold elapsed time `Tt`
(the elapsed time that *would have* put the boat right at the ±1 SD boundary)
in place of the boat's actual `Te_i`:

```
Tt_i = (μ_tc ∓ σ_tc) / H1_i
Hp_i = (1 − α) H1_i + α · (ΣH1 / (Tt_i × Σ(1/Te)))
```

The motivation is stated directly in the FAQ: a boat that suffered gear failure
shouldn't get a huge handicap reduction, and a boat that finished just before
the wind died shouldn't get a huge handicap increase. This is a different
outlier strategy from SWNHC2015 (which reduces `α` for outliers); HalSail keeps
the same `α` but clamps the input.

**3. Realignment to base numbers.** This is the biggest conceptual difference
from NHC1. Each boat has an RYA-published **base handicap `H0`**, derived from
length/beam/weight/sail-area measurements. After each race, the fleet is
realigned so the sum of current handicaps equals the sum of base handicaps:

```
H2_i = Hp_i × (ΣH0 / ΣHp)           # rounded to 3 decimal places
```

This preserves the *relative* positions produced by the blend step but anchors
the *absolute* scale to the published baseline. NHC1 has no equivalent — it
conserves the fleet's own current mean, which can drift arbitrarily far from
any external reference over a long series.

**DNC realignment:** realignment applies to *all* boats, including those that
did not race. A DNC boat's handicap can still change from race to race as the
fleet scales. The only exception is a boat that has never started any race in
the series yet — those are not realigned until their first non-DNC result.

**New boat entering a series:** starts on its base number `H0`.

**Implementation implication:** supporting RYA NHC 2015 requires a
`baseHandicap` (`H0`) field per competitor, distinct from the current TCF. See
"Unified algorithm and parameterisation" below for how `H0` fits into the
overall data model and what a safe default looks like when a scorer doesn't
supply a value.

#### SWNHC2015 — external spreadsheet variant (reference only)

Some clubs use the Sailwave NHC spreadsheet (`SWNHC*.xls`) as an external calculator
rather than Sailwave's built-in NHC1. This variant is more complex:

**Asymmetric adjustment rates:**
```
new_TCF_i = AdjustP × Q_i + (1 − AdjustP) × TCF_i   if Q_i > TCF_i  (over-performed)
          = AdjustN × Q_i + (1 − AdjustN) × TCF_i   if Q_i ≤ TCF_i  (under-performed)
```
Default parameters: `AdjustP = 0.3`, `AdjustN = 0.15`. A boat that over-performed
gets its handicap raised faster than an under-performer's gets lowered.

**SD-based outlier dampening** (added in the 2014 club version):
Boats whose comparative score `Q_i / TCF_i` lies more than 1.5 SD above or 1.0 SD
below the fleet mean receive a smaller adjustment (`AdjustPX = 0.15`,
`AdjustNX = 0.075`) to avoid overreacting to a single exceptional result.

**Re-alignment** (applies in the spreadsheet because the asymmetric rates break
fleet-mean conservation):
```
re_aligned_i = new_TCF_i × (avg_old_TCF / avg_new_TCF)
```
Applied only when `finishers ≥ 3`.

HYC does not use this variant. It is documented here for completeness and in case
a future club supported by this application uses the SWNHC spreadsheet workflow.
See `docs/notes/sailwave-excel-handicap-protocol.md` for the full spreadsheet
analysis.

### ECHO

> **Canonical reference:** Irish Sailing's *ECHO Guide for Clubs*
> (2022, Liam Lynch / Ratings & Handicapping Steering Group). The
> 10-boat worked example on page 2 of that guide is the verification
> fixture for this implementation: every formula, default value, and
> column display below is chosen to reproduce that table exactly. The
> guide is treated as authoritative; the other ECHO sources we have
> consulted (see "Other widely-used implementations" below) are
> referenced as cross-checks only.

ECHO is the Irish national progressive performance handicap system,
in widespread use at clubs and on the cruiser-regatta circuit. Each
boat carries a handicap that is adjusted after each race based on the
boat's **performance index** — a number that captures how the boat's
elapsed time compared to the fleet's overall pace.

#### Performance index

For each finisher in a race:

```
PI_i = ΣH_S / (T_E_i × Σ(1/T_E))
```

Where:

- `H_S` — each finisher's **starting handicap** for this race, i.e.
  the handicap they were allocated before the race began.
- `T_E_i` — the **elapsed time** of the boat (finish time − gun
  time), in seconds.
- `Σ(1/T_E)` — the sum of reciprocals of elapsed times, across all
  finishers.
- `ΣH_S` — the sum of starting handicaps, across all finishers.
- The sums run over **finishers only**: boats that did not finish
  do not contribute, and have no PI.

PI is the answer to: "what starting handicap would have made this
boat exactly average across the fleet, by corrected time?" If every
boat had been given its own PI as a starting handicap, every boat
would have tied for first place.

#### Updating the handicap

The new handicap is a weighted blend of the starting handicap and
the performance index:

```
new_H_i = (1 − α) × H_i + α × PI_i
```

`α` is the **adjustment rate**, configured per series. The IS guide
recommends two splits:

| Split | α    | Recommended for |
|-------|------|-----------------|
| 75/25 | 0.25 | Club racing (default) |
| 50/50 | 0.50 | Regattas and major events |

Other splits are seen in practice (HalSail records α = 0.6 for the
2017 Volvo Dun Laoghaire Regatta; DBSC ran 68/32 for many years
before reverting to 75/25). The implementation exposes α as a
per-fleet configuration value with the IS-recommended splits as
named presets.

Boats that did not finish (DNF, DNS, DNC, etc.) carry their starting
handicap unchanged into the next race: `new_H_i = H_i`. They do not
contribute to ΣH_S or Σ(1/T_E), so their absence does not affect
other boats' PI.

The IS guide stipulates: **handicaps shall not be adjusted after a
race in which two or fewer boats finish.** The implementation must
enforce this gate.

#### Worked example (IS 2022 Guide, page 2)

The IS guide presents a 10-boat worked example with α = 0.25.
Reproduced here as the canonical verification target. Our
implementation reproduces every value *from the formula*; the IS
table itself has a small typo on row 6 (and minor presentation
glitches on rows 3 and 9 — see notes below).

| Boat | T_E | 1/T_E    | Starting H | PI    | New H |
|------|-----|----------|------------|-------|-------|
| 1    | 60  | 0.01666  | 1.001      | 1.026 | 1.007 |
| 2    | 61  | 0.01639  | 1.015      | 1.009 | 1.013 |
| 3    | 66  | 0.01515  | 1.020      | 0.937 | 0.999 |
| 4    | 59  | 0.01695  | 1.020      | 1.043 | 1.026 |
| 5    | 56  | 0.01786  | 1.115      | 1.099 | 1.111 |
| 6 †  | 70  | 0.01429  | 1.000      | 0.879 | 0.952 |
| 7    | 56  | 0.01786  | 1.020      | 1.099 | 1.040 |
| 8    | 59  | 0.01695  | 1.010      | 1.043 | 1.018 |
| 9    | 61  | 0.01639  | 1.005      | 1.006 | 1.005 |
| 10   | 57  | 0.01754  | 1.015      | 1.079 | 1.031 |
| **Σ** |     | **0.16604** | **10.221** |       |       |

Boat 1 worked through:

```
PI_1   = ΣH_S / (T_E × Σ(1/T_E))
       = 10.221 / (60 × 0.16604)
       = 10.221 / 9.9624
       ≈ 1.026

new_H_1 = (1 − 0.25) × 1.001 + 0.25 × 1.026
        = 0.75075 + 0.25650
        ≈ 1.007
```

> **† Row 6 typo.** The IS table prints New H = 0.952 for Boat 6, but
> the formula `0.75 × 1.000 + 0.25 × 0.879 = 0.96975` gives **0.970**.
> The PI column value (0.879) is correct — only the New H entry is
> wrong. Our engine matches the formula and emits 0.970 (rounded to
> 3 dp). Two further presentation glitches in the IS table: row 3
> prints PI = 0.937 where the formula gives 0.933, and row 9 prints
> PI = 1.006 where the formula gives 1.009 (Boat 9 must equal Boat 2
> at PI = 1.009 since both have T_E = 61). The implementation
> reproduces the formula in every row; the canonical scoring fixture
> at `tests/fixtures/scoring/echo/01-is-2022-worked-example.yaml`
> records the formula-correct values.

#### Opening handicaps

The first race in a series needs a starting handicap for each boat.
Three sources are recognised:

1. **Carry-over** from the final race of a previous series — the
   common case for established fleets.
2. **Standard ECHO** — a baseline number issued on the boat's IS
   ECHO certificate, used when the boat has no prior performance
   history in the fleet (new entrants, regatta first-timers, or
   crews who recently switched boats).
3. **Manual** — the scorer sets a number based on local knowledge
   of the boat.

The implementation surfaces a per-competitor starting-handicap
field and leaves the choice to the scorer. The IS guide recommends
basing opening handicaps on "known performance whenever possible
and not Standard ECHO ratings" for club racing.

#### Scoring-inquiry exclusions

Two kinds of mid-series exclusion are contemplated by the IS guide
and the sample sailing instructions:

- **Exclude one boat from one race's update.** *"Such boat's
  handicap shall remain unchanged for the next race. Such exclusion
  shall only apply to unexpected poor performance."* The boat still
  appears in the race results with its corrected time and points;
  the exclusion is from the handicap-update calculation, not from
  the scoring.
- **Exclude a whole race from the update.** *"All boats shall start
  the next race with unchanged handicaps."* Used when the fleet's
  spread on the day was not representative — a tidal-gate race that
  rewarded early finishers, a wind hole that trapped late finishers.
  Race results stand; handicaps do not advance.

Both forms are handled by the existing scoring-inquiry exclusion
data model (see "Scoring-inquiry adjustments" below); no
ECHO-specific extension required.

#### Other widely-used implementations

Three other documented implementations of progressive ECHO. None is
treated as the canonical reference; all are useful for cross-
checking that our outputs match practice in the field.

- **ICRA ECHO Handicap Policy** — `cruiserracing.ie/technical/icra-
  echo-handicap-policy`. Date not given on the page; currency is
  uncertain. States verbatim:
  > "Handicaps are adjusted automatically after each race using a
  > progressive handicap system with a 75/25 split (New handicap is
  > 75% of previous handicap plus 25% of performance index)."
  Confirms the IS-recommended default for ICRA-licensed events; we
  do not rely on this page for any conflict with the IS guide.
- **HalSail FAQ** — Peter Hopford, "2017 version" of the algorithm.
  Describes the same formula in different notation:
  ```
  Ha = ΣH1 / (T_e × Σ(1/T_e))
  H2 = (1 − α) × H1 + α × Ha
  ```
  Records α = 0.25 for the O'Leary Winter League and α = 0.6 for
  the 2017 Volvo Dun Laoghaire Regatta. Cited because HalSail is in
  active use across Irish clubs and the FAQ is the most accessible
  plain-language description of the algorithm we have found.
- **SWECHO.xls** — the Sailwave external ECHO spreadsheet, version
  2018-01-02-0. Phrases the same algorithm in winner-relative terms
  (`BCR_i = CT_winner / T_E_i`, then rescaled by an `EchoIndex`
  factor); algebraically equivalent to the IS Performance Index
  formulation but more roundabout. Reverse-engineered during
  research; not used as a reference for the implementation.

#### The formal ECHO Rules document

Irish Sailing also publishes a formal *ECHO Rules* document (Mark
Blaakman; Word source last regenerated June 2025). It governs the
**certification and administration** of the system: Standard TCF
issuance per certificate (Rule 6); Initial / Provisional TCF status
for new and recently-rated boats (Rules 7, 8); season-start Block
Adjustment of an entire class (Appendix E); hard limits of −7.5% /
+12% on Current TCF vs Standard TCF (Rules 6.6, 8.3); licensing of
clubs and classes to operate ECHO (Rule 4). These provisions remain
operative practice and are not contradicted by the IS 2022 guide.

The Rules document's **Appendix F** describes a different per-race
algorithm — a Performance Ratio computation with a ±7.5% extreme-
performer clamp and a Ratio Y re-normalisation. **No current ECHO
implementation in the field runs Appendix F.** HalSail, Sailwave,
Sail100, and the IS 2022 guide all describe and run the simple PI
blend instead. Appendix F is a vestige of a pre-pECHO end-of-season
Committee revision process and we do not implement it.

Two tells confirm Appendix F is not the operational algorithm:
Rule 9.2 references Appendices F **and G** for in-season revisions
but Appendix G is missing from the published Rules PDF; and the IS
2022 guide explicitly narrates the historical move from
Committee-administered batch revisions to per-race progressive
ECHO ("the advent of personal computers… allowed club handicap
committees to adjust ECHO handicaps on a regular basis… the
ultimate outcome is the development of progressive ECHO").

#### Out of scope (first ECHO pass): certificate-layer features

Three features from the formal Rules apply to ECHO in production
but are not part of the per-race algorithm. Out of scope for the
first pass; flagged here so they are not forgotten:

- **Standard TCF per boat** (Rule 6) — the IS-issued certificate
  rating that anchors hard limits and Block Adjustments. Could be
  carried as a per-competitor field alongside the current handicap.
- **Hard limits on Current TCF** (Rules 6.6, 8.3) — Current TCF
  must be no higher than Standard TCF × 1.12 and no lower than
  × 0.925. A post-blend clamp on `new_H`.
- **Block Adjustment** (Appendix E) — a scorer-triggered
  season-start action that scales every Current TCF by ΣStandard /
  ΣCurrent, returning the class mean to its baseline.
- **Provisional TCF status** (Rules 7.2, 8.1) — newly-rated boats
  whose results don't drive other boats' updates while their own
  TCF is still settling. Affects whether a boat contributes to
  ΣH_S and Σ(1/T_E).

Implementing the per-race PI blend first lets us match HalSail's
behaviour exactly. The certificate-layer features can be added
later without disturbing the algorithm.

---

### Implementation: shared progressive-handicap engine

> **Internal architecture note.** NHC and ECHO are presented to
> scorers as independent systems — each described in its own
> terminology, with its own defaults, and with its own column
> displays in published results. The shared engine described below
> is an implementation detail; nothing here should leak into the
> user-facing explanation of either system.

NHC (in all three variants — NHC1, RYA NHC 2015, SWNHC2015) and
ECHO are mathematically a single algorithm with different parameter
choices. We implement them as one engine driven by a configuration
profile, with a profile per system.

**Pipeline shape.** Each race in a progressive-handicap fleet runs
through two phases: race scoring (corrected times, places, points —
identical across IRC, PY, NHC, ECHO) followed by a separate handicap
adjustment phase that consumes the applied TCFs and elapsed times
from race scoring and produces the TCFs for the next race. The
adjustment phase is driven by a `ProgressiveHandicapConfig` per
system, not by hard-coded NHC logic.

**The four steps** (handicap adjustment phase)

1. **Compute the per-boat fair handicap** for each finisher —
   identical across all profiles:
   ```
   Q_i = ΣH / (T_E_i × Σ(1/T_E))
   ```
   This is the IS *Performance Index* in ECHO; it is NHC's *fair
   TCF* (also expressible as `H_i × CT_avg / CT_i` or `O_i × P50` —
   algebraically equivalent reformulations). The engine uses
   whichever formulation is numerically cleanest internally;
   user-facing displays use the formulation native to the active
   profile.
2. **Classify outliers** (optional, profile-dependent).
3. **Blend** each finisher's handicap toward its `Q_i` using a rate
   α. Non-finishers skip this step (`new_H = H`).
4. **Realign** the whole fleet to a target sum (optional). When
   enabled, this step may apply to non-finishers too.

**Configuration schema**

```ts
interface ProgressiveHandicapConfig {
  // Blend rates. Setting alphaUp === alphaDown gives symmetric adjustment.
  alphaUp: number;                 // applied when Q_i > H_i (boat over-performed)
  alphaDown: number;               // applied when Q_i ≤ H_i

  outlier:
    | { strategy: 'none' }
    | {
        // RYA NHC 2015: clamp the boat's effective corrected time to
        // ±k SDs of fleet T_C, then recompute Q_i from the clamped
        // value. Same α is applied.
        strategy: 'cap-input';
        sdThresholdFast: number;       // default 1.0
        sdThresholdSlow: number;       // default 1.0
      }
    | {
        // SWNHC2015: keep T_E, but reduce α for boats whose Q/H
        // ratio is far from fleet mean.
        strategy: 'reduce-alpha';
        sdThresholdUp: number;         // default 1.5
        sdThresholdDown: number;       // default 1.0
        alphaUpReduced: number;        // default 0.15
        alphaDownReduced: number;      // default 0.075
      };

  realignment:
    | { target: 'none' }
    | { target: 'prior-mean';   minFinishers: number; includeDNC: boolean }
    | { target: 'base-numbers'; includeDNC: boolean };

  minFinishers: number;            // skip the update entirely if fewer than this finished
}
```

**Profile table**

| Parameter                 | NHC1   | RYA NHC 2015  | SWNHC2015      | ECHO (club) | ECHO (regatta) |
|---------------------------|--------|---------------|----------------|-------------|----------------|
| `alphaUp`                 | 0.15   | 0.3           | 0.3            | 0.25        | 0.50           |
| `alphaDown`               | 0.15   | 0.3           | 0.15           | 0.25        | 0.50           |
| `outlier.strategy`        | `none` | `cap-input`   | `reduce-alpha` | `none`      | `none`         |
| Outlier thresholds        | —      | ±1 SD         | 1.5 / 1.0 SD   | —           | —              |
| `realignment.target`      | `none` | `base-numbers`| `prior-mean`   | `none`      | `none`         |
| `realignment.includeDNC`  | —      | `true`        | `false`        | —           | —              |
| `realignment.minFinishers`| —      | —             | 3              | —           | —              |
| Top-level `minFinishers`  | 1      | 1             | 1              | 3           | 3              |
| Requires base handicap?   | no     | yes (`H0`)    | no             | no¹         | no¹            |

¹ ECHO certificates carry a Standard TCF (the formal-Rules analogue
of `H0`) but the per-race PI blend does not reference it. Standard
TCF anchors certificate-layer features (hard limits, Block
Adjustment) which are out of scope for the first ECHO pass.

**UI: presets only.** Scorers pick a system by name (NHC1, ECHO,
later RYA NHC 2015 / SWNHC2015) and — for ECHO — a club-vs-regatta
α preset. Exposing raw α, thresholds, and realignment target is a
power-user escape hatch we can add later if a club ever asks; start
with presets-only. **Do not surface the unified profile concept in
the UI** — sailors should see only the system they selected.

**Starting handicap vs base handicap `H0`** *(applies to RYA NHC
2015 only; not used by NHC1, SWNHC2015, or ECHO)*

Two distinct per-competitor values:

- **Starting TCF** — the handicap used in race 1 of *this series*.
  Every progressive system needs one. Typical sources: carry-over
  from the final race of a previous series, scorer-entered (new
  boat joining mid-season, local reset), or equal to `H0` for a
  boat's very first NHC race ever. Stored as the competitor's
  initial TCF; gets updated after each race.
- **`baseHandicap` (`H0`)** — the RYA-published measurement-based
  number. **Does not change race-to-race.** Used *only* as the
  realignment anchor in the RYA variant (`ΣH2 = ΣH0` after each
  race). NHC1, SWNHC2015, and ECHO do not reference it. For a boat
  racing its very first NHC race, `H0` and starting TCF coincide;
  for a returning boat they typically differ.

**`H0` fallback when the scorer doesn't supply one** *(RYA NHC 2015
only)*. If `H0` is blank when the first race is committed, snapshot
the starting TCF into it and lock the field. The algorithm
continues to work correctly — `ΣH0` is well-defined and realignment
still prevents within-series drift — but the anchor becomes
"whatever the fleet looked like at the start of this series" rather
than "the RYA published baseline." A reasonable fallback for clubs
running NHC as a local progressive system without subscribing to
the RYA list. The snapshot is **persisted and locked**, not
recomputed on the fly: if a scorer later edits a boat's starting
TCF, `H0` stays pinned to the original race-1 value, otherwise the
realignment anchor would retroactively move and change all
subsequent race results.

**Implementation staging**

1. **NHC1 first pass.** ✓ Done (commit `db39652`). Validates the
   shared engine against real Puppeteer 22 data.
2. **Add ECHO.** ← next. Configuration-only addition (α = 0.25
   default, `minFinishers = 3`); reuses the NHC1 code path. Adds
   the ECHO column set to the explainability layer (independent
   IS-notation columns; no shared display with NHC).
3. **Add SWNHC2015.** Asymmetric α, `reduce-alpha` outlier
   strategy, `prior-mean` realignment. Configuration-only; no
   schema changes.
4. **Add RYA NHC 2015.** Adds the `H0` field on competitor, the
   `cap-input` outlier strategy, `base-numbers` realignment, and
   DNC realignment. Biggest data-model delta; comes last.

### Scoring-inquiry adjustments

A scorer may be asked (e.g. via an RRS scoring inquiry from the sailing committee
or RO) to make adjustments to the handicap calculation for a race. These
adjustments apply only to progressive systems — static TCF systems (IRC, PY)
have nothing to recompute. Two forms are common:

**Exclude a specific boat from the handicap calculation for a race.** Used when
a boat's performance in that race was unusually poor (gear failure, crew
incident, navigation error) and including it would skew the fleet statistics
used to update everyone else's handicap. The excluded boat's own TCF remains
unchanged by that race, and all other boats' handicaps are computed as if that
boat were not in the fleet for that race. The boat still appears in the race
results with its own corrected time and points — the exclusion is from the
*handicap-update calculation*, not from the *scoring*.

Mechanically, for NHC1 this means the boat is omitted from the `O_avg` and
`mean(TCF_i)` used to compute `P50`, and its own `new_TCF_i = TCF_i` (as for a
non-finisher). For ECHO it is omitted from the `avg(TCF_i)` and `avg(BCR_i)`
used to compute `EchoIndex`, and its own TCF is unchanged.

**Exclude a specific race from the handicap calculation entirely.** Used when
the race as a whole was unrepresentative of the fleet's usual spread (e.g. a
drifter that rewarded a lucky wind shift, or a short course on which the
handicap differences had no chance to resolve). All boats' handicaps remain
as they were before the race. The race is still scored — boats get points
from their corrected times using the pre-race TCFs — but no handicap update
propagates to race N+1.

Mechanically this is equivalent to setting `new_TCF_i = TCF_i` for every boat,
finisher or not. The `rrat`/`tcfApplied` snapshot for that race is still
recorded (it is the TCF that produced the corrected times shown in results),
but the master `comprating` is not advanced.

**Data model implications (Phase 2):**

- Per-race, per-competitor flag: `excludeFromHandicapUpdate?: boolean`.
- Per-race flag: `excludeFromHandicapUpdate?: boolean` on the race itself, as
  a shorthand for "all boats, this race".
- Both flags only suppress the *update*. Corrected times, places, and points
  for the race are unaffected.
- The audit trail should record who made the exclusion and why (free-text
  reason), because these are scoring-inquiry decisions and may be challenged.

### Rating calculation explainability ✓ Implemented (NHC1)

> **Status:** Implemented for NHC1. The seven explainability columns
> (TCF used, ET, CT, CT ratio, Fair TCF, Adjustment, New TCF), the
> per-race fleet-header line (α, finisher count, CT_avg, mean TCF),
> and a non-finisher sub-table render in both the in-app standings
> view and the exported HTML. In the exported HTML a viewer-facing
> checkbox ("Show NHC rating calculations") toggles the columns and
> header on/off, with the preference persisted to `localStorage`
> (commit `41cdf29`). A series-level `publishRatingCalculations`
> setting (default `true`) controls whether the columns are emitted
> at all. Intermediates are stored per-competitor in `NhcRaceCalc` and
> per-fleet-race in `NhcRaceAggregates`, populated by the scoring
> engine and read directly by both the renderer and the public JSON
> exporter. Deferred: ECHO's own column set (specified below in IS
> notation; rendered independently of the NHC columns when ECHO ships),
> the NHC variant extensions (RYA / SWNHC2015), the series-level
> Rating-history page, and scoring-inquiry exclusion rendering.
> Deviation from the original design: the appendix is not
> collapsed-by-default-expandable; instead the columns render inline
> and a single viewer toggle hides/shows them.

The opacity of progressive handicap algorithms is their biggest practical
problem: sailors don't trust a system they can't reproduce on paper. Phase 2
output is designed around a **verification contract** — given only the
published HTML for a race, a competitor with a calculator should be able to
reproduce every boat's `new_TCF`. Every decision below follows from that.

Concretely, this means:

- Every per-boat intermediate value the algorithm computes is displayed.
- Every fleet-level aggregate used in the computation is displayed.
- Intermediates are stored in the scoring output, not recomputed at render
  time. Both the HTML renderer and the JSON exporter read from the same shape.
- The display form is chosen for intuitiveness, not internal numerical
  cleanliness. Internal computation may use a different algebraically
  equivalent form.

#### Column set — NHC1 baseline

Primary table, one row per finisher:

| Rank | Boat | TCF used | ET | CT | CT ratio | Fair TCF | Adjustment | New TCF |

Notes on each column:

- **TCF used** — the `rrat` snapshot actually used to compute this race's
  corrected time. If this differs from the boat's master TCF carried in from
  a prior event, an asterisk footnote makes the race-rating-vs-master-rating
  distinction visible to the competitor.
- **CT** displayed to 0.1 s. The column footer shows `CT_avg` to the same
  precision.
- **CT ratio** = `CT_avg / CT_i` to 4 dp. The key "how did I do vs. average"
  number — arguably the most intuitive single value in the whole calculation.
  A boat that sailed exactly to its rating has a ratio of 1.0000.
- **Fair TCF** = `TCF_i × CT ratio` to 4 dp. Displayed with one extra dp vs.
  final TCF so the blend arithmetic closes to the last digit of the result.
- **Adjustment** = `α × (Fair TCF − TCF_i)`, signed, to 4 dp. Sign is
  meaningful: positive = handicap going up = "you sailed fast today."
- **New TCF** = `TCF_i + Adjustment`, rounded to 3 dp. The TCF applied in
  race N+1.

Fleet-level header displayed once above the table:

```
Rating system: NHC1  ·  Adjustment rate α = 0.15  ·  Finishers: 14
Fleet CT average: 64:12.8  ·  Fleet mean TCF: 1.184
```

#### Non-finishers

A sub-table below the main one:

| Boat | TCF used | Code | New TCF |
|------|----------|------|---------|
| …    | 1.038    | DNF  | 1.038 (unchanged) |

Explicit "unchanged" text beats an empty cell — the absence of an adjustment
is deliberate, not a data error.

#### NHC variant extensions

The NHC1 column set stays identical across NHC variants; further columns
and sub-tables are added additively.

**RYA extreme-performer capping.** For a clamped row, the CT column shows
the actual CT with a marker (e.g. `71:22.4 †`); the Fair TCF calculation
uses the clamped value `(μ_tc ± σ_tc)` and that value is shown inline.
Footer note explains the ±1 SD cap. Header gains `σ_tc` and the cap
thresholds `μ_tc ± σ_tc`.

**Realignment** (RYA, SWNHC2015). A second table-section below the blend
section, titled "Realignment." The fleet-wide scale factor is displayed
once (`ΣH0 / ΣHp` for RYA, `mean(TCF_old) / mean(TCF_new)` for SWNHC2015),
followed by a per-boat "Post-realignment TCF" column. The "New TCF" from
the blend section is relabelled `Hp` (provisional TCF); the final column
of the realignment section is the TCF applied in race N+1. For RYA, the
header shows `ΣH0` and `ΣHp` so the scale factor is reproducible.

**SWNHC2015 asymmetric α.** Column heading shows `α = 0.30 ↑ / 0.15 ↓`;
the applied α is implied by the sign of the adjustment. For outlier rows,
the reduced α actually used is annotated inline: `+0.0024 (α=0.15, outlier)`.

#### Column set — ECHO

ECHO has its own column set, written in the notation of the Irish
Sailing 2022 guide. The columns let a scorer with a calculator
reproduce every element of `PI_i = ΣH_S / (T_E_i × Σ(1/T_E))`
directly from the published table — no algebraic substitutions, no
borrowed terminology.

Primary table, one row per finisher:

| Rank | Boat | Starting H | T_E | 1/T_E | CT | PI | Adjustment | New H |

Notes on each column:

- **Starting H** — the boat's handicap entering this race (the
  `rrat` snapshot used to compute its corrected time). 3 dp.
- **T_E** — elapsed time in seconds, displayed as `m:ss` for
  readability. The verification formula uses the underlying second
  count, not the displayed form.
- **1/T_E** — reciprocal of elapsed time, 5 dp. Lets a scorer
  verify `Σ(1/T_E)` from the column footer by adding the cells.
- **CT** — corrected time `T_E × Starting H`, displayed as `m:ss.s`.
  Used for race ranking; not used in the PI calculation. Included
  for the race-results context, not the handicap update.
- **PI** = `ΣH_S / (T_E × Σ(1/T_E))`, 4 dp. Displayed with one
  extra dp vs. final New H so the blend arithmetic closes to the
  last digit of the result.
- **Adjustment** = `α × (PI − Starting H)`, signed, 4 dp. Sign is
  meaningful: positive = handicap going up = "you sailed fast
  today."
- **New H** = `Starting H + Adjustment`, rounded to 3 dp. The
  handicap that will be applied in race N+1.

Fleet-level header displayed once above the table:

```
Rating system: ECHO  ·  Adjustment rate α = 0.25  ·  Finishers: 10
ΣH_S = 10.221  ·  Σ(1/T_E) = 0.16604
```

**Non-finishers** appear in the same sub-table pattern as NHC1:
boat, Starting H, code, New H = Starting H (unchanged).

**Two-finisher gate.** When fewer than three boats finish, the
update is suppressed (per the IS guide). The rating-calculation
table collapses to a single line: "Rating update suppressed —
fewer than three finishers." All Starting H values carry forward
unchanged into the next race.

**Scoring-inquiry exclusions** are rendered using the existing
shared scoring-inquiry sub-section pattern (see "Scoring-inquiry
exclusions" below): an excluded boat appears in an
"Excluded from rating calculation" sub-table with its reason; a
whole-race exclusion collapses the rating-calculation table to a
single line.

#### Scoring-inquiry exclusions

A boat with `excludeFromHandicapUpdate` for a race appears in a third
sub-section titled "Excluded from rating calculation," showing its TCF,
code, and `new_TCF = TCF_i (unchanged — excluded: [reason])`. It still
appears in the main race results table with its corrected time and points.

Fleet aggregates in the header reflect the *post-exclusion* values — the
numbers actually used in the math. An explicit "N excluded" field signals
that the averages don't cover every boat that raced.

For a whole-race exclusion, the rating calculation table collapses to a
single line: "Rating update suppressed for this race. All TCFs carry
forward unchanged. Reason: [free text]."

#### Placement in HTML output

Per-race (**implemented**): the explainability columns render inline in
the same race table, with a single viewer toggle — "Show NHC rating
calculations" — that hides or shows them. Defaults to hidden; the
viewer's preference is persisted in `localStorage`. The original plan
was a collapsed-by-default appendix section, but inline-with-toggle
proved simpler and kept the CT column adjacent to corrected-time context
already in the table. A series-level `publishRatingCalculations`
setting (default `true`) controls whether the columns and toggle are
emitted at all.

Series-level (**deferred**): a "Rating history" page showing, for
each boat, a row per race with `TCF_in → new_TCF` and the adjustment.
Not yet built; per-race views currently cover the common case.

#### Precision and display form

Stored TCFs are 3 dp. Intermediate displays:

- CT: 0.1 s (or 1 s for short races)
- CT ratio, Fair TCF, Adjustment: 4 dp
- New TCF: 3 dp (the stored value)

The displayed arithmetic must close to the last digit of the New TCF column.
If it doesn't, the displayed intermediates are lossy — worth testing a few
rows against manual calculation before locking column widths.

Internal representation uses whichever formulation is numerically cleanest
(likely the P50 form — it matches Sailwave's internal calculation and avoids
division-by-CT-per-boat). Display form uses `CT_avg / CT_i` because it is
the most intuitive. The two are algebraically equivalent so correctness is
not at stake, only presentation.

#### Scoring output shape

Only `tcfApplied` and `newTcf` are generic across progressive systems and
live directly on `HandicapRaceScore`. Everything else is variant-specific
and encapsulated in an optional sub-object:

```typescript
export interface HandicapRaceScore extends RaceScore {
  elapsedTime: number | null;
  correctedTime: number | null;
  tcfApplied: number | null;   // TCF used this race (rrat snapshot)
  newTcf: number | null;       // TCF for race N+1; null for static systems
  nhc?: NhcRaceCalc;           // present iff fleet.scoringSystem === 'nhc'
  // Future: echo?: EchoRaceCalc;
}

export interface NhcRaceCalc {
  ctRatio: number;             // CT_avg / CT_i — the key intuitive value
  fairTcf: number;             // TCF_i × ctRatio
  adjustment: number;          // signed: α × (fairTcf − TCF_i)
  alphaApplied: number;        // actual α used (differs per-boat in SWNHC2015 outliers)

  // RYA variant only; omitted when no clamping occurred
  extremePerformer?: {
    clampedCt: number;
    direction: 'fast' | 'slow';
  };

  // Realignment variants; omitted for NHC1
  provisionalTcf?: number;     // Hp before realignment
}
```

For non-finishers the `nhc` field is absent — `newTcf === tcfApplied` is
sufficient to express "unchanged."

Fleet-level aggregates (`ctAvg`, `finisherCount`, `meanTcf`, the active `α`
settings, and realignment inputs `σ_tc` / `ΣH0` / `ΣHp` /
`realignmentFactor` where applicable) do not belong on per-boat scores.
They sit on a fleet-race-level object that Phase 2 needs to introduce. The
renderer pulls fleet stats from there and per-boat intermediates from
`nhc`.

#### Series-level settings

`publishRatingCalculations: boolean` (default: `true` for progressive-
handicap series; not applicable for static-TCF series). One knob. Clubs
that want cleaner published results can turn it off; clubs that want
transparency get it automatically.

### Why Phase 2 is a significant jump

Phase 1 is stateless: the same TCC/PY number applies to every race; results can be
recalculated from scratch at any time. Phase 2 is stateful: the TCF for race N+1
depends on corrected times from race N. Retroactively changing a race result changes
all downstream handicaps. The scorer must explicitly "commit" each race to trigger
the handicap update. Do not start Phase 2 until Phase 1 is solid and there is
real user experience with static handicap scoring.

---

## Phase 3: ORC Club (deferred)

ORC assigns each yacht a **Time Allowance (TA)** in seconds per mile. The formula
is different from TCF multiplication:

```
Corrected Time = Elapsed Time − TA × course_distance_miles
```

TA varies by true wind speed (TWS) and course type (windward-leeward, circular).
The scorer must record prevailing TWS, course type, and distance after each race.
This is substantially more complex than IRC/PY and should not be attempted before
Phase 1 is thoroughly tested in practice.

ORC advanced methods (PCS, Custom Courses) are far horizon; see `horizon.md`.

---

## Architecture: what changed (Phase 1) ✓ Implemented

> The following describes the data model and scoring engine as
> implemented. These are no longer proposals — they are the current
> state of the code in `lib/types.ts` and `lib/scoring.ts`.

### Data model

**Competitors are in multiple fleets:** `Competitor.fleetIds: string[]`.
A competitor in multiple fleets gets independent standings in each (e.g.
"Melges 15 Scratch" + "PY", or "Class 3 IRC" + "Class 3 NHC").

**A start covers one or more fleets:** `RaceStart` stores a gun time for
a group of fleets. Multiple fleets can share the same gun. A competitor's
fleets must all share the same start.

```typescript
export interface RaceStart {
  id: string;
  raceId: string;
  fleetIds: string[];   // all fleets sharing this gun time
  startTime: string;    // "HH:MM:SS" — the starting signal time
}
```

**Finish uses the finish sheet model** (ADR-007):

```typescript
sortOrder: number;      // row index in the crossing-order list (0-based)
finishTime?: string;    // "HH:MM:SS" — recorded for handicap fleet boats
```

Row order is crossing order. `finishTime` is populated only for competitors
in handicap fleets. The cross-fleet `finishPosition` field from before Phase 1
was removed.

**Competitor rating fields:**

```typescript
fleetIds: string[];     // one or more fleets
ircTcc?: number;        // e.g. 0.972 — IRC Time Correction Coefficient
pyNumber?: number;      // e.g. 1034 — RYA Portsmouth Yardstick number
// Phase 2 will add: nhcHandicap?: number  (initial TCF for NHC)
```

**Fleet scoring system:**

```typescript
scoringSystem: 'scratch' | 'irc' | 'py';  // one per fleet; default 'scratch'
// Phase 2 will add: 'nhc' | 'echo'
```

**Series-level scoring mode** (added in file format v9):

```typescript
scoringMode: 'scratch' | 'handicap';  // locked after first race has finishes
defaultStartSequence?: StartGroup[];  // default start groups for race creation
```

### Scoring engine

`calculateHandicapRaceScores()` handles IRC and PY fleets, parallel to the
existing scratch path. `getTCF(competitor, fleet)` resolves the IRC vs PY
distinction (`ircTcc` directly, or `1000 / pyNumber`). Result shape:

```typescript
export interface HandicapRaceScore extends RaceScore {
  elapsedTime: number | null;    // seconds; null for coded finishes
  correctedTime: number | null;  // seconds; null for coded finishes
  tcfApplied: number | null;     // TCF used (TCC or 1000/PY); snapshot
}
```

`tcfApplied` is calculated during scoring but **not yet persisted** in the
series file format — it is re-derived on load. This is sufficient for
static-TCF systems (IRC, PY) where the rating doesn't change, but Phase 2
will need to persist it (see Phase 2 open questions).

Coded finishes (DNS, DNC, DNF, etc.) receive penalty points (fleet size + 1)
regardless of their elapsed time — same as scratch.

---

## Finish entry UX — the finish sheet model ✓ Implemented

> **Status:** Complete. Implemented in commit `d8ad8d0` and subsequent
> polish (#66, #76, #77). See ADR-007 (Accepted) for the full decision
> record.

### Core principle

Finish entry is a digital transcription of the handwritten finish sheet — a single
ordered list of boats in the order they crossed the finish line. Row order in the
list **is** crossing order. No explicit position number is stored or displayed; the
row's position in the list is the data.

This is the natural mental model for a scorer working from a handwritten sheet:
sail numbers listed top to bottom in crossing order, with a finish time written
next to the boats whose fleets use handicap scoring and no time for the scratch
classes.

### Time field is per-competitor, determined by fleet scoring

A competitor needs a **finish time** only if any of their fleets uses time-based
scoring (IRC, PY, NHC). A scratch-only competitor needs no time.

In a typical mixed-fleet race the same finish boat records everyone. Handicap
boats get a time recorded as they cross; scratch boats are just tallied in order.
Both appear in the same finish entry list. A fleet badge on each row makes the
reason visible — no implicit mode switch, just a time column populated for some
rows and empty for others, matching the handwritten sheet.

### Transcription and late insertion

The happy path is top-to-bottom transcription of the sheet:

- Scorer enters sail numbers in crossing order
- Scratch entries are appended to the list immediately (fast path: sail number →
  Enter → in the list)
- Handicap entries prompt for a time before being added
- In a correct transcription the times come out in ascending order naturally
  because that is the order the boats crossed

When a boat is entered late (out of order):

- **Handicap entry (has a time)**: silently auto-slotted into the correct time
  position among the other timed rows. No confirmation dialog. The new row is
  inserted immediately before the next later-timed row, preserving scratch rows'
  relative positions around it.
- **Scratch entry (no time)**: appended to the end. The scorer then uses per-row
  move controls to place it where it belongs.

### The time-order invariant and move controls

Timed rows are always in time order relative to each other. This is enforced
**structurally**: timed rows have no move controls at all. Their position in the
list is derived entirely from their finish time (and the list insertion rule).
The only way to change a timed row's position is to edit its time, which
auto-slides the row to its new correct slot.

Scratch rows have up/down move controls (reusing the pattern from the series
Fleets settings card). They can be moved anywhere in the list, including past
timed rows — the scorer is simply saying "this scratch boat actually crossed
before that handicap boat," which is a valid observation.

Since scratch ranking is computed per-fleet from crossing order, moving an ILCA 6
row past an ILCA 7 row has no effect on ILCA 7's scoring. Only the relative order
of same-fleet scratch boats matters for scoring.

### Key invariant

**The list in finish entry always represents crossing order, as observed on the
water, not scoring order.** Scoring order (within-fleet rank) is derived: for
scratch fleets from crossing order among fleet members; for handicap fleets from
corrected times.

Detailed UX for entry, lookup, insertion, and reordering is in
`docs/design/ux/flows/finish-entry.md`.

---

## Scoring subtleties

### Tie-breaking

RRS A8.2 (most first places, then most second places, etc.) applies unchanged.
In handicap scoring "first place" means first on corrected time. The tie-break
logic is identical; only place determination changes.

### Discards and penalty codes

Unchanged from scratch. Discard rules (A11), non-discardable codes (BFD, DNE),
and additive penalty codes (ZFP, SCP, DPI) apply identically.

### Competitors without a rating

A competitor in a handicap fleet with no TCC or PY number cannot be ranked. They
should be shown with a "No rating" indicator rather than silently excluded.
They still appear in results; they simply have no corrected time and no place.

### The `dnfScoring` setting

The existing `dnfScoring: 'seriesEntries' | 'startingArea'` (A5.2/A5.3) applies
equally to handicap races. Penalty points for coded finishes use fleet-size-based
formulas, not time-based formulas.

---

## Phase 1 implementation sequence ✓ Complete

All steps implemented. Key commits and issues for reference:

1. **Data model** — `RaceStart`, `finishTime`, `ircTcc`, `pyNumber`,
   `fleetIds`, `scoringSystem` all in `lib/types.ts`. Series file format
   bumped through v7–v9.
2. **Scoring engine** — `calculateHandicapRaceScores` with YAML fixtures
   in `tests/fixtures/scoring/tcc-handicap/` (5 fixtures). Commit `9e9eba0`.
3. **Start time entry UI** — per-start-group time input on race page.
4. **Competitor: multi-fleet and rating fields** — multi-fleet editing,
   TCC/PY fields shown per scoring system. CSV import supports multi-fleet (#68).
   Rating columns in competitor list (#72).
5. **Finish time entry UI** — finish sheet model (ADR-007, commit `d8ad8d0`).
   Mixed timed/untimed entry, auto-slot for timed rows, move controls for
   scratch rows, tie checkbox (#66, #76, #77).
6. **Fleet scoring system setting** — in Settings → Fleets. Scratch → Handicap
   blocked when untimed finishes exist.
7. **Handicap standings display** — ET, CT, TCF shown alongside points.
   Per-race place column in HTML export for handicap fleets.
8. **Series file format** — v9 (current). Added `scoringMode` and
   `defaultStartSequence` at series level (commit `6777704`).

---

## Phase 2 open questions

The NHC1 algorithm and parameters are confirmed from real race data
(`reference/data/nhc-example/`; see `docs/notes/sailwave-excel-handicap-protocol.md`
for the spreadsheet variant analysis).

**Resolved in the first pass:**

- **Retroactive edits.** Decided: propagate automatically. Changing any input
  (a finish time, a starting TCF, α) recomputes the full TCF history for the
  fleet; the persisted `NhcTcfRecord` rows are rewritten as part of the
  recompute. No explicit commit step and no per-race lock. This is the
  opposite of HalSail's manual re-score but matches the local-first model
  where a single scorer edits on their own machine.
- **`tcfApplied` persistence.** Resolved: persisted per `(race, competitor,
  fleet)` in the `nhcTcfHistory` Dexie table as `NhcTcfRecord`, with
  `tcfApplied` (the Sailwave `rrat` analogue) and `newTcf` stored alongside.
  Series file format and public JSON export both carry the history so that
  imports can render without re-scoring, and so non-finishers (with no
  Finish row) still leave an audit trail.

**Still open:**

- **Carry-over handicap at series start.** The Championships data shows a
  gap between `comprating` (master TCF) and race 1 `rrat` (TCF actually
  applied) for most boats, indicating ratings were updated in a prior event.
  The pattern is clear but the source of the initial series-start TCF is
  not: do boats carry over their end-of-last-series TCF, is there a
  class-baseline reset between seasons, or does the scorer manually set
  starting TCFs? Currently the scorer sets `nhcStartingTcf` per competitor
  by hand; a future flow could auto-carry from a prior series. Ask the
  fleet scorer before implementing.
- **Scoring-inquiry exclusions.** Designed (see "Scoring-inquiry adjustments"
  above) but not implemented. Defer until a real request comes in — the
  data model for `excludeFromHandicapUpdate` is drafted but not wired up.
