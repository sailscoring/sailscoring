import { describe, it, expect } from 'vitest';
import {
  renderSeriesHtml,
  renderCombinedSeriesHtml,
  assembleSeriesResultsData,
  type SeriesResultsData,
  type RaceData,
  type StandingRowData,
} from '@/lib/results-renderer';
import type { ResultCode } from '@/lib/types';

// ---- Fixtures ----

function makeStanding(
  rank: number,
  sail: string,
  helm: string,
  scores: Array<{ points: number; resultCode?: ResultCode; podiumRank?: 1 | 2 | 3 }>,
): StandingRowData {
  const totalPoints = scores.reduce((s, r) => s + r.points, 0);
  return {
    rank,
    sailNumber: sail,
    helm,
    raceScores: scores.map((s) => ({
      points: s.points,
      resultCode: s.resultCode ?? null,
      isDiscard: false,
      podiumRank: s.podiumRank ?? null,
      penaltyCode: null,
      penaltyOverride: null,
      isRedress: false,
    })),
    totalPoints,
    netPoints: totalPoints,
  };
}

function makeRace(n: number, results: Array<[string, string, number, ResultCode | null]>): RaceData {
  return {
    raceNumber: n,
    date: `2025-06-0${n}`,
    label: `R${n}`,
    anchorId: `r${n}`,
    results: results.map(([sail, helm, points, code], i) => ({
      rank: i + 1,
      sailNumber: sail,
      helm,
      place: code === null ? points : null,
      points,
      resultCode: code,
      penaltyCode: null,
      penaltyOverride: null,
    })),
  };
}

const MINIMAL: SeriesResultsData = {
  series: { name: 'Test Series', venue: 'Test Venue' },
  enabledCompetitorFields: ['club'],
  races: [
    makeRace(1, [['42', 'Alice', 1, null], ['99', 'Bob', 2, null]]),
    makeRace(2, [['99', 'Bob', 1, null], ['42', 'Alice', 2, null]]),
  ],
  standings: [
    makeStanding(1, '42', 'Alice', [
      { points: 1, podiumRank: 1 },
      { points: 2, podiumRank: 2 },
    ]),
    makeStanding(2, '99', 'Bob', [
      { points: 2, podiumRank: 2 },
      { points: 1, podiumRank: 1 },
    ]),
  ],
};

// ---- renderSeriesHtml ----

