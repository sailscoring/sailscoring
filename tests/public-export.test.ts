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
  const appUrl = 'https://app.sailscoring.ie/?import=abc123';
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
