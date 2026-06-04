/**
 * Parse a HalSail public results fragment (the HTML returned by
 * `GET /Result/_Boat/{seriesId}`) into a normalized structure.
 *
 * See `docs/notes/halsail/querying-public-results.md` for the endpoint and
 * markup details this relies on. The parsing is regex-based and deliberately
 * permissive: HalSail's markup is loose (unquoted attributes, soft-hyphenated
 * header text like "Corr- ected", values wrapped in nested <div>s), so we
 * strip tags per cell and key columns by their header text rather than
 * assuming a fixed layout.
 *
 * Pure and dependency-free — usable from scripts, the eventual comparator,
 * and tests.
 */

export interface HalsailCompetitor {
  sail: string;
  type: string | null; // boat class, e.g. "J109"
  hcap: number | null; // summary handicap (IRC TCC, or current ECHO number)
  name: string | null; // boat name
  owner: string | null;
  helm: string | null;
  crew: string | null;
  club: string | null;
}

export interface HalsailFinisher {
  sail: string;
  place: number | null;
  hcap: number | null; // rating applied FOR this race
  finish: string | null; // time of day "HH:MM:SS"
  elapsed: string | null; // "H:MM:SS"
  corrected: string | null;
  points: number | null;
  code: string | null; // DNC/DNF/RET/... derived from the Place cell
  redressType: number | null; // RDG type (1-5) from a cell like "RDG 2"; null unless code === 'RDG'
  penaltyCode: string | null; // additive scoring penalty on a finisher, e.g. "SCP" from "2/SCP_20%"
  penaltyPercent: number | null; // the penalty percentage, e.g. 20; null if none or unstated
  nextHcap: number | null; // progressive rating AFTER this race
}

export interface HalsailRace {
  raceNumber: number;
  date: string | null; // ISO "2026-04-23"
  startTime: string | null; // "HH:MM:SS"
  finishers: HalsailFinisher[];
}

export interface HalsailFleet {
  title: string; // e.g. "Cruisers 1 IRC, Thursday Overall"
  scoredRaceNumbers: number[]; // race columns shown in the summary
  competitors: HalsailCompetitor[];
  races: HalsailRace[]; // sailed races only, one per number (deduped)
}

// ---- low-level HTML helpers ----

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Canonical column key: lowercase, alphanumerics only. "Corr- ected" →
 *  "corrected", "Next Hcap" → "nexthcap", "Boat note" → "boatnote". */
