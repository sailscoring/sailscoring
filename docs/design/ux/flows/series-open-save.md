# Series Open and Save Flow

Detailed user flow for working with series files: saving a series to a file,
opening a series from a file, and updating a local series from a newer file.

See `docs/design/series-file-format.md` for the file format and lineage
detection mechanism.

---

## Overview

Scorers working with co-scorers, or across multiple devices, use a
shared storage location (Google Drive, Dropbox, email, etc.) as their
exchange point. The typical session looks like:

1. Download the latest series file from shared storage
2. Open the file in Sail Scoring
3. Do work (enter results, correct data)
4. Save to file
5. Upload the file to shared storage

This workflow is modelled on "file open / save" in desktop scoring tools
such as Sailwave, not on cloud sync. The scorer is responsible for
downloading the latest version before starting work and uploading after
finishing. The application supports this by making the save state visible
and warning when incoming files appear to conflict with local work.

### Scorers who are not sharing files

Scorers who work alone and do not exchange files with co-scorers may never
need to save or open files at all — IndexedDB retains all data automatically.
For these scorers, the file workflow is available but not prominent. See
[De-emphasis for local-only series](#de-emphasis-for-local-only-series).

---

## Actions

There are three file-related actions. The language for the native
`.sailscoring` round-trip stays close to desktop "open / save" terminology.
"Import" is reserved for one-way conversion from other tools (Sailwave).

| Action | Where | When to use |
|--------|-------|-------------|
| **Import Series** | Series list (G-01) | Open a `.sailscoring` file or convert a Sailwave export |
| **Save to File** | Series settings (S-01) | Save current state to a file for backup or sharing |
| **Update from File** | Series settings (S-01) | Pull in changes from a file made by another scorer |

---

## Import Series (G-01)

The **Import Series** button appears on the Series List screen alongside
**New Series**.

```
┌────────────────────────────────────────────────────────────────────────┐
│  Sail Scoring                                              [⚙ Settings] │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [New Series]   [Import Series]                                         │
│                                                                         │
│  HYC Autumn League 2025         last saved to file: 3 days ago  [Open] │
│  IODAI Nationals 2025           never saved to file             [Open] │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

Clicking **Import Series** opens a format-choice dialog:

```
┌─ Import Series ────────────────────────────┐
│  What kind of file would you like to       │
│  import?                                   │
│                                            │
│  ○ Sail Scoring file (.sailscoring)        │
│  ○ Sailwave export (.json)                 │
│                                            │
│                                  [Cancel]  │
└────────────────────────────────────────────┘
```

- **Sail Scoring file** opens a `.sailscoring` file picker and runs the flow
  documented below (lineage check, disambiguation).
- **Sailwave export** opens a `.json` file picker and routes to the Sailwave
  wizard at `/series/import-sailwave` — see
  [Sailwave imports](#sailwave-imports-import-sailwave) below.

### If the series is not already on this device

The file is opened and a new local series is created. The scorer is taken
directly to the Races screen for the series.

### If a series with the same `seriesId` already exists locally

A disambiguation dialog appears:

```
┌───────────────────────────────────────────────────────────────────┐
│  "HYC Autumn League 2025" is already on this device               │
│                                                                   │
│  The file you opened and the copy on this device are the same     │
│  series. What would you like to do?                               │
│                                                                   │
│  [Update this device's copy]   [Open as a new copy]   [Cancel]   │
└───────────────────────────────────────────────────────────────────┘
```

**Update this device's copy** runs the lineage check (same as
[Update from File](#update-from-file-s-01) below) and proceeds if the
scorer confirms.

**Open as a new copy** creates a second local series from the file. The
name is disambiguated by appending " (2)" (or the next available number)
to avoid confusion with the existing copy. The scorer should delete
whichever copy is no longer needed.

### If a series with the same name but a different `seriesId` exists locally

No disambiguation is shown. The file is opened as a new series (a
different series that happens to share a name). Both series remain on the
device independently.

---

## Sailwave imports (`/series/import-sailwave`)

Choosing **Sailwave export** from the format dialog routes to a dedicated
wizard. Sailwave doesn't store a series start date or weekday cadence in its
JSON, so a one-shot configuration step is unavoidable.

The wizard shows a detected preview (name, venue, competitor/race/fleet
counts, A5.2/A5.3 inference) and a form: basics (name, venue, workspace),
schedule (start date — required, race days, end date), per-fleet scoring
overrides for bare-name fleets, primary person label, drop-Scratch and
ignore-results toggles.

On submit the wizard builds a `SeriesFile` in memory and routes it through
the same `openSeriesFromFile` write path the `.sailscoring` flow uses. Every
Sailwave import always creates a new series — there is no lineage to check
because the file didn't come from this app.

`lib/sailwave-import.ts` is the source of truth for the conversion rules
(alias collapse, scoring-suffix detection, start-gun fan-out across companion
fleets, DNF inference); the sibling README at
`reference/data/2026-hyc-club-racing/README.md` documents them in depth.

---

## Save to File (S-01)

Available from the Series Settings screen. Generates a `.sailscoring` file
and triggers a browser download.

```
┌─ File ────────────────────────────────────────────────────────────┐
│  Last saved: today at 14:32                                       │
│                                                                   │
│  [Save to File]                                                   │
└───────────────────────────────────────────────────────────────────┘
```

On save:

1. A new `snapshotId` is generated.
2. The new `snapshotId` is appended to `snapshotHistory`.
3. The file is written and downloaded.
4. The local series updates `lastSnapshotId` and `lastSavedAt`.

The suggested filename is `{series-name-slugified}.sailscoring`.

### Unsaved changes indicator

If the series has been modified since the last Save to File, a subtle
indicator appears near the series name or in the File card:

```
│  Last saved: yesterday at 17:01  · modified since last save       │
```

This is informational only — it does not block the scorer from working.
It is the scorer's cue to save and upload before finishing their session.

The indicator is absent for series that have never been saved to a file,
because for those series the concept of "unsaved changes" does not apply
in the same way — all data is safely in IndexedDB regardless.

---

## Update from File (S-01)

Available from the Series Settings screen. Used when another scorer (or
the same scorer on another device) has done work and published a newer
file to shared storage.

```
┌─ File ────────────────────────────────────────────────────────────┐
│  Last saved: today at 14:32                                       │
│                                                                   │
│  [Save to File]   [Update from File]                              │
└───────────────────────────────────────────────────────────────────┘
```

The scorer clicks **Update from File**, selects a `.sailscoring` file,
and the application runs a lineage check.

### Lineage check outcomes

**Clean update** — the incoming file descends from the local copy (local
`lastSnapshotId` appears in the file's `snapshotHistory`):

```
┌───────────────────────────────────────────────────────────────────┐
│  Update "HYC Autumn League 2025"?                                 │
│                                                                   │
│  This file is a newer version of your local copy.                │
│  Saved by another scorer on 14 Sep at 16:45.                     │
│                                                                   │
│  Your local copy will be replaced. This cannot be undone.        │
│                                                                   │
│  [Update]   [Cancel]                                              │
└───────────────────────────────────────────────────────────────────┘
```

**Identical snapshot** — the file matches the local copy exactly:

```
┌───────────────────────────────────────────────────────────────────┐
│  Nothing to update                                                │
│                                                                   │
│  This file matches your local copy. No changes were made.        │
│                                                                   │
│  [OK]                                                             │
└───────────────────────────────────────────────────────────────────┘
```

**Diverged** — the local copy has changes not in the incoming file, and
the incoming file has changes not in the local copy (lineage has forked),
or the incoming file is older than local changes:

```
┌───────────────────────────────────────────────────────────────────┐
│  ⚠  This file conflicts with your local copy                     │
│                                                                   │
│  This file and your local copy appear to have diverged — both    │
│  have changes the other doesn't.                                 │
│                                                                   │
│  This file:    saved 14 Sep at 12:10                             │
│  Local copy:   last modified 14 Sep at 14:32                     │
│                                                                   │
│  [Open as a new copy]   [Replace local copy]   [Cancel]          │
└───────────────────────────────────────────────────────────────────┘
```

The conflict dialog does not propose a merge. The scorer can open the
incoming file as a separate local copy (to compare the two versions and
decide what is correct), replace the local copy entirely with the incoming
file, or cancel.

### On confirmation

The local series is replaced entirely with the contents of the incoming
file. `lastSnapshotId` is updated to the incoming file's `snapshotId`.
The scorer is returned to the Races screen.

---

## De-emphasis for Local-Only Series

A series is considered **local-only** if it has never been saved to a file
and was not opened from a file. For these series:

- The **"modified since last save"** indicator is not shown. All changes
  are safely in IndexedDB; there is nothing to warn about.
- The File card in Series Settings is present but visually de-emphasised
  (lower visual weight, positioned below the primary setup cards).
- **Update from File** is not shown. It only appears once the series has
  been saved to a file at least once, establishing a file-based workflow.
- The Series List shows no "last saved" metadata for these series.

Once the scorer saves to a file for the first time, the series transitions
out of local-only mode. The full file workflow becomes available and the
save state indicator activates.

---

## Series List: Save State

The Series List shows the file save state per series, but only for series
with a file history:

```
│  HYC Autumn League 2025         last saved: today at 14:32  [Open] │
│  Cork Week 2025                 last saved: 3 days ago       [Open] │
│  Practice Series                                             [Open] │
```

"Practice Series" has no "last saved" label — it is a local-only series
and the absence of the label is itself the signal.

---

## Out of Scope

- **Navigate-away warning.** No `beforeunload` prompt when leaving a series with unsaved file changes. The scorer is responsible for saving before closing; the "modified since last save" indicator is the cue.
- **Race-level export.** The series file is the only unit of exchange. Partial handoffs are handled by manual correction after updating from the full series file.
