/**
 * The sign in/out sheet: the register a club keeps ashore, which each helm
 * signs before launching and, at clubs that keep both halves, again on
 * coming back in. Sailing instructions make it a rule — miss it and the boat
 * takes a scoring penalty — so the office prints a fresh one every race day.
 *
 * One row per boat: the sail number, its class, who is expected to sign, and
 * room for the signature. The same sheet serves both halves; the club ticks
 * which one it is, so a sign-out copy and a sign-in copy can be told apart
 * on the desk and in the file.
 *
 * The boats are grouped as the starters checklist groups them when it has no
 * start sequence: one table per fleet, except that fleets sharing a boat
 * merge, so a boat scored under two systems is listed (and signed for) once.
 * Unlike the checklist, the start sequence plays no part. The sheet is filled
 * in ashore, where people look themselves up by fleet, and two classes that
 * share a start are still two fleets on the board.
 */
import { formatPrimaryNames, PRIMARY_PERSON_LABEL_TEXT } from './competitor-fields';
import { groupEntriesByStart, type FleetLike } from './starters-checklist';
import type { CompetitorFieldKey, PrimaryPersonLabel } from './types';

export interface SignInOutRow {
  sailNumber: string;
  boatClass?: string;
  /** Who is expected to sign: the helm where the series knows it, otherwise
   *  the competitor's primary name. */
  person: string;
}

export interface SignInOutTable {
  /** The fleet's name; null on a series with one fleet, or for boats in none. */
  heading: string | null;
  rows: SignInOutRow[];
}

export interface SignInOutSheet {
  /** "Helm" when the sheet lists helms, otherwise the series' own label for
   *  the primary person ("Owner", "Competitor"). */
  personHeader: string;
  /** Whether the Class column is printed: the series records the class and
   *  at least one boat on the sheet has one. */
  showClass: boolean;
  tables: SignInOutTable[];
}

export function buildSignInOutSheet(input: {
  fleets: FleetLike[];
  competitors: {
    sailNumber: string;
    fleetIds: string[];
    boatClass?: string;
    names: string[];
    helms?: string[];
  }[];
  primaryPersonLabel: PrimaryPersonLabel;
  enabledCompetitorFields: readonly CompetitorFieldKey[];
}): SignInOutSheet {
  const { primaryPersonLabel, enabledCompetitorFields } = input;
  // The register is signed by the helm. A helm-primary series names them as
  // its primary person; another series may record them separately, and
  // where it does not, the primary name is the best the sheet can do.
  const helmsRecorded =
    primaryPersonLabel !== 'helm' &&
    enabledCompetitorFields.includes('helm') &&
    input.competitors.some((c) => (c.helms ?? []).some((h) => h.trim()));
  const personOf = (c: { names: string[]; helms?: string[] }): string => {
    const helms = helmsRecorded ? formatPrimaryNames(c.helms ?? []) : '';
    return helms || formatPrimaryNames(c.names);
  };
  const classRecorded = enabledCompetitorFields.includes('boatClass');

  const groups = groupEntriesByStart({ fleets: input.fleets, competitors: input.competitors });
  const tables = groups.map(({ heading, entries }) => ({
    heading,
    rows: entries.map((c): SignInOutRow => ({
      sailNumber: c.sailNumber,
      ...(classRecorded && c.boatClass?.trim() ? { boatClass: c.boatClass.trim() } : {}),
      person: personOf(c),
    })),
  }));

  return {
    personHeader:
      primaryPersonLabel === 'helm' || helmsRecorded ? 'Helm' : PRIMARY_PERSON_LABEL_TEXT[primaryPersonLabel],
    showClass: tables.some((t) => t.rows.some((r) => r.boatClass)),
    tables,
  };
}
