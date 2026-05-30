import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { formatLastModified, parseClubListing } from '@/lib/irc-rating';

const FIXTURE = readFileSync(
  join(process.cwd(), 'tests/fixtures/irc-club-listing.csv'),
  'utf-8',
);

describe('parseClubListing', () => {
  const records = parseClubListing(FIXTURE);
  const bySail = (sail: string) => records.filter((r) => r.sailNumber === sail);

  it('skips rows that are not valid certificates (ValidCode != Yes)', () => {
    // "Old Timer" IRL9000 has ValidCode = No.
    expect(records.find((r) => r.sailNumber === 'IRL9000')).toBeUndefined();
    expect(records).toHaveLength(6);
  });

  it('maps the IRC columns by header name', () => {
    const r = bySail('IRL1431')[0];
    expect(r).toMatchObject({
      sailNumber: 'IRL1431',
      boatName: '3 Cheers',
      ircTcc: 0.932,
      ircNonSpinTcc: 0.918,
      ircCertNumber: '12345',
      certYear: '2026',
      isSecondary: false,
    });
  });

  it('reads the Endorsed flag', () => {
    expect(bySail('IRL1601')[0].endorsed).toBe(true);
    expect(bySail('IRL1431')[0].endorsed).toBeUndefined();
  });

  it('marks a secondary certificate from the Secondary=SEC column', () => {
    const certs = bySail('IRL7404');
    expect(certs).toHaveLength(2);
    const primary = certs.find((r) => r.ircCertNumber === '11479')!;
    const secondary = certs.find((r) => r.ircCertNumber === '50718')!;
    expect(primary.isSecondary).toBe(false);
    expect(secondary.isSecondary).toBe(true);
  });

  it('handles a quoted field containing a comma', () => {
    const r = bySail('GBR108')[0];
    expect(r.boatName).toBe('Hullabaloo, XV');
    expect(r.ircTcc).toBe(0.913);
  });

  it('keeps a bare (country-code-less) sail number as published', () => {
    expect(bySail('4343')[0]).toMatchObject({ sailNumber: '4343', ircTcc: 1.05 });
  });

  it('throws when the Sail No column is missing', () => {
    expect(() => parseClubListing('Foo,Bar\n1,2')).toThrow(/Sail No/);
  });

  it('throws on empty input', () => {
    expect(() => parseClubListing('')).toThrow(/empty/);
  });
});

describe('formatLastModified', () => {
  it('formats an HTTP date as DD/MM/YYYY (UTC)', () => {
    expect(formatLastModified('Sat, 30 May 2026 10:50:01 GMT')).toBe('30/05/2026');
  });

  it('returns null for a missing or unparseable header', () => {
    expect(formatLastModified(null)).toBeNull();
    expect(formatLastModified('not a date')).toBeNull();
  });
});
