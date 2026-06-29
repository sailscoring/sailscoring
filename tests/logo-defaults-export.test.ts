import { describe, it, expect } from 'vitest';
import {
  applyWorkspaceLogoDefaults,
  resolveSeriesLogoDefaults,
} from '@/lib/public-export';
import type { Series } from '@/lib/types';

// A series with explicit logo/website slots; spread + override per test.
function makeSeries(overrides: Partial<Series> = {}): Series {
  return {
    id: 's1',
    name: 'Spring League 2026',
    venue: 'Howth',
    startDate: '2026-03-01',
    endDate: '',
    venueLogoUrl: '',
    eventLogoUrl: '',
    venueUrl: '',
    eventUrl: '',
    createdAt: 0,
    lastSavedAt: null,
    lastModifiedAt: 0,
    scoringMode: 'scratch',
    discardThresholds: [],
    dnfScoring: 'seriesEntries',
    ftpHost: '',
    ftpPath: '',
    ftpPaths: {},
    includeJsonExport: true,
    enabledCompetitorFields: [],
    primaryPersonLabel: 'helm',
    subdivisionAxes: [],
    ...overrides,
  };
}

const DEFAULTS = {
  venueLogoUrl: '/canonical-logos/hyc.png',
  eventLogoUrl: '/canonical-logos/aib.png',
};

describe('applyWorkspaceLogoDefaults', () => {
  it('fills both empty logo slots from the workspace defaults', () => {
    const out = applyWorkspaceLogoDefaults(makeSeries(), DEFAULTS);
    expect(out.venueLogoUrl).toBe('/canonical-logos/hyc.png');
    expect(out.eventLogoUrl).toBe('/canonical-logos/aib.png');
  });

  it('leaves a configured slot untouched, fills only the empty one', () => {
    const out = applyWorkspaceLogoDefaults(
      makeSeries({ venueLogoUrl: '/logos/own-venue.png' }),
      DEFAULTS,
    );
    expect(out.venueLogoUrl).toBe('/logos/own-venue.png');
    expect(out.eventLogoUrl).toBe('/canonical-logos/aib.png');
  });

  it('does not touch the companion website URLs (no workspace default exists)', () => {
    const out = applyWorkspaceLogoDefaults(
      makeSeries({ venueUrl: 'https://hyc.ie' }),
      DEFAULTS,
    );
    expect(out.venueUrl).toBe('https://hyc.ie');
    expect(out.eventUrl).toBe('');
  });

  it('returns the same object when nothing changes', () => {
    const series = makeSeries({
      venueLogoUrl: '/logos/a.png',
      eventLogoUrl: '/logos/b.png',
    });
    expect(applyWorkspaceLogoDefaults(series, DEFAULTS)).toBe(series);
  });

  it('is a no-op when the workspace has no defaults', () => {
    const series = makeSeries();
    const out = applyWorkspaceLogoDefaults(series, {
      venueLogoUrl: '',
      eventLogoUrl: '',
    });
    expect(out).toBe(series);
    expect(out.venueLogoUrl).toBe('');
  });
});

describe('resolveSeriesLogoDefaults', () => {
  it('reads defaults from the repo and applies them', async () => {
    const out = await resolveSeriesLogoDefaults(makeSeries(), {
      getDefaults: async () => DEFAULTS,
    });
    expect(out.venueLogoUrl).toBe('/canonical-logos/hyc.png');
    expect(out.eventLogoUrl).toBe('/canonical-logos/aib.png');
  });

  it('is a no-op (no DB read) when no logo repo is supplied', async () => {
    const series = makeSeries();
    const out = await resolveSeriesLogoDefaults(series, undefined);
    expect(out).toBe(series);
  });

  it('falls back to the unchanged series when the defaults read fails', async () => {
    // The client reader hits a `logo-library`-gated endpoint that 403s when the
    // feature is off; that must not abort the export.
    const series = makeSeries();
    const out = await resolveSeriesLogoDefaults(series, {
      getDefaults: async () => {
        throw new Error('403 feature not enabled');
      },
    });
    expect(out).toBe(series);
  });
});