describe('renderSeriesHtml', () => {
  it('produces a complete HTML document', () => {
    const html = renderSeriesHtml(MINIMAL);
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('</html>');
  });

  it('includes a print stylesheet and a Save as PDF button', () => {
    const html = renderSeriesHtml(MINIMAL);
    // @media print block tuned for a clean printout (#207).
    expect(html).toContain('@media print');
    expect(html).toContain('print-color-adjust: exact');
    // Screen-only control that opens the browser print dialog, inline in the
    // footer credit line.
    expect(html).toContain('onclick="window.print()"');
    expect(html).toContain('Save as PDF');
    expect(html).toMatch(/class="credit"[^]*Save as PDF[^]*<\/p>/);
  });

  it('includes series name in title and heading', () => {
    const html = renderSeriesHtml(MINIMAL);
    expect(html).toContain('Test Series');
    expect(html).toContain('<h1>Test Series</h1>');
  });

  it('includes venue in h2', () => {
    const html = renderSeriesHtml(MINIMAL);
    expect(html).toContain('<h2>Test Venue</h2>');
  });

  it('omits h2 when venue is empty', () => {
    const html = renderSeriesHtml({ ...MINIMAL, series: { name: 'X', venue: '' } });
    expect(html).not.toContain('<h2>');
  });

  it('omits the series-index breadcrumb when no seriesIndexUrl is set', () => {
    // Downloads / FTP / preview have no `/p/` parent, so no breadcrumb.
    const html = renderSeriesHtml(MINIMAL);
    expect(html).not.toContain('class="breadcrumb"');
  });

  it('renders a back breadcrumb to the series index when seriesIndexUrl is set', () => {
    const html = renderSeriesHtml({
      ...MINIMAL,
      seriesIndexUrl: '/p/hyc/test-series',
    });
    expect(html).toContain('class="breadcrumb"');
    expect(html).toContain('href="/p/hyc/test-series"');
    expect(html).toContain('&larr; Test Series');
    // The breadcrumb sits above the header table / heading.
    expect(html.indexOf('class="breadcrumb"')).toBeLessThan(
      html.indexOf('<h1>Test Series</h1>'),
    );
  });

  it('renders summary table with correct ordinal ranks', () => {
    const html = renderSeriesHtml(MINIMAL);
    expect(html).toContain('1st');
    expect(html).toContain('2nd');
  });

  it('renders race column headers as links to anchors', () => {
    const html = renderSeriesHtml(MINIMAL);
    expect(html).toContain('<a class="racelink" href="#r1">R1</a>');
    expect(html).toContain('<a class="racelink" href="#r2">R2</a>');
  });

  it('renders race detail sections with correct anchor ids', () => {
    const html = renderSeriesHtml(MINIMAL);
    expect(html).toContain('id="r1"');
    expect(html).toContain('id="r2"');
  });

  it('applies rank1/rank2/rank3 CSS classes for podium scores', () => {
    const html = renderSeriesHtml(MINIMAL);
    expect(html).toContain('class="rank1"');
    expect(html).toContain('class="rank2"');
  });

  it('does not apply rank classes to result-code cells', () => {
    const data: SeriesResultsData = {
      series: { name: 'S', venue: '' },
      enabledCompetitorFields: ['club'],
      races: [makeRace(1, [['1', 'A', 1, null], ['2', 'B', 2, 'DNC']])],
      standings: [
        makeStanding(1, '1', 'A', [{ points: 1, podiumRank: 1 }]),
        makeStanding(2, '2', 'B', [{ points: 2, resultCode: 'DNC' }]),
      ],
    };
    const html = renderSeriesHtml(data);
    // DNC cell should not get a rank class
    expect(html).not.toMatch(/class="rank\d"[^>]*>2\.0 DNC/);
  });

  it('wraps discarded scores in parentheses and applies discard class', () => {
    const data: SeriesResultsData = {
      series: { name: 'S', venue: '' },
      enabledCompetitorFields: ['club'],
      races: [
        makeRace(1, [['1', 'A', 1, null]]),
        makeRace(2, [['1', 'A', 4, 'DNC']]),
      ],
      standings: [
        {
          rank: 1,
          sailNumber: '1',
          helm: 'A',
          raceScores: [
            { points: 1, resultCode: null, isDiscard: false, podiumRank: 1, penaltyCode: null, penaltyOverride: null, isRedress: false },
            { points: 4, resultCode: 'DNC', isDiscard: true, podiumRank: null, penaltyCode: null, penaltyOverride: null, isRedress: false },
          ],
          totalPoints: 5,
          netPoints: 1,
        },
      ],
    };
    const html = renderSeriesHtml(data);
    expect(html).toContain('(4.0 DNC)');
    expect(html).toContain('class="discard"');
    // Nett column appears when hasDiscards
    expect(html).toContain('<th>Nett</th>');
  });

  it('omits Nett column when no discards', () => {
    const html = renderSeriesHtml(MINIMAL);
    expect(html).not.toContain('<th>Nett</th>');
  });

  it('renders Age and Gender columns when enabled and populated', () => {
    const data: SeriesResultsData = {
      series: { name: 'S', venue: '' },
      enabledCompetitorFields: ['age', 'gender'],
      races: [makeRace(1, [['1', 'Alice', 1, null], ['2', 'Bob', 2, null]])],
      standings: [
        { ...makeStanding(1, '1', 'Alice', [{ points: 1, podiumRank: 1 }]), age: 15, gender: 'F' },
        { ...makeStanding(2, '2', 'Bob', [{ points: 2, podiumRank: 2 }]), age: 12, gender: 'M' },
      ],
    };
    const html = renderSeriesHtml(data);
    expect(html).toContain('<th>Age</th>');
    expect(html).toContain('<th>Gender</th>');
    // Summary cells carry the integer age and the raw M/F code.
    expect(html).toContain('<td>15</td>');
    expect(html).toContain('<td>F</td>');
    expect(html).toContain('<td>M</td>');
  });

  it('suppresses Age and Gender columns when enabled but no competitor has a value', () => {
    const data: SeriesResultsData = {
      series: { name: 'S', venue: '' },
      enabledCompetitorFields: ['age', 'gender'],
      races: [makeRace(1, [['1', 'Alice', 1, null]])],
      standings: [makeStanding(1, '1', 'Alice', [{ points: 1, podiumRank: 1 }])],
    };
    const html = renderSeriesHtml(data);
    expect(html).not.toContain('<th>Age</th>');
    expect(html).not.toContain('<th>Gender</th>');
  });

  it('omits Age and Gender columns when the fields are not enabled', () => {
    const data: SeriesResultsData = {
      series: { name: 'S', venue: '' },
      enabledCompetitorFields: ['club'],
      races: [makeRace(1, [['1', 'Alice', 1, null]])],
      standings: [{ ...makeStanding(1, '1', 'Alice', [{ points: 1, podiumRank: 1 }]), age: 15, gender: 'F' }],
    };
    const html = renderSeriesHtml(data);
    expect(html).not.toContain('<th>Age</th>');
    expect(html).not.toContain('<th>Gender</th>');
  });

  it('includes provisional timestamp when generatedAt is set', () => {
    const html = renderSeriesHtml({
      ...MINIMAL,
      generatedAt: new Date(2025, 5, 14, 19, 30),
    });
    expect(html).toContain('Results are provisional as of');
    expect(html).toContain('2025');
  });

  it('omits provisional line when generatedAt is absent', () => {
    const html = renderSeriesHtml(MINIMAL);
    expect(html).not.toContain('provisional');
  });

  it('renders the provisional timestamp in the deployment timezone with a zone label', () => {
    // 22:22 UTC is 23:22 IST (Irish summer time) — the default Europe/Dublin zone.
    const html = renderSeriesHtml({
      ...MINIMAL,
      generatedAt: new Date('2026-05-30T22:22:00Z'),
    });
    expect(html).toContain('23:22 IST');
    expect(html).not.toContain('22:22');
  });

  it('honours NEXT_PUBLIC_DEFAULT_TIMEZONE override', () => {
    const prev = process.env.NEXT_PUBLIC_DEFAULT_TIMEZONE;
    process.env.NEXT_PUBLIC_DEFAULT_TIMEZONE = 'America/New_York';
    try {
      // 22:22 UTC is 18:22 EDT on this date.
      const html = renderSeriesHtml({
        ...MINIMAL,
        generatedAt: new Date('2026-05-30T22:22:00Z'),
      });
      expect(html).toContain('18:22');
    } finally {
      if (prev === undefined) delete process.env.NEXT_PUBLIC_DEFAULT_TIMEZONE;
      else process.env.NEXT_PUBLIC_DEFAULT_TIMEZONE = prev;
    }
  });

  it('falls back to the default timezone when the override is invalid', () => {
    const prev = process.env.NEXT_PUBLIC_DEFAULT_TIMEZONE;
    process.env.NEXT_PUBLIC_DEFAULT_TIMEZONE = 'Not/AZone';
    try {
      const html = renderSeriesHtml({
        ...MINIMAL,
        generatedAt: new Date('2026-05-30T22:22:00Z'),
      });
      expect(html).toContain('23:22 IST');
    } finally {
      if (prev === undefined) delete process.env.NEXT_PUBLIC_DEFAULT_TIMEZONE;
      else process.env.NEXT_PUBLIC_DEFAULT_TIMEZONE = prev;
    }
  });

  it('includes left logo img when leftLogoUrl is set', () => {
    const html = renderSeriesHtml({ ...MINIMAL, leftLogoUrl: 'https://example.com/logo.png' });
    expect(html).toContain('src="https://example.com/logo.png"');
  });

  it('leaves header logos unwrapped when no link URL is set', () => {
    const html = renderSeriesHtml({
      ...MINIMAL,
      leftLogoUrl: 'https://example.com/venue.png',
      rightLogoUrl: 'https://example.com/event.png',
    });
    // The img tags are present but not inside an anchor.
    expect(html).not.toContain('<a href="https://venue.example.com"');
    expect(html).toContain('src="https://example.com/venue.png"');
  });

  it('wraps the venue logo in a link when leftUrl is set', () => {
    const html = renderSeriesHtml({
      ...MINIMAL,
      leftLogoUrl: 'https://example.com/venue.png',
      leftUrl: 'https://venue.example.com',
    });
    expect(html).toContain(
      '<a href="https://venue.example.com" target="_top" rel="noopener"><img',
    );
  });

  it('wraps the event logo in a link when rightUrl is set', () => {
    const html = renderSeriesHtml({
      ...MINIMAL,
      rightLogoUrl: 'https://example.com/event.png',
      rightUrl: 'https://event.example.com',
    });
    expect(html).toContain(
      '<a href="https://event.example.com" target="_top" rel="noopener"><img',
    );
  });

  it('renders footer venue/event website links from leftUrl/rightUrl', () => {
    const html = renderSeriesHtml({
      ...MINIMAL,
      leftUrl: 'https://venue.example.com',
      rightUrl: 'https://event.example.com',
    });
    // Venue link uses the venue name as anchor text; event link uses the series name.
    expect(html).toContain('<p class="hardleft"><a href="https://venue.example.com" target="_top" rel="noopener">Test Venue</a></p>');
    expect(html).toContain('<p class="hardright"><a href="https://event.example.com" target="_top" rel="noopener">Test Series</a></p>');
  });

  it('falls back to the URL as footer venue link text when venue name is empty', () => {
    const html = renderSeriesHtml({
      ...MINIMAL,
      series: { name: 'Test Series', venue: '' },
      leftUrl: 'https://venue.example.com',
    });
    expect(html).toContain('>https://venue.example.com</a>');
  });

  it('leaves footer link slots empty when no website URLs are set', () => {
    const html = renderSeriesHtml(MINIMAL);
    expect(html).toContain('<p class="hardleft"></p>');
    expect(html).toContain('<p class="hardright"></p>');
  });

  it('prefixes https:// on scheme-less link URLs (as imported from Sailwave)', () => {
    const html = renderSeriesHtml({
      ...MINIMAL,
      series: { name: 'Test Series', venue: '' },
      leftLogoUrl: 'https://example.com/venue.png',
      leftUrl: 'www.hyc.ie',
      rightUrl: 'ilcaireland.com/event/masters-championships/',
    });
    // Header logo link and footer venue link both get the scheme.
    expect(html).toContain('<a href="https://www.hyc.ie" target="_top" rel="noopener"><img');
    expect(html).toContain('href="https://www.hyc.ie"');
    expect(html).toContain('href="https://ilcaireland.com/event/masters-championships/"');
    // With no venue name, the footer venue link text falls back to the bare
    // host (not the https-prefixed href).
    expect(html).toContain('>www.hyc.ie</a>');
  });

  it('leaves already-absolute and protocol-relative link URLs unchanged', () => {
    const httpsHtml = renderSeriesHtml({ ...MINIMAL, series: { name: 'S', venue: '' }, leftUrl: 'https://already.example' });
    expect(httpsHtml).toContain('href="https://already.example"');
    // http:// is a scheme too — don't force https.
    const httpHtml = renderSeriesHtml({ ...MINIMAL, series: { name: 'S', venue: '' }, leftUrl: 'http://plain.example' });
    expect(httpHtml).toContain('href="http://plain.example"');
    // Protocol-relative URLs are already absolute.
    const protoRel = renderSeriesHtml({ ...MINIMAL, series: { name: 'S', venue: '' }, leftUrl: '//cdn.example/x' });
    expect(protoRel).toContain('href="//cdn.example/x"');
  });

  it('escapes HTML special characters in names', () => {
    const data: SeriesResultsData = {
      ...MINIMAL,
      series: { name: 'A & B <Series>', venue: '' },
    };
    const html = renderSeriesHtml(data);
    expect(html).toContain('A &amp; B &lt;Series&gt;');
    expect(html).not.toContain('A & B <Series>');
  });

  it('includes Sail Scoring footer link', () => {
    const html = renderSeriesHtml(MINIMAL);
    expect(html).toContain('sailscoring.ie');
  });

  describe('enabledCompetitorFields column visibility', () => {
    // A race with a boat name and crew name set on the only competitor, so we
    // can confirm visibility is driven by the setting and not auto-detected
    // from whether data exists.
    const withBoatAndCrew: SeriesResultsData = {
      series: { name: 'S', venue: '' },
      enabledCompetitorFields: [],
      races: [
        {
          raceNumber: 1,
          date: '2025-06-01',
          label: 'R1',
          anchorId: 'r1',
          results: [
            {
              sailNumber: '1',
              boatName: 'Windchaser',
              helm: 'Alice',
              crewName: 'Mark',
              place: 1,
              rank: 1,
              points: 1,
              resultCode: null,
              penaltyCode: null,
              penaltyOverride: null,
            },
          ],
        },
      ],
      standings: [
        {
          rank: 1,
          sailNumber: '1',
          boatName: 'Windchaser',
          helm: 'Alice',
          crewName: 'Mark',
          raceScores: [
            { points: 1, resultCode: null, penaltyCode: null, penaltyOverride: null, isDiscard: false, isRedress: false, podiumRank: 1 },
          ],
          totalPoints: 1,
          netPoints: 1,
        },
      ],
    };

    it('hides Boat column when boatName is not enabled, even if data exists', () => {
      const html = renderSeriesHtml({ ...withBoatAndCrew, enabledCompetitorFields: [] });
      expect(html).not.toContain('<th>Boat</th>');
      expect(html).not.toContain('Windchaser');
    });

    it('shows Boat column when boatName is enabled', () => {
      const html = renderSeriesHtml({ ...withBoatAndCrew, enabledCompetitorFields: ['boatName'] });
      expect(html).toContain('<th>Boat</th>');
      expect(html).toContain('Windchaser');
    });

    it('renders a plain primary header when crewName is not enabled', () => {
      const html = renderSeriesHtml({ ...withBoatAndCrew, enabledCompetitorFields: [], primaryPersonLabel: 'helm' });
      expect(html).toContain('<th>Helm</th>');
      expect(html).not.toContain('Helm / Crew');
      // Crew name must not leak into the output
      expect(html).not.toContain('Mark');
    });

    it('renders "Primary / Crew" header and combined cell when crewName is enabled', () => {
      const html = renderSeriesHtml({ ...withBoatAndCrew, enabledCompetitorFields: ['crewName'], primaryPersonLabel: 'helm' });
      expect(html).toContain('<th>Helm / Crew</th>');
      expect(html).toContain('Alice / Mark');
    });

    it('falls back to primary-only when crewName is enabled but no crew is set', () => {
      const noCrew: SeriesResultsData = {
        ...withBoatAndCrew,
        enabledCompetitorFields: ['crewName'],
        primaryPersonLabel: 'helm',
        standings: [{ ...withBoatAndCrew.standings[0], crewName: undefined }],
        races: [
          {
            ...withBoatAndCrew.races[0],
            results: [{ ...withBoatAndCrew.races[0].results[0], crewName: undefined }],
          },
        ],
      };
      const html = renderSeriesHtml(noCrew);
      // Header is still "Helm / Crew" (the scorer chose to show it), but a
      // single-hander row just shows the primary name.
      expect(html).toContain('<th>Helm / Crew</th>');
      expect(html).not.toContain('Alice /');
      expect(html).toContain('>Alice<');
    });

    it('defaults to "Competitor" as the primary header when primaryPersonLabel is unset', () => {
      const html = renderSeriesHtml({ ...withBoatAndCrew, enabledCompetitorFields: [] });
      expect(html).toContain('<th>Competitor</th>');
    });

    it('uses the configured primary label (Owner) in the header', () => {
      const html = renderSeriesHtml({ ...withBoatAndCrew, enabledCompetitorFields: [], primaryPersonLabel: 'owner' });
      expect(html).toContain('<th>Owner</th>');
      expect(html).not.toContain('<th>Helm</th>');
    });
  });

  describe('subdivision columns', () => {
    // Subdivisions show in both the summary and per-race tables, so set them on
    // standings and race results alike. One "Category" axis here.
    const AX = 'ax-cat';
    const withSubdivision: SeriesResultsData = {
      ...MINIMAL,
      enabledCompetitorFields: ['subdivision'],
      subdivisionAxes: [{ id: AX, label: 'Category' }],
      standings: [
        { ...MINIMAL.standings[0], subdivisions: { [AX]: 'Gold' } },
        { ...MINIMAL.standings[1], subdivisions: { [AX]: 'Silver' } },
      ],
      races: MINIMAL.races.map((r) => ({
        ...r,
        results: r.results.map((res) => ({
          ...res,
          subdivisions: { [AX]: res.sailNumber === '42' ? 'Gold' : 'Silver' },
        })),
      })),
    };

    it('renders the column under the axis label with each value', () => {
      const html = renderSeriesHtml(withSubdivision);
      expect(html).toContain('<th>Category</th>');
      expect(html).toContain('>Gold<');
      expect(html).toContain('>Silver<');
    });

    it('defaults the header to "Division" when the axis label is blank', () => {
      const html = renderSeriesHtml({ ...withSubdivision, subdivisionAxes: [{ id: AX, label: '' }] });
      expect(html).toContain('<th>Division</th>');
    });

    it('renders the column in the per-race tables too', () => {
      const html = renderSeriesHtml(withSubdivision);
      // Summary table + two race tables each carry the header.
      const headerCount = html.split('<th>Category</th>').length - 1;
      expect(headerCount).toBe(3);
    });

    it('renders one column per axis', () => {
      const DIV = 'ax-div';
      const html = renderSeriesHtml({
        ...withSubdivision,
        subdivisionAxes: [{ id: AX, label: 'Category' }, { id: DIV, label: 'Division' }],
        standings: [
          { ...MINIMAL.standings[0], subdivisions: { [AX]: 'Master', [DIV]: 'Gold' } },
          { ...MINIMAL.standings[1], subdivisions: { [AX]: 'Youth', [DIV]: 'Silver' } },
        ],
      });
      expect(html).toContain('<th>Category</th>');
      expect(html).toContain('<th>Division</th>');
      expect(html).toContain('>Master<');
      expect(html).toContain('>Gold<');
    });

    it('suppresses an axis with no values', () => {
      const html = renderSeriesHtml({
        ...withSubdivision,
        standings: MINIMAL.standings, // no subdivision values
        races: MINIMAL.races,
      });
      expect(html).not.toContain('<th>Category</th>');
    });

    it('omits the columns entirely when the field is not enabled', () => {
      const html = renderSeriesHtml({ ...withSubdivision, enabledCompetitorFields: [] });
      expect(html).not.toContain('<th>Category</th>');
    });
  });

  describe('club column', () => {
    // Club appears in both the summary and per-race tables, so set it on
    // standings and race results alike.
    const withClub: SeriesResultsData = {
      ...MINIMAL,
      enabledCompetitorFields: ['club'],
      standings: [
        { ...MINIMAL.standings[0], club: 'HYC' },
        { ...MINIMAL.standings[1], club: 'RStGYC' },
      ],
      races: MINIMAL.races.map((r) => ({
        ...r,
        results: r.results.map((res) => ({
          ...res,
          club: res.sailNumber === '42' ? 'HYC' : 'RStGYC',
        })),
      })),
    };

    it('renders the Club column header and values in the summary table', () => {
      const html = renderSeriesHtml(withClub);
      expect(html).toContain('<th>Club</th>');
      expect(html).toContain('>HYC<');
      expect(html).toContain('>RStGYC<');
    });

    it('renders the Club column in the per-race tables too', () => {
      const html = renderSeriesHtml(withClub);
      // Summary table + two race tables each carry the header.
      const headerCount = html.split('<th>Club</th>').length - 1;
      expect(headerCount).toBe(3);
    });

    it('suppresses the column when enabled but no competitor has a value', () => {
      const html = renderSeriesHtml({
        ...withClub,
        standings: MINIMAL.standings, // no club values
        races: MINIMAL.races,
      });
      expect(html).not.toContain('<th>Club</th>');
    });

    it('omits the column entirely when the field is not enabled', () => {
      const html = renderSeriesHtml({ ...withClub, enabledCompetitorFields: [] });
      expect(html).not.toContain('<th>Club</th>');
    });
  });
});

