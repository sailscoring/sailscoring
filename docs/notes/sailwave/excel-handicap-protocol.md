# Sailwave External Handicap Spreadsheet Protocol — ECHO and NHC

Analysis of the `.xls` files in `reference/sailwave/` (converted to `.xlsx` for
inspection via openpyxl). Five NHC variants and one ECHO variant were examined.

---

## 1. The Protocol: What Sailwave Fills In vs Reads Out

The spreadsheet has two sheets: **Main** (the calculation engine) and **Config**
(maps Sailwave field names to cell addresses). Sailwave reads the Config to know
where to write inputs and where to read outputs.

### Sailwave writes these per-competitor per race (starting at row 9):

| Config field | Column (varies by version) | Meaning |
|---|---|---|
| `SailNoFull` | A | Sail number |
| `Boat` | C | Boat name |
| `OwnerName` | D | Owner/helm |
| `StartTime` | E | Start time (Excel serial time) |
| `FinishTime` | F | Finish time |
| `Elapsed` | G | Elapsed time (Excel fraction-of-day — e.g. 1h = 1/24) |
| `ResultCode` | I | e.g. `DNS`, `DNF`, `" "` (space = clean finish) |
| `Rating` | J | Boat's **master** (stored) handicap = TCF |
| `RaceRating` | L | Handicap **used this race** (≠ J when re-alignment is pending) |
| `Position` | varies | Finishing position |
| `Points` | varies | Points scored |

### Race-level inputs:

| Config field | Cell | |
|---|---|---|
| `Race` / `RaceNo` | B2 | |
| `Event` | E2 | |
| `Venue` | E3 | |
| `Finishers` | B3 | Number of classified finishers |

### Sailwave reads back (the `*`-prefixed fields):

