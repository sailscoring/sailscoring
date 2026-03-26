# Series File Format

The format used when saving a series to a file or opening a series from a file.
The file is a JSON document with a `.sailscoring` extension.

---

## Purpose

The series file is the unit of exchange between scorers sharing work via
shared storage (Google Drive, Dropbox, email, etc.). It is a complete
snapshot of a series at a point in time: all series configuration,
competitors, races, and results.

The file format also supports conflict detection via a snapshot lineage
chain, allowing the application to warn scorers when they are about to
overwrite changes made by another scorer (or their own earlier work).

---

## Top-Level Structure

```json
{
  "formatVersion": 1,
  "seriesId": "a1b2c3d4-...",
  "snapshotId": "e5f6a7b8-...",
  "snapshotHistory": ["a0b0c0d0-...", "a1b2c3d4-...", "e5f6a7b8-..."],
  "exportedAt": "2025-09-14T14:32:00Z",
  "series": { ... },
  "competitors": [ ... ],
  "races": [ ... ]
}
```

### Envelope fields

| Field | Type | Description |
|-------|------|-------------|
| `formatVersion` | integer | Format version number. Currently `1`. Increment if the schema changes in a backwards-incompatible way. |
| `seriesId` | UUID string | Stable identifier for the series across all copies and all exports. Assigned when the series is first created; preserved across all subsequent exports. |
| `snapshotId` | UUID string | Unique identifier for this specific export. A new UUID is generated on every Save to File. |
| `snapshotHistory` | UUID string[] | Append-only ordered list of all `snapshotId` values from every previous export of this series lineage, ending with the current `snapshotId`. Used for conflict detection — see [Lineage and Conflict Detection](#lineage-and-conflict-detection). |
| `exportedAt` | ISO 8601 string | Timestamp of this export in UTC. |

---

## `series` Object

Corresponds to the `Series` type in `lib/types.ts`, plus scoring configuration
fields (to be extended as scoring features are added).

```json
{
  "id": "a1b2c3d4-...",
  "name": "HYC Autumn League 2025",
  "venue": "Howth Yacht Club",
  "startDate": "2025-09-01",
  "endDate": "2025-11-30"
}
```

The `series.id` is the same value as the top-level `seriesId`.

---

## `competitors` Array

One object per competitor. Corresponds to the `Competitor` type in
`lib/types.ts`.

```json
[
  {
    "id": "comp-uuid-...",
    "sailNumber": "IRL 1234",
    "name": "J Murphy",
    "club": "HYC",
    "fleet": "Junior",
    "division": "Gold"
  }
]
```

Internal IDs (`id`) are preserved across exports so that `Finish` references
remain valid when a file is re-imported into the same series. When a file is
opened as a new series (not an update), new IDs are generated.

---

## `races` Array

One object per race. Each race embeds its finishes, so the file is
self-contained.

```json
[
  {
    "id": "race-uuid-...",
    "raceNumber": 1,
    "date": "2025-09-07",
    "finishes": [
      {
        "id": "finish-uuid-...",
        "competitorId": "comp-uuid-...",
        "finishPosition": 1,
        "resultCode": null
      },
      {
        "id": "finish-uuid-...",
        "competitorId": "comp-uuid-...",
        "finishPosition": null,
        "resultCode": "DNS"
      }
    ]
  }
]
```

Calculated fields (`RaceScore`, `Standing`) are not included in the file.
They are always derived from the stored data on load.

---

## Lineage and Conflict Detection

### The problem

Scorers share series files via external storage (Google Drive, etc.). Because
the application auto-saves all changes to IndexedDB, a scorer can unknowingly
work on a stale local copy while another scorer has published a newer version
to shared storage. When the first scorer later tries to update their local
series from the newer file, the application needs to determine whether the
incoming file is a clean continuation of the local version, or whether both
have diverged.

### The mechanism

Every export appends the new `snapshotId` to `snapshotHistory`. The history
is the complete ordered lineage of all exports in this series' chain:

```
Scorer A creates series, exports → snapshotHistory: [S1]
Scorer B opens S1, scores Race 1, exports → snapshotHistory: [S1, S2]
Scorer C opens S2, scores Race 2, exports → snapshotHistory: [S1, S2, S3]
```

The local series tracks `lastSnapshotId`: the `snapshotId` of the most
recent file it was saved to or opened from.

### Conflict check on Update from File

When a scorer uses **Update from File** on an existing local series, the
application compares the incoming file's `snapshotHistory` against the local
`lastSnapshotId`:

| Condition | Meaning | Warning level |
|-----------|---------|---------------|
| `local.lastSnapshotId` is in `incoming.snapshotHistory` | Incoming is a direct descendant. Local is behind, but the lineage is clean. | Low — confirm and proceed |
| `incoming.snapshotId == local.lastSnapshotId` | Identical snapshot — nothing to update. | Informational — no action needed |
| `local.lastSnapshotId` is **not** in `incoming.snapshotHistory` | Lineage has forked. Both copies have changes the other doesn't. | High — explicit override required |
| `incoming.exportedAt < local.lastModifiedAt` (regardless of lineage) | Incoming file is older than local changes. Possibly re-uploading a stale file. | High — explicit override required |

No merge is performed. The scorer either accepts the incoming file (replacing
local state) or cancels. The conflict warning shows timestamps and export
history to help the scorer decide.

### Local series with no file history

A series created locally (not opened from a file) has no `lastSnapshotId`
until it is first saved to a file. When such a series is saved for the first
time:

- A `seriesId` is assigned if not already present.
- `snapshotHistory` begins with the new `snapshotId`: `[S1]`.
- `lastSnapshotId` is set to `S1` locally.

### History growth

The history grows by one entry per Save to File, regardless of whether the
file was subsequently shared. This means intermediate saves (a scorer hitting
Save to File multiple times during a session) are all recorded. This is
intentional: if another scorer happens to open one of those intermediate
snapshots, the lineage check will correctly identify it as an ancestor.

The history is an append-only log. Entries are never removed. For a realistic
series (dozens to low hundreds of saves), the history is negligible in size
(~36 bytes per UUID).

---

## File Naming

Suggested filename on Save to File:

```
{series-name-slugified}.sailscoring
```

For example: `hyc-autumn-league-2025.sailscoring`

The application generates this filename automatically. The scorer can rename
the file as needed; the filename has no effect on the format or the lineage
check.

---

## Versioning

`formatVersion` is incremented only on backwards-incompatible schema changes.
The application can refuse to open files with a `formatVersion` it does not
recognise, and should display a clear message directing the scorer to upgrade
the application.

Additive changes (new optional fields) do not require a version increment.