// ---- Per-race table excludes implicit DNCs (#130) ----

describe('renderSeriesHtml per-race table (#130)', () => {
  // Extract the body of the racetable for race N — used to assert that an
  // implicit DNC competitor is absent from the per-race rows even when their
  // sail number appears elsewhere (e.g. summary table).
  function raceTableBody(html: string, anchorId: string): string {
    const idx = html.indexOf(`id="${anchorId}"`);
    expect(idx).toBeGreaterThanOrEqual(0);
    const after = html.slice(idx);
    const tableStart = after.indexOf('<table class="racetable"');
    const tableEnd = after.indexOf('</table>', tableStart);
    return after.slice(tableStart, tableEnd);
  }

  it('keeps explicit non-finisher codes in the per-race table', () => {
    const data: SeriesResultsData = {
      series: { name: 'S', venue: '' },
      enabledCompetitorFields: [],
      races: [makeRace(1, [['1', 'A', 1, null], ['2', 'B', 5, 'DNC']])],
      standings: [
        makeStanding(1, '1', 'A', [{ points: 1, podiumRank: 1 }]),
        makeStanding(2, '2', 'B', [{ points: 5, resultCode: 'DNC' }]),
      ],
    };
    const html = renderSeriesHtml(data);
    const body = raceTableBody(html, 'r1');
    expect(body).toContain('>1<');
    expect(body).toContain('>2<');
    expect(body).toContain('5.0 DNC');
  });

  it('omits implicit DNCs (absent from RaceData.results) from the per-race table while the summary table still shows them', () => {
    // The caller (lib/results-export.ts) filters its score map down to
    // competitors with an explicit Finish row before assembly, so an implicit
    // DNC never appears in race.results — only as a DNC cell in standings.
    const data: SeriesResultsData = {
      series: { name: 'S', venue: '' },
      enabledCompetitorFields: [],
      races: [makeRace(1, [['1', 'A', 1, null]])],
      standings: [
        makeStanding(1, '1', 'A', [{ points: 1, podiumRank: 1 }]),
        makeStanding(2, '99', 'Ghost', [{ points: 3, resultCode: 'DNC' }]),
      ],
    };
    const html = renderSeriesHtml(data);
    // Implicit DNC competitor visible in the summary
    expect(html).toContain('Ghost');
    expect(html).toContain('3.0 DNC');
    // …but not in the per-race table
    const body = raceTableBody(html, 'r1');
    expect(body).not.toContain('Ghost');
    expect(body).not.toContain('>99<');
  });

  it('omits the race section entirely when no competitor has an explicit Finish for that race', () => {
    // Race 2 has zero results (every competitor in the series was an implicit
    // DNC). Per #129 this race is also excluded from scoring; per #130 the
    // race section should disappear from the HTML.
    const data: SeriesResultsData = {
      series: { name: 'S', venue: '' },
      enabledCompetitorFields: [],
      races: [
        makeRace(1, [['1', 'A', 1, null]]),
        { raceNumber: 2, date: '2025-06-08', label: 'R2', anchorId: 'r2', results: [] },
      ],
      standings: [
        makeStanding(1, '1', 'A', [
          { points: 1, podiumRank: 1 },
          { points: 3, resultCode: 'DNC' },
        ]),
      ],
    };
    const html = renderSeriesHtml(data);
    // R1 still renders normally with anchor + table
    expect(html).toContain('id="r1"');
    expect(html).toContain('<a class="racelink" href="#r1">R1</a>');
    // R2 has no detail section: no anchor heading, no race table
    expect(html).not.toContain('id="r2"');
    expect(html).not.toMatch(/<h3 class="racetitle"[^>]*>R2/);
    // Summary header for R2 is plain text, not an anchor link
    expect(html).not.toContain('href="#r2"');
    expect(html).toContain('<th>R2</th>');
  });
});

