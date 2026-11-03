/**
 * RYA YTC (Yacht Time Correction) numbers — fetch + parse.
 *
 * Source: the RORC Rating Office's "RYA YTC Listings" page,
 *
 *     https://rorcrating.com/ryaytc/ryaytclistings
 *
 * which embeds a public Google Sheet of every current YTC certificate and tells
 * race organisers to download it as CSV "for import into scoring programs".
 * The sheet's CSV export is a single unauthenticated GET:
 *
 *     https://docs.google.com/spreadsheets/d/<sheet id>/export?format=csv
 *
 * Its header row:
 *
 *     Boat Name, Sail Number, Boat Type, Length - m, YTC, YTC White Sail, Club,
 *     District, Region, Country, Configuration, Provisional, Issue Date, EntryID
 *
 * Every boat carries two numbers: `YTC`, which assumes a spinnaker, and
 * `YTC White Sail`, the no-downwind-sail figure (equal to `YTC` for a boat
 * declared without a spinnaker). The scorer's per-fleet choice, handled in
 * `source-handicaps.ts`, decides which one seeds a boat's `ytcNumber` — the
 * same split as IRC's TCC / Non-Spi TCC.
 *
 * YTC is applied with the Portsmouth yardstick's maths (YTC Policy §6.2:
 * "Corrected Time = Elapsed Time × 1000 / YTC"), so a number drops straight
 * into the static-rating scoring path — see `ratingFieldTcf` in `scoring.ts`.
 *
 * The sheet id belongs to whoever maintains the sheet at the RORC, so it is read
 * from the listings page's embed on every fetch; the id below is the fallback
 * for a page we can no longer read. A second, older sheet is embedded on the
 * YTC landing page (no Country or Issue Date columns). It is not the source.
 *
 * The listing is fetched transiently, cached, to seed the series being scored;
 * it is never mirrored.
 *
 * This module is pure apart from {@link fetchYtcRatings}, the single I/O seam,
 * which the API route wraps in caching. The parser is unit-tested against a
 * saved CSV fixture.
 */

import Papa from 'papaparse';

export const YTC_LISTINGS_PAGE_URL = 'https://rorcrating.com/ryaytc/ryaytclistings';

/** The listing sheet embedded on {@link YTC_LISTINGS_PAGE_URL} as of November
 *  2026 — used only when the page can't be read or no longer embeds one. */
export const YTC_FALLBACK_SHEET_ID = '1Se2j64wyx_61Ux8GB08i4gK1M2TezDe8uhZQtZhhtkQ';

/** The CSV export of a Google Sheet. */
export function ytcSheetCsvUrl(sheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
}

/** YTC numbers on the current listing run from about 760 to 1365. Anything
 *  outside this band is a bad cell (the listing has carried a `-41693`), not a
 *  rating, and is dropped rather than scored. */
const MIN_PLAUSIBLE_YTC = 500;
const MAX_PLAUSIBLE_YTC = 2000;

/** One boat's certificate row from the YTC listing. */
export interface YtcRatingRecord {
  /** As published, e.g. `"IRL3062"`, `"GBR1007L"`, `"1552"` — often without a
   *  country prefix. Empty when the listing holds a placeholder (`0`, `N/A`,
   *  `TBC`…) rather than a number: such a boat can only be matched by name.
   *  Match against competitor sail numbers via `rating-match.ts`, never raw. */
  sailNumber: string;
  boatName?: string;
  /** Design as the listing names it, e.g. `"ELAN 31 1.85"`. Shown beside a
   *  match so the scorer can tell two boats of the same name apart. */
  boatType?: string;
  /** Hull length in metres. */
  lengthM?: number;
  /** The spinnaker YTC number (the "YTC" column). */
  ytc: number;
  /** The no-spinnaker number (the "YTC White Sail" column). */
  ytcWhiteSail?: number;
  club?: string;
  /** The club's country, not the boat's nationality. */
  country?: string;
  /** The listing's configuration code, e.g. `"SFIBFTNO"`. Undocumented; its
   *  first character appears to name the downwind sail (`S`, `A`, `C`, or `0`
   *  for none). Shown, never interpreted. */
  configuration?: string;
  /** A provisional certificate: the formula was stretched, and the RORC
   *  issues the number as "a starting point" for the club to adjust. Scored
   *  like any other; surfaced so the scorer knows. */
  provisional: boolean;
  /** Issue date as published, e.g. `"2026-08-13"`. */
  issueDate?: string;
  /** The listing's row id, unique per certificate. */
  entryId?: string;
}

export interface YtcRatings {
  /** The listing carries no date of its own (the CSV export sends no
   *  `Last-Modified`), so this is always `null`; each row's issue date is its
   *  provenance. Kept for the shape every rating source shares. */
  updatedAt: string | null;
  /** When Sail Scoring fetched the listing, as an ISO timestamp. */
  fetchedAt?: string;
  records: YtcRatingRecord[];
}

/** Sail-number cells that stand for "no number". */
const PLACEHOLDER_SAIL = /^(0+|n\/?a|tbc|tba|none|nil|no number|no sail number|unknown|-+|\?+)$/i;

