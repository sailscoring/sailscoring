import { describe, it, expect } from 'vitest';
import { renderSeriesHtml, type SeriesResultsData } from '@/lib/results-renderer';
import type { PublicSeriesExport } from '@/lib/public-export';

// ---- Fixtures ----

const MINIMAL_DATA: SeriesResultsData = {
  series: { name: 'Test Cup', venue: 'Harbour YC' },
  races: [],
  standings: [],
};

const SAMPLE_EXPORT: PublicSeriesExport = {
  version: 2,
  exportedAt: '2025-06-14T12:00:00.000Z',
  series: {
    name: 'Test Cup',
    venue: 'Harbour YC',
    startDate: '2025-06-14',
    endDate: '',
    discardThresholds: [],
    dnfScoring: 'seriesEntries',
  },
  fleets: [{ name: 'Default', displayOrder: 0, scoringSystem: 'scratch' }],
  competitors: [
    { sailNumber: '42', name: 'Alice', club: 'HYC', gender: 'F', age: null, fleetNames: ['Default'] },
    { sailNumber: '99', name: 'Bob', club: 'HYC', gender: 'M', age: null, fleetNames: ['Default'] },
  ],
  races: [
    {
      raceNumber: 1,
      date: '2025-06-14',
      starts: [],
      finishes: [
        { sailNumber: '42', finishPosition: 1, resultCode: null, startPresent: null },
        { sailNumber: '99', finishPosition: 2, resultCode: null, startPresent: null },
      ],
    },
  ],
  standings: [
    { fleetName: 'Default', rows: [
      { rank: 1, sailNumber: '42', name: 'Alice', racePoints: [1], raceCodes: [null], raceDiscards: [false], totalPoints: 1, netPoints: 1 },
      { rank: 2, sailNumber: '99', name: 'Bob', racePoints: [2], raceCodes: [null], raceDiscards: [false], totalPoints: 2, netPoints: 2 },
    ] },
  ],
};

// ---- Tests: publicExportJson absent ----

describe('renderSeriesHtml without publicExportJson', () => {
  it('renders the plain footer with no Download link', () => {
    const html = renderSeriesHtml(MINIMAL_DATA);
    expect(html).toContain('sailscoring.ie');
    expect(html).not.toContain('Download results (JSON)');
  });

  it('does not embed a JSON script block', () => {
    const html = renderSeriesHtml(MINIMAL_DATA);
    expect(html).not.toContain('sail-scoring-data');
    expect(html).not.toContain('_ssDownload');
  });
});

// ---- Tests: publicExportJson present ----

describe('renderSeriesHtml with publicExportJson', () => {
  const json = JSON.stringify(SAMPLE_EXPORT);
  const html = renderSeriesHtml({ ...MINIMAL_DATA, publicExportJson: json });

  it('does not add any footer link (openInAppUrl absent)', () => {
    expect(html).not.toContain('Download results (JSON)');
    expect(html).not.toContain('_ssDownload');
    expect(html).not.toContain('Open in Sail Scoring');
  });

  it('embeds the JSON in a script block near the end of the body', () => {
    expect(html).toContain('id="sail-scoring-data"');
    const dataIdx = html.indexOf('sail-scoring-data');
    const bodyCloseIdx = html.indexOf('</body>');
    expect(dataIdx).toBeGreaterThan(0);
    expect(dataIdx).toBeLessThan(bodyCloseIdx);
  });

  it('places the JSON blob after all visible content', () => {
    const tableIdx = html.indexOf('<table');
    const dataIdx = html.indexOf('sail-scoring-data');
    expect(dataIdx).toBeGreaterThan(tableIdx);
  });

  it('embeds valid JSON that round-trips correctly', () => {
    const match = html.match(/<script type="application\/json" id="sail-scoring-data">\n([\s\S]*?)\n<\/script>/);
    expect(match).not.toBeNull();
    const parsed = JSON.parse(match![1]) as PublicSeriesExport;
    expect(parsed.version).toBe(2);
    expect(parsed.competitors).toHaveLength(2);
    expect(parsed.competitors[0].sailNumber).toBe('42');
  });

  it('does not include private scorer fields in the embedded JSON', () => {
    const match = html.match(/<script type="application\/json" id="sail-scoring-data">\n([\s\S]*?)\n<\/script>/);
    const parsed = JSON.parse(match![1]) as Record<string, unknown>;
    // Private fields that must never appear in the public export
    expect(parsed).not.toHaveProperty('snapshotId');
    expect(parsed).not.toHaveProperty('snapshotHistory');
    expect('ftpHost' in parsed).toBe(false);
    expect('ftpPath' in parsed).toBe(false);
    expect('bilgeBundle' in parsed).toBe(false);
  });

  it('escapes </script> sequences in the JSON to prevent tag injection', () => {
    const maliciousExport: PublicSeriesExport = {
      ...SAMPLE_EXPORT,
      series: { ...SAMPLE_EXPORT.series, name: 'Hack</script><script>alert(1)</script>' },
    };
    const maliciousJson = JSON.stringify(maliciousExport);
    const maliciousHtml = renderSeriesHtml({ ...MINIMAL_DATA, publicExportJson: maliciousJson });
    // Extract just the content between the opening and closing script tags
    const openTag = '<script type="application/json" id="sail-scoring-data">';
    const openIdx = maliciousHtml.indexOf(openTag) + openTag.length;
    const closeIdx = maliciousHtml.indexOf('</script>', openIdx);
    const jsonContent = maliciousHtml.slice(openIdx, closeIdx);
    // Raw `</` must not appear in the JSON content — only the escaped `<\/` form
    expect(jsonContent).not.toContain('</');
    expect(jsonContent).toContain('<\\/');
  });
});

// ---- Tests: openInAppUrl present ----

describe('renderSeriesHtml with openInAppUrl', () => {
  const json = JSON.stringify(SAMPLE_EXPORT);
  const appUrl = 'https://app.sailscoring.ie/?import=abc123';
  const html = renderSeriesHtml({ ...MINIMAL_DATA, publicExportJson: json, openInAppUrl: appUrl });

  it('shows "Open in Sail Scoring" as a plain link in the footer', () => {
    expect(html).toContain('Open in Sail Scoring');
    expect(html).toContain(`href="${appUrl}"`);
  });

  it('does not show the Download results (JSON) link', () => {
    expect(html).not.toContain('Download results (JSON)');
    expect(html).not.toContain('_ssDownload');
  });

  it('still embeds the JSON blob for programmatic access', () => {
    expect(html).toContain('id="sail-scoring-data"');
  });
});