// ---- assembleSeriesResultsData ----

describe('assembleSeriesResultsData', () => {
  const series = { name: 'Test', venue: 'HYC' };
  const races = [
    { id: 'r1', raceNumber: 1, date: '2025-06-01' },
    { id: 'r2', raceNumber: 2, date: '2025-06-08' },
  ];
  const competitors = [
    { id: 'c1', sailNumber: '42', name: 'Alice' },
    { id: 'c2', sailNumber: '99', name: 'Bob' },
  ];
  const competitorsById = new Map(competitors.map((c) => [c.id, c]));

  const standings = [
    {
      rank: 1,
      competitor: { id: 'c1', sailNumber: '42', name: 'Alice' },
      racePoints: [1, 2],
      raceCodes: [null, null] as (ResultCode | null)[],
      totalPoints: 3,
      netPoints: 3,
      raceDiscards: [false, false],
    },
    {
      rank: 2,
      competitor: { id: 'c2', sailNumber: '99', name: 'Bob' },
      racePoints: [2, 1],
      raceCodes: [null, null] as (ResultCode | null)[],
      totalPoints: 3,
      netPoints: 3,
      raceDiscards: [false, false],
    },
  ];

  const raceScoresByRaceId = new Map([
    ['r1', new Map([
      ['c1', { points: 1, place: 1, rank: 1, resultCode: null as ResultCode | null }],
      ['c2', { points: 2, place: 2, rank: 2, resultCode: null as ResultCode | null }],
    ])],
    ['r2', new Map([
      ['c1', { points: 2, place: 2, rank: 2, resultCode: null as ResultCode | null }],
      ['c2', { points: 1, place: 1, rank: 1, resultCode: null as ResultCode | null }],
    ])],
  ]);

  const now = new Date(2025, 5, 14, 19, 0);

  it('produces correct series metadata', () => {
    const data = assembleSeriesResultsData(series, races, standings, raceScoresByRaceId, competitorsById, ['club'], now);
    expect(data.series.name).toBe('Test');
    expect(data.series.venue).toBe('HYC');
    expect(data.generatedAt).toBe(now);
  });

  it('produces correct number of races and standings', () => {
    const data = assembleSeriesResultsData(series, races, standings, raceScoresByRaceId, competitorsById, ['club'], now);
    expect(data.races).toHaveLength(2);
    expect(data.standings).toHaveLength(2);
  });

  it('carries a race name into the column tooltip and section heading, keeping Rn as the label', () => {
    const namedRaces = [
      { id: 'r1', raceNumber: 1, name: 'Round the Island', date: '2025-06-01' },
      { id: 'r2', raceNumber: 2, name: null, date: '2025-06-08' },
    ];
    const data = assembleSeriesResultsData(series, namedRaces, standings, raceScoresByRaceId, competitorsById, ['club'], now);
    expect(data.races[0].name).toBe('Round the Island');
    expect(data.races[0].label).toBe('R1');
    expect(data.races[1].name).toBeUndefined();

    const html = renderSeriesHtml(data);
    // Compact column header stays "R1" but carries the name as a tooltip.
    expect(html).toContain('title="Round the Island"');
    // The race section heading shows the name alongside R1.
    expect(html).toMatch(/R1[^<]*Round the Island/);
    // The unnamed race gets no tooltip.
    expect(html).not.toContain('title="null"');
  });

  it('assigns podiumRank correctly', () => {
    const data = assembleSeriesResultsData(series, races, standings, raceScoresByRaceId, competitorsById, ['club'], now);
    // Alice: R1=1st, R2=2nd
    expect(data.standings[0].raceScores[0].podiumRank).toBe(1);
    expect(data.standings[0].raceScores[1].podiumRank).toBe(2);
    // Bob: R1=2nd, R2=1st
    expect(data.standings[1].raceScores[0].podiumRank).toBe(2);
    expect(data.standings[1].raceScores[1].podiumRank).toBe(1);
  });

  it('sets isDiscard=false and netPoints=totalPoints for all scores', () => {
    const data = assembleSeriesResultsData(series, races, standings, raceScoresByRaceId, competitorsById, ['club'], now);
    for (const s of data.standings) {
      expect(s.netPoints).toBe(s.totalPoints);
      for (const score of s.raceScores) {
        expect(score.isDiscard).toBe(false);
      }
    }
  });

  it('race results are sorted by points ascending', () => {
    const data = assembleSeriesResultsData(series, races, standings, raceScoresByRaceId, competitorsById, ['club'], now);
    const r1 = data.races[0].results;
    expect(r1[0].sailNumber).toBe('42'); // Alice 1pt
    expect(r1[1].sailNumber).toBe('99'); // Bob 2pt
  });

  it('threads club through to standings and race results', () => {
    const data = assembleSeriesResultsData(
      series,
      races,
      [
        { ...standings[0], competitor: { ...standings[0].competitor, club: 'HYC' } },
        { ...standings[1], competitor: { ...standings[1].competitor, club: 'RStGYC' } },
      ],
      raceScoresByRaceId,
      new Map([
        ['c1', { id: 'c1', sailNumber: '42', name: 'Alice', club: 'HYC' }],
        ['c2', { id: 'c2', sailNumber: '99', name: 'Bob', club: 'RStGYC' }],
      ]),
      ['club'],
      now,
    );
    expect(data.standings[0].club).toBe('HYC');
    expect(data.standings[1].club).toBe('RStGYC');
    expect(data.races[0].results.find((r) => r.sailNumber === '42')?.club).toBe('HYC');
    expect(data.races[0].results.find((r) => r.sailNumber === '99')?.club).toBe('RStGYC');
  });
});