| Config field | Column | Meaning |
|---|---|---|
| `*NewRating` | varies | New handicap for next race (Sailwave saves this as the boat's updated rating) |
| `*ReAligned` | varies | Re-alignment-adjusted new handicap (in some versions same cell as `*NewRating`) |

`RatingConvert: On` means Sailwave automatically converts between the stored
3-digit NHC number (e.g. 104.5) and the TCF form (÷100) before writing/reading.

---

## 2. ECHO Algorithm

**File:** `SWECHO.xls` — Version 2018-01-02-0

The spreadsheet assumes boats are **sorted fastest to slowest** (winner in row 9).

### Per-boat intermediate columns (using generic row `i`):

```
H_i    = G_i × 1440                          # elapsed time in decimal minutes
CT_i   = MROUND(G_i × J_i, 1/86400)         # corrected time (rounded to 1 second)
BCR_i  = CT_winner / ET_i                    # "Best Corrected Rate" — the TCF that
                                              # would have given boat i exactly the
                                              # winner's corrected time
                                              # (= J_winner for the winner itself)
ECHO_i = BCR_i × EchoIndex                   # BCR scaled by fleet re-alignment factor
P_i    = J_i×(1−Adjust) + ECHO_i×Adjust     # new handicap (*NewRating)
```

If `CT_i = 0` (DNF/DNS/etc.): **new handicap = current handicap unchanged**.

### Fleet-level aggregates (row 50):

```
J50       = average(J_i over finishers)      # average current handicap
M50       = average(BCR_i over finishers)    # average "fair handicap"
EchoIndex = J50 / M50                        # keeps fleet mean stable
```

`EchoIndex` normalises BCR so the fleet-mean new handicap equals the fleet-mean
current handicap. Without it a consistently fast fleet would have all handicaps cut
every race.

Note: `EchoIndex` shows as `#REF!` in the named ranges of the xlsx conversion — it
was a named range in the original `.xls` pointing to `L51 = J50/M50`. The formula
intent is unambiguous from the cell formulas.

### Parameters:

| Cell | Name | Default | Meaning |
|---|---|---|---|
| O1 | `Adjust` | 0.6 | Fraction moved towards "fair" each race (60% — very responsive) |
| Q2–Q3 | — | 0.3, 0.15 | Display-only: illustrative effect of different outlier distances |

### Key difference from HPH/NHC:

HPH and NHC use the **fleet mean corrected time** as the reference point. ECHO uses
the **winner's corrected time** — every other boat's target TCF is "what would have
tied the winner". ECHO's default `Adjust = 0.6` is also far more aggressive than
HPH's typical K = 0.1.

---

## 3. NHC Algorithm — Evolution Across Four Versions

### Common foundation (all versions)

```
H_i  = G_i × 1440                          # elapsed minutes
CT_i = MROUND(G_i × L_i, 1/86400)         # corrected time (1-sec precision)
O_i  = 100 / H_i                           # raw performance index (100/min)
P50  = avg_L / avg_O                        # converts O-units to TCF-units
Q_i  = O_i × P50                           # performance in TCF units
```

`Q_i` is conceptually identical to HPH's `fair_TCF`: the TCF that would have given
the boat the fleet-mean corrected time (not the winner's — the **fleet mean**).

### Version 1: SWNHC3-NHC2013 (2013-03-19, Club — simplest)

No outlier detection. Two asymmetric adjustment rates:

```
S_i = AdjustP×Q_i + (1−AdjustP)×L_i   if Q_i > L_i  (over-performed → hcap up)
    = AdjustN×Q_i + (1−AdjustN)×L_i   if Q_i ≤ L_i  (under-performed → hcap down)

T_i = S_i   if finished
    = L_i   if DNF/DNS/etc.            # *NewRating
AD_i = T_i × (J50 / T50)              # *ReAligned (optional re-alignment)
```

Default parameters: `AdjustP = 0.3`, `AdjustN = 0.15`. Asymmetric by design —
a fast boat's handicap rises faster than a slow boat's falls. Conservative.

### Version 2: SWNHC3 (2014-01-05, Club — adds SD-based outlier detection)

```
S_i  = Q_i / L_i                       # comparative score (1.0 = on handicap)
Mean = average(S_i)
SD   = STDEV.P(S_i)
T_i  = 1   if S_i > Mean + SD_Over×SD  # extreme over-performer
      -1   if S_i < Mean − SD_Under×SD # extreme under-performer
       0   otherwise

# Extreme path (|T_i| = 1) — smaller adjustment than normal:
extreme_i = AdjustPX×Q_i + (1−AdjustPX)×L_i   (or AdjustNX version)

# Normal path (T_i = 0) — adjust relative to non-outlier fleet only:
X51 = avg_L(normal boats) / avg_O(normal boats)   # scale for non-outliers
Y_i = O_i × X51                                   # normalized target
Z_i = AdjustP×Y_i + (1−AdjustP)×L_i              # or AdjustN version

# Select:
AA_i = L_i    if T_i = ""  (no classification — DNF etc.)
     = Z_i    if T_i = 0   (normal)
     = extreme_i  otherwise

# Re-align:
AB_i = AA_i × (J50 / AA50)   if Finishers >= MinFin   # *NewRating
     = L_i                    otherwise
```

Default parameters:

| | Standard | Extreme |
|---|---|---|
| Over-perform (`+`) | AdjustP = 0.3 | AdjustPX = 0.15 |
| Under-perform (`−`) | AdjustN = 0.15 | AdjustNX = 0.075 |
| SD multiplier | SD_Over = 1.5 | SD_Under = 1.0 |
| MinFin | — | 3 |

Outliers get **smaller** adjustments — a boat having an exceptional race is dampened
more than a boat with a typical performance, to avoid overreacting to a single result.

### Version 3: SWNHC2015 / SWNHC2015-2 (2015-02-11, Club)

Structurally identical to v2. The only meaningful change: Sailwave now fills in both
`Rating → J` (master/stored rating) and `RaceRating → L` (the TCF actually used this
race) as separate inputs. The re-alignment denominator uses `SUM(J9:J49)` (sum of
master ratings). This supports partial-series re-alignment without corrupting the
race-scoring TCF.

### Version 4: SWNHC4-NHC2013 (2013-03-19, Regatta — most complex)

Designed for short regattas, not club series. Three major additions on top of the
common foundation:

**a) Damping by race number** — adjustment rate is higher early in a regatta:

```
Damping1 = CHOOSE(RaceNo+1, 1, 0.6, 0.6, ...)   # race 1: 100%; race 2+: 60%
Damping2 = CHOOSE(RaceNo+1, 1, 0.6, 0.5, ...)   # decays faster
S_i = Q_i − L_i                                  # raw TCF difference
T_i = S_i × Damping1   if S_i > 0
    = S_i × Damping2   if S_i < 0
V_i = L_i + T_i
```

**b) Sting mechanism** — penalises boats that outperform in 3 consecutive races:

