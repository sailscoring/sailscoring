import { describe, it, expect } from 'vitest';
import { renderSeriesHtml, type SeriesResultsData } from '@/lib/results-renderer';

// ---- Fixtures ----

const MINIMAL_DATA: SeriesResultsData = {
  series: { name: 'Test Cup', venue: 'Harbour YC' },
  enabledCompetitorFields: ['club'],
  races: [],
  standings: [],
};

// ---- Tests: default render ----

describe('renderSeriesHtml', () => {
  it('renders the plain footer with no Download link', () => {
    const html = renderSeriesHtml(MINIMAL_DATA);
    expect(html).toContain('sailscoring.ie');
    expect(html).not.toContain('Download results (JSON)');
  });

  it('does not embed a JSON script block', () => {
    const html = renderSeriesHtml(MINIMAL_DATA);
    expect(html).not.toContain('sail-scoring-data');
    expect(html).not.toContain('_ssDownload');
    expect(html).not.toContain('application/json');
  });

  it('does not add any footer link when openInAppUrl is absent', () => {
    const html = renderSeriesHtml(MINIMAL_DATA);
    expect(html).not.toContain('Open in Sail Scoring');
  });
});

// ---- Tests: openInAppUrl present ----

describe('renderSeriesHtml with openInAppUrl', () => {
  const appUrl = 'https://app.sailscoring.ie/import?data=abc123';
  const html = renderSeriesHtml({ ...MINIMAL_DATA, openInAppUrl: appUrl });

  it('shows "Open in Sail Scoring" as a plain link in the footer', () => {
    expect(html).toContain('Open in Sail Scoring');
    expect(html).toContain(`href="${appUrl}"`);
  });

  it('does not show the Download results (JSON) link', () => {
    expect(html).not.toContain('Download results (JSON)');
    expect(html).not.toContain('_ssDownload');
  });

  it('does not embed a JSON script block', () => {
    const html = renderSeriesHtml({ ...MINIMAL_DATA, openInAppUrl: appUrl });
    expect(html).not.toContain('sail-scoring-data');
  });
});

// ─── NHC explainability render ───────────────────────────────────────────────

describe('renderSeriesHtml — NHC explainability', () => {
  function nhcData(toggleOn = true): SeriesResultsData {
    return {
      series: { name: 'NHC Cup', venue: 'Howth' },
      enabledCompetitorFields: [],
      races: [
        {
          raceNumber: 1,
          date: '2026-04-12',
          label: 'R1',
          anchorId: 'r1',
          startTime: '14:00:00',
          ...(toggleOn ? {
            nhcHeader: { alpha: 0.15, finisherCount: 3, ctAvgSecs: 3300, meanTcf: 1.0 },
          } : {}),
          results: [
            {
              sailNumber: '1', helm: 'Alpha',
              place: 1, rank: 1, points: 1,
              resultCode: null, penaltyCode: null, penaltyOverride: null,
              finishTime: '14:50:00',
              elapsedTimeSecs: 3000,
              correctedTimeSecs: 3000,
              ...(toggleOn ? {
                nhc: { tcfApplied: 1.0, newTcf: 1.015, ctRatio: 1.10, fairTcf: 1.10, adjustment: 0.015, isFinisher: true },
              } : {}),
            },
            {
              sailNumber: '2', helm: 'Beta',
              place: null, rank: null, points: 4,
              resultCode: 'DNF', penaltyCode: null, penaltyOverride: null,
              ...(toggleOn ? {
                nhc: { tcfApplied: 1.05, newTcf: 1.05, isFinisher: false },
              } : {}),
            },
          ],
        },
      ],
      standings: [],
    };
  }

  it('renders the NHC fleet header line and explainability column headers when nhcHeader is set', () => {
    const html = renderSeriesHtml(nhcData(true));
    expect(html).toContain('Rating system: NHC1');
    expect(html).toContain('α = 0.15');
    expect(html).toContain('Finishers: 3');
    expect(html).toContain('mean TCF: 1.0000');
    expect(html).toContain('<th>TCF used</th>');
    expect(html).toContain('<th>CT ratio</th>');
    expect(html).toContain('<th>Fair TCF</th>');
    expect(html).toContain('<th>Adjustment</th>');
    expect(html).toContain('<th>New TCF</th>');
  });

  it('renders per-finisher NHC values to the documented precision', () => {
    const html = renderSeriesHtml(nhcData(true));
    // Alpha: tcfApplied 1.000, ratio 1.1000, fair 1.1000, adj +0.0150, new 1.015
    expect(html).toContain('1.000');
    expect(html).toContain('1.1000');
    expect(html).toContain('+0.0150');
    expect(html).toContain('1.015');
  });

  it('shows "unchanged" for non-finishers in the New TCF column', () => {
    const html = renderSeriesHtml(nhcData(true));
    expect(html).toContain('unchanged');
  });

  it('omits NHC columns and fleet header when nhcHeader is absent (toggle off)', () => {
    const html = renderSeriesHtml(nhcData(false));
    expect(html).not.toContain('Rating system: NHC1');
    expect(html).not.toContain('<th>TCF used</th>');
    expect(html).not.toContain('<th>Fair TCF</th>');
  });
});