// ---- NHC viewer toggle ----

function nhcFixture(withExplain = true): SeriesResultsData {
  const nhcHeader = {
    finisherCount: 2, ctAvgSecs: 3600, meanTcf: 1.0,
    p50: 0.999, w51: null, sMean: 1.0, sStdev: 0.03,
    sHi: 1.045, sLo: 0.97, extremeCount: 0,
    realignmentFactor: 1.0, updateSuppressed: false,
  };
  const race: RaceData = {
    raceNumber: 1,
    date: '2025-06-01',
    label: 'R1',
    anchorId: 'r1',
    isNhc: true,
    ...(withExplain ? { nhcHeader } : {}),
    results: [
      {
        rank: 1, sailNumber: '42', helm: 'Alice',
        place: 1, points: 1, resultCode: null, penaltyCode: null, penaltyOverride: null,
        tcc: 1.0, finishTime: '14:58:20',
        elapsedTimeSecs: 3500, correctedTimeSecs: 3500,
        // newTcf flows through to the always-visible column even when the
        // calc-detail fields are suppressed.
        nhc: withExplain
          ? { tcfApplied: 1.0, newTcf: 1.014, fairTcf: 1.029, compScore: 1.029, isExtreme: false, alphaApplied: 0.3, provisionalTcf: 1.014, adjustment: 0.014, isFinisher: true }
          : { tcfApplied: 1.0, newTcf: 1.014, isFinisher: true },
      },
      {
        rank: 2, sailNumber: '99', helm: 'Bob',
        place: 2, points: 2, resultCode: null, penaltyCode: null, penaltyOverride: null,
        tcc: 1.0, finishTime: '15:01:40',
        elapsedTimeSecs: 3700, correctedTimeSecs: 3700,
        nhc: withExplain
          ? { tcfApplied: 1.0, newTcf: 0.986, fairTcf: 0.973, compScore: 0.973, isExtreme: false, alphaApplied: 0.15, provisionalTcf: 0.996, adjustment: -0.014, isFinisher: true }
          : { tcfApplied: 1.0, newTcf: 0.986, isFinisher: true },
      },
    ],
  };
  return {
    series: { name: 'NHC Series', venue: 'HYC' },
    enabledCompetitorFields: [],
    races: [race],
    standings: [
      makeStanding(1, '42', 'Alice', [{ points: 1, podiumRank: 1 }]),
      makeStanding(2, '99', 'Bob', [{ points: 2, podiumRank: 2 }]),
    ],
  };
}

