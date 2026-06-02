/**
 * Generate the bundled RYA Portsmouth Yardstick dataset.
 *
 * Output: `lib/rya-py/generated/py-list.ts` — the class→PY-number table the
 * Update-handicaps dialog reads. Run via `pnpm generate:rya-py`.
 *
 * Inputs (all committed under `reference/data/rya-py/`):
 *  - `rya-classes.csv`        the official class register: RYA Class ID →
 *                             Standard Name (slug) + Class Name + config.
 *  - `base-list.txt`          `pdftotext -layout` of the base PN list PDF.
 *                             Holds the national base list, a catamaran ("Multi")
 *                             section (still base), and an EXPERIMENTAL section.
 *  - `limited-data.txt`       `pdftotext -layout` of the Limited Data list PDF.
 *
 * Refreshing once a year: download the two PDFs and the CSV from
 * rya.org.uk/racing/portsmouth-yardstick (URLs in the dir README), run
 * `pdftotext -layout <pdf> <name>.txt`, then `pnpm generate:rya-py`, and review
 * the printed summary against the PDFs before committing.
 *
 * The RYA Class ID is the join key: rows that carry one take their canonical
 * name + config from the register, and the script *fails* if a listed Class ID
 * is absent from the register (that signals the two drifted and must be
 * reconciled by hand). Rows without a Class ID — the limited-data long tail the
 * RYA has not assigned an ID to — keep the name as printed and match by name
 * only. Everything is deterministic over the committed inputs, so re-running
 * produces a byte-identical module.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import type { RyaPyClass, RyaPyTier, RyaPyVersion } from '../lib/rya-py/types';

const ROOT = join(__dirname, '..');
const DATA_DIR = join(ROOT, 'reference', 'data', 'rya-py');
const OUT_DIR = join(ROOT, 'lib', 'rya-py', 'generated');

// ─── Class register (rya-classes.csv) ────────────────────────────────────────

interface RegisterEntry {
  slug: string;
  name: string;
  crew?: number;
  rig?: string;
  spinnaker?: string;
}

/** RFC-4180-tolerant single-line CSV split (boat/class names are free text). */
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
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      out.push(field);
      field = '';
    } else field += ch;
  }
  out.push(field);
  return out;
}

function parseRegister(csv: string): Map<number, RegisterEntry> {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim() !== '');
  const map = new Map<number, RegisterEntry>();
  // Header: "RYA Class ID","Standard Name","Class Name","No. of Crew",Rig,Spinnaker
  for (let i = 1; i < lines.length; i++) {
    const c = splitCsvLine(lines[i]);
    const id = Number(c[0]);
    if (!Number.isInteger(id)) continue;
    const crew = Number(c[3]);
    map.set(id, {
      slug: c[1]?.trim(),
      name: c[2]?.trim(),
      crew: Number.isFinite(crew) ? crew : undefined,
      rig: c[4]?.trim() || undefined,
      spinnaker: c[5]?.trim() || undefined,
    });
  }
  return map;
}

// ─── Shared parse helpers ─────────────────────────────────────────────────────

/** A class id flush against the left margin marks a list row's id cell; an
 *  indented integer is a wrapped name fragment or the No. of Crew column, never
 *  an id. pdftotext -layout preserves the column 0 alignment we rely on here. */
function leadingClassId(line: string): number | null {
  const m = /^(\d{1,4})\s/.exec(line);
  return m ? Number(m[1]) : null;
}

function normalizeName(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
}

interface Parsed {
  classId?: number;
  printedName: string;
  number: number;
  crew?: number;
  rig?: string;
  spinnaker?: string;
  lastReturn?: number;
  returns?: number;
}

// ─── Base list (base + multi + experimental) ─────────────────────────────────

// Columns: ID │ Class Name │ Crew │ Rig │ Spinnaker │ Number │ Change │ Notes.
// The rating tail — a lone-letter rig, a short spinnaker token, then the 3–4
// digit PY number — is the anchor. Names wrap across lines; the id sits on the
// physical line bearing the numeric columns (occasionally the line just after,
// when the name pushes the numbers up a line).
// Groups: 1 crew, 2 rig, 3 spinnaker, 4 number.
const BASE_TAIL = /(\d)\s+([SU])\s+(0|[A-Z]{1,2})\s+(\d{3,4})\b/;

