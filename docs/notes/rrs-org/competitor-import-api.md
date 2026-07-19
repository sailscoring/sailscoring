# RRS.org competitor-import API — contract and import learnings

Captured from a real import (the 2026 GP14 Leinsters entry list, pushed by an AI
assistant following RRS.org's published "AI import" instructions, July 2026).
racingrulesofsailing.org (RRS.org) now documents this flow itself: a help page
containing a ready-made prompt for an AI assistant that maps a spreadsheet's
columns to their API fields and POSTs the result. That page is, in effect, the
public API documentation that the horizon entry "Push competitor list to
racingrulesofsailing.org" said was missing — the integration contract no longer
needs to be reverse-engineered from the Sailwave plugin.

If the in-app feature is built (an "also import to RRS.org" option on the
Import Competitors CSV dialog), start here.

## The API

```
POST https://www.racingrulesofsailing.org/api/competitors
Content-Type: application/json
```

No auth header, no cookie, no API key: **the event UUID in the body is the
credential**. The scorer finds it on the RRS.org Event Panel (labelled *UUID*
in the event details section at the top). Treat it like a capability token —
don't log it or store it more visibly than necessary.

Request body:

```json
{
  "uuid": "<event UUID>",
  "source": "sailscoring",
  "competitors": [
    {
      "competitor_id": "1",
      "sail_number": "",
      "country_code": "",
      "first_name": "",
      "last_name": "",
      "boat_name": "",
      "boat_class": "",
      "division": "",
      "club_name": "",
      "email": "",
      "phone": "",
      "mna_code": "",
      "mna_number": ""
    }
  ]
}
```

Payload rules (from RRS.org's documentation, confirmed in practice):

- **Empty string, not null**, for any field with no value.
- **`competitor_id` is required and must be unique** per row. Any stable
  identifier works; row number as a string is the documented fallback.
- `sail_number` may optionally carry a nationality prefix (`"GBR 1234"`);
  `country_code` is a separate 3-letter IOC/World Sailing code. We sent them
  separately (plain number + code) and that was accepted.
- `phone` must be international format (`+441234567890`). Numbers that can't
  be resolved should be sent empty rather than malformed.
- `mna_code` is the World Sailing MNA abbreviation. RRS.org's own docs are
  loose here — the field table says "standard three-letter IOC country
  abbreviations" while the tips give examples like "RYA" and "US Sailing" —
  so expect tolerance, but IOC-style codes are the safe choice.
- `last_name` doubles as the full-name field: if a name can't be split, put
  the whole thing in `last_name` and leave `first_name` empty.
- `source` identifies the client and is **validated against a whitelist**:
  an unregistered value is rejected with HTTP 422
  `{"errors":["unrecognized_source"]}`. We send `"sailscoring"`, which RRS.org
  registered for us in July 2026; before that we sent the generic
  `"rrs-ai-import"` from their AI-import documentation.

## Response and error semantics

- **HTTP 200 with an empty body** on success — no JSON echo, no per-record
  report in the response.
- 200 means the import as a whole was accepted **even if individual records
  had warnings** (e.g. unresolvable phone numbers). Per-record problems are
  recorded on the RRS.org Event Panel, not returned to the caller — so the
  UI should link the scorer to the Event Panel to review, rather than
  promising the response told us everything.
- Non-200 returns an error body to surface to the user.

## Replace-not-merge semantics

Each API import **replaces all competitors previously imported via the API**
for that event: prior API-imported rows are marked deleted and recreated from
the submitted data. Consequences:

- Re-running the same import is idempotent and safe.
- Manual edits made *inside RRS.org* to API-imported competitors are lost on
  the next push.
- Competitors entered manually in RRS.org (never via API) are untouched.

An in-app feature must therefore always push the **full** list, never a delta,
and should say so in the confirm step ("this replaces the list previously
pushed to RRS.org").

## Field mapping to/from the Sail Scoring competitor model

| RRS.org field   | Sail Scoring `Competitor` | Notes |
|-----------------|---------------------------|-------|
| `competitor_id` | `id` (or row number)      | Any stable unique string. Using our competitor `id` keeps re-pushes coherent. |
| `sail_number`   | `sailNumber`              | Send plain; nationality goes in `country_code`. |
| `country_code`  | `nationality`             | Same 3-letter IOC/national-letters vocabulary. |
| `first_name` / `last_name` | `helm` / `name` (per `primaryPersonLabel`) | We store one name string; split on first space, whole string into `last_name` when unsplittable. |
| `boat_name`     | `boatName`                | |
| `boat_class`    | `boatClass`               | For one-design events this is a constant; default it from the series/fleet. |
| `division`      | fleet name / `subdivisions` | Closest match; needs a per-import decision. |
| `club_name`     | `club`                    | |
| `email`         | — not stored              | Deliberately: contact details belong to the entry system, not the scoring engine (see horizon.md). Relay from the CSV at import time; never persist. |
| `phone`         | — not stored              | Same; plus the international-format fix-up. |
| `mna_code`      | — not stored              | Relay-only, as above. |
| `mna_number`    | — not stored              | Relay-only, as above. |

Sail Scoring fields RRS.org has **no** slot for: `owner` and `crewName` (and
`gender`/`age`/handicap data, unsurprisingly). Owner and crew are simply
dropped in the push — worth stating in the dialog so a scorer of a two-person
class isn't surprised the crew names don't appear on RRS.org.

## Worked example — 2026 GP14 Leinsters

Entry-list CSV columns: `Entry #, National Lettering, Sail Number, Boat Name,
Club, Other Club, Owner Name, Helm Name, Crew Name`. 30 entries; imported to
the event in one POST, HTTP 200.

Mapping decisions an importer has to make (all of which the in-app feature
would face too):

- `Entry #` → `competitor_id`. The sheet had a gap (no entry 21) — ids need
  not be contiguous.
- `National Lettering` → `country_code`; blank for several rows, sent as `""`.
- `Helm Name` → split into first/last on the first space. One row had a bare
  first name ("Diarmaid") → whole value into `last_name`.
- `boat_class` = `"GP14"` for every row — inferred from the event, not
  present in the CSV. An import UI wants a "constant value" affordance per
  field, not just column mapping.
- `Owner Name`, `Crew Name`, `Other Club` — no RRS.org field; dropped.
- No email/phone/MNA columns existed, so the validation steps were moot; a
  real club entry list from an entry system often will have them, and that's
  exactly the data we relay without storing.
- Data quality was left as-found (casing like "Sam street", a probable
  "Bran"/"Brian" typo): the push is a transport, not a cleanup pass.

## Feature sketch — "Import to RRS.org" in the CSV import dialog

Extend the existing Import Competitors CSV dialog (`app/series/[id]/competitors/`)
rather than building a separate flow:

1. A checkbox/section: **"Also import to RRS.org"**, revealing an
   **Event UUID** field (persist it on the series so re-pushes don't require
   re-pasting — it's per-event, like the Sailwave plugin's workflow).
2. The column-mapping step gains targets for the RRS-only fields (`email`,
   `phone`, `mna_code`, `mna_number`) which are **relayed and discarded** —
   they must never land in the Sail Scoring data model.
3. Phone normalisation to international format using `country_code` for the
   dialing prefix; unresolvable numbers sent empty and listed in the summary.
4. Confirm step states the replace semantics and the dropped fields
   (owner/crew), then POSTs; on 200, link to the RRS.org Event Panel for the
   per-record warning review.
5. A later "re-push" action (competitor list changed after import) can reuse
   the stored UUID — but emails/phones only exist at CSV-import time, so a
   re-push from stored data alone loses them; either re-import from CSV or
   accept blank contact fields. This asymmetry is inherent to the
   don't-store-contact-details stance and should be surfaced, not hidden.

The POST must be made **server-side** (a `/api/v1` handler or server action),
not from the browser — cross-origin aside, the payload carries the event UUID
credential and the relay-only contact details, both better kept off the wire
between client and RRS.org.
