/**
 * ORC certificate source — fetch and parse the ORC active-certificates
 * database (data.orc.org).
 *
 * ORC publishes every active certificate per country in machine-readable
 * form (ORC Rating Systems rule 303.7: valid certificates are uploaded to
 * the ORC database and freely available in digital format). Two feeds are
 * combined here:
 *
 *  - `DownRMS` (JSON): the full certificate data — identity, the published
 *    single-number ratings, the national scoring options, and the
 *    time-allowance matrix. This is the document we store verbatim per
 *    competitor: the certificate is the rating, and modelling every field
 *    would only lose information. The payload also carries a
 *    `ScoringOptions` catalog describing every rating field name, which
 *    lets option pickers be driven by data rather than a hardcoded list.
 *  - `activecerts` (XML): the per-certificate index. The JSON record has no
 *    expiry or VPP-year fields, so both are read from here and merged in by
 *    reference number.
 *
 * A certificate belongs to a family — standard fully-crewed ('ORC'),
 * non-spinnaker ('NS'), or double-handed ('DH') — and a boat may hold one
 * valid certificate per family at a time (rules 301.3–301.5, 303.5). The
 * download is per country + family; country is the database's top-level
 * selector, and a certificate from any country's rating office is valid at
 * any event (rule 303.2).
 */

/** DownRMS `Family` parameter values (the JSON records carry the same codes). */
export type OrcFamily = 'ORC' | 'NS' | 'DH';

export const ORC_FAMILY_LABEL: Record<OrcFamily, string> = {
  ORC: 'Standard (fully crewed)',
  NS: 'Non-spinnaker',
  DH: 'Double-handed',
};

/** The `activecerts` feed identifies families numerically. */
const ACTIVECERTS_FAMILY_CODE: Record<OrcFamily, number> = {
  ORC: 1,
  DH: 3,
  NS: 5,
};

const ORC_DATA_BASE = 'https://data.orc.org/public/WPub.dll';

export function orcRmsUrl(countryId: string, family: OrcFamily): string {
  const familyParam = family === 'ORC' ? '' : `&Family=${family}`;
  return `${ORC_DATA_BASE}?action=DownRMS&CountryId=${encodeURIComponent(countryId)}${familyParam}&ext=json`;
}

export function orcActiveCertsUrl(countryId: string, family: OrcFamily): string {
  return `${ORC_DATA_BASE}?action=activecerts&CountryId=${encodeURIComponent(countryId)}&Family=${ACTIVECERTS_FAMILY_CODE[family]}`;
}

/** Printable full-certificate page for a reference number — the user-facing
 *  "view certificate" link. */
export function orcCertificatePageUrl(refNo: string): string {
  return `${ORC_DATA_BASE}/CC/${encodeURIComponent(refNo)}`;
}

/**
 * One certificate's `rms` record, as served. Only the fields the app reads
 * are typed; everything else (hull data, the ~250 national scoring-option
 * fields) rides along untyped and untouched — the record is stored verbatim
 * and scoring reads rating fields by name via `orcRecordNumber`.
 */
export interface OrcRmsRecord {
  RefNo?: string;
  NatAuth?: string;
  CertNo?: string;
  SailNo?: string;
  YachtName?: string;
  Class?: string;
  Builder?: string;
  Designer?: string;
  /** Certificate type: INTL / CLUB (standard), NSIN / NSCL, DHIN / DHCL. */
  C_Type?: string;
  Family?: string;
  IssueDate?: string;
  LOA?: number;
  CDL?: number;
  GPH?: number;
  APHD?: number;
  APHT?: number;
  OSN?: number;
  ILCWA?: number;
  TMF_Inshore?: number;
  TMF_Offshore?: number;
  Allowances?: OrcAllowances;
  [key: string]: unknown;
}

/**
 * The certificate's time-allowance matrix: seconds per nautical mile at each
 * of the tabulated true wind speeds, per true wind angle column (`R52` …
 * `R150`), plus optimum beat/run VMG allowances and their angles, and the
 * pre-composed course rows (windward/leeward, circular random, ocean).
 * Every array is indexed by `WindSpeeds`.
 */
export interface OrcAllowances {
  WindSpeeds?: number[];
  WindAngles?: number[];
  Beat?: number[];
  Run?: number[];
  BeatAngle?: number[];
  GybeAngle?: number[];
  WL?: number[];
  CR?: number[];
  OC?: number[];
  [key: string]: unknown;
}

/** One entry of the payload's `ScoringOptions` catalog: which rating fields
 *  exist, what each is called, and how it is applied. */
export interface OrcScoringOption {
  Families?: string[];
  /** Issuing scope: 'ORC' for the international set, else a country code. */
  CountryId?: string;
  Kind?: 'TOD' | 'TOT' | 'PCS';
  Fieldname?: string;
  Name?: string;
}

/** A certificate as stored on a competitor: the verbatim record plus the
 *  index fields that only the `activecerts` feed carries. */
export interface OrcCertData {
  record: OrcRmsRecord;
  /** ISO date the certificate expires (normally 31 Dec of the VPP year). */
  expiryDate?: string;
  vppYear?: number;
  /** When the scorer imported it (epoch ms). */
  importedAt: number;
}

export interface OrcCertEntry {
  record: OrcRmsRecord;
  expiryDate?: string;
  vppYear?: number;
}

export interface OrcCertListing {
  /** `DD/MM/YYYY` from the HTTP Last-Modified header, or null. */
  updatedAt: string | null;
  countryId: string;
  family: OrcFamily;
  records: OrcCertEntry[];
  scoringOptions: OrcScoringOption[];
}

/** Read a numeric rating field off a record by name (e.g. 'APHT',
 *  'IRL_5B_WL_M_TOT'). Returns undefined for absent or non-finite values. */
