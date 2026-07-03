/**
 * racingrulesofsailing.org (RRS.org) competitor push — the pure payload
 * layer. RRS.org runs the protest / jury side of many events and imports the
 * competitor list via a documented API; see
 * `docs/notes/rrs-org/competitor-import-api.md` for the contract.
 *
 * This module is pure — no `server-only`, no fetch — so the same builder runs
 * client-side (dialog preview, CSV-relay assembly) and is unit-testable; the
 * actual POST happens in `lib/api-handlers/rrs-org.ts`, because the event
 * UUID is the API's only credential and belongs on the server-to-RRS.org hop.
 */

import type { Competitor, Fleet, RrsOrgPushConfig } from './types';

export const RRS_ORG_API_URL = 'https://www.racingrulesofsailing.org/api/competitors';

/** The payload's `source` field. RRS.org validates it against a whitelist —
 *  an unregistered value is rejected with 422 `unrecognized_source` — so this
 *  must stay the value its AI-import documentation prescribes until RRS.org
 *  registers a Sail Scoring-specific one. */
export const RRS_ORG_SOURCE = 'rrs-ai-import';

/** One competitor as RRS.org's API expects it. Field names are the API's.
 *  Every field is a string; absent values are empty strings, never null. */
export interface RrsOrgCompetitor {
  competitor_id: string;
  sail_number: string;
  country_code: string;
  first_name: string;
  last_name: string;
  boat_name: string;
  boat_class: string;
  division: string;
  club_name: string;
  email: string;
  phone: string;
  mna_code: string;
  mna_number: string;
}

/** Contact / membership fields relayed from a CSV import straight to RRS.org.
 *  Deliberately never stored: contact details belong to the entry system, not
 *  the scoring engine. `mnaCode` is only for the odd sheet where it differs
 *  from the competitor's nationality (the default source). */
export interface RrsOrgRelayFields {
  email?: string;
  phone?: string;
  mnaCode?: string;
  mnaNumber?: string;
}

export interface RrsOrgBuildWarning {
  competitorId: string;
  /** Sail number, for display — warnings are shown to the scorer by boat. */
  sailNumber: string;
  message: string;
}

/**
 * The outcome of a push, as returned by POST /api/v1/series/:id/rrs-org-push.
 * An rrs.org rejection is an expected result the dialog renders (with a
 * retry), not a thrown error: by the time the push runs, any accompanying CSV
 * import has already committed locally, so the caller needs the failure as
 * data. Defined here (not in the server-only handler) so the client can
 * import the type.
 */
export interface RrsOrgPushResult {
  ok: boolean;
  /** Rows sent (ok) or attempted (!ok). */
  pushed: number;
  /** Upstream HTTP status when !ok. */
  status?: number;
  /** Upstream response body (truncated) when !ok. */
  message?: string;
}

export interface RrsOrgBuildResult {
  competitors: RrsOrgCompetitor[];
  warnings: RrsOrgBuildWarning[];
  /** How many rows carried at least one relay (contact/membership) field —
   *  surfaced in the completion summary because a later push without them
   *  blanks those fields on RRS.org (the API replaces, never merges). */
  relayCount: number;
}

/**
 * International dialing prefixes keyed by three-letter national letters (RRS
 * Appendix G / IOC), covering the sailing nations we expect in entry lists.
 * Used to convert nationally-formatted phone numbers ("086 123 4567") to the
 * international format RRS.org requires ("+353861234567"). A nationality
 * missing here just means the number can't be auto-converted — it is sent
 * blank and warned about, never guessed.
 */
const DIALING_CODES: Record<string, string> = {
  IRL: '353', GBR: '44', USA: '1', CAN: '1', AUS: '61', NZL: '64',
  FRA: '33', GER: '49', NED: '31', BEL: '32', ESP: '34', POR: '351',
  ITA: '39', SUI: '41', AUT: '43', DEN: '45', SWE: '46', NOR: '47',
  FIN: '358', ISL: '354', POL: '48', CZE: '420', SVK: '421', HUN: '36',
  GRE: '30', TUR: '90', UKR: '380', ROU: '40', BUL: '359', CRO: '385',
  SLO: '386', SRB: '381', EST: '372', LAT: '371', LTU: '370', MLT: '356',
  CYP: '357', LUX: '352', MON: '377', AND: '376', GIB: '350', JPN: '81',
  KOR: '82', CHN: '86', HKG: '852', TPE: '886', SGP: '65', MAS: '60',
  THA: '66', IND: '91', INA: '62', PHI: '63', VIE: '84', UAE: '971',
  QAT: '974', KUW: '965', BRN: '973', OMA: '968', ISR: '972', RSA: '27',
  EGY: '20', MAR: '212', TUN: '216', KEN: '254', NGR: '234', BRA: '55',
  ARG: '54', CHI: '56', URU: '598', PER: '51', COL: '57', VEN: '58',
  MEX: '52', GUA: '502', PAN: '507', ECU: '593', BER: '1', BAH: '1',
  BAR: '1', TTO: '1', JAM: '1', PUR: '1', ISV: '1', IVB: '1', CAY: '1',
  ANT: '1', DOM: '1',
};

