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
  const appUrl = 'https://app.sailscoring.ie/import#data=abc123';
  const html = renderSeriesHtml({ ...MINIMAL_DATA, openInAppUrl: appUrl });

  it('shows "Open in Sail Scoring" as a plain link in the footer', () => {
    expect(html).toContain('Open in Sail Scoring');
    expect(html).toContain(`href="${appUrl}"`);
  });

  it('breaks out of any host iframe via target="_top"', () => {
    // bilge-published results are embedded in iframes on club sites (e.g.
    // hyc.ie/results). Without target="_top" the app would load inside the
    // iframe and the auth cookie would be treated as third-party. See #134.
    expect(html).toMatch(/href="https:\/\/app\.sailscoring\.ie\/import#data=abc123"[^>]*target="_top"[^>]*rel="noopener"[^>]*>Open in Sail Scoring/);
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
          isNhc: true,
          ...(toggleOn ? {
            nhcHeader: {
              finisherCount: 3, ctAvgSecs: 3300, meanTcf: 1.0,
              p50: 1.05, w51: null, sMean: 1.05, sStdev: 0.05,
              sHi: 1.125, sLo: 1.0, extremeCount: 0,
              realignmentFactor: 1.0, updateSuppressed: false,
            },
          } : {}),
          results: [
            {
              sailNumber: '1', helm: 'Alpha',
              place: 1, rank: 1, points: 1,
              resultCode: null, penaltyCode: null, penaltyOverride: null,
              tcc: 1.0,
              finishTime: '14:50:00',
              elapsedTimeSecs: 3000,
              correctedTimeSecs: 3000,
              // newTcf shows in the always-visible column even with the toggle off;
              // the SWNHC2015 fields only land on the cell when explainability
              // is being published.
              nhc: toggleOn
                ? { tcfApplied: 1.0, newTcf: 1.015, fairTcf: 1.10, compScore: 1.10, isExtreme: false, alphaApplied: 0.30, provisionalTcf: 1.015, adjustment: 0.015, isFinisher: true }
                : { tcfApplied: 1.0, newTcf: 1.015, isFinisher: true },
            },
            {
              sailNumber: '2', helm: 'Beta',
              place: null, rank: null, points: 4,
              resultCode: 'DNF', penaltyCode: null, penaltyOverride: null,
              tcc: 1.05,
              nhc: { tcfApplied: 1.05, newTcf: 1.05, isFinisher: false },
            },
          ],
        },
      ],
      standings: [],
    };
  }

  it('renders the NHC fleet header line and explainability column headers when nhcHeader is set', () => {
    const html = renderSeriesHtml(nhcData(true));
    expect(html).toContain('Rating system: NHC1 (SWNHC2015)');
    expect(html).toContain('Finishers: 3');
    expect(html).toContain('μ(S)');
    expect(html).toContain('σ(S)');
    expect(html).toContain('Z51');
    expect(html).toContain('<th class="nhc-detail">Q</th>');
    expect(html).toContain('<th class="nhc-detail">S</th>');
    expect(html).toContain('<th class="nhc-detail">α</th>');
    expect(html).toContain('<th class="nhc-detail">Z</th>');
    expect(html).toContain('<th class="nhc-detail">Adjustment</th>');
    // New TCF is always-visible (no nhc-detail class)
    expect(html).toContain('<th>New TCF</th>');
    expect(html).not.toContain('<th class="nhc-detail">New TCF</th>');
  });

  it('renders per-finisher NHC values to the documented precision', () => {
    const html = renderSeriesHtml(nhcData(true));
    // Alpha: tcfApplied 1.000, Q 1.1000, S 1.1000, α 0.300, Z 1.0150, adj +0.0150, new 1.015
    expect(html).toContain('1.000');
    expect(html).toContain('1.1000');
    expect(html).toContain('0.300');
    expect(html).toContain('+0.0150');
    expect(html).toContain('1.015');
  });

  it('shows "unchanged" for non-finishers in the New TCF column', () => {
    const html = renderSeriesHtml(nhcData(true));
    expect(html).toContain('unchanged');
  });

  it('omits calc-detail columns and fleet header when nhcHeader is absent, but keeps New TCF', () => {
    const html = renderSeriesHtml(nhcData(false));
    expect(html).not.toContain('Rating system: NHC1');
    expect(html).not.toContain('<th class="nhc-detail">Q</th>');
    expect(html).not.toContain('<th class="nhc-detail">S</th>');
    expect(html).not.toContain('<th class="nhc-detail">Adjustment</th>');
    // New TCF is always-visible for NHC fleets — the next-race rating shows
    // even when the scorer has opted out of publishing the underlying math.
    expect(html).toContain('<th>New TCF</th>');
    expect(html).toContain('<col class="newtcf" />');
    expect(html).toMatch(/<td class="mono">1\.015<\/td>/);
    expect(html).toContain('unchanged');
    // The toggle, body class, and explainer prose remain absent.
    expect(html).not.toContain('nhc-detail-toggle');
    expect(html).not.toContain('nhc-explainer');
    // Rating, finish, elapsed, and corrected columns stay visible too
    expect(html).toContain('<th>TCF</th>');
    expect(html).toContain('<th>Finish</th>');
    expect(html).toContain('<th>ET</th>');
    expect(html).toContain('<th>CT</th>');
  });
});
