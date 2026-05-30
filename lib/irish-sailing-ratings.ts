/**
 * Irish Sailing IRC & ECHO ratings — fetch + parse (#168).
 *
 * Source: https://www.sailing.ie/Racing/Racing-Services/Echo-IRC-Ratings
 *
 * The page is a DotNetNuke site that server-renders the *entire* national
 * ratings list into a single HTML table (`<table id="dt">`); DataTables.js
 * adds client-side search / sort / paginate / CSV+Excel export on top, but
 * there is no API, JSON endpoint, or server-side download — one GET returns
 * the complete dataset. So we fetch the page and parse that table.
 *
 * This module is pure (no `server-only`, no network) apart from
 * {@link fetchIrishSailingRatings}, which is the single I/O seam. The parser
 * is a direct TS port of the committed reference scraper
 * (`reference/data/irc-echo-ratings/fetch_irc_echo_ratings.py`) and is unit
 * tested against a saved HTML fixture.
 */

export const IRISH_SAILING_RATINGS_URL =
  'https://www.sailing.ie/Racing/Racing-Services/Echo-IRC-Ratings';

/** One boat's row from the national ratings table. Numeric fields are
 *  `undefined` when the source cell is blank (e.g. an ECHO-only boat has no
 *  IRC TCC). Strings are likewise omitted when blank. */
export interface IrishSailingRating {
  /** As published, e.g. `"IRL1431"`. Match against competitor sail numbers
   *  via {@link normalizeSailNumber} — never raw. */
  sailNumber: string;
  boatName?: string;
  model?: string;
  owner?: string;
  club?: string;
  /** The "20NN ECHO" value — the boat's current ECHO standard. Seeded as the
   *  ECHO starting handicap; there is no spinnaker/non-spinnaker split. */
  echo?: number;
  echoCertDate?: string;
  ircCertNumber?: string;
  /** Spinnaker IRC TCC. */
  ircTcc?: number;
  /** Non-spinnaker IRC TCC ("IRC Non Spinnaker TCC" column). */
  ircNonSpinTcc?: number;
  ircCertDate?: string;
}

export interface IrishSailingRatings {
  /** The "last updated DD/MM/YYYY @ HH:MM" stamp from the page, verbatim, or
   *  `null` if absent. Surfaced for provenance in the UI. */
  updatedAt: string | null;
  records: IrishSailingRating[];
}

// Sail-number / boat-name matching is source-neutral and lives in
// `rating-match.ts` (shared with the international IRC source). Re-exported
// here for the callers and tests that have long imported them from this module.
export {
  normalizeBoatName,
  normalizeSailNumber,
  sailNumberParts,
  sailNumbersMatch,
  type IrcTccVariant,
  type SailNumberParts,
} from './rating-match';

// ─── HTML parsing ─────────────────────────────────────────────────────────────

const TABLE_ID = 'dt';

/** Decode the HTML entities that appear in the source: numeric (decimal and
 *  hex) plus the five standard named entities. Numeric covers the accented
 *  characters in boat names (e.g. `&#243;` → `ó`). */
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/** Strip tags, decode entities, collapse whitespace, trim. */
function cellText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

/** Slice out the `<table id="...">…</table>` block. Tables on the page are not
 *  nested, so the first `</table>` after the opening tag is ours. */
function sliceTable(html: string, tableId: string): string | null {
  const idIdx = html.indexOf(`id="${tableId}"`);
  if (idIdx === -1) return null;
  const open = html.lastIndexOf('<table', idIdx);
  const close = html.indexOf('</table>', idIdx);
  if (open === -1 || close === -1) return null;
  return html.slice(open, close);
}

function extractCells(rowHtml: string, tag: 'th' | 'td'): string[] {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
  const cells: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(rowHtml)) !== null) cells.push(cellText(m[1]));
  return cells;
}