/**
 * Normalise a phone number to the international format RRS.org requires
 * (`+<dialing code><subscriber number>`). Returns null when the number can't
 * be resolved confidently — callers send blank and warn rather than guess.
 *
 * - Already international (`+…` or `00…`) → canonicalised as-is.
 * - Otherwise, converted via the nationality's dialing prefix, dropping the
 *   national trunk `0` ("086 123 4567" + IRL → "+353861234567").
 */
export function normalizePhone(raw: string, nationality?: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Keep a leading +, drop all other punctuation/whitespace. A "(0)" trunk
  // hint inside an international number ("+44 (0)1234…") drops with it.
  const hasPlus = trimmed.startsWith('+');
  let digits = trimmed.replace(/\(0\)/g, '').replace(/\D/g, '');
  if (!digits) return null;
  if (hasPlus) return `+${digits}`;
  if (digits.startsWith('00')) {
    digits = digits.slice(2);
    return digits ? `+${digits}` : null;
  }
  const dialCode = nationality ? DIALING_CODES[nationality] : undefined;
  if (!dialCode) return null;
  const national = digits.replace(/^0/, '');
  if (!national) return null;
  return `+${dialCode}${national}`;
}

/** Split a display name into RRS.org's first/last slots: first token vs the
 *  rest. A single-token name goes wholly into `last_name`, per the API's own
 *  rule that `last_name` doubles as the full-name field. */
export function splitName(name: string): { first: string; last: string } {
  const trimmed = name.trim();
  const space = trimmed.indexOf(' ');
  if (space < 0) return { first: '', last: trimmed };
  return { first: trimmed.slice(0, space), last: trimmed.slice(space + 1).trim() };
}

/** The value RRS.org's single `division` slot gets for one competitor. */
function divisionFor(
  competitor: Competitor,
  config: Pick<RrsOrgPushConfig, 'divisionSource' | 'divisionAxisId'>,
  fleetNameById: Map<string, string>,
): string {
  switch (config.divisionSource) {
    case 'none':
      return '';
    case 'fleet':
      // Multi-fleet competitors are real (a boat can race Scratch and HPH);
      // RRS.org has one slot, so join the memberships.
      return competitor.fleetIds
        .map((id) => fleetNameById.get(id))
        .filter((name): name is string => !!name)
        .join(' / ');
    case 'axis':
      return (config.divisionAxisId && competitor.subdivisions?.[config.divisionAxisId]) || '';
  }
}

/**
 * Build the RRS.org competitor rows for a push. `relay` carries any
 * CSV-relayed contact/membership fields keyed by competitor id (absent for a
 * push-only flow — those fields go blank, which the UI states up front).
 */
export function buildRrsOrgCompetitors(
  competitors: Competitor[],
  fleets: Fleet[],
  config: Pick<RrsOrgPushConfig, 'divisionSource' | 'divisionAxisId'>,
  relay?: Map<string, RrsOrgRelayFields>,
): RrsOrgBuildResult {
  const fleetNameById = new Map(fleets.map((f) => [f.id, f.name]));
  const warnings: RrsOrgBuildWarning[] = [];
  let relayCount = 0;

  const rows = competitors.map((c): RrsOrgCompetitor => {
    const r = relay?.get(c.id);
    if (r && (r.email || r.phone || r.mnaCode || r.mnaNumber)) relayCount++;

    // The person RRS.org wants is the skipper/helm: the helm field when it's
    // recorded separately (owner-primary series), otherwise the primary name.
    const { first, last } = splitName(c.helm || c.name);

    let phone = '';
    if (r?.phone?.trim()) {
      const normalized = normalizePhone(r.phone, c.nationality);
      if (normalized) {
        phone = normalized;
      } else {
        warnings.push({
          competitorId: c.id,
          sailNumber: c.sailNumber,
          message: `phone "${r.phone.trim()}" could not be converted to international format; sent blank`,
        });
      }
    }

    return {
      competitor_id: c.id,
      sail_number: c.sailNumber,
      country_code: c.nationality ?? '',
      first_name: first,
      last_name: last,
      boat_name: c.boatName ?? '',
      boat_class: c.boatClass ?? '',
      division: divisionFor(c, config, fleetNameById),
      club_name: c.club,
      email: r?.email?.trim() ?? '',
      phone,
      // World Sailing MNA codes share the national-letters vocabulary, so the
      // nationality is the default; a distinct CSV column can override it.
      mna_code: r?.mnaCode?.trim() || c.nationality || '',
      mna_number: r?.mnaNumber?.trim() ?? '',
    };
  });

  return { competitors: rows, warnings, relayCount };
}

/** The full request body for `POST https://www.racingrulesofsailing.org/api/competitors`. */
export function buildRrsOrgPayload(eventUuid: string, competitors: RrsOrgCompetitor[]): {
  uuid: string;
  source: string;
  competitors: RrsOrgCompetitor[];
} {
  return { uuid: eventUuid, source: RRS_ORG_SOURCE, competitors };
}
