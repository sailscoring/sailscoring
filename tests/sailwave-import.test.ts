import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseSailwaveBlw,
  inspectSailwave,
  buildSeriesFileFromSailwave,
  parseSailwaveColumns,
  resolveSubdivisionAxes,
  parseStartString,
  parseSailwaveRaceDate,
  parseDiscardThresholds,
  sailwaveTimeToColon,
  inferBareNameSystem,
  SailwaveImportError,
  type SailwaveImportOptions,
  type SailwaveRaw,
} from '@/lib/sailwave-import';

const FIXTURES = 'tests/fixtures/sailwave';
const HYC = `${FIXTURES}/hyc-2026`;

function loadFile(path: string): SailwaveRaw {
  const bytes = readFileSync(join(process.cwd(), path));
  // readFileSync returns a Buffer; pass the underlying ArrayBuffer slice.
  return parseSailwaveBlw(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  );
}

/** Build a `.blw` byte buffer from CSV rows (CRLF-terminated, every field
 *  quoted — the way Sailwave writes them). */
function blw(rows: string[][]): ArrayBuffer {
  const csv = rows
    .map((r) => r.map((f) => `"${f.replace(/"/g, '""')}"`).join(','))
    .join('\r\n');
  const bytes = new TextEncoder().encode(csv);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

const DEFAULT_OPTS: SailwaveImportOptions = {
  name: '',
  venue: '',
  defaultRaceDate: '2026-05-05',
  primaryLabel: 'helm',
  fleetScoringOverrides: new Map(),
  includeScratchCompanions: true,
  includeResults: true,
};

describe('parseSailwaveBlw', () => {
  it('parses a real Sailwave .blw file', () => {
    const raw = loadFile(`${HYC}/2026 Tues Series 1.blw`);
    expect(raw.header?.generator).toBe('sailwave');
    expect(raw.globals?.serevent).toBe('Club Racing 2026');
    expect(Object.keys(raw.competitors ?? {}).length).toBeGreaterThan(0);
  });

  it('pivots flat rows into the nested SailwaveRaw shape by key prefix and handle', () => {
    const raw = parseSailwaveBlw(blw([
      ['serversion', '2.38.02', '', ''],
      ['serevent', 'Test Regatta', '', ''],
      ['column', '1|HelmName|9|Yes|Yes|101|Helm Name|', '', ''],
      ['compsailno', '1234', '7', ''],
      ['comphelmname', 'Ada Lovelace', '7', ''],
      ['compfleet', 'Fast HPH', '7', ''],
      ['racerank', '1', '', '3'],
      ['racestart', '|10.00.00|Finish time|Start 1', '', '3'],
      // Result cell: both handles set. `srat` is a result key that doesn't
      // start with "r", proving classification falls through to the both-handles
      // branch rather than relying on the leading letter.
      ['rpos', '1', '7', '3'],
      ['rrestyp', '4', '7', '3'],
      ['srat', '0', '7', '3'],
    ]));

    expect(raw.globals?.serevent).toBe('Test Regatta');
    expect(Object.values(raw.columns ?? {})).toContain('1|HelmName|9|Yes|Yes|101|Helm Name|');
    expect(raw.competitors?.['7']).toMatchObject({
      compsailno: '1234',
      comphelmname: 'Ada Lovelace',
      compfleet: 'Fast HPH',
    });
    expect(raw.races?.['3']?.racerank).toBe('1');
    expect(Object.values(raw.races?.['3']?.starts ?? {})).toEqual(['|10.00.00|Finish time|Start 1']);
    const result = raw.results?.['7:3'];
    expect(result).toMatchObject({ comHandle: '7', racHandle: '3', rpos: '1', rrestyp: '4' });
    expect((result as Record<string, string>).srat).toBe('0');
  });

  it('recovers scoring-codes nested under their system handle from scrcode rows', () => {
    const raw = parseSailwaveBlw(blw([
      ['serversion', '2.38.02', '', ''],
      ['serscoringhandle', '67', '', ''],
      ['scrname', 'Root', '67', ''],
      ['scrdiscardlist', '0,0,1', '67', ''],
      // Pipe layout: code|method|value|...|systemHandle(14)|...
      ['scrcode', 'DNF|Boats in series +|1|Yes|Yes|||spare|spare|spare|spare|Yes|No|No|67||desc', '', ''],
    ]));
    const system = raw['scoring-systems']?.['67'];
    expect(system?.scrdiscardlist).toBe('0,0,1');
    expect(system?.['scoring-codes']?.DNF).toEqual({ method: 'Boats in series +', value: '1' });
  });

  it('decodes windows-1252 helm names (Sailwave saves on Windows)', () => {
    // 0xE9 is "é" in windows-1252 but an invalid UTF-8 lead byte.
    const csv = '"serversion","2.38.02","",""\r\n"comphelmname","Tom\xe9","9",""';
    const bytes = Uint8Array.from(csv, (c) => c.charCodeAt(0));
    const raw = parseSailwaveBlw(bytes.buffer);
    expect(raw.competitors?.['9']?.comphelmname).toBe('Tomé');
  });

  it('rejects a CSV that lacks Sailwave series markers', () => {
    const bytes = blw([['name', 'value', '', ''], ['foo', 'bar', '', '']]);
    expect(() => parseSailwaveBlw(bytes)).toThrow(SailwaveImportError);
  });
});

describe('inspectSailwave', () => {
  it('summarises the Tues Series file (dual-scored HPH + Scr)', () => {
    const raw = loadFile(`${HYC}/2026 Tues Series 1.blw`);
    const preview = inspectSailwave(raw);
    expect(preview.name).toBe('Club Racing 2026');
    expect(preview.venue).toBe('Tuesdays - One Designs - Series 1');
    expect(preview.raceCount).toBe(6);
    expect(preview.competitorCount).toBe(29);
    expect(preview.fleets.map((f) => `${f.name}=${f.detectedScoringSystem}`).sort()).toEqual([
      'Puppeteer HPH=nhc',
      'Puppeteer Scr=scratch',
      'Squib HPH=nhc',
      'Squib Scr=scratch',
    ]);
    expect(preview.hasResults).toBe(true);
    expect(preview.detectedDnfScoring).toBe('startingArea');
    expect(preview.detectedDiscardThresholds).toEqual([
      { minRaces: 4, discardCount: 1 },
      { minRaces: 9, discardCount: 2 },
    ]);
  });

  it('auto-detects bare-name fleets: Optimist=scratch (no ratings), PY=py (integer ratings)', () => {
    const raw = loadFile(`${HYC}/2026 Dinghies Series 1.blw`);
    const preview = inspectSailwave(raw);
    const byName = new Map(preview.fleets.map((f) => [f.name, f]));
    expect(byName.get('Optimist')?.detectedScoringSystem).toBe('scratch');
    expect(byName.get('Optimist')?.isBareName).toBe(true);
    expect(byName.get('PY')?.detectedScoringSystem).toBe('py');
    expect(byName.get('PY')?.isBareName).toBe(true);
  });

  it('reads NHC example with all-suffixed fleets', () => {
    const raw = loadFile(`${FIXTURES}/nhc-example/2025 Puppeteer 22 Championships.blw`);
    const preview = inspectSailwave(raw);
    expect(preview.raceCount).toBe(7);
    expect(preview.competitorCount).toBe(14);
    expect(preview.detectedDnfScoring).toBe('startingArea');
  });

  it('proposes fleets alphabetically sorted, matching the built series', () => {
    const raw = loadFile(`${HYC}/2026 Wed Series 1.blw`);
    const preview = inspectSailwave(raw);
    expect(preview.fleets.map((f) => f.name)).toEqual([
      'Division A HPH',
      'Division A IRC',
      'Division B HPH',
      'Division B IRC',
      'Division C HPH',
      'Division C IRC',
    ]);
  });
});

describe('parseDiscardThresholds', () => {
  // Build a minimal raw file with a single root scoring system carrying the
  // given scrdiscardlist, addressed by globals.serscoringhandle.
  function rawWithDiscardList(scrdiscardlist: string | undefined): SailwaveRaw {
    return {
      header: { generator: 'sailwave' },
      globals: { serscoringhandle: '87' },
      'scoring-systems': {
        '87': { scrparent: '0', ...(scrdiscardlist !== undefined ? { scrdiscardlist } : {}) },
      },
    };
  }

  // The five HYC 2026 series from #157, plus their expected compressions.
  const CASES: [string, string, { minRaces: number; discardCount: number }[]][] = [
    ['Tues & Sat', '0,0,0,1,1,1,1,2,2,2,2', [{ minRaces: 4, discardCount: 1 }, { minRaces: 8, discardCount: 2 }]],
    ['Tues', '0,0,0,1,1,1,1,1,2', [{ minRaces: 4, discardCount: 1 }, { minRaces: 9, discardCount: 2 }]],
    ['Wed', '0,0,0,0,1,1,1', [{ minRaces: 5, discardCount: 1 }]],
    ['Sat Cruisers', '0,0,0,0,1,1,1', [{ minRaces: 5, discardCount: 1 }]],
    ['Dinghies', '0,0,1,1,1,2,2,2,3,3,3,3,4,4,4,5,5,5,6,6,6,7,7,7', [
      { minRaces: 3, discardCount: 1 },
      { minRaces: 6, discardCount: 2 },
      { minRaces: 9, discardCount: 3 },
      { minRaces: 13, discardCount: 4 },
      { minRaces: 16, discardCount: 5 },
      { minRaces: 19, discardCount: 6 },
      { minRaces: 22, discardCount: 7 },
    ]],
  ];

  it.each(CASES)('run-length compresses the %s profile', (_name, list, expected) => {
    expect(parseDiscardThresholds(rawWithDiscardList(list))).toEqual(expected);
  });

  it('returns [] for an all-zero list (no discards)', () => {
    expect(parseDiscardThresholds(rawWithDiscardList('0,0,0,0'))).toEqual([]);
  });

  it('returns [] when scrdiscardlist is absent', () => {
    expect(parseDiscardThresholds(rawWithDiscardList(undefined))).toEqual([]);
  });

  it('returns [] when serscoringhandle points at no known system', () => {
    const raw: SailwaveRaw = {
      header: { generator: 'sailwave' },
      globals: { serscoringhandle: '999' },
      'scoring-systems': { '87': { scrdiscardlist: '0,0,0,1' } },
    };
    expect(parseDiscardThresholds(raw)).toEqual([]);
  });

  it('ignores trailing empty CSV tokens without shifting indices', () => {
    expect(parseDiscardThresholds(rawWithDiscardList('0,0,0,1,1,,'))).toEqual([
      { minRaces: 4, discardCount: 1 },
    ]);
  });
});

describe('buildSeriesFileFromSailwave: Tues & Sat Series 1 (H17 discard profile)', () => {
  it('detects [{4,1},{8,2}] — the rule H17 net points were missing in #147', () => {
    const raw = loadFile(`${HYC}/2026 Tues & Sat Series 1.blw`);
    const file = buildSeriesFileFromSailwave(raw, DEFAULT_OPTS);
    expect(file.series.discardThresholds).toEqual([
      { minRaces: 4, discardCount: 1 },
      { minRaces: 8, discardCount: 2 },
    ]);
  });
});

describe('buildSeriesFileFromSailwave: Sat Cruisers Series 1 (combined start)', () => {
  // The cruiser divisions share a single start gun, which Sailwave writes
  // with no 'Fleet^...' prefix. The importer must fan that combined start out
  // to every fleet so the handicap divisions score on corrected time rather
  // than falling back to scratch/crossing-order (issue #147 §5).
  const raw = loadFile(`${HYC}/2026 Sat Cruisers Series 1.blw`);
  const file = buildSeriesFileFromSailwave(raw, DEFAULT_OPTS);

  it('imports the fleet-less gun as one start covering every fleet', () => {
    const race = file.races.find((r) => r.starts.some((s) => s.startTime === '10:35:00'));
    expect(race).toBeDefined();
    expect(race!.starts).toHaveLength(1);
    expect(race!.starts[0].startTime).toBe('10:35:00');
    // Every fleet in the series shares the one gun.
    expect([...race!.starts[0].fleetIds].sort()).toEqual(file.fleets.map((f) => f.id).sort());
  });
});

describe('buildSeriesFileFromSailwave: venue/event website URLs', () => {
  it('carries servenuewebsite / sereventwebsite into venueUrl / eventUrl', () => {
    // Mirrors a real Sailwave export (HYC ILCA Masters): logos in *burgee,
    // websites in *website, and the websites stored without a scheme. The
    // importer keeps the raw value; the renderer prefixes https:// for links.
    const raw: SailwaveRaw = {
      globals: {
        serevent: 'Synthetic Regatta',
        servenue: 'Synthetic YC',
        servenueburgee: 'https://venue.example.com/logo.png',
        sereventburgee: 'https://event.example.com/logo.png',
        servenuewebsite: 'www.hyc.ie',
        sereventwebsite: 'ilcaireland.com/event/masters-championships/',
      },
      competitors: {},
      races: {},
    };
    const file = buildSeriesFileFromSailwave(raw, DEFAULT_OPTS);
    expect(file.series.venueLogoUrl).toBe('https://venue.example.com/logo.png');
    expect(file.series.eventLogoUrl).toBe('https://event.example.com/logo.png');
    expect(file.series.venueUrl).toBe('www.hyc.ie');
    expect(file.series.eventUrl).toBe('ilcaireland.com/event/masters-championships/');
  });

  it('maps the four branding globals through the full parse→build pipeline (real key names)', () => {
    // Fixture mirrors a real HYC export's branding globals — exercises the
    // windows-1252 decode in parseSailwaveBlw, not just the builder.
    const raw = loadFile(`${FIXTURES}/branding-sample.blw`);
    const file = buildSeriesFileFromSailwave(raw, DEFAULT_OPTS);
    expect(file.series.venueLogoUrl).toBe('https://www.hyc.ie/system/sponsor_logos/620/normal/Howth_Yacht_Club_-_Logo_RGB.jpg');
    expect(file.series.eventLogoUrl).toBe('https://hyc.ie/system/sponsor_logos/509/normal/ILCA-Ireland.png');
    expect(file.series.venueUrl).toBe('www.hyc.ie');
    expect(file.series.eventUrl).toBe('ilcaireland.com/event/masters-championships/');
  });
});

describe('buildSeriesFileFromSailwave: Tues Series 1', () => {
  const raw = loadFile(`${HYC}/2026 Tues Series 1.blw`);
  const file = buildSeriesFileFromSailwave(raw, DEFAULT_OPTS);

  it('produces fleets sorted alphabetically by name', () => {
    expect(file.fleets.map((f) => f.name)).toEqual([
      'Puppeteer HPH',
      'Puppeteer Scr',
      'Squib HPH',
      'Squib Scr',
    ]);
  });

  it('carries the venue and event logo URLs from Sailwave burgee globals', () => {
    // `servenueburgee` / `sereventburgee` both point at the HYC logo in this file.
    expect(file.series.venueLogoUrl).toBe(
      'https://www.hyc.ie/system/sponsor_logos/620/normal/Howth_Yacht_Club_-_Logo_RGB.jpg',
    );
    expect(file.series.eventLogoUrl).toBe(
      'https://www.hyc.ie/system/sponsor_logos/620/normal/Howth_Yacht_Club_-_Logo_RGB.jpg',
    );
    // This file carries no website-URL globals, so those stay empty.
    expect(file.series.venueUrl ?? '').toBe('');
    expect(file.series.eventUrl ?? '').toBe('');
  });

  it('collapses primary+alias rows into one competitor per physical boat', () => {
    // Every boat is dual-scored (HPH + Scr), so every competitor ends up
    // with 2 fleet memberships.
    expect(file.competitors).toHaveLength(29);
    for (const c of file.competitors) {
      expect(c.fleetIds).toHaveLength(2);
    }
  });

  it('routes HPH ratings to nhcStartingTcf', () => {
    const rated = file.competitors.filter((c) => c.nhcStartingTcf !== undefined);
    expect(rated.length).toBe(29);
    const sail15 = file.competitors.find((c) => c.sailNumber === '15');
    expect(sail15?.nhcStartingTcf).toBeCloseTo(1.35);
  });

  it('orders finishes by crossing (finish) time, not Sailwave rpos', () => {
    // sortOrder is the crossing order (ADR-007). Sailwave's rpos is the
    // per-scoring placing — handicap-corrected time on the HPH fleets here —
    // so importing it as sortOrder made the scratch companion fleets rank by
    // corrected time (issue #147 §2). Assert every timed race reads back in
    // non-decreasing finishTime order when walked by sortOrder.
    const toSecs = (t: string): number => {
      const [h, m, s] = t.split(':').map(Number);
      return h * 3600 + m * 60 + s;
    };
    let checkedRaces = 0;
    for (const race of file.races) {
      const timed = race.finishes
        .filter((f) => f.finishTime)
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
      if (timed.length < 2) continue;
      checkedRaces++;
      for (let i = 1; i < timed.length; i++) {
        expect(toSecs(timed[i].finishTime!)).toBeGreaterThanOrEqual(
          toSecs(timed[i - 1].finishTime!),
        );
      }
    }
    expect(checkedRaces).toBeGreaterThan(0);
  });

  it('skips races where every entry is implicit DNC after the DNC drop', () => {
    // Tues has 6 scheduled races; only 2 had any non-DNC results.
    expect(file.races).toHaveLength(2);
  });

  it('fans the start gun out across companion fleets sharing a base name', () => {
    const race = file.races[0];
    for (const start of race.starts) {
      expect(start.fleetIds.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('uses the Sailwave-resolved DNF scoring (startingArea here)', () => {
    expect(file.series.dnfScoring).toBe('startingArea');
  });

  it('sets handicap scoring mode when a fleet uses a time-based system (HPH here)', () => {
    expect(file.series.scoringMode).toBe('handicap');
  });

  it('resolves year-less word-month racedates using the default-date year', () => {
    // Tues file's racedate is word-month with no year ("May 5th", "May 12th");
    // the default date's year (2026) resolves them. Only the two sailed races
    // survive includeResults; the rest are scheduled-but-unsailed.
    expect(file.races.map((r) => r.date)).toEqual(['2026-05-05', '2026-05-12']);
  });

  it('enables only the competitor fields Sailwave actually populated', () => {
    // Tues file: boat names yes; class no; club no; crew no.
    expect(file.series.enabledCompetitorFields).toEqual(['boatName']);
  });
});

describe('buildSeriesFileFromSailwave: Wed Series 1', () => {
  const raw = loadFile(`${HYC}/2026 Wed Series 1.blw`);
  const file = buildSeriesFileFromSailwave(raw, DEFAULT_OPTS);

  it('produces 6 fleets across Divisions A/B/C × HPH/IRC, alphabetised', () => {
    expect(file.fleets.map((f) => f.name)).toEqual([
      'Division A HPH',
      'Division A IRC',
      'Division B HPH',
      'Division B IRC',
      'Division C HPH',
      'Division C IRC',
    ]);
  });

  it('routes IRC ratings to ircTcc and HPH ratings to nhcStartingTcf', () => {
    expect(file.competitors.some((c) => c.ircTcc !== undefined)).toBe(true);
    expect(file.competitors.some((c) => c.nhcStartingTcf !== undefined)).toBe(true);
  });

  it('enables boat name, boat class, and nationality (Sailwave has all three here)', () => {
    expect(file.series.enabledCompetitorFields).toEqual(['boatName', 'boatClass', 'nationality']);
  });
});

describe('buildSeriesFileFromSailwave: Dinghies (auto bare-name detection)', () => {
  const raw = loadFile(`${HYC}/2026 Dinghies Series 1.blw`);
  const file = buildSeriesFileFromSailwave(raw, DEFAULT_OPTS);

  it('routes the auto-detected PY fleet ratings to pyNumber', () => {
    const py = file.fleets.find((f) => f.name === 'PY');
    expect(py?.scoringSystem).toBe('py');
    const withPy = file.competitors.filter((c) => c.pyNumber !== undefined);
    expect(withPy.length).toBeGreaterThan(0);
  });

  it('auto-detects the un-rated Optimist fleet as scratch', () => {
    const optimist = file.fleets.find((f) => f.name === 'Optimist');
    expect(optimist?.scoringSystem).toBe('scratch');
  });

  it('uses Sailwave\'s parseable racedate ("07-05-26" with serdatespec d-m-y → 2026-05-07)', () => {
    // The first race in this file has racedate "07-05-26" — DD-MM-YY.
    // It should resolve to 2026-05-07, not the default.
    const race = file.races.find((r) => r.date === '2026-05-07');
    expect(race).toBeDefined();
  });

  it('populates crewName from compcrewname when present', () => {
    const withCrew = file.competitors.filter((c) => c.crewName);
    expect(withCrew.length).toBeGreaterThan(0);
  });

  it('enables crewName in the series field list (Sailwave has crew data here)', () => {
    expect(file.series.enabledCompetitorFields).toContain('crewName');
  });
});

describe('buildSeriesFileFromSailwave: per-fleet override still wins over auto-detect', () => {
  it('honours explicit overrides', () => {
    const raw = loadFile(`${HYC}/2026 Dinghies Series 1.blw`);
    const file = buildSeriesFileFromSailwave(raw, {
      ...DEFAULT_OPTS,
      fleetScoringOverrides: new Map([
        ['PY', 'nhc'],
        ['Optimist', 'nhc'],
      ]),
    });
    expect(file.fleets.every((f) => f.scoringSystem === 'nhc')).toBe(true);
  });
});

describe('buildSeriesFileFromSailwave: implicit DNC', () => {
  it('drops explicit DNC rows from race finishes', () => {
    // The NHC example has explicit DNC rows in its results table; after
    // dropping them, only the other coded results (DNF, OCS) and clean
    // finishes should remain.
    const raw = loadFile(`${FIXTURES}/nhc-example/2025 Puppeteer 22 Championships.blw`);
    const file = buildSeriesFileFromSailwave(raw, DEFAULT_OPTS);
    const allFinishes = file.races.flatMap((r) => r.finishes);
    expect(allFinishes.some((f) => f.resultCode === 'DNC')).toBe(false);
    // DNF and OCS rows from the source should survive.
    expect(allFinishes.some((f) => f.resultCode === 'DNF')).toBe(true);
  });
});

describe('buildSeriesFileFromSailwave: includeScratchCompanions=false', () => {
  it('drops Scr companion fleets and their memberships', () => {
    const raw = loadFile(`${HYC}/2026 Tues Series 1.blw`);
    const file = buildSeriesFileFromSailwave(raw, {
      ...DEFAULT_OPTS,
      includeScratchCompanions: false,
    });
    expect(file.fleets.every((f) => f.scoringSystem !== 'scratch')).toBe(true);
    expect(file.fleets).toHaveLength(2); // Puppeteer HPH + Squib HPH
    for (const c of file.competitors) {
      expect(c.fleetIds).toHaveLength(1);
    }
  });
});

describe('buildSeriesFileFromSailwave: 2024/2025 HYC form (spelled-out Scratch + multi-fleet starts)', () => {
  // The 2024/2025 Tuesday-series files differ from the 2026 files in two ways:
  // the scratch fleet is spelled out " Scratch" rather than abbreviated " Scr",
  // and a shared gun names both fleets explicitly ('Fleet^X Scratch^^^Fleet^X
  // HPH') instead of naming one and leaving the companion implicit. This
  // synthetic file reproduces both so detection and start fan-out are covered.
  const raw: SailwaveRaw = {
    header: { generator: 'sailwave' },
    globals: { serevent: 'Club Racing 2024', servenue: 'Tuesdays - Series 1', serdatespec: 'd/m/y' },
    competitors: {
      // One physical boat, dual-scored: scratch primary + HPH alias.
      '1': { compsailno: '15', comphelmname: 'A Helm', compboat: 'Boat A', compfleet: 'Puppeteer Scratch', comprating: '1.000', compalias: '0' },
      '2': { compsailno: '15', comphelmname: 'A Helm', compboat: 'Boat A', compfleet: 'Puppeteer HPH', comprating: '1.350', compalias: '1' },
    },
    races: {
      '875': {
        racerank: '1',
        racedate: '23/04/24',
        starts: {
          '1': 'Fleet^Puppeteer Scratch^^^Fleet^Puppeteer HPH^^^^^^^=^=^=^=^=^=|19:30:00|Finish time|Start 1|||0||0|0||||1',
        },
      },
    },
  };

  it('detects the spelled-out " Scratch" fleet as scratch (not rating-inferred nhc)', () => {
    const preview = inspectSailwave(raw);
    expect(preview.fleets.map((f) => `${f.name}=${f.detectedScoringSystem}`).sort()).toEqual([
      'Puppeteer HPH=nhc',
      'Puppeteer Scratch=scratch',
    ]);
    // The 1.000 ratings would otherwise infer nhc — assert the suffix won, so
    // these aren't treated as bare names.
    expect(preview.fleets.every((f) => !f.isBareName)).toBe(true);
  });

  it('assigns a shared-gun start to every fleet it names', () => {
    const file = buildSeriesFileFromSailwave(raw, { ...DEFAULT_OPTS, includeResults: false });
    const idToName = new Map(file.fleets.map((f) => [f.id, f.name]));
    const race = file.races[0];
    expect(race.starts).toHaveLength(1);
    expect(race.starts[0].fleetIds.map((id) => idToName.get(id)).sort()).toEqual([
      'Puppeteer HPH',
      'Puppeteer Scratch',
    ]);
  });
});

describe('buildSeriesFileFromSailwave: includeResults=false', () => {
  it('keeps the full race schedule with empty finishes', () => {
    const raw = loadFile(`${HYC}/2026 Tues Series 1.blw`);
    const file = buildSeriesFileFromSailwave(raw, {
      ...DEFAULT_OPTS,
      includeResults: false,
    });
    expect(file.races.length).toBe(6);
    for (const r of file.races) {
      expect(r.finishes).toHaveLength(0);
    }
  });
});

describe('buildSeriesFileFromSailwave: fleetless / pre-event entry list', () => {
  // A single one-design class entered without ever creating a named fleet, and
  // with no results entered yet — the shape of a pre-event entry list. Every
  // result cell is rrestyp=0 (no result), the way Sailwave seeds them.
  const entryList = (): SailwaveRaw => parseSailwaveBlw(blw([
    ['serversion', '2.38.02', '', ''],
    ['serevent', 'Melges 15 Northerns', '', ''],
    ['comphelmname', 'Cormac Farrelly', '53', ''],
    ['compsailno', '635', '53', ''],
    ['compexclude', '0', '53', ''],
    ['compalias', '0', '53', ''],
    ['comphelmname', 'Kate Lyttle', '54', ''],
    ['compsailno', '1024', '54', ''],
    ['compexclude', '0', '54', ''],
    ['compalias', '0', '54', ''],
    ['racerank', '1', '', '62'],
    ['racerank', '2', '', '63'],
    // Seeded-but-unentered result cells for both boats in both races.
    ['rrestyp', '0', '53', '62'],
    ['rrestyp', '0', '54', '62'],
    ['rrestyp', '0', '53', '63'],
    ['rrestyp', '0', '54', '63'],
  ]));

  it('synthesises a single Default fleet for competitors with no compfleet', () => {
    const file = buildSeriesFileFromSailwave(entryList(), DEFAULT_OPTS);
    expect(file.fleets).toHaveLength(1);
    expect(file.fleets[0].name).toBe('Default');
    // No ratings anywhere → scratch (one-design).
    expect(file.fleets[0].scoringSystem).toBe('scratch');
  });

  it('sets scratch scoring mode when every fleet is position-scored', () => {
    const file = buildSeriesFileFromSailwave(entryList(), DEFAULT_OPTS);
    // All fleets scratch → no finish times, so the finish sheet needs no start.
    expect(file.series.scoringMode).toBe('scratch');
  });

  it('imports every fleetless competitor into the Default fleet', () => {
    const file = buildSeriesFileFromSailwave(entryList(), DEFAULT_OPTS);
    expect(file.competitors).toHaveLength(2);
    const defaultFleetId = file.fleets[0].id;
    for (const c of file.competitors) {
      expect(c.fleetIds).toEqual([defaultFleetId]);
    }
  });

  it('keeps the full schedule as empty races when no result is entered anywhere', () => {
    const file = buildSeriesFileFromSailwave(entryList(), DEFAULT_OPTS);
    expect(file.races).toHaveLength(2);
    for (const r of file.races) {
      expect(r.finishes).toHaveLength(0);
    }
  });

  it('reports hasResults=false for an all-rrestyp=0 entry list', () => {
    const preview = inspectSailwave(entryList());
    expect(preview.competitorCount).toBe(2);
    expect(preview.raceCount).toBe(2);
    expect(preview.fleets.map((f) => f.name)).toEqual(['Default']);
    expect(preview.hasResults).toBe(false);
  });

  it('still drops the unsailed tail when some races have results', () => {
    // Same shape, but boat 53 finished race 62. Race 63 stays unsailed and is
    // dropped (the partial-scoring behaviour), leaving only the sailed race.
    const raw = parseSailwaveBlw(blw([
      ['serversion', '2.38.02', '', ''],
      ['comphelmname', 'Cormac Farrelly', '53', ''],
      ['compsailno', '635', '53', ''],
      ['compexclude', '0', '53', ''],
      ['compalias', '0', '53', ''],
      ['comphelmname', 'Kate Lyttle', '54', ''],
      ['compsailno', '1024', '54', ''],
      ['compexclude', '0', '54', ''],
      ['compalias', '0', '54', ''],
      ['racerank', '1', '', '62'],
      ['racerank', '2', '', '63'],
      ['rrestyp', '1', '53', '62'],
      ['rpos', '1', '53', '62'],
      ['rrestyp', '0', '54', '62'],
      ['rrestyp', '0', '53', '63'],
      ['rrestyp', '0', '54', '63'],
    ]));
    const file = buildSeriesFileFromSailwave(raw, DEFAULT_OPTS);
    expect(file.races).toHaveLength(1);
    expect(file.races[0].finishes.length).toBeGreaterThan(0);
  });

  it('buckets only the fleetless competitors into Default, keeping named fleets', () => {
    const raw = parseSailwaveBlw(blw([
      ['serversion', '2.38.02', '', ''],
      ['comphelmname', 'Named', '53', ''],
      ['compsailno', '635', '53', ''],
      ['compfleet', 'Fast PY', '53', ''],
      ['comprating', '1100', '53', ''],
      ['compexclude', '0', '53', ''],
      ['compalias', '0', '53', ''],
      ['comphelmname', 'Fleetless', '54', ''],
      ['compsailno', '1024', '54', ''],
      ['compexclude', '0', '54', ''],
      ['compalias', '0', '54', ''],
    ]));
    const file = buildSeriesFileFromSailwave(raw, DEFAULT_OPTS);
    expect(file.fleets.map((f) => f.name).sort()).toEqual(['Default', 'Fast PY']);
    const byName = new Map(file.fleets.map((f) => [f.name, f.id]));
    const named = file.competitors.find((c) => c.sailNumber === '635');
    const fleetless = file.competitors.find((c) => c.sailNumber === '1024');
    expect(named?.fleetIds).toEqual([byName.get('Fast PY')]);
    expect(fleetless?.fleetIds).toEqual([byName.get('Default')]);
  });
});

describe('buildSeriesFileFromSailwave: errors', () => {
  it('throws on unknown rcod values in the source file', () => {
    const raw = loadFile(`${FIXTURES}/py-example/2026 Dinghy F'Bite Spring.blw`);
    expect(() => buildSeriesFileFromSailwave(raw, DEFAULT_OPTS)).toThrow(/Unknown Sailwave result code/);
  });
});

describe('buildSeriesFileFromSailwave: default date fallback', () => {
  it('uses the current year as the hint for word-month dates when defaultRaceDate is omitted', () => {
    const raw = loadFile(`${HYC}/2026 Tues Series 1.blw`);
    const file = buildSeriesFileFromSailwave(raw, {
      ...DEFAULT_OPTS,
      defaultRaceDate: undefined,
    });
    const year = new Date().getFullYear();
    expect(file.races.map((r) => r.date)).toEqual([`${year}-05-05`, `${year}-05-12`]);
  });

  it('falls back to the default date for races Sailwave leaves undated', () => {
    const raw = loadFile(`${HYC}/2026 Tues Series 1.blw`);
    const file = buildSeriesFileFromSailwave(raw, {
      ...DEFAULT_OPTS,
      includeResults: false, // keep the undated, scheduled-but-unsailed races
      defaultRaceDate: '2026-04-01',
    });
    const dates = file.races.map((r) => r.date);
    // The word-month races still resolve; the undated remainder gets the default.
    expect(dates).toContain('2026-05-05');
    expect(dates).toContain('2026-04-01');
  });
});

describe('parseSailwaveColumns', () => {
  it('extracts the custom title and visibility flags from a column def', () => {
    const cols = parseSailwaveColumns({
      header: { generator: 'sailwave' },
      columns: {
        '23': '1|HelmAgeGroup|23|Yes|Yes|40|Category|',
        '18': '1|Division|12|No|No|40||',
      },
    });
    expect(cols.get('HelmAgeGroup')).toMatchObject({
      title: 'Category',
      visible: true,
      publish: true,
    });
    // Division has no custom title and is hidden/unpublished.
    expect(cols.get('Division')).toMatchObject({ title: '', visible: false, publish: false });
  });

  it('skips entries with an empty field name and tolerates a missing section', () => {
    const cols = parseSailwaveColumns({
      header: { generator: 'sailwave' },
      columns: { '1': '1||5|No|No|40||' },
    });
    expect(cols.size).toBe(0);
    expect(parseSailwaveColumns({ header: { generator: 'sailwave' } }).size).toBe(0);
  });
});

describe('resolveSubdivisionAxes', () => {
  const columns = (defs: Record<string, string>) =>
    parseSailwaveColumns({ header: { generator: 'sailwave' }, columns: defs });

  it('emits one axis per populated source, Division before the helm age group', () => {
    const comps = { '1': { compdivision: 'Silver', comphelmagegroup: 'GM', compexclude: '0' } };
    // No custom titles → per-source defaults, both axes present.
    expect(resolveSubdivisionAxes(comps, columns({}))).toEqual([
      { sourceKey: 'compdivision', label: 'Division' },
      { sourceKey: 'comphelmagegroup', label: 'Category' },
    ]);
    // Custom column titles win for each.
    expect(
      resolveSubdivisionAxes(
        comps,
        columns({ '18': '1|Division|12|Yes|Yes|40|Class|', '23': '1|HelmAgeGroup|23|Yes|Yes|40|Age band|' }),
      ),
    ).toEqual([
      { sourceKey: 'compdivision', label: 'Class' },
      { sourceKey: 'comphelmagegroup', label: 'Age band' },
    ]);
  });

  it('emits only the helm age group when Division is empty', () => {
    const comps = { '1': { comphelmagegroup: 'GGM', compexclude: '0' } };
    expect(resolveSubdivisionAxes(comps, columns({}))).toEqual([
      { sourceKey: 'comphelmagegroup', label: 'Category' },
    ]);
  });

  it('returns no axes when the file carries no subdivision data', () => {
    expect(resolveSubdivisionAxes({ '1': { compsailno: '1', compexclude: '0' } }, columns({}))).toEqual([]);
  });

  it('ignores excluded competitors when deciding whether a field is populated', () => {
    const comps = { '1': { comphelmagegroup: 'GM', compexclude: '1' } };
    expect(resolveSubdivisionAxes(comps, columns({}))).toEqual([]);
  });
});

describe('subdivision import (ILCA Masters Category fixture)', () => {
  const raw = loadFile(`${FIXTURES}/ilca-masters-category.blw`);

  it('detects the Category column in the preview', () => {
    expect(inspectSailwave(raw).detectedSubdivisionLabels).toEqual(['Category']);
  });

  it('imports the column verbatim into one axis, enables the field, and labels it "Category"', () => {
    const file = buildSeriesFileFromSailwave(raw, DEFAULT_OPTS);
    expect(file.series.subdivisionAxes).toHaveLength(1);
    expect(file.series.subdivisionAxes![0].label).toBe('Category');
    expect(file.series.enabledCompetitorFields).toContain('subdivision');
    // Values land as-is (the Sailwave codes), not expanded.
    const axisId = file.series.subdivisionAxes![0].id;
    const subs = file.competitors.map((c) => c.subdivisions?.[axisId]).sort();
    expect(subs).toEqual(['AM', 'GGM', 'GM', 'M', 'M']);
  });

  it('honours an explicit label override from the wizard', () => {
    const file = buildSeriesFileFromSailwave(raw, { ...DEFAULT_OPTS, subdivisionLabel: 'Age group' });
    expect(file.series.subdivisionAxes![0].label).toBe('Age group');
    expect(file.series.enabledCompetitorFields).toContain('subdivision');
  });
});

describe('subdivision import: file with no subdivision data', () => {
  const raw: SailwaveRaw = {
    header: { generator: 'sailwave' },
    globals: { serevent: 'No Category', servenue: 'HYC' },
    competitors: {
      '1': { compsailno: '1', comphelmname: 'A', compfleet: 'ILCA 6', compexclude: '0', compalias: '0' },
    },
    races: {},
  };

  it('leaves the field disabled and no axes configured', () => {
    expect(inspectSailwave(raw).detectedSubdivisionLabels).toEqual([]);
    const file = buildSeriesFileFromSailwave(raw, DEFAULT_OPTS);
    expect(file.series.subdivisionAxes).toEqual([]);
    expect(file.series.enabledCompetitorFields).not.toContain('subdivision');
    expect(file.competitors.every((c) => c.subdivisions === undefined)).toBe(true);
  });
});

describe('sailwaveTimeToColon', () => {
  it('passes HH:MM:SS through', () => {
    expect(sailwaveTimeToColon('19:15:00')).toBe('19:15:00');
  });
  it('converts dot-separated times', () => {
    expect(sailwaveTimeToColon('19.15.00')).toBe('19:15:00');
  });
  it('expands six-digit compact times', () => {
    expect(sailwaveTimeToColon('191500')).toBe('19:15:00');
  });
  it('returns null for blank or unparseable input', () => {
    expect(sailwaveTimeToColon('')).toBeNull();
    expect(sailwaveTimeToColon(undefined)).toBeNull();
    expect(sailwaveTimeToColon('abc')).toBeNull();
  });
});

describe('parseStartString', () => {
  it('extracts fleet name and gun time from the pipe-delimited blob', () => {
    const parsed = parseStartString('Fleet^Puppeteer HPH^=^=^=|19.15.00|Finish time|Start 1|||0|');
    expect(parsed).toEqual({ fleetNames: ['Puppeteer HPH'], startTime: '19:15:00' });
  });
  it('extracts every fleet named in a shared-gun start (2024/2025 HYC form)', () => {
    // One Puppeteer gun covers both scoring fleets — Sailwave chains the pairs
    // 'Fleet^Puppeteer Scratch^^^Fleet^Puppeteer HPH'. Both must be returned so
    // the start covers both fleets, not just the first.
    const parsed = parseStartString(
      'Fleet^Puppeteer Scratch^^^Fleet^Puppeteer HPH^^^^^^^=^=^=^=^=^=|19:30:00|Finish time|Start 1|||0||0|0||||1',
    );
    expect(parsed).toEqual({
      fleetNames: ['Puppeteer Scratch', 'Puppeteer HPH'],
      startTime: '19:30:00',
    });
  });
  it('treats a fleet-less gun as a combined (all-fleet) start', () => {
    // Cruiser divisions share one start signal — Sailwave writes it with an
    // empty segment 0 (no 'Fleet^...' prefix). An empty fleetNames list tells
    // the caller to fan it out across every fleet racing (issue #147 §5).
    expect(parseStartString('|10.35.00|Finish time|Start 1|||0||0|0||||1'))
      .toEqual({ fleetNames: [], startTime: '10:35:00' });
    expect(parseStartString('|19.15.00')).toEqual({ fleetNames: [], startTime: '19:15:00' });
  });
  it('returns null when there is no parseable gun time', () => {
    expect(parseStartString('no pipes here')).toBeNull();
    expect(parseStartString('||Place|Start 1|||0')).toBeNull(); // combined but no time
  });
});

describe('parseSailwaveRaceDate', () => {
  it('parses DD-MM-YY with d-m-y datespec', () => {
    expect(parseSailwaveRaceDate('07-05-26', 'd-m-y')).toBe('2026-05-07');
  });
  it('parses DD-MM-YYYY with d-m-y datespec', () => {
    expect(parseSailwaveRaceDate('07-05-2026', 'd-m-y')).toBe('2026-05-07');
  });
  it('parses YYYY-MM-DD with y-m-d datespec', () => {
    expect(parseSailwaveRaceDate('2026-05-07', 'y-m-d')).toBe('2026-05-07');
  });
  it('parses MM/DD/YY with m-d-y datespec', () => {
    expect(parseSailwaveRaceDate('05/07/26', 'm-d-y')).toBe('2026-05-07');
  });
  it('falls back to a sensible guess when no datespec is given', () => {
    expect(parseSailwaveRaceDate('2026-05-07', undefined)).toBe('2026-05-07');
    expect(parseSailwaveRaceDate('07-05-26', undefined)).toBe('2026-05-07');
  });
  it('returns null for year-less variants without a year hint', () => {
    expect(parseSailwaveRaceDate('May 5th', 'd-m-y')).toBeNull();
    expect(parseSailwaveRaceDate('Aug 16', 'd-m-y')).toBeNull();
  });
  it('resolves word-month dates with ordinal suffixes using the year hint', () => {
    expect(parseSailwaveRaceDate('May 5th', 'd-m-y', 2026)).toBe('2026-05-05');
    expect(parseSailwaveRaceDate('May 12th', 'd-m-y', 2026)).toBe('2026-05-12');
    expect(parseSailwaveRaceDate('May 19th', 'd-m-y', 2026)).toBe('2026-05-19');
    expect(parseSailwaveRaceDate('Jun 2nd', 'd-m-y', 2026)).toBe('2026-06-02');
  });
  it('resolves word-month dates regardless of day/month order', () => {
    expect(parseSailwaveRaceDate('19 May', undefined, 2026)).toBe('2026-05-19');
    expect(parseSailwaveRaceDate('19th May', undefined, 2026)).toBe('2026-05-19');
    expect(parseSailwaveRaceDate('August 16', undefined, 2025)).toBe('2025-08-16');
  });
  it('prefers an explicit year in the text over the hint', () => {
    expect(parseSailwaveRaceDate('May 19th 2024', 'd-m-y', 2026)).toBe('2024-05-19');
    expect(parseSailwaveRaceDate('19 May 2024', undefined, 2026)).toBe('2024-05-19');
  });
  it('returns null for word input that is not a month', () => {
    expect(parseSailwaveRaceDate('Foo 19th', 'd-m-y', 2026)).toBeNull();
  });
  it('returns null for blank or empty input', () => {
    expect(parseSailwaveRaceDate('', 'd-m-y')).toBeNull();
    expect(parseSailwaveRaceDate(undefined, 'd-m-y')).toBeNull();
  });
});

describe('inferBareNameSystem', () => {
  it('returns scratch when no ratings are present', () => {
    expect(inferBareNameSystem([])).toBe('scratch');
    expect(inferBareNameSystem([null, null])).toBe('scratch');
  });
  it('returns py when all ratings are integers in the PY range', () => {
    expect(inferBareNameSystem([1156, 1103, 1218])).toBe('py');
  });
  it('returns nhc for decimal rating multipliers near 1.0', () => {
    expect(inferBareNameSystem([1.35, 1.33, 1.35])).toBe('nhc');
  });
  it('returns nhc when ratings are a mix of decimals and integers', () => {
    expect(inferBareNameSystem([1156, 1.35])).toBe('nhc');
  });
});
