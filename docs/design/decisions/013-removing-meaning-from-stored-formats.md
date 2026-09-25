# ADR-013: Removing meaning from stored formats

**Status:** Accepted

**Date:** 2026-09-25

**Deciders:** Mark McLoughlin

## Context

Until now, every change to a stored shape has added to it: a new optional
field, a new enum value, a single value becoming a list. Readers kept
accepting every old version, and upgrading one was mechanical.

#636 is the first change that removes meaning. Split-fleet configuration is
being rebuilt from the three championships actually scored with it. Settings
that only the format survey ever needed (`carry: 'rank-seed'`,
`split: 'fixed-top'`, `equalization: 'exclude-extra-scores'` and others)
leave the model, and several settings become fixed behaviour. The known
population is verified to be unaffected. But a stored shape lives in more
places than the database:

| Where | Can we rewrite it? |
|---|---|
| Live rows (`series.qf_config` and the like) | Yes |
| `series_revision` snapshots | We could, but a revision records what the series was |
| `.sailscoring` files on scorers' disks | No |
| Published `.sailscoring.json` sidecars (ADR-012) | We could, but they are frozen published artifacts |
| Downloaded sidecars, and data embedded in standalone and FTP pages | No |

So a removal has to say what happens to every copy we can't reach. This ADR
sets the rules, for #636 and for the removals that will follow it.

## Decision Drivers

- **Never rescore a championship silently.** A file that opens and scores
  differently than it did when it was saved is the worst outcome available.
  It looks correct.
- **Old files keep opening wherever that is honest.** ADR-012 made the public
  export a compatibility commitment, and the `.sailscoring` format has kept
  every version readable since v1.
- **The model is allowed to shrink.** Carrying every variant forever to
  protect files nobody has is how the split-fleet configuration got here.

## Considered Options

### Option 1: Never remove anything

Keep every value readable and scorable forever, and hide the unused ones from
the UI.

**Pros:** No file ever stops opening.
**Cons:** The engine, the validation, the SI generator and the fixtures keep
carrying code no scored event uses. The complexity stays; only the UI gets
smaller.

### Option 2: Map removed values to the nearest kept one

Upgrade `rank-seed` to `points`, `fixed-top` to `equal-blocks`, and so on.

**Pros:** Every file opens.
**Cons:** A file that used a removed scoring rule opens with different
results and no indication why. This breaks the first driver.

### Option 3: Stop reading old versions

Drop the old version numbers from the supported lists.

**Pros:** The simplest possible reader.
**Cons:** It refuses every old file, including the ones that never used a
removed value. The failure is far wider than the change.

### Option 4: Upgrade by class of change

Upgrade what can be upgraded honestly, and refuse, naming the setting, only
what would score differently.

## Decision

Option 4, as seven rules.

1. **Readers never drop a version.** `SUPPORTED_FORMAT_VERSIONS` and
   `SUPPORTED_EXPORT_VERSIONS` only grow. A removal comes with an upgrader
   from the old shape.

2. **One upgrader per change, called from every entry point.** For the series
   file, that is a step in `migrateSeriesFileObject`, which already covers
   file import and revision restore. For the public export, the import path
   calls the same function. One function, one set of tests.

3. **Each removed value is classified by whether it can change a result:**
   - **Lossless:** the stored value is the one kept as fixed behaviour. Drop
     it.
   - **Presentational:** labels, wording, layout. Upgrade to the new behaviour
     even where it differs, and record the change in the format's version
     notes.
   - **Scoring:** a value that would score differently. **Refuse the import**
     with a message naming the setting. The file stays openable in an older
     release, so nothing is lost, and the refusal is the signal that a real
     event needs the variant back.
   - **Scoring, but immaterial for the data present:** accept it, and state
     the check in the upgrader. For example, when a medal carry takes effect
     only matters if the medal fleet was selected and no medal race was
     completed.

4. **The database holds only the current shape.** A migration rewrites the
   live rows, so repository reads don't carry the upgrader forever. A change
   to jsonb content follows the same expand-contract rules as DDL (DEPLOY.md,
   "Schema migrations"): the previous build must read the rewritten rows, and
   the new build must tolerate a row the previous build writes in the seconds
   between migration and cutover.

5. **Migrations assert their preconditions.** Before rewriting, a migration
   that removes meaning raises an exception if any row holds a scoring-class
   value. "We checked production" then holds at every deploy: production,
   every preview fork, and every local database.

6. **Versions follow each format's own rules.** A removal or change of meaning
   bumps the `.sailscoring` format version and the public export version, and
   each gets a line in its version notes (`lib/series-file.ts`,
   `docs/public-export-format.md`). Published sidecars are not rewritten. They
   stay at their version until the page is republished.

7. **Deleted fixtures become upgrader tests.** A scoring fixture for a removed
   variant is replaced by a test that its configuration is refused. The known
   events' shapes get tests showing they upgrade losslessly, and golden tests
   showing their published exports still score to their published standings.

## Consequences

### Positive

- The model can shrink without carrying dead variants to protect files that
  don't exist.
- No championship is ever rescored under rules it wasn't saved with.
- A refusal names the missing feature, which turns an unknown user into a
  concrete request.

### Negative

- A file using a removed scoring variant can't be opened in the current app.
  Its owner needs an older release, or the variant has to come back.
- Each removal costs an upgrader, a guarded migration, two version bumps and
  their tests, even when the known population is empty.

### Risks

- **An upgrader misclassifies a scoring value as presentational.** The golden
  tests catch this for the known events. For anything else the defence is the
  review of the classification, which is why it is stated in the upgrader
  rather than left implicit.
- **A copy nobody knew about exists and gets refused.** The message names the
  setting, points to an earlier release, and says where to ask for the
  setting back.

## Related Decisions

- [ADR-008](008-full-stack-transition.md): the Postgres data layer and its
  migrations
- [ADR-012](012-data-behind-published-results.md): the public export as a
  versioned compatibility commitment

## References

- #636: the split-fleet configuration rebuild, the first change under these
  rules
- `docs/design/split-fleets/configuration.md`: what #636 removes, and which
  class each removal falls into
- `DEPLOY.md`, "Schema migrations": expand-contract
