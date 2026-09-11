import { describe, it, expect } from 'vitest';
import { derivePrefillPaths, fleetHtmlFilename, fleetPdfTitle } from '@/lib/results-export';
import type { PublishPage } from '@/lib/publish-pages';

// Regression coverage for #131. The dialog used to round-trip a single
// "base" path and reconstruct each fleet's path by appending the fleet
// slug, mangling any custom naming convention. derivePrefillPaths now
// returns per-fleet paths verbatim when stored in ftpPaths.

describe('derivePrefillPaths', () => {
  const pages: PublishPage[] = [
    {
      key: 'fleet:fleet-puppeteer',
      name: 'Puppeteer HPH',
      kind: 'fleet',
      isDefault: false,
      fleetId: 'fleet-puppeteer',
    },
    {
      key: 'fleet:fleet-cruiser',
      name: 'Cruiser',
      kind: 'fleet',
      isDefault: false,
      fleetId: 'fleet-cruiser',
    },
  ];

  it('returns stored per-page paths verbatim regardless of naming convention (#131)', () => {
    const stored = {
      'fleet:fleet-puppeteer': '/reshyc/sc-test/series1_tue_pup_hph.htm',
      'fleet:fleet-cruiser': '/reshyc/sc-test/series1_tue_cruiser.htm',
    };
    expect(derivePrefillPaths(pages, stored, '/legacy.htm')).toEqual({
      'fleet:fleet-puppeteer': '/reshyc/sc-test/series1_tue_pup_hph.htm',
      'fleet:fleet-cruiser': '/reshyc/sc-test/series1_tue_cruiser.htm',
    });
  });

  it('reads the entry a fleet id keyed, from before paths were per page', () => {
    const stored = { 'fleet-puppeteer': '/custom/pup.htm' };
    expect(derivePrefillPaths(pages, stored, '/results/series.html')).toEqual({
      'fleet:fleet-puppeteer': '/custom/pup.htm',
      'fleet:fleet-cruiser': '/results/series-cruiser.html',
    });
  });

  it('falls back entirely to legacy derivation for pre-#131 series', () => {
    expect(derivePrefillPaths(pages, undefined, '/results/series.html')).toEqual({
      'fleet:fleet-puppeteer': '/results/series-puppeteer-hph.html',
      'fleet:fleet-cruiser': '/results/series-cruiser.html',
    });
  });

  it('gives the lone default page the legacy path as-is', () => {
    const lone: PublishPage[] = [
      { key: 'fleet:only', name: 'Only Fleet', kind: 'fleet', isDefault: true, fleetId: 'only' },
    ];
    expect(derivePrefillPaths(lone, undefined, '/results/series.html')).toEqual({
      'fleet:only': '/results/series.html',
    });
  });

  it('suffixes the pages published beside a lone results page', () => {
    const withExtras: PublishPage[] = [
      { key: 'fleet:only', name: 'Only Fleet', kind: 'fleet', isDefault: true, fleetId: 'only' },
      { key: 'prizes', name: 'Prizes', kind: 'prizes', isDefault: false },
      { key: 'entries', name: 'Entries', kind: 'entries', isDefault: false },
    ];
    expect(derivePrefillPaths(withExtras, undefined, '/results/series.html')).toEqual({
      'fleet:only': '/results/series.html',
      prizes: '/results/series-prizes.html',
      entries: '/results/series-entries.html',
    });
  });
});

describe('fleetHtmlFilename', () => {
  it('uses the bare series slug for the single/default fleet', () => {
    expect(fleetHtmlFilename('Autumn League 2026', { fleetName: 'Default', isDefault: true }))
      .toBe('autumn-league-2026.html');
  });

  it('appends the fleet slug for a named fleet in a multi-fleet series', () => {
    expect(fleetHtmlFilename('Autumn League 2026', { fleetName: 'Junior', isDefault: false }))
      .toBe('autumn-league-2026-junior.html');
  });

  it('slugifies multi-word fleet names', () => {
    expect(fleetHtmlFilename('Spring Series', { fleetName: 'Puppeteer HPH', isDefault: false }))
      .toBe('spring-series-puppeteer-hph.html');
  });
});

describe('fleetPdfTitle', () => {
  it('is just the series name for the single/default fleet', () => {
    expect(fleetPdfTitle('2026 Munsters', { fleetName: 'Default', isDefault: true }))
      .toBe('2026 Munsters');
  });

  it('appends the fleet name for a named fleet, keeping spaces and casing', () => {
    expect(fleetPdfTitle('2026 Munsters', { fleetName: 'Senior', isDefault: false }))
      .toBe('2026 Munsters - Senior');
  });

  it('puts the sub-series block before the fleet', () => {
    expect(
      fleetPdfTitle('2026 Munsters', { fleetName: 'Senior', isDefault: false, subSeriesName: 'Main Fleet' }),
    ).toBe('2026 Munsters - Main Fleet - Senior');
  });
});
