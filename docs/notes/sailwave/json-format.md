# Sailwave JSON Export Format

> **Note:** the importer no longer consumes this JSON export. It now parses
> Sailwave's native `.blw` series file directly — a flat four-column CSV of
> `key,value,compHandle,raceHandle` records that `parseSailwaveBlw` pivots into
> the same nested shape described below. These notes are retained because that
> nested `SailwaveRaw` shape (and every field name) is unchanged; only the
> serialization the importer reads has changed from JSON to `.blw`.

Notes from parsing real exports from Sailwave 2.38.01 (HYC Autumn League 2025).

## Top-level structure

```json
{
  "header": { "version": "2.38.01", "generator": "sailwave", ... },
  "globals": { ... },          // series-level settings (name, venue, pub options, etc.)
  "scoring-systems": { ... },  // keyed by scoring system ID
  "ui-recs": { ... },
  "prizes": { ... },
  "competitors": { ... },      // keyed by competitor ID (string integer)
  "races": { ... },            // keyed by race ID
  "results": { ... },          // keyed by result ID
  "columns": { ... }           // UI column definitions
}
```

The `globals` key `"serscoringhandle"` names the default scoring system ID.

## JSON quirks — two fixes required

Standard `json.loads()` will fail on real Sailwave exports. Two problems:

1. **Unescaped control characters in strings.** Windows paths stored in string fields
   (e.g. `serentrypath`) contain bare backslash escapes like `\r` and `\t` that JSON
   treats as control characters. Fix: parse with `strict=False`.

2. **Trailing commas.** Sailwave emits trailing commas before `}` and `]`, which is
   invalid JSON. Fix: strip them with a regex before parsing.

```python
import json, re

def load_sailwave_json(path):
    with open(path) as f:
        raw = f.read()
    # Strip trailing commas before } or ]
    fixed = re.sub(r",(\s*[}\]])", r"\1", raw)
    return json.loads(fixed, strict=False)
```

## Competitor records

Each entry in `"competitors"` is keyed by a string integer ID and contains fields like:

| Field            | Description                                              |
|------------------|----------------------------------------------------------|
| `compboat`       | Boat name                                                |
| `compsailno`     | Sail number                                              |
| `compaltsailno`  | Alternate sail number (often blank)                      |
| `comphelmname`   | Helm / crew name(s)                                      |
| `compclub`       | Club (can be multi-club, e.g. `"HYC / SSC"`)             |
| `compfleet`      | Fleet/class string, including scoring suffix (see below) |
| `comprating`     | Rating for this scoring system                           |
| `compnewrating`  | Updated rating after series (HPH progressive)            |
| `compalias`      | Alias pointer — see below                                |
| `compexclude`    | `"1"` if excluded from results                           |
| `comptotal`      | Raw points total                                         |
| `compnett`       | Net points (after discards)                              |
| `comprank`       | Series rank                                              |

## Competitor aliases

Sailwave represents dual scoring (e.g. IRC + HPH) by creating two competitor records
for the same physical boat — a **primary** and one or more **aliases**.

- `compalias == "0"` — this is the primary entry.
- `compalias == "<id>"` — this is an alias; the value is the ID of its primary.

The alias relationship is **one level deep** (no chains observed). The primary is
always the "main" scoring system for that series:

- **Offshore series:** primary = HPH entry; alias = IRC entry.
- **Inshore series:** primary = Scratch entry; alias = HPH entry.

To deduplicate and collect all scoring entries per boat:

```python
from collections import defaultdict

aliases_of = defaultdict(list)  # primary_id -> [alias_id, ...]
for k, v in comps.items():
    target = v.get("compalias", "0")
    if target != "0":
        aliases_of[target].append(k)

for k, v in comps.items():
    if v.get("compalias", "0") != "0":
        continue  # skip alias entries

    all_entries = {v["compfleet"]: v}
    for alias_key in aliases_of.get(k, []):
        alias = comps[alias_key]
        all_entries[alias["compfleet"]] = alias

    # all_entries now maps fleet string -> competitor record for this boat
```

## Fleet / class naming

The `compfleet` value includes a scoring-system suffix:

| Example value         | Base class       | Scoring system |
|-----------------------|------------------|----------------|
| `"Class 1 IRC"`       | `Class 1`        | IRC            |
| `"Class 1 HPH"`       | `Class 1`        | HPH            |
| `"Non Spin Class 4 HPH"` | `Non Spin Class 4` | HPH         |
| `"H17 Scr"`           | `H17`            | Scratch        |
| `"Squib HPH"`         | `Squib`          | HPH            |
| `"Pup 22 Scr"`        | `Pup 22`         | Scratch        |

Known suffixes: `" HPH"`, `" IRC"`, `" Scr"`. Strip the last word to get the base class.

```python
SCORING_SUFFIXES = [" HPH", " IRC", " Scr"]

def strip_scoring_suffix(fleet):
    for suffix in SCORING_SUFFIXES:
        if fleet.endswith(suffix):
            return fleet[:-len(suffix)]
    return fleet
```

## Ratings

- **HPH/NHC:** a decimal multiplier, e.g. `0.962`. Progressive — `comprating` is the
  rating at series start, `compnewrating` is the updated value after the series.
- **IRC:** a TCC decimal, e.g. `0.944`. Fixed for the series.
- **Scratch:** always `1` or `1.000`. Not interesting as a column value.

## Races and results

`"races"` entries hold race metadata (date, name, start times, etc.).

`"results"` entries link a competitor to a race:

| Field         | Description                                      |
|---------------|--------------------------------------------------|
| `rescompid`   | Competitor ID (matches key in `competitors`)     |
| `resraceid`   | Race ID (matches key in `races`)                 |
| `reselapsed`  | Elapsed time in seconds                          |
| `rescorrected`| Corrected time in seconds                        |
| `respoints`   | Points scored in this race                       |
| `rescode`     | Result code if not a finish (DNS, DNF, DSQ, etc.)|
| `resplace`    | Finishing position                               |
| `resdiscard`  | `"1"` if this result is a discard                |

## Series globals of interest

From `globals`:

| Key                    | Description                                   |
|------------------------|-----------------------------------------------|
| `serevent`             | Event name                                    |
| `servenue`             | Venue / fleet name                            |
| `serpubgroupvalues`    | Pipe-separated list of published group names  |
| `serscoringhandle`     | ID of the active scoring system               |
| `serdatespec`          | Date format string (e.g. `"d/m/y"`)           |
