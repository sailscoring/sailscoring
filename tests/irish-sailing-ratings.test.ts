import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  normalizeSailNumber,
  parseIrishSailingRatings,
} from '@/lib/irish-sailing-ratings';

const FIXTURE = readFileSync(
  join(process.cwd(), 'tests/fixtures/irish-sailing-ratings.html'),
  'utf-8',
);

describe('parseIrishSailingRatings', () => {
  const { updatedAt, records } = parseIrishSailingRatings(FIXTURE);

  it('extracts the "last updated" stamp verbatim', () => {
    expect(updatedAt).toBe('28/05/2026 @ 14:51');
  });

  it('parses every data row, skipping the hidden export mirror table', () => {
    expect(records.map((r) => r.sailNumber)).toEqual(['IRL1431', 'IRL1773', 'IRL3199']);
  });

  it('maps IRC + ECHO columns for a fully-rated boat', () => {
    const r = records.find((x) => x.sailNumber === 'IRL1431')!;
    expect(r).toMatchObject({
      boatName: '3 Cheers',
      model: 'Elan 31',
      owner: 'Flor Riordan',
      club: 'Schull Harbour Sailing Club',
      echo: 0.975,
      ircTcc: 0.932,
      ircNonSpinTcc: 0.918,
      ircCertNumber: '14271',
      ircCertDate: '26/05/2026',
      echoCertDate: '12/05/2026',
    });
  });

  it('leaves IRC fields undefined for an ECHO-only boat', () => {
    const r = records.find((x) => x.sailNumber === 'IRL1773')!;
    expect(r.echo).toBe(1.01);
    expect(r.ircTcc).toBeUndefined();
    expect(r.ircNonSpinTcc).toBeUndefined();
    expect(r.ircCertNumber).toBeUndefined();
  });

  it('decodes HTML entities in names (numeric and &amp;)', () => {
    const r = records.find((x) => x.sailNumber === 'IRL3199')!;
    expect(r.boatName).toBe('AfterHours Adó');
    expect(r.owner).toBe('John & Mary Walsh');
  });

  it('throws a clear error when the table is absent', () => {
    expect(() => parseIrishSailingRatings('<html><body>no table</body></html>')).toThrow(
      /page layout may have changed/,
    );
  });
});

describe('normalizeSailNumber', () => {
  it('collapses case, spaces, and separators', () => {
    expect(normalizeSailNumber('IRL 1431')).toBe('IRL1431');
    expect(normalizeSailNumber('irl-1431')).toBe('IRL1431');
    expect(normalizeSailNumber('IRL1431')).toBe('IRL1431');
  });

  it('does not invent a national prefix for bare numbers', () => {
    expect(normalizeSailNumber('1431')).toBe('1431');
    expect(normalizeSailNumber('1431')).not.toBe(normalizeSailNumber('IRL1431'));
  });
});