describe('renderSeriesHtml NHC viewer toggle', () => {
  it('emits the checkbox, body class, and script on NHC fleets', () => {
    const html = renderSeriesHtml(nhcFixture());
    expect(html).toContain('id="nhc-detail-toggle"');
    expect(html).toContain('Show NHC rating calculations');
    expect(html).toContain('<body class="hide-nhc-detail">');
    expect(html).toContain('body.hide-nhc-detail .nhc-detail { display: none; }');
    expect(html).toContain("sailscoring:nhc-explain-visible");
  });

  it('tags only the rating-calculation columns with nhc-detail', () => {
    const html = renderSeriesHtml(nhcFixture());
    // Only the SWNHC2015 calculation columns hide under the toggle
    expect(html).toContain('<th class="nhc-detail">Q</th>');
    expect(html).toContain('<th class="nhc-detail">S</th>');
    expect(html).toContain('<th class="nhc-detail">α</th>');
    expect(html).toContain('<th class="nhc-detail">Z</th>');
    expect(html).toContain('<th class="nhc-detail">Adjustment</th>');
    // New TCF stays always-visible (no nhc-detail class)
    expect(html).not.toContain('<th class="nhc-detail">New TCF</th>');
    expect(html).not.toContain('<col class="newtcf nhc-detail" />');
    // <col> elements
    expect(html).toContain('<col class="fairtcf nhc-detail" />');
    expect(html).toContain('<col class="compscore nhc-detail" />');
    // Fleet-header <p>
    expect(html).toContain('class="nhc-fleet-header nhc-detail"');
  });

  it('keeps rating, finish, elapsed, corrected time, and New TCF columns always visible for NHC fleets', () => {
    const html = renderSeriesHtml(nhcFixture());
    // TCF column uses the "TCF" label (not "TCC") and is not nhc-detail
    expect(html).toContain('<th>TCF</th>');
    expect(html).toContain('<th>Finish</th>');
    expect(html).toContain('<th>ET</th>');
    expect(html).toContain('<th>CT</th>');
    expect(html).toContain('<th>New TCF</th>');
    expect(html).toContain('<col class="newtcf" />');
    expect(html).not.toContain('<th class="nhc-detail">TCF</th>');
    expect(html).not.toContain('<th class="nhc-detail">ET</th>');
    expect(html).not.toContain('<th class="nhc-detail">CT</th>');
    expect(html).not.toContain('<th class="nhc-detail">Finish</th>');
    expect(html).not.toContain('<th class="nhc-detail">New TCF</th>');
    // Rating value renders without nhc-detail class
    expect(html).toMatch(/<td class="mono">1\.000<\/td>/);
    // New TCF value renders without nhc-detail class
    expect(html).toMatch(/<td class="mono">1\.014<\/td>/);
  });

  it('renders rating, finish, ET, CT, and New TCF for NHC fleets even when explainability is hidden', () => {
    const html = renderSeriesHtml(nhcFixture(false));
    // Base columns still appear without the explainability block
    expect(html).toContain('<th>TCF</th>');
    expect(html).toContain('<th>Finish</th>');
    expect(html).toContain('<th>ET</th>');
    expect(html).toContain('<th>CT</th>');
    // New TCF stays visible — it's the headline output of progressive scoring,
    // useful even when the scorer has opted out of publishing the math.
    expect(html).toContain('<th>New TCF</th>');
    expect(html).toContain('<col class="newtcf" />');
    expect(html).toMatch(/<td class="mono">1\.014<\/td>/);
    expect(html).toMatch(/<td class="mono">0\.986<\/td>/);
    // The fleet-header line and calc-detail columns are absent
    expect(html).not.toContain('Rating system: NHC1');
    expect(html).not.toContain('<th class="nhc-detail">Q</th>');
    expect(html).not.toContain('<th class="nhc-detail">New TCF</th>');
  });

  it('omits toggle, body class, and script on non-NHC fleets', () => {
    const html = renderSeriesHtml(MINIMAL);
    expect(html).not.toContain('nhc-detail-toggle');
    expect(html).not.toContain('hide-nhc-detail');
    expect(html).not.toContain('sailscoring:nhc-explain-visible');
    expect(html).toContain('<body>');
  });

  it('emits the NHC prose explainer with the nhc-detail class when explainability is published', () => {
    const html = renderSeriesHtml(nhcFixture());
    expect(html).toContain('class="nhc-explainer nhc-detail"');
    expect(html).toContain('SWNHC2015');
    expect(html).toContain('Q = O &times; P50');
    expect(html).toContain('Non-finishers carry their TCF unchanged');
  });

  it('omits the NHC explainer when explainability is not published', () => {
    const html = renderSeriesHtml(nhcFixture(false));
    expect(html).not.toContain('nhc-explainer');
  });

  it('omits the NHC explainer on non-NHC fleets', () => {
    const html = renderSeriesHtml(MINIMAL);
    expect(html).not.toContain('nhc-explainer');
  });
});

// ---- ECHO viewer toggle ----

function echoFixture(withExplain = true): SeriesResultsData {
  const echoHeader = {
    alpha: 0.1,
    finisherCount: 3,
    sumH: 3.0,
    sumReciprocalEt: 0.0008,
    updateSuppressed: false,
  };
  const race: RaceData = {
    raceNumber: 1,
    date: '2025-06-01',
    label: 'R1',
    anchorId: 'r1',
    isEcho: true,
    ...(withExplain ? { echoHeader } : {}),
    results: [
      {
        rank: 1, sailNumber: '42', helm: 'Alice',
        place: 1, points: 1, resultCode: null, penaltyCode: null, penaltyOverride: null,
        tcc: 1.0, finishTime: '14:58:20',
        elapsedTimeSecs: 3500, correctedTimeSecs: 3500,
        ...(withExplain ? {
          echo: { startingH: 1.0, newH: 1.012, reciprocalEt: 0.000286, pi: 1.071, adjustment: 0.0071, isFinisher: true },
        } : {}),
      },
    ],
  };
  return {
    series: { name: 'ECHO Series', venue: 'HYC' },
    enabledCompetitorFields: [],
    races: [race],
    standings: [
      makeStanding(1, '42', 'Alice', [{ points: 1, podiumRank: 1 }]),
    ],
  };
}

describe('renderSeriesHtml ECHO viewer toggle', () => {
  it('emits the ECHO prose explainer with the echo-detail class when explainability is published', () => {
    const html = renderSeriesHtml(echoFixture());
    expect(html).toContain('class="echo-explainer echo-detail"');
    expect(html).toContain('New H = H + &alpha;');
    expect(html).toContain('Performance Index');
    expect(html).toContain('Non-finishers carry their H unchanged');
  });

  it('omits the ECHO explainer when explainability is not published', () => {
    const html = renderSeriesHtml(echoFixture(false));
    expect(html).not.toContain('echo-explainer');
  });

  it('omits the ECHO explainer on non-ECHO fleets', () => {
    const html = renderSeriesHtml(MINIMAL);
    expect(html).not.toContain('echo-explainer');
  });
});

// ---- Per-race ratings in summary (#140) ----

describe('renderSeriesHtml — per-race ratings in summary', () => {
  function summaryFixture(
    system: 'nhc' | 'echo' | undefined,
    showPerRaceRatings: boolean,
    opts?: { withSeed?: boolean; r2DiscardForAlice?: boolean },
  ): SeriesResultsData {
    const withSeed = opts?.withSeed ?? true;
    const r2DiscardForAlice = opts?.r2DiscardForAlice ?? false;
    const aliceStanding: StandingRowData = {
      rank: 1,
      sailNumber: '42',
      helm: 'Alice',
      ...(withSeed ? { seedRating: 1.350 } : {}),
      raceScores: [
        { points: 1, resultCode: null, isDiscard: false, podiumRank: 1, penaltyCode: null, penaltyOverride: null, isRedress: false },
        { points: 2, resultCode: null, isDiscard: r2DiscardForAlice, podiumRank: 2, penaltyCode: null, penaltyOverride: null, isRedress: false, appliedRating: 1.365 },
      ],
      totalPoints: 3,
      netPoints: 3,
    };
    const bobStanding: StandingRowData = {
      rank: 2,
      sailNumber: '99',
      helm: 'Bob',
      ...(withSeed ? { seedRating: 1.200 } : {}),
      raceScores: [
        { points: 2, resultCode: null, isDiscard: false, podiumRank: 2, penaltyCode: null, penaltyOverride: null, isRedress: false },
        { points: 1, resultCode: null, isDiscard: false, podiumRank: 1, penaltyCode: null, penaltyOverride: null, isRedress: false, appliedRating: 1.220 },
      ],
      totalPoints: 3,
      netPoints: 3,
    };
    return {
      series: { name: 'Progressive Series', venue: 'HYC' },
      enabledCompetitorFields: ['club'],
      races: [
        makeRace(1, [['42', 'Alice', 1, null], ['99', 'Bob', 2, null]]),
        makeRace(2, [['99', 'Bob', 1, null], ['42', 'Alice', 2, null]]),
      ],
      standings: [aliceStanding, bobStanding],
      ...(system ? { progressiveScoringSystem: system } : {}),
      ...(showPerRaceRatings ? { showPerRaceRatings: true } : {}),
    };
  }

  it('renders an NHC1 seed column and applied-rating sub-text for NHC fleets when the toggle is on', () => {
    const html = renderSeriesHtml(summaryFixture('nhc', true));
    expect(html).toContain('<th>NHC1</th>');
    expect(html).toContain('<td class="seedrating">1.350</td>');
    expect(html).toContain('<td class="seedrating">1.200</td>');
    expect(html).toContain('<span class="rating">1.365</span>');
    expect(html).toContain('<span class="rating">1.220</span>');
  });

  it('renders an ECHO seed column header for ECHO fleets', () => {
    const html = renderSeriesHtml(summaryFixture('echo', true));
    expect(html).toContain('<th>ECHO</th>');
  });

  it('suppresses applied-rating sub-text in R1 (the seed column carries it)', () => {
    const html = renderSeriesHtml(summaryFixture('nhc', true));
    // R1 score cell for Alice — match the first td in the R1 row position
    // by checking that no <span class="rating"> appears immediately around
    // a "1" or "2" before R2's content.
    const summaryMatch = html.match(/<table class="summarytable"[\s\S]*?<\/table>/);
    expect(summaryMatch).not.toBeNull();
    const summary = summaryMatch![0];
    // Two appliedRating spans only (one per row, R2 only).
    expect((summary.match(/<span class="rating">/g) ?? []).length).toBe(2);
  });

  it('omits the seed column and rating sub-text when the toggle is off, even on NHC', () => {
    const html = renderSeriesHtml(summaryFixture('nhc', false));
    expect(html).not.toContain('<th>NHC1</th>');
    expect(html).not.toContain('class="seedrating"');
    expect(html).not.toContain('<span class="rating">');
  });

  it('omits the seed column on non-progressive fleets even when the toggle is on', () => {
    const html = renderSeriesHtml(summaryFixture(undefined, true));
    expect(html).not.toContain('<th>NHC1</th>');
    expect(html).not.toContain('<th>ECHO</th>');
    expect(html).not.toContain('class="seedrating"');
    expect(html).not.toContain('<span class="rating">');
  });

  it('still renders the applied-rating sub-text inside discard cells', () => {
    const html = renderSeriesHtml(summaryFixture('nhc', true, { r2DiscardForAlice: true }));
    expect(html).toMatch(/<td class="discard[^"]*">[\s\S]*?<span class="rating">1\.365<\/span>/);
  });
});

