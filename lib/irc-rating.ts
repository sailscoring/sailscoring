/**
 * International IRC TCC ratings — fetch + parse (#168 follow-up).
 *
 * Source: the worldwide IRC valid-rating listing published by the RORC/UNCL
 * IRC Rating Office. Its official "online TCC listings" page
 * (`ircrating.org/irc-racing/online-tcc-listings/`) is an embedded view of the
 * same data, whose own download link is the CSV we read here:
 *
 *     https://www.topyacht.com.au/rorc/data/ClubListing.csv
 *
 * The file is hosted by TopYacht on the rating authority's behalf, but it *is*
 * the authority's data — RORC publishes IRC TCCs nowhere else (its separate
 * boat-data PDFs deliberately omit the rating). We fetch and parse the CSV
 * ourselves rather than embedding TopYacht's listing UI. One GET returns the
 * full worldwide list (~3,200 boats), regenerated nightly (UK time).
 *
 * Terms boundary (see `docs/design/horizon.md`): the data is provided for
 * verifying IRC TCCs of boats competing in IRC events — applying a published
 * TCC to score an IRC event is that intended use. IRC TCCs must never feed
 * ECHO computation (ECHO is itself a rating, sourced separately from Irish
 * Sailing), and we cache transiently to seed series being scored rather than
 * mirroring the database.
 *
 * This module is pure apart from {@link fetchIrcRatings}, the single I/O seam,
 * which the API route wraps in caching. The parser is unit-tested against a
 * saved CSV fixture.
 */

export const IRC_RATING_LISTING_URL =
  'https://www.topyacht.com.au/rorc/data/ClubListing.csv';

/** One boat's IRC certificate row from the worldwide listing. Numeric fields
 *  are `undefined` when the source cell is blank; strings likewise. A boat
 *  holding more than one certificate appears as more than one record sharing a
 *  sail number — a primary plus a secondary (`isSecondary`) for an alternative
 *  sail configuration. */
export interface IrcRatingRecord {
  /** As published, e.g. `"IRL1431"`, `"GBR7027"`. Match against competitor sail
   *  numbers via the helpers in `rating-match.ts` — never raw. */
  sailNumber: string;
  boatName?: string;
  /** Spinnaker IRC TCC (the "TCC" column). */
  ircTcc?: number;
  /** Non-spinnaker IRC TCC (the "Non Spi TCC" column). */
  ircNonSpinTcc?: number;
  /** IRC certificate number (the "Cert No" column) — the stable id used to
   *  distinguish a boat's primary and secondary certificates. */
  ircCertNumber?: string;
  /** Certificate year (the "Cert Year" column). */
  certYear?: string;
  /** Certificate issue date (the "Issue Date" column), as published. */
  issueDate?: string;
  /** From the "Secondary" column (`SEC`) — an alternative sail configuration.
   *  Cleaner than the Irish Sailing list's `"(SC)"` name suffix. */
  isSecondary: boolean;
  /** From the "Endorsed" column (`E`). Shown for sanity-checking, not written. */
  endorsed?: boolean;
}

export interface IrcRatings {
  /** When the source file was last regenerated, from the HTTP `Last-Modified`
   *  header formatted `DD/MM/YYYY`, or `null` if unavailable. Surfaced for
   *  provenance in the UI. */
  updatedAt: string | null;
  records: IrcRatingRecord[];
}

// ─── CSV parsing ────────────────────────────────────────────────────────────

/**
 * Split one CSV line into fields. RFC-4180-tolerant: handles double-quoted
 * fields with embedded commas and escaped (`""`) quotes. The live ClubListing
 * has no quoting today, but boat names are free text, so we parse defensively.
 */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(field);
      field = '';
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out;
}

/** Resolve each field's column index from the header row by name (normalised
 *  to lowercase single-spaced), so a reordered or widened file still maps. */
function resolveColumns(headers: string[]): Record<string, number> {
  const norm = headers.map((h) => h.toLowerCase().replace(/\s+/g, ' ').trim());
  const find = (name: string) => norm.indexOf(name);
  return {
    boatName: find('boat name'),
    sailNumber: find('sail no'),
    certNumber: find('cert no'),
    issueDate: find('issue date'),
    certYear: find('cert year'),
    tcc: find('tcc'),
    endorsed: find('endorsed'),
    secondary: find('secondary'),
    nonSpiTcc: find('non spi tcc'),
    validCode: find('validcode'),
  };
}

function num(s: string | undefined): number | undefined {
  if (s === undefined) return undefined;
  const t = s.trim();
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

function str(s: string | undefined): string | undefined {
  const t = s?.trim();
  return t ? t : undefined;
}

/**
 * Parse the ClubListing CSV into typed IRC records.
 *
 * Skips rows that aren't valid certificates (`ValidCode != "Yes"`) and rows
 * with no sail number. Throws if the header row or the Sail No column can't be
 * found — that signals the file format changed and the caller should surface a
 * clear error rather than silently returning nothing.
 */
export function parseClubListing(csv: string): IrcRatingRecord[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) {
    throw new Error('IRC ClubListing is empty — the source file may have changed.');
  }
  const headers = splitCsvLine(lines[0]);
  const col = resolveColumns(headers);
  if (col.sailNumber === -1) {
    throw new Error(
      'IRC ClubListing is missing the Sail No column — the file format may have changed.',
    );
  }
  const at = (cells: string[], i: number) => (i >= 0 ? cells[i] : undefined);

  const records: IrcRatingRecord[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    // Only valid certificates. When the column is absent, keep the row.
    if (col.validCode >= 0) {
      const valid = at(cells, col.validCode)?.trim().toLowerCase();
      if (valid && valid !== 'yes') continue;
    }
    const sailNumber = str(at(cells, col.sailNumber));
    if (!sailNumber) continue;
    records.push({
      sailNumber,
      boatName: str(at(cells, col.boatName)),
      ircTcc: num(at(cells, col.tcc)),
      ircNonSpinTcc: num(at(cells, col.nonSpiTcc)),
      ircCertNumber: str(at(cells, col.certNumber)),
      certYear: str(at(cells, col.certYear)),
      issueDate: str(at(cells, col.issueDate)),
      isSecondary: at(cells, col.secondary)?.trim().toUpperCase() === 'SEC',
      endorsed: at(cells, col.endorsed)?.trim().toUpperCase() === 'E' ? true : undefined,
    });
  }
  return records;
}

/** Format an HTTP `Last-Modified` date as `DD/MM/YYYY`, or `null` if unparseable. */
export function formatLastModified(lastModified: string | null): string | null {
  if (!lastModified) return null;
  const d = new Date(lastModified);
  if (Number.isNaN(d.getTime())) return null;
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}

/**
 * Fetch and parse the live IRC ClubListing. The single network seam in this
 * module; callers (the API route) wrap it in caching. The CSV is served
 * without any access gate, so a plain GET returns the whole list.
 */
export async function fetchIrcRatings(): Promise<IrcRatings> {
  const res = await fetch(IRC_RATING_LISTING_URL, {
    headers: {
      'user-agent':
        'Mozilla/5.0 (compatible; SailScoring/1.0; +https://app.sailscoring.ie)',
    },
  });
  if (!res.ok) {
    throw new Error(`IRC ratings fetch failed: HTTP ${res.status}`);
  }
  const records = parseClubListing(await res.text());
  return { updatedAt: formatLastModified(res.headers.get('last-modified')), records };
}