/** A sail-number cell as a sail number, or `''` for a placeholder. */
export function ytcSailNumber(cell: string | undefined): string {
  const t = (cell ?? '').trim();
  return PLACEHOLDER_SAIL.test(t) ? '' : t;
}

function resolveColumns(headers: string[]): Record<string, number> {
  const norm = headers.map((h) => h.toLowerCase().replace(/\s+/g, ' ').trim());
  const find = (name: string) => norm.indexOf(name);
  return {
    boatName: find('boat name'),
    sailNumber: find('sail number'),
    boatType: find('boat type'),
    lengthM: find('length - m'),
    ytc: find('ytc'),
    ytcWhiteSail: find('ytc white sail'),
    club: find('club'),
    country: find('country'),
    configuration: find('configuration'),
    provisional: find('provisional'),
    issueDate: find('issue date'),
    entryId: find('entryid'),
  };
}

function num(s: string | undefined): number | undefined {
  const t = s?.trim();
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

function str(s: string | undefined): string | undefined {
  const t = s?.trim();
  return t ? t : undefined;
}

function plausibleYtc(n: number | undefined): number | undefined {
  return n != null && n >= MIN_PLAUSIBLE_YTC && n <= MAX_PLAUSIBLE_YTC ? n : undefined;
}

/**
 * Parse the YTC listing CSV into typed records.
 *
 * Skips rows with no plausible spinnaker number, and rows with neither a sail
 * number nor a boat name to match on. Throws if the header row lacks the Sail
 * Number or YTC column — that signals the sheet changed shape, and the caller
 * should surface a clear error rather than silently returning nothing.
 */
export function parseYtcListing(csv: string): YtcRatingRecord[] {
  // Google's export ends lines CRLF; a copy saved by hand may not, or may mix
  // the two, and papaparse settles on one newline for the whole file.
  const text = csv.replace(/\r\n?/g, '\n');
  const { data } = Papa.parse<string[]>(text, { header: false, skipEmptyLines: 'greedy', newline: '\n' });
  if (data.length === 0) {
    throw new Error('The YTC listing is empty — the sheet may have changed.');
  }
  const col = resolveColumns(data[0]);
  if (col.sailNumber === -1 || col.ytc === -1) {
    throw new Error(
      'The YTC listing is missing its Sail Number or YTC column — the sheet may have changed.',
    );
  }
  const at = (cells: string[], i: number) => (i >= 0 ? cells[i] : undefined);

  const records: YtcRatingRecord[] = [];
  for (const cells of data.slice(1)) {
    const ytc = plausibleYtc(num(at(cells, col.ytc)));
    if (ytc == null) continue;
    const sailNumber = ytcSailNumber(at(cells, col.sailNumber));
    const boatName = str(at(cells, col.boatName));
    if (!sailNumber && !boatName) continue;
    const whiteSail = plausibleYtc(num(at(cells, col.ytcWhiteSail)));
    const record: YtcRatingRecord = {
      sailNumber,
      ytc,
      provisional: at(cells, col.provisional)?.trim().toUpperCase() === 'TRUE',
    };
    if (boatName) record.boatName = boatName;
    const boatType = str(at(cells, col.boatType));
    if (boatType) record.boatType = boatType;
    const lengthM = num(at(cells, col.lengthM));
    if (lengthM != null) record.lengthM = lengthM;
    if (whiteSail != null) record.ytcWhiteSail = whiteSail;
    const club = str(at(cells, col.club));
    if (club) record.club = club;
    const country = str(at(cells, col.country));
    if (country) record.country = country;
    const configuration = str(at(cells, col.configuration));
    if (configuration) record.configuration = configuration;
    const issueDate = str(at(cells, col.issueDate));
    if (issueDate) record.issueDate = issueDate;
    const entryId = str(at(cells, col.entryId));
    if (entryId) record.entryId = entryId;
    records.push(record);
  }
  return records;
}

/** The id of the Google Sheet a listings page embeds, or `null` if none. */
export function findListingSheetId(html: string): string | null {
  const m = html.match(/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/);
  return m ? m[1] : null;
}

const USER_AGENT = 'Mozilla/5.0 (compatible; SailScoring/1.0; +https://app.sailscoring.ie)';

/** The sheet the listings page embeds today, or the fallback when the page
 *  can't be read or no longer names one. */
async function currentSheetId(): Promise<string> {
  try {
    const res = await fetch(YTC_LISTINGS_PAGE_URL, { headers: { 'user-agent': USER_AGENT } });
    if (res.ok) return findListingSheetId(await res.text()) ?? YTC_FALLBACK_SHEET_ID;
  } catch {
    // Fall through: the sheet itself may still be reachable.
  }
  return YTC_FALLBACK_SHEET_ID;
}

/**
 * Fetch and parse the live YTC listing. The single network seam in this
 * module; callers (the API route) wrap it in caching.
 */
export async function fetchYtcRatings(): Promise<YtcRatings> {
  const sheetId = await currentSheetId();
  const res = await fetch(ytcSheetCsvUrl(sheetId), { headers: { 'user-agent': USER_AGENT } });
  if (!res.ok) {
    throw new Error(`YTC listing fetch failed: HTTP ${res.status}`);
  }
  return {
    updatedAt: null,
    fetchedAt: new Date().toISOString(),
    records: parseYtcListing(await res.text()),
  };
}