function parseBaseList(text: string, register: Map<number, RegisterEntry>): RyaPyClass[] {
  const lines = text.split(/\r?\n/);
  const out: RyaPyClass[] = [];
  let tier: RyaPyTier = 'base';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^EXPERIMENTAL NUMBERS/.test(line)) {
      tier = 'experimental';
      continue;
    }
    const m = BASE_TAIL.exec(line);
    if (!m) continue;

    const [, crew, rig, spin, num] = m;
    const number = Number(num);
    // classId is on this line (flush-left) or on the next flush-left line.
    let classId = leadingClassId(line);
    // Name (for cross-check + the no-register fallback): the text left of the
    // numeric tail on this line, minus any flush-left id.
    const printedName = line.slice(0, m.index).replace(/^\d{1,4}\s+/, '').trim();
    if (classId === null) {
      for (let j = i + 1; j < lines.length && j <= i + 2; j++) {
        const id = leadingClassId(lines[j]);
        if (id !== null && !BASE_TAIL.test(lines[j])) {
          classId = id;
          break;
        }
      }
    }
    if (classId === null) {
      throw new Error(`base list: no Class ID for line ${i + 1}: ${line.trim()}`);
    }
    out.push(
      resolve(
        {
          classId,
          printedName,
          number,
          crew: crew ? Number(crew) : undefined,
          rig,
          spinnaker: spin,
          tier,
        },
        register,
        i + 1,
        'base list',
      ),
    );
  }
  return out;
}

// ─── Limited-data list ────────────────────────────────────────────────────────

// Columns: ID │ Class Name │ Crew │ Rig │ Spinnaker │ Remark │ Last Published
// Number │ Last Published Year │ Total Years. The 4-digit publication year
// (19xx/20xx) is a strong anchor: the PY number is the integer right before it,
// the optional total-years count right after.
// Groups: 1 crew, 2 rig, 3 spinnaker, 4 number, 5 year, 6 total years.
const LIMITED_TAIL =
  /(?:(\d)\s+([SU])\s+(0|[A-Z]{1,2})\s+)?(\d{3,4})\s+((?:19|20)\d{2})(?:\s+(\d+))?\s*$/;

function parseLimitedList(text: string, register: Map<number, RegisterEntry>): RyaPyClass[] {
  const lines = text.split(/\r?\n/);
  const out: RyaPyClass[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = LIMITED_TAIL.exec(line);
    if (!m) continue;
    const [, crew, rig, spin, num, year, years] = m;

    const classId = leadingClassId(line);
    // Name (for no-ID rows + cross-check): everything left of the numeric tail,
    // with any flush-left id stripped.
    let printedName = line.slice(0, m.index).trim();
    if (classId !== null) printedName = printedName.replace(/^\d{1,4}\s+/, '').trim();

    out.push(
      resolve(
        {
          classId: classId ?? undefined,
          printedName,
          number: Number(num),
          crew: crew ? Number(crew) : undefined,
          rig,
          spinnaker: spin,
          lastReturn: year ? Number(year) : undefined,
          returns: years ? Number(years) : undefined,
        },
        register,
        i + 1,
        'limited-data list',
      ),
    );
  }
  return out;
}

// ─── Resolve a parsed row against the register ───────────────────────────────

const warnings: string[] = [];

function resolve(
  p: Parsed & { tier?: RyaPyTier },
  register: Map<number, RegisterEntry>,
  lineNo: number,
  where: string,
): RyaPyClass {
  if (!Number.isFinite(p.number) || p.number < 400 || p.number > 2100) {
    warnings.push(`${where} line ${lineNo}: PY number ${p.number} out of range`);
  }
  const tier: RyaPyTier = p.tier ?? 'limited-data';

  const reg = p.classId !== undefined ? register.get(p.classId) : undefined;
  if (p.classId !== undefined && reg) {
    // Cross-check the printed name against the register where we captured one.
    if (p.printedName && normalizeName(p.printedName) !== normalizeName(reg.name)) {
      warnings.push(
        `${where} line ${lineNo}: id ${p.classId} printed "${p.printedName}" ≠ register "${reg.name}"`,
      );
    }
    return {
      classId: p.classId,
      name: reg.name,
      slug: reg.slug || undefined,
      number: p.number,
      tier,
      crew: reg.crew,
      rig: reg.rig,
      spinnaker: reg.spinnaker,
      ...(p.lastReturn !== undefined ? { lastReturn: p.lastReturn } : {}),
      ...(p.returns !== undefined ? { returns: p.returns } : {}),
    };
  }

  // Either no Class ID, or one that the register doesn't carry (the RYA's own
  // documents drift — e.g. a class renumbered, or an id printed on the PY list
  // that the register dropped). Keep the printed name + the list's own config
  // columns and match by name; surface the drift for annual review.
  if (p.classId !== undefined) {
    warnings.push(
      `${where} line ${lineNo}: Class ID ${p.classId} ("${p.printedName}") not in ` +
        `rya-classes.csv — kept as name-only. Reconcile against the register.`,
    );
  }
  if (!p.printedName) {
    throw new Error(`${where} line ${lineNo}: row with neither Class ID nor name`);
  }
  return {
    name: p.printedName,
    number: p.number,
    tier,
    ...(p.crew !== undefined ? { crew: p.crew } : {}),
    ...(p.rig ? { rig: p.rig } : {}),
    ...(p.spinnaker ? { spinnaker: p.spinnaker } : {}),
    ...(p.lastReturn !== undefined ? { lastReturn: p.lastReturn } : {}),
    ...(p.returns !== undefined ? { returns: p.returns } : {}),
  };
}