export function orcRecordNumber(record: OrcRmsRecord, field: string): number | undefined {
  const v = record[field];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * Parse a DownRMS JSON payload. The feed is served with a UTF-8 BOM, which
 * JSON.parse rejects, so it is stripped here.
 */
export function parseOrcRmsJson(text: string): { rms: OrcRmsRecord[]; scoringOptions: OrcScoringOption[] } {
  const parsed: unknown = JSON.parse(text.replace(/^\uFEFF/, ''));
  if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as { rms?: unknown }).rms)) {
    throw new Error('ORC DownRMS payload has no rms array — format changed?');
  }
  const obj = parsed as { rms: unknown[]; ScoringOptions?: unknown };
  const rms = obj.rms.filter((r): r is OrcRmsRecord => typeof r === 'object' && r !== null);
  const scoringOptions = Array.isArray(obj.ScoringOptions)
    ? obj.ScoringOptions.filter((o): o is OrcScoringOption => typeof o === 'object' && o !== null)
    : [];
  return { rms, scoringOptions };
}

/** What the `activecerts` index adds per certificate. */
export interface OrcActiveCertRow {
  refNo: string;
  expiryDate?: string;
  vppYear?: number;
}

/**
 * Parse the `activecerts` XML: a flat list of `<ROW>` elements with simple
 * text children. The shape is stable and trivial, so a tag extractor is used
 * rather than an XML dependency.
 */
export function parseOrcActiveCerts(xml: string): OrcActiveCertRow[] {
  const rows: OrcActiveCertRow[] = [];
  const rowRe = /<ROW\b[^>]*>([\s\S]*?)<\/ROW>/g;
  const tag = (body: string, name: string): string | undefined => {
    const m = body.match(new RegExp(`<${name}>([^<]*)</${name}>`));
    return m ? m[1].trim() : undefined;
  };
  for (let m = rowRe.exec(xml); m !== null; m = rowRe.exec(xml)) {
    const body = m[1];
    const refNo = tag(body, 'RefNo');
    if (!refNo) continue;
    const vppYearRaw = tag(body, 'VPPYear');
    const vppYear = vppYearRaw ? Number(vppYearRaw) : NaN;
    rows.push({
      refNo,
      expiryDate: tag(body, 'Expiry') || undefined,
      ...(Number.isFinite(vppYear) ? { vppYear } : {}),
    });
  }
  return rows;
}

/** Merge the two feeds by reference number. Records with no index row keep
 *  their expiry/VPP year unset rather than being dropped — the certificate
 *  data is still importable. */
export function mergeOrcFeeds(
  rms: OrcRmsRecord[],
  index: OrcActiveCertRow[],
): OrcCertEntry[] {
  const byRefNo = new Map(index.map((r) => [r.refNo, r]));
  return rms.map((record) => {
    const row = record.RefNo ? byRefNo.get(record.RefNo) : undefined;
    return {
      record,
      ...(row?.expiryDate ? { expiryDate: row.expiryDate } : {}),
      ...(row?.vppYear != null ? { vppYear: row.vppYear } : {}),
    };
  });
}

/** Format an HTTP `Last-Modified` date as `DD/MM/YYYY`, or `null` if unparseable. */
function formatLastModified(lastModified: string | null): string | null {
  if (!lastModified) return null;
  const d = new Date(lastModified);
  if (Number.isNaN(d.getTime())) return null;
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}

const FETCH_HEADERS = {
  'user-agent': 'Mozilla/5.0 (compatible; SailScoring/1.0; +https://app.sailscoring.ie)',
};

/**
 * Fetch one country + family's active certificates. The single network seam
 * in this module; callers (the API route) wrap it in caching. The index
 * fetch failing is not fatal — certificates still import, without expiry.
 */
export async function fetchOrcCertificates(
  countryId: string,
  family: OrcFamily,
): Promise<OrcCertListing> {
  const res = await fetch(orcRmsUrl(countryId, family), { headers: FETCH_HEADERS });
  if (!res.ok) {
    throw new Error(`ORC certificate fetch failed: HTTP ${res.status}`);
  }
  const { rms, scoringOptions } = parseOrcRmsJson(await res.text());

  let index: OrcActiveCertRow[] = [];
  try {
    const idxRes = await fetch(orcActiveCertsUrl(countryId, family), { headers: FETCH_HEADERS });
    if (idxRes.ok) index = parseOrcActiveCerts(await idxRes.text());
  } catch {
    // Expiry/VPP year stay unset; the import degrades rather than fails.
  }

  return {
    updatedAt: formatLastModified(res.headers.get('last-modified')),
    countryId,
    family,
    records: mergeOrcFeeds(rms, index),
    scoringOptions,
  };
}

// ── Certificate-level helpers used by the import flow and display ───────────

/** Whether the certificate is expired as of `now` (epoch ms). An unknown
 *  expiry is treated as not expired — rule 303.4 defaults expiry to 31 Dec,
 *  but only the feed knows the office's actual date. */
export function isOrcCertExpired(cert: { expiryDate?: string }, now: number): boolean {
  if (!cert.expiryDate) return false;
  const t = Date.parse(cert.expiryDate);
  if (Number.isNaN(t)) return false;
  // The expiry stamp is midnight on the printed date; the certificate is
  // valid through that day.
  return now > t + 24 * 60 * 60 * 1000;
}

/** The distinct VPP years present across a set of certificates. All boats in
 *  an event must be rated by the same VPP year (rule 303.4); more than one
 *  distinct value is a warning at import time. */
export function orcVppYears(certs: Array<{ vppYear?: number }>): number[] {
  return [...new Set(certs.map((c) => c.vppYear).filter((y): y is number => y != null))].sort();
}