describe('assembleSeriesResultsData — per-race ratings wiring', () => {
  const series = { name: 'Progressive', venue: 'HYC' };
  const races = [
    { id: 'r1', raceNumber: 1, date: '2025-06-01' },
    { id: 'r2', raceNumber: 2, date: '2025-06-08' },
  ];
  const competitors = [
    { id: 'c1', sailNumber: '42', name: 'Alice', nhcStartingTcf: 1.350 },
    { id: 'c2', sailNumber: '99', name: 'Bob', nhcStartingTcf: 1.200 },
  ];
  const competitorsById = new Map(competitors.map((c) => [c.id, c]));
  const standings = [
    {
      rank: 1,
      competitor: { id: 'c1', sailNumber: '42', name: 'Alice' },
      racePoints: [1, 2],
      raceCodes: [null, null] as (ResultCode | null)[],
      totalPoints: 3,
      netPoints: 3,
      raceDiscards: [false, false],
    },
    {
      rank: 2,
      competitor: { id: 'c2', sailNumber: '99', name: 'Bob' },
      racePoints: [2, 1],
      raceCodes: [null, null] as (ResultCode | null)[],
      totalPoints: 3,
      netPoints: 3,
      raceDiscards: [false, false],
    },
  ];
  const raceScoresByRaceId = new Map([
    ['r1', new Map([
      ['c1', { points: 1, place: 1, rank: 1, resultCode: null as ResultCode | null, tcfApplied: 1.350, newTcf: 1.365 }],
      ['c2', { points: 2, place: 2, rank: 2, resultCode: null as ResultCode | null, tcfApplied: 1.200, newTcf: 1.220 }],
    ])],
    ['r2', new Map([
      ['c1', { points: 2, place: 2, rank: 2, resultCode: null as ResultCode | null, tcfApplied: 1.365, newTcf: 1.378 }],
      ['c2', { points: 1, place: 1, rank: 1, resultCode: null as ResultCode | null, tcfApplied: 1.220, newTcf: 1.235 }],
    ])],
  ]);
  const seedRatingByCompetitorId = new Map([['c1', 1.350], ['c2', 1.200]]);
  const now = new Date(2025, 5, 14, 19, 0);

  it('populates seedRating and R2 appliedRating but not R1 appliedRating', () => {
    const data = assembleSeriesResultsData(
      series, races, standings, raceScoresByRaceId, competitorsById, ['club'], now,
      undefined,
      { scoringSystem: 'nhc', showPerRaceRatings: true, seedRatingByCompetitorId },
    );
    expect(data.progressiveScoringSystem).toBe('nhc');
    expect(data.showPerRaceRatings).toBe(true);
    expect(data.standings[0].seedRating).toBe(1.350);
    expect(data.standings[1].seedRating).toBe(1.200);
    expect(data.standings[0].raceScores[0].appliedRating).toBeUndefined();
    expect(data.standings[0].raceScores[1].appliedRating).toBe(1.365);
    expect(data.standings[1].raceScores[1].appliedRating).toBe(1.220);
  });

  it('does not populate per-race ratings when the toggle is off', () => {
    const data = assembleSeriesResultsData(
      series, races, standings, raceScoresByRaceId, competitorsById, ['club'], now,
      undefined,
      { scoringSystem: 'nhc', showPerRaceRatings: false, seedRatingByCompetitorId },
    );
    expect(data.showPerRaceRatings).toBeUndefined();
    expect(data.standings[0].raceScores[1].appliedRating).toBeUndefined();
  });

  it('does not surface a progressive scoring system for non-progressive fleets', () => {
    const data = assembleSeriesResultsData(
      series, races, standings, raceScoresByRaceId, competitorsById, ['club'], now,
      undefined,
      { scoringSystem: 'scratch', showPerRaceRatings: true },
    );
    expect(data.progressiveScoringSystem).toBeUndefined();
    expect(data.standings[0].seedRating).toBeUndefined();
  });
});

// ---- Nationality column ----