function colKey(headerText: string): string {
  return headerText.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function num(s: string | undefined): number | null {
  if (s == null) return null;
  const t = s.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function tables(html: string): string[] {
  return html.match(/<table\b[^>]*>[\s\S]*?<\/table>/gi) ?? [];
}

function caption(table: string): string | null {
  const m = table.match(/<caption\b[^>]*>([\s\S]*?)<\/caption>/i);
  return m ? stripTags(m[1]) : null;
}

function headerKeys(table: string): string[] {
  const ths = table.match(/<th\b[^>]*>[\s\S]*?<\/th>/gi);
  if (!ths) return [];
  return ths.map((th) => colKey(stripTags(th.replace(/^<th\b[^>]*>/i, '').replace(/<\/th>$/i, ''))));
}

interface Row {
  byKey: (k: string) => string | undefined;
  cells: string[];
}

function dataRows(table: string, keys: string[]): Row[] {
  const trs = table.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
  const out: Row[] = [];
  for (const tr of trs) {
    if (/<th\b/i.test(tr)) continue; // header row
    const tds = tr.match(/<td\b[^>]*>[\s\S]*?<\/td>/gi);
    if (!tds) continue;
    const cells = tds.map((td) => stripTags(td.replace(/^<td\b[^>]*>/i, '').replace(/<\/td>$/i, '')));
    if (cells.length !== keys.length) continue; // unexpected layout; skip
    const idx = new Map<string, number>();
    keys.forEach((k, i) => { if (!idx.has(k)) idx.set(k, i); });
    out.push({ cells, byKey: (k) => { const i = idx.get(k); return i == null ? undefined : cells[i]; } });
  }
  return out;
}

function parseIsoDate(s: string): string | null {
  // "23 Apr 2026" → "2026-04-23"
  const m = s.match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/);
  if (!m) return null;
  const mon = MONTHS[m[2].toLowerCase()];
  if (!mon) return null;
  return `${m[3]}-${mon}-${m[1].padStart(2, '0')}`;
}

// ---- parsing ----

function parseTitle(html: string): string {
  const m = html.match(/([A-Z][^<>]*?,\s*(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+[^<>]*?)(?=<)/);
  return m ? stripTags(m[1]) : '';
}

function pointsValue(pointsText: string | undefined): number | null {
  if (!pointsText) return null;
  const m = pointsText.match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

const TIME_RE = /^\d{1,2}:\d{2}:\d{2}$/;

function parseSummary(table: string): { competitors: HalsailCompetitor[]; raceNumbers: number[] } {
  const keys = headerKeys(table);
  const raceNumbers: number[] = [];
  for (const k of keys) {
    const m = k.match(/^race(\d+)$/);
    if (m) raceNumbers.push(Number(m[1]));
  }
  const competitors: HalsailCompetitor[] = [];
  for (const row of dataRows(table, keys)) {
    const sail = (row.byKey('sail') ?? '').trim();
    if (!sail) continue;
    competitors.push({
      sail,
      type: row.byKey('type')?.trim() || null,
      hcap: num(row.byKey('hcap')),
      name: row.byKey('name')?.trim() || null,
      owner: row.byKey('owner')?.trim() || null,
      helm: row.byKey('helm')?.trim() || null,
      crew: row.byKey('crew')?.trim() || null,
      club: row.byKey('club')?.trim() || null,
    });
  }
  return { competitors, raceNumbers };
}

function parseRaceTable(table: string, cap: string): HalsailRace | null {
  const m = cap.match(/Race\s*(\d+)/i);
  if (!m) return null;
  if (/cancelled|abandoned/i.test(cap)) return null;
  const raceNumber = Number(m[1]);
  const keys = headerKeys(table);
  if (!keys.includes('finish') && !keys.includes('elapsed')) return null;
  const startMatch = cap.match(/(\d{1,2}:\d{2}:\d{2})/);
  const finishers: HalsailFinisher[] = [];
  for (const row of dataRows(table, keys)) {
    const sail = (row.byKey('sail') ?? '').trim();
    if (!sail) continue;
    const finish = row.byKey('finish')?.trim() || null;
    // The Place cell holds either a finishing position (number) or a result
    // code for non-finishers. Codes may carry a trailing footnote marker
    // (e.g. "RDG_2"), so match the leading uppercase code letters rather than
    // the whole cell.
    const placeText = (row.byKey('place') ?? '').trim();
    const codeMatch = placeText.match(/^([A-Z]{2,5})/);
    const code = codeMatch ? codeMatch[1] : null;
    // RDG cells encode the redress type as a trailing number, e.g. "RDG 2".
    const typeMatch = code === 'RDG' ? placeText.match(/(\d+)\s*$/) : null;
    // A *finisher* may carry an additive scoring penalty appended to its place,
    // e.g. "2/SCP_20%" — finished 2nd, 20% scoring penalty. This is distinct
    // from a result code (DNC/RDG/…), which replaces the place entirely, so we
    // only look for it when the place is a number.
    const penaltyMatch = code === null ? placeText.match(/\/([A-Z]{2,5})(?:_(\d+(?:\.\d+)?)%)?/) : null;
    finishers.push({
      sail,
      place: codeMatch ? null : num(placeText),
      hcap: num(row.byKey('hcap')),
      finish: finish && TIME_RE.test(finish) ? finish : null,
      elapsed: row.byKey('elapsed')?.trim() || null,
      corrected: row.byKey('corrected')?.trim() || null,
      points: pointsValue(row.byKey('points')),
      code,
      redressType: typeMatch ? Number(typeMatch[1]) : null,
      penaltyCode: penaltyMatch ? penaltyMatch[1] : null,
      penaltyPercent: penaltyMatch && penaltyMatch[2] != null ? Number(penaltyMatch[2]) : null,
      nextHcap: num(row.byKey('nexthcap')),
    });
  }
  if (finishers.length === 0) return null;
  return {
    raceNumber,
    date: parseIsoDate(cap),
    startTime: startMatch ? startMatch[1] : null,
    finishers,
  };
}

/** Parse a `/Result/_Boat/{id}` fragment into a normalized fleet result. */
export function parseHalsailFleet(html: string): HalsailFleet {
  const allTables = tables(html);

  // Summary = first table that has a Rank header (the standings table).
  let summary: { competitors: HalsailCompetitor[]; raceNumbers: number[] } = { competitors: [], raceNumbers: [] };
  for (const t of allTables) {
    const keys = headerKeys(t);
    if (keys.includes('rank') && keys.includes('sail')) {
      summary = parseSummary(t);
      break;
    }
  }

  // Per-race detail tables: any table whose caption names a race. Multiple
  // variants per race (e.g. an "ECHO Analysis" table and a plain one) carry
  // the same finishers; keep the first data-bearing table per race number.
  const byRace = new Map<number, HalsailRace>();
  for (const t of allTables) {
    const cap = caption(t);
    if (!cap || !/Race\s*\d/i.test(cap)) continue;
    const race = parseRaceTable(t, cap);
    if (race && !byRace.has(race.raceNumber)) byRace.set(race.raceNumber, race);
  }
  const races = [...byRace.values()].sort((a, b) => a.raceNumber - b.raceNumber);

  return {
    title: parseTitle(html),
    scoredRaceNumbers: summary.raceNumbers,
    competitors: summary.competitors,
    races,
  };
}
