import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseSailwaveJson,
  inspectSailwave,
  buildSeriesFileFromSailwave,
  parseStartString,
  parseSailwaveRaceDate,
  sailwaveTimeToColon,
  inferBareNameSystem,
  SailwaveImportError,
  type SailwaveImportOptions,
  type SailwaveRaw,
} from '@/lib/sailwave-import';

const REF = 'reference/data';
const HYC = `${REF}/2026-hyc-club-racing`;

function loadFile(path: string): SailwaveRaw {
  const bytes = readFileSync(join(process.cwd(), path));
  // readFileSync returns a Buffer; pass the underlying ArrayBuffer slice.
  return parseSailwaveJson(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  );
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

describe('parseSailwaveJson', () => {
  it('parses a real Sailwave export', () => {
    const raw = loadFile(`${HYC}/2026 Tues Series 1.json`);
    expect(raw.header?.generator).toBe('sailwave');
    expect(raw.globals?.serevent).toBe('Club Racing 2026');
    expect(Object.keys(raw.competitors ?? {}).length).toBeGreaterThan(0);
  });

  it('tolerates bare control chars in strings (Sailwave\'s Windows paths)', () => {
    // Embed a literal CR (0x0d) inside a string the way Sailwave does for
    // Windows paths. JSON.parse would normally reject it.
    const withBareCr = '{"header":{"generator":"sailwave"},"x":"C:\\\\Users\rfoo"}';
    expect(() => {
      parseSailwaveJson(new TextEncoder().encode(withBareCr).buffer);
    }).not.toThrow();
  });

  it('strips trailing commas before } and ]', () => {
    const withTrailing = '{"header":{"generator":"sailwave"},"x":[1,2,],}';
    expect(() => {
      parseSailwaveJson(new TextEncoder().encode(withTrailing).buffer);
    }).not.toThrow();
  });

  it('rejects files that lack the sailwave header.generator', () => {
    const bytes = new TextEncoder().encode('{"header":{"generator":"halsail"}}').buffer;
    expect(() => parseSailwaveJson(bytes)).toThrow(SailwaveImportError);
  });
});

describe('inspectSailwave', () => {
  it('summarises the Tues Series file (dual-scored HPH + Scr)', () => {
    const raw = loadFile(`${HYC}/2026 Tues Series 1.json`);
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
  });

  it('auto-detects bare-name fleets: Optimist=scratch (no ratings), PY=py (integer ratings)', () => {
    const raw = loadFile(`${HYC}/2026 Dinghies Series 1.json`);
    const preview = inspectSailwave(raw);
    const byName = new Map(preview.fleets.map((f) => [f.name, f]));
    expect(byName.get('Optimist')?.detectedScoringSystem).toBe('scratch');
    expect(byName.get('Optimist')?.isBareName).toBe(true);
    expect(byName.get('PY')?.detectedScoringSystem).toBe('py');
    expect(byName.get('PY')?.isBareName).toBe(true);
  });

  it('reads NHC example with all-suffixed fleets', () => {
    const raw = loadFile(`${REF}/nhc-example/2025 Puppeteer 22 Championships.json`);
    const preview = inspectSailwave(raw);
    expect(preview.raceCount).toBe(7);
    expect(preview.competitorCount).toBe(14);
    expect(preview.detectedDnfScoring).toBe('startingArea');
  });
});

describe('buildSeriesFileFromSailwave: Tues Series 1', () => {
  const raw = loadFile(`${HYC}/2026 Tues Series 1.json`);
  const file = buildSeriesFileFromSailwave(raw, DEFAULT_OPTS);

  it('produces fleets sorted alphabetically by name', () => {
    expect(file.fleets.map((f) => f.name)).toEqual([
      'Puppeteer HPH',
      'Puppeteer Scr',
      'Squib HPH',
      'Squib Scr',
    ]);
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

  it('falls back to defaultRaceDate when racedate is year-less ("May 5th")', () => {
    // Tues file's racedate is "May 5th" / "May 12th" — no year, unparseable.
    for (const r of file.races) {
      expect(r.date).toBe('2026-05-05');
    }
  });

  it('enables only the competitor fields Sailwave actually populated', () => {
    // Tues file: boat names yes; class no; club no; crew no.
    expect(file.series.enabledCompetitorFields).toEqual(['boatName']);
  });
});

describe('buildSeriesFileFromSailwave: Wed Series 1', () => {
  const raw = loadFile(`${HYC}/2026 Wed Series 1.json`);
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
  const raw = loadFile(`${HYC}/2026 Dinghies Series 1.json`);
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
    const raw = loadFile(`${HYC}/2026 Dinghies Series 1.json`);
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
    const raw = loadFile(`${REF}/nhc-example/2025 Puppeteer 22 Championships.json`);
    const file = buildSeriesFileFromSailwave(raw, DEFAULT_OPTS);
    const allFinishes = file.races.flatMap((r) => r.finishes);
    expect(allFinishes.some((f) => f.resultCode === 'DNC')).toBe(false);
    // DNF and OCS rows from the source should survive.
    expect(allFinishes.some((f) => f.resultCode === 'DNF')).toBe(true);
  });
});

describe('buildSeriesFileFromSailwave: includeScratchCompanions=false', () => {
  it('drops Scr companion fleets and their memberships', () => {
    const raw = loadFile(`${HYC}/2026 Tues Series 1.json`);
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

describe('buildSeriesFileFromSailwave: includeResults=false', () => {
  it('keeps the full race schedule with empty finishes', () => {
    const raw = loadFile(`${HYC}/2026 Tues Series 1.json`);
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

describe('buildSeriesFileFromSailwave: errors', () => {
  it('throws on unknown rcod values in the source file', () => {
    const raw = loadFile(`${REF}/py-example/2026 Dinghy F'Bite Spring.json`);
    expect(() => buildSeriesFileFromSailwave(raw, DEFAULT_OPTS)).toThrow(/Unknown Sailwave result code/);
  });
});

describe('buildSeriesFileFromSailwave: default date fallback', () => {
  it('uses today\'s date when defaultRaceDate is omitted and Sailwave has no parseable date', () => {
    const raw = loadFile(`${HYC}/2026 Tues Series 1.json`);
    const file = buildSeriesFileFromSailwave(raw, {
      ...DEFAULT_OPTS,
      defaultRaceDate: undefined,
    });
    const today = new Date();
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    for (const r of file.races) {
      expect(r.date).toBe(todayIso);
    }
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
    expect(parsed).toEqual({ fleetName: 'Puppeteer HPH', startTime: '19:15:00' });
  });
  it('returns null for malformed input', () => {
    expect(parseStartString('no pipes here')).toBeNull();
    expect(parseStartString('|19.15.00')).toBeNull();
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
  it('returns null for year-less variants like "May 5th" or "Aug 16"', () => {
    expect(parseSailwaveRaceDate('May 5th', 'd-m-y')).toBeNull();
    expect(parseSailwaveRaceDate('Aug 16', 'd-m-y')).toBeNull();
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
