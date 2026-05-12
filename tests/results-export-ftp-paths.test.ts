import { describe, it, expect } from 'vitest';
import { derivePrefillPaths } from '@/lib/results-export';

// Regression coverage for #131. The dialog used to round-trip a single
// "base" path and reconstruct each fleet's path by appending the fleet
// slug, mangling any custom naming convention. derivePrefillPaths now
// returns per-fleet paths verbatim when stored in ftpPaths.

describe('derivePrefillPaths', () => {
  const fleets = [
    { id: 'fleet-puppeteer', name: 'Puppeteer HPH' },
    { id: 'fleet-cruiser', name: 'Cruiser' },
  ];

  it('returns stored per-fleet paths verbatim regardless of fleet-name convention (#131)', () => {
    const stored = {
      'fleet-puppeteer': '/reshyc/sc-test/series1_tue_pup_hph.htm',
      'fleet-cruiser': '/reshyc/sc-test/series1_tue_cruiser.htm',
    };
    expect(derivePrefillPaths(fleets, stored, '/legacy.htm', false)).toEqual([
      '/reshyc/sc-test/series1_tue_pup_hph.htm',
      '/reshyc/sc-test/series1_tue_cruiser.htm',
    ]);
  });

  it('falls back to deriving from legacy ftpPath when a fleet has no stored entry', () => {
    const stored = { 'fleet-puppeteer': '/custom/pup.htm' };
    expect(derivePrefillPaths(fleets, stored, '/results/series.html', false)).toEqual([
      '/custom/pup.htm',
      '/results/series-cruiser.html',
    ]);
  });

  it('falls back entirely to legacy derivation for pre-#131 series', () => {
    expect(derivePrefillPaths(fleets, undefined, '/results/series.html', false)).toEqual([
      '/results/series-puppeteer-hph.html',
      '/results/series-cruiser.html',
    ]);
  });

  it('single-fleet series uses ftpPath as-is', () => {
    expect(
      derivePrefillPaths(
        [{ id: 'only', name: 'Only Fleet' }],
        undefined,
        '/results/series.html',
        true,
      ),
    ).toEqual(['/results/series.html']);
  });

  it('zero-fleet series returns the legacy path once', () => {
    expect(derivePrefillPaths([], {}, '/results/series.html', true)).toEqual([
      '/results/series.html',
    ]);
  });
});
