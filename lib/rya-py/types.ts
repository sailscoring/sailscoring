/**
 * RYA Portsmouth Yardstick handicap data — types shared by the generated
 * dataset (`generated/py-list.ts`) and the class matcher (`class-match.ts`).
 *
 * Pure: no `server-only`, no DB, no network. The dataset is bundled into the
 * build (regenerated at most once a year from the RYA's published lists — see
 * `scripts/generate-rya-py.ts`), so there is no fetch/cache seam the way IRC and
 * Irish Sailing have. The RYA Class ID is the join key between the PY number
 * lists and the official class register (`reference/data/rya-py/rya-classes.csv`).
 */

/** Which RYA list an entry came from, lowest-confidence last. The base list is
 *  the national list; experimental and limited-data numbers are "a guide only"
 *  per the RYA's own wording, so the dialog flags them. */
export type RyaPyTier = 'base' | 'experimental' | 'limited-data';

/** One class configuration with a published PY number. */
export interface RyaPyClass {
  /** RYA Class ID — the register key. Absent for the long tail of limited-data
   *  classes the RYA has not assigned an ID to (matched by name only). */
  classId?: number;
  /** Canonical class name: the register's "Class Name" when `classId` is set,
   *  otherwise the name as printed on the limited-data list. */
  name: string;
  /** The register's machine "Standard Name" slug (a second match key); absent
   *  for no-ID rows. */
  slug?: string;
  /** The published Portsmouth Number. Corrected time = elapsed × 1000 / number. */
  number: number;
  tier: RyaPyTier;
  /** Crew / rig / spinnaker from the register (or the list, for no-ID rows).
   *  Shown for disambiguation; not used in scoring. */
  crew?: number;
  rig?: string;
  spinnaker?: string;
  /** Limited-data list only: the last year the class was returned to the RYA,
   *  and the total number of years of returns. Surfaced as provenance. */
  lastReturn?: number;
  returns?: number;
}

export interface RyaPyVersion {
  /** The list year, from the document titles ("Portsmouth Number List 2026"). */
  year: number;
  /** Version numbers printed on each list. */
  base: string;
  limitedData: string;
}