// ─── Version provenance ───────────────────────────────────────────────────────

function parseVersion(baseText: string, limitedText: string): RyaPyVersion {
  const year = Number(/List (\d{4})/.exec(baseText)?.[1] ?? '0');
  const ver = (t: string) => /Ver[is]?ion No:\s*(\d+)/.exec(t)?.[1] ?? '?';
  return { year, base: ver(baseText), limitedData: ver(limitedText) };
}

// ─── Emit ─────────────────────────────────────────────────────────────────────

function lit(v: string | number | undefined): string {
  if (v === undefined) return 'undefined';
  return typeof v === 'number' ? String(v) : JSON.stringify(v);
}

function renderEntry(c: RyaPyClass): string {
  const parts: string[] = [];
  if (c.classId !== undefined) parts.push(`classId: ${c.classId}`);
  parts.push(`name: ${JSON.stringify(c.name)}`);
  if (c.slug) parts.push(`slug: ${lit(c.slug)}`);
  parts.push(`number: ${c.number}`);
  parts.push(`tier: ${JSON.stringify(c.tier)}`);
  if (c.crew !== undefined) parts.push(`crew: ${c.crew}`);
  if (c.rig) parts.push(`rig: ${lit(c.rig)}`);
  if (c.spinnaker) parts.push(`spinnaker: ${lit(c.spinnaker)}`);
  if (c.lastReturn !== undefined) parts.push(`lastReturn: ${c.lastReturn}`);
  if (c.returns !== undefined) parts.push(`returns: ${c.returns}`);
  return `  { ${parts.join(', ')} },`;
}

function main(): void {
  const register = parseRegister(readFileSync(join(DATA_DIR, 'rya-classes.csv'), 'utf8'));
  // pdftotext marks page breaks with a form-feed glued to the next line's
  // content; drop them so flush-left id detection sees column 0.
  const read = (f: string) => readFileSync(join(DATA_DIR, f), 'utf8').replace(/\f/g, '');
  const baseText = read('base-list.txt');
  const limitedText = read('limited-data.txt');

  const entries = [
    ...parseBaseList(baseText, register),
    ...parseLimitedList(limitedText, register),
  ];

  // Guard against a Class ID landing in two tiers (would be a parse slip).
  const byId = new Map<number, RyaPyClass>();
  for (const e of entries) {
    if (e.classId === undefined) continue;
    const prior = byId.get(e.classId);
    if (prior) {
      warnings.push(`Class ID ${e.classId} appears twice: "${prior.name}" and "${e.name}"`);
    } else byId.set(e.classId, e);
  }

  entries.sort((a, b) => a.name.localeCompare(b.name) || (a.classId ?? 0) - (b.classId ?? 0));
  const version = parseVersion(baseText, limitedText);

  const tierCount = (t: RyaPyTier) => entries.filter((e) => e.tier === t).length;
  const header =
    `// AUTOGENERATED by scripts/generate-rya-py.ts — do not edit by hand.\n` +
    `// Source: RYA Portsmouth Number List ${version.year} ` +
    `(base v${version.base}, limited-data v${version.limitedData}); ` +
    `see reference/data/rya-py/.\n\n` +
    `import type { RyaPyClass, RyaPyVersion } from '../types';\n\n` +
    `export const RYA_PY_VERSION: RyaPyVersion = ${JSON.stringify(version)};\n\n` +
    `export const RYA_PY_CLASSES: readonly RyaPyClass[] = [\n`;
  const body = entries.map(renderEntry).join('\n');
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'py-list.ts'), `${header}${body}\n];\n`);

  // Human-reviewable summary.
  console.log(
    `RYA PY ${version.year}: ${entries.length} classes ` +
      `(${tierCount('base')} base, ${tierCount('experimental')} experimental, ` +
      `${tierCount('limited-data')} limited-data; ` +
      `${entries.filter((e) => e.classId === undefined).length} without a Class ID).`,
  );
  if (warnings.length) {
    console.log(`\n${warnings.length} warning(s) to review against the PDFs:`);
    for (const w of warnings) console.log(`  • ${w}`);
  }
}

main();
