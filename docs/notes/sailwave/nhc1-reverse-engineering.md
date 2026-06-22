# Reverse-engineering Sailwave's NHC1 rating-adjustment formula

> **Status: solved (2026-05-08).** Sailwave's NHC1 is the SWNHC2015 spreadsheet
> algorithm by Jon Eskdale (Sailwave's author). The reference Python
> implementation reproduces Sailwave's NewRating column to **zero error**
> across all five test fleets and all 34 finishers.
>
> The discovery was made by parsing Howth's working calculation file
> `../hyc-archive/2026-club-racing/2026 Tues Series 1- Pup HPH R1.xls` —
> a copy of Eskdale's `SWNHC2015.xls` workbook (version `2014-01-05-0`) into
> which the Sailwave race output had been pasted. The cell formulas there are
> the algorithm.
>
> The empirical exploration in §§7–9 below is preserved for context — it
> documents how we reached the conclusion in §10. Sections §§10–12 are the
> permanent record of the algorithm itself.

This is an empirical investigation. We did not assume any prior model of how
Sailwave NHC1 works — we described the general space of NHC-style
rating-adjustment formulas, laid out example data, and identified the formula
empirically. The report is structured to be extended as more
Sailwave-output examples become available.

The companion analysis script is `sailwave-nhc1-reverse.py` in the
`hyc-archive` sibling repo (`../hyc-archive/2026-club-racing/`).

---

## 1. Background — how NHC-style algorithms work

After each race, an NHC-style ("progressive handicap") algorithm updates each
boat's Time Correction Factor (TCF) so that under-performers get an easier
rating next time and over-performers get a harder one. The general shape has
four steps:

1. **Apply the current TCF** to compute Corrected Time:
   `CT_i = ET_i × TCF_i`.
2. **Compute a "fair TCF"** `Q_i` for each finisher — the rating that would
   have placed the boat at fleet-average performance.
3. **Blend** the new rating partway from the current TCF toward the fair TCF:
   `new_TCF_i = TCF_i + α · (Q_i − TCF_i)`.
   The blend rate `α` (typically 0.10–0.30) controls how much of the gap is
   adopted each race.
4. **Optionally** cap, dampen, or re-normalise to keep ratings well-behaved.

The unknowns we need to identify are:

- The exact formula for `Q_i`.
- The blend rate `α`.
- Any outlier / cap / dampening step.
- Whether the fleet sum is preserved, and how.

Non-finishers (DNC, DNF, RET) keep their TCF unchanged, so they are not part
of the per-race calculation and are excluded from every sum below.

---

## 2. Notation

| Symbol | Meaning |
|--------|---------|
| `TCF_i` | Boat *i*'s rating going into the race |
| `ET_i` | Elapsed time, seconds |
| `CT_i` | Corrected time = `ET_i · TCF_i` |
| `Q_i` | "Fair TCF" — the rating that would have given boat *i* a fleet-average performance |
| `NR_i` | New rating after the race (Sailwave's published `NewRating` column) |
| `α` | Blend rate, assumed = 0.15 throughout (see §4) |
| `n` | Number of finishers |
| `μ_CT, σ_CT` | Arithmetic mean and population standard deviation of CT across finishers |

Sums are taken over finishers only.

---

## 3. The dataset

Five single-race fleets from Howth YC One Designs Series 1 (Tuesday 5 May
and Wednesday 6 May 2026). Sailwave's race-summary HTML labels every fleet
"Rating system: NHC1".

| Fleet | n | TCF range | ΣTCF | Σ NR | drift |
|-------|---|-----------|------|------|-------|
| Puppeteer HPH (5 May) | 14 | 1.150 – 1.350 | 18.065 | 18.064 | −0.001 |
| Squib HPH (5 May)     |  4 | 0.911 – 1.068 |  4.026 |  4.026 |  0.000 |
| Division A HPH (6 May)|  5 | 0.920 – 1.073 |  4.955 |  4.955 |  0.000 |
| Division B HPH (6 May)|  3 | 0.905 – 0.942 |  2.787 |  2.787 |  0.000 |
| Division C HPH (6 May)|  8 | 0.832 – 1.046 |  7.408 |  7.409 | +0.001 |

Sources: see `../hyc-archive/2026-club-racing/`. The script defines each
race inline so it is self-contained.

These five fleets vary in size from n = 3 to n = 14 and in TCF spread from
0.037 (Division B) to 0.214 (Division C). The variation is useful for
distinguishing fleet-size-dependent from fleet-size-independent formulas.

---

## 4. Step 1 — verifying the inputs

For every boat in every fleet our recomputed elapsed and corrected times match
Sailwave's display exactly. ET is `(finish − start)` in seconds. CT is `ET·TCF`
rounded to the nearest whole second (half-up):

```python
def elapsed_s(start: str, finish: str) -> int:
    def hms(t):
        h, m, s = map(int, t.split(":"))
        return h * 3600 + m * 60 + s
    return hms(finish) - hms(start)

def corrected_s(et: int, tcf: float) -> int:
    return int(et * tcf + 0.5)
```

Equivalent in a spreadsheet:

```
ET  = (finish_time − start_time) × 86400        # if dates are Excel times
CT  = ROUND(ET × TCF, 0)
```

This rules out any preprocessing of times (different rounding, decimal
minutes, different start time, finishline tolerance, etc.) as the source of
the observed residuals.

---

## 5. Step 2 — recovering the Q value Sailwave used

Assuming the published NewRating is the result of a single blend step at a
known α, we can invert the blend to get the value of `Q_i` Sailwave's internal
calculation must have produced:

```python
ALPHA = 0.15

def implied_q(tcf: float, new_rating: float) -> float:
    return (new_rating - (1 - ALPHA) * tcf) / ALPHA
```

Spreadsheet: `Q_imp = (NR − 0.85·TCF) / 0.15`.

Why α = 0.15? Sailwave's NHC1 documentation cites it as the default, our match
on Division A (§7) is exact only at this value, and no candidate over a grid
of α from 0.05 to 0.30 fits any race better. So we take α = 0.15 as
established and analyse the implied Q values on that basis.

A candidate `Q_i` formula must reproduce the implied Q values to within
±0.0033 (the rounding tolerance — equivalent to the published NR being rounded
to 3 dp).

---

## 6. Empirical property — sum conservation

Across all five fleets, `Σ NR ≈ Σ TCF` to within ±0.001 (cumulative 3-dp
rounding). Sailwave's algorithm preserves the fleet's total rating each race.

Algebraically, sum conservation across the blend step requires
`Σ Q_i = Σ TCF_i`. This is a strong constraint — any candidate that doesn't
naturally satisfy it has to be followed by a renormalisation step.

---

## 7. Candidate fair-handicap formulas

Two natural definitions of "the rating that would have given boat *i* a
fleet-average performance" both reduce to `Q_i ∝ 1/ET_i`, but with different
proportionality constants.

### Family A — `ct-mean`

```python
def q_ct_mean(rows):
    ct_avg = sum(r["ct"] for r in rows) / len(rows)
    return {r["sail"]: r["tcf"] * ct_avg / r["ct"] for r in rows}
```

`Q_i = TCF_i · CT_avg / CT_i`. Because `CT_i = ET_i · TCF_i`, the TCF cancels
and this reduces to `Q_i = CT_avg / ET_i`.

Spreadsheet: `Q_i = AVERAGE(CT) / ET_i`.

This form reads naturally — the displayed "CT ratio" (`CT_avg / CT_i`) is
literally `Q / TCF`. **However**, it does *not* preserve the fleet sum.

`Σ Q_ctm = CT_avg · Σ(1/ET)`, which differs from `Σ TCF` whenever ET and TCF
are not arranged in a particular ratio within the fleet. In our races the
ct-mean natural drift of `Σ Q − Σ TCF` is 0.000 (DvA, by coincidence), 0.023
(DvB), 0.090 (Sqb), 0.093 (DvC), and 0.250 (Pup). So Family A on its own
cannot be Sailwave's complete formula on most fleets — it would inflate the
fleet sum noticeably.

### Family B — reciprocal-elapsed (a.k.a. "Performance Index" or "P50" form)

```python
def q_recip_elapsed(rows):
    sum_tcf   = sum(r["tcf"] for r in rows)
    sum_recip = sum(1 / r["et"] for r in rows)
    return {r["sail"]: sum_tcf / (r["et"] * sum_recip) for r in rows}
```

`Q_i = ΣTCF / (ET_i · Σ(1/ET))`.

Spreadsheet: `Q_i = SUMPRODUCT(TCF) / (ET_i · SUMPRODUCT(1/ET))`.

This form preserves the fleet sum by construction:
`Σ Q_B = ΣTCF · Σ(1/ET) / Σ(1/ET) = ΣTCF`, exactly.

It is also algebraically identical to `Q_i = (100/ET_i) · P50` with
`P50 = mean(TCF) · harmonic_mean(ET) / 100` — a form sometimes seen in NHC
literature.

### Family A vs. Family B — both give Q ∝ 1/ET, but with different constants

Both families have the form `Q_i = k / ET_i`:

| Family | constant `k` |
|--------|-------------|
| A (ct-mean)         | `mean(ET·TCF)`                      |
| B (reciprocal-ET)   | `mean(TCF) · harmonic_mean(ET)`     |

They agree only when all ET's are equal *or* all TCF's are equal. In our
races the constants differ by 0.5–2.5 %.

### A diagnostic — `Q_i × ET_i` should be constant

Under either family, `Q_i · ET_i = k` — the same constant for every boat.
Computing this from the Sailwave-implied Q values is a quick test:

| Fleet | min `Q·ET` | max `Q·ET` | spread |
|-------|-----------:|-----------:|-------:|
| Puppeteer  | 2726 | 2994 |  9.8 % |
| Squib      | 2336 | 2868 | 22.8 % |
| Division A | 4793 | 4869 |  1.6 % |
| Division B | 3764 | 4303 | 14.3 % |
| Division C | 4079 | 4863 | 19.2 % |

Every race has at least one boat whose `Q·ET` differs noticeably from the
fleet's median value. In four of five races the spread is far beyond any
rounding margin. The strongest evidence is in Puppeteer: Harlequin and
Nefertari have *identical* TCF (1.350) yet `Q·ET` of 2733 and 2994 — a 9.5 %
gap.

Most of the spread in each race is contributed by a single slow-extreme boat
(Treborth in Squib, Maximus in Div B, Toughnut in Div C, Indian in Div A) and
disappears once that boat is excluded — so the spread is partly a
consequence of an outlier-handling step (see §8). But even the
*non-extreme* portion of the fleet shows non-zero spread in Puppeteer
(Harlequin vs. Nefertari) and Class C (Arcturus vs. Pepsi), so a slow cap
alone does not fully explain it.

This is the central finding: Sailwave's NHC1 contains **at least one
non-trivial step beyond a simple `1/ET` fair handicap**.

---

## 8. Candidate outlier / cap steps

A boat with an unusually fast or slow result distorts a single-race rating
update. Most NHC-style schemes cap the influence of such results. The
general scheme:

1. Define an "extreme" threshold based on the spread of corrected times,
   typically `μ_CT ± k·σ_CT` for some `k` (commonly k = 1).
2. For an extreme-fast boat (`CT < μ − k·σ`), substitute a "threshold elapsed
   time" `Tt_i = (μ − k·σ) / TCF_i` in place of `ET_i` in the Q-formula.
3. For an extreme-slow boat (`CT > μ + k·σ`), use `Tt_i = (μ + k·σ) / TCF_i`.
4. Boats inside `[μ − k·σ, μ + k·σ]` use their actual ET.

Family B with two-sided substitution (σ unchanged in the denominator sum):

```python
from statistics import mean, pstdev

def q_recip_elapsed_capped(rows, k=1.0):
    cts    = [r["ct"] for r in rows]
    mu, sd = mean(cts), pstdev(cts)
    lo, hi = mu - k * sd, mu + k * sd

    def effective_et(r):
        if r["ct"] < lo: return lo / r["tcf"]
        if r["ct"] > hi: return hi / r["tcf"]
        return r["et"]

    sum_tcf   = sum(r["tcf"] for r in rows)
    sum_recip = sum(1 / r["et"] for r in rows)   # original sum
    return {r["sail"]: sum_tcf / (effective_et(r) * sum_recip)
            for r in rows}
```

Variants worth distinguishing:

- **Slow-only**: substitute `Tt` only when `CT > μ + k·σ`.
- **Fast-only**: only when `CT < μ − k·σ`.
- **Two-sided**: both ends.
- **Sum-recompute**: also use `1/Tt_i` in the denominator sum (changes mean
  conservation; rarely matches data).
- **`k`**: the threshold multiple. Behaviour is sensitive to it — k=1 and
  k=1.5 give materially different fits.

The script evaluates k ∈ {0.3, 0.5, 0.7, 1.0, 1.25, 1.5} for each variant.

---

## 9. Per-race fit of the leading candidate

The pooled best-fit candidate is **Family B with a slow-only Tt substitution
at k = 1·σ_CT**:

```python
def q_leading(rows, k=1.0):
    cts    = [r["ct"] for r in rows]
    mu, sd = mean(cts), pstdev(cts)
    hi     = mu + k * sd

    def eff_et(r):
        return hi / r["tcf"] if r["ct"] > hi else r["et"]

    sum_tcf   = sum(r["tcf"] for r in rows)
    sum_recip = sum(1 / r["et"] for r in rows)
    return {r["sail"]: sum_tcf / (eff_et(r) * sum_recip) for r in rows}
```

Pooled across all five races: Max|ΔNR| = 0.014, RMSE = 0.0054.

| Fleet | Max|Δ| | RMSE | observation |
|-------|--------|------|-------------|
| Division A | **0.001** | 0.0006 | within rounding — formula matches exactly |
| Division C | 0.007 | 0.0053 | top-2 finishers off by −0.004 / −0.007 (Sailwave higher) |
| Division B | 0.007 | 0.0064 | capped boat off by −0.007; non-extremes +0.005 / +0.007 |
| Squib      | 0.008 | 0.0069 | capped boat off by −0.008; non-extremes +0.004 to +0.008 |
| Puppeteer  | 0.014 | 0.0057 | slow extremes match ≤ 0.002; Nefertari (rank 3) off by −0.014 |

### Per-row residuals for the leading candidate

Columns: predicted NR, Sailwave NR, Δ = predicted − Sailwave. `cap` marks
boats that triggered the slow-extreme rule.

#### Division A HPH — fits within rounding

| Sail | Boat | TCF | NR_pred | NR_SW | Δ | cap |
|------|------|----:|--------:|------:|------:|:--:|
| 9202 | Insider Again | 0.920 | 0.924 | 0.924 | +0.000 | – |
| 1840 | The Big Picture | 1.073 | 1.075 | 1.075 | +0.000 | – |
| 6697 | Jeneral Lee | 0.972 | 0.972 | 0.971 | +0.001 | – |
| 9970 | Lambay Rules | 0.978 | 0.977 | 0.976 | +0.001 | – |
| 1543 | Indian | 1.012 | 1.009 | 1.009 | +0.000 | SLOW |

#### Puppeteer HPH — Nefertari is the standout

| Sail | Boat | TCF | NR_pred | NR_SW | Δ | cap |
|------|------|----:|--------:|------:|------:|:--:|
| 2021 | Harlequin | 1.350 | 1.392 | 1.385 | +0.007 | – |
| 385  | Ibis | 1.350 | 1.390 | 1.383 | +0.007 | – |
| 310  | **Nefertari** | 1.350 | 1.368 | 1.382 | **−0.014** | – |
| 15   | Trick or Treat | 1.350 | 1.359 | 1.365 | −0.006 | – |
| 187  | Flycatcher | 1.250 | 1.256 | 1.259 | −0.003 | – |
| 5526 | Blue Velvet | 1.275 | 1.277 | 1.277 | +0.000 | – |
| 22   | Weyhey | 1.350 | 1.349 | 1.345 | +0.004 | – |
| 20   | No Strings | 1.320 | 1.317 | 1.312 | +0.005 | – |
| 254  | Gold Dust | 1.345 | 1.331 | 1.326 | +0.005 | – |
| 101  | Eclipse | 1.200 | 1.184 | 1.179 | +0.005 | – |
| 245  | Cara | 1.150 | 1.132 | 1.128 | +0.004 | – |
| 219  | Geppetto | 1.250 | 1.231 | 1.233 | −0.002 | SLOW |
| 79   | Mojo | 1.175 | 1.157 | 1.159 | −0.002 | SLOW |
| 6413 | Yelllow Peril | 1.350 | 1.329 | 1.331 | −0.002 | SLOW |

#### Division C HPH — top finishers off; capped boat matches

| Sail | Boat | TCF | NR_pred | NR_SW | Δ | cap |
|------|------|----:|--------:|------:|------:|:--:|
| 1343  | Arcturus        | 0.895 | 0.914 | 0.921 | −0.007 | – |
| 3335C | Bite the Bullet | 1.046 | 1.065 | 1.069 | −0.004 | – |
| 1793  | Mistoffelees    | 0.832 | 0.842 | 0.841 | +0.001 | – |
| 8151  | Jokers Wild     | 0.915 | 0.919 | 0.912 | +0.007 | – |
| 2070  | Out & About     | 0.890 | 0.890 | 0.884 | +0.006 | – |
| 1430  | Mary Ellen      | 0.912 | 0.907 | 0.901 | +0.006 | – |
| 633   | Pepsi           | 0.903 | 0.892 | 0.886 | +0.006 | – |
| 1411t | Toughnut        | 1.015 | 0.996 | 0.995 | +0.001 | SLOW |

#### Squib HPH — too small to fully constrain

| Sail | Boat | TCF | NR_pred | NR_SW | Δ | cap |
|------|------|----:|--------:|------:|------:|:--:|
| 881 | Kaizen     | 1.057 | 1.075 | 1.071 | +0.004 | – |
| 37  | Kerfuffle  | 1.068 | 1.078 | 1.070 | +0.008 | – |
| 148 | Halloween  | 0.911 | 0.916 | 0.909 | +0.007 | – |
| 872 | Treborth   | 0.990 | 0.968 | 0.976 | −0.008 | SLOW |

#### Division B HPH — n = 3, signal-limited

| Sail | Boat | TCF | NR_pred | NR_SW | Δ | cap |
|------|------|----:|--------:|------:|------:|:--:|
| 7115 | Gecko     | 0.905 | 0.916 | 0.911 | +0.005 | – |
| 2507 | Impetuous | 0.942 | 0.950 | 0.943 | +0.007 | – |
| 7495 | Maximus   | 0.940 | 0.926 | 0.933 | −0.007 | SLOW |

---

## 10. The actual algorithm (SWNHC2015)

Howth's working spreadsheet `2026 Tues Series 1- Pup HPH R1.xls` is a copy of
Jon Eskdale's `SWNHC2015.xls` workbook (version `2014-01-05-0`) with the
Puppeteer race pasted in. The cell formulas are the algorithm. Implementing
them in Python reproduces every Sailwave NewRating across all five test
fleets and all 34 finishers to **zero error**.

### 10.1 Constants

The spreadsheet's named cells:

| Name | Cell | Value | Meaning |
|------|-----:|------:|---------|
| `AdjustP`  | W2 | 0.300 | non-extreme over-performer blend rate |
| `AdjustN`  | W3 | 0.150 | non-extreme under-performer blend rate |
| `AdjustPX` | X2 | 0.150 | extreme over-performer blend rate |
| `AdjustNX` | X3 | 0.075 | extreme under-performer blend rate |
| `SD_Over`  | T2 | 1.500 | extreme threshold above the comparative-score mean (in SDs) |
| `SD_Under` | T3 | 1.000 | extreme threshold below the comparative-score mean (in SDs) |
| `MinFin`   | Z3 |   3   | minimum finishers; below this no rating updates |

Note the **two asymmetries**:

- The blend rate is asymmetric *both* by direction (up vs down) and by
  classification (extreme vs non-extreme). Non-extreme over-performers move
  twice as fast as under-performers (0.30 vs 0.15). Extreme classification
  halves the rate (0.15 vs 0.075).
- The extreme threshold is asymmetric (1.5 SD on the fast side, 1.0 SD on the
  slow side). The fast side is more lenient; you have to over-perform
  noticeably more than you under-perform to be classified as an outlier.

### 10.2 Algorithm

For a single race with `n` finishers, current race ratings `L_i` (the TCF
applied this race), and elapsed times `ET_i` in seconds:

```python
from statistics import mean, pstdev

def swnhc2015(rows,
              alpha_p=0.30, alpha_n=0.15,
              alpha_px=0.15, alpha_nx=0.075,
              sd_over=1.5, sd_under=1.0,
              min_fin=3):
    n = len(rows)
    if n < min_fin:
        return {r["sail"]: r["tcf"] for r in rows}    # no update

    L  = [r["tcf"] for r in rows]
    ET = [r["et"]  for r in rows]                     # seconds

    # 1. Performance index O_i and fleet-wide P50 multiplier
    O   = [100.0 / (et / 60.0) for et in ET]          # 100 / minutes
    P50 = (sum(L) / n) / (sum(O) / n)
    Q   = [O[i] * P50 for i in range(n)]              # = ΣTCF / (ET_i · Σ(1/ET))

    # 2. Comparative score and extreme classification
    S    = [Q[i] / L[i] for i in range(n)]
    Smu  = mean(S)
    Ssd  = pstdev(S)
    hi   = Smu + sd_over  * Ssd
    lo   = Smu - sd_under * Ssd
    extreme = [(s > hi) or (s < lo) for s in S]

    # 3. Extreme branch (uses original Q_i)
    T = [alpha_px * Q[i] + (1 - alpha_px) * L[i] if Q[i] > L[i]
         else alpha_nx * Q[i] + (1 - alpha_nx) * L[i] for i in range(n)]

    # 4. Non-extreme branch — recompute P50 from non-extremes only
    Ln = [L[i] for i in range(n) if not extreme[i]]
    On = [O[i] for i in range(n) if not extreme[i]]
    W51 = (sum(Ln)/len(Ln)) / (sum(On)/len(On)) if Ln else P50
    X = [O[i] * W51 for i in range(n)]
    Y = [alpha_p * X[i] + (1 - alpha_p) * L[i] if X[i] > L[i]
         else alpha_n * X[i] + (1 - alpha_n) * L[i] for i in range(n)]

    # 5. Combine: extreme boats use T, non-extreme use Y
    Z = [T[i] if extreme[i] else Y[i] for i in range(n)]

    # 6. Realign by Z51 = ΣTCF / ΣZ to enforce sum conservation
    Z51 = sum(L) / sum(Z)
    AA  = [z * Z51 for z in Z]
    return {rows[i]["sail"]: round(AA[i], 3) for i in range(n)}
```

### 10.3 Equivalent spreadsheet formulas (per finisher row)

For row *i* with the constants in §10.1, the corresponding spreadsheet
formulas (column letters as Eskdale's workbook uses them):

| Column | Formula | Meaning |
|--------|---------|---------|
| `O_i` | `100 / (ET_i / 86400 × 1440)` | performance index |
| `P50` | `mean(L) / mean(O)` | scale factor (one cell, fleet-wide) |
| `Q_i` | `O_i × P50` | fair TCF |
| `S_i` | `Q_i / L_i` | comparative score |
| `Mean(S)`, `σ(S)` | `AVERAGE(S)`, `STDEV.P(S)` | classification stats |
| `extreme_i` | `S_i > Mean+1.5·σ OR S_i < Mean−1.0·σ` | classification |
| `T_i` (extreme) | `IF(Q_i>L_i, 0.15·Q_i + 0.85·L_i, 0.075·Q_i + 0.925·L_i)` | extreme blend |
| `W51` | `mean(L_non-ext) / mean(O_non-ext)` | recomputed scale |
| `X_i` (non-ext) | `O_i × W51` | non-extreme fair TCF |
| `Y_i` (non-ext) | `IF(X_i>L_i, 0.30·X_i + 0.70·L_i, 0.15·X_i + 0.85·L_i)` | non-extreme blend |
| `Z_i` | `T_i if extreme else Y_i` | blended (pre-realign) |
| `Z51` | `Σ(base TCF) / Σ(Z)` | realignment factor (base = series-initial rating; = `Σ(L)` only in a first race — see §10.6) |
| `NewRating_i` | `Z_i × Z51`, rounded to 3 dp | published value |

Anyone with the constants and these formulas can reproduce a Sailwave NHC1
calculation in Excel/LibreOffice/Sheets.

### 10.4 Verification

| Fleet | n | Max ‖predicted − Sailwave‖ | RMSE |
|-------|---|---------------------------:|-----:|
| Puppeteer HPH  | 14 | 0.000 | 0.000 |
| Squib HPH      |  4 | 0.000 | 0.000 |
| Division A HPH |  5 | 0.000 | 0.000 |
| Division B HPH |  3 | 0.000 | 0.000 |
| Division C HPH |  8 | 0.000 | 0.000 |

All 34 finishers' published `NewRating` values match the formula's output
exactly after the standard 3-dp rounding.

### 10.5 Why earlier candidates fitted Division A but not Puppeteer

Earlier sections (§§7–9) struggled because we had assumed a *symmetric*
α=0.15 blend. That holds only for boats where neither rate matters (Q very
close to L) — and for Division A's particular fleet shape, the boats happened
to all be near that condition. As soon as a boat is clearly an over- or
under-performer, the asymmetric 0.30/0.15 (or 0.15/0.075 if extreme) splits
diverge from a symmetric 0.15 blend.

Nefertari's anomaly (§9, row 310) is now explained: she is non-extreme
(`S = 1.087`, well within the 0.891 – 1.155 inner band), so her blend rate
is `0.30` (over-performing, X > L) — *twice* the 0.15 we'd assumed. That
exactly accounts for the 0.014 NewRating residual that no symmetric formula
could absorb.

### 10.6 The Step 6 realignment anchors to the base ratings, not the carried ones

§§10.1–10.4 were reverse-engineered entirely from *first* races, where every
boat's input TCF equals its series-initial base handicap (`nhcStartingTcf`).
That left one quantity undetermined: the numerator of the Step 6 realignment.
The "preserve the fleet sum" framing has two readings that coincide in a first
race but diverge afterwards —

- `Z51 = Σ(carried TCF) / Σ(Z)` — anchor to the ratings carried *into* this race.
- `Z51 = Σ(base TCF) / Σ(Z)` — anchor to each boat's series-initial rating.

The Howth 17 HPH fleet (Club Racing 2026 S1) settles it. Across races 2–4,
**only the base-rating numerator reproduces Sailwave**:

| Update | Σ(base) | Σ(carried) | Matches Sailwave |
|--------|--------:|-----------:|------------------|
| post-R2 (5 finishers, was 8 in R1) | 6.440 | 6.421 | **base** (carried is a uniform −0.004 off) |
| post-R3 (7 finishers) | 8.940 | 8.938 | **base** (boat 19 → 1.296; carried gives 1.295) |

The sums diverge because each race realigns over a *different* finisher set, so
the carried sum over the current finishers drifts away from their base sum.
Sailwave re-anchors to the fixed base handicaps every race, which is what stops
NHC ratings from compounding drift over a series. This is the case §12 flagged
as untested; it is now pinned by
`tests/fixtures/scoring/nhc/07-h17-hph-multi-race-base-realign.yaml` and was the
root cause of issue #147 §3(b). The §10.2 reference uses `sum(L)` only because
its five datasets are all first races (base == carried); for race ≥ 2 the
numerator is `Σ(base TCF)` over the finishers.

---

## 11. Reconciling §§7–9 with the answer

The 47 candidates explored in §§7–9 all assumed a *symmetric* α=0.15 blend,
following our existing handicap-scoring design doc (which had documented NHC1
as a single-α blend, derived from earlier reverse-engineering of the
Puppeteer 22 Championships data).
That assumption was wrong. The candidates that came closest — Family B with a
slow-extreme cap — got two things right (Family B / IS-PI as the fair-handicap
form; an extreme classification with a slow cap) but missed five further
features that turned out to matter:

1. **Asymmetric blend rate by direction**: 0.30 for over-performers vs 0.15
   for under-performers (in the non-extreme branch).
2. **Different blend rate for extremes**: 0.15 / 0.075 instead of 0.30 / 0.15.
3. **Extreme classification on comparative score `Q/L`, not CT**: a
   high-rated boat finishing mid-fleet is "extreme" because its `Q/L` is far
   below 1; a similarly-placed lower-rated boat is not.
4. **Asymmetric SD thresholds**: 1.5 above, 1.0 below.
5. **Recomputed P50 for the non-extreme branch** (`W51`): non-extreme boats
   are scaled by a P50 derived from the non-extreme subset only, not the
   fleet-wide P50.
6. **Final realignment** by `Z51 = Σ(base TCF) / ΣZ` to preserve the fleet
   sum exactly. Without it the asymmetric blend rates would drift the sum. The
   numerator is each finisher's *series-initial* rating, not the rating carried
   into this race — the two coincide only in a first race (§10.6).

Nefertari (Puppeteer rank 3) was the cleanest signal that something more was
going on. She is non-extreme (`S = 1.087`, inside the [0.891, 1.155] band),
which under the actual algorithm puts her on the 0.30 over-performer rate —
not the 0.15 we'd assumed. That single asymmetry was enough to push her
predicted NewRating off by 0.014, the largest residual in §9.

---

## 12. Adding more examples

To verify the algorithm against new Sailwave outputs:

1. Place a new Sailwave-output `.htm` race table next to the existing files
   in `../hyc-archive/2026-club-racing/`.
2. Append a new `RACE_FOO` tuple to `RACES` in
   `sailwave-nhc1-reverse.py`. Each race is `(label, start_time,
   competitors)` where each competitor is `(sail, boat, owner, tcf,
   finish_time, exp_ET, exp_CT, exp_NewRating)`. ET, CT, and NR are the
   *Sailwave-published* values used for verification.
3. Re-run the script. The SWNHC2015 candidate should report zero error. Add
   a row to §3 (dataset table) and §10.4 (verification) above. If a new
   fleet does *not* match exactly, that's a genuine surprise — possible
   reasons:
   - The scorer's spreadsheet is a different SWNHC version (the constants in
     §10.1 are version-specific; older versions may differ).
   - The scorer paste is incomplete (e.g. a non-finisher accidentally
     included or excluded from the inputs).
   - Sailwave has been updated since 2014 — though the NHC1 algorithm has
     been very stable, so this is unlikely.

Diagnostic examples that would test edge cases of the algorithm itself:

- **A fleet of exactly 3 boats** (`MinFin = 3` boundary). Our DvB has 3
  finishers and matches exactly; verifying against another 3-finisher fleet
  would confirm the boundary handling.
- **A fleet of fewer than 3 finishers**, where `MinFin` should suppress the
  update entirely. We don't have one yet.
- **A fleet where every boat is classified as extreme**. Possible in narrow
  TCF-spread fleets after several races; would test the fallback when the
  non-extreme subset is empty (`W51` is undefined; the spreadsheet falls back
  to `P50`).
- **Two consecutive races for the same fleet**, where the input TCF for
  race 2 is the published NewRating from race 1. *Done* — the Howth 17 fleet
  (R1–R4) is captured in
  `tests/fixtures/scoring/nhc/07-h17-hph-multi-race-base-realign.yaml`. Besides
  confirming the carry-through, it revealed that Step 6 realigns to the base
  ratings, not the carried ones (§10.6, issue #147 §3(b)).
- **A fleet where Sailwave outputs a different NHC version** (NHC2,
  NHC2015, etc.). The HTML output displays the rating-system name; if it
  says anything other than `NHC1`, the algorithm here doesn't apply.
