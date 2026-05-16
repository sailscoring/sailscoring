import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseSailwaveJson,
  inspectSailwave,
  buildSeriesFileFromSailwave,
  parseStartString,
  sailwaveTimeToColon,
  raceDates,
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

const DEFAULT_OPTS: Omit<SailwaveImportOptions, 'startDate'> = {
  name: '',
  venue: '',
  raceDays: new Set(),
  primaryLabel: 'helm',
  fleetScoringOverrides: new Map(),
  includeScratchCompanions: true,
  includeResults: true,
};

describe('parseSailwaveJson', () => {
  it('parses a real Sailwave 2.38 export', () => {
    const raw = loadFile(`${HYC}/2026 Tues Series 1.json`);
    expect(raw.header?.generator).toBe('sailwave');
    expect(raw.globals?.serevent).toBe('Club Racing 2026');
    expect(Object.keys(raw.competitors ?? {}).length).toBeGreaterThan(0);
  });

  it('strips trailing commas and tolerates bare control chars in strings', () => {
    const json = '{"a": "C:\\\\Users\\rfoo", "b": 1,}';
    // Embed a literal CR (0x0d) inside a string the way Sailwave does for
    // Windows paths. JSON.parse would normally reject it.
    const withBareCr = '{"a": "C:\\\\Users\rfoo", "b": 1,}';
    const bytes = new TextEncoder().encode(withBareCr).buffer;
    // Force the header so parseSailwaveJson doesn't reject as non-sailwave.
    const wrapped = `{"header":{"generator":"sailwave"},"x":${withBareCr.slice(0, -1)}}}`;
    // Sanity: a clean call should still produce a valid object.
    expect(() => JSON.parse(json)).toThrow();
    expect(() => {
      parseSailwaveJson(new TextEncoder().encode(wrapped).buffer);
    }).not.toThrow();
    expect(bytes).toBeDefined();
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
    expect(preview.raceCount).toBe(6); // includes scheduled-but-unsailed races
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

  it('flags bare fleet names so the wizard can prompt for an override', () => {
    const raw = loadFile(`${HYC}/2026 Dinghies Series 1.json`);
    const preview = inspectSailwave(raw);
    // Dinghies has bare names "Optimist" and "PY" (no scoring suffix).
    const bare = preview.fleets.filter((f) => f.isBareName).map((f) => f.name).sort();
    expect(bare).toContain('Optimist');
    expect(bare).toContain('PY');
  });

  it('reads NHC example with all-suffixed fleets', () => {
    const raw = loadFile(`${REF}/nhc-example/2025 Puppeteer 22 Championships.json`);
    const preview = inspectSailwave(raw);
    // 7 races scheduled in the source; one ends up empty after build (the
    // build step skips empty races so the count drops to 6 there).
    expect(preview.raceCount).toBe(7);
    expect(preview.competitorCount).toBe(14);
    expect(preview.detectedDnfScoring).toBe('startingArea');
  });
});

describe('buildSeriesFileFromSailwave: Tues Series 1', () => {
  const raw = loadFile(`${HYC}/2026 Tues Series 1.json`);
  const file = buildSeriesFileFromSailwave(raw, {
    ...DEFAULT_OPTS,
    startDate: '2026-05-05',
    raceDays: new Set([2]), // Tuesday in JS Date.getDay()
  });

  it('produces fleets in Sailwave declaration order', () => {
    // Python script gave 4 fleets total.
    expect(file.fleets).toHaveLength(4);
    expect(file.fleets.map((f) => f.scoringSystem)).toEqual(['nhc', 'scratch', 'nhc', 'scratch']);
  });

  it('collapses primary+alias rows into one competitor per physical boat', () => {
    // Tues file: every boat is dual-scored (HPH + Scr), so every competitor
    // should end up with 2 fleet memberships.
    expect(file.competitors).toHaveLength(29);
    for (const c of file.competitors) {
      expect(c.fleetIds).toHaveLength(2);
    }
  });

  it('routes HPH ratings to nhcStartingTcf', () => {
    const rated = file.competitors.filter((c) => c.nhcStartingTcf !== undefined);
    expect(rated.length).toBe(29);
    // Sail 15 is in the data with TCF 1.35 per the Python script's output.
    const sail15 = file.competitors.find((c) => c.sailNumber === '15');
    expect(sail15?.nhcStartingTcf).toBeCloseTo(1.35);
  });

  it('skips races with no finishers (when including results)', () => {
    // Python wrote 2 races (the other 4 had no finishers yet).
    expect(file.races).toHaveLength(2);
  });

  it('fans the start gun out across companion fleets sharing a base name', () => {
    const race = file.races[0];
    // Each Sailwave start has 2 underlying fleets (HPH + Scr companion).
    for (const start of race.starts) {
      expect(start.fleetIds.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('produces 29 finishes per race', () => {
    for (const r of file.races) {
      expect(r.finishes).toHaveLength(29);
    }
  });

  it('uses the Sailwave-resolved DNF scoring (startingArea here)', () => {
    expect(file.series.dnfScoring).toBe('startingArea');
  });

  it('schedules races on the requested weekday', () => {
    // Tuesdays starting 2026-05-05 → 2026-05-05, 2026-05-12
    expect(file.races.map((r) => r.date)).toEqual(['2026-05-05', '2026-05-12']);
  });
});

describe('buildSeriesFileFromSailwave: Wed Series 1', () => {
  const raw = loadFile(`${HYC}/2026 Wed Series 1.json`);
  const file = buildSeriesFileFromSailwave(raw, {
    ...DEFAULT_OPTS,
    startDate: '2026-05-06',
    raceDays: new Set([3]), // Wednesday
  });

  it('produces 6 fleets across Divisions A/B/C × HPH/IRC', () => {
    expect(file.fleets).toHaveLength(6);
    const irc = file.fleets.filter((f) => f.scoringSystem === 'irc');
    const nhc = file.fleets.filter((f) => f.scoringSystem === 'nhc');
    expect(irc).toHaveLength(3);
    expect(nhc).toHaveLength(3);
  });

  it('routes IRC ratings to ircTcc and HPH ratings to nhcStartingTcf', () => {
    const withIrc = file.competitors.filter((c) => c.ircTcc !== undefined);
    const withNhc = file.competitors.filter((c) => c.nhcStartingTcf !== undefined);
    expect(withIrc.length).toBeGreaterThan(0);
    expect(withNhc.length).toBeGreaterThan(0);
  });
});

describe('buildSeriesFileFromSailwave: PY override', () => {
  it('honours per-fleet scoring overrides', () => {
    const raw = loadFile(`${HYC}/2026 Dinghies Series 1.json`);
    const file = buildSeriesFileFromSailwave(raw, {
      ...DEFAULT_OPTS,
      startDate: '2026-05-07',
      raceDays: new Set([4]), // Thursday
      fleetScoringOverrides: new Map([
        ['Optimist', 'scratch'],
        ['PY', 'py'],
      ]),
    });
    expect(file.fleets.map((f) => `${f.name}=${f.scoringSystem}`).sort()).toEqual([
      'Optimist=scratch',
      'PY=py',
    ]);
    // PY ratings should land in pyNumber.
    const withPy = file.competitors.filter((c) => c.pyNumber !== undefined);
    expect(withPy.length).toBeGreaterThan(0);
  });
});

describe('buildSeriesFileFromSailwave: includeScratchCompanions=false', () => {
  it('drops Scr companion fleets and their memberships', () => {
    const raw = loadFile(`${HYC}/2026 Tues Series 1.json`);
    const file = buildSeriesFileFromSailwave(raw, {
      ...DEFAULT_OPTS,
      startDate: '2026-05-05',
      raceDays: new Set([2]),
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
      startDate: '2026-05-05',
      raceDays: new Set([2]),
      includeResults: false,
    });
    expect(file.races.length).toBe(6); // all 6 scheduled races
    for (const r of file.races) {
      expect(r.finishes).toHaveLength(0);
    }
  });
});

describe('buildSeriesFileFromSailwave: errors', () => {
  it('throws on unknown rcod values in the source file', () => {
    const raw = loadFile(`${REF}/py-example/2026 Dinghy F'Bite Spring.json`);
    expect(() =>
      buildSeriesFileFromSailwave(raw, {
        ...DEFAULT_OPTS,
        startDate: '2026-05-05',
      }),
    ).toThrow(/Unknown Sailwave result code/);
  });

  it('rejects malformed start date', () => {
    const raw = loadFile(`${HYC}/2026 Tues Series 1.json`);
    expect(() =>
      buildSeriesFileFromSailwave(raw, {
        ...DEFAULT_OPTS,
        startDate: 'not-a-date',
      }),
    ).toThrow(SailwaveImportError);
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

describe('raceDates', () => {
  // Use local-time formatting (not toISOString, which is UTC and shifts the
  // date in non-UTC timezones).
  function fmt(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  it('returns startDate repeated when weekdays is empty', () => {
    const out = raceDates(new Date(2026, 4, 5), 3, new Set());
    expect(out.map(fmt)).toEqual(['2026-05-05', '2026-05-05', '2026-05-05']);
  });
  it('walks forward to matching weekdays', () => {
    // 2026-05-05 is a Tuesday (getDay() === 2).
    const out = raceDates(new Date(2026, 4, 5), 3, new Set([2]));
    expect(out.map(fmt)).toEqual(['2026-05-05', '2026-05-12', '2026-05-19']);
  });
  it('alternates across multiple weekdays', () => {
    // Tuesday + Saturday cadence starting on a Tuesday.
    const out = raceDates(new Date(2026, 4, 5), 4, new Set([2, 6]));
    expect(out.map(fmt)).toEqual(['2026-05-05', '2026-05-09', '2026-05-12', '2026-05-16']);
  });
});
