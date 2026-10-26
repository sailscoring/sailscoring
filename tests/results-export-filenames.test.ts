import { describe, it, expect } from 'vitest';
import { fleetHtmlFilename, fleetPdfTitle } from '@/lib/results-export';

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
