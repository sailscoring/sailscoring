/**
 * `pnpm racesense:inspect <file.xlsx…>` — read a RaceSense regatta export
 * and print what the parser made of it, plus everything it didn't recognise.
 *
 * Meant for a regatta desk. When an export arrives mid-championship and the
 * import does something unexpected, this answers "what does the file
 * actually say" in one command, without a browser, a login or a series to
 * import into. `--race N` dumps a single race in full; `--anomalies` prints
 * every occurrence instead of one line per kind.
 */

import { readFileSync } from 'node:fs';

import { parseWorkbookBytes } from '@/lib/import-table';
import {
  groupAnomalies,
  parseRaceSenseWorkbook,
  startStatusCode,
  type RaceSenseRace,
  type RaceSenseWorkbook,
} from '@/lib/racesense-workbook';

const USAGE =
  'usage: pnpm racesense:inspect [--race N] [--anomalies] <file.xlsx…>';

interface Options {
  race: number | null;
  everyAnomaly: boolean;
  paths: string[];
}

function parseArgs(argv: string[]): Options | null {
  const options: Options = { race: null, everyAnomaly: false, paths: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--race') {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value)) return null;
      options.race = value;
    } else if (arg === '--anomalies') {
      options.everyAnomaly = true;
    } else if (arg.startsWith('-')) {
      return null;
    } else {
      options.paths.push(arg);
    }
  }
  return options.paths.length > 0 ? options : null;
}

function raceLine(race: RaceSenseRace): string {
  const finishers = race.finishes?.filter((f) => f.position !== null).length ?? 0;
  const coded = race.finishes?.filter((f) => f.position === null).length ?? 0;
  const flagged = race.starters.filter((s) => s.meaning === 'ocs').length;
  const cleared = race.starters.filter((s) => s.meaning === 'cleared').length;
  const unchecked = race.starters.filter((s) => s.meaning === 'not-checked-in').length;

  const parts = [
    `${race.starters.length} started`,
    race.finishes === null ? 'no finishes recorded' : `${finishers} finished`,
  ];
  if (coded > 0) parts.push(`${coded} coded`);
  if (flagged > 0) parts.push(`${flagged} OCS`);
  if (cleared > 0) parts.push(`${cleared} cleared`);
  if (unchecked > 0) parts.push(`${unchecked} not checked in`);

  return `${race.sheetName.padEnd(9)} ${(race.date ?? '?').padEnd(11)} ` +
    `${(race.startTime ?? '?').padEnd(9)} ${(race.preparatorySignal ?? '?').padEnd(6)} ${parts.join(', ')}`;
}

function dumpRace(race: RaceSenseRace): void {
  console.log(`\n${race.sheetName} — ${race.date ?? '(no date)'} at ${race.startTime ?? '(no start time)'}`);
  console.log(`  preparatory signal ${race.preparatorySignal ?? '(none)'}, start # ${race.startNumber ?? '(none)'}`);

  console.log('\n  Starts');
  for (const s of race.starters) {
    const code = startStatusCode(s.meaning, race.preparatorySignal);
    const notes = [
      s.status === '' ? '' : s.status,
      code ? `→ ${code}` : '',
      s.meaning === null && s.status !== '' ? '(unrecognised)' : '',
      s.protest ? 'protest' : '',
      s.dtlAtStartM !== null ? `DTL ${s.dtlAtStartM}m` : '',
    ].filter(Boolean).join(' ');
    console.log(`    ${s.sailNumber.padEnd(10)} ${(s.boatName || '').padEnd(16)} ${notes}`);
  }

  if (race.finishes === null) {
    console.log('\n  Finishes: no block on this sheet — nobody finished.');
    return;
  }
  console.log('\n  Finishes');
  for (const f of race.finishes) {
    const marker = f.position !== null ? `${f.position}.` : f.code ?? '?';
    const track = [
      f.totalTimeSecs !== null ? `${f.totalTimeSecs}s` : '',
      f.distanceKm !== null ? `${f.distanceKm}km` : '',
      f.maxSpeedKts !== null ? `max ${f.maxSpeedKts}kt` : '',
    ].filter(Boolean).join(' ');
    console.log(`    ${marker.padEnd(6)} ${f.sailNumber.padEnd(10)} ${(f.finishTime ?? '').padEnd(9)} ${track}`);
  }
}

function report(workbook: RaceSenseWorkbook, options: Options): void {
  console.log(`Regatta:  ${workbook.regatta ?? '(none)'}`);
  console.log(`Division: ${workbook.division ?? '(none)'}`);
  console.log(`Written by RaceSense ${workbook.appVersion ?? '(unstated)'}`);
  console.log(`${workbook.races.length} races, ${workbook.summary?.length ?? 0} competitors in the Summary grid`);

  if (options.race !== null) {
    const race = workbook.races.find((r) => r.number === options.race);
    if (!race) console.error(`\nNo Race ${options.race} in this workbook.`);
    else dumpRace(race);
  } else {
    console.log('');
    for (const race of workbook.races) console.log(raceLine(race));
  }

  console.log('');
  if (workbook.anomalies.length === 0) {
    console.log('Nothing unrecognised.');
    return;
  }

  if (options.everyAnomaly) {
    console.log(`${workbook.anomalies.length} anomalies:`);
    for (const a of workbook.anomalies) {
      const where = [a.sheet, a.where].filter(Boolean).join(' · ');
      console.log(`  [${a.severity}] ${a.kind} (${where}) ${a.message}`);
    }
    return;
  }

  const groups = groupAnomalies(workbook.anomalies);
  const warnings = groups.filter((g) => g.severity === 'warning');
  console.log(
    warnings.length === 0
      ? 'Nothing needs a look. Notes:'
      : `${warnings.length} thing${warnings.length === 1 ? '' : 's'} needing a look:`,
  );
  for (const g of groups) {
    const sheets = g.sheets.length > 4
      ? `${g.sheets.slice(0, 4).join(', ')} and ${g.sheets.length - 4} more`
      : g.sheets.join(', ');
    console.log(`  [${g.severity}] ${g.kind} ×${g.count} (${sheets})`);
    console.log(`      ${g.message}`);
    if (g.values.length > 0) console.log(`      values: ${g.values.map((v) => `"${v}"`).join(', ')}`);
  }
  console.log('\nRun again with --anomalies to see every occurrence.');
}

async function run(argv: string[]): Promise<number> {
  const options = parseArgs(argv);
  if (!options) {
    console.error(USAGE);
    return 1;
  }

  let failed = false;
  for (const path of options.paths) {
    if (options.paths.length > 1) console.log(`\n=== ${path} ===`);
    const buf = readFileSync(path);
    const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const parsed = await parseWorkbookBytes(bytes);
    if (parsed.kind === 'error') {
      console.error(`${path}: ${parsed.message}`);
      failed = true;
      continue;
    }
    report(parseRaceSenseWorkbook(parsed.sheets), options);
  }
  return failed ? 1 : 0;
}

run(process.argv.slice(2)).then((code) => process.exit(code));