/** Parse a numeric cell; blank → undefined, non-numeric → undefined. */
function num(s: string | undefined): number | undefined {
  if (s === undefined || s === '') return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function str(s: string | undefined): string | undefined {
  return s === undefined || s === '' ? undefined : s;
}

/**
 * Resolve the column index for each field from the header row. Matching is by
 * normalised header text so the year prefix on the ECHO column
 * ("2026 ECHO" → "2027 ECHO" next season) doesn't break it.
 */
function resolveColumns(headers: string[]): Record<string, number> {
  const norm = headers.map((h) => h.toLowerCase().replace(/\s+/g, ' ').trim());
  const find = (pred: (h: string) => boolean) => norm.findIndex(pred);
  return {
    sailNumber: find((h) => h === 'sail number'),
    boatName: find((h) => h === 'boat name'),
    model: find((h) => h === 'model'),
    owner: find((h) => h === 'owner'),
    club: find((h) => h === 'main club'),
    echo: find((h) => /^\d{4} echo$/.test(h)),
    echoCertDate: find((h) => h === 'echo cert date'),
    ircCertNumber: find((h) => h === 'irc cert number'),
    ircTcc: find((h) => h === 'irc tcc'),
    ircNonSpinTcc: find((h) => h === 'irc non spinnaker tcc'),
    // The IRC certificate date column header is bare "Certificate Date"
    // (distinct from "ECHO Cert Date").
    ircCertDate: find((h) => h === 'certificate date'),
  };
}

const UPDATED_AT_RE =
  /last updated\s*<strong>\s*([^<]+?)\s*<\/strong>/i;

/**
 * Parse the Irish Sailing ratings page HTML into typed records.
 *
 * Returns `{ updatedAt, records }`. A row with no sail number is skipped.
 * Throws if the `#dt` table or its header row can't be found — that signals
 * the page layout changed and the caller should surface a clear error rather
 * than silently returning nothing.
 */
export function parseIrishSailingRatings(html: string): IrishSailingRatings {
  const table = sliceTable(html, TABLE_ID);
  if (table === null) {
    throw new Error(
      `Could not find table id="${TABLE_ID}" — the Irish Sailing page layout may have changed.`,
    );
  }

  // The markup puts <th> cells directly inside <thead> with no <tr> wrapper,
  // so read the header cells from the whole <thead> block.
  const theadMatch = /<thead\b[^>]*>([\s\S]*?)<\/thead>/i.exec(table);
  const headers = theadMatch ? extractCells(theadMatch[1], 'th') : [];
  if (headers.length === 0) {
    throw new Error(
      'Irish Sailing ratings table has no header row — the page layout may have changed.',
    );
  }
  const col = resolveColumns(headers);
  if (col.sailNumber === -1) {
    throw new Error(
      'Irish Sailing ratings table is missing the Sail Number column — the page layout may have changed.',
    );
  }

  const tbodyMatch = /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i.exec(table);
  const tbody = tbodyMatch ? tbodyMatch[1] : '';
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  const at = (cells: string[], i: number) => (i >= 0 ? cells[i] : undefined);

  const records: IrishSailingRating[] = [];
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(tbody)) !== null) {
    const cells = extractCells(rm[1], 'td');
    if (cells.length === 0) continue;
    const sailNumber = str(at(cells, col.sailNumber));
    if (!sailNumber) continue;
    records.push({
      sailNumber,
      boatName: str(at(cells, col.boatName)),
      model: str(at(cells, col.model)),
      owner: str(at(cells, col.owner)),
      club: str(at(cells, col.club)),
      echo: num(at(cells, col.echo)),
      echoCertDate: str(at(cells, col.echoCertDate)),
      ircCertNumber: str(at(cells, col.ircCertNumber)),
      ircTcc: num(at(cells, col.ircTcc)),
      ircNonSpinTcc: num(at(cells, col.ircNonSpinTcc)),
      ircCertDate: str(at(cells, col.ircCertDate)),
    });
  }

  const updatedAt = UPDATED_AT_RE.exec(html)?.[1] ?? null;
  return { updatedAt: updatedAt ? cellText(updatedAt) : null, records };
}

/**
 * Fetch and parse the live Irish Sailing ratings page. The single network
 * seam in this module; callers (the API route) wrap it in caching.
 */
export async function fetchIrishSailingRatings(): Promise<IrishSailingRatings> {
  const res = await fetch(IRISH_SAILING_RATINGS_URL, {
    headers: {
      // The site serves a trimmed response to unrecognised agents.
      'user-agent':
        'Mozilla/5.0 (compatible; SailScoring/1.0; +https://app.sailscoring.ie)',
    },
  });
  if (!res.ok) {
    throw new Error(`Irish Sailing ratings fetch failed: HTTP ${res.status}`);
  }
  return parseIrishSailingRatings(await res.text());
}
