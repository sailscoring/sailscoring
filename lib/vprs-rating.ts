/**
 * VPRS TCC ratings — fetch + parse (#175).
 *
 * Source: the per-club rating listings published by Stoneways VPRS at
 * `vprs.org`. Each club has its own page, e.g. Dublin Bay Sailing Club at
 *
 *     https://vprs.org/dublin_bay_ratings_2026.html
 *
 * A page is a static HTML table, one row per boat:
 *
 *     Yacht | Design | {year} TCC | No spin | Issued
 *
 * The yacht name links to the boat's certificate PDF, whose filename embeds the
 * sail number (`boomerang_irl1367_cert_2026.pdf` → `IRL1367`). The listing
 * table itself carries no sail-number column, so the certificate href is the
 * only place the sail number appears — we read it from there to match boats.
 *
 * Every boat carries two coefficients: the standard (spinnaker) "TCC" and a
 * "No spin" (non-spinnaker) TCC, exactly like IRC's TCC / Non-Spi TCC split.
 * A boat rated without a downwind sail shows `-` in the spin column and only a
 * no-spin value. The scorer's per-fleet spin/non-spin choice (handled in
 * `source-handicaps.ts`) decides which one seeds a boat's `vprsTcc`.
 *
 * VPRS is used time-on-time (`CT = ET × TCC`), so a TCC drops straight into the
 * static-TCF scoring path — see `getTCF` in `scoring.ts`.
 *
 * Terms boundary (see `docs/design/horizon.md`): the data is provided for
 * verifying the VPRS TCCs of boats racing under VPRS — applying a published TCC
 * to score a VPRS event is that intended use. Fetch per-event for the club
 * being scored rather than mirroring the whole site.
 *
 * This module is pure apart from {@link fetchVprsRatings}, the single I/O seam,
 * which the API route wraps in caching. The parser is unit-tested against a
 * saved HTML fixture.
 */

/** One boat's row from a VPRS club listing. Numeric fields are `undefined`
 *  when the source cell is blank or `-` (a boat rated for one sail plan only).
 *  `vprsTcc` is the spinnaker coefficient; `vprsNonSpinTcc` the non-spinnaker
 *  one. */
export interface VprsRatingRecord {
  /** Derived from the certificate filename, e.g. `"IRL1367"`, `"GBR605"`,
   *  `"433"`. Match against competitor sail numbers via `rating-match.ts`. */
  sailNumber: string;
  boatName?: string;
  /** Boat design / class as published, e.g. `"Beneteau First 36.7"`. */
  design?: string;
  /** Spinnaker TCC (the "{year} TCC" column). */
  vprsTcc?: number;
  /** Non-spinnaker TCC (the "No spin" column). */
  vprsNonSpinTcc?: number;
  /** Issue date as published, e.g. `"19 Mar"`. Provenance only. */
  issued?: string;
}

export interface VprsRatings {
  /** When the source page was last regenerated, from the HTTP `Last-Modified`
   *  header formatted `DD/MM/YYYY`, or `null` if unavailable. */
  updatedAt: string | null;
  records: VprsRatingRecord[];
}

// ─── HTML parsing ─────────────────────────────────────────────────────────────

/** Decode the handful of HTML entities that appear in VPRS boat names / designs
 *  (the page is ISO-8859-1 plain text apart from these). */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ');
}

/** Strip tags from a `<td>` cell's inner HTML and collapse whitespace. */
function cellText(inner: string): string {
  return decodeEntities(inner.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Parse a TCC cell. `-`, `-.---` and blank all mean "no value for this sail
 *  plan". */
function parseTcc(cell: string): number | undefined {
  const t = cell.trim();
  if (!t || /^-+(\.-+)?$/.test(t)) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/** Extract the sail number from a certificate href. The filename is
 *  `{name-slug}_{sail}_cert_{year}.pdf`; the sail is the `_`-separated segment
 *  immediately before `_cert_`. Returns `''` when the href doesn't match. */
export function sailFromCertHref(href: string): string {
  const file = href.split('/').pop() ?? href;
  const beforeCert = file.split(/_cert_/i)[0];
  if (beforeCert === file) return ''; // no `_cert_` marker — not a cert link
  const seg = beforeCert.split('_').pop() ?? '';
  return seg.toUpperCase();
}

/**
 * Parse a VPRS club listing HTML page into typed records.
 *
 * Older seasons are kept on the page inside HTML comments, so comments are
 * stripped first — only the live (current-season) rows are returned. A row is a
 * `<tr>` whose first cell links to a certificate PDF; rows without the standard
 * five cells (Yacht / Design / TCC / No spin / Issued) are skipped defensively.
 */
export function parseVprsListing(html: string): VprsRatingRecord[] {
  // Drop commented-out prior-season blocks before matching any rows.
  const live = html.replace(/<!--[\s\S]*?-->/g, '');

  const records: VprsRatingRecord[] = [];
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(live)) !== null) {
    const rowHtml = rowMatch[1];
    const hrefMatch = /href\s*=\s*"?([^"\s>]*_cert_[^"\s>]*\.pdf)"?/i.exec(rowHtml);
    if (!hrefMatch) continue; // not a data row

    const sailNumber = sailFromCertHref(hrefMatch[1]);
    if (!sailNumber) continue;

    const cells: string[] = [];
    const cellRe = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRe.exec(rowHtml)) !== null) {
      cells.push(cellMatch[1]);
    }
    // Standard row: Yacht | Design | TCC | No spin | Issued.
    if (cells.length < 5) continue;

    const boatName = cellText(cells[0]);
    const design = cellText(cells[1]);
    const vprsTcc = parseTcc(cellText(cells[2]));
    const vprsNonSpinTcc = parseTcc(cellText(cells[3]));
    const issued = cellText(cells[4]);

    records.push({
      sailNumber,
      ...(boatName ? { boatName } : {}),
      ...(design ? { design } : {}),
      ...(vprsTcc != null ? { vprsTcc } : {}),
      ...(vprsNonSpinTcc != null ? { vprsNonSpinTcc } : {}),
      ...(issued ? { issued } : {}),
    });
  }
  return records;
}

/** Format an HTTP `Last-Modified` date as `DD/MM/YYYY`, or `null`. Mirrors the
 *  IRC source so the UI shows provenance consistently. */
export function formatLastModified(lastModified: string | null): string | null {
  if (!lastModified) return null;
  const d = new Date(lastModified);
  if (Number.isNaN(d.getTime())) return null;
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}

/**
 * Fetch and parse a VPRS club listing. The single network seam in this module;
 * callers (the API route) wrap it in caching. `listingUrl` is the per-club page
 * (e.g. `https://vprs.org/dublin_bay_ratings_2026.html`) — VPRS publishes a
 * separate page per club, and a boat's TCC can differ between club listings, so
 * the caller picks the right one for the event being scored.
 */
export async function fetchVprsRatings(listingUrl: string): Promise<VprsRatings> {
  const res = await fetch(listingUrl, {
    headers: {
      'user-agent':
        'Mozilla/5.0 (compatible; SailScoring/1.0; +https://app.sailscoring.ie)',
    },
  });
  if (!res.ok) {
    throw new Error(`VPRS ratings fetch failed: HTTP ${res.status}`);
  }
  const records = parseVprsListing(await res.text());
  return { updatedAt: formatLastModified(res.headers.get('last-modified')), records };
}