describe('renderSeriesHtml — nationality', () => {
  // Two boats, both IRL, so we can prove dedup; one race with both finishing.
  const irlFlag = { viewBox: '0 0 1200 600', inner: '<path fill="#169b62"/>' };
  const gbrFlag = { viewBox: '0 0 60 30', inner: '<path fill="#012169"/>' };
  const withNationality: SeriesResultsData = {
    series: { name: 'Test Series', venue: 'HYC' },
    enabledCompetitorFields: ['nationality'],
    races: [
      {
        ...makeRace(1, [['42', 'Alice', 1, null], ['99', 'Bob', 2, null], ['7', 'Charlie', 3, null]]),
        results: [
          { rank: 1, sailNumber: '42', helm: 'Alice', place: 1, points: 1, resultCode: null, penaltyCode: null, penaltyOverride: null, nationality: 'IRL' },
          { rank: 2, sailNumber: '99', helm: 'Bob', place: 2, points: 2, resultCode: null, penaltyCode: null, penaltyOverride: null, nationality: 'IRL' },
          { rank: 3, sailNumber: '7', helm: 'Charlie', place: 3, points: 3, resultCode: null, penaltyCode: null, penaltyOverride: null, nationality: 'GBR' },
        ],
      },
    ],
    standings: [
      { ...makeStanding(1, '42', 'Alice', [{ points: 1, podiumRank: 1 }]), nationality: 'IRL' },
      { ...makeStanding(2, '99', 'Bob', [{ points: 2, podiumRank: 2 }]), nationality: 'IRL' },
      { ...makeStanding(3, '7', 'Charlie', [{ points: 3, podiumRank: 3 }]), nationality: 'GBR' },
    ],
    flagSvgByCode: { IRL: irlFlag, GBR: gbrFlag, FRA: { viewBox: '0 0 3 2', inner: '<rect/>' } },
  };

  it('renders a Nat column in the summary and per-race tables', () => {
    const html = renderSeriesHtml(withNationality);
    // Summary table column header
    expect(html).toContain('<th>Nationality</th>');
    // Two same-code competitors and one different — the column must show codes
    // alongside a <use> referencing the flag symbol. Two standings rows + two
    // race rows for IRL = 4 cells.
    const irlCellRe = /<td class="nat">.*?<use href="#flag-IRL"[^>]*\/>.*?IRL<\/span><\/td>/g;
    expect(html.match(irlCellRe)?.length).toBe(4);
    // And one GBR cell each in standings + race.
    const gbrCellRe = /<td class="nat">.*?<use href="#flag-GBR"[^>]*\/>.*?GBR<\/span><\/td>/g;
    expect(html.match(gbrCellRe)?.length).toBe(2);
  });

  it('emits one <symbol> per referenced code (deduped) — and none for codes not referenced', () => {
    const html = renderSeriesHtml(withNationality);
    // IRL referenced twice in standings + twice in race results — still one symbol.
    expect(html.match(/<symbol id="flag-IRL"/g)?.length).toBe(1);
    expect(html.match(/<symbol id="flag-GBR"/g)?.length).toBe(1);
    // FRA is in the flag payload but no row references it — no symbol emitted.
    expect(html).not.toContain('symbol id="flag-FRA"');
  });

  it('falls back to code-only when a code is referenced but not in flagSvgByCode', () => {
    const html = renderSeriesHtml({
      ...withNationality,
      flagSvgByCode: { GBR: gbrFlag }, // IRL flag missing
    });
    expect(html).not.toContain('use href="#flag-IRL"');
    // IRL code still appears in the cell.
    expect(html).toContain('<td class="nat"><span class="nattext">IRL</span></td>');
  });

  it('omits the Nat column when nationality is enabled but no row carries a value', () => {
    const html = renderSeriesHtml({
      ...withNationality,
      standings: withNationality.standings.map((s) => ({ ...s, nationality: undefined })),
      races: withNationality.races.map((r) => ({
        ...r,
        results: r.results.map((x) => ({ ...x, nationality: undefined })),
      })),
    });
    expect(html).not.toContain('<th>Nationality</th>');
  });

  it('omits flag defs when flagSvgByCode is undefined', () => {
    const { flagSvgByCode: _flag, ...rest } = withNationality;
    void _flag;
    const html = renderSeriesHtml(rest);
    // No <symbol> block at all.
    expect(html).not.toContain('<symbol');
    // Codes still render as text in the cell.
    expect(html).toContain('<td class="nat"><span class="nattext">IRL</span></td>');
    expect(html).toContain('<td class="nat"><span class="nattext">GBR</span></td>');
  });
});

// ---- renderCombinedSeriesHtml ----

describe('renderCombinedSeriesHtml', () => {
  const fleetA: SeriesResultsData = { ...MINIMAL, fleetName: 'IRC 1' };
  const fleetB: SeriesResultsData = {
    ...MINIMAL,
    fleetName: 'IRC 2',
    races: [makeRace(1, [['7', 'Carol', 1, null]])],
    standings: [makeStanding(1, '7', 'Carol', [{ points: 1, podiumRank: 1 }])],
  };

  it('renders one document with a section per fleet, headed by the page name', () => {
    const html = renderCombinedSeriesHtml([fleetA, fleetB], { pageName: 'Overall' });
    expect(html).toContain('<!doctype html>');
    // One document: a single <html> open/close pair.
    expect(html.match(/<\/html>/g)).toHaveLength(1);
    // Page heading is the combined page's name; each section keeps its fleet heading.
    expect(html).toContain('<title>Results for Test Series at Test Venue — Overall</title>');
    expect(html).toContain('<h2>Overall</h2>');
    expect(html).toContain('<h2>IRC 1</h2>');
    expect(html).toContain('<h2>IRC 2</h2>');
    // Both fleets' standings tables are present, in section order.
    expect(html.match(/class="summarytable"/g)).toHaveLength(2);
    expect(html.indexOf('<h2>IRC 1</h2>')).toBeLessThan(html.indexOf('<h2>IRC 2</h2>'));
    expect(html).toContain('Alice');
    expect(html).toContain('Carol');
  });

  it('full detail keeps every section race tables and linked race headers', () => {
    const html = renderCombinedSeriesHtml([fleetA, fleetB], { pageName: 'Overall' });
    // 2 races from IRC 1 + 1 race from IRC 2.
    expect(html.match(/class="racetable"/g)).toHaveLength(3);
    expect(html).toContain('class="racelink"');
  });

  it('standingsOnly drops the race tables and unlinks the race headers', () => {
    const html = renderCombinedSeriesHtml([fleetA, fleetB], {
      pageName: 'Overall',
      standingsOnly: true,
    });
    expect(html).not.toContain('class="racetable"');
    expect(html).not.toContain('class="racelink"');
    // The per-race score columns stay in the summary tables.
    expect(html.match(/class="summarytable"/g)).toHaveLength(2);
  });

  it('standingsOnly keeps the per-race summary columns', () => {
    const html = renderCombinedSeriesHtml([fleetA], { pageName: 'Overall', standingsOnly: true });
    // R1/R2 column headers still present as plain text.
    expect(html).toContain('<th>R1</th>');
    expect(html).toContain('<th>R2</th>');
  });

  it('chrome comes from the sections: breadcrumb and provisional stamp render once', () => {
    const stamped: SeriesResultsData = {
      ...fleetA,
      generatedAt: new Date('2026-07-01T12:00:00Z'),
      seriesIndexUrl: '/p/hyc/test-series',
    };
    const html = renderCombinedSeriesHtml([stamped, { ...fleetB, generatedAt: stamped.generatedAt, seriesIndexUrl: stamped.seriesIndexUrl }], { pageName: 'Overall' });
    expect(html.match(/class="breadcrumb"/g)).toHaveLength(1);
    expect(html.match(/Results are provisional/g)).toHaveLength(1);
  });

  it('throws on an empty section list', () => {
    expect(() => renderCombinedSeriesHtml([], { pageName: 'Overall' })).toThrow();
  });
});

describe('assembleSeriesResultsData — anchorPrefix', () => {
  const races = [{ id: 'race-1', raceNumber: 1, date: '2025-06-01' }];
  const scores = new Map([
    ['race-1', new Map([['c1', { points: 1, place: 1, rank: 1, resultCode: null }]])],
  ]);
  const competitors = new Map([[
    'c1',
    { sailNumber: '42', name: 'Alice' },
  ]]);
  const standings = [
    {
      rank: 1,
      competitor: { id: 'c1', sailNumber: '42', name: 'Alice' },
      racePoints: [1],
      raceCodes: [null],
      totalPoints: 1,
      netPoints: 1,
      raceDiscards: [false],
    },
  ];

  it('prefixes race anchors when set', () => {
    const data = assembleSeriesResultsData(
      { name: 'S', venue: '' },
      races,
      standings,
      scores,
      competitors,
      ['club'],
      new Date(),
      'IRC 1',
      { anchorPrefix: 'irc-1-' },
    );
    expect(data.races[0].anchorId).toBe('irc-1-r1');
    expect(data.races[0].label).toBe('R1');
  });

  it('keeps bare anchors when unset', () => {
    const data = assembleSeriesResultsData(
      { name: 'S', venue: '' },
      races,
      standings,
      scores,
      competitors,
      ['club'],
      new Date(),
    );
    expect(data.races[0].anchorId).toBe('r1');
  });
});
