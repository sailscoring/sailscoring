# Sailwave import behaviour

`lib/sailwave-import.ts` is the source of truth; the rules below document what
it does with a real HYC Sailwave 2.38 export. (The HYC reference data this was
derived against now lives in the `hyc-archive` sibling repo —
`../hyc-archive/2026-club-racing/`.)

A Sailwave `.blw` file is the native series document — a flat, four-column CSV
of `key,value,compHandle,raceHandle` records. The importer pivots it into the
same nested shape Sailwave's own JSON export produced and works off that.

## What the importer handles

- **Sailwave's two non-standard JSON quirks** — trailing commas before `}` /
  `]`, and bare `\r` / `\t` inside string fields. Decoded as cp1252 so
  non-UTF-8 helm names survive.
- **Dual-scoring aliases** — Sailwave models "score this Squib both under HPH
  and under Scratch" by creating a primary record and an alias record per
  boat. The importer collapses each pair to one Competitor with multi-fleet
  membership (`fleetIds: [hph, scr]`), which is exactly how our model works.
- **Per-fleet ratings** — when `comprating` is populated, it goes into
  `nhcStartingTcf` for HPH-suffix fleets and `ircTcc` for IRC-suffix fleets.
  Scratch fleets ignore ratings.
- **Fleet scoring system inference** — `" HPH"` → `nhc`, `" IRC"` → `irc`,
  `" Scr"` → `scratch`. Bare names (e.g. `Division B`) default to `nhc`;
  override per-fleet in the wizard.
- **Discard profile** — the root scoring system's `scrdiscardlist` (a CSV of
  cumulative discard counts indexed by races-sailed − 1) is run-length
  compressed into series-wide `discardThresholds`. Per-fleet child systems set
  `scrfollowdiscards: "1"` and inherit the root, so reading
  `globals.serscoringhandle` is complete. Detected, not authoritative — edit it
  in **Settings** after import.
- **DNF / DNS scoring base (A5.2 vs A5.3) and representability** —
  `analyzeSailwaveScoring` inspects the whole scoring-code config (the root
  system plus any per-fleet child systems) and picks the closest base our engine
  can represent: `Boats in series + 1` → A5.2 (`seriesEntries`), `Boats in race
  + 1` → A5.3 (`startingArea`). DNF drives the series-wide choice; codes that
  `Score like DNF` follow it. Each code's expected base is read from the engine's
  own `scoring-codes` registry (so e.g. BFD is treated as a starters-base code,
  not entries). Anything it *can't* reproduce — a `Finishers + N` base, a `+ N`
  with N≠1, a config where codes disagree on A5.2 vs A5.3, an unrecognised
  method, or a per-fleet child system whose codes diverge from the root — is
  reported as a `SailwaveScoringWarning` on the preview and shown in the wizard's
  Detected card. The import is **never blocked**: it proceeds with the closest
  base (A5.2 when nothing is representable), and the scorer adjusts in Settings.
- **Race cadence** — the wizard's race-days option walks forward from the start
  date placing each race on the next matching weekday; Tue/Sat alternates the
  two. Leave it empty to stamp every race with the start date and let the scorer
  fix dates per-race in the Races tab.
- **Per-race starts** — Sailwave records each gun in `races[*].starts` as a
  pipe-delimited string (`Fleet^Puppeteer HPH^…|19.15.00|…`). The importer
  pulls out the fleet name and time, then fans the gun out across companion
  fleets sharing the same base name (so `Puppeteer HPH` and `Puppeteer Scr`
  both attach to one start signal).
- **Race results** — `results` rows with `rrestyp=4` become finishes with
  `finishTime` and `sortOrder` (derived from `rpos`). `rrestyp=3` rows
  become coded finishes (`DNC`/`DNF`/`RET`/etc.). `rrestyp=0` rows are
  skipped. Primary+alias result rows for the same boat are deduped to one
  finish per competitor. The wizard's ignore-results toggle skips the `results`
  table entirely (useful when re-seeding a series mid-season).
- **Excluded competitors** — Sailwave's `compexclude == "1"` entries are
  dropped.

## What the importer does NOT carry across

- **Sailwave globals beyond name/venue** — FTP path, style, burgee, scoring
  system parameters, prizes, columns. All scorer-configurable in the app.
- **Computed result fields** (`comprank`, `comptotal`, `compnett`,
  `compnewrating`, `rcor`, `rele`, `rpts`, `rewin`, `rrwin`) — Sailscoring
  recomputes these from the underlying finishes and ratings, so we discard
  Sailwave's pre-computed values rather than risk drift.
- **Per-race result discards** (`rdisc`) — Sailscoring applies discards via
  `discardThresholds` series-wide, so per-result discard markers don't carry.
  The series-wide *rule* is detected separately from the root scoring system's
  `scrdiscardlist` (see "What the importer handles").