```
U_i = 1  if Q_i/L_i >= StingFactor (1.1) AND boat has 1 in last 3 cols of Sting sheet
V_sting_i = S_i × StingPenalty (0.75) + L_i     # more aggressive cut
```

A separate `Sting` sheet records each boat's over-performance flag per race.

**c) Clamping** — limits max single-race adjustment to ±10% of original rating:

```
W_i = MAX(MIN(V_i, ClampU × J_i), ClampD × J_i)   # ClampU=1.1, ClampD=0.9
```

**d) Result code handling:**

- `DNF` boats: assigned the **race median corrected time** (not their actual ET)
- `DNC` boats: assigned the **average of top-3 corrected times**
- Both still get a handicap adjustment computed from those imputed times

---

## 4. Summary Table

| Feature | ECHO | NHC-2013-Simple | NHC-2014-Club | NHC-2015-Club | NHC-2013-Regatta |
|---|---|---|---|---|---|
| File | `SWECHO` | `SWNHC3-NHC2013` | `SWNHC3` | `SWNHC2015` / `-2` | `SWNHC4-NHC2013` |
| Version date | 2018-01-02 | 2013-03-19 | 2014-01-05 | 2015-02-11 | 2013-03-19 |
| Reference point | Winner's CT | Fleet mean | Fleet mean | Fleet mean | Fleet mean |
| Outlier detection | None | None | SD-based | SD-based | None (clamped) |
| Separate ±adjust rates | No | Yes | Yes (×2 paths) | Yes (×2 paths) | Via damping |
| Re-alignment | Yes (EchoIndex) | Optional (AD col) | Yes (MinFin≥3) | Yes (MinFin≥3) | No |
| DNF handling | Keep old hcap | Keep old hcap | Keep old hcap | Keep old hcap | Gets median CT |
| DNC handling | Keep old hcap | Keep old hcap | Keep old hcap | Keep old hcap | Gets avg-top-3 CT |
| Adjustment aggressiveness | 60%/race | 30%/15% | 30%/15% | 30%/15% | 60–100% (by race no.) |
| Min finishers gate | No | No | 3 | 3 | No |
| Race-history memory | No | No | No | No | Yes (Sting sheet) |
| Clamping | No | No | No | No | ±10% of J |

---

## 5. Notes for Phase 2 Implementation

**Which NHC version to implement?** SWNHC2015 (v3, Club) is the most recent and
widely used club variant. SWNHC4 (Regatta) is a purpose-built variant for short
events; don't conflate the two. For HPH at HYC, SWNHC2015 is the closest match.

**Re-alignment explained:** After each race all new handicaps are scaled by
`J50/AA50` (ratio of the sum of old master ratings to the sum of newly computed
ratings). This keeps the fleet-mean handicap constant from race to race, preventing
ratings drift. Without it, a lucky/unlucky race day causes the whole fleet to creep
up or down together.

**Rating storage:** `RatingConvert: On` tells Sailwave to divide the stored 3-digit
NHC rating (e.g. 104.5) by 100 before writing to `J`/`L`, and multiply by 100 before
saving `*NewRating` back. The spreadsheet always works in TCF units (0.85–1.15).
Our implementation needs to decide whether to store the raw TCF or the 3-digit NHC
form and document the convention clearly.

**Stateful fields:** The `Rating` (J) field is the master rating — updated by
Sailwave after each race from `*NewRating`. The `RaceRating` (L) field is what was
actually applied when scoring that race (snapshotted at race time). This maps
directly to the `tcfApplied` snapshot in the design doc — it must be persisted
separately from the current master rating.
